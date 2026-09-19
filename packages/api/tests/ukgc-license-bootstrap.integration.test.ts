import { randomUUID } from "node:crypto";
import {
  GovernedSubjectType,
  PublicationStatus,
  ReviewStatus,
  WorkflowEventType,
  prisma,
} from "@savvyedge/database";
import { describe, expect, it, vi } from "vitest";
import {
  inspectUkgcLicenseBootstrapTarget,
  runUkgcLicenseBootstrap,
} from "../src/services/ukgc-license-bootstrap.service";
import type { UkgcDatasets } from "../src/services/ukgc-parser";
import { requireIsolatedTestDatabase } from "./helpers/isolated-test-database-guard";

const describeWithIsolatedDatabase = requireIsolatedTestDatabase()
  ? describe
  : describe.skip;

function deterministicDatasets(
  domain: string,
  account = "910001",
  licenseNumber = "0910001-R-000001-001",
): UkgcDatasets {
  return {
    domainsCsv: `Account Number,Domain Name,Status\n${account},${domain},Active`,
    businessesCsv: `Account Number,Licence Account Name\n${account},Deterministic Operator`,
    licencesCsv:
      "Account Number,Licence Number,Status,Type,Activity,Start Date,End Date\n" +
      `${account},${licenseNumber},Active,Remote,Casino,2020-01-01,`,
  };
}

async function createCasino(websiteUrl: string | null) {
  const id = randomUUID();
  return prisma.casino.create({
    data: {
      id,
      slug: `ukgc-bootstrap-${id}`,
      name: "UKGC Bootstrap Test Casino",
      website_url: websiteUrl,
      status: "ACTIVE",
      review_status: ReviewStatus.APPROVED,
      publication_status: PublicationStatus.UNPUBLISHED,
      governance_version: 1,
    },
  });
}

async function proveTestPersistenceConnection() {
  return {
    proven: true as const,
    role: "savvy_test_admin",
    databaseName: "savvyedge_ukgc_integration_test",
  };
}

