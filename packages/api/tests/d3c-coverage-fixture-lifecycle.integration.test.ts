import { spawn, spawnSync } from "node:child_process";
import { accessSync, constants, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const API_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATABASE_ROOT = join(API_ROOT, "../database");
const DATABASE_NAME = "savvyedge_d3c_test";
const ADMIN_ROLE = "savvy_d3c_test_admin";
const TEMPORARY_PREFIX = "/tmp/sve-d3c-test-";

const SAFE_ENV = {
  LANG: "C",
  LC_ALL: "C",
  PATH: process.env.PATH ?? "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
  PGPASSFILE: "/dev/null",
  PGSERVICEFILE: "/dev/null",
};

function binary(name: string): string | null {
  for (const directory of SAFE_ENV.PATH.split(delimiter)) {
    const candidate = join(directory, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Keep looking on the bounded PATH.
    }
  }
  return null;
}

const INITDB = binary("initdb");
const PG_CTL = binary("pg_ctl");
const PSQL = binary("psql");
const TSX = join(API_ROOT, "node_modules/.bin/tsx");
const PRISMA = join(DATABASE_ROOT, "node_modules/.bin/prisma");
const describeWithPostgres =
  INITDB && PG_CTL && PSQL ? describe : describe.skip;

function run(
  command: string,
  args: string[],
  options: { cwd?: string; env?: Record<string, string> } = {},
) {
  return spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? SAFE_ENV,
    encoding: "utf8",
    timeout: 120_000,
  });
}

function mustSucceed(result: ReturnType<typeof run>, label: string): string {
  if (result.status !== 0) {
    throw new Error(
      `${label} failed (${String(result.status)}): ${result.stderr.slice(0, 1200)}`,
    );
  }
  return result.stdout;
}

async function unusedLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Could not allocate a loopback PostgreSQL test port");
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

