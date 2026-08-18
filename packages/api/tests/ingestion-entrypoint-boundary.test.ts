import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@savvyedge/database";
import { INGESTION_QUEUE_NAME } from "../src/constants/queue-names";
import { JobQueueService } from "../src/services/job-queue.service";
import { IngestionEnqueueService } from "../src/services/ingestion-enqueue.service";
import { IngestionService } from "../src/services/ingestion.service";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");

/**
 * Forbidden execution-plane dependencies. The Vercel web runtime must never
 * load any of these — they pull in Playwright browser binaries which do not
 * exist in the serverless bundle.
 */
const FORBIDDEN_SPECIFIERS = [/^playwright(\/|$)/, /^@savvyedge\/ai-agents(\/|$)/];

const IMPORT_SPECIFIER = /(?:import|export)[\s\S]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|require\(\s*["']([^"']+)["']\s*\)/g;

function readSpecifiers(file: string): string[] {
  const source = fs.readFileSync(file, "utf8");
  const specifiers: string[] = [];
  for (const match of source.matchAll(IMPORT_SPECIFIER)) {
    const specifier = match[1] ?? match[2] ?? match[3];
    if (specifier) specifiers.push(specifier);
  }
  return specifiers;
}

function resolveRelative(fromFile: string, specifier: string): string | null {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.js`,
    path.join(base, "index.ts"),
    path.join(base, "index.js"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

/**
 * Walks the relative-import closure of an entrypoint and returns every
 * bare (package) specifier reachable from it, keyed by the file importing it.
 */
function collectTransitivePackageImports(entry: string) {
  const visited = new Set<string>();
  const packageImports: Array<{ file: string; specifier: string }> = [];
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (visited.has(file)) continue;
    visited.add(file);

    for (const specifier of readSpecifiers(file)) {
      if (specifier.startsWith(".")) {
        const resolved = resolveRelative(file, specifier);
        expect(
          resolved,
          `Unresolvable relative import "${specifier}" in ${path.relative(repoRoot, file)}`,
        ).not.toBeNull();
        queue.push(resolved as string);
      } else {
        packageImports.push({ file, specifier });
      }
    }
  }

  return { visited, packageImports };
}

describe("Vercel ingestion entrypoint — control-plane / execution-plane boundary", () => {
  it("keeps @savvyedge/ai-agents and playwright out of the source import graph", () => {
    const entry = path.join(packageRoot, "src/ingestion-entrypoint.ts");
    expect(fs.existsSync(entry)).toBe(true);

    const { visited, packageImports } = collectTransitivePackageImports(entry);

    const violations = packageImports.filter(({ specifier }) =>
      FORBIDDEN_SPECIFIERS.some((pattern) => pattern.test(specifier)),
    );

    expect(
      violations.map(
        ({ file, specifier }) =>
          `${path.relative(repoRoot, file)} imports ${specifier}`,
      ),
    ).toEqual([]);

    // Sanity check that the walk actually traversed the graph rather than
    // trivially passing on an empty set.
    expect(visited.size).toBeGreaterThan(1);
  });

  /**
   * Optional reinforcement of the source-level guarantee above.
   *
   * `dist/` is gitignored and `pnpm --filter @savvyedge/api test` does not build
   * first, so a clean checkout legitimately has no built artifact. This must
   * never fail for that environment/ordering reason — the mandatory guarantees
   * are the source-closure, route-import and exports-map assertions. The
   * definitive built-bundle proof lives in the Next.js production build, whose
   * `.next/server/app/api/v1/ingestion/jobs/route.js.nft.json` file trace must
   * contain zero Playwright references.
   */
  it.runIf(fs.existsSync(path.join(packageRoot, "dist/ingestion-entrypoint.js")))(
    "keeps @savvyedge/ai-agents and playwright out of the built entrypoint, when packages/api has been built",
    () => {
      const entry = path.join(packageRoot, "dist/ingestion-entrypoint.js");

      const { packageImports } = collectTransitivePackageImports(entry);

      const violations = packageImports.filter(({ specifier }) =>
        FORBIDDEN_SPECIFIERS.some((pattern) => pattern.test(specifier)),
      );

      expect(
        violations.map(
          ({ file, specifier }) =>
            `${path.relative(repoRoot, file)} imports ${specifier}`,
        ),
      ).toEqual([]);
    },
  );

  it("proves the root barrel does reach playwright, so the dedicated subpath is load-bearing", () => {
    const entry = path.join(packageRoot, "src/index.ts");
    const { packageImports } = collectTransitivePackageImports(entry);

    expect(
      packageImports.some(({ specifier }) =>
        /^@savvyedge\/ai-agents(\/|$)/.test(specifier),
      ),
    ).toBe(true);
  });

  it("has the web enqueue route importing the dedicated subpath, never the root barrel", () => {
    const route = path.join(
      repoRoot,
      "apps/web/src/app/api/v1/ingestion/jobs/route.ts",
    );
    const specifiers = readSpecifiers(route);

    expect(specifiers).toContain("@savvyedge/api/ingestion-entrypoint");
    expect(specifiers).not.toContain("@savvyedge/api");
  });

  it("exposes the subpath through the package exports map", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"),
    );

    expect(pkg.exports["./ingestion-entrypoint"]).toEqual({
      types: "./dist/ingestion-entrypoint.d.ts",
      default: "./dist/ingestion-entrypoint.js",
    });
  });
});

describe("IngestionEnqueueService — canonical enqueue behaviour", () => {
  beforeEach(() => {
    vi.spyOn(prisma.dataSource, "findFirst").mockResolvedValue(null);
    vi.spyOn(prisma.dataSource, "create").mockResolvedValue({
      id: "data-source-id",
    } as never);
    vi.spyOn(prisma.dataSource, "update").mockResolvedValue({} as never);
    vi.spyOn(prisma.scrapeJob, "create").mockResolvedValue({
      id: "scrape-job-id",
      status: "PROCESSING",
    } as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("enqueues a canonical CRAWL_URL job on the ingestion queue", async () => {
    const enqueue = vi
      .spyOn(JobQueueService, "enqueue")
      .mockResolvedValue({ id: "queue-job-id" } as never);

    const scrapeJob = await IngestionEnqueueService.enqueueIngestion({
      url: "https://operator.example.com/promotions/welcome",
    });

    expect(scrapeJob).toMatchObject({ id: "scrape-job-id" });
    expect(enqueue).toHaveBeenCalledOnce();
    expect(enqueue).toHaveBeenCalledWith(INGESTION_QUEUE_NAME, "CRAWL_URL", {
      scrapeJobId: "scrape-job-id",
      url: "https://operator.example.com/promotions/welcome",
      casinoId: undefined,
      taskContext: "BONUS",
    });
  });

  it("carries casino_id and GAME_LIST context onto the CRAWL_URL payload", async () => {
    const enqueue = vi
      .spyOn(JobQueueService, "enqueue")
      .mockResolvedValue({ id: "queue-job-id" } as never);

    await IngestionEnqueueService.enqueueIngestion({
      url: "https://operator.example.com/casino/games",
      casino_id: "00000000-0000-4000-8000-000000000001",
      taskContext: "GAME_LIST",
    });

    expect(enqueue).toHaveBeenCalledWith(INGESTION_QUEUE_NAME, "CRAWL_URL", {
      scrapeJobId: "scrape-job-id",
      url: "https://operator.example.com/casino/games",
      casinoId: "00000000-0000-4000-8000-000000000001",
      taskContext: "GAME_LIST",
    });
  });

  it("rejects GAME_LIST ingestion without a casino_id before touching the database or queue", async () => {
    const enqueue = vi.spyOn(JobQueueService, "enqueue");

    await expect(
      IngestionEnqueueService.enqueueIngestion({
        url: "https://operator.example.com/casino/games",
        taskContext: "GAME_LIST",
      }),
    ).rejects.toThrow("GAME_LIST ingestion requires a casino_id");

    expect(enqueue).not.toHaveBeenCalled();
    expect(prisma.dataSource.findFirst).not.toHaveBeenCalled();
    expect(prisma.scrapeJob.create).not.toHaveBeenCalled();
  });

  it("keeps IngestionService.enqueueIngestion delegating to the control plane for the worker", async () => {
    const delegate = vi
      .spyOn(IngestionEnqueueService, "enqueueIngestion")
      .mockResolvedValue({ id: "scrape-job-id" } as never);

    await IngestionService.enqueueIngestion({
      url: "https://operator.example.com/promotions/welcome",
      taskContext: "BONUS",
    });

    expect(delegate).toHaveBeenCalledOnce();
    expect(delegate).toHaveBeenCalledWith({
      url: "https://operator.example.com/promotions/welcome",
      taskContext: "BONUS",
    });
  });
});
