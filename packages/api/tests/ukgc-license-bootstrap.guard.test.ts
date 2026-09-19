import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { UkgcBootstrapApprovedTarget } from "../src/constants/ukgc-bootstrap-approved-target";
import {
  CURRENT_DATABASE_SQL,
  CURRENT_ROLE_SQL,
  SESSION_READ_ONLY_SQL,
  type ReadOnlyProbeClient,
} from "../src/services/production-readonly-connection.guard";
import {
  REQUIRED_UKGC_BOOTSTRAP_TABLE_PRIVILEGES,
  UKGC_BOOTSTRAP_COLUMN_PRIVILEGES_SQL,
  UKGC_BOOTSTRAP_CONFIRM_VARIABLE,
  UKGC_BOOTSTRAP_DATABASE_PRIVILEGES_SQL,
  UKGC_BOOTSTRAP_DATABASE_VARIABLE,
  UKGC_BOOTSTRAP_NON_PUBLIC_SCHEMA_PRIVILEGES_SQL,
  UKGC_BOOTSTRAP_OWNERSHIP_SQL,
  UKGC_BOOTSTRAP_ROLE_VARIABLE,
  UKGC_BOOTSTRAP_ROLE_ATTRIBUTES_SQL,
  UKGC_BOOTSTRAP_ROUTINE_PRIVILEGES_SQL,
  UKGC_BOOTSTRAP_SCHEMA_PRIVILEGES_SQL,
  UKGC_BOOTSTRAP_SEQUENCE_PRIVILEGES_SQL,
  UKGC_BOOTSTRAP_TABLE_PRIVILEGES_SQL,
  UKGC_BOOTSTRAP_UNEXPECTED_ACL_SQL,
  UKGC_BOOTSTRAP_URL_VARIABLE,
  UkgcBootstrapGuardError,
  parseUkgcBootstrapArguments,
  proveUkgcBootstrapWriteConnection,
  resolveUkgcBootstrapConnectionConfig,
} from "../src/services/ukgc-license-bootstrap.guard";

const CASINO_ID = "10000000-0000-4000-8000-000000000001";
const OPERATOR = "savvy_test_ukgc_bootstrap_operator";
const DATABASE = "savvyedge_ukgc_target_test";
const CONNECTION_URL = `postgresql://${OPERATOR}:secret@127.0.0.1:5432/${DATABASE}?sslmode=require`;
const APPROVED_TARGET = {
  endpoints: [
    { hostname: "127.0.0.1", port: 5432, routingUsername: OPERATOR },
    {
      hostname: "pooler.example.test",
      port: 6543,
      routingUsername: `pooler.${OPERATOR}`,
    },
  ],
  database: DATABASE,
  role: OPERATOR,
} satisfies UkgcBootstrapApprovedTarget;

function configuredEnvironment(): Record<string, string> {
  return {
    [UKGC_BOOTSTRAP_URL_VARIABLE]: CONNECTION_URL,
    [UKGC_BOOTSTRAP_ROLE_VARIABLE]: OPERATOR,
    [UKGC_BOOTSTRAP_DATABASE_VARIABLE]: DATABASE,
  };
}

