import { describe, expect, it } from "vitest";
import { isApprovedBonusIdentityTestDatabase } from "./helpers/bonus-identity-test-database-guard";

const safeUrl =
  "postgresql://identity_user:identity_password@localhost:5432/savvyedge_test?schema=public&sslmode=disable";

function urls(overrides: Partial<Record<string, string | undefined>> = {}) {
  return {
    DATABASE_URL: safeUrl,
    DIRECT_URL: safeUrl,
    PHASE2_WORKFLOW_TEST_DATABASE_URL: safeUrl,
    ...overrides,
  };
}

describe("Bonus identity database-test connection guard", () => {
  it("accepts three equivalent explicit localhost test targets without connecting", () => {
    expect(
      isApprovedBonusIdentityTestDatabase(
        urls({
          DIRECT_URL:
            "postgresql://identity_user:identity_password@localhost/savvyedge_test?sslmode=disable&schema=public",
        }),
      ),
    ).toBe(true);
  });

  it.each([
    [
      "username",
      "postgresql://other_user:identity_password@localhost:5432/savvyedge_test?schema=public&sslmode=disable",
    ],
    [
      "password",
      "postgresql://identity_user:other_password@localhost:5432/savvyedge_test?schema=public&sslmode=disable",
    ],
    [
      "schema",
      "postgresql://identity_user:identity_password@localhost:5432/savvyedge_test?schema=private&sslmode=disable",
    ],
    [
      "options/search_path",
      "postgresql://identity_user:identity_password@localhost:5432/savvyedge_test?schema=public&sslmode=disable&options=-c%20search_path%3Dprivate",
    ],
    [
      "other query option",
      "postgresql://identity_user:identity_password@localhost:5432/savvyedge_test?schema=public&sslmode=require",
    ],
    [
      "database",
      "postgresql://identity_user:identity_password@localhost:5432/other_test?schema=public&sslmode=disable",
    ],
    [
      "port",
      "postgresql://identity_user:identity_password@localhost:5433/savvyedge_test?schema=public&sslmode=disable",
    ],
  ])("rejects a differing %s", (_label, differingUrl) => {
    expect(
      isApprovedBonusIdentityTestDatabase(
        urls({ DIRECT_URL: differingUrl }),
      ),
    ).toBe(false);
  });

  it("distinguishes an explicit empty password from no password", () => {
    const explicitEmptyPassword =
      "postgresql://identity_user:@localhost:5432/savvyedge_test?schema=public";
    const absentPassword =
      "postgresql://identity_user@localhost:5432/savvyedge_test?schema=public";

    expect(
      isApprovedBonusIdentityTestDatabase({
        DATABASE_URL: explicitEmptyPassword,
        DIRECT_URL: absentPassword,
        PHASE2_WORKFLOW_TEST_DATABASE_URL: explicitEmptyPassword,
      }),
    ).toBe(false);
  });

  it.each([
    "postgresql://identity_user:identity_password@127.0.0.1:5432/savvyedge_test?schema=public&sslmode=disable",
    "postgresql://identity_user:identity_password@[::1]:5432/savvyedge_test?schema=public&sslmode=disable",
  ])("does not equate localhost with %s", (differingHostUrl) => {
    expect(
      isApprovedBonusIdentityTestDatabase(
        urls({ DIRECT_URL: differingHostUrl }),
      ),
    ).toBe(false);
  });

  it.each(["DATABASE_URL", "DIRECT_URL", "PHASE2_WORKFLOW_TEST_DATABASE_URL"])(
    "rejects a missing %s",
    (name) => {
      expect(
        isApprovedBonusIdentityTestDatabase(urls({ [name]: undefined })),
      ).toBe(false);
    },
  );

  it.each([
    ["malformed URL", "not-a-url"],
    [
      "unsupported protocol",
      "mysql://identity_user:identity_password@localhost:5432/savvyedge_test",
    ],
    [
      "non-test database",
      "postgresql://identity_user:identity_password@localhost:5432/savvyedge_prod?schema=public&sslmode=disable",
    ],
    [
      "ambiguous database name containing test only as part of another word",
      "postgresql://identity_user:identity_password@localhost:5432/savvyedge_latest?schema=public&sslmode=disable",
    ],
    [
      "duplicate parameter",
      "postgresql://identity_user:identity_password@localhost:5432/savvyedge_test?schema=public&schema=private",
    ],
    [
      "case-ambiguous duplicate parameter",
      "postgresql://identity_user:identity_password@localhost:5432/savvyedge_test?schema=public&SCHEMA=private",
    ],
    [
      "target-overriding parameter",
      "postgresql://identity_user:identity_password@localhost:5432/savvyedge_test?schema=public&host=remote.example.com",
    ],
    [
      "unsupported parameter",
      "postgresql://identity_user:identity_password@localhost:5432/savvyedge_test?schema=public&unknown_option=value",
    ],
    [
      "case-different parameter name",
      "postgresql://identity_user:identity_password@localhost:5432/savvyedge_test?SCHEMA=public&sslmode=disable",
    ],
  ])("rejects a %s", (_label, unsafeUrl) => {
    expect(
      isApprovedBonusIdentityTestDatabase(
        urls({ DIRECT_URL: unsafeUrl }),
      ),
    ).toBe(false);
  });
});
