import { readFileSync } from "fs";
import { join } from "path";
import {
  Prisma,
  PublicationStatus,
  ReviewStatus,
  prisma,
} from "@savvyedge/database";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BonusService } from "../src/services/bonus.service";
import {
  createBonusSourceOfferKey,
  normalizeBonusSourceIdentityUrl,
} from "../src/utils/bonus-source-identity";
import {
  IngestionService,
  resolveBonusSourceProvenance,
} from "../src/services/ingestion.service";

type StoredBonus = Record<string, any> & { id: string };

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    "Unique constraint failed on (casino_id, source_offer_key)",
    {
      code: "P2002",
      clientVersion: "5.22.0",
      meta: { target: ["casino_id", "source_offer_key"] },
    },
  );
}

function p2034(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    "Transaction failed due to a write conflict or a deadlock",
    {
      code: "P2034",
      clientVersion: "5.22.0",
    },
  );
}

function createMemoryDatabase(initialBonuses: StoredBonus[] = []) {
  const bonuses = initialBonuses;
  const history: Array<Record<string, any>> = [];
  let nextId = bonuses.length + 1;

  const findByIdentity = (where: any) => {
    const identity = where.casino_id_source_offer_key;
    return (
      bonuses.find(
        (bonus) =>
          bonus.casino_id === identity.casino_id &&
          bonus.source_offer_key === identity.source_offer_key,
      ) ?? null
    );
  };

  const db = {
    bonus: {
      findUnique: vi.fn(async ({ where }: any) => findByIdentity(where)),
      findFirst: vi.fn(async ({ where }: any) =>
        bonuses
          .filter(
            (bonus) =>
              bonus.casino_id === where.casino_id &&
              bonus.source_offer_key === where.source_offer_key &&
              bonus.status === where.status,
          )
          .sort(
            (left, right) =>
              right.created_at.getTime() - left.created_at.getTime(),
          )[0] ?? null,
      ),
      findMany: vi.fn(async ({ where, take }: any) =>
        bonuses
          .filter(
            (bonus) =>
              bonus.casino_id === where.casino_id &&
              bonus.source_offer_key === null &&
              bonus.status === where.status &&
              bonus.duplicate_of_id === null &&
              bonus.review_status !== ReviewStatus.SUPERSEDED,
          )
          .slice(0, take),
      ),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const candidate = bonuses.find(
          (bonus) =>
            bonus.id === where.id &&
            bonus.source_offer_key === where.source_offer_key &&
            bonus.status === where.status &&
            bonus.duplicate_of_id === where.duplicate_of_id,
        );
        if (!candidate) return { count: 0 };
        if (
          bonuses.some(
            (bonus) =>
              bonus.id !== candidate.id &&
              bonus.casino_id === candidate.casino_id &&
              bonus.source_offer_key === data.source_offer_key,
          )
        ) {
          throw p2002();
        }
        Object.assign(candidate, data);
        return { count: 1 };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const candidate = bonuses.find((bonus) => bonus.id === where.id);
        if (!candidate) throw new Error(`Missing bonus ${where.id}`);
        Object.assign(candidate, data);
        return candidate;
      }),
      create: vi.fn(async ({ data }: any) => {
        if (
          data.source_offer_key !== null &&
          bonuses.some(
            (bonus) =>
              bonus.casino_id === data.casino_id &&
              bonus.source_offer_key === data.source_offer_key,
          )
        ) {
          throw p2002();
        }
        const created = { id: `bonus-${nextId++}`, ...data };
        bonuses.push(created);
        return created;
      }),
    },
    bonusHistoryEvent: {
      create: vi.fn(async ({ data }: any) => {
        history.push(data);
        return data;
      }),
    },
  };

  return { db: db as any, bonuses, history };
}

function bonusInput(overrides: Record<string, unknown> = {}) {
  return {
    casino_id: "11111111-1111-4111-8111-111111111111",
    type: "WELCOME",
    headline_value: "100% up to £200",
    wagering_requirement: 35,
    max_conversion: 500,
    valid_from: new Date("2026-08-01T00:00:00.000Z"),
    valid_until: new Date("2026-09-01T00:00:00.000Z"),
    status: "ACTIVE",
    ...overrides,
  };
}

