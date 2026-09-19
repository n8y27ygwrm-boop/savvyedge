import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ProductionCoverageApprovedTarget } from "../src/constants/production-coverage-approved-target";
import {
  CURRENT_DATABASE_SQL,
  CURRENT_ROLE_SQL,
  ISOLATED_MODE_VARIABLE,
  PRODUCTION_MODE_ROLE_VARIABLE,
  PRODUCTION_MODE_URL_VARIABLE,
  ROLE_ATTRIBUTES_SQL,
  SCHEMA_CREATE_SQL,
  SESSION_READ_ONLY_SQL,
  WRITABLE_TABLES_SQL,
  productionFatalMessage,
  proveReadOnlyConnection,
  resolveCoverageAuditConfiguration,
  resolveCoverageAuditMode,
  safeErrorCategory,
  type ReadOnlyProbeClient,
} from "../src/services/production-readonly-connection.guard";

const AUDITOR = "savvyedge_coverage_auditor";
const DATABASE = "savvyedge_coverage_test";
const APPROVED_TARGET = {
  endpoints: [
    {
      hostname: "approved.example.test",
      port: 5432,
      routingUsername: "approved_router",
    },
    {
      hostname: "pooler.example.test",
      port: 6543,
      routingUsername: "approved_router.project_test",
    },
  ],
  database: DATABASE,
  role: AUDITOR,
} satisfies ProductionCoverageApprovedTarget;

/** Every probe answer a fully compliant least-privilege session would give. */
function compliantAnswers(): Record<string, unknown[]> {
  return {
    [SESSION_READ_ONLY_SQL]: [{ transaction_read_only: "on" }],
    [CURRENT_ROLE_SQL]: [{ current_role: AUDITOR, session_role: AUDITOR }],
    [WRITABLE_TABLES_SQL]: [{ writable_tables: 0 }],
    [ROLE_ATTRIBUTES_SQL]: [
      { has_superuser: false, has_bypassrls: false, has_escalation: false },
    ],
    [SCHEMA_CREATE_SQL]: [{ can_create: false }],
    [CURRENT_DATABASE_SQL]: [{ database_name: DATABASE }],
  };
}

/**
 * A probe-only client. It exposes no write method at all, and records every
 * statement so the tests can assert the guard issues nothing but the fixed
 * SELECT probes.
 */
function probeClient(
  answers: Record<string, unknown>,
  throwOn?: string,
): { client: ReadOnlyProbeClient; statements: string[] } {
  const statements: string[] = [];
  const client: ReadOnlyProbeClient = {
    async $queryRawUnsafe<T>(query: string): Promise<T> {
      statements.push(query);
      if (throwOn && query === throwOn) {
        throw new Error("connection reset by peer");
      }
      return answers[query] as T;
    },
  };
  return { client, statements };
}