function operationalAnswers(): Record<string, unknown> {
  return {
    [SESSION_READ_ONLY_SQL]: [{ transaction_read_only: "off" }],
    [CURRENT_ROLE_SQL]: [{ current_role: OPERATOR, session_role: OPERATOR }],
    [UKGC_BOOTSTRAP_ROLE_ATTRIBUTES_SQL]: [
      {
        has_superuser: false,
        has_bypassrls: false,
        has_escalation: false,
        has_membership_admin: false,
      },
    ],
    [CURRENT_DATABASE_SQL]: [{ database_name: DATABASE }],
    [UKGC_BOOTSTRAP_OWNERSHIP_SQL]: [
      {
        owns_database: false,
        owns_schema: false,
        owned_relations: 0,
        owned_sequences: 0,
        owned_routines: 0,
      },
    ],
    [UKGC_BOOTSTRAP_DATABASE_PRIVILEGES_SQL]: [
      {
        can_connect: true,
        can_grant_connect: false,
        can_create: false,
        can_create_temp: false,
      },
    ],
    [UKGC_BOOTSTRAP_SCHEMA_PRIVILEGES_SQL]: [
      { can_use: true, can_grant_usage: false, can_create: false },
    ],
    [UKGC_BOOTSTRAP_NON_PUBLIC_SCHEMA_PRIVILEGES_SQL]: [
      { accessible_schemas: 0 },
    ],
    [UKGC_BOOTSTRAP_ROUTINE_PRIVILEGES_SQL]: [{ executable_routines: 0 }],
    [UKGC_BOOTSTRAP_UNEXPECTED_ACL_SQL]: [{ unexpected_acl_entries: 0 }],
    [UKGC_BOOTSTRAP_TABLE_PRIVILEGES_SQL]:
      REQUIRED_UKGC_BOOTSTRAP_TABLE_PRIVILEGES.map(
        ([table_name, privilege_name]) => ({
          table_name,
          privilege_name,
          is_currently_effective: true,
        }),
      ),
    [UKGC_BOOTSTRAP_COLUMN_PRIVILEGES_SQL]: [],
    [UKGC_BOOTSTRAP_SEQUENCE_PRIVILEGES_SQL]: [],
  };
}

function clientWith(answers: Record<string, unknown>): ReadOnlyProbeClient {
  return {
    async $queryRawUnsafe<T>(query: string): Promise<T> {
      return answers[query] as T;
    },
  };
}

