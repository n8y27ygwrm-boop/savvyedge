import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EvidenceVerdict, prisma } from "@savvyedge/database";
import { INGESTION_QUEUE_NAME } from "../src/constants/queue-names";
import { createBonusSourceOfferKey } from "../src/utils/bonus-source-identity";
import { BonusReverificationService } from "../src/services/bonus-reverification.service";
import { JobQueueService } from "../src/services/job-queue.service";
import {
  BONUS_REVERIFICATION_AGE_MS,
  BONUS_REVERIFICATION_BATCH_SIZE,
  BONUS_REVERIFICATION_COOLDOWN_MS,
  DEFAULT_BONUS_REVERIFICATION_INTERVAL_MS,
  OrchestratorService,
} from "../src/services/orchestrator.service";

const NOW = new Date("2026-08-11T12:00:00.000Z");
const SOURCE_URL = "https://operator.example.test/bonuses/welcome";

function candidate(id: string, sourceUrl = SOURCE_URL) {
  return {
    id,
    source_offer_key: createBonusSourceOfferKey(sourceUrl),
    evidence_claims: [
      {
        id: `claim-${id}`,
        verdict: EvidenceVerdict.SUPPORTS,
        created_at: new Date("2026-08-01T00:00:00.000Z"),
        evidence: {
          id: `evidence-${id}`,
          source_url: sourceUrl,
          observed_at: new Date("2026-08-01T00:00:00.000Z"),
          extracted_at: new Date("2026-08-01T00:00:01.000Z"),
        },
      },
    ],
    history_events: [],
  };
}

function queueRow(bonusId: string) {
  return { payload: JSON.stringify({ bonusId, url: SOURCE_URL }) };
}

