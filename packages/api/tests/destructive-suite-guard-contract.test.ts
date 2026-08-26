import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Source-level contract: every destructive real-database suite must be gated by
 * the centralized guard before any hook or test callback can run. This is a
 * static read of the suite sources — it never imports them and never connects.
 */
const TESTS_DIRECTORY = dirname(fileURLToPath(import.meta.url));

const DESTRUCTIVE_SUITES = [
  "audit-governance-ui.integration.test.ts",
  "rbac-governance-ui.integration.test.ts",
  "quarantine-governance-ui.integration.test.ts",
  "admin-governance-ui.integration.test.ts",
  "workflow-transition.integration.test.ts",
  "bootstrap-admin.integration.test.ts",
] as const;

function readSuite(fileName: string): string {
  return readFileSync(join(TESTS_DIRECTORY, fileName), "utf8");
}

describe("Destructive real-database suite guard contract", () => {
  it.each(DESTRUCTIVE_SUITES)(
    "%s imports the centralized guard",
    (fileName) => {
      expect(readSuite(fileName)).toContain(
        'from "./helpers/isolated-test-database-guard"',
      );
    },
  );

  it.each(DESTRUCTIVE_SUITES)(
    "%s resolves the guard before declaring its suite",
    (fileName) => {
      const source = readSuite(fileName);
      const guardIndex = source.indexOf("requireIsolatedTestDatabase()");
      const suiteIndex = source.search(/^describe\w*\(/m);

      expect(guardIndex).toBeGreaterThan(-1);
      expect(suiteIndex).toBeGreaterThan(-1);
      expect(guardIndex).toBeLessThan(suiteIndex);
    },
  );

  it.each(DESTRUCTIVE_SUITES)(
    "%s declares no ungated top-level describe",
    (fileName) => {
      expect(readSuite(fileName)).not.toMatch(/^describe[.(]/m);
    },
  );

  it("bootstrap-admin no longer falls back to DATABASE_URL for permission to run", () => {
    const source = readSuite("bootstrap-admin.integration.test.ts");

    expect(source).not.toContain("process.env.DATABASE_URL");
    expect(source).not.toContain("describe.runIf");
  });

  it("the centralized guard never imports Prisma or a database client", () => {
    const guardSource = readFileSync(
      join(TESTS_DIRECTORY, "helpers", "isolated-test-database-guard.ts"),
      "utf8",
    );

    expect(guardSource).not.toMatch(/^import .*(@prisma\/client|@savvyedge\/database)/m);
    expect(guardSource).not.toContain("PrismaClient");
    // The helper is dependency-free by design: it must be evaluable before any
    // module that could open a connection is loaded.
    expect(guardSource).not.toMatch(/^import\s/m);
  });
});

/**
 * The suites below opt in through their own variables or connect through their
 * own targets, so they use the configurable form of the same centralized guard.
 * Assertions read normalized source (comments removed) so a doc comment that
 * merely *mentions* a removed pattern cannot satisfy or break them.
 */
const CONFIGURABLE_GUARD_SUITES = [
  "ingestion-governance.integration.test.ts",
  "phase2-audit-schema.integration.test.ts",
  "orchestrator-runtime.database.integration.test.ts",
  "snapshot-reprocessing.integration.test.ts",
] as const;

/** Suites whose every top-level describe must be gated by the guard. */
const FULLY_GATED_SUITES = CONFIGURABLE_GUARD_SUITES.filter(
  (fileName) => fileName !== "phase2-audit-schema.integration.test.ts",
);

const GUARD_CALL = /^const \w+ = require(Configured)?IsolatedTestDatabase\(/m;
const SUITE_INVOCATION = /^describe\w*[.(]/m;

/** Drops comment-only lines, including the interior lines of block comments. */
function normalizeSource(fileName: string): string {
  return readSuite(fileName)
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join("\n");
}

describe("Configurable destructive-suite guard contract", () => {
  it.each(CONFIGURABLE_GUARD_SUITES)(
    "%s imports the centralized guard",
    (fileName) => {
      expect(readSuite(fileName)).toContain(
        'from "./helpers/isolated-test-database-guard"',
      );
    },
  );

  it.each(CONFIGURABLE_GUARD_SUITES)(
    "%s resolves the guard at module scope, before any suite is declared",
    (fileName) => {
      const source = normalizeSource(fileName);
      const guardMatch = source.match(GUARD_CALL);
      const suiteMatch = source.match(SUITE_INVOCATION);

      expect(guardMatch).not.toBeNull();
      expect(suiteMatch).not.toBeNull();
      expect(guardMatch!.index).toBeLessThan(suiteMatch!.index!);
    },
  );

  it.each(FULLY_GATED_SUITES)(
    "%s declares no ungated top-level describe",
    (fileName) => {
      expect(normalizeSource(fileName)).not.toMatch(/^describe[.(]/m);
    },
  );

  it("ingestion governance has no fallback database URL", () => {
    const source = normalizeSource("ingestion-governance.integration.test.ts");

    expect(source).not.toContain("postgresql://");
    expect(source).not.toContain("postgres://");
    expect(source).not.toContain("process.env");
    expect(source).not.toMatch(/PHASE2_WORKFLOW_TEST_DATABASE_URL\s*\|\|/);
  });

  it("ingestion governance proves the client it deletes through", () => {
    const source = normalizeSource("ingestion-governance.integration.test.ts");

    expect(source).not.toContain("new PrismaClient");
    expect(source).toContain("current_database()");
    expect(source).toMatch(/\.databaseName/);
  });

  it("snapshot reprocessing has no boolean-only or callback-only permission gate", () => {
    const source = normalizeSource("snapshot-reprocessing.integration.test.ts");

    expect(source).not.toContain("describe.runIf");
    expect(source).not.toMatch(/=\s*Boolean\(/);
    expect(source).not.toContain("process.env");
    expect(source).not.toMatch(/must equal DATABASE_URL/);
    expect(source).toMatch(
      /optInVariable:\s*"SNAPSHOT_REPROCESSING_TEST_DATABASE_URL"/,
    );
  });

  it("orchestrator runtime has no private validator and never reassigns DATABASE_URL", () => {
    const source = normalizeSource(
      "orchestrator-runtime.database.integration.test.ts",
    );

    expect(source).not.toContain("validateTestDatabaseUrl");
    expect(source).not.toContain("allowedHosts");
    expect(source).not.toMatch(/process\.env\.DATABASE_URL\s*=[^=]/);
    expect(source).not.toContain("process.env");
  });

  it("orchestrator runtime keeps live identity verification off a weaker parser", () => {
    const source = normalizeSource(
      "orchestrator-runtime.database.integration.test.ts",
    );

    expect(source).toContain("current_database()");
    expect(source).toMatch(/expectedDatabaseName\s*=[\s\S]{0,160}\.databaseName/);
    expect(source).toMatch(/prisma\.jobQueue\.deleteMany/);
  });

  it("phase2 audit real-database describes are not enabled by URL presence alone", () => {
    const source = normalizeSource("phase2-audit-schema.integration.test.ts");

    expect(source).not.toContain("process.env.PHASE2_TEST_DATABASE_URL");
    expect(source).toMatch(/optInVariable:\s*"PHASE2_TEST_DATABASE_URL"/);
    expect(source).toMatch(/const databaseUrl =[\s\S]{0,160}\.url\b/);
  });

  it("phase2 audit keeps the non-database migration policy test enabled", () => {
    const source = normalizeSource("phase2-audit-schema.integration.test.ts");
    const policyIndex = source.search(/^describe\("Phase 2\.2A migration policy"/m);

    expect(policyIndex).toBeGreaterThan(-1);
    expect(source.match(/^describe[.(]/gm)).toHaveLength(1);
  });

  it("phase2 audit points both Prisma and psql at the validated URL only", () => {
    const source = normalizeSource("phase2-audit-schema.integration.test.ts");
    const prismaTargets = source.match(/datasources:\s*\{\s*db:\s*\{\s*url:\s*databaseUrl/g);

    expect(prismaTargets).toHaveLength(2);
    expect(source).toMatch(/execFileSync\(\s*"psql",\s*\[\s*databaseUrl!/);
  });
});
