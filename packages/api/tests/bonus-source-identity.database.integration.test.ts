import { randomUUID } from "node:crypto";
import {
  Prisma,
  PublicationStatus,
  ReviewStatus,
  prisma,
} from "@savvyedge/database";
import { afterEach, describe, expect, it } from "vitest";
import { BonusService } from "../src/services/bonus.service";
import { IngestionService } from "../src/services/ingestion.service";
import { createBonusSourceOfferKey } from "../src/utils/bonus-source-identity";
import { isApprovedBonusIdentityTestDatabase } from "./helpers/bonus-identity-test-database-guard";

const isIsolatedLocalDatabase = isApprovedBonusIdentityTestDatabase({
  DATABASE_URL: process.env.DATABASE_URL,
  DIRECT_URL: process.env.DIRECT_URL,
  PHASE2_WORKFLOW_TEST_DATABASE_URL:
    process.env.PHASE2_WORKFLOW_TEST_DATABASE_URL,
});
const describeWithIsolatedDatabase = isIsolatedLocalDatabase
  ? describe.sequential
  : describe.skip;

const runId = randomUUID().replace(/-/g, "").slice(0, 12);
let fixtureCasinoIds: string[] = [];

function input(casinoId: string) {
  return {
    casino_id: casinoId,
    type: "WELCOME",
    headline_value: "100% up to £200",
    wagering_requirement: 35,
    max_conversion: 500,
    valid_from: new Date("2026-08-01T00:00:00.000Z"),
    valid_until: new Date("2026-09-01T00:00:00.000Z"),
    status: "ACTIVE",
  };
}

async function createCasino(slug: string) {
  const uniqueSlug = `${slug}-${runId}-${randomUUID().slice(0, 8)}`;
  const casino = await prisma.casino.create({
    data: {
      slug: uniqueSlug,
      name: uniqueSlug,
      status: "ACTIVE",
      website_url: `https://${uniqueSlug}.example.com`,
      review_status: ReviewStatus.NEW,
      publication_status: PublicationStatus.UNPUBLISHED,
    },
  });
  fixtureCasinoIds.push(casino.id);
  return casino;
}

describeWithIsolatedDatabase(
  "Bonus source identity database constraints",
  () => {
    afterEach(async () => {
      const casinoIds = fixtureCasinoIds;
      fixtureCasinoIds = [];
      if (casinoIds.length === 0) return;
      await prisma.bonus.deleteMany({
        where: { casino_id: { in: casinoIds } },
      });
      await prisma.casino.deleteMany({ where: { id: { in: casinoIds } } });
    });

    it("enforces composite uniqueness for a casino and non-null source key", async () => {
      const casino = await createCasino("identity-unique-test");
      const sourceOfferKey = createBonusSourceOfferKey(
        "https://identity-unique-test.example.com/promotion",
      );
      const data = {
        ...input(casino.id),
        source_offer_key: sourceOfferKey,
      };

      await prisma.bonus.create({ data });
      await expect(prisma.bonus.create({ data })).rejects.toMatchObject({
        code: "P2002",
      });
      expect(
        await prisma.bonus.count({
          where: { casino_id: casino.id, source_offer_key: sourceOfferKey },
        }),
      ).toBe(1);
    });

    it("retries concurrent same-source ingestion and returns one identified Bonus", async () => {
      const casino = await createCasino("identity-concurrency-test");
      const provenance = {
        sourceUrl:
          "https://identity-concurrency-test.example.com/go/welcome?utm_source=test",
        sourceIdentityUrl:
          "https://identity-concurrency-test.example.com/promotions/welcome",
      };
      const run = () =>
        (
          IngestionService as unknown as {
            runGovernedPersistenceTransaction: <T>(
              callback: (tx: Prisma.TransactionClient) => Promise<T>,
            ) => Promise<T>;
          }
        ).runGovernedPersistenceTransaction((tx) =>
          BonusService.saveGovernedBonus(input(casino.id), provenance, tx),
        );

      const [left, right] = await Promise.all([run(), run()]);

      expect(left.bonus.id).toBe(right.bonus.id);
      expect(
        await prisma.bonus.count({
          where: {
            casino_id: casino.id,
            source_offer_key: createBonusSourceOfferKey(
              provenance.sourceIdentityUrl,
            ),
          },
        }),
      ).toBe(1);
    });

    it("keeps concurrent different-source offers isolated", async () => {
      const casino = await createCasino("identity-concurrent-offers-test");
      const sourceUrls = [
        "https://identity-concurrent-offers-test.example.com/promotions/welcome",
        "https://identity-concurrent-offers-test.example.com/promotions/free-spins",
      ];
      const run = (sourceIdentityUrl: string) =>
        (
          IngestionService as unknown as {
            runGovernedPersistenceTransaction: <T>(
              callback: (tx: Prisma.TransactionClient) => Promise<T>,
            ) => Promise<T>;
          }
        ).runGovernedPersistenceTransaction((tx) =>
          BonusService.saveGovernedBonus(
            input(casino.id),
            { sourceUrl: sourceIdentityUrl, sourceIdentityUrl },
            tx,
          ),
        );

      const [left, right] = await Promise.all(sourceUrls.map(run));

      expect(left.bonus.id).not.toBe(right.bonus.id);
      expect(
        await prisma.bonus.findMany({
          where: { casino_id: casino.id },
          select: { source_offer_key: true },
        }),
      ).toEqual(
        expect.arrayContaining(
          sourceUrls.map((url) => ({
            source_offer_key: createBonusSourceOfferKey(url),
          })),
        ),
      );
    });
  },
);
