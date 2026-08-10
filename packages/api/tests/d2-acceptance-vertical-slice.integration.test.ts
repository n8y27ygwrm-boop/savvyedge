import { describe, expect, it } from "vitest";
import {
  isD2AcceptanceEnabled,
  validateD2DatabaseUrl,
} from "./helpers/d2-acceptance-database-guard";

describe("D2 Acceptance Harness Database Guard", () => {
  it("rejects empty, undefined, or malformed database URLs", () => {
    expect(validateD2DatabaseUrl("").safe).toBe(false);
    expect(validateD2DatabaseUrl(undefined).safe).toBe(false);
    expect(validateD2DatabaseUrl("not-a-valid-url").safe).toBe(false);
    expect(validateD2DatabaseUrl("http://localhost:5432/savvyedge_test").safe).toBe(false);
    expect(validateD2DatabaseUrl("mysql://localhost:3306/savvyedge_test").safe).toBe(false);
  });

  it("rejects cloud / remote hosts outside loopback", () => {
    expect(
      validateD2DatabaseUrl("postgresql://postgres:secret@db.example.com:5432/savvyedge_test").safe,
    ).toBe(false);
    expect(
      validateD2DatabaseUrl("postgresql://postgres:secret@192.168.1.50:5432/savvyedge_test").safe,
    ).toBe(false);
    expect(
      validateD2DatabaseUrl("postgresql://postgres:secret@aws.rds.amazonaws.com:5432/savvyedge_test").safe,
    ).toBe(false);
  });

  it("rejects unsafe, root, or production/staging database names", () => {
    // Exact unsafe root names
    expect(validateD2DatabaseUrl("postgresql://postgres:pass@localhost:5432/savvy").safe).toBe(false);
    expect(validateD2DatabaseUrl("postgresql://postgres:pass@localhost:5432/savvyedge").safe).toBe(false);
    expect(validateD2DatabaseUrl("postgresql://postgres:pass@localhost:5432/postgres").safe).toBe(false);

    // Hardened token deny checks
    expect(validateD2DatabaseUrl("postgresql://postgres:pass@localhost:5432/production_test").safe).toBe(false);
    expect(validateD2DatabaseUrl("postgresql://postgres:pass@localhost:5432/staging-test").safe).toBe(false);
    expect(validateD2DatabaseUrl("postgresql://postgres:pass@localhost:5432/savvyedge_production_d2").safe).toBe(false);
    expect(validateD2DatabaseUrl("postgresql://postgres:pass@localhost:5432/prod_database").safe).toBe(false);
    expect(validateD2DatabaseUrl("postgresql://postgres:pass@localhost:5432/staging_db").safe).toBe(false);
    expect(validateD2DatabaseUrl("postgresql://postgres:pass@localhost:5432/unrelated_db").safe).toBe(false);
  });

  it("rejects target override parameters in search params", () => {
    expect(
      validateD2DatabaseUrl(
        "postgresql://postgres:pass@localhost:5432/savvyedge_test?host=remote.db.com",
      ).safe,
    ).toBe(false);
    expect(
      validateD2DatabaseUrl(
        "postgresql://postgres:pass@localhost:5432/savvyedge_test?database=production",
      ).safe,
    ).toBe(false);
  });

  it("accepts valid isolated local test/pilot database URLs on loopback hosts", () => {
    const valid1 = validateD2DatabaseUrl(
      "postgresql://postgres:postgres@localhost:5432/savvyedge_d1_pilot",
    );
    expect(valid1.safe).toBe(true);
    expect(valid1.databaseName).toBe("savvyedge_d1_pilot");

    const valid2 = validateD2DatabaseUrl(
      "postgresql://postgres:pass@localhost:5432/savvyedge_d2_pilot",
    );
    expect(valid2.safe).toBe(true);
    expect(valid2.databaseName).toBe("savvyedge_d2_pilot");

    const valid3 = validateD2DatabaseUrl(
      "postgresql://postgres:pass@127.0.0.1:5432/savvyedge_test",
    );
    expect(valid3.safe).toBe(true);
    expect(valid3.databaseName).toBe("savvyedge_test");

    const valid4 = validateD2DatabaseUrl(
      "postgresql://postgres:pass@[::1]:5432/d2_pilot",
    );
    expect(valid4.safe).toBe(true);
    expect(valid4.databaseName).toBe("d2_pilot");
  });
});

describe("executeD2AcceptanceRunner Safety Enforcement", () => {
  it("fails closed when SAVVYEDGE_D2_ACCEPTANCE is missing or not 1", async () => {
    const originalFlag = process.env.SAVVYEDGE_D2_ACCEPTANCE;
    try {
      delete process.env.SAVVYEDGE_D2_ACCEPTANCE;
      const { executeD2AcceptanceRunner } = await import("./helpers/d2-vertical-slice.runner");
      await expect(executeD2AcceptanceRunner()).rejects.toThrow(
        /SAVVYEDGE_D2_ACCEPTANCE=1 is required/,
      );
    } finally {
      if (originalFlag !== undefined) {
        process.env.SAVVYEDGE_D2_ACCEPTANCE = originalFlag;
      } else {
        delete process.env.SAVVYEDGE_D2_ACCEPTANCE;
      }
    }
  });
});

const isEnabled = isD2AcceptanceEnabled();
const testSuite = isEnabled ? describe.sequential : describe.skip;

testSuite("D2 End-to-End Vertical-Slice Acceptance Runner (Real DB)", () => {
  it("executes all 11 stages and passes complete end-to-end vertical slice", async () => {
    const safety = validateD2DatabaseUrl(process.env.DATABASE_URL);
    if (!safety.safe) {
      throw new Error(`[D2 SAFETY HARD FAIL] ${safety.reason}`);
    }

    const { executeD2AcceptanceRunner } = await import("./helpers/d2-vertical-slice.runner");
    const result = await executeD2AcceptanceRunner();

    expect(result.success).toBe(true);
    expect(result.stagesCompleted).toBe(11);
    expect(result.casinoId).toBeDefined();
    expect(result.bonusId).toBeDefined();
    expect(result.licenseId).toBeDefined();
  });
});