describe("production read-only proof", () => {
  it("passes only when every least-privilege check holds", async () => {
    const { client, statements } = probeClient(compliantAnswers());

    const proof = await proveReadOnlyConnection(client, APPROVED_TARGET);

    expect(proof).toEqual({
      proven: true,
      details: {
        role: AUDITOR,
        sessionRole: AUDITOR,
        transactionReadOnly: "on",
        writableTableCount: 0,
        canCreateInPublic: false,
        databaseName: DATABASE,
      },
    });
    // Fixed SELECT-only probes, nothing else.
    expect(statements).toEqual([
      SESSION_READ_ONLY_SQL,
      CURRENT_ROLE_SQL,
      WRITABLE_TABLES_SQL,
      ROLE_ATTRIBUTES_SQL,
      SCHEMA_CREATE_SQL,
      CURRENT_DATABASE_SQL,
    ]);
    for (const statement of statements) {
      expect(statement).toMatch(/^SELECT\s/i);
      expect(statement).not.toMatch(
        /\b(INSERT|UPDATE|DELETE|TRUNCATE|CREATE|DROP|ALTER|GRANT)\s+(INTO|TABLE|FROM|ON)\b/i,
      );
    }
  });

  it("refuses when the session is not read-only", async () => {
    const answers = compliantAnswers();
    answers[SESSION_READ_ONLY_SQL] = [{ transaction_read_only: "off" }];

    const proof = await proveReadOnlyConnection(
      probeClient(answers).client,
      APPROVED_TARGET,
    );

    expect(proof).toMatchObject({
      proven: false,
      failedCheck: "SESSION_READ_ONLY",
    });
  });

  it("refuses when the connected role is not the expected auditor", async () => {
    const answers = compliantAnswers();
    answers[CURRENT_ROLE_SQL] = [
      { current_role: "app_writer", session_role: "app_writer" },
    ];

    const proof = await proveReadOnlyConnection(
      probeClient(answers).client,
      APPROVED_TARGET,
    );

    expect(proof).toMatchObject({ proven: false, failedCheck: "CURRENT_ROLE" });
  });

  it("refuses when the connected database is not the approved database", async () => {
    const answers = compliantAnswers();
    answers[CURRENT_DATABASE_SQL] = [{ database_name: "unintended_test" }];

    const proof = await proveReadOnlyConnection(
      probeClient(answers).client,
      APPROVED_TARGET,
    );

    expect(proof).toMatchObject({
      proven: false,
      failedCheck: "TARGET_DATABASE",
    });
  });

  it("refuses a SET ROLE narrowing that could be reset", async () => {
    const answers = compliantAnswers();
    // current_user was narrowed to the auditor, but the login role is not.
    answers[CURRENT_ROLE_SQL] = [
      { current_role: AUDITOR, session_role: "app_owner" },
    ];

    const proof = await proveReadOnlyConnection(
      probeClient(answers).client,
      APPROVED_TARGET,
    );

    expect(proof).toMatchObject({ proven: false, failedCheck: "CURRENT_ROLE" });
  });

  it.each([1, 7])(
    "refuses when %i table(s) carry a write or TRUNCATE privilege",
    async (writable) => {
      const answers = compliantAnswers();
      answers[WRITABLE_TABLES_SQL] = [{ writable_tables: writable }];

      const proof = await proveReadOnlyConnection(
        probeClient(answers).client,
        APPROVED_TARGET,
      );

      expect(proof).toMatchObject({
        proven: false,
        failedCheck: "TABLE_WRITE_PRIVILEGE",
      });
    },
  );

  it.each([
    ["superuser", { has_superuser: true }],
    ["RLS bypass", { has_bypassrls: true }],
    ["CREATEDB/CREATEROLE/REPLICATION", { has_escalation: true }],
  ])("refuses a role with a %s path", async (_label, attribute) => {
    const answers = compliantAnswers();
    answers[ROLE_ATTRIBUTES_SQL] = [
      {
        has_superuser: false,
        has_bypassrls: false,
        has_escalation: false,
        ...attribute,
      },
    ];

    const proof = await proveReadOnlyConnection(
      probeClient(answers).client,
      APPROVED_TARGET,
    );

    expect(proof).toMatchObject({
      proven: false,
      failedCheck: "ROLE_ATTRIBUTES",
    });
  });

  it("refuses a role holding CREATE on schema public", async () => {
    const answers = compliantAnswers();
    answers[SCHEMA_CREATE_SQL] = [{ can_create: true }];

    const proof = await proveReadOnlyConnection(
      probeClient(answers).client,
      APPROVED_TARGET,
    );

    expect(proof).toMatchObject({
      proven: false,
      failedCheck: "SCHEMA_CREATE_PRIVILEGE",
    });
  });

  it.each([
    ["no rows", []],
    ["two rows", [{ transaction_read_only: "on" }, { x: 1 }]],
    ["a null row", [null]],
    ["a scalar", "on"],
    ["undefined", undefined],
    ["a wrongly typed column", [{ transaction_read_only: 1 }]],
  ])("refuses a malformed metadata result: %s", async (_label, malformed) => {
    const answers = compliantAnswers();
    answers[SESSION_READ_ONLY_SQL] = malformed as unknown[];

    const proof = await proveReadOnlyConnection(
      probeClient(answers).client,
      APPROVED_TARGET,
    );

    expect(proof).toMatchObject({
      proven: false,
      failedCheck: "SESSION_READ_ONLY",
    });
  });

  it.each([
    [SESSION_READ_ONLY_SQL, "SESSION_READ_ONLY"],
    [CURRENT_ROLE_SQL, "CURRENT_ROLE"],
    [WRITABLE_TABLES_SQL, "TABLE_WRITE_PRIVILEGE"],
    [ROLE_ATTRIBUTES_SQL, "ROLE_ATTRIBUTES"],
    [SCHEMA_CREATE_SQL, "SCHEMA_CREATE_PRIVILEGE"],
  ])(
    "treats a failed probe as a refusal, never as proof",
    async (failingStatement, failedCheck) => {
      const { client } = probeClient(compliantAnswers(), failingStatement);

      const proof = await proveReadOnlyConnection(client, APPROVED_TARGET);

      expect(proof).toMatchObject({ proven: false, failedCheck });
    },
  );

  it.each([
    ["no rows", []],
    ["two rows", [{ database_name: "a" }, { database_name: "b" }]],
    ["a null row", [null]],
    ["an empty name", [{ database_name: "" }]],
    ["a non-string name", [{ database_name: 42 }]],
    ["a missing column", [{ wrong_column: "neondb" }]],
    ["undefined", undefined],
  ])(
    "refuses a malformed target-database result: %s",
    async (_label, malformed) => {
      const answers = compliantAnswers();
      answers[CURRENT_DATABASE_SQL] = malformed as unknown[];

      const proof = await proveReadOnlyConnection(
        probeClient(answers).client,
        APPROVED_TARGET,
      );

      expect(proof).toMatchObject({
        proven: false,
        failedCheck: "TARGET_DATABASE",
      });
    },
  );

  it("does not weaken the five earlier checks by adding the sixth", async () => {
    // Each earlier violation must still refuse at its own check, with the
    // target-database probe never reached.
    const cases: Array<[string, Record<string, unknown>, string]> = [
      [
        SESSION_READ_ONLY_SQL,
        { transaction_read_only: "off" },
        "SESSION_READ_ONLY",
      ],
      [
        CURRENT_ROLE_SQL,
        { current_role: "other", session_role: "other" },
        "CURRENT_ROLE",
      ],
      [WRITABLE_TABLES_SQL, { writable_tables: 3 }, "TABLE_WRITE_PRIVILEGE"],
      [
        ROLE_ATTRIBUTES_SQL,
        { has_superuser: true, has_bypassrls: false, has_escalation: false },
        "ROLE_ATTRIBUTES",
      ],
      [SCHEMA_CREATE_SQL, { can_create: true }, "SCHEMA_CREATE_PRIVILEGE"],
    ];

    for (const [statement, badRow, failedCheck] of cases) {
      const answers = compliantAnswers();
      answers[statement] = [badRow];
      const { client, statements } = probeClient(answers);

      expect(
        await proveReadOnlyConnection(client, APPROVED_TARGET),
      ).toMatchObject({
        proven: false,
        failedCheck,
      });
      expect(statements).not.toContain(CURRENT_DATABASE_SQL);
    }
  });

  it("refuses when no expected role is configured", async () => {
    for (const role of ["", "   "]) {
      const proof = await proveReadOnlyConnection(
        probeClient(compliantAnswers()).client,
        { database: DATABASE, role },
      );
      expect(proof).toMatchObject({
        proven: false,
        failedCheck: "CURRENT_ROLE",
      });
    }
  });

  it("refuses when no expected database is configured", async () => {
    const proof = await proveReadOnlyConnection(
      probeClient(compliantAnswers()).client,
      { database: "", role: AUDITOR },
    );

    expect(proof).toMatchObject({
      proven: false,
      failedCheck: "TARGET_DATABASE",
    });
  });

  it("never echoes a Prisma error message in a refusal reason", async () => {
    // Regression: Prisma initialization/connection errors embed the host and
    // port they failed to reach. Refusal reasons must carry the class name only.
    const leaky = new Error(
      "Can't reach database server at `db.example.test:5432`\n" +
        "url: postgresql://auditor:hunter2@db.example.test:5432/synthetic_test",
    );
    leaky.name = "PrismaClientInitializationError";

    const client: ReadOnlyProbeClient = {
      async $queryRawUnsafe<T>(): Promise<T> {
        throw leaky;
      },
    };

    const proof = await proveReadOnlyConnection(client, APPROVED_TARGET);
    const serialized = JSON.stringify(proof);

    expect(proof).toMatchObject({
      proven: false,
      failedCheck: "SESSION_READ_ONLY",
      reason:
        "transaction_read_only probe failed: PrismaClientInitializationError",
    });
    for (const secret of [
      "db.example.test",
      "hunter2",
      "synthetic_test",
      "5432",
      "postgresql://",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("never echoes a connection string in a refusal reason", async () => {
    const secret = "postgresql://auditor:hunter2@db.example.test:5432/prod";
    const { client } = probeClient(compliantAnswers(), WRITABLE_TABLES_SQL);
    // The probe error text itself carries no URL; assert the reason stays clean.
    const proof = await proveReadOnlyConnection(client, APPROVED_TARGET);

    expect(proof.proven).toBe(false);
    expect(JSON.stringify(proof)).not.toContain(secret);
    expect(JSON.stringify(proof)).not.toContain("hunter2");
    expect(JSON.stringify(proof)).not.toContain("postgresql://");
  });
});

describe("coverage audit mode resolution", () => {
  it("rejects a self-consistent runtime target that is not the approved target", async () => {
    const unintendedRole = "unintended_auditor";
    const selected = resolveCoverageAuditConfiguration(
      {
        [PRODUCTION_MODE_URL_VARIABLE]:
          "postgresql://unintended_router:secret@unintended.example.test:5432/unintended_test",
        [PRODUCTION_MODE_ROLE_VARIABLE]: unintendedRole,
      },
      APPROVED_TARGET,
    );

    const unintendedAnswers = compliantAnswers();
    unintendedAnswers[CURRENT_ROLE_SQL] = [
      { current_role: unintendedRole, session_role: unintendedRole },
    ];
    unintendedAnswers[CURRENT_DATABASE_SQL] = [
      { database_name: "unintended_test" },
    ];
    const proof =
      selected.mode === "production-readonly"
        ? await proveReadOnlyConnection(
            probeClient(unintendedAnswers).client,
            selected.approvedTarget,
          )
        : null;

    expect({ selected, proof }).toMatchObject({
      selected: { mode: "refused" },
      proof: null,
    });
    expect(selected).not.toHaveProperty("authorization");
  });

  it("selects isolated mode from the isolated variable alone", () => {
    expect(
      resolveCoverageAuditMode({
        [ISOLATED_MODE_VARIABLE]: "postgresql://u@127.0.0.1:5432/x_test",
      }),
    ).toEqual({ mode: "isolated" });
  });

  it("selects production mode with both production variables", () => {
    expect(
      resolveCoverageAuditConfiguration(
        {
          [PRODUCTION_MODE_URL_VARIABLE]: `  postgresql://approved_router:secret@approved.example.test:5432/${DATABASE}?sslmode=require  `,
          [PRODUCTION_MODE_ROLE_VARIABLE]: `  ${AUDITOR}  `,
        },
        APPROVED_TARGET,
      ),
    ).toEqual({
      mode: "production-readonly",
      url: `postgresql://approved_router:secret@approved.example.test:5432/${DATABASE}?sslmode=require`,
      role: AUDITOR,
      approvedTarget: APPROVED_TARGET,
    });
  });

  it.each(["?sslmode=disable", "?SSLMODE=DISABLE", "?sslmode=%64isable"])(
    "refuses an explicit TLS downgrade (%s) before connection",
    (suffix) => {
      expect(
        resolveCoverageAuditConfiguration(
          {
            [PRODUCTION_MODE_URL_VARIABLE]: `postgresql://approved_router:secret@approved.example.test:5432/${DATABASE}${suffix}`,
            [PRODUCTION_MODE_ROLE_VARIABLE]: AUDITOR,
          },
          APPROVED_TARGET,
        ),
      ).toMatchObject({
        mode: "refused",
        reason: expect.stringContaining("explicitly disables TLS"),
      });
    },
  );

  it("fails closed when the approved target is missing or malformed", () => {
    const environment = {
      [PRODUCTION_MODE_URL_VARIABLE]: `postgresql://approved_router:secret@approved.example.test:5432/${DATABASE}`,
      [PRODUCTION_MODE_ROLE_VARIABLE]: AUDITOR,
    };

    expect(resolveCoverageAuditMode(environment).mode).toBe("refused");

    for (const malformed of [
      { ...APPROVED_TARGET, role: "" },
      { ...APPROVED_TARGET, database: "bad/database" },
      { ...APPROVED_TARGET, endpoints: [] },
      {
        ...APPROVED_TARGET,
        endpoints: [
          {
            hostname: "APPROVED.EXAMPLE.TEST",
            port: 5432,
            routingUsername: "approved_router",
          },
        ],
      },
      {
        ...APPROVED_TARGET,
        endpoints: [
          {
            hostname: "approved.example.test",
            port: 0,
            routingUsername: "approved_router",
          },
        ],
      },
      {
        ...APPROVED_TARGET,
        role: undefined as unknown as string,
      },
    ] satisfies ProductionCoverageApprovedTarget[]) {
      expect(
        resolveCoverageAuditConfiguration(environment, malformed).mode,
      ).toBe("refused");
    }
  });

  it.each([
    [
      "hostname",
      `postgresql://approved_router:secret@other.example.test:5432/${DATABASE}`,
    ],
    [
      "port",
      `postgresql://approved_router:secret@approved.example.test:5433/${DATABASE}`,
    ],
    [
      "routing username",
      `postgresql://other_router:secret@approved.example.test:5432/${DATABASE}`,
    ],
    [
      "database",
      "postgresql://approved_router:secret@approved.example.test:5432/other_test",
    ],
  ])("rejects a runtime %s mismatch", (_label, url) => {
    expect(
      resolveCoverageAuditConfiguration(
        {
          [PRODUCTION_MODE_URL_VARIABLE]: url,
          [PRODUCTION_MODE_ROLE_VARIABLE]: AUDITOR,
        },
        APPROVED_TARGET,
      ).mode,
    ).toBe("refused");
  });

  it("rejects a claimed role that differs from the approved role", () => {
    expect(
      resolveCoverageAuditConfiguration(
        {
          [PRODUCTION_MODE_URL_VARIABLE]: `postgresql://approved_router:secret@approved.example.test:5432/${DATABASE}`,
          [PRODUCTION_MODE_ROLE_VARIABLE]: "other_auditor",
        },
        APPROVED_TARGET,
      ).mode,
    ).toBe("refused");
  });

  it("accepts an approved pooler route and rejects identity-altering parameters", () => {
    expect(
      resolveCoverageAuditConfiguration(
        {
          [PRODUCTION_MODE_URL_VARIABLE]: `postgresql://approved_router.project_test:secret@pooler.example.test:6543/${DATABASE}?pgbouncer=true&sslmode=require`,
          [PRODUCTION_MODE_ROLE_VARIABLE]: AUDITOR,
        },
        APPROVED_TARGET,
      ).mode,
    ).toBe("production-readonly");

    for (const url of [
      `https://approved_router:secret@approved.example.test:5432/${DATABASE}`,
      "not-a-url",
    ]) {
      expect(
        resolveCoverageAuditConfiguration(
          {
            [PRODUCTION_MODE_URL_VARIABLE]: url,
            [PRODUCTION_MODE_ROLE_VARIABLE]: AUDITOR,
          },
          APPROVED_TARGET,
        ).mode,
      ).toBe("refused");
    }

    for (const suffix of [
      "?schema=private",
      "?host=other.example.test",
      "?options=-csearch_path%3Dprivate",
      "?sslmode=require&SSLMODE=require",
    ]) {
      expect(
        resolveCoverageAuditConfiguration(
          {
            [PRODUCTION_MODE_URL_VARIABLE]: `postgresql://approved_router:secret@approved.example.test:5432/${DATABASE}${suffix}`,
            [PRODUCTION_MODE_ROLE_VARIABLE]: AUDITOR,
          },
          APPROVED_TARGET,
        ).mode,
      ).toBe("refused");
    }
  });

  it("refuses when both modes are configured", () => {
    const resolved = resolveCoverageAuditConfiguration(
      {
        [ISOLATED_MODE_VARIABLE]: "postgresql://u@127.0.0.1:5432/x_test",
        [PRODUCTION_MODE_URL_VARIABLE]: "postgresql://a@h/db",
        [PRODUCTION_MODE_ROLE_VARIABLE]: AUDITOR,
      },
      APPROVED_TARGET,
    );

    expect(resolved.mode).toBe("refused");
    expect(resolved).toMatchObject({
      reason: expect.stringContaining("mutually exclusive"),
    });
  });

  it("refuses when neither mode is configured", () => {
    expect(resolveCoverageAuditMode({}).mode).toBe("refused");
    expect(
      resolveCoverageAuditMode({
        [ISOLATED_MODE_VARIABLE]: "   ",
        [PRODUCTION_MODE_URL_VARIABLE]: "",
      }).mode,
    ).toBe("refused");
  });

  it("refuses production mode without an expected role", () => {
    const resolved = resolveCoverageAuditConfiguration(
      {
        [PRODUCTION_MODE_URL_VARIABLE]: "postgresql://a@h/db",
      },
      APPROVED_TARGET,
    );

    expect(resolved.mode).toBe("refused");
    expect(resolved).toMatchObject({
      reason: expect.stringContaining(PRODUCTION_MODE_ROLE_VARIABLE),
    });
  });

  it("never falls back from production mode to the isolated path", () => {
    const resolved = resolveCoverageAuditConfiguration(
      {
        [PRODUCTION_MODE_URL_VARIABLE]: "postgresql://a@h/db",
        [PRODUCTION_MODE_ROLE_VARIABLE]: "",
      },
      APPROVED_TARGET,
    );

    expect(resolved.mode).toBe("refused");
  });

  it("resolves the approved target before importing or constructing a database client", () => {
    const source = readFileSync(
      new URL(
        "../scripts/verify-production-bonus-coverage.ts",
        import.meta.url,
      ),
      "utf8",
    );
    const resolveIndex = source.indexOf(
      "const selected = resolveCoverageAuditMode(process.env);",
    );
    const databaseImportIndex = source.indexOf(
      'const database = await import("@savvyedge/database");',
    );
    const initialProofIndex = source.indexOf(
      "proof = await proveAuthorizedReadOnlyConnection(",
    );
    const scanIndex = source.indexOf("await scanProductionBonusCoverage({");

    expect(resolveIndex).toBeGreaterThanOrEqual(0);
    expect(databaseImportIndex).toBeGreaterThan(resolveIndex);
    expect(initialProofIndex).toBeGreaterThan(databaseImportIndex);
    expect(scanIndex).toBeGreaterThan(initialProofIndex);
    expect(source).toContain("selected.authorization");
    expect(source).toContain('mode: "production-readonly" as const');
  });
});

describe("production-mode fatal error sanitization", () => {
  /** Everything a leaked Prisma error could plausibly carry. */
  const SECRETS = {
    url: "postgresql://savvyedge_coverage_auditor:hunter2@db.example.test:5432/synthetic_test?sslmode=require",
    password: "hunter2",
    bonusId: "d3cfix-bonus-compliant",
    evidenceId: "evidence-active-d3cfix-bonus-compliant",
    sourceUrl: "https://real-operator.example.com/bonus/welcome?utm_source=x",
    queryParam: "cursor=d3cfix-bonus-stale",
  };

  function sensitiveError(): Error {
    const error = new Error(
      `Invalid \`prisma.bonus.findMany()\` invocation: ${SECRETS.url} ` +
        `params=[${SECRETS.bonusId}, ${SECRETS.evidenceId}] ` +
        `${SECRETS.sourceUrl} ${SECRETS.queryParam}`,
    );
    error.name = "PrismaClientKnownRequestError";
    (error as Record<string, unknown>).meta = {
      target: SECRETS.bonusId,
      source_url: SECRETS.sourceUrl,
      datasource: SECRETS.url,
    };
    (error as Record<string, unknown>).clientVersion = "5.22.0";
    error.stack = `PrismaClientKnownRequestError: ${SECRETS.url}\n  at query (${SECRETS.sourceUrl})`;
    return error;
  }

  it("emits only a fixed message plus the error class", () => {
    expect(productionFatalMessage(sensitiveError())).toBe(
      "Production bonus coverage audit failed (PrismaClientKnownRequestError). " +
        "Diagnostic details are suppressed in production-readonly mode.",
    );
  });

  it.each(Object.entries(SECRETS))("never leaks the %s", (_label, secret) => {
    const message = productionFatalMessage(sensitiveError());
    expect(message).not.toContain(secret);
  });

  it("leaks nothing when the class name itself is weaponized", () => {
    const error = new Error("boom");
    // A crafted name must not become an exfiltration channel.
    error.name = `Error ${SECRETS.url} ${SECRETS.bonusId}`;

    const message = productionFatalMessage(error);

    expect(safeErrorCategory(error)).toBe("UnknownError");
    expect(message).not.toContain(SECRETS.url);
    expect(message).not.toContain(SECRETS.bonusId);
    expect(message).toContain("(UnknownError)");
  });

  it.each([
    ["a plain string throw", "postgresql://user:pw@host/db"],
    ["a thrown object", { message: "postgresql://user:pw@host/db" }],
    ["null", null],
    ["undefined", undefined],
  ])("categorizes %s as UnknownError without echoing it", (_label, thrown) => {
    expect(safeErrorCategory(thrown)).toBe("UnknownError");
    expect(productionFatalMessage(thrown)).not.toContain("postgresql://");
  });

  it("preserves ordinary Prisma class names", () => {
    for (const name of [
      "PrismaClientKnownRequestError",
      "PrismaClientInitializationError",
      "PrismaClientValidationError",
    ]) {
      const error = new Error("detail");
      error.name = name;
      expect(safeErrorCategory(error)).toBe(name);
    }
  });
});