describe("guarded UKGC bootstrap operation", () => {
  it("rejects a self-consistent caller target that is not the approved target", () => {
    expect(() =>
      resolveUkgcBootstrapConnectionConfig(
        { casinoId: CASINO_ID, execute: false },
        {
          [UKGC_BOOTSTRAP_URL_VARIABLE]:
            "postgresql://unintended_operator:secret@unintended.example.test:5432/unintended_test",
          [UKGC_BOOTSTRAP_ROLE_VARIABLE]: "unintended_operator",
          [UKGC_BOOTSTRAP_DATABASE_VARIABLE]: "unintended_test",
        },
        APPROVED_TARGET,
      ),
    ).toThrow(UkgcBootstrapGuardError);

    const wrongEndpoint = configuredEnvironment();
    wrongEndpoint[UKGC_BOOTSTRAP_URL_VARIABLE] =
      `postgresql://${OPERATOR}:secret@unintended.example.test:5432/` +
      `${DATABASE}?sslmode=require`;
    expect(() =>
      resolveUkgcBootstrapConnectionConfig(
        { casinoId: CASINO_ID, execute: false },
        wrongEndpoint,
        APPROVED_TARGET,
      ),
    ).toThrow("connection endpoint is not approved");
  });

  it("fails closed when approved target configuration is missing or mismatched", () => {
    expect(() =>
      resolveUkgcBootstrapConnectionConfig(
        { casinoId: CASINO_ID, execute: false },
        configuredEnvironment(),
      ),
    ).toThrow("code-reviewed UKGC bootstrap target");

    expect(() =>
      resolveUkgcBootstrapConnectionConfig(
        { casinoId: CASINO_ID, execute: false },
        configuredEnvironment(),
        {
          ...APPROVED_TARGET,
          database: "other_approved_test",
        },
      ),
    ).toThrow(UkgcBootstrapGuardError);
  });

  it("accepts exactly one Casino business target and rejects source or actor overrides", () => {
    expect(parseUkgcBootstrapArguments(["--casino-id", CASINO_ID])).toEqual({
      casinoId: CASINO_ID,
      execute: false,
    });
    expect(
      parseUkgcBootstrapArguments(["--casino-id", CASINO_ID, "--execute"]),
    ).toEqual({ casinoId: CASINO_ID, execute: true });

    for (const forbidden of ["--domain", "--account", "--human-actor-id"]) {
      expect(() =>
        parseUkgcBootstrapArguments([
          "--casino-id",
          CASINO_ID,
          forbidden,
          "override",
        ]),
      ).toThrow(UkgcBootstrapGuardError);
    }
  });

  it("defaults to preflight and requires target-specific execution intent", () => {
    const preflight = resolveUkgcBootstrapConnectionConfig(
      { casinoId: CASINO_ID, execute: false },
      configuredEnvironment(),
      APPROVED_TARGET,
    );
    expect(preflight.execute).toBe(false);

    expect(() =>
      resolveUkgcBootstrapConnectionConfig(
        { casinoId: CASINO_ID, execute: true },
        configuredEnvironment(),
        APPROVED_TARGET,
      ),
    ).toThrow(UKGC_BOOTSTRAP_CONFIRM_VARIABLE);

    const execution = resolveUkgcBootstrapConnectionConfig(
      { casinoId: CASINO_ID, execute: true },
      {
        ...configuredEnvironment(),
        [UKGC_BOOTSTRAP_CONFIRM_VARIABLE]: `EXECUTE:${CASINO_ID}`,
      },
      APPROVED_TARGET,
    );
    expect(execution.execute).toBe(true);
  });

  it("accepts an approved pooler endpoint without confusing its routing username with the observed role", () => {
    const environment = configuredEnvironment();
    environment[UKGC_BOOTSTRAP_URL_VARIABLE] =
      `postgresql://pooler.${OPERATOR}:secret@pooler.example.test:6543/` +
      `${DATABASE}?pgbouncer=true&sslmode=require`;

    expect(
      resolveUkgcBootstrapConnectionConfig(
        { casinoId: CASINO_ID, execute: false },
        environment,
        APPROVED_TARGET,
      ),
    ).toMatchObject({
      url: environment[UKGC_BOOTSTRAP_URL_VARIABLE],
      approvedTarget: APPROVED_TARGET,
    });

    environment[UKGC_BOOTSTRAP_URL_VARIABLE] =
      `postgresql://other-project.${OPERATOR}:secret@pooler.example.test:6543/` +
      `${DATABASE}?pgbouncer=true&sslmode=require`;
    expect(() =>
      resolveUkgcBootstrapConnectionConfig(
        { casinoId: CASINO_ID, execute: false },
        environment,
        APPROVED_TARGET,
      ),
    ).toThrow("connection endpoint is not approved");
  });

  it("rejects a configured database target mismatch without exposing the URL", () => {
    let thrown: unknown;
    try {
      resolveUkgcBootstrapConnectionConfig(
        { casinoId: CASINO_ID, execute: false },
        {
          ...configuredEnvironment(),
          [UKGC_BOOTSTRAP_DATABASE_VARIABLE]: "other_database",
        },
        APPROVED_TARGET,
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(UkgcBootstrapGuardError);
    expect((thrown as Error).message).not.toContain(CONNECTION_URL);
    expect((thrown as Error).message).not.toContain("secret");
  });

  it("rejects schema redirection and unsupported connection parameters", () => {
    for (const suffix of [
      "?schema=private",
      "?options=-csearch_path%3Dprivate",
    ]) {
      expect(() =>
        resolveUkgcBootstrapConnectionConfig(
          { casinoId: CASINO_ID, execute: false },
          {
            ...configuredEnvironment(),
            [UKGC_BOOTSTRAP_URL_VARIABLE]: `postgresql://${OPERATOR}:secret@127.0.0.1:5432/${DATABASE}${suffix}`,
          },
          APPROVED_TARGET,
        ),
      ).toThrow(UkgcBootstrapGuardError);
    }
  });

  it.each(["?sslmode=disable", "?SSLMODE=DISABLE", "?sslmode=%64isable"])(
    "rejects an explicit TLS downgrade (%s) before connection",
    (suffix) => {
      expect(() =>
        resolveUkgcBootstrapConnectionConfig(
          { casinoId: CASINO_ID, execute: false },
          {
            ...configuredEnvironment(),
            [UKGC_BOOTSTRAP_URL_VARIABLE]: `postgresql://${OPERATOR}:secret@127.0.0.1:5432/${DATABASE}${suffix}`,
          },
          APPROVED_TARGET,
        ),
      ).toThrow("explicitly disables TLS");
    },
  );

  it("accepts only the exact non-escalating writer role and database", async () => {
    await expect(
      proveUkgcBootstrapWriteConnection(
        clientWith(operationalAnswers()),
        APPROVED_TARGET,
      ),
    ).resolves.toEqual({
      proven: true,
      role: OPERATOR,
      databaseName: DATABASE,
    });

    await expect(
      proveUkgcBootstrapWriteConnection(
        clientWith({
          ...operationalAnswers(),
          [CURRENT_ROLE_SQL]: [
            { current_role: "database_owner", session_role: "database_owner" },
          ],
        }),
        APPROVED_TARGET,
      ),
    ).resolves.toMatchObject({ proven: false, failedCheck: "CURRENT_ROLE" });

    await expect(
      proveUkgcBootstrapWriteConnection(
        clientWith({
          ...operationalAnswers(),
          [CURRENT_DATABASE_SQL]: [{ database_name: "wrong_database" }],
        }),
        APPROVED_TARGET,
      ),
    ).resolves.toMatchObject({
      proven: false,
      failedCheck: "TARGET_DATABASE",
    });
  });

  it("rejects a missing required table privilege", async () => {
    const answers = operationalAnswers();
    answers[UKGC_BOOTSTRAP_TABLE_PRIVILEGES_SQL] = (
      answers[UKGC_BOOTSTRAP_TABLE_PRIVILEGES_SQL] as unknown[]
    ).slice(1);

    await expect(
      proveUkgcBootstrapWriteConnection(clientWith(answers), APPROVED_TARGET),
    ).resolves.toMatchObject({
      proven: false,
      failedCheck: "REQUIRED_PRIVILEGES",
    });
  });

  it("does not count a SET ROLE-only privilege as currently usable", async () => {
    const answers = operationalAnswers();
    const tablePrivileges = answers[
      UKGC_BOOTSTRAP_TABLE_PRIVILEGES_SQL
    ] as Array<Record<string, unknown>>;
    answers[UKGC_BOOTSTRAP_TABLE_PRIVILEGES_SQL] = tablePrivileges.map(
      (privilege, index) =>
        index === 0
          ? { ...privilege, is_currently_effective: false }
          : privilege,
    );

    await expect(
      proveUkgcBootstrapWriteConnection(clientWith(answers), APPROVED_TARGET),
    ).resolves.toMatchObject({
      proven: false,
      failedCheck: "REQUIRED_PRIVILEGES",
    });
  });

  it.each([
    ["DELETE anywhere", "Casino", "DELETE"],
    ["TRUNCATE anywhere", "Casino", "TRUNCATE"],
    ["INSERT on an unrelated table", "Bonus", "INSERT"],
    ["UPDATE on an unrelated table", "Bonus", "UPDATE"],
    ["a write outside an approved operation", "EvidenceRecord", "UPDATE"],
    ["a grant option", "Casino", "SELECT WITH GRANT OPTION"],
  ])("rejects %s", async (_case, tableName, privilegeName) => {
    const answers = operationalAnswers();
    answers[UKGC_BOOTSTRAP_TABLE_PRIVILEGES_SQL] = [
      ...(answers[UKGC_BOOTSTRAP_TABLE_PRIVILEGES_SQL] as unknown[]),
      {
        table_name: tableName,
        privilege_name: privilegeName,
        is_currently_effective: true,
      },
    ];

    await expect(
      proveUkgcBootstrapWriteConnection(clientWith(answers), APPROVED_TARGET),
    ).resolves.toMatchObject({
      proven: false,
      failedCheck: "TABLE_PRIVILEGE_ENVELOPE",
    });
  });

  it("rejects a server privilege class not known to the fixed probes", async () => {
    await expect(
      proveUkgcBootstrapWriteConnection(
        clientWith({
          ...operationalAnswers(),
          [UKGC_BOOTSTRAP_UNEXPECTED_ACL_SQL]: [{ unexpected_acl_entries: 1 }],
        }),
        APPROVED_TARGET,
      ),
    ).resolves.toMatchObject({
      proven: false,
      failedCheck: "TABLE_PRIVILEGE_ENVELOPE",
    });
  });

  it("rejects an unexpected column-only write privilege", async () => {
    await expect(
      proveUkgcBootstrapWriteConnection(
        clientWith({
          ...operationalAnswers(),
          [UKGC_BOOTSTRAP_COLUMN_PRIVILEGES_SQL]: [
            {
              table_name: "Bonus",
              column_name: "description",
              privilege_name: "UPDATE",
            },
          ],
        }),
        APPROVED_TARGET,
      ),
    ).resolves.toMatchObject({
      proven: false,
      failedCheck: "COLUMN_PRIVILEGE_ENVELOPE",
    });
  });

  it.each([
    [
      "missing USAGE",
      { can_use: false, can_grant_usage: false, can_create: false },
    ],
    ["CREATE", { can_use: true, can_grant_usage: false, can_create: true }],
    [
      "USAGE grant option",
      { can_use: true, can_grant_usage: true, can_create: false },
    ],
  ])("rejects public schema %s", async (_case, schemaPrivileges) => {
    await expect(
      proveUkgcBootstrapWriteConnection(
        clientWith({
          ...operationalAnswers(),
          [UKGC_BOOTSTRAP_SCHEMA_PRIVILEGES_SQL]: [schemaPrivileges],
        }),
        APPROVED_TARGET,
      ),
    ).resolves.toMatchObject({
      proven: false,
      failedCheck: "SCHEMA_CREATE_PRIVILEGE",
    });
  });

  it.each([
    [
      "missing CONNECT",
      { can_connect: false, can_grant_connect: false, can_create: false },
    ],
    [
      "database CREATE",
      { can_connect: true, can_grant_connect: false, can_create: true },
    ],
    [
      "CONNECT grant option",
      { can_connect: true, can_grant_connect: true, can_create: false },
    ],
  ])("rejects %s", async (_case, databasePrivileges) => {
    await expect(
      proveUkgcBootstrapWriteConnection(
        clientWith({
          ...operationalAnswers(),
          [UKGC_BOOTSTRAP_DATABASE_PRIVILEGES_SQL]: [databasePrivileges],
        }),
        APPROVED_TARGET,
      ),
    ).resolves.toMatchObject({
      proven: false,
      failedCheck: "DATABASE_PRIVILEGES",
    });
  });

  it("rejects ownership that expands authority", async () => {
    await expect(
      proveUkgcBootstrapWriteConnection(
        clientWith({
          ...operationalAnswers(),
          [UKGC_BOOTSTRAP_OWNERSHIP_SQL]: [
            {
              owns_database: false,
              owns_schema: false,
              owned_relations: 1,
              owned_sequences: 0,
              owned_routines: 0,
            },
          ],
        }),
        APPROVED_TARGET,
      ),
    ).resolves.toMatchObject({ proven: false, failedCheck: "OWNERSHIP" });
  });

  it("keeps dangerous reachable role attributes rejected", async () => {
    await expect(
      proveUkgcBootstrapWriteConnection(
        clientWith({
          ...operationalAnswers(),
          [UKGC_BOOTSTRAP_ROLE_ATTRIBUTES_SQL]: [
            {
              has_superuser: false,
              has_bypassrls: false,
              has_escalation: true,
              has_membership_admin: false,
            },
          ],
        }),
        APPROVED_TARGET,
      ),
    ).resolves.toMatchObject({
      proven: false,
      failedCheck: "ROLE_ATTRIBUTES",
    });
  });

  it("rejects membership ADMIN OPTION", async () => {
    await expect(
      proveUkgcBootstrapWriteConnection(
        clientWith({
          ...operationalAnswers(),
          [UKGC_BOOTSTRAP_ROLE_ATTRIBUTES_SQL]: [
            {
              has_superuser: false,
              has_bypassrls: false,
              has_escalation: false,
              has_membership_admin: true,
            },
          ],
        }),
        APPROVED_TARGET,
      ),
    ).resolves.toMatchObject({
      proven: false,
      failedCheck: "ROLE_ATTRIBUTES",
    });
  });

  it("rejects any effective sequence capability", async () => {
    await expect(
      proveUkgcBootstrapWriteConnection(
        clientWith({
          ...operationalAnswers(),
          [UKGC_BOOTSTRAP_SEQUENCE_PRIVILEGES_SQL]: [
            { sequence_name: "unneeded_sequence", privilege_name: "UPDATE" },
          ],
        }),
        APPROVED_TARGET,
      ),
    ).resolves.toMatchObject({
      proven: false,
      failedCheck: "SEQUENCE_PRIVILEGE_ENVELOPE",
    });
  });

  it("fails closed on malformed privilege-catalog results", async () => {
    await expect(
      proveUkgcBootstrapWriteConnection(
        clientWith({
          ...operationalAnswers(),
          [UKGC_BOOTSTRAP_TABLE_PRIVILEGES_SQL]: [
            {
              table_name: "Casino",
              privilege_name: 42,
              is_currently_effective: true,
            },
          ],
        }),
        APPROVED_TARGET,
      ),
    ).resolves.toMatchObject({
      proven: false,
      failedCheck: "TABLE_PRIVILEGE_ENVELOPE",
    });
  });

  it("sanitizes privilege-catalog query failures and fails closed", async () => {
    const secret = "postgresql://operator:secret@example.test/production";
    const answers = operationalAnswers();
    const client: ReadOnlyProbeClient = {
      async $queryRawUnsafe<T>(query: string): Promise<T> {
        if (query === UKGC_BOOTSTRAP_TABLE_PRIVILEGES_SQL) {
          throw new Error(secret);
        }
        return answers[query] as T;
      },
    };

    const proof = await proveUkgcBootstrapWriteConnection(
      client,
      APPROVED_TARGET,
    );
    expect(proof).toMatchObject({
      proven: false,
      failedCheck: "TABLE_PRIVILEGE_ENVELOPE",
    });
    expect(proof.proven ? "" : proof.reason).not.toContain(secret);
    expect(proof.proven ? "" : proof.reason).not.toContain("secret");
  });

  it("rejects required privileges plus an inherited UPDATE on an unrelated table", async () => {
    const observedQueries: string[] = [];
    const answers = {
      ...operationalAnswers(),
      [UKGC_BOOTSTRAP_TABLE_PRIVILEGES_SQL]: [
        ...(operationalAnswers()[
          UKGC_BOOTSTRAP_TABLE_PRIVILEGES_SQL
        ] as unknown[]),
        {
          table_name: "Bonus",
          privilege_name: "UPDATE",
          is_currently_effective: false,
        },
      ],
    };
    const inheritedWriterClient: ReadOnlyProbeClient = {
      async $queryRawUnsafe<T>(query: string): Promise<T> {
        observedQueries.push(query);
        return answers[query] as T;
      },
    };

    await expect(
      proveUkgcBootstrapWriteConnection(inheritedWriterClient, APPROVED_TARGET),
    ).resolves.toMatchObject({
      proven: false,
      failedCheck: "TABLE_PRIVILEGE_ENVELOPE",
    });
    expect(observedQueries).toContain(UKGC_BOOTSTRAP_TABLE_PRIVILEGES_SQL);
  });

  it("keeps target authorization and live proof ahead of bootstrap invocation", () => {
    const source = readFileSync(
      new URL("../scripts/bootstrap-ukgc-license.ts", import.meta.url),
      "utf8",
    );
    const resolveIndex = source.indexOf(
      "const config = resolveUkgcBootstrapConnectionConfig(args);",
    );
    const clientIndex = source.indexOf(
      'const { PrismaClient } = await import("@savvyedge/database");',
    );
    const proofIndex = source.indexOf(
      "const proof = await proveUkgcBootstrapWriteConnection(",
    );
    const bootstrapIndex = source.indexOf(
      'await import("../src/services/ukgc-license-bootstrap.service");',
    );

    expect(resolveIndex).toBeGreaterThanOrEqual(0);
    expect(clientIndex).toBeGreaterThan(resolveIndex);
    expect(proofIndex).toBeGreaterThan(clientIndex);
    expect(bootstrapIndex).toBeGreaterThan(proofIndex);
    expect(source).toContain("datasources: { db: { url: config.url } }");
    expect(source).toContain("database,\n      config.approvedTarget,");
    expect(source).toContain("provePersistenceConnection: (transaction)");
    expect(source).toContain("database,\n        provePersistenceConnection");
  });
});
