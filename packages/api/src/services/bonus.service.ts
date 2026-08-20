import { Prisma, PublicationStatus, ReviewStatus, prisma } from "@savvyedge/database";
import {
  BonusLifecycleStatus,
  BonusLifecycleStatusSchema,
  CreateBonusInput,
} from "@savvyedge/types";
import { AIEngine } from "@savvyedge/ai-agents/ai-engine";
import { createBonusSourceOfferKey } from "../utils/bonus-source-identity";

export const HOUSE_EDGE_ASSUMPTION = 0.03;

export interface CalculateBonusEVInput {
  depositAmount: number;
  headlineValue?: string | null;
  wageringRequirement?: number | null;
  maxConversion?: number | null;
  validUntil?: Date | string | null;
  gameContributionPct: number;
  slotRtp?: number | null;
}

export interface CalculateBonusEVOutput {
  bonusAmount: number;
  totalWageringRequired: number;
  expectedValue: number;
  cappedPayout: number;
  daysUntilExpiry: number | null;
  isCapped: boolean;
  houseEdgeUsed: number;
  houseEdgeSource: "slot_rtp" | "default_assumption";
  isCalculable: boolean;
}

export interface BonusSourceProvenance {
  sourceUrl: string;
  sourceIdentityUrl: string;
}

interface BonusFieldDiff {
  field: string;
  oldVal: string | null;
  newVal: string | null;
}

export class BonusService {
  static async getBonuses({ page = 1, limit = 50 }: { page?: number; limit?: number }) {
    const skip = (page - 1) * limit;
    
    const [data, total] = await Promise.all([
      prisma.bonus.findMany({
        skip,
        take: limit,
        orderBy: { true_value_score: 'desc' }, // default sort by true value per PRD
        include: {
          casino: true,
        }
      }),
      prisma.bonus.count(),
    ]);

    return { data, meta: { page, limit, total } };
  }

  public static calculateBonusEV(input: CalculateBonusEVInput): CalculateBonusEVOutput {
    const {
      depositAmount,
      headlineValue,
      wageringRequirement = 0,
      maxConversion,
      validUntil,
      gameContributionPct,
      slotRtp,
    } = input;

    let houseEdgeUsed: number = HOUSE_EDGE_ASSUMPTION;
    let houseEdgeSource: "slot_rtp" | "default_assumption" = "default_assumption";

    if (slotRtp !== undefined && slotRtp !== null) {
      houseEdgeUsed = (100 - slotRtp) / 100;
      houseEdgeSource = "slot_rtp";
    }

    const bonusAmount = this.parseBonusAmount(headlineValue, depositAmount);
    const safeWageringReq = wageringRequirement ?? 0;
    const safeContribPct = gameContributionPct > 0 ? gameContributionPct : 100;

    const totalWageringRequired = (depositAmount + bonusAmount) * safeWageringReq * (100 / safeContribPct);
    const expectedValue = bonusAmount - (totalWageringRequired * houseEdgeUsed);
    const uncappedPayout = expectedValue + bonusAmount;
    
    const isCapped = maxConversion !== null && maxConversion !== undefined && uncappedPayout > maxConversion;
    const cappedPayout = isCapped ? maxConversion! : uncappedPayout;

    let daysUntilExpiry: number | null = null;
    if (validUntil) {
      const expiryDate = new Date(validUntil);
      const now = new Date();
      const diffMs = expiryDate.getTime() - now.getTime();
      daysUntilExpiry = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
    }

    let isCalculable = true;
    if (headlineValue) {
      const pctMatch = headlineValue.match(/(\d+(?:\.\d+)?)%/i);
      if (!pctMatch) {
        isCalculable = false;
      }
    }

    return {
      bonusAmount: Math.round(bonusAmount * 100) / 100,
      totalWageringRequired: Math.round(totalWageringRequired * 100) / 100,
      expectedValue: Math.round(expectedValue * 100) / 100,
      cappedPayout: Math.round(cappedPayout * 100) / 100,
      daysUntilExpiry,
      isCapped,
      houseEdgeUsed: Math.round(houseEdgeUsed * 10000) / 10000,
      houseEdgeSource,
      isCalculable,
    };
  }

  public static parseBonusAmount(headlineValue?: string | null, depositAmount: number = 0): number {
    if (!headlineValue) return 0;

    const pctMatch = headlineValue.match(/(\d+(?:\.\d+)?)%/i);
    const capMatch = headlineValue.match(/up\s+to\s+[$€£]?(\d+(?:\.\d+)?)/i);

    if (pctMatch) {
      const pct = parseFloat(pctMatch[1]) / 100;
      const matchBonus = depositAmount * pct;
      if (capMatch) {
        const capValue = parseFloat(capMatch[1]);
        return Math.min(matchBonus, capValue);
      }
      return matchBonus;
    }

    // No reliable %-match or up-to-cap pattern found in headline.
    // Do not guess a monetary value from raw digits — return 0 to signal
    // "not calculable" rather than fabricating a number.
    return 0;
  }