describeWithIsolatedDatabase(
  "guarded UKGC License bootstrap (isolated database)",
  () => {
    it("creates the first governed License and stops at AWAITING_REVIEW", async () => {
      const domain = `${randomUUID()}.example.test`;
      const casino = await createCasino(`https://${domain}/promotions`);
      const result = await runUkgcLicenseBootstrap(
        { casinoId: casino.id, execute: true },
        {
          database: prisma,
          fetcher: async () => deterministicDatasets(domain),
          provePersistenceConnection: proveTestPersistenceConnection,
        },
      );

      expect(result).toMatchObject({
        mode: "EXECUTE",
        status: "BOOTSTRAPPED",
        casinoId: casino.id,
        reviewStatus: ReviewStatus.AWAITING_REVIEW,
      });

      const licenses = await prisma.license.findMany({
        where: { casino_id: casino.id },
        include: {
          evidence_claims: true,
          workflow_events: { include: { actor: true, evidence_claims: true } },
        },
      });
      expect(licenses).toHaveLength(1);
      expect(licenses[0]).toMatchObject({
        status: "ACTIVE",
        review_status: ReviewStatus.AWAITING_REVIEW,
        governance_version: 1,
        quarantine_reason: null,
        duplicate_of_id: null,
      });
      expect(licenses[0].evidence_claims).toHaveLength(4);
      expect(licenses[0].workflow_events).toHaveLength(1);
      expect(licenses[0].workflow_events[0]).toMatchObject({
        subject_type: GovernedSubjectType.LICENSE,
        event_type: WorkflowEventType.REVIEW_REQUESTED,
        to_review_status: ReviewStatus.AWAITING_REVIEW,
      });
      expect(licenses[0].workflow_events[0].actor.kind).toBe("SERVICE");
      expect(licenses[0].workflow_events[0].evidence_claims).toHaveLength(4);

      const persistedCasino = await prisma.casino.findUniqueOrThrow({
        where: { id: casino.id },
      });
      expect(persistedCasino.review_status).toBe(ReviewStatus.APPROVED);
      expect(persistedCasino.publication_status).toBe(
        PublicationStatus.UNPUBLISHED,
      );
    });

    it("rejects missing, invalid, and ambiguous stored Casino websites before verification", async () => {
      const missing = await createCasino(null);
      const invalid = await createCasino("javascript:alert(1)");
      const sharedDomain = `${randomUUID()}.example.test`;
      const ambiguousA = await createCasino(`https://${sharedDomain}`);
      await createCasino(`https://www.${sharedDomain}/other`);
      const fetcher = vi.fn();

      await expect(
        runUkgcLicenseBootstrap(
          { casinoId: missing.id, execute: true },
          {
            database: prisma,
            fetcher,
            provePersistenceConnection: proveTestPersistenceConnection,
          },
        ),
      ).resolves.toMatchObject({ status: "CASINO_WEBSITE_MISSING" });
      await expect(
        runUkgcLicenseBootstrap(
          { casinoId: invalid.id, execute: true },
          {
            database: prisma,
            fetcher,
            provePersistenceConnection: proveTestPersistenceConnection,
          },
        ),
      ).resolves.toMatchObject({ status: "CASINO_WEBSITE_INVALID" });
      await expect(
        inspectUkgcLicenseBootstrapTarget(prisma, ambiguousA.id),
      ).resolves.toMatchObject({ status: "CASINO_DOMAIN_AMBIGUOUS" });
      expect(fetcher).not.toHaveBeenCalled();
    });

    it("makes repeated execution a no-op with no new evidence", async () => {
      const domain = `${randomUUID()}.example.test`;
      const casino = await createCasino(`https://${domain}`);
      const fetcher = vi.fn(async () => deterministicDatasets(domain));

      const first = await runUkgcLicenseBootstrap(
        { casinoId: casino.id, execute: true },
        {
          database: prisma,
          fetcher,
          provePersistenceConnection: proveTestPersistenceConnection,
        },
      );
      expect(first.status).toBe("BOOTSTRAPPED");
      const license = await prisma.license.findFirstOrThrow({
        where: { casino_id: casino.id },
      });
      const evidenceBefore = await prisma.licenseEvidenceClaim.findMany({
        where: { license_id: license.id },
        select: { evidence_id: true },
      });
      const historyBefore = await prisma.casinoHistoryEvent.count({
        where: { casino_id: casino.id },
      });

      const second = await runUkgcLicenseBootstrap(
        { casinoId: casino.id, execute: true },
        {
          database: prisma,
          fetcher,
          provePersistenceConnection: proveTestPersistenceConnection,
        },
      );
      expect(second).toMatchObject({
        status: "EXISTING_LICENSE",
        existingLicenseCount: 1,
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
      await expect(
        prisma.licenseEvidenceClaim.count({
          where: { license_id: license.id },
        }),
      ).resolves.toBe(evidenceBefore.length);
      await expect(
        prisma.casinoHistoryEvent.count({ where: { casino_id: casino.id } }),
      ).resolves.toBe(historyBefore);
    });

    it("serializes concurrent attempts so only one bootstrap persists", async () => {
      const domain = `${randomUUID()}.example.test`;
      const casino = await createCasino(`https://${domain}`);
      const fetcher = async () => deterministicDatasets(domain);

      const results = await Promise.all([
        runUkgcLicenseBootstrap(
          { casinoId: casino.id, execute: true },
          {
            database: prisma,
            fetcher,
            provePersistenceConnection: proveTestPersistenceConnection,
          },
        ),
        runUkgcLicenseBootstrap(
          { casinoId: casino.id, execute: true },
          {
            database: prisma,
            fetcher,
            provePersistenceConnection: proveTestPersistenceConnection,
          },
        ),
      ]);

      expect(results.map((result) => result.status).sort()).toEqual([
        "BOOTSTRAPPED",
        "EXISTING_LICENSE",
      ]);
      const licenses = await prisma.license.findMany({
        where: { casino_id: casino.id },
        select: { id: true },
      });
      expect(licenses).toHaveLength(1);
      await expect(
        prisma.licenseEvidenceClaim.count({
          where: { license_id: licenses[0].id },
        }),
      ).resolves.toBe(4);
      await expect(
        prisma.workflowAuditEvent.count({
          where: {
            license_id: licenses[0].id,
            event_type: WorkflowEventType.REVIEW_REQUESTED,
          },
        }),
      ).resolves.toBe(1);
    });

    it("aborts without authoritative writes when the Casino domain changes during the fetch window", async () => {
      const initialDomain = `${randomUUID()}.example.test`;
      const changedDomain = `${randomUUID()}.example.test`;
      const casino = await createCasino(`https://${initialDomain}`);
      const before = await Promise.all([
        prisma.license.count(),
        prisma.evidenceRecord.count(),
        prisma.licenseEvidenceClaim.count(),
        prisma.workflowAuditEvent.count(),
        prisma.casinoHistoryEvent.count(),
      ]);
      let signalFetchStarted!: () => void;
      const fetchStarted = new Promise<void>((resolve) => {
        signalFetchStarted = resolve;
      });
      let releaseFetch!: () => void;
      const fetchReleased = new Promise<void>((resolve) => {
        releaseFetch = resolve;
      });
      const bootstrap = runUkgcLicenseBootstrap(
        { casinoId: casino.id, execute: true },
        {
          database: prisma,
          provePersistenceConnection: proveTestPersistenceConnection,
          fetcher: async () => {
            signalFetchStarted();
            await fetchReleased;
            return deterministicDatasets(initialDomain);
          },
        },
      );

      await fetchStarted;
      try {
        await prisma.casino.update({
          where: { id: casino.id },
          data: { website_url: `https://${changedDomain}` },
        });
      } finally {
        releaseFetch();
      }

      await expect(bootstrap).resolves.toEqual({
        mode: "EXECUTE",
        status: "CASINO_DOMAIN_CHANGED",
        casinoId: casino.id,
      });
      await expect(
        Promise.all([
          prisma.license.count(),
          prisma.evidenceRecord.count(),
          prisma.licenseEvidenceClaim.count(),
          prisma.workflowAuditEvent.count(),
          prisma.casinoHistoryEvent.count(),
        ]),
      ).resolves.toEqual(before);
      await expect(
        prisma.casino.findUniqueOrThrow({ where: { id: casino.id } }),
      ).resolves.toMatchObject({
        website_url: `https://${changedDomain}`,
        verified_at: null,
        review_status: ReviewStatus.APPROVED,
        publication_status: PublicationStatus.UNPUBLISHED,
      });
    });

    it("rolls back the complete bootstrap when authoritative verification fails", async () => {
      const domain = `${randomUUID()}.example.test`;
      const casino = await createCasino(`https://${domain}`);
      const unrelatedDomain = `${randomUUID()}.example.test`;
      const before = await Promise.all([
        prisma.license.count(),
        prisma.evidenceRecord.count(),
        prisma.licenseEvidenceClaim.count(),
        prisma.workflowAuditEvent.count(),
        prisma.casinoHistoryEvent.count(),
      ]);

      const result = await runUkgcLicenseBootstrap(
        { casinoId: casino.id, execute: true },
        {
          database: prisma,
          fetcher: async () => deterministicDatasets(unrelatedDomain),
          provePersistenceConnection: proveTestPersistenceConnection,
        },
      );

      expect(result).toMatchObject({
        status: "AUTHORITATIVE_VERIFICATION_FAILED",
        reason: "DOMAIN_NOT_FOUND",
      });
      await expect(
        prisma.license.count({ where: { casino_id: casino.id } }),
      ).resolves.toBe(0);
      await expect(
        prisma.casinoHistoryEvent.count({ where: { casino_id: casino.id } }),
      ).resolves.toBe(0);
      await expect(
        Promise.all([
          prisma.license.count(),
          prisma.evidenceRecord.count(),
          prisma.licenseEvidenceClaim.count(),
          prisma.workflowAuditEvent.count(),
          prisma.casinoHistoryEvent.count(),
        ]),
      ).resolves.toEqual(before);
    });
  },
);
