import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  ActorKind,
  BonusEvidenceField,
  EvidenceType,
  EvidenceVerdict,
  Prisma,
  prisma,
} from "@savvyedge/database";
import { bonusExtractionKey } from "@savvyedge/ai-agents/extraction-contract";
import { IngestionService } from "../src/services/ingestion.service";
import { isExtractionKeyUniqueViolation } from "../src/utils/extraction-identity";

const disposableDatabaseUrl =
  process.env.SNAPSHOT_REPROCESSING_TEST_DATABASE_URL;
const realDbEnabled = Boolean(disposableDatabaseUrl);

describe.runIf(realDbEnabled)(
  "snapshot reprocessing PostgreSQL release gate",
  () => {
    it("enforces identity, pointer, rollback, concurrency, and loser lifecycle", async () => {
      if (
        !disposableDatabaseUrl ||
        process.env.DATABASE_URL !== disposableDatabaseUrl
      ) {
        throw new Error(
          "SNAPSHOT_REPROCESSING_TEST_DATABASE_URL must equal DATABASE_URL",
        );
      }

      const dataSourceId = randomUUID();
      const actorId = randomUUID();
      const casinoId = randomUUID();
      const bonusIds = [randomUUID(), randomUUID()];
      const scrapeJobIds = [randomUUID(), randomUUID(), randomUUID()];
      const locator = `disposable/${randomUUID()}.html`;
      const htmlHash = "a".repeat(64);
      const contentHash = "b".repeat(64);
      const observedAt = new Date("2026-08-20T11:18:16.311Z");
      const extractionKey = bonusExtractionKey({
        snapshotLocator: locator,
        htmlHash,
        contentHash,
      });

      try {
        await prisma.dataSource.create({
          data: {
            id: dataSourceId,
            url: `https://disposable-${dataSourceId}.example.test/promo`,
            source_type: "CASINO_PROMOTION_PAGE",
          },
        });
        await prisma.reviewActor.create({
          data: {
            id: actorId,
            kind: ActorKind.SERVICE,
            stable_key: `test:snapshot-reprocessing:${actorId}`,
            display_name: "Disposable snapshot reprocessing test",
          },
        });
        await prisma.casino.create({
          data: {
            id: casinoId,
            slug: `disposable-${casinoId}`,
            name: "Disposable Casino",
            status: "ACTIVE",
          },
        });
        await prisma.bonus.createMany({
          data: bonusIds.map((id, index) => ({
            id,
            casino_id: casinoId,
            type: "FREE_SPINS",
            headline_value: `${10 + index} free spins`,
            status: "ACTIVE",
            source_offer_key: `disposable:${id}`,
          })),
        });
        await prisma.scrapeJob.createMany({
          data: scrapeJobIds.map((id) => ({
            id,
            data_source_id: dataSourceId,
            status: "PROCESSING",
            snapshot_path: locator,
            html_hash: htmlHash,
            content_hash: contentHash,
          })),
        });

        const pointerForeignKeys = await prisma.$queryRaw<
          Array<{ name: string }>
        >`
        SELECT conname AS name
        FROM pg_constraint
        WHERE conrelid = '"ActiveExtractionPointer"'::regclass
          AND contype = 'f'
        ORDER BY conname
      `;
        expect(pointerForeignKeys.map((constraint) => constraint.name)).toEqual(
          [
            "ActiveExtractionPointer_bonus_id_fkey",
            "ActiveExtractionPointer_data_source_id_fkey",
            "ActiveExtractionPointer_evidence_id_fkey",
          ],
        );

        let waiting = 0;
        let releaseBarrier!: () => void;
        const barrier = new Promise<void>((resolve) => {
          releaseBarrier = resolve;
        });

        const persistContender = async (
          scrapeJobId: string,
          bonusId: string,
        ) => {
          for (let attempt = 1; attempt <= 3; attempt += 1) {
            try {
              return await prisma.$transaction(
                async (tx) => {
                  await tx.scrapeJob.findUniqueOrThrow({
                    where: { id: scrapeJobId },
                    select: { id: true },
                  });
                  if (attempt === 1) {
                    waiting += 1;
                    if (waiting === 2) releaseBarrier();
                    await barrier;
                  }

                  const evidence = await tx.evidenceRecord.create({
                    data: {
                      data_source_id: dataSourceId,
                      scrape_job_id: scrapeJobId,
                      evidence_type: EvidenceType.OPERATOR_PAGE,
                      source_url: `https://disposable-${dataSourceId}.example.test/promo`,
                      snapshot_path: locator,
                      html_hash: htmlHash,
                      content_hash: contentHash,
                      extraction_key: extractionKey,
                      observed_at: observedAt,
                      extracted_at: new Date(),
                      created_by_id: actorId,
                    },
                  });
                  await tx.bonusEvidenceClaim.create({
                    data: {
                      evidence_id: evidence.id,
                      bonus_id: bonusId,
                      field: BonusEvidenceField.HEADLINE_VALUE,
                      observed_value: "10 free spins",
                      normalized_value_hash: "normalizer-v1:test",
                      verdict: EvidenceVerdict.SUPPORTS,
                    },
                  });
                  await tx.activeExtractionPointer.create({
                    data: {
                      bonus_id: bonusId,
                      data_source_id: dataSourceId,
                      extraction_context: "BONUS",
                      evidence_id: evidence.id,
                      extraction_key: extractionKey,
                      contract_version: "extraction-v2",
                    },
                  });
                  await tx.scrapeJob.update({
                    where: { id: scrapeJobId },
                    data: { status: "COMPLETED", completed_at: new Date() },
                  });
                  return { evidenceId: evidence.id, bonusId, scrapeJobId };
                },
                {
                  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
                  maxWait: 5_000,
                  timeout: 15_000,
                },
              );
            } catch (error) {
              const retryable =
                error instanceof Prisma.PrismaClientKnownRequestError &&
                error.code === "P2034";
              if (retryable && attempt < 3) continue;
              throw error;
            }
          }
          throw new Error("contender exhausted retry budget");
        };

        const contenders = await Promise.allSettled([
          persistContender(scrapeJobIds[0], bonusIds[0]),
          persistContender(scrapeJobIds[1], bonusIds[1]),
        ]);
        const winner = contenders.find(
          (
            result,
          ): result is PromiseFulfilledResult<{
            evidenceId: string;
            bonusId: string;
            scrapeJobId: string;
          }> => result.status === "fulfilled",
        );
        const loser = contenders.find(
          (result): result is PromiseRejectedResult =>
            result.status === "rejected",
        );
        expect(winner).toBeDefined();
        expect(loser).toBeDefined();
        expect(isExtractionKeyUniqueViolation(loser!.reason)).toBe(true);

        const losingScrapeJobId = scrapeJobIds.find(
          (id) => id !== winner!.value.scrapeJobId && id !== scrapeJobIds[2],
        )!;
        expect(
          await prisma.evidenceRecord.count({
            where: {
              data_source_id: dataSourceId,
              extraction_key: extractionKey,
            },
          }),
        ).toBe(1);
        expect(
          await prisma.scrapeJob.findUniqueOrThrow({
            where: { id: losingScrapeJobId },
            select: { status: true },
          }),
        ).toEqual({ status: "PROCESSING" });

        await (
          IngestionService as unknown as {
            reconcileDeduplicatedExtraction(id: string): Promise<void>;
          }
        ).reconcileDeduplicatedExtraction(losingScrapeJobId);

        expect(
          await prisma.scrapeJob.findUniqueOrThrow({
            where: { id: losingScrapeJobId },
            select: { status: true },
          }),
        ).toEqual({ status: "COMPLETED" });
        const activeWinner = await prisma.activeExtractionPointer.findUnique({
          where: {
            bonus_id_extraction_context: {
              bonus_id: winner!.value.bonusId,
              extraction_context: "BONUS",
            },
          },
        });
        expect(activeWinner?.evidence_id).toBe(winner!.value.evidenceId);

        const performExtraction = vi.spyOn(
          IngestionService as unknown as {
            performExtraction(input: unknown): Promise<unknown>;
          },
          "performExtraction",
        );
        await IngestionService.handleExtraction({
          scrapeJobId: losingScrapeJobId,
          url: `https://disposable-${dataSourceId}.example.test/promo`,
          scrapedContent: "10 free spins",
          observedAt: observedAt.toISOString(),
        });
        expect(performExtraction).not.toHaveBeenCalled();
        performExtraction.mockRestore();

        const otherBonusId = bonusIds.find(
          (id) => id !== winner!.value.bonusId,
        )!;
        await prisma.bonusEvidenceClaim.create({
          data: {
            evidence_id: winner!.value.evidenceId,
            bonus_id: otherBonusId,
            field: BonusEvidenceField.HEADLINE_VALUE,
            observed_value: "11 free spins",
            normalized_value_hash: "normalizer-v1:test-other",
            verdict: EvidenceVerdict.SUPPORTS,
          },
        });
        await prisma.activeExtractionPointer.create({
          data: {
            bonus_id: otherBonusId,
            data_source_id: dataSourceId,
            extraction_context: "BONUS",
            evidence_id: winner!.value.evidenceId,
            extraction_key: extractionKey,
            contract_version: "extraction-v2",
          },
        });
        expect(
          await prisma.activeExtractionPointer.count({
            where: { evidence_id: winner!.value.evidenceId },
          }),
        ).toBe(2);
        await expect(
          prisma.activeExtractionPointer.create({
            data: {
              bonus_id: otherBonusId,
              data_source_id: dataSourceId,
              extraction_context: "BONUS",
              evidence_id: winner!.value.evidenceId,
              extraction_key: extractionKey,
              contract_version: "extraction-v2",
            },
          }),
        ).rejects.toMatchObject({ code: "P2002" });

        const secondLocator = `disposable/${randomUUID()}.html`;
        const secondExtractionKey = bonusExtractionKey({
          snapshotLocator: secondLocator,
          htmlHash,
          contentHash,
        });
        expect(secondExtractionKey).not.toBe(extractionKey);
        await prisma.evidenceRecord.create({
          data: {
            data_source_id: dataSourceId,
            scrape_job_id: scrapeJobIds[2],
            evidence_type: EvidenceType.OPERATOR_PAGE,
            source_url: `https://disposable-${dataSourceId}.example.test/promo`,
            snapshot_path: secondLocator,
            html_hash: htmlHash,
            content_hash: contentHash,
            extraction_key: secondExtractionKey,
            observed_at: new Date(observedAt.getTime() + 1_000),
            extracted_at: new Date(),
            created_by_id: actorId,
          },
        });
        expect(
          await prisma.evidenceRecord.count({
            where: { data_source_id: dataSourceId, content_hash: contentHash },
          }),
        ).toBe(2);

        const rolledBackKey = bonusExtractionKey({
          snapshotLocator: `disposable/${randomUUID()}.html`,
          htmlHash,
          contentHash,
        });
        await expect(
          prisma.$transaction(async (tx) => {
            const rolledBackEvidence = await tx.evidenceRecord.create({
              data: {
                data_source_id: dataSourceId,
                evidence_type: EvidenceType.OPERATOR_PAGE,
                source_url: `https://disposable-${dataSourceId}.example.test/promo`,
                snapshot_path: "disposable/rollback.html",
                html_hash: htmlHash,
                content_hash: contentHash,
                extraction_key: rolledBackKey,
                observed_at: observedAt,
                extracted_at: new Date(),
                created_by_id: actorId,
              },
            });
            await tx.activeExtractionPointer.create({
              data: {
                bonus_id: randomUUID(),
                data_source_id: dataSourceId,
                extraction_context: "BONUS",
                evidence_id: rolledBackEvidence.id,
                extraction_key: rolledBackKey,
                contract_version: "extraction-v2",
              },
            });
          }),
        ).rejects.toBeDefined();
        expect(
          await prisma.evidenceRecord.count({
            where: {
              data_source_id: dataSourceId,
              extraction_key: rolledBackKey,
            },
          }),
        ).toBe(0);
      } finally {
        vi.restoreAllMocks();
        await prisma.activeExtractionPointer.deleteMany({
          where: { bonus_id: { in: bonusIds } },
        });
        await prisma.bonusEvidenceClaim.deleteMany({
          where: { bonus_id: { in: bonusIds } },
        });
        await prisma.evidenceRecord.deleteMany({
          where: { data_source_id: dataSourceId },
        });
        await prisma.scrapeJob.deleteMany({
          where: { id: { in: scrapeJobIds } },
        });
        await prisma.bonus.deleteMany({ where: { id: { in: bonusIds } } });
        await prisma.casino.deleteMany({ where: { id: casinoId } });
        await prisma.dataSource.deleteMany({ where: { id: dataSourceId } });
        await prisma.reviewActor.deleteMany({ where: { id: actorId } });
      }
    });
  },
);
