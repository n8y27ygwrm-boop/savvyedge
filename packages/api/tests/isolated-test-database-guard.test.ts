import { describe, expect, it } from "vitest";
import {
  evaluateConfigurableIsolatedTestDatabase,
  evaluateIsolatedTestDatabase,
  isApprovedIsolatedTestDatabase,
  requireConfiguredIsolatedTestDatabase,
  requireIsolatedTestDatabase,
  UnsafeTestDatabaseError,
  type IsolatedTestDatabaseUrls,
} from "./helpers/isolated-test-database-guard";
import { isApprovedBonusIdentityTestDatabase } from "./helpers/bonus-identity-test-database-guard";

// Synthetic credentials only: nothing here resolves to a real database.
const SAFE_URL =
  "postgresql://guard_user:guard_password@localhost:5432/savvyedge_test?schema=public&sslmode=disable";

function urls(
  overrides: Partial<IsolatedTestDatabaseUrls> = {},
): IsolatedTestDatabaseUrls {
  return {
    DATABASE_URL: SAFE_URL,
    DIRECT_URL: SAFE_URL,
    PHASE2_WORKFLOW_TEST_DATABASE_URL: SAFE_URL,
    ...overrides,
  };
}

describe("Isolated destructive-test database guard", () => {
  describe("explicit opt-in", () => {
    it("disables the suite when the opt-in variable is absent", () => {
      const decision = evaluateIsolatedTestDatabase(
        urls({ PHASE2_WORKFLOW_TEST_DATABASE_URL: undefined }),
      );

      expect(decision.status).toBe("disabled");
      expect(isApprovedIsolatedTestDatabase(urls({ PHASE2_WORKFLOW_TEST_DATABASE_URL: undefined }))).toBe(false);
    });

    it("disables the suite when the opt-in variable is blank", () => {
      expect(
        evaluateIsolatedTestDatabase(
          urls({ PHASE2_WORKFLOW_TEST_DATABASE_URL: "   " }),
        ).status,
      ).toBe("disabled");
    });

    it("never treats DATABASE_URL alone as permission to run", () => {
      const decision = evaluateIsolatedTestDatabase({
        DATABASE_URL: SAFE_URL,
        DIRECT_URL: SAFE_URL,
      });

      expect(decision.status).toBe("disabled");
    });

    it("enables the suite when every required URL proves the same isolated target", () => {
      const decision = evaluateIsolatedTestDatabase(urls());

      expect(decision).toEqual({
        status: "enabled",
        hostname: "localhost",
        databaseName: "savvyedge_test",
      });
    });

    it.each(["DATABASE_URL", "DIRECT_URL"] as const)(
      "fails loudly rather than skipping when %s is missing alongside the opt-in",
      (name) => {
        const decision = evaluateIsolatedTestDatabase(
          urls({ [name]: undefined }),
        );

        expect(decision.status).toBe("unsafe");
        expect(decision.status === "unsafe" && decision.reason).toContain(name);
      },
    );
  });

  describe("hosted and production targets", () => {
    it.each([
      [
        "Neon",
        "postgresql://guard_user:guard_password@ep-fake-branch-123456.eu-central-1.aws.neon.tech:5432/savvyedge_test?sslmode=require",
      ],
      [
        "Supabase",
        "postgresql://guard_user:guard_password@db.fakeprojectref.supabase.co:5432/savvyedge_test?sslmode=require",
      ],
      [
        "Supabase pooler",
        "postgresql://guard_user:guard_password@aws-0-eu-central-1.pooler.supabase.com:6543/savvyedge_test?pgbouncer=true",
      ],
    ])("rejects a hosted %s hostname", (_label, hostedUrl) => {
      const decision = evaluateIsolatedTestDatabase(
        urls({
          DATABASE_URL: hostedUrl,
          DIRECT_URL: hostedUrl,
          PHASE2_WORKFLOW_TEST_DATABASE_URL: hostedUrl,
        }),
      );

      expect(decision.status).toBe("unsafe");
      expect(decision.status === "unsafe" && decision.reason).toContain(
        "not loopback",
      );
    });

    it.each([
      ["default postgres database", "postgres"],
      ["bare product database", "savvyedge"],
      ["explicit production database", "savvyedge_production"],
      ["explicit prod database", "savvyedge_prod"],
      ["staging database", "savvyedge_staging"],
      ["test-named production database", "savvyedge_test_prod"],
      ["name that only contains test inside another word", "savvyedge_latest"],
    ])("rejects a %s name", (_label, databaseName) => {
      const url = `postgresql://guard_user:guard_password@localhost:5432/${databaseName}?schema=public&sslmode=disable`;
      const decision = evaluateIsolatedTestDatabase({
        DATABASE_URL: url,
        DIRECT_URL: url,
        PHASE2_WORKFLOW_TEST_DATABASE_URL: url,
      });

      expect(decision.status).toBe("unsafe");
    });
  });

  describe("malformed and ambiguous URLs", () => {
    it.each([
      ["malformed URL", "not-a-url"],
      ["empty authority", "postgresql://"],
      [
        "unsupported protocol",
        "mysql://guard_user:guard_password@localhost:5432/savvyedge_test",
      ],
      [
        "missing database name",
        "postgresql://guard_user:guard_password@localhost:5432/?schema=public",
      ],
      [
        "missing user",
        "postgresql://localhost:5432/savvyedge_test?schema=public",
      ],
      [
        "malformed percent-encoding",
        "postgresql://guard_user:guard_password@localhost:5432/savvyedge%zz_test",
      ],
      [
        "ambiguous fragment",
        "postgresql://guard_user:guard_password@localhost:5432/savvyedge_test?schema=public#fragment",
      ],
      [
        "duplicated parameter",
        "postgresql://guard_user:guard_password@localhost:5432/savvyedge_test?schema=public&schema=private",
      ],
      [
        "unrecognized parameter",
        "postgresql://guard_user:guard_password@localhost:5432/savvyedge_test?schema=public&unknown_option=1",
      ],
    ])("rejects a %s in the opt-in variable", (_label, badUrl) => {
      const decision = evaluateIsolatedTestDatabase(
        urls({
          DATABASE_URL: badUrl,
          DIRECT_URL: badUrl,
          PHASE2_WORKFLOW_TEST_DATABASE_URL: badUrl,
        }),
      );

      expect(decision.status).toBe("unsafe");
    });
  });

  describe("target-overriding query parameters", () => {
    it.each([
      "host=db.internal.example.com",
      "hostaddr=10.0.0.7",
      "port=6543",
      "dbname=savvyedge",
      "database=savvyedge",
      "user=postgres",
      "username=postgres",
      "password=elsewhere",
      "service=production",
      "servicefile=/etc/pgservice.conf",
      "socket=/var/run/postgresql",
    ])("rejects a URL whose '%s' parameter can redirect the target", (param) => {
      const overridingUrl = `postgresql://guard_user:guard_password@localhost:5432/savvyedge_test?schema=public&${param}`;
      const decision = evaluateIsolatedTestDatabase(
        urls({
          DATABASE_URL: overridingUrl,
          DIRECT_URL: overridingUrl,
          PHASE2_WORKFLOW_TEST_DATABASE_URL: overridingUrl,
        }),
      );

      expect(decision.status).toBe("unsafe");
      expect(decision.status === "unsafe" && decision.reason).toContain(
        "override the connection target",
      );
    });
  });

  describe("effective-target agreement", () => {
    const MISMATCHES: Array<[string, string]> = [
      [
        "database",
        "postgresql://guard_user:guard_password@localhost:5432/other_test?schema=public&sslmode=disable",
      ],
      [
        "port",
        "postgresql://guard_user:guard_password@localhost:5433/savvyedge_test?schema=public&sslmode=disable",
      ],
      [
        "user",
        "postgresql://other_user:guard_password@localhost:5432/savvyedge_test?schema=public&sslmode=disable",
      ],
      [
        "password",
        "postgresql://guard_user:other_password@localhost:5432/savvyedge_test?schema=public&sslmode=disable",
      ],
      [
        "schema",
        "postgresql://guard_user:guard_password@localhost:5432/savvyedge_test?schema=private&sslmode=disable",
      ],
      [
        "search_path override in options",
        "postgresql://guard_user:guard_password@localhost:5432/savvyedge_test?schema=public&sslmode=disable&options=-c%20search_path%3Dprivate",
      ],
    ];

    it.each(MISMATCHES)(
      "rejects a DATABASE_URL that differs by %s",
      (_label, differingUrl) => {
        const decision = evaluateIsolatedTestDatabase(
          urls({ DATABASE_URL: differingUrl }),
        );

        expect(decision.status).toBe("unsafe");
        expect(decision.status === "unsafe" && decision.reason).toContain(
          "DATABASE_URL",
        );
      },
    );

    it.each(MISMATCHES)(
      "rejects a DIRECT_URL that differs by %s",
      (_label, differingUrl) => {
        const decision = evaluateIsolatedTestDatabase(
          urls({ DIRECT_URL: differingUrl }),
        );

        expect(decision.status).toBe("unsafe");
        expect(decision.status === "unsafe" && decision.reason).toContain(
          "DIRECT_URL",
        );
      },
    );
  });

  describe("documented comparison contract", () => {
    it("treats an omitted port as the default 5432", () => {
      expect(
        isApprovedIsolatedTestDatabase(
          urls({
            DIRECT_URL:
              "postgresql://guard_user:guard_password@localhost/savvyedge_test?schema=public&sslmode=disable",
          }),
        ),
      ).toBe(true);
    });

    it("treats query parameter order as insignificant", () => {
      expect(
        isApprovedIsolatedTestDatabase(
          urls({
            DIRECT_URL:
              "postgresql://guard_user:guard_password@localhost:5432/savvyedge_test?sslmode=disable&schema=public",
          }),
        ),
      ).toBe(true);
    });

    it("accepts the postgres: alias only when every URL uses it", () => {
      const postgresAlias =
        "postgres://guard_user:guard_password@localhost:5432/savvyedge_test?schema=public&sslmode=disable";

      expect(
        isApprovedIsolatedTestDatabase({
          DATABASE_URL: postgresAlias,
          DIRECT_URL: postgresAlias,
          PHASE2_WORKFLOW_TEST_DATABASE_URL: postgresAlias,
        }),
      ).toBe(true);
      expect(isApprovedIsolatedTestDatabase(urls({ DIRECT_URL: postgresAlias }))).toBe(false);
    });

    it.each([
      "postgresql://guard_user:guard_password@127.0.0.1:5432/savvyedge_test?schema=public&sslmode=disable",
      "postgresql://guard_user:guard_password@[::1]:5432/savvyedge_test?schema=public&sslmode=disable",
    ])("does not alias localhost with the loopback address %s", (loopbackUrl) => {
      expect(isApprovedIsolatedTestDatabase(urls({ DIRECT_URL: loopbackUrl }))).toBe(false);
    });

    it("compares parameter names case-sensitively", () => {
      expect(
        isApprovedIsolatedTestDatabase(
          urls({
            DIRECT_URL:
              "postgresql://guard_user:guard_password@localhost:5432/savvyedge_test?SCHEMA=public&sslmode=disable",
          }),
        ),
      ).toBe(false);
    });

    it("distinguishes an explicit empty password from an absent password", () => {
      expect(
        isApprovedIsolatedTestDatabase({
          DATABASE_URL:
            "postgresql://guard_user:@localhost:5432/savvyedge_test?schema=public",
          DIRECT_URL:
            "postgresql://guard_user@localhost:5432/savvyedge_test?schema=public",
          PHASE2_WORKFLOW_TEST_DATABASE_URL:
            "postgresql://guard_user:@localhost:5432/savvyedge_test?schema=public",
        }),
      ).toBe(false);
    });
  });

  describe("requireIsolatedTestDatabase", () => {
    it("returns false without the explicit opt-in", () => {
      expect(
        requireIsolatedTestDatabase({
          DATABASE_URL: SAFE_URL,
          DIRECT_URL: SAFE_URL,
        }),
      ).toBe(false);
    });

    it("returns true for a proven isolated target", () => {
      expect(requireIsolatedTestDatabase({ ...urls() })).toBe(true);
    });

    it("throws instead of silently skipping when the opt-in points at a hosted database", () => {
      const hosted =
        "postgresql://guard_user:guard_password@db.fakeprojectref.supabase.co:5432/savvyedge_test?sslmode=require";

      expect(() =>
        requireIsolatedTestDatabase({
          DATABASE_URL: hosted,
          DIRECT_URL: hosted,
          PHASE2_WORKFLOW_TEST_DATABASE_URL: hosted,
        }),
      ).toThrow(UnsafeTestDatabaseError);
    });

    it("throws when the opt-in disagrees with the active Prisma target", () => {
      expect(() =>
        requireIsolatedTestDatabase({
          ...urls({
            DATABASE_URL:
              "postgresql://guard_user:guard_password@db.fakeprojectref.supabase.co:5432/savvyedge_test?sslmode=require",
          }),
        }),
      ).toThrow(/DATABASE_URL/);
    });
  });

  describe("bonus-identity backward compatibility", () => {
    it("keeps accepting a proven isolated target", () => {
      expect(isApprovedBonusIdentityTestDatabase(urls())).toBe(true);
    });

    it.each(["DATABASE_URL", "DIRECT_URL", "PHASE2_WORKFLOW_TEST_DATABASE_URL"] as const)(
      "keeps rejecting a missing %s",
      (name) => {
        expect(isApprovedBonusIdentityTestDatabase(urls({ [name]: undefined }))).toBe(false);
      },
    );
  });
});


