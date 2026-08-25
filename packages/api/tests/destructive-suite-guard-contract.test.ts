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
  });
});
