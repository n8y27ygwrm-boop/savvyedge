import { accessSync, constants, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { delimiter, join } from "node:path";
import { spawnSync } from "node:child_process";
import { PrismaClient } from "@savvyedge/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UkgcBootstrapApprovedTarget } from "../src/constants/ukgc-bootstrap-approved-target";
import {
  REQUIRED_UKGC_BOOTSTRAP_TABLE_PRIVILEGES,
  proveUkgcBootstrapWriteConnection,
} from "../src/services/ukgc-license-bootstrap.guard";

const ADMIN_ROLE = "savvy_test_admin";
const OPERATOR_ROLE = "savvy_test_ukgc_bootstrap_operator";
const INHERITED_WRITER_ROLE = "savvy_test_inherited_writer";
const DATABASE_NAME = "savvyedge_ukgc_privileges_test";
const TEMPORARY_BASE = "/tmp";
const TEMPORARY_PREFIX = "sve-ukgc-test-";

const SAFE_SUBPROCESS_ENV = {
  LANG: "C",
  LC_ALL: "C",
  PATH: process.env.PATH ?? "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
  PGPASSFILE: "/dev/null",
  PGSERVICEFILE: "/dev/null",
};

function resolveBinary(name: string): string | null {
  for (const directory of SAFE_SUBPROCESS_ENV.PATH.split(delimiter)) {
    const candidate = join(directory, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue searching the strict PATH allowlist.
    }
  }
  return null;
}

const INITDB = resolveBinary("initdb");
const PG_CTL = resolveBinary("pg_ctl");
const PSQL = resolveBinary("psql");
const describeWithPostgres =
  INITDB && PG_CTL && PSQL ? describe : describe.skip;

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function run(command: string, args: string[], label: string): string {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: SAFE_SUBPROCESS_ENV,
    timeout: 30_000,
  });
  if (result.status !== 0) {
    const detail = result.stderr.trim().replaceAll(/\s+/g, " ").slice(0, 500);
    throw new Error(
      `${label} failed with status ${String(result.status)}` +
        (detail ? ` (${detail})` : ""),
    );
  }
  return result.stdout;
}

async function unusedLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Could not allocate a loopback PostgreSQL test port");
  }
  const port = address.port;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