/**
 * The configurable form backs the suites whose opt-in variable and connection
 * targets differ from the `PHASE2_WORKFLOW_TEST_DATABASE_URL` contract. Every
 * URL below is synthetic: nothing here resolves to a real database.
 */
describe("Configurable destructive-test database guard", () => {
  const OPT_IN = "SNAPSHOT_REPROCESSING_TEST_DATABASE_URL";
  const RUNTIME_TARGETS = ["DATABASE_URL", "DIRECT_URL"] as const;
  const SECRET = "guard_password";

  const env = (
    overrides: Record<string, string | undefined> = {},
  ): Record<string, string | undefined> => ({
    [OPT_IN]: SAFE_URL,
    DATABASE_URL: SAFE_URL,
    DIRECT_URL: SAFE_URL,
    ...overrides,
  });

  describe("explicit opt-in", () => {
    it.each([
      ["absent", undefined],
      ["blank", "   "],
    ])("stays disabled when its chosen opt-in is %s", (_label, optInValue) => {
      const decision = evaluateConfigurableIsolatedTestDatabase({
        optInVariable: OPT_IN,
        targets: RUNTIME_TARGETS,
        env: env({ [OPT_IN]: optInValue }),
      });

      expect(decision.status).toBe("disabled");
      expect(decision.optInVariable).toBe(OPT_IN);
      expect(decision.status === "disabled" && decision.reason).toContain(
        OPT_IN,
      );
    });

    it("reads a different opt-in variable than the default contract", () => {
      const decision = evaluateConfigurableIsolatedTestDatabase({
        optInVariable: "PHASE2_TEST_DATABASE_URL",
        env: {
          PHASE2_WORKFLOW_TEST_DATABASE_URL: SAFE_URL,
          PHASE2_TEST_DATABASE_URL: undefined,
        },
      });

      expect(decision.status).toBe("disabled");
    });
  });

  describe("safe configurations", () => {
    it("validates a single explicit URL without requiring unrelated variables", () => {
      const decision = evaluateConfigurableIsolatedTestDatabase({
        optInVariable: "PHASE2_TEST_DATABASE_URL",
        env: { PHASE2_TEST_DATABASE_URL: SAFE_URL },
      });

      expect(decision).toEqual({
        status: "enabled",
        optInVariable: "PHASE2_TEST_DATABASE_URL",
        url: SAFE_URL,
        hostname: "localhost",
        databaseName: "savvyedge_test",
      });
    });

    it("enables a suite whose declared targets all match the opt-in", () => {
      const decision = evaluateConfigurableIsolatedTestDatabase({
        optInVariable: OPT_IN,
        targets: RUNTIME_TARGETS,
        env: env(),
      });

      expect(decision.status).toBe("enabled");
      expect(decision.status === "enabled" && decision.url).toBe(SAFE_URL);
      expect(decision.status === "enabled" && decision.databaseName).toBe(
        "savvyedge_test",
      );
    });

    it("returns the trimmed opt-in URL as the only URL a suite may use", () => {
      const decision = evaluateConfigurableIsolatedTestDatabase({
        optInVariable: OPT_IN,
        targets: RUNTIME_TARGETS,
        env: env({ [OPT_IN]: `  ${SAFE_URL}  ` }),
      });

      expect(decision.status === "enabled" && decision.url).toBe(SAFE_URL);
    });

    it("applies the documented normalizations to declared targets", () => {
      const decision = evaluateConfigurableIsolatedTestDatabase({
        optInVariable: OPT_IN,
        targets: RUNTIME_TARGETS,
        env: env({
          DIRECT_URL:
            "postgresql://guard_user:guard_password@localhost/savvyedge_test?sslmode=disable&schema=public",
        }),
      });

      expect(decision.status).toBe("enabled");
    });
  });

  describe("explicit but unsafe configurations", () => {
    it.each(RUNTIME_TARGETS)(
      "fails loudly rather than skipping when %s is missing after opt-in",
      (name) => {
        const decision = evaluateConfigurableIsolatedTestDatabase({
          optInVariable: OPT_IN,
          targets: RUNTIME_TARGETS,
          env: env({ [name]: undefined }),
        });

        expect(decision.status).toBe("unsafe");
        expect(decision.status === "unsafe" && decision.reason).toContain(name);
      },
    );

    it("rejects a declared target that resolves elsewhere", () => {
      const decision = evaluateConfigurableIsolatedTestDatabase({
        optInVariable: OPT_IN,
        targets: RUNTIME_TARGETS,
        env: env({
          DATABASE_URL:
            "postgresql://guard_user:guard_password@localhost:5432/other_test?schema=public&sslmode=disable",
        }),
      });

      expect(decision.status).toBe("unsafe");
      expect(decision.status === "unsafe" && decision.reason).toMatch(
        /DATABASE_URL resolves to a different effective database target/,
      );
    });

    it.each([
      [
        "Neon",
        "postgresql://guard_user:guard_password@ep-fake-branch-123456.eu-central-1.aws.neon.tech:5432/savvyedge_test?sslmode=require",
      ],
      [
        "Supabase",
        "postgresql://guard_user:guard_password@db.fakeprojectref.supabase.co:5432/savvyedge_test?sslmode=require",
      ],
    ])("rejects a hosted %s opt-in even with no other targets", (_l, hosted) => {
      const decision = evaluateConfigurableIsolatedTestDatabase({
        optInVariable: "PHASE2_TEST_DATABASE_URL",
        env: { PHASE2_TEST_DATABASE_URL: hosted },
      });

      expect(decision.status).toBe("unsafe");
      expect(decision.status === "unsafe" && decision.reason).toContain(
        "not loopback",
      );
    });

    it.each([
      ["malformed URL", "not-a-url"],
      ["unsupported protocol", "mysql://guard_user@localhost:5432/savvy_test"],
      [
        "missing database name",
        "postgresql://guard_user:guard_password@localhost:5432/?schema=public",
      ],
      [
        "malformed percent-encoding",
        "postgresql://guard_user:guard_password@localhost:5432/savvyedge%zz_test",
      ],
    ])("rejects a %s in a single-target suite", (_label, badUrl) => {
      const decision = evaluateConfigurableIsolatedTestDatabase({
        optInVariable: "PHASE2_TEST_DATABASE_URL",
        env: { PHASE2_TEST_DATABASE_URL: badUrl },
      });

      expect(decision.status).toBe("unsafe");
    });

    it.each([
      "host=db.internal.example.com",
      "hostaddr=10.0.0.7",
      "port=6543",
      "dbname=savvyedge",
      "user=postgres",
      "password=elsewhere",
      "service=production",
      "socket=/var/run/postgresql",
    ])("rejects a '%s' target-override parameter", (parameter) => {
      const overriding = `postgresql://guard_user:guard_password@localhost:5432/savvyedge_test?schema=public&${parameter}`;
      const decision = evaluateConfigurableIsolatedTestDatabase({
        optInVariable: "PHASE2_TEST_DATABASE_URL",
        env: { PHASE2_TEST_DATABASE_URL: overriding },
      });

      expect(decision.status).toBe("unsafe");
      expect(decision.status === "unsafe" && decision.reason).toContain(
        "override the connection target",
      );
    });

    it.each([
      ["bounded production token", "savvyedge_test_production"],
      ["bounded prod token", "prod_test"],
      ["bounded staging token", "savvyedge_staging_test"],
      ["no bounded test marker", "savvyedge_latest"],
      ["default postgres database", "postgres"],
    ])("rejects a database named with a %s", (_label, databaseName) => {
      const decision = evaluateConfigurableIsolatedTestDatabase({
        optInVariable: "PHASE2_TEST_DATABASE_URL",
        env: {
          PHASE2_TEST_DATABASE_URL: `postgresql://guard_user:guard_password@localhost:5432/${databaseName}?schema=public`,
        },
      });

      expect(decision.status).toBe("unsafe");
    });

    it("never exposes a password or a whole connection string in its reason", () => {
      const unsafeUrls = [
        "postgresql://guard_user:guard_password@db.fakeprojectref.supabase.co:5432/savvyedge_test?sslmode=require",
        "postgresql://guard_user:guard_password@localhost:5432/savvyedge_production?schema=public",
        "postgresql://guard_user:guard_password@localhost:5432/savvyedge_test?schema=public&host=db.internal.example.com",
        "mysql://guard_user:guard_password@localhost:5432/savvyedge_test",
      ];

      for (const unsafeUrl of unsafeUrls) {
        const decision = evaluateConfigurableIsolatedTestDatabase({
          optInVariable: OPT_IN,
          targets: RUNTIME_TARGETS,
          env: env({
            [OPT_IN]: unsafeUrl,
            DATABASE_URL: unsafeUrl,
            DIRECT_URL: unsafeUrl,
          }),
        });

        expect(decision.status).toBe("unsafe");
        const reason = decision.status === "unsafe" ? decision.reason : "";
        expect(reason).not.toContain(SECRET);
        expect(reason).not.toContain(unsafeUrl);
        expect(reason).not.toMatch(/postgres(ql)?:\/\//);
      }
    });

    it("keeps mismatch reasons free of credentials", () => {
      const decision = evaluateConfigurableIsolatedTestDatabase({
        optInVariable: OPT_IN,
        targets: RUNTIME_TARGETS,
        env: env({
          DIRECT_URL:
            "postgresql://other_user:other_secret@localhost:5432/savvyedge_test?schema=public&sslmode=disable",
        }),
      });

      const reason = decision.status === "unsafe" ? decision.reason : "";
      expect(decision.status).toBe("unsafe");
      expect(reason).not.toContain(SECRET);
      expect(reason).not.toContain("other_secret");
      expect(reason).not.toMatch(/postgres(ql)?:\/\//);
    });
  });

  describe("requireConfiguredIsolatedTestDatabase", () => {
    it("returns a disabled decision without the explicit opt-in", () => {
      expect(
        requireConfiguredIsolatedTestDatabase({
          optInVariable: OPT_IN,
          targets: RUNTIME_TARGETS,
          env: env({ [OPT_IN]: undefined }),
        }).status,
      ).toBe("disabled");
    });

    it("returns the validated decision for a proven isolated target", () => {
      const decision = requireConfiguredIsolatedTestDatabase({
        optInVariable: OPT_IN,
        targets: RUNTIME_TARGETS,
        env: env(),
      });

      expect(decision.status).toBe("enabled");
      expect(decision.status === "enabled" && decision.url).toBe(SAFE_URL);
    });

    it.each([
      [
        "hosted opt-in",
        {
          [OPT_IN]:
            "postgresql://guard_user:guard_password@db.fakeprojectref.supabase.co:5432/savvyedge_test?sslmode=require",
        },
      ],
      ["missing runtime target", { DIRECT_URL: undefined }],
      [
        "mismatched runtime target",
        {
          DATABASE_URL:
            "postgresql://guard_user:guard_password@localhost:5433/savvyedge_test?schema=public&sslmode=disable",
        },
      ],
    ])("throws instead of skipping on a %s", (_label, overrides) => {
      expect(() =>
        requireConfiguredIsolatedTestDatabase({
          optInVariable: OPT_IN,
          targets: RUNTIME_TARGETS,
          env: env(overrides),
        }),
      ).toThrow(UnsafeTestDatabaseError);
    });
  });

  describe("legacy contract compatibility", () => {
    it("matches the default entry point for the same inputs", () => {
      const configurable = evaluateConfigurableIsolatedTestDatabase({
        optInVariable: "PHASE2_WORKFLOW_TEST_DATABASE_URL",
        targets: RUNTIME_TARGETS,
        env: {
          PHASE2_WORKFLOW_TEST_DATABASE_URL: SAFE_URL,
          DATABASE_URL: SAFE_URL,
          DIRECT_URL: SAFE_URL,
        },
      });

      expect(evaluateIsolatedTestDatabase(urls())).toEqual({
        status: "enabled",
        hostname: configurable.status === "enabled" && configurable.hostname,
        databaseName:
          configurable.status === "enabled" && configurable.databaseName,
      });
    });

    it("ignores ambient variables for the legacy URL-object entry point", () => {
      const previous = process.env.PHASE2_WORKFLOW_TEST_DATABASE_URL;
      process.env.PHASE2_WORKFLOW_TEST_DATABASE_URL = SAFE_URL;
      try {
        expect(
          evaluateIsolatedTestDatabase({
            DATABASE_URL: SAFE_URL,
            DIRECT_URL: SAFE_URL,
          }).status,
        ).toBe("disabled");
      } finally {
        if (previous === undefined) {
          delete process.env.PHASE2_WORKFLOW_TEST_DATABASE_URL;
        } else {
          process.env.PHASE2_WORKFLOW_TEST_DATABASE_URL = previous;
        }
      }
    });
  });
});
