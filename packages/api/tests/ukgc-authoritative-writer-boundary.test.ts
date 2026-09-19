import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import * as publicApi from "../src";
import { UkgcLicenseVerifierService } from "../src/services/ukgc-license-verifier.service";

const DATASETS = {
  domainsCsv: "Account Number,Domain Name,Status\n910001,casino.example,Active",
  businessesCsv:
    "Account Number,Licence Account Name\n910001,Boundary Test Operator",
  licencesCsv:
    "Account Number,Licence Number,Status,Type,Activity,Start Date,End Date\n" +
    "910001,0910001-R-000001-001,Active,Remote,Casino,2020-01-01,",
};

describe("UKGC authoritative writer boundary", () => {
  it("exposes only the guarded bootstrap as an operational package command", () => {
    const packageRoot = fileURLToPath(new URL("..", import.meta.url));
    const packageJson = JSON.parse(
      readFileSync(`${packageRoot}/package.json`, "utf8"),
    );
    const bootstrapScript = readFileSync(
      `${packageRoot}/scripts/bootstrap-ukgc-license.ts`,
      "utf8",
    );

    expect(packageJson.scripts["verify:ukgc"]).toBe(
      "tsx scripts/bootstrap-ukgc-license.ts",
    );
    expect(bootstrapScript).toContain("proveUkgcBootstrapWriteConnection(");
    expect(bootstrapScript).not.toContain("proveReadOnlyConnection(");
    expect(existsSync(`${packageRoot}/scripts/verify-ukgc-license.ts`)).toBe(
      false,
    );
    expect("UkgcLicenseVerifierService" in publicApi).toBe(false);
  });

  it("refuses a direct root Prisma client before authoritative persistence", async () => {
    const ambientRootClient = {
      $connect: vi.fn(),
      $disconnect: vi.fn(),
      $transaction: vi.fn().mockResolvedValue({
        verified: true,
        licenseId: "ambient-write",
      }),
    };
    const fetcher = vi.fn().mockResolvedValue(DATASETS);

    await expect(
      UkgcLicenseVerifierService.verifyCasinoLicense({
        casinoId: "casino-1",
        domain: "casino.example",
        fetcher,
        db: ambientRootClient as never,
      }),
    ).rejects.toThrow(
      "UKGC_AUTHORITATIVE_PERSISTENCE_REQUIRES_GUARDED_TRANSACTION",
    );

    expect(fetcher).not.toHaveBeenCalled();
    expect(ambientRootClient.$transaction).not.toHaveBeenCalled();
  });
});
