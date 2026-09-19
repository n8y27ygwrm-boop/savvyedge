import { PublicationStatus, ReviewStatus } from "@savvyedge/database";
import { describe, expect, it, vi } from "vitest";
import { runUkgcLicenseBootstrap } from "../src/services/ukgc-license-bootstrap.service";

const CASINO_ID = "20000000-0000-4000-8000-000000000001";

function preflightDatabase(
  websiteUrl: string | null = "https://casino.example",
) {
  return {
    casino: {
      findUnique: vi.fn().mockResolvedValue({
        id: CASINO_ID,
        website_url: websiteUrl,
        review_status: ReviewStatus.APPROVED,
        publication_status: PublicationStatus.UNPUBLISHED,
      }),
      findMany: vi
        .fn()
        .mockResolvedValue([{ id: CASINO_ID, website_url: websiteUrl }]),
    },
    license: { count: vi.fn().mockResolvedValue(0) },
    $transaction: vi.fn(),
  };
}

function successfulPersistenceConnectionProof() {
  return vi.fn().mockResolvedValue({
    proven: true,
    role: "savvy_test_ukgc_bootstrap_operator",
    databaseName: "savvyedge_ukgc_target_test",
  });
}

describe("UKGC License bootstrap preflight", () => {
  it("is non-mutating and never fetches or invokes the verifier", async () => {
    const database = preflightDatabase();
    const fetcher = vi.fn();
    const verifier = vi.fn();
    const provePersistenceConnection = successfulPersistenceConnectionProof();

    const result = await runUkgcLicenseBootstrap(
      { casinoId: CASINO_ID },
      {
        database: database as never,
        fetcher,
        provePersistenceConnection,
        verifier,
      },
    );

    expect(result).toMatchObject({ mode: "PREFLIGHT", status: "READY" });
    expect(database.$transaction).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    expect(provePersistenceConnection).not.toHaveBeenCalled();
    expect(verifier).not.toHaveBeenCalled();
  });

  it.each([
    [null, "CASINO_WEBSITE_MISSING"],
    ["javascript:alert(1)", "CASINO_WEBSITE_INVALID"],
  ])("rejects unusable stored website data", async (websiteUrl, status) => {
    const database = preflightDatabase(websiteUrl);
    const fetcher = vi.fn();
    const verifier = vi.fn();

    const result = await runUkgcLicenseBootstrap(
      { casinoId: CASINO_ID, execute: true },
      {
        database: database as never,
        fetcher,
        provePersistenceConnection: successfulPersistenceConnectionProof(),
        verifier,
      },
    );

    expect(result.status).toBe(status);
    expect(database.$transaction).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    expect(verifier).not.toHaveBeenCalled();
  });

  it("stops before authoritative retrieval when a License already exists", async () => {
    const database = preflightDatabase("javascript:later-invalid()");
    database.license.count.mockResolvedValue(1);
    const fetcher = vi.fn();
    const verifier = vi.fn();

    const result = await runUkgcLicenseBootstrap(
      { casinoId: CASINO_ID, execute: true },
      {
        database: database as never,
        fetcher,
        provePersistenceConnection: successfulPersistenceConnectionProof(),
        verifier,
      },
    );

    expect(result).toMatchObject({
      mode: "EXECUTE",
      status: "EXISTING_LICENSE",
      existingLicenseCount: 1,
    });
    expect(database.$transaction).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    expect(verifier).not.toHaveBeenCalled();
  });

  it.each([
    [
      "the same stored domain",
      "https://casino.example",
      "https://casino.example/path",
    ],
    [
      "canonically equivalent stored domains",
      "https://www.CASINO.example.:443/promotions",
      "http://casino.example/terms",
    ],
  ])(
    "keeps the row lock, existence recheck, and verifier in one transaction for %s",
    async (_case, initialWebsiteUrl, lockedWebsiteUrl) => {
      const database = preflightDatabase(initialWebsiteUrl);
      const transaction = {
        $queryRaw: vi.fn().mockResolvedValue([{ id: CASINO_ID }]),
        casino: {
          findUnique: vi.fn().mockResolvedValue({
            id: CASINO_ID,
            website_url: lockedWebsiteUrl,
            review_status: ReviewStatus.APPROVED,
            publication_status: PublicationStatus.UNPUBLISHED,
          }),
          findMany: vi
            .fn()
            .mockResolvedValue([
              { id: CASINO_ID, website_url: lockedWebsiteUrl },
            ]),
        },
        license: {
          count: vi.fn().mockResolvedValue(0),
          findMany: vi.fn().mockResolvedValue([
            {
              id: "license-1",
              review_status: ReviewStatus.AWAITING_REVIEW,
            },
          ]),
        },
      };
      database.$transaction.mockImplementation(
        async (operation: (tx: typeof transaction) => Promise<unknown>) =>
          operation(transaction),
      );
      const fetcher = vi.fn().mockResolvedValue({
        domainsCsv: "domains",
        businessesCsv: "businesses",
        licencesCsv: "licences",
      });
      const verifier = vi.fn().mockResolvedValue({
        verified: true,
        licenseId: "license-1",
        reviewStatus: ReviewStatus.AWAITING_REVIEW,
      });
      const provePersistenceConnection = successfulPersistenceConnectionProof();

      const result = await runUkgcLicenseBootstrap(
        { casinoId: CASINO_ID, execute: true },
        {
          database: database as never,
          fetcher,
          provePersistenceConnection,
          verifier,
        },
      );

      expect(result).toMatchObject({
        status: "BOOTSTRAPPED",
        reviewStatus: ReviewStatus.AWAITING_REVIEW,
      });
      expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
      expect(database.$transaction).toHaveBeenCalledTimes(1);
      expect(provePersistenceConnection).toHaveBeenCalledWith(transaction);
      expect(
        provePersistenceConnection.mock.invocationCallOrder[0],
      ).toBeLessThan(transaction.$queryRaw.mock.invocationCallOrder[0]);
      expect(verifier).toHaveBeenCalledTimes(1);
      const verifierInput = verifier.mock.calls[0][0];
      expect(verifierInput).toMatchObject({
        casinoId: CASINO_ID,
        domain: "casino.example",
        db: transaction,
      });
      expect(verifierInput).not.toHaveProperty("humanActorId");
      expect(verifierInput).not.toHaveProperty("diagnosticAccountOverride");
    },
  );

  it("stops before the Casino lock and verifier when the persistence connection is refused", async () => {
    const database = preflightDatabase("https://casino.example");
    const transaction = {
      $queryRaw: vi.fn(),
      casino: { findUnique: vi.fn(), findMany: vi.fn() },
      license: { count: vi.fn() },
    };
    database.$transaction.mockImplementation(
      async (operation: (tx: typeof transaction) => Promise<unknown>) =>
        operation(transaction),
    );
    const fetcher = vi.fn().mockResolvedValue({
      domainsCsv: "domains",
      businessesCsv: "businesses",
      licencesCsv: "licences",
    });
    const verifier = vi.fn();

    const result = await runUkgcLicenseBootstrap(
      { casinoId: CASINO_ID, execute: true },
      {
        database: database as never,
        fetcher,
        provePersistenceConnection: vi.fn().mockResolvedValue({
          proven: false,
          failedCheck: "CURRENT_ROLE",
          reason: "The persistence connection was refused.",
        }),
        verifier,
      },
    );

    expect(result).toEqual({
      mode: "EXECUTE",
      status: "CONNECTION_REFUSED",
      casinoId: CASINO_ID,
      failedCheck: "CURRENT_ROLE",
    });
    expect(transaction.$queryRaw).not.toHaveBeenCalled();
    expect(transaction.casino.findUnique).not.toHaveBeenCalled();
    expect(verifier).not.toHaveBeenCalled();
  });

  it("fails closed before verification when the locked domain differs from the pre-fetch domain", async () => {
    const database = preflightDatabase("https://domain-x.example");
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: CASINO_ID }]),
      casino: {
        findUnique: vi.fn().mockResolvedValue({
          id: CASINO_ID,
          website_url: "https://domain-y.example",
          review_status: ReviewStatus.APPROVED,
          publication_status: PublicationStatus.UNPUBLISHED,
        }),
        findMany: vi
          .fn()
          .mockResolvedValue([
            { id: CASINO_ID, website_url: "https://domain-y.example" },
          ]),
      },
      license: { count: vi.fn().mockResolvedValue(0) },
    };
    database.$transaction.mockImplementation(
      async (operation: (tx: typeof transaction) => Promise<unknown>) =>
        operation(transaction),
    );
    const fetcher = vi.fn().mockResolvedValue({
      domainsCsv: "domains",
      businessesCsv: "businesses",
      licencesCsv: "licences",
    });
    const verifier = vi.fn();

    const result = await runUkgcLicenseBootstrap(
      { casinoId: CASINO_ID, execute: true },
      {
        database: database as never,
        fetcher,
        provePersistenceConnection: successfulPersistenceConnectionProof(),
        verifier,
      },
    );

    expect(result).toEqual({
      mode: "EXECUTE",
      status: "CASINO_DOMAIN_CHANGED",
      casinoId: CASINO_ID,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
    expect(transaction.casino.findUnique).toHaveBeenCalledTimes(1);
    expect(verifier).not.toHaveBeenCalled();
  });
});
