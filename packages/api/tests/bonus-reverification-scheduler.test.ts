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
  BONUS_REVERIFICATION_ELIGIBLE_PUBLICATION_STATE_PAIRS,
  DEFAULT_BONUS_REVERIFICATION_INTERVAL_MS,
  OrchestratorService,
} from "../src/services/orchestrator.service";
import { activeBonusEvidence } from "./helpers/active-bonus-evidence.fixture";

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

function canonicalPointerCandidate(id: string) {
  return {
    ...candidate(id),
    active_extractions: activeBonusEvidence({
      bonusId: id,
      observedAt: new Date("2026-08-01T00:00:00.000Z"),
      sourceUrl: "https://operator.example.test/go/welcome",
      scrapeJobId: `scrape-${id}`,
      canonicalUrl: SOURCE_URL,
    }),
  };
}

describe("D3C periodic true Bonus re-verification scheduler", () => {
  beforeEach(() => {
    vi.spyOn(prisma.jobQueue, "findMany").mockResolvedValue([]);
    vi.spyOn(prisma.bonus, "findMany").mockResolvedValue([]);
    vi.spyOn(prisma.workerNode, "updateMany").mockResolvedValue({ count: 0 });
    vi.spyOn(JobQueueService, "enqueue").mockResolvedValue({
      id: "job-1",
    } as never);
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
    vi.mocked(prisma.bonus.findMany).mockResolvedValue([
      candidate(id),
    ] as never);

    const result = await OrchestratorService.runBonusReverificationSweep(NOW);

    expect(result.enqueued).toBe(1);
    expect(JobQueueService.enqueue).toHaveBeenCalledWith(
      INGESTION_QUEUE_NAME,
      "VALIDATE_BONUS",
      { bonusId: id, url: SOURCE_URL },
      { priority: "LOW", deduplicate: true, maxAttempts: 3 },
    );
  });

  it("hydrates linked canonical provenance and enqueues the canonical URL", async () => {
    vi.mocked(prisma.bonus.findMany).mockResolvedValue([
      canonicalPointerCandidate("canonical-redirect"),
    ] as never);

    const result = await OrchestratorService.runBonusReverificationSweep(NOW);

    expect(result).toEqual({ enqueued: 1, skipped: [] });
    expect(JobQueueService.enqueue).toHaveBeenCalledWith(
      INGESTION_QUEUE_NAME,
      "VALIDATE_BONUS",
      { bonusId: "canonical-redirect", url: SOURCE_URL },
      { priority: "LOW", deduplicate: true, maxAttempts: 3 },
    );
    expect(prisma.bonus.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          active_extractions: expect.objectContaining({
            select: expect.objectContaining({
              evidence: expect.objectContaining({
                select: expect.objectContaining({
                  scrape_job: {
                    select: {
                      id: true,
                      data_source_id: true,
                      canonical_url: true,
                    },
                  },
                }),
              }),
            }),
          }),
        }),
      }),
    );
  });

  it("uses inclusive valid_until and excludes already expired rows in the query", async () => {
    await OrchestratorService.runBonusReverificationSweep(NOW);

    expect(prisma.bonus.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            { OR: [{ valid_until: null }, { valid_until: { gte: NOW } }] },
          ]),
        }),
      }),
    );
  });

  it("retains common Bonus and parent-Casino governance constraints", async () => {
    await OrchestratorService.runBonusReverificationSweep(NOW);

    expect(prisma.bonus.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "ACTIVE",
          review_status: "APPROVED",
          quarantine_reason: null,
          casino: {
            status: "ACTIVE",
            review_status: "APPROVED",
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
    expect(
      vi.mocked(JobQueueService.enqueue).mock.calls.map((call) => call[2]),
    ).toEqual([
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

  /* ---------------------------------------------------------------------
   * Publication-queue deadlock regression.
   *
   * Before the fix the sweep selected only PUBLISHED bonuses, so an APPROVED
   * bonus awaiting its first publication could never be refreshed: it could
   * not publish because its active observation was stale, and the only thing
   * that refreshes an observation never selected it.
   * ------------------------------------------------------------------ */
  describe("eligible governed states", () => {
    /**
     * Evaluates the sweep's generated Prisma predicate against a plain row.
     *
     * Implements exactly the operators this predicate uses — scalar equality,
     * null, notIn, lte/gte, OR, AND and one nested relation — so these tests
     * prove *selection* rather than merely asserting the shape of the query
     * object. An unsupported operator throws rather than silently passing.
     */
    function matchesWhere(where: any, row: any): boolean {
      return Object.entries(where).every(([key, condition]) => {
        if (key === "OR" || key === "AND") {
          if (!Array.isArray(condition)) {
            throw new Error(`${key} must be an array`);
          }
          return key === "OR"
            ? condition.some((clause) => matchesWhere(clause, row))
            : condition.every((clause) => matchesWhere(clause, row));
        }

        const value = row?.[key];
        if (condition === null) {
          return value === null;
        }
        if (condition instanceof Date) {
          return (
            value instanceof Date && value.getTime() === condition.getTime()
          );
        }
        if (condition && typeof condition === "object") {
          if (key === "casino") {
            return Boolean(value) && matchesWhere(condition, value);
          }

          return Object.entries(condition).every(([name, operand]) => {
            switch (name) {
              case "lte":
                return (
                  value instanceof Date && value.getTime() <= operand.getTime()
                );
              case "gte":
                return (
                  value instanceof Date && value.getTime() >= operand.getTime()
                );
              case "in":
                return (operand as unknown[]).includes(value);
              case "notIn":
                return !(operand as unknown[]).includes(value);
              case "equals":
                return value === operand;
              case "not":
                return value !== operand;
              default:
                throw new Error(
                  `Unsupported operator in sweep predicate: ${name}`,
                );
            }
          });
        }
        return value === condition;
      });
    }

    const publishedCasino = {
      status: "ACTIVE",
      review_status: "APPROVED",
      publication_status: "PUBLISHED",
      quarantine_reason: null,
    };

    /** 268h: the confirmed production age, far past the 60h sweep boundary. */
    const STALE_VERIFIED_AT = new Date(NOW.getTime() - 268 * 60 * 60 * 1000);
    const FRESH_VERIFIED_AT = new Date(NOW.getTime() - 60 * 60 * 1000);

    function bonusRow(overrides: Record<string, unknown> = {}) {
      return {
        id: "row-under-test",
        status: "ACTIVE",
        review_status: "APPROVED",
        publication_status: "PUBLISHED",
        quarantine_reason: null,
        verified_at: STALE_VERIFIED_AT,
        valid_until: null,
        casino: publishedCasino,
        ...overrides,
      };
    }

    async function sweepPredicate() {
      await OrchestratorService.runBonusReverificationSweep(NOW);
      return vi.mocked(prisma.bonus.findMany).mock.calls[0][0]?.where as any;
    }

    it("enumerates exactly the three eligible publication-state pairs", () => {
      expect([
        ...BONUS_REVERIFICATION_ELIGIBLE_PUBLICATION_STATE_PAIRS,
      ]).toEqual([
        {
          publication_status: "PUBLISHED",
          casino: { publication_status: "PUBLISHED" },
        },
        {
          publication_status: "UNPUBLISHED",
          casino: { publication_status: "PUBLISHED" },
        },
        {
          publication_status: "UNPUBLISHED",
          casino: { publication_status: "UNPUBLISHED" },
        },
      ]);
    });

    it("states the publication paths explicitly rather than dropping the predicate", async () => {
      const where = await sweepPredicate();

      // The predicate must not have been widened by simply deleting the
      // publication_status clauses: the coupled paths carry them instead.
      expect(where.publication_status).toBeUndefined();
      expect(where.review_status).toBe("APPROVED");
      expect(where.AND).toEqual(
        expect.arrayContaining([
          {
            OR: [
              {
                publication_status: "PUBLISHED",
                casino: { publication_status: "PUBLISHED" },
              },
              {
                publication_status: "UNPUBLISHED",
                casino: { publication_status: "PUBLISHED" },
              },
              {
                publication_status: "UNPUBLISHED",
                casino: { publication_status: "UNPUBLISHED" },
              },
            ],
          },
        ]),
      );
    });

    it.each([
      ["PUBLISHED", "PUBLISHED", true],
      ["UNPUBLISHED", "PUBLISHED", true],
      ["UNPUBLISHED", "UNPUBLISHED", true],
      ["PUBLISHED", "UNPUBLISHED", false],
    ])(
      "selects Bonus %s + Casino %s: %s",
      async (bonusPublication, casinoPublication, expected) => {
        const where = await sweepPredicate();

        expect(
          matchesWhere(
            where,
            bonusRow({
              publication_status: bonusPublication,
              casino: {
                ...publishedCasino,
                publication_status: casinoPublication,
              },
            }),
          ),
        ).toBe(expected);
      },
    );

    it("does not select a fresh APPROVED + UNPUBLISHED bonus", async () => {
      const where = await sweepPredicate();

      expect(
        matchesWhere(
          where,
          bonusRow({
            publication_status: "UNPUBLISHED",
            verified_at: FRESH_VERIFIED_AT,
            casino: { ...publishedCasino, publication_status: "UNPUBLISHED" },
          }),
        ),
      ).toBe(false);
    });

    it.each([
      ["NEW", "NEW"],
      ["AWAITING_REVIEW", "AWAITING_REVIEW"],
      ["IN_REVIEW", "IN_REVIEW"],
      ["REJECTED", "REJECTED"],
      ["SUPERSEDED", "SUPERSEDED"],
      ["QUARANTINED", "QUARANTINED"],
    ])(
      "does not select a stale %s + UNPUBLISHED bonus",
      async (_label, reviewStatus) => {
        const where = await sweepPredicate();

        expect(
          matchesWhere(
            where,
            bonusRow({
              publication_status: "UNPUBLISHED",
              review_status: reviewStatus,
              casino: {
                ...publishedCasino,
                publication_status: "UNPUBLISHED",
              },
            }),
          ),
        ).toBe(false);
      },
    );

    it("does not select an INACTIVE bonus on an otherwise eligible unpublished pair", async () => {
      const where = await sweepPredicate();

      expect(
        matchesWhere(
          where,
          bonusRow({
            publication_status: "UNPUBLISHED",
            status: "INACTIVE",
            casino: { ...publishedCasino, publication_status: "UNPUBLISHED" },
          }),
        ),
      ).toBe(false);
    });

    it("does not select a quarantined bonus on an otherwise eligible unpublished pair", async () => {
      const where = await sweepPredicate();

      expect(
        matchesWhere(
          where,
          bonusRow({
            publication_status: "UNPUBLISHED",
            quarantine_reason: "SOURCE_CONFLICT",
            casino: { ...publishedCasino, publication_status: "UNPUBLISHED" },
          }),
        ),
      ).toBe(false);
    });

    it.each([
      ["INACTIVE", "APPROVED", null],
      ["ACTIVE", "AWAITING_REVIEW", null],
      ["ACTIVE", "APPROVED", "EVIDENCE_CONFLICT"],
    ])(
      "rejects an unpublished parent with status=%s review=%s quarantine=%s",
      async (status, reviewStatus, quarantineReason) => {
        const where = await sweepPredicate();

        expect(
          matchesWhere(
            where,
            bonusRow({
              publication_status: "UNPUBLISHED",
              casino: {
                ...publishedCasino,
                status,
                review_status: reviewStatus,
                publication_status: "UNPUBLISHED",
                quarantine_reason: quarantineReason,
              },
            }),
          ),
        ).toBe(false);
      },
    );

    it("does not select an expired UNPUBLISHED bonus", async () => {
      const where = await sweepPredicate();

      expect(
        matchesWhere(
          where,
          bonusRow({
            publication_status: "UNPUBLISHED",
            valid_until: new Date(NOW.getTime() - 1),
            casino: { ...publishedCasino, publication_status: "UNPUBLISHED" },
          }),
        ),
      ).toBe(false);
    });

    it("never selects a PUBLISHED bonus beneath an UNPUBLISHED parent", async () => {
      const where = await sweepPredicate();

      expect(
        matchesWhere(
          where,
          bonusRow({
            publication_status: "PUBLISHED",
            casino: { ...publishedCasino, publication_status: "UNPUBLISHED" },
          }),
        ),
      ).toBe(false);
    });

    it("applies the cooldown and dedup blocklist to the new path too", async () => {
      vi.mocked(prisma.jobQueue.findMany).mockResolvedValue([
        queueRow("row-under-test"),
      ] as never);

      const where = await sweepPredicate();

      expect(where.id).toEqual({ notIn: ["row-under-test"] });
      expect(
        matchesWhere(
          where,
          bonusRow({
            publication_status: "UNPUBLISHED",
            casino: { ...publishedCasino, publication_status: "UNPUBLISHED" },
          }),
        ),
      ).toBe(false);
    });

    it("fails closed if the sweep introduces an unsupported Prisma operator", () => {
      expect(() =>
        matchesWhere({ verified_at: { lt: NOW } }, bonusRow()),
      ).toThrow("Unsupported operator in sweep predicate: lt");
    });

    it("selects an UNPUBLISHED bonus whose verified_at is null", async () => {
      const where = await sweepPredicate();

      expect(
        matchesWhere(
          where,
          bonusRow({
            publication_status: "UNPUBLISHED",
            verified_at: null,
            casino: { ...publishedCasino, publication_status: "UNPUBLISHED" },
          }),
        ),
      ).toBe(true);
    });

    it("selects a projection-mismatched UNPUBLISHED bonus while verified_at is stale", async () => {
      // Production shape: Bonus.verified_at does not equal the active
      // EvidenceRecord.observed_at, and both are far older than the sweep
      // boundary. Staleness is keyed only from Bonus.verified_at in this pass,
      // and that value alone is enough to select the row.
      const where = await sweepPredicate();

      expect(
        matchesWhere(
          where,
          bonusRow({
            publication_status: "UNPUBLISHED",
            verified_at: new Date(NOW.getTime() - 300 * 60 * 60 * 1000),
            casino: { ...publishedCasino, publication_status: "UNPUBLISHED" },
          }),
        ),
      ).toBe(true);
    });

    it("DEADLOCK: an APPROVED + UNPUBLISHED bonus too stale to publish is reverification-eligible", async () => {
      // The exact production row: APPROVED, ACTIVE, UNPUBLISHED, not
      // quarantined, active observation ~268h old. It cannot be published
      // because the publication gate requires an observation within 72h, and
      // before this fix the sweep never selected it because it was not yet
      // PUBLISHED. Both statements cannot hold at once, or the row is stuck
      // forever.
      const deadlockedRow = bonusRow({
        publication_status: "UNPUBLISHED",
        verified_at: STALE_VERIFIED_AT,
        casino: { ...publishedCasino, publication_status: "UNPUBLISHED" },
      });
      const where = await sweepPredicate();

      const publicationFreshnessFloor = new Date(
        NOW.getTime() - 72 * 60 * 60 * 1000,
      );
      expect(deadlockedRow.verified_at.getTime()).toBeLessThan(
        publicationFreshnessFloor.getTime(),
      );
      expect(matchesWhere(where, deadlockedRow)).toBe(true);
    });

    it("enqueues the previously deadlocked bonus through the unchanged queue contract", async () => {
      vi.mocked(prisma.bonus.findMany).mockResolvedValue([
        candidate("deadlocked-unpublished"),
      ] as never);

      const result = await OrchestratorService.runBonusReverificationSweep(NOW);

      expect(result).toEqual({ enqueued: 1, skipped: [] });
      expect(JobQueueService.enqueue).toHaveBeenCalledWith(
        INGESTION_QUEUE_NAME,
        "VALIDATE_BONUS",
        { bonusId: "deadlocked-unpublished", url: SOURCE_URL },
        { priority: "LOW", deduplicate: true, maxAttempts: 3 },
      );
    });
  });
});