  public static extractNominalBonusValue(headlineValue?: string | null): number {
    if (!headlineValue || typeof headlineValue !== "string") return 0;
    const trimmed = headlineValue.trim();
    if (!trimmed) return 0;

    // Reject headlines with extra unvalued components (free spins, free bets, etc.)
    if (/free\s*spins?|spins?|free\s*bets?|bet\s*credits?|chips?/i.test(trimmed)) {
      return 0;
    }

    // Find all monetary caps (e.g. "up to $500", "up to €1,000", "$500")
    const matches = Array.from(
      trimmed.matchAll(/(?:up\s+to\s+[$€£]?|[$€£])\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)/gi)
    );

    // Only accept exactly one unambiguous monetary cap
    if (matches.length !== 1) {
      return 0;
    }

    const cleanStr = matches[0][1].replace(/,/g, "");
    const val = parseFloat(cleanStr);
    if (isNaN(val) || !isFinite(val) || val <= 0) {
      return 0;
    }

    return val;
  }

  public static calculateTrueValueScore(
    headlineValue?: string | null,
    wageringReq?: number | null,
    maxConversion?: number | null
  ): number {
    if (!headlineValue || wageringReq === undefined || wageringReq === null || wageringReq <= 0) {
      return 0;
    }

    const baseVal = this.extractNominalBonusValue(headlineValue);
    if (baseVal <= 0) {
      return 0;
    }

    const rawScore = baseVal / wageringReq;

    if (isNaN(rawScore) || !isFinite(rawScore) || rawScore <= 0) {
      return 0;
    }

    return Math.round(rawScore * 100) / 100;
  }

  public static normalizeLifecycleStatus(
    status: unknown,
  ): BonusLifecycleStatus {
    return BonusLifecycleStatusSchema.parse(status);
  }

  static async createBonus(
    data: CreateBonusInput,
    provenance?: BonusSourceProvenance,
    db: Prisma.TransactionClient | typeof prisma = prisma,
  ) {
    if (!provenance) {
      const res = await this.saveUnidentifiedBonus(data, db);
      return res.bonus;
    }

    const res = await this.saveGovernedBonus(data, provenance, db);
    return res.bonus;
  }

  static async saveGovernedBonus(
    data: CreateBonusInput,
    provenance: BonusSourceProvenance,
    db: Prisma.TransactionClient | typeof prisma = prisma,
  ): Promise<{
    bonus: any;
    isNew: boolean;
    isApprovedOrPublished: boolean;
    hasFieldDiffs: boolean;
  }> {
    const status = this.normalizeLifecycleStatus(data.status);
    const normalizedData: CreateBonusInput = { ...data, status };

    const sourceOfferKey = createBonusSourceOfferKey(
      provenance.sourceIdentityUrl,
    );
    const trueValueScore = this.calculateTrueValueScore(
      normalizedData.headline_value,
      normalizedData.wagering_requirement,
      normalizedData.max_conversion,
    );
    const now = new Date();

    const existingBonus = await db.bonus.findUnique({
      where: {
        casino_id_source_offer_key: {
          casino_id: normalizedData.casino_id,
          source_offer_key: sourceOfferKey,
        },
      },
    });

    if (existingBonus) {
      return this.updateExistingBonus(
        normalizedData,
        existingBonus,
        provenance.sourceUrl,
        trueValueScore,
        now,
        db,
      );
    }

    const created = await this.createNewBonus(
      normalizedData,
      trueValueScore,
      sourceOfferKey,
      now,
      db,
    );

    return {
      bonus: created,
      isNew: true,
      isApprovedOrPublished: false,
      hasFieldDiffs: false,
    };
  }

  private static async saveUnidentifiedBonus(
    data: CreateBonusInput,
    db: Prisma.TransactionClient | typeof prisma,
  ) {
    const status = this.normalizeLifecycleStatus(data.status);
    const normalizedData: CreateBonusInput = { ...data, status };

    const trueValueScore = this.calculateTrueValueScore(
      normalizedData.headline_value,
      normalizedData.wagering_requirement,
      normalizedData.max_conversion,
    );
    const now = new Date();

    // Provenance-free callers retain the legacy "latest active bonus" update
    // contract, but only within the unidentified NULL-key namespace. An
    // identified offer must never be selected or overwritten heuristically.
    const existingBonus = await db.bonus.findFirst({
      where: {
        casino_id: normalizedData.casino_id,
        source_offer_key: null,
        status: "ACTIVE",
      },
      orderBy: { created_at: "desc" },
    });

    if (existingBonus) {
      return this.updateExistingBonus(
        normalizedData,
        existingBonus,
        null,
        trueValueScore,
        now,
        db,
        true,
      );
    }

    const created = await this.createNewBonus(
      normalizedData,
      trueValueScore,
      null,
      now,
      db,
    );
    return {
      bonus: created,
      isNew: true,
      isApprovedOrPublished: false,
      hasFieldDiffs: false,
    };
  }

  private static async updateExistingBonus(
    data: CreateBonusInput,
    existingBonus: any,
    sourceUrl: string | null,
    trueValueScore: number,
    now: Date,
    db: Prisma.TransactionClient | typeof prisma,
    preserveMissingDates = false,
  ) {
    const candidateHeadline = data.headline_value ?? null;
    const candidateType = data.type;
    const candidateWagering = data.wagering_requirement ?? null;
    const candidateMaxConv = data.max_conversion ?? null;
    const candidateValidFrom = preserveMissingDates
      ? data.valid_from ?? existingBonus.valid_from ?? null
      : data.valid_from ?? null;
    const candidateValidUntil = preserveMissingDates
      ? data.valid_until ?? existingBonus.valid_until ?? null
      : data.valid_until ?? null;
    const candidateStatus = data.status;

    const diffs: BonusFieldDiff[] = [];
    this.appendDiff(
      diffs,
      "headline_value",
      existingBonus.headline_value ?? null,
      candidateHeadline,
    );
    this.appendDiff(diffs, "type", existingBonus.type, candidateType);
    this.appendDiff(
      diffs,
      "wagering_requirement",
      existingBonus.wagering_requirement ?? null,
      candidateWagering,
    );
    this.appendDiff(
      diffs,
      "max_conversion",
      existingBonus.max_conversion ?? null,
      candidateMaxConv,
    );
    this.appendDateDiff(
      diffs,
      "valid_from",
      existingBonus.valid_from ?? null,
      candidateValidFrom,
    );
    this.appendDateDiff(
      diffs,
      "valid_until",
      existingBonus.valid_until ?? null,
      candidateValidUntil,
    );
    this.appendDiff(diffs, "status", existingBonus.status, candidateStatus);

    const hasFieldDiffs = diffs.length > 0;
    if (!hasFieldDiffs) {
      const updated = await db.bonus.update({
        where: { id: existingBonus.id },
        data: { updated_at: now },
      });
      return {
        bonus: updated,
        isNew: false,
        isApprovedOrPublished: false,
        hasFieldDiffs: false,
      };
    }

    const isApprovedOrPublished =
      existingBonus.review_status === ReviewStatus.APPROVED ||
      existingBonus.publication_status === PublicationStatus.PUBLISHED;

    for (const diff of diffs) {
      await db.bonusHistoryEvent.create({
        data: {
          bonus_id: existingBonus.id,
          field_changed: diff.field,
          old_value: diff.oldVal,
          new_value: diff.newVal,
          source_url: sourceUrl,
          changed_at: now,
        },
      });
    }

    if (isApprovedOrPublished) {
      const updated = await db.bonus.update({
        where: { id: existingBonus.id },
        data: { updated_at: now },
      });
      return {
        bonus: updated,
        isNew: false,
        isApprovedOrPublished: true,
        hasFieldDiffs: true,
      };
    }

    const updated = await db.bonus.update({
      where: { id: existingBonus.id },
      data: {
        headline_value: candidateHeadline,
        type: candidateType,
        wagering_requirement: candidateWagering,
        max_conversion: candidateMaxConv,
        true_value_score: trueValueScore,
        valid_from: candidateValidFrom,
        valid_until: candidateValidUntil,
        status: candidateStatus,
        updated_at: now,
      },
    });
    return {
      bonus: updated,
      isNew: false,
      isApprovedOrPublished: false,
      hasFieldDiffs: true,
    };
  }

  private static async createNewBonus(
    data: CreateBonusInput,
    trueValueScore: number,
    sourceOfferKey: string | null,
    now: Date,
    db: Prisma.TransactionClient | typeof prisma,
  ) {
    const isDevMock =
      new AIEngine().getActiveProvider().constructor.name === "DevAIProvider";

    return db.bonus.create({
      data: {
        ...data,
        source_offer_key: sourceOfferKey,
        status: data.status,
        true_value_score: trueValueScore,
        data_source_type: isDevMock ? "DEV_MOCK" : "SCRAPED",
        created_at: now,
        updated_at: now,
        verified_at: null,
        review_status: ReviewStatus.NEW,
        publication_status: PublicationStatus.UNPUBLISHED,
        quarantine_reason: null,
        governance_version: 0,
      },
    });
  }

  private static appendDiff(
    diffs: BonusFieldDiff[],
    field: string,
    oldValue: string | number | null,
    newValue: string | number | null,
  ) {
    if (oldValue === newValue) return;
    diffs.push({
      field,
      oldVal: oldValue === null ? null : String(oldValue),
      newVal: newValue === null ? null : String(newValue),
    });
  }

  private static appendDateDiff(
    diffs: BonusFieldDiff[],
    field: string,
    oldValue: Date | null,
    newValue: Date | null,
  ) {
    const oldIso = oldValue?.toISOString() ?? null;
    const newIso = newValue?.toISOString() ?? null;
    this.appendDiff(diffs, field, oldIso, newIso);
  }
}