describeWithPostgres("D3C disposable fixture database lifecycle", () => {
  let temporaryRoot = "";
  let dataDirectory = "";
  let socketDirectory = "";
  let port = 0;
  let url = "";
  let clusterStarted = false;

  function fixtureEnv(target = url, destroyOptIn = target) {
    return {
      ...SAFE_ENV,
      DATABASE_URL: target,
      DIRECT_URL: target,
      SAVVYEDGE_D3C_FIXTURE_DATABASE_URL: target,
      SAVVYEDGE_D3C_DESTROY_TEST_DATABASE_URL: destroyOptIn,
      SAVVYEDGE_COVERAGE_AUDIT_DATABASE_URL: target,
      ACTIVE_AI_PROVIDER: "dev",
    };
  }

  function psql(database: string, sql: string) {
    return run(PSQL!, [
      "--no-psqlrc",
      "--no-password",
      "--set",
      "ON_ERROR_STOP=1",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--username",
      ADMIN_ROLE,
      "--dbname",
      database,
      "--tuples-only",
      "--no-align",
      "--command",
      sql,
    ]);
  }

  function fixture(args: string[], env = fixtureEnv()) {
    return run(TSX, ["scripts/seed-d3c-coverage-fixture.ts", ...args], {
      cwd: API_ROOT,
      env,
    });
  }

  function fixtureAsync(args: string[]) {
    return new Promise<{
      status: number | null;
      stdout: string;
      stderr: string;
    }>((resolve, reject) => {
      const child = spawn(
        TSX,
        ["scripts/seed-d3c-coverage-fixture.ts", ...args],
        { cwd: API_ROOT, env: fixtureEnv() },
      );
      let stdout = "";
      let stderr = "";
      const timeout = setTimeout(() => child.kill("SIGKILL"), 60_000);
      child.stdout.on("data", (chunk) => (stdout += String(chunk)));
      child.stderr.on("data", (chunk) => (stderr += String(chunk)));
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once("close", (status) => {
        clearTimeout(timeout);
        resolve({ status, stdout, stderr });
      });
    });
  }

  beforeAll(async () => {
    accessSync(TSX, constants.X_OK);
    accessSync(PRISMA, constants.X_OK);
    temporaryRoot = mkdtempSync(TEMPORARY_PREFIX);
    dataDirectory = join(temporaryRoot, "data");
    socketDirectory = join(temporaryRoot, "socket");
    mkdirSync(socketDirectory);
    port = await unusedLoopbackPort();
    url = `postgresql://${ADMIN_ROLE}@127.0.0.1:${port}/${DATABASE_NAME}?schema=public`;

    mustSucceed(
      run(INITDB!, [
        "--pgdata",
        dataDirectory,
        "--username",
        ADMIN_ROLE,
        "--auth-local=trust",
        "--auth-host=trust",
        "--no-locale",
        "--encoding=UTF8",
      ]),
      "initdb",
    );
    mustSucceed(
      run(PG_CTL!, [
        "--pgdata",
        dataDirectory,
        "--wait",
        "--log",
        join(temporaryRoot, "postgres.log"),
        "--options",
        `-F -p ${port} -h 127.0.0.1 -k ${socketDirectory}`,
        "start",
      ]),
      "pg_ctl start",
    );
    clusterStarted = true;
    mustSucceed(
      psql("postgres", `CREATE DATABASE "${DATABASE_NAME}"`),
      "create disposable test database",
    );
    mustSucceed(
      run(PRISMA, ["migrate", "deploy", "--schema", "prisma/schema.prisma"], {
        cwd: DATABASE_ROOT,
        env: fixtureEnv(),
      }),
      "migrate disposable test database",
    );
  }, 180_000);

  afterAll(() => {
    if (clusterStarted && PG_CTL) {
      mustSucceed(
        run(PG_CTL, [
          "--pgdata",
          dataDirectory,
          "--wait",
          "--mode",
          "immediate",
          "stop",
        ]),
        "stop disposable PostgreSQL cluster",
      );
    }
    if (temporaryRoot.startsWith(TEMPORARY_PREFIX)) {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  }, 60_000);

  it("seeds, audits, and destroys only the explicitly opted-in test database", async () => {
    const seeds = await Promise.all([fixtureAsync([]), fixtureAsync([])]);
    expect(seeds.map((result) => result.status).sort()).toEqual([0, 1]);
    expect(seeds.find((result) => result.status === 0)?.stdout).toContain(
      "Fixed fixture rows",
    );
    expect(seeds.find((result) => result.status === 0)?.stdout).toContain("17");

    const evidenceClockSql = `SELECT observed_at::text || '|' || extracted_at::text
      FROM "EvidenceRecord" WHERE id = 'd3cfix-ev-a'`;
    const originalEvidenceClock = mustSucceed(
      psql(DATABASE_NAME, evidenceClockSql),
      "read original fixture evidence clock",
    );
    const reseed = fixture([]);
    expect(reseed.status).toBe(1);
    expect(reseed.stderr).toContain(
      "historical evidence must not be rewritten",
    );
    expect(
      mustSucceed(
        psql(DATABASE_NAME, evidenceClockSql),
        "recheck fixture evidence clock",
      ),
    ).toBe(originalEvidenceClock);

    const triggerState = mustSucceed(
      psql(
        DATABASE_NAME,
        `SELECT tgname || ':' || tgenabled::text FROM pg_catalog.pg_trigger
        WHERE tgname IN ('WorkflowAuditEvent_append_only', 'WorkflowEventClaim_append_only')
        ORDER BY tgname`,
      ),
      "inspect append-only triggers",
    );
    expect(triggerState.trim().split("\n")).toEqual([
      "WorkflowAuditEvent_append_only:O",
      "WorkflowEventClaim_append_only:O",
    ]);
    const prohibitedDelete = psql(
      DATABASE_NAME,
      `DELETE FROM "WorkflowEventClaim" WHERE id = 'd3cfix-wfc-a'`,
    );
    expect(prohibitedDelete.status).not.toBe(0);
    expect(prohibitedDelete.stderr).toContain("append-only");

    const audited = run(TSX, ["scripts/verify-production-bonus-coverage.ts"], {
      cwd: API_ROOT,
      env: fixtureEnv(),
    });
    expect(audited.status).toBe(2);
    expect(audited.stdout).toMatch(/Population \(published\/approved\)\s+2/);
    expect(audited.stdout).toMatch(/Compliant\s+1/);
    expect(audited.stdout).toMatch(/Non-compliant\s+1/);
    expect(audited.stdout).toMatch(/STALE_OBSERVATION\s+1/);
    expect(audited.stdout).toMatch(/Ready\s+2/);
    expect(audited.stdout).toMatch(/Consistent\s+2/);

    const formerCleanup = fixture(["--cleanup"]);
    expect(formerCleanup.status).toBe(1);
    expect(formerCleanup.stderr).toContain("cannot be row-deleted");

    for (const unsafeUrl of [
      `postgresql://${ADMIN_ROLE}@db.example.test:${port}/${DATABASE_NAME}?schema=public`,
      `postgresql://${ADMIN_ROLE}@127.0.0.1:${port}/savvyedge_d3c?schema=public`,
      `postgresql://${ADMIN_ROLE}@127.0.0.1:${port}/savvyedge_prod_test?schema=public`,
    ]) {
      const refused = fixture(
        ["--destroy-test-database"],
        fixtureEnv(unsafeUrl),
      );
      expect(refused.status).toBe(1);
      expect(refused.stderr).toMatch(/REFUSED|SAFETY ERROR/);
    }
    const missingSecondOptIn = fixture(["--destroy-test-database"], {
      ...fixtureEnv(),
      SAVVYEDGE_D3C_DESTROY_TEST_DATABASE_URL: "",
    });
    expect(missingSecondOptIn.status).toBe(1);

    const destroyed = mustSucceed(
      fixture(["--destroy-test-database"]),
      "destroy disposable D3C test database",
    );
    expect(destroyed).toContain("D3C_COVERAGE_TEST_DATABASE: DESTROYED");
    expect(
      mustSucceed(
        psql(
          "postgres",
          `SELECT count(*) FROM pg_catalog.pg_database WHERE datname = '${DATABASE_NAME}'`,
        ),
        "verify disposable database destruction",
      ).trim(),
    ).toBe("0");
  }, 180_000);
});
