import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const repoRoot = path.resolve(packageRoot, "../..");

const IMPORT_SPECIFIER =
  /(?:import|export)[\s\S]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|require\(\s*["']([^"']+)["']\s*\)/g;

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function readSpecifiers(relativePath: string): string[] {
  const specifiers: string[] = [];
  for (const match of readSource(relativePath).matchAll(IMPORT_SPECIFIER)) {
    const specifier = match[1] ?? match[2] ?? match[3];
    if (specifier) specifiers.push(specifier);
  }
  return specifiers;
}

describe("Vercel feature import boundaries", () => {
  it("keeps active-evidence.service independent from ingestion.service", () => {
    const specifiers = readSpecifiers(
      "packages/api/src/services/active-evidence.service.ts",
    );

    expect(specifiers).toContain("../constants/extraction-context");
    expect(specifiers).not.toContain("./ingestion.service");
    expect(specifiers).not.toContain("@savvyedge/ai-agents");
  });

  it("keeps snapshot-reprocessing.service off the ai-agents root barrel", () => {
    const specifiers = readSpecifiers(
      "packages/api/src/services/snapshot-reprocessing.service.ts",
    );

    expect(specifiers).toContain("@savvyedge/ai-agents/extraction-contract");
    expect(specifiers).not.toContain("@savvyedge/ai-agents");
  });

  it("keeps the two Vercel-facing feature services out of the API root barrel", () => {
    const specifiers = readSpecifiers("packages/api/src/index.ts");

    expect(specifiers).not.toContain("./services/active-evidence.service");
    expect(specifiers).not.toContain(
      "./services/snapshot-reprocessing.service",
    );
  });

  it("routes every admin feature consumer through a lightweight API subpath", () => {
    const expectations = [
      [
        "apps/admin/src/app/api/admin/transitions/route.ts",
        "@savvyedge/api/active-evidence",
      ],
      [
        "apps/admin/src/app/review/bonus/[id]/page.tsx",
        "@savvyedge/api/active-evidence",
      ],
      [
        "apps/admin/src/app/quarantine/bonus/[id]/page.tsx",
        "@savvyedge/api/active-evidence",
      ],
      [
        "apps/admin/src/app/api/admin/reprocess-snapshot/route.ts",
        "@savvyedge/api/snapshot-reprocessing",
      ],
    ] as const;

    for (const [file, requiredSubpath] of expectations) {
      const specifiers = readSpecifiers(file);
      expect(specifiers, file).toContain(requiredSubpath);
      expect(specifiers, file).not.toContain("@savvyedge/api");
    }
  });

  it("keeps read-only web publication consumers on the lightweight gate", () => {
    const consumers = [
      "apps/web/src/app/page.tsx",
      "apps/web/src/app/bonuses/page.tsx",
      "apps/web/src/app/casinos/page.tsx",
      "apps/web/src/app/slots/page.tsx",
      "apps/web/src/app/compare/page.tsx",
      "apps/web/src/app/api/bonuses/route.ts",
      "apps/web/src/app/api/casinos/route.ts",
      "apps/web/src/app/api/slots/route.ts",
      "apps/web/src/app/api/v1/casinos/compare/route.ts",
    ];
    const gateSpecifiers = readSpecifiers(
      "packages/api/src/services/publication-gate.service.ts",
    );

    for (const consumer of consumers) {
      const specifiers = readSpecifiers(consumer);
      expect(specifiers, consumer).toContain("@savvyedge/api/publication-gate");
      expect(specifiers, consumer).not.toContain("@savvyedge/api");
    }
    expect(gateSpecifiers).not.toContain("./bonus.service");
    expect(gateSpecifiers).not.toContain("@savvyedge/ai-agents");
  });

  it("keeps Vercel business and evidence services off root barrels", () => {
    const aiServiceBoundaries = [
      [
        "packages/api/src/services/bonus.service.ts",
        "@savvyedge/ai-agents/ai-engine",
      ],
      [
        "packages/api/src/services/casino.service.ts",
        "@savvyedge/ai-agents/ai-engine",
      ],
      [
        "packages/api/src/services/evidence-artifact-retrieval.service.ts",
        "@savvyedge/ai-agents/snapshot-storage",
      ],
      [
        "packages/api/src/services/evidence-artifact-storage.service.ts",
        "@savvyedge/ai-agents/snapshot-storage",
      ],
      [
        "packages/api/src/services/filesystem-evidence-artifact-store.ts",
        "@savvyedge/ai-agents/snapshot-storage",
      ],
      [
        "packages/api/src/utils/bonus-source-identity.ts",
        "@savvyedge/ai-agents/url-normalizer",
      ],
    ] as const;
    for (const [file, requiredSubpath] of aiServiceBoundaries) {
      const specifiers = readSpecifiers(file);
      expect(specifiers, file).toContain(requiredSubpath);
      expect(specifiers, file).not.toContain("@savvyedge/ai-agents");
    }

    const apiConsumers = [
      "apps/web/src/app/api/v1/bonuses/route.ts",
      "apps/web/src/app/api/v1/bonuses/[id]/calculate/route.ts",
      "apps/web/src/app/api/v1/casinos/route.ts",
      "apps/web/src/app/api/v1/casinos/[slug]/route.ts",
      "apps/admin/src/lib/evidence-retrieval.ts",
      "apps/admin/src/app/api/admin/evidence/[id]/route.ts",
    ];
    for (const file of apiConsumers) {
      expect(readSpecifiers(file), file).not.toContain("@savvyedge/api");
    }
  });

  it("exposes direct lightweight package subpaths", () => {
    const apiPackage = JSON.parse(readSource("packages/api/package.json"));
    const aiPackage = JSON.parse(readSource("packages/ai-agents/package.json"));

    expect(apiPackage.exports["./active-evidence"]).toEqual({
      types: "./dist/active-evidence.d.ts",
      default: "./dist/active-evidence.js",
    });
    expect(apiPackage.exports["./snapshot-reprocessing"]).toEqual({
      types: "./dist/snapshot-reprocessing.d.ts",
      default: "./dist/snapshot-reprocessing.js",
    });
    expect(apiPackage.exports["./publication-gate"]).toEqual({
      types: "./dist/publication-gate.d.ts",
      default: "./dist/publication-gate.js",
    });
    expect(apiPackage.exports["./bonus-service"]).toEqual({
      types: "./dist/bonus-service.d.ts",
      default: "./dist/bonus-service.js",
    });
    expect(apiPackage.exports["./casino-service"]).toEqual({
      types: "./dist/casino-service.d.ts",
      default: "./dist/casino-service.js",
    });
    expect(apiPackage.exports["./auth"]).toEqual({
      types: "./dist/auth.d.ts",
      default: "./dist/auth.js",
    });
    expect(apiPackage.exports["./evidence-artifact-retrieval"]).toEqual({
      types: "./dist/evidence-artifact-retrieval.d.ts",
      default: "./dist/evidence-artifact-retrieval.js",
    });
    expect(aiPackage.exports["./extraction-contract"]).toEqual({
      types: "./src/utils/extraction-contract.ts",
      default: "./src/utils/extraction-contract.ts",
    });
    expect(aiPackage.exports["./ai-engine"]).toEqual({
      types: "./src/engine/ai.engine.ts",
      default: "./src/engine/ai.engine.ts",
    });
    expect(aiPackage.exports["./snapshot-storage"]).toEqual({
      types: "./src/services/SnapshotStorage.ts",
      default: "./src/services/SnapshotStorage.ts",
    });
    expect(aiPackage.exports["./url-normalizer"]).toEqual({
      types: "./src/utils/url-normalizer.ts",
      default: "./src/utils/url-normalizer.ts",
    });

    expect(readSpecifiers("packages/api/src/active-evidence.ts")).toEqual([
      "./services/active-evidence.service",
    ]);
    expect(readSpecifiers("packages/api/src/snapshot-reprocessing.ts")).toEqual(
      ["./services/snapshot-reprocessing.service"],
    );
    expect(readSpecifiers("packages/api/src/publication-gate.ts")).toEqual([
      "./services/publication-gate.service",
    ]);
    expect(readSpecifiers("packages/api/src/bonus-service.ts")).toEqual([
      "./services/bonus.service",
      "./services/bonus.service",
    ]);
    expect(readSpecifiers("packages/api/src/casino-service.ts")).toEqual([
      "./services/casino.service",
    ]);
    expect(readSpecifiers("packages/api/src/auth.ts")).toEqual([
      "./utils/auth.utils",
      "./utils/auth.utils",
    ]);
    expect(
      readSpecifiers("packages/api/src/evidence-artifact-retrieval.ts"),
    ).toEqual(["./services/evidence-artifact-retrieval.service"]);
  });

  const builtEntrypoints = [
    "packages/ai-agents/dist/src/utils/extraction-contract.js",
    "packages/ai-agents/dist/src/engine/ai.engine.js",
    "packages/ai-agents/dist/src/services/SnapshotStorage.js",
    "packages/ai-agents/dist/src/utils/url-normalizer.js",
    "packages/api/dist/active-evidence.js",
    "packages/api/dist/snapshot-reprocessing.js",
    "packages/api/dist/publication-gate.js",
    "packages/api/dist/bonus-service.js",
    "packages/api/dist/casino-service.js",
    "packages/api/dist/auth.js",
    "packages/api/dist/evidence-artifact-retrieval.js",
  ];
  const builtEntrypointsExist = builtEntrypoints.every((file) =>
    fs.existsSync(path.join(repoRoot, file)),
  );

  it.runIf(builtEntrypointsExist)(
    "imports built lightweight subpaths without loading Playwright",
    () => {
      const loader = path.join(
        packageRoot,
        "tests/helpers/module-boundary-loader.mjs",
      );
      const requireHook = path.join(
        packageRoot,
        "tests/helpers/module-boundary-require-hook.cjs",
      );
      const adminRoot = path.join(repoRoot, "apps/admin");
      const subpaths = [
        ["@savvyedge/ai-agents/extraction-contract", packageRoot],
        ["@savvyedge/ai-agents/ai-engine", packageRoot],
        ["@savvyedge/ai-agents/snapshot-storage", packageRoot],
        ["@savvyedge/ai-agents/url-normalizer", packageRoot],
        ["@savvyedge/api/active-evidence", adminRoot],
        ["@savvyedge/api/snapshot-reprocessing", adminRoot],
        ["@savvyedge/api/publication-gate", adminRoot],
        ["@savvyedge/api/bonus-service", adminRoot],
        ["@savvyedge/api/casino-service", adminRoot],
        ["@savvyedge/api/auth", adminRoot],
        ["@savvyedge/api/evidence-artifact-retrieval", adminRoot],
      ] as const;

      for (const [subpath, cwd] of subpaths) {
        const result = spawnSync(
          process.execPath,
          [
            "--no-warnings",
            "--require",
            requireHook,
            "--import",
            "tsx",
            "--experimental-loader",
            loader,
            "--input-type=module",
            "--eval",
            `await import(${JSON.stringify(subpath)})`,
          ],
          {
            cwd,
            encoding: "utf8",
          },
        );

        expect(
          {
            status: result.status,
            signal: result.signal,
            stdout: result.stdout,
            stderr: result.stderr,
          },
          subpath,
        ).toMatchObject({ status: 0, signal: null });
      }
    },
  );
});