describeWithPostgres(
  "UKGC bootstrap exact privilege envelope (disposable PostgreSQL)",
  () => {
    let temporaryRoot = "";
    let dataDirectory = "";
    let socketDirectory = "";
    let port = 0;
    let operator: PrismaClient | null = null;
    let approvedTarget: UkgcBootstrapApprovedTarget;

    function adminSql(database: string, sql: string): string {
      return run(
        PSQL!,
        [
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
        ],
        "disposable PostgreSQL command",
      );
    }

    async function expectRefusal(failedCheck: string): Promise<void> {
      await expect(
        proveUkgcBootstrapWriteConnection(operator!, approvedTarget),
      ).resolves.toMatchObject({ proven: false, failedCheck });
    }

    beforeAll(async () => {
      temporaryRoot = mkdtempSync(join(TEMPORARY_BASE, TEMPORARY_PREFIX));
      dataDirectory = join(temporaryRoot, "data");
      socketDirectory = join(temporaryRoot, "socket");
      mkdirSync(socketDirectory);
      port = await unusedLoopbackPort();

      run(
        INITDB!,
        [
          "--pgdata",
          dataDirectory,
          "--username",
          ADMIN_ROLE,
          "--auth-local=trust",
          "--auth-host=trust",
          "--no-locale",
          "--encoding=UTF8",
        ],
        "initdb",
      );
      run(
        PG_CTL!,
        [
          "--pgdata",
          dataDirectory,
          "--wait",
          "--log",
          join(temporaryRoot, "postgres.log"),
          "--options",
          `-F -p ${port} -h 127.0.0.1 -k ${socketDirectory}`,
          "start",
        ],
        "pg_ctl start",
      );

      adminSql(
        "postgres",
        `CREATE ROLE ${quoteIdentifier(OPERATOR_ROLE)} LOGIN INHERIT ` +
          "NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS",
      );
      adminSql(
        "postgres",
        `CREATE ROLE ${quoteIdentifier(INHERITED_WRITER_ROLE)} NOLOGIN INHERIT ` +
          "NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS",
      );
      adminSql(
        "postgres",
        `CREATE DATABASE ${quoteIdentifier(DATABASE_NAME)} OWNER ${quoteIdentifier(
          ADMIN_ROLE,
        )}`,
      );
      adminSql(
        DATABASE_NAME,
        `REVOKE ALL ON DATABASE ${quoteIdentifier(DATABASE_NAME)} FROM PUBLIC; ` +
          `GRANT CONNECT ON DATABASE ${quoteIdentifier(
            DATABASE_NAME,
          )} TO ${quoteIdentifier(OPERATOR_ROLE)}; ` +
          "REVOKE ALL ON SCHEMA public FROM PUBLIC; " +
          `GRANT USAGE ON SCHEMA public TO ${quoteIdentifier(OPERATOR_ROLE)}`,
      );

      const tableNames = new Set(
        REQUIRED_UKGC_BOOTSTRAP_TABLE_PRIVILEGES.map(([table]) => table),
      );
      tableNames.add("Bonus");
      adminSql(
        DATABASE_NAME,
        [...tableNames]
          .map(
            (table) =>
              `CREATE TABLE public.${quoteIdentifier(
                table,
              )} (id text PRIMARY KEY, note text)`,
          )
          .join("; ") +
          `; INSERT INTO public.${quoteIdentifier(
            "Bonus",
          )} (id, note) VALUES ('bonus-1', 'unchanged')`,
      );

      const grants = new Map<string, string[]>();
      for (const [
        table,
        privilege,
      ] of REQUIRED_UKGC_BOOTSTRAP_TABLE_PRIVILEGES) {
        const tableGrants = grants.get(table) ?? [];
        tableGrants.push(privilege);
        grants.set(table, tableGrants);
      }
      adminSql(
        DATABASE_NAME,
        [...grants]
          .map(
            ([table, privileges]) =>
              `GRANT ${privileges.join(", ")} ON TABLE public.${quoteIdentifier(
                table,
              )} TO ${quoteIdentifier(OPERATOR_ROLE)}`,
          )
          .join("; "),
      );

      const operatorUrl =
        `postgresql://${OPERATOR_ROLE}@127.0.0.1:${port}/${DATABASE_NAME}` +
        "?schema=public&connection_limit=1";
      operator = new PrismaClient({
        datasources: { db: { url: operatorUrl } },
      });
      approvedTarget = {
        endpoints: [
          {
            hostname: "127.0.0.1",
            port,
            routingUsername: OPERATOR_ROLE,
          },
        ],
        database: DATABASE_NAME,
        role: OPERATOR_ROLE,
      };
    }, 60_000);

    afterAll(async () => {
      await operator?.$disconnect();
      if (dataDirectory && PG_CTL) {
        spawnSync(
          PG_CTL,
          ["--pgdata", dataDirectory, "--wait", "--mode", "immediate", "stop"],
          {
            encoding: "utf8",
            env: SAFE_SUBPROCESS_ENV,
            timeout: 30_000,
          },
        );
      }
      if (
        temporaryRoot &&
        temporaryRoot.startsWith(join(TEMPORARY_BASE, TEMPORARY_PREFIX))
      ) {
        rmSync(temporaryRoot, { recursive: true, force: true });
      }
    }, 60_000);

    it("accepts only the intended grants and rejects real excess authority", async () => {
      const initialProof = await proveUkgcBootstrapWriteConnection(
        operator!,
        approvedTarget,
      );
      expect(initialProof).toEqual({
        proven: true,
        role: OPERATOR_ROLE,
        databaseName: DATABASE_NAME,
      });

      adminSql(
        DATABASE_NAME,
        `GRANT DELETE ON TABLE public.${quoteIdentifier(
          "Casino",
        )} TO ${quoteIdentifier(OPERATOR_ROLE)}`,
      );
      await expectRefusal("TABLE_PRIVILEGE_ENVELOPE");
      adminSql(
        DATABASE_NAME,
        `REVOKE DELETE ON TABLE public.${quoteIdentifier(
          "Casino",
        )} FROM ${quoteIdentifier(OPERATOR_ROLE)}`,
      );

      adminSql(
        DATABASE_NAME,
        `GRANT TRUNCATE ON TABLE public.${quoteIdentifier(
          "Casino",
        )} TO ${quoteIdentifier(OPERATOR_ROLE)}`,
      );
      await expectRefusal("TABLE_PRIVILEGE_ENVELOPE");
      adminSql(
        DATABASE_NAME,
        `REVOKE TRUNCATE ON TABLE public.${quoteIdentifier(
          "Casino",
        )} FROM ${quoteIdentifier(OPERATOR_ROLE)}`,
      );

      adminSql(
        DATABASE_NAME,
        `GRANT UPDATE ON TABLE public.${quoteIdentifier(
          "Bonus",
        )} TO ${quoteIdentifier(INHERITED_WRITER_ROLE)}; ` +
          `GRANT USAGE ON SCHEMA public TO ${quoteIdentifier(
            INHERITED_WRITER_ROLE,
          )}; ` +
          `GRANT ${quoteIdentifier(INHERITED_WRITER_ROLE)} TO ${quoteIdentifier(
            OPERATOR_ROLE,
          )}`,
      );
      const rollback = new Error("intentional rollback");
      await expect(
        operator!.$transaction(async (transaction) => {
          await transaction.$executeRawUnsafe(
            `SET LOCAL ROLE ${quoteIdentifier(INHERITED_WRITER_ROLE)}`,
          );
          await transaction.$executeRawUnsafe(
            `UPDATE public.${quoteIdentifier(
              "Bonus",
            )} SET note = 'would-change'`,
          );
          throw rollback;
        }),
      ).rejects.toBe(rollback);
      expect(
        adminSql(
          DATABASE_NAME,
          `SELECT note FROM public.${quoteIdentifier(
            "Bonus",
          )} WHERE id = 'bonus-1'`,
        ).trim(),
      ).toBe("unchanged");
      await expectRefusal("TABLE_PRIVILEGE_ENVELOPE");
      adminSql(
        DATABASE_NAME,
        `REVOKE ${quoteIdentifier(INHERITED_WRITER_ROLE)} FROM ${quoteIdentifier(
          OPERATOR_ROLE,
        )}; ` +
          `REVOKE UPDATE ON TABLE public.${quoteIdentifier(
            "Bonus",
          )} FROM ${quoteIdentifier(INHERITED_WRITER_ROLE)}; ` +
          `REVOKE USAGE ON SCHEMA public FROM ${quoteIdentifier(
            INHERITED_WRITER_ROLE,
          )}`,
      );

      adminSql(
        DATABASE_NAME,
        `GRANT UPDATE (note) ON TABLE public.${quoteIdentifier(
          "Bonus",
        )} TO ${quoteIdentifier(OPERATOR_ROLE)}`,
      );
      const rollbackColumnUpdate = new Error("intentional column rollback");
      await expect(
        operator!.$transaction(async (transaction) => {
          await transaction.$executeRawUnsafe(
            `UPDATE public.${quoteIdentifier("Bonus")} SET note = 'column-update'`,
          );
          throw rollbackColumnUpdate;
        }),
      ).rejects.toBe(rollbackColumnUpdate);
      await expectRefusal("COLUMN_PRIVILEGE_ENVELOPE");
      adminSql(
        DATABASE_NAME,
        `REVOKE UPDATE (note) ON TABLE public.${quoteIdentifier(
          "Bonus",
        )} FROM ${quoteIdentifier(OPERATOR_ROLE)}`,
      );

      adminSql(
        DATABASE_NAME,
        `GRANT INSERT (id, note) ON TABLE public.${quoteIdentifier(
          "Bonus",
        )} TO ${quoteIdentifier(OPERATOR_ROLE)}`,
      );
      const rollbackColumnInsert = new Error("intentional column rollback");
      await expect(
        operator!.$transaction(async (transaction) => {
          await transaction.$executeRawUnsafe(
            `INSERT INTO public.${quoteIdentifier("Bonus")} (id, note) VALUES ('column-1', 'inserted')`,
          );
          throw rollbackColumnInsert;
        }),
      ).rejects.toBe(rollbackColumnInsert);
      await expectRefusal("COLUMN_PRIVILEGE_ENVELOPE");
      adminSql(
        DATABASE_NAME,
        `REVOKE INSERT (id, note) ON TABLE public.${quoteIdentifier(
          "Bonus",
        )} FROM ${quoteIdentifier(OPERATOR_ROLE)}`,
      );

      adminSql(
        DATABASE_NAME,
        `CREATE FUNCTION public.${quoteIdentifier("fixture_update_bonus")}() RETURNS void ` +
          `LANGUAGE sql SECURITY DEFINER AS $$ UPDATE public.${quoteIdentifier(
            "Bonus",
          )} SET note = 'routine-update' WHERE id = 'bonus-1' $$; ` +
          `REVOKE ALL ON FUNCTION public.${quoteIdentifier("fixture_update_bonus")}() FROM PUBLIC; ` +
          `GRANT EXECUTE ON FUNCTION public.${quoteIdentifier("fixture_update_bonus")}() ` +
          `TO ${quoteIdentifier(INHERITED_WRITER_ROLE)}; ` +
          `GRANT ${quoteIdentifier(INHERITED_WRITER_ROLE)} TO ${quoteIdentifier(OPERATOR_ROLE)}`,
      );
      const rollbackRoutine = new Error("intentional routine rollback");
      await expect(
        operator!.$transaction(async (transaction) => {
          await transaction.$queryRawUnsafe(
            `SELECT public.${quoteIdentifier("fixture_update_bonus")}()::text AS result`,
          );
          throw rollbackRoutine;
        }),
      ).rejects.toBe(rollbackRoutine);
      await expectRefusal("ROUTINE_PRIVILEGE_ENVELOPE");
      adminSql(
        DATABASE_NAME,
        `REVOKE ${quoteIdentifier(INHERITED_WRITER_ROLE)} FROM ${quoteIdentifier(
          OPERATOR_ROLE,
        )}; ` +
          `DROP FUNCTION public.${quoteIdentifier("fixture_update_bonus")}()`,
      );

      adminSql(
        DATABASE_NAME,
        `CREATE SCHEMA ${quoteIdentifier("fixture_private")} AUTHORIZATION ${quoteIdentifier(
          ADMIN_ROLE,
        )}; ` +
          `CREATE TABLE ${quoteIdentifier("fixture_private")}.${quoteIdentifier(
            "writable",
          )} (id text PRIMARY KEY, note text); ` +
          `INSERT INTO ${quoteIdentifier("fixture_private")}.${quoteIdentifier(
            "writable",
          )} VALUES ('private-1', 'unchanged'); ` +
          `GRANT USAGE ON SCHEMA ${quoteIdentifier("fixture_private")} TO ${quoteIdentifier(
            OPERATOR_ROLE,
          )}; ` +
          `GRANT UPDATE ON TABLE ${quoteIdentifier("fixture_private")}.${quoteIdentifier(
            "writable",
          )} TO ${quoteIdentifier(OPERATOR_ROLE)}`,
      );
      const rollbackSchema = new Error("intentional schema rollback");
      await expect(
        operator!.$transaction(async (transaction) => {
          await transaction.$executeRawUnsafe(
            `UPDATE ${quoteIdentifier("fixture_private")}.${quoteIdentifier("writable")} SET note = 'changed'`,
          );
          throw rollbackSchema;
        }),
      ).rejects.toBe(rollbackSchema);
      await expectRefusal("NON_PUBLIC_SCHEMA_PRIVILEGE");
      adminSql(
        DATABASE_NAME,
        `DROP SCHEMA ${quoteIdentifier("fixture_private")} CASCADE`,
      );

      adminSql(
        DATABASE_NAME,
        `GRANT TEMP ON DATABASE ${quoteIdentifier(DATABASE_NAME)} TO ${quoteIdentifier(
          OPERATOR_ROLE,
        )}`,
      );
      await expectRefusal("DATABASE_PRIVILEGES");
      adminSql(
        DATABASE_NAME,
        `REVOKE TEMP ON DATABASE ${quoteIdentifier(DATABASE_NAME)} FROM ${quoteIdentifier(
          OPERATOR_ROLE,
        )}`,
      );

      adminSql(
        DATABASE_NAME,
        `ALTER TABLE public.${quoteIdentifier(
          "Bonus",
        )} OWNER TO ${quoteIdentifier(OPERATOR_ROLE)}`,
      );
      await expectRefusal("OWNERSHIP");
      adminSql(
        DATABASE_NAME,
        `ALTER TABLE public.${quoteIdentifier(
          "Bonus",
        )} OWNER TO ${quoteIdentifier(ADMIN_ROLE)}`,
      );

      adminSql(
        DATABASE_NAME,
        `REVOKE USAGE ON SCHEMA public FROM ${quoteIdentifier(OPERATOR_ROLE)}`,
      );
      await expectRefusal("SCHEMA_CREATE_PRIVILEGE");
      adminSql(
        DATABASE_NAME,
        `GRANT USAGE ON SCHEMA public TO ${quoteIdentifier(OPERATOR_ROLE)}`,
      );

      adminSql(
        DATABASE_NAME,
        `GRANT ${quoteIdentifier(INHERITED_WRITER_ROLE)} TO ${quoteIdentifier(
          OPERATOR_ROLE,
        )} WITH ADMIN OPTION`,
      );
      await expectRefusal("ROLE_ATTRIBUTES");
      adminSql(
        DATABASE_NAME,
        `REVOKE ${quoteIdentifier(INHERITED_WRITER_ROLE)} FROM ${quoteIdentifier(
          OPERATOR_ROLE,
        )}`,
      );

      adminSql(
        DATABASE_NAME,
        `CREATE SEQUENCE public.${quoteIdentifier("unneeded_sequence")}; ` +
          `GRANT USAGE ON SEQUENCE public.${quoteIdentifier(
            "unneeded_sequence",
          )} TO ${quoteIdentifier(OPERATOR_ROLE)}`,
      );
      await expectRefusal("SEQUENCE_PRIVILEGE_ENVELOPE");
    }, 60_000);
  },
);
