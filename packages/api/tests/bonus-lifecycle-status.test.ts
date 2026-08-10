import { describe, expect, it, vi } from "vitest";
import {
  BONUS_LIFECYCLE_STATUSES,
  BonusLifecycleStatusSchema,
  BonusSchema,
  CreateBonusInputSchema,
  type CreateBonusInput,
} from "@savvyedge/types";
import { BonusService } from "../src/services/bonus.service";
import { resolveBonusSourceProvenance } from "../src/services/ingestion.service";

type StoredBonus = Record<string, any> & { id: string };

function createMemoryDatabase(initialBonuses: StoredBonus[] = []) {
  const bonuses = [...initialBonuses];
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
      update: vi.fn(async ({ where, data }: any) => {
        const candidate = bonuses.find((bonus) => bonus.id === where.id);
        if (!candidate) throw new Error(`Missing bonus ${where.id}`);
        Object.assign(candidate, data);
        return candidate;
      }),
      create: vi.fn(async ({ data }: any) => {
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

function baseBonusInput(overrides: Record<string, unknown> = {}): CreateBonusInput {
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
  } as CreateBonusInput;
}

describe("Bonus Lifecycle Status Normalization", () => {
  describe("Shared canonical schema (BonusLifecycleStatusSchema)", () => {
    it("defines only ACTIVE and INACTIVE in BONUS_LIFECYCLE_STATUSES", () => {
      expect(BONUS_LIFECYCLE_STATUSES).toEqual(["ACTIVE", "INACTIVE"]);
    });

    it("accepts canonical ACTIVE and INACTIVE", () => {
      expect(BonusLifecycleStatusSchema.parse("ACTIVE")).toBe("ACTIVE");
      expect(BonusLifecycleStatusSchema.parse("INACTIVE")).toBe("INACTIVE");
    });

    it("safely canonicalizes whitespace and casing", () => {
      expect(BonusLifecycleStatusSchema.parse(" active ")).toBe("ACTIVE");
      expect(BonusLifecycleStatusSchema.parse("inactive")).toBe("INACTIVE");
      expect(BonusLifecycleStatusSchema.parse(" INACTIVE ")).toBe("INACTIVE");
      expect(BonusLifecycleStatusSchema.parse("active")).toBe("ACTIVE");
    });

    it("rejects unknown, non-lifecycle, and invalid statuses", () => {
      const invalidValues = [
        "not_found",
        "VERIFIED",
        "EXPIRED",
        "unknown",
        "",
        "   ",
        "APPROVED",
        "PENDING",
        "SUSPENDED",
        "active_bonus",
        "inactive_offer",
      ];

      for (const invalid of invalidValues) {
        expect(BonusLifecycleStatusSchema.safeParse(invalid).success).toBe(false);
      }
    });

    it("rejects arbitrary descriptive lifecycle prose", () => {
      const proseExamples = [
        "active until tomorrow",
        "inactive due to terms update",
        "this offer is currently active",
        "status: ACTIVE",
      ];

      for (const prose of proseExamples) {
        expect(BonusLifecycleStatusSchema.safeParse(prose).success).toBe(false);
      }
    });

    it("rejects the exact pilot extraction regression string", () => {
      const pilotRegressionValue =
        "active (details taken from the text provided, start and end date are not specified in this text.)";

      const parsed = BonusLifecycleStatusSchema.safeParse(pilotRegressionValue);
      expect(parsed.success).toBe(false);
    });

    it("rejects non-string values without defaulting to ACTIVE", () => {
      expect(BonusLifecycleStatusSchema.safeParse(null).success).toBe(false);
      expect(BonusLifecycleStatusSchema.safeParse(undefined).success).toBe(false);
      expect(BonusLifecycleStatusSchema.safeParse(123).success).toBe(false);
      expect(BonusLifecycleStatusSchema.safeParse({}).success).toBe(false);
    });
  });

  describe("CreateBonusInputSchema & BonusSchema integration", () => {
    it("validates and canonicalizes status in CreateBonusInputSchema", () => {
      const parsed = CreateBonusInputSchema.safeParse(
        baseBonusInput({ status: " active " }),
      );
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.status).toBe("ACTIVE");
      }
    });

    it("accepts INACTIVE in CreateBonusInputSchema", () => {
      const parsed = CreateBonusInputSchema.safeParse(
        baseBonusInput({ status: "inactive" }),
      );
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.status).toBe("INACTIVE");
      }
    });

    it("rejects invalid status in CreateBonusInputSchema", () => {
      const parsed = CreateBonusInputSchema.safeParse(
        baseBonusInput({ status: "not_found" }),
      );
      expect(parsed.success).toBe(false);
    });

    it("rejects pilot regression string in CreateBonusInputSchema", () => {
      const parsed = CreateBonusInputSchema.safeParse(
        baseBonusInput({
          status:
            "active (details taken from the text provided, start and end date are not specified in this text.)",
        }),
      );
      expect(parsed.success).toBe(false);
    });

    it("rejects machine verification state VERIFIED in CreateBonusInputSchema", () => {
      const parsed = CreateBonusInputSchema.safeParse(
        baseBonusInput({ status: "VERIFIED" }),
      );
      expect(parsed.success).toBe(false);
    });

    it("validates status in full BonusSchema", () => {
      const validBonus = {
        id: "22222222-2222-4222-8222-222222222222",
        casino_id: "11111111-1111-4111-8111-111111111111",
        type: "WELCOME",
        headline_value: "100% up to £200",
        wagering_requirement: 35,
        max_conversion: 500,
        true_value_score: 5.71,
        valid_from: new Date("2026-08-01T00:00:00.000Z"),
        valid_until: new Date("2026-09-01T00:00:00.000Z"),
        status: "ACTIVE",
        data_source_type: "SCRAPED",
      };

      expect(BonusSchema.safeParse(validBonus).success).toBe(true);
      expect(
        BonusSchema.safeParse({ ...validBonus, status: "not_found" }).success,
      ).toBe(false);
    });
  });

  describe("BonusService defense-in-depth runtime enforcement", () => {
    const provenance = resolveBonusSourceProvenance(
      "https://casino.example.com/promotions/welcome",
      null,
    );

    it("normalizes status via BonusService.normalizeLifecycleStatus", () => {
      expect(BonusService.normalizeLifecycleStatus(" active ")).toBe("ACTIVE");
      expect(BonusService.normalizeLifecycleStatus("inactive")).toBe("INACTIVE");
      expect(() => BonusService.normalizeLifecycleStatus("not_found")).toThrow();
      expect(() => BonusService.normalizeLifecycleStatus("VERIFIED")).toThrow();
    });

    it("rejects invalid status before any persistence or history mutation in saveGovernedBonus", async () => {
      const memory = createMemoryDatabase();
      const invalidInput = baseBonusInput({ status: "not_found" as any });

      await expect(
        BonusService.saveGovernedBonus(invalidInput, provenance, memory.db),
      ).rejects.toThrow();

      expect(memory.db.bonus.findUnique).not.toHaveBeenCalled();
      expect(memory.db.bonus.create).not.toHaveBeenCalled();
      expect(memory.db.bonus.update).not.toHaveBeenCalled();
      expect(memory.db.bonusHistoryEvent.create).not.toHaveBeenCalled();
      expect(memory.bonuses).toHaveLength(0);
      expect(memory.history).toHaveLength(0);
    });

    it("rejects pilot regression string before persistence in saveGovernedBonus", async () => {
      const memory = createMemoryDatabase();
      const invalidInput = baseBonusInput({
        status:
          "active (details taken from the text provided, start and end date are not specified in this text.)" as any,
      });

      await expect(
        BonusService.saveGovernedBonus(invalidInput, provenance, memory.db),
      ).rejects.toThrow();

      expect(memory.db.bonus.create).not.toHaveBeenCalled();
      expect(memory.bonuses).toHaveLength(0);
    });

    it("rejects invalid status before persistence in saveUnidentifiedBonus (createBonus without provenance)", async () => {
      const memory = createMemoryDatabase();
      const invalidInput = baseBonusInput({ status: "VERIFIED" as any });

      await expect(
        BonusService.createBonus(invalidInput, undefined, memory.db),
      ).rejects.toThrow();

      expect(memory.db.bonus.findFirst).not.toHaveBeenCalled();
      expect(memory.db.bonus.create).not.toHaveBeenCalled();
      expect(memory.bonuses).toHaveLength(0);
    });

    it("creates valid ACTIVE bonus with normalized status", async () => {
      const memory = createMemoryDatabase();
      const input = baseBonusInput({ status: " active " as any });

      const result = await BonusService.saveGovernedBonus(
        input,
        provenance,
        memory.db,
      );

      expect(result.isNew).toBe(true);
      expect(result.bonus.status).toBe("ACTIVE");
      expect(memory.bonuses).toHaveLength(1);
      expect(memory.bonuses[0].status).toBe("ACTIVE");
    });

    it("creates valid INACTIVE bonus without rewriting it to ACTIVE", async () => {
      const memory = createMemoryDatabase();
      const input = baseBonusInput({ status: "INACTIVE" });

      const result = await BonusService.saveGovernedBonus(
        input,
        provenance,
        memory.db,
      );

      expect(result.isNew).toBe(true);
      expect(result.bonus.status).toBe("INACTIVE");
      expect(memory.bonuses).toHaveLength(1);
      expect(memory.bonuses[0].status).toBe("INACTIVE");
    });

    it("records status history event when existing bonus changes from ACTIVE to INACTIVE", async () => {
      const memory = createMemoryDatabase();

      // First create active bonus
      const first = await BonusService.saveGovernedBonus(
        baseBonusInput({ status: "ACTIVE" }),
        provenance,
        memory.db,
      );
      expect(first.isNew).toBe(true);
      expect(first.bonus.status).toBe("ACTIVE");

      // Update to INACTIVE
      const second = await BonusService.saveGovernedBonus(
        baseBonusInput({ status: "INACTIVE" }),
        provenance,
        memory.db,
      );

      expect(second.isNew).toBe(false);
      expect(second.hasFieldDiffs).toBe(true);
      expect(second.bonus.status).toBe("INACTIVE");
      expect(memory.bonuses).toHaveLength(1);
      expect(memory.bonuses[0].status).toBe("INACTIVE");

      // Verify history event was recorded
      expect(memory.history).toHaveLength(1);
      expect(memory.history[0]).toMatchObject({
        bonus_id: first.bonus.id,
        field_changed: "status",
        old_value: "ACTIVE",
        new_value: "INACTIVE",
      });
    });

    it("records status history event when existing bonus changes from INACTIVE to ACTIVE", async () => {
      const memory = createMemoryDatabase();

      // First create inactive bonus
      const first = await BonusService.saveGovernedBonus(
        baseBonusInput({ status: "INACTIVE" }),
        provenance,
        memory.db,
      );
      expect(first.bonus.status).toBe("INACTIVE");

      // Update back to ACTIVE
      const second = await BonusService.saveGovernedBonus(
        baseBonusInput({ status: "ACTIVE" }),
        provenance,
        memory.db,
      );

      expect(second.isNew).toBe(false);
      expect(second.hasFieldDiffs).toBe(true);
      expect(second.bonus.status).toBe("ACTIVE");
      expect(memory.bonuses).toHaveLength(1);
      expect(memory.bonuses[0].status).toBe("ACTIVE");

      expect(memory.history).toHaveLength(1);
      expect(memory.history[0]).toMatchObject({
        bonus_id: first.bonus.id,
        field_changed: "status",
        old_value: "INACTIVE",
        new_value: "ACTIVE",
      });
    });

    it("does not record status history when status is unchanged", async () => {
      const memory = createMemoryDatabase();

      await BonusService.saveGovernedBonus(
        baseBonusInput({ status: "ACTIVE" }),
        provenance,
        memory.db,
      );

      const second = await BonusService.saveGovernedBonus(
        baseBonusInput({ status: "ACTIVE" }),
        provenance,
        memory.db,
      );

      expect(second.hasFieldDiffs).toBe(false);
      expect(memory.history).toHaveLength(0);
    });

    it("rejects invalid status during update of an existing bonus before mutating row or history", async () => {
      const memory = createMemoryDatabase();

      // Create initial active bonus
      const initial = await BonusService.saveGovernedBonus(
        baseBonusInput({ status: "ACTIVE" }),
        provenance,
        memory.db,
      );
      expect(initial.bonus.status).toBe("ACTIVE");

      // Reset mock call histories
      memory.db.bonus.update.mockClear();
      memory.db.bonusHistoryEvent.create.mockClear();

      // Attempt to update with invalid status
      const invalidUpdate = baseBonusInput({ status: "not_found" as any });
      await expect(
        BonusService.saveGovernedBonus(invalidUpdate, provenance, memory.db),
      ).rejects.toThrow();

      expect(memory.db.bonus.update).not.toHaveBeenCalled();
      expect(memory.db.bonusHistoryEvent.create).not.toHaveBeenCalled();
      expect(memory.bonuses[0].status).toBe("ACTIVE");
      expect(memory.history).toHaveLength(0);
    });
  });
});