function legacyBonus(overrides: Record<string, unknown> = {}): StoredBonus {
  return {
    id: "legacy-1",
    ...bonusInput(),
    source_offer_key: null,
    true_value_score: 5,
    review_status: ReviewStatus.NEW,
    publication_status: PublicationStatus.UNPUBLISHED,
    duplicate_of_id: null,
    governance_version: 0,
    created_at: new Date("2026-07-01T00:00:00.000Z"),
    updated_at: new Date("2026-07-01T00:00:00.000Z"),
    ...overrides,
  };
}

const requestedUrl = "https://casino.example.com/promotions/welcome";
const provenance = {
  sourceUrl: requestedUrl,
  sourceIdentityUrl: requestedUrl,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("bonus source URL identity", () => {
  it("normalizes tracking, query order, fragments, default ports, and trailing slashes deterministically", () => {
    const left = normalizeBonusSourceIdentityUrl(
      "HTTPS://Casino.Example.com:443/promo/?b=2&utm_source=test&a=1#terms",
    );
    const right = normalizeBonusSourceIdentityUrl(
      "https://casino.example.com/promo?a=1&b=2",
    );

    expect(left).toBe("https://casino.example.com/promo?a=1&b=2");
    expect(left).toBe(right);
    expect(createBonusSourceOfferKey(left)).toMatch(
      /^bonus-url-v1:[a-f0-9]{64}$/,
    );
  });

  it("keeps non-tracking offer parameters significant", () => {
    expect(createBonusSourceOfferKey(`${requestedUrl}?offer=alpha`)).not.toBe(
      createBonusSourceOfferKey(`${requestedUrl}?offer=beta`),
    );
  });

  it("fails clearly for invalid or non-HTTP identity URLs", () => {
    expect(() => createBonusSourceOfferKey("not-a-url")).toThrow(
      "Bonus source identity URL is invalid",
    );
    expect(() => createBonusSourceOfferKey("file:///tmp/offer")).toThrow(
      "must use HTTP or HTTPS",
    );
  });

  it("selects the stored canonical URL ahead of different requested URLs", () => {
    const canonicalUrl = "https://casino.example.com/promotions/canonical";
    expect(
      resolveBonusSourceProvenance("https://casino.example.com/go/one", {
        canonical_url: canonicalUrl,
      }).sourceIdentityUrl,
    ).toBe(canonicalUrl);
    expect(
      resolveBonusSourceProvenance("https://casino.example.com/go/two", {
        canonical_url: canonicalUrl,
      }).sourceIdentityUrl,
    ).toBe(canonicalUrl);
  });
});

describe("BonusService governed identity matching", () => {
  it("reuses one Bonus for the same casino and normalized identity URL", async () => {
    const memory = createMemoryDatabase();
    const first = await BonusService.saveGovernedBonus(
      bonusInput(),
      provenance,
      memory.db,
    );
    const second = await BonusService.saveGovernedBonus(
      bonusInput(),
      {
        sourceUrl: `${requestedUrl}/?utm_campaign=repeat`,
        sourceIdentityUrl: `${requestedUrl}/?utm_campaign=repeat`,
      },
      memory.db,
    );

    expect(second.bonus.id).toBe(first.bonus.id);
    expect(memory.bonuses).toHaveLength(1);
  });

  it("creates distinct Bonuses for different identity URLs at the same casino", async () => {
    const memory = createMemoryDatabase();
    await BonusService.saveGovernedBonus(bonusInput(), provenance, memory.db);
    await BonusService.saveGovernedBonus(
      bonusInput({ headline_value: "50 free spins" }),
      {
        sourceUrl: "https://casino.example.com/promotions/free-spins",
        sourceIdentityUrl: "https://casino.example.com/promotions/free-spins",
      },
      memory.db,
    );

    expect(memory.bonuses).toHaveLength(2);
    expect(memory.bonuses[0].source_offer_key).not.toBe(
      memory.bonuses[1].source_offer_key,
    );
  });

  it("reuses one Bonus when different requested URLs share a canonical identity", async () => {
    const memory = createMemoryDatabase();
    const canonicalUrl = "https://casino.example.com/promotions/canonical";
    await BonusService.saveGovernedBonus(
      bonusInput(),
      resolveBonusSourceProvenance("https://casino.example.com/go/one", {
        canonical_url: canonicalUrl,
      }),
      memory.db,
    );
    await BonusService.saveGovernedBonus(
      bonusInput(),
      resolveBonusSourceProvenance("https://casino.example.com/go/two", {
        canonical_url: canonicalUrl,
      }),
      memory.db,
    );

    expect(memory.bonuses).toHaveLength(1);
  });

  it("records changed terms under the same source key", async () => {
    const memory = createMemoryDatabase();
    const created = await BonusService.saveGovernedBonus(
      bonusInput(),
      provenance,
      memory.db,
    );
    const updated = await BonusService.saveGovernedBonus(
      bonusInput({ wagering_requirement: 50 }),
      provenance,
      memory.db,
    );

    expect(updated.bonus.id).toBe(created.bonus.id);
    expect(updated.hasFieldDiffs).toBe(true);
    expect(memory.history).toContainEqual(
      expect.objectContaining({
        bonus_id: updated.bonus.id,
        field_changed: "wagering_requirement",
        old_value: "35",
        new_value: "50",
      }),
    );
  });

  it("does not overwrite approved or published entity values", async () => {
    const key = createBonusSourceOfferKey(requestedUrl);
    const approved = legacyBonus({
      id: "approved-1",
      source_offer_key: key,
      review_status: ReviewStatus.APPROVED,
      publication_status: PublicationStatus.PUBLISHED,
    });
    const memory = createMemoryDatabase([approved]);

    const result = await BonusService.saveGovernedBonus(
      bonusInput({
        headline_value: "Changed candidate",
        valid_until: new Date("2026-10-01T00:00:00.000Z"),
        status: "INACTIVE",
      }),
      provenance,
      memory.db,
    );

    expect(result.isApprovedOrPublished).toBe(true);
    expect(result.bonus.headline_value).toBe("100% up to £200");
    expect(result.bonus.valid_until.toISOString()).toBe(
      "2026-09-01T00:00:00.000Z",
    );
    expect(result.bonus.status).toBe("ACTIVE");
    expect(memory.history.map((event) => event.field_changed)).toEqual(
      expect.arrayContaining(["headline_value", "valid_until", "status"]),
    );
  });

  it("detects and persists a valid_until-only change", async () => {
    const key = createBonusSourceOfferKey(requestedUrl);
    const memory = createMemoryDatabase([
      legacyBonus({ source_offer_key: key }),
    ]);
    const changedDate = new Date("2026-10-15T00:00:00.000Z");

    const result = await BonusService.saveGovernedBonus(
      bonusInput({ valid_until: changedDate }),
      provenance,
      memory.db,
    );

    expect(result.hasFieldDiffs).toBe(true);
    expect(result.bonus.valid_until).toEqual(changedDate);
    expect(memory.history).toContainEqual(
      expect.objectContaining({ field_changed: "valid_until" }),
    );
  });

  it("detects and persists a status-only change", async () => {
    const key = createBonusSourceOfferKey(requestedUrl);
    const memory = createMemoryDatabase([
      legacyBonus({ source_offer_key: key }),
    ]);

    const result = await BonusService.saveGovernedBonus(
      bonusInput({ status: "INACTIVE" }),
      provenance,
      memory.db,
    );

    expect(result.hasFieldDiffs).toBe(true);
    expect(result.bonus.status).toBe("INACTIVE");
    expect(memory.history).toContainEqual(
      expect.objectContaining({ field_changed: "status" }),
    );
  });

  it("does not adopt or overwrite an unrelated legacy NULL-key Bonus", async () => {
    const legacy = legacyBonus();
    const memory = createMemoryDatabase([legacy]);

    const result = await BonusService.saveGovernedBonus(
      bonusInput(),
      provenance,
      memory.db,
    );

    expect(result.bonus.id).not.toBe(legacy.id);
    expect(result.bonus.source_offer_key).toBe(
      createBonusSourceOfferKey(requestedUrl),
    );
    expect(legacy.source_offer_key).toBeNull();
    expect(legacy.headline_value).toBe("100% up to £200");
    expect(memory.bonuses).toHaveLength(2);
    expect(memory.db.bonus.updateMany).not.toHaveBeenCalled();
  });

  it("keeps two distinct source identities separate from the same legacy Bonus", async () => {
    const legacy = legacyBonus();
    const memory = createMemoryDatabase([legacy]);
    const freeSpinsUrl =
      "https://casino.example.com/promotions/free-spins";

    const [welcome, freeSpins] = await Promise.all([
      BonusService.saveGovernedBonus(bonusInput(), provenance, memory.db),
      BonusService.saveGovernedBonus(
        bonusInput({ type: "FREE_SPINS", headline_value: "50 free spins" }),
        { sourceUrl: freeSpinsUrl, sourceIdentityUrl: freeSpinsUrl },
        memory.db,
      ),
    ]);

    expect(welcome.bonus.id).not.toBe(legacy.id);
    expect(freeSpins.bonus.id).not.toBe(legacy.id);
    expect(freeSpins.bonus.id).not.toBe(welcome.bonus.id);
    expect(legacy.source_offer_key).toBeNull();
    expect(memory.bonuses).toHaveLength(3);
    expect(memory.db.bonus.updateMany).not.toHaveBeenCalled();
  });

  it("preserves provenance-free manual updates within the NULL-key namespace", async () => {
    const legacy = legacyBonus();
    const identified = legacyBonus({
      id: "identified-1",
      source_offer_key: createBonusSourceOfferKey(requestedUrl),
      created_at: new Date("2026-07-02T00:00:00.000Z"),
    });
    const memory = createMemoryDatabase([legacy, identified]);
    const expectedValidFrom = new Date(legacy.valid_from.getTime());
    const expectedValidUntil = new Date(legacy.valid_until.getTime());

    const result = await BonusService.createBonus(
      bonusInput({
        headline_value: "Manual correction",
        valid_from: null,
        valid_until: null,
      }),
      undefined,
      memory.db,
    );

    expect(result.id).toBe(legacy.id);
    expect(result.source_offer_key).toBeNull();
    expect(result.headline_value).toBe("Manual correction");
    expect(result.valid_from).toEqual(expectedValidFrom);
    expect(result.valid_until).toEqual(expectedValidUntil);
    expect(identified.headline_value).toBe("100% up to £200");
    expect(memory.history).toContainEqual(
      expect.objectContaining({
        bonus_id: legacy.id,
        field_changed: "headline_value",
        source_url: null,
      }),
    );
  });

  it("creates and then reuses a separate NULL-key Bonus when only an identified offer exists", async () => {
    const identified = legacyBonus({
      id: "identified-1",
      source_offer_key: createBonusSourceOfferKey(requestedUrl),
    });
    const memory = createMemoryDatabase([identified]);

    const created = await BonusService.createBonus(
      bonusInput({ headline_value: "Manual first version" }),
      undefined,
      memory.db,
    );
    const updated = await BonusService.createBonus(
      bonusInput({ headline_value: "Manual second version" }),
      undefined,
      memory.db,
    );

    expect(created.id).not.toBe(identified.id);
    expect(created.source_offer_key).toBeNull();
    expect(updated.id).toBe(created.id);
    expect(updated.source_offer_key).toBeNull();
    expect(updated.headline_value).toBe("Manual second version");
    expect(identified.headline_value).toBe("100% up to £200");
    expect(identified.source_offer_key).toBe(
      createBonusSourceOfferKey(requestedUrl),
    );
    expect(
      memory.bonuses.filter((bonus) => bonus.source_offer_key === null),
    ).toHaveLength(1);
  });

  it("documents that concurrent provenance-free creation may produce multiple NULL-key records", async () => {
    const identified = legacyBonus({
      id: "identified-1",
      source_offer_key: createBonusSourceOfferKey(requestedUrl),
    });
    const memory = createMemoryDatabase([identified]);

    const [left, right] = await Promise.all([
      BonusService.createBonus(
        bonusInput({ headline_value: "Concurrent manual one" }),
        undefined,
        memory.db,
      ),
      BonusService.createBonus(
        bonusInput({ headline_value: "Concurrent manual two" }),
        undefined,
        memory.db,
      ),
    ]);

    expect(left.id).not.toBe(right.id);
    expect(left.source_offer_key).toBeNull();
    expect(right.source_offer_key).toBeNull();
    expect(identified.headline_value).toBe("100% up to £200");
    expect(
      memory.bonuses.filter((bonus) => bonus.source_offer_key === null),
    ).toHaveLength(2);
  });

  it("lets the composite identity authority reject concurrent duplicate creates", async () => {
    const memory = createMemoryDatabase();
    const results = await Promise.allSettled([
      BonusService.saveGovernedBonus(bonusInput(), provenance, memory.db),
      BonusService.saveGovernedBonus(bonusInput(), provenance, memory.db),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(memory.bonuses).toHaveLength(1);
  });
});

describe("database and transaction race safeguards", () => {
  it("declares a forward-only duplicate preflight and composite unique index", () => {
    const schema = readFileSync(
      join(__dirname, "../../database/prisma/schema.prisma"),
      "utf8",
    );
    const migration = readFileSync(
      join(
        __dirname,
        "../../database/prisma/migrations/20260803090000_unique_bonus_source_offer_identity/migration.sql",
      ),
      "utf8",
    );

    expect(schema).toContain("@@unique([casino_id, source_offer_key])");
    expect(migration).toContain("HAVING COUNT(*) > 1");
    expect(migration).toContain("DETAIL = duplicate_pair_sample");
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "Bonus_casino_id_source_offer_key_key"',
    );
    expect(migration).not.toMatch(/DELETE|TRUNCATE|UPDATE\s+"Bonus"/i);
  });

  it("retries the complete governed persistence transaction after a Bonus P2002", async () => {
    const transaction = vi
      .spyOn(prisma, "$transaction")
      .mockRejectedValueOnce(p2002())
      .mockResolvedValueOnce("resolved-after-retry" as never);
    const operation = vi.fn();

    const result = await (
      IngestionService as unknown as {
        runGovernedPersistenceTransaction: (
          callback: () => Promise<unknown>,
        ) => Promise<unknown>;
      }
    ).runGovernedPersistenceTransaction(operation);

    expect(result).toBe("resolved-after-retry");
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it("retries the complete governed persistence transaction after P2034", async () => {
    const transaction = vi
      .spyOn(prisma, "$transaction")
      .mockRejectedValueOnce(p2034())
      .mockResolvedValueOnce("resolved-after-retry" as never);

    const result = await (
      IngestionService as unknown as {
        runGovernedPersistenceTransaction: (
          callback: () => Promise<unknown>,
        ) => Promise<unknown>;
      }
    ).runGovernedPersistenceTransaction(vi.fn());

    expect(result).toBe("resolved-after-retry");
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it("stops after the transaction retry budget is exhausted", async () => {
    const transaction = vi
      .spyOn(prisma, "$transaction")
      .mockRejectedValue(p2034());

    await expect(
      (
        IngestionService as unknown as {
          runGovernedPersistenceTransaction: (
            callback: () => Promise<unknown>,
          ) => Promise<unknown>;
        }
      ).runGovernedPersistenceTransaction(vi.fn()),
    ).rejects.toMatchObject({ code: "P2034" });
    expect(transaction).toHaveBeenCalledTimes(3);
  });
});