describe("D3C periodic true Bonus re-verification scheduler", () => {
  beforeEach(() => {
    vi.spyOn(prisma.jobQueue, "findMany").mockResolvedValue([]);
    vi.spyOn(prisma.bonus, "findMany").mockResolvedValue([]);
    vi.spyOn(prisma.workerNode, "updateMany").mockResolvedValue({ count: 0 });
    vi.spyOn(JobQueueService, "enqueue").mockResolvedValue({ id: "job-1" } as never);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    await OrchestratorService.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("uses the exact 60h inclusive candidate boundary and excludes fresh Bonuses", async () => {
    await OrchestratorService.runBonusReverificationSweep(NOW);

    expect(prisma.bonus.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { verified_at: null },
            {
              verified_at: {
                lte: new Date(NOW.getTime() - BONUS_REVERIFICATION_AGE_MS),
              },
            },
          ],
        }),
      }),
    );
    expect(JobQueueService.enqueue).not.toHaveBeenCalled();
  });

  it.each([
    ["exactly 60h", "bonus-exact"],
    ["older than 60h", "bonus-older"],
    ["null verified_at", "bonus-null"],
  ])("enqueues an eligible Bonus %s", async (_label, id) => {
    vi.mocked(prisma.bonus.findMany).mockResolvedValue([candidate(id)] as never);

    const result = await OrchestratorService.runBonusReverificationSweep(NOW);

    expect(result.enqueued).toBe(1);
    expect(JobQueueService.enqueue).toHaveBeenCalledWith(
      INGESTION_QUEUE_NAME,
      "VALIDATE_BONUS",
      { bonusId: id, url: SOURCE_URL },
      { priority: "LOW", deduplicate: true, maxAttempts: 3 },
    );
  });

  it("uses inclusive valid_until and excludes already expired rows in the query", async () => {
    await OrchestratorService.runBonusReverificationSweep(NOW);

    expect(prisma.bonus.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: [
            { OR: [{ valid_until: null }, { valid_until: { gte: NOW } }] },
          ],
        }),
      }),
    );
  });

  it("limits v1 to active, approved, published, non-quarantined Bonuses and parents", async () => {
    await OrchestratorService.runBonusReverificationSweep(NOW);

    expect(prisma.bonus.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "ACTIVE",
          review_status: "APPROVED",
          publication_status: "PUBLISHED",
          quarantine_reason: null,
          casino: {
            status: "ACTIVE",
            review_status: "APPROVED",
            publication_status: "PUBLISHED",
            quarantine_reason: null,
          },
        }),
      }),
    );
  });

  it.each(["PENDING", "PROCESSING"])(
    "blocks a same-Bonus %s job by logical bonusId",
    async () => {
      vi.mocked(prisma.jobQueue.findMany).mockResolvedValue([
        queueRow("blocked-bonus"),
      ] as never);

      await OrchestratorService.runBonusReverificationSweep(NOW);

      expect(prisma.bonus.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { notIn: ["blocked-bonus"] },
          }),
        }),
      );
    },
  );

  it("treats a retry returned to PENDING as active work", async () => {
    vi.mocked(prisma.jobQueue.findMany).mockResolvedValue([
      queueRow("retry-bonus"),
    ] as never);

    await OrchestratorService.runBonusReverificationSweep(NOW);

    const query = vi.mocked(prisma.jobQueue.findMany).mock.calls[0][0];
    expect(query?.where).toEqual(
      expect.objectContaining({
        OR: expect.arrayContaining([
          { status: { in: ["PENDING", "PROCESSING"] } },
        ]),
      }),
    );
    expect(vi.mocked(prisma.bonus.findMany).mock.calls[0][0]?.where).toEqual(
      expect.objectContaining({ id: { notIn: ["retry-bonus"] } }),
    );
  });

  it.each(["COMPLETED", "FAILED"])(
    "blocks recent %s jobs for one hour",
    async (status) => {
      const cooldownCutoff = new Date(
        NOW.getTime() - BONUS_REVERIFICATION_COOLDOWN_MS,
      );
      vi.mocked(prisma.jobQueue.findMany).mockResolvedValue([
        queueRow(`${status.toLowerCase()}-bonus`),
      ] as never);

      await OrchestratorService.runBonusReverificationSweep(NOW);

      const queueQuery = vi.mocked(prisma.jobQueue.findMany).mock.calls[0][0];
      const terminalPredicate =
        status === "COMPLETED"
          ? {
              status: "COMPLETED",
              OR: [
                { completed_at: { gte: cooldownCutoff } },
                {
                  completed_at: null,
                  updated_at: { gte: cooldownCutoff },
                },
              ],
            }
          : {
              status: "FAILED",
              updated_at: { gte: cooldownCutoff },
            };
      expect(queueQuery?.where).toEqual(
        expect.objectContaining({
          OR: expect.arrayContaining([terminalPredicate]),
        }),
      );
      expect(vi.mocked(prisma.bonus.findMany).mock.calls[0][0]?.where).toEqual(
        expect.objectContaining({
          id: { notIn: [`${status.toLowerCase()}-bonus`] },
        }),
      );
    },
  );

  it("allows terminal rows older than the one-hour cooldown", async () => {
    vi.mocked(prisma.bonus.findMany).mockResolvedValue([
      candidate("cooled-down-bonus"),
    ] as never);

    await OrchestratorService.runBonusReverificationSweep(NOW);

    const queueQuery = vi.mocked(prisma.jobQueue.findMany).mock.calls[0][0];
    const serialized = JSON.stringify(queueQuery);
    expect(serialized).toContain(
      new Date(NOW.getTime() - BONUS_REVERIFICATION_COOLDOWN_MS).toISOString(),
    );
    expect(JobQueueService.enqueue).toHaveBeenCalledTimes(1);
  });

  it("enqueues multiple Bonuses independently in database order", async () => {
    vi.mocked(prisma.bonus.findMany).mockResolvedValue([
      candidate("bonus-oldest"),
      candidate("bonus-next"),
    ] as never);

    await OrchestratorService.runBonusReverificationSweep(NOW);

    expect(JobQueueService.enqueue).toHaveBeenCalledTimes(2);
    expect(vi.mocked(JobQueueService.enqueue).mock.calls.map((call) => call[2])).toEqual([
      { bonusId: "bonus-oldest", url: SOURCE_URL },
      { bonusId: "bonus-next", url: SOURCE_URL },
    ]);
  });

  it("orders null/oldest verification first, uses id tie-breaker, and caps at 100", async () => {
    await OrchestratorService.runBonusReverificationSweep(NOW);

    expect(prisma.bonus.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [
          { verified_at: { sort: "asc", nulls: "first" } },
          { id: "asc" },
        ],
        take: BONUS_REVERIFICATION_BATCH_SIZE,
      }),
    );
    expect(BONUS_REVERIFICATION_BATCH_SIZE).toBe(100);
    expect(DEFAULT_BONUS_REVERIFICATION_INTERVAL_MS).toBe(900_000);
  });

  it("does not let blocked jobs pin the first candidate page", async () => {
    vi.mocked(prisma.jobQueue.findMany).mockResolvedValue([
      queueRow("blocked-first"),
    ] as never);
    vi.mocked(prisma.bonus.findMany).mockResolvedValue([
      candidate("next-eligible"),
    ] as never);

    await OrchestratorService.runBonusReverificationSweep(NOW);

    expect(vi.mocked(prisma.bonus.findMany).mock.calls[0][0]).toEqual(
      expect.objectContaining({
        where: expect.objectContaining({ id: { notIn: ["blocked-first"] } }),
        take: 100,
      }),
    );
    expect(JobQueueService.enqueue).toHaveBeenCalledWith(
      INGESTION_QUEUE_NAME,
      "VALIDATE_BONUS",
      expect.objectContaining({ bonusId: "next-eligible" }),
      expect.any(Object),
    );
  });

  it("is idempotent on a repeat sweep once the first job is active", async () => {
    vi.mocked(prisma.jobQueue.findMany)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([queueRow("repeat-bonus")] as never);
    vi.mocked(prisma.bonus.findMany).mockImplementation(async (args: any) =>
      args.where.id?.notIn?.includes("repeat-bonus")
        ? ([] as never)
        : ([candidate("repeat-bonus")] as never),
    );

    await OrchestratorService.runBonusReverificationSweep(NOW);
    await OrchestratorService.runBonusReverificationSweep(NOW);

    expect(JobQueueService.enqueue).toHaveBeenCalledTimes(1);
  });

  it("skips a missing authoritative source without writing or enqueueing", async () => {
    vi.mocked(prisma.bonus.findMany).mockResolvedValue([
      {
        id: "missing-source",
        source_offer_key: null,
        evidence_claims: [],
        history_events: [],
      },
    ] as never);

    const result = await OrchestratorService.runBonusReverificationSweep(NOW);

    expect(result).toEqual({
      enqueued: 0,
      skipped: [
        {
          bonusId: "missing-source",
          reason: "NO_AUTHORITATIVE_SOURCE_URL",
        },
      ],
    });
    expect(JobQueueService.enqueue).not.toHaveBeenCalled();
  });

  it("skips source identity mismatch without writing or enqueueing", async () => {
    vi.mocked(prisma.bonus.findMany).mockResolvedValue([
      {
        ...candidate("identity-mismatch"),
        source_offer_key: createBonusSourceOfferKey(
          "https://different.example.test/other-offer",
        ),
      },
    ] as never);

    const result = await OrchestratorService.runBonusReverificationSweep(NOW);

    expect(result.skipped).toEqual([
      {
        bonusId: "identity-mismatch",
        reason: "SOURCE_IDENTITY_MISMATCH",
      },
    ]);
    expect(JobQueueService.enqueue).not.toHaveBeenCalled();
  });

  it("performs no Bonus mutation in the scheduler", async () => {
    const update = vi.spyOn(prisma.bonus, "update");
    const updateMany = vi.spyOn(prisma.bonus, "updateMany");
    const upsert = vi.spyOn(prisma.bonus, "upsert");
    vi.mocked(prisma.bonus.findMany).mockResolvedValue([
      candidate("read-only-bonus"),
    ] as never);

    await OrchestratorService.runBonusReverificationSweep(NOW);

    expect(update).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("contains a failed sweep and allows the next scheduled tick", async () => {
    vi.useFakeTimers();
    const sweep = vi
      .spyOn(OrchestratorService, "runBonusReverificationSweep")
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValue({ enqueued: 0, skipped: [] });

    await OrchestratorService.start({
      enableWorkers: false,
      enableRecovery: false,
      enableSchedulers: true,
      discoveryIntervalMs: 60_000,
      verificationIntervalMs: 900_000,
      seedSources: [],
    });
    await vi.advanceTimersByTimeAsync(900_000);

    expect(sweep).toHaveBeenCalledTimes(2);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("Bonus re-verification sweep failed"),
    );
  });

  it("prevents overlapping scheduled sweeps", async () => {
    vi.useFakeTimers();
    let releaseSweep!: () => void;
    const heldSweep = new Promise<void>((resolve) => {
      releaseSweep = resolve;
    });
    const sweep = vi
      .spyOn(OrchestratorService, "runBonusReverificationSweep")
      .mockResolvedValue({ enqueued: 0, skipped: [] });

    await OrchestratorService.start({
      enableWorkers: false,
      enableRecovery: false,
      enableSchedulers: true,
      discoveryIntervalMs: 60_000,
      verificationIntervalMs: 900_000,
      seedSources: [],
    });
    sweep.mockImplementation(async () => {
      await heldSweep;
      return { enqueued: 0, skipped: [] };
    });
    await vi.advanceTimersByTimeAsync(900_000);
    await vi.advanceTimersByTimeAsync(900_000);

    expect(sweep).toHaveBeenCalledTimes(2);
    releaseSweep();
    await heldSweep;
  });

  it("stop clears the timer and awaits an active verification sweep", async () => {
    vi.useFakeTimers();
    let releaseSweep!: () => void;
    const heldSweep = new Promise<void>((resolve) => {
      releaseSweep = resolve;
    });
    const sweep = vi
      .spyOn(OrchestratorService, "runBonusReverificationSweep")
      .mockResolvedValue({ enqueued: 0, skipped: [] });

    await OrchestratorService.start({
      enableWorkers: false,
      enableRecovery: false,
      enableSchedulers: true,
      discoveryIntervalMs: 60_000,
      verificationIntervalMs: 900_000,
      seedSources: [],
    });
    sweep.mockImplementation(async () => {
      await heldSweep;
      return { enqueued: 0, skipped: [] };
    });
    await vi.advanceTimersByTimeAsync(900_000);

    let stopped = false;
    const stopPromise = OrchestratorService.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);

    releaseSweep();
    await stopPromise;
    await vi.advanceTimersByTimeAsync(1_800_000);
    expect(sweep).toHaveBeenCalledTimes(2);
  });

  it("keeps production VALIDATE_BONUS routed through canonical D3B resolution", async () => {
    const reverify = vi
      .spyOn(BonusReverificationService, "reverifyBonus")
      .mockResolvedValue({
        status: "BONUS_NOT_FOUND",
        bonusId: "bonus-handler",
      });

    await OrchestratorService.getQueueHandlers([]).VALIDATE_BONUS({
      bonusId: "bonus-handler",
      url: "https://informational.example.test/offer",
    });

    expect(reverify).toHaveBeenCalledWith("bonus-handler");
  });
});
