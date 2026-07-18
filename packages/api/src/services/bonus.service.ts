import { prisma } from "@savvyedge/database";
import { CreateBonusInput } from "@savvyedge/types";

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

  private static calculateTrueValueScore(headlineValue?: string | null, wageringReq?: number | null): number {
    if (headlineValue && wageringReq && wageringReq > 0) {
      const baseVal = parseFloat(headlineValue.replace(/[^0-9.]/g, '')) || 0;
      return baseVal > 0 ? baseVal / wageringReq : 0;
    }
    return 0;
  }

  static async createBonus(data: CreateBonusInput, sourceUrl?: string) {
    const trueValueScore = this.calculateTrueValueScore(data.headline_value, data.wagering_requirement);
    const now = new Date();

    // Look up any existing active Bonus record for the casino
    const existingBonus = await prisma.bonus.findFirst({
      where: {
        casino_id: data.casino_id,
        status: "ACTIVE",
      },
      orderBy: { created_at: "desc" },
    });

    if (existingBonus) {
      // Compare candidate fields: headline_value, type, wagering_requirement, max_conversion
      const candidateHeadline = data.headline_value ?? null;
      const candidateType = data.type;
      const candidateWagering = data.wagering_requirement ?? null;
      const candidateMaxConv = data.max_conversion ?? null;

      const existingHeadline = existingBonus.headline_value ?? null;
      const existingType = existingBonus.type;
      const existingWagering = existingBonus.wagering_requirement ?? null;
      const existingMaxConv = existingBonus.max_conversion ?? null;

      const isHeadlineEqual = candidateHeadline === existingHeadline;
      const isTypeEqual = candidateType === existingType;
      const isWageringEqual = candidateWagering === existingWagering;
      const isMaxConvEqual = candidateMaxConv === existingMaxConv;

      if (isHeadlineEqual && isTypeEqual && isWageringEqual && isMaxConvEqual) {
        // Identical fields: do not create new Bonus record. Update updated_at & verified_at
        console.log(`[BonusService] Active bonus ${existingBonus.id} is identical. Updating updated_at/verified_at.`);
        return prisma.bonus.update({
          where: { id: existingBonus.id },
          data: {
            updated_at: now,
            verified_at: now,
          },
        });
      }

      // If any field differs: start Prisma transaction to log BonusHistoryEvent for each differing field
      console.log(`[BonusService] Active bonus ${existingBonus.id} has updated fields. Logging history and updating bonus.`);
      const diffs: { field: string; oldVal: string | null; newVal: string | null }[] = [];

      if (!isHeadlineEqual) {
        diffs.push({ field: "headline_value", oldVal: existingHeadline, newVal: candidateHeadline });
      }
      if (!isTypeEqual) {
        diffs.push({ field: "type", oldVal: existingType, newVal: candidateType });
      }
      if (!isWageringEqual) {
        diffs.push({
          field: "wagering_requirement",
          oldVal: existingWagering !== null ? String(existingWagering) : null,
          newVal: candidateWagering !== null ? String(candidateWagering) : null,
        });
      }
      if (!isMaxConvEqual) {
        diffs.push({
          field: "max_conversion",
          oldVal: existingMaxConv !== null ? String(existingMaxConv) : null,
          newVal: candidateMaxConv !== null ? String(candidateMaxConv) : null,
        });
      }

      return prisma.$transaction(async (tx) => {
        for (const diff of diffs) {
          await tx.bonusHistoryEvent.create({
            data: {
              bonus_id: existingBonus.id,
              field_changed: diff.field,
              old_value: diff.oldVal,
              new_value: diff.newVal,
              source_url: sourceUrl || null,
              changed_at: now,
            },
          });
        }

        return tx.bonus.update({
          where: { id: existingBonus.id },
          data: {
            headline_value: candidateHeadline,
            type: candidateType,
            wagering_requirement: candidateWagering,
            max_conversion: candidateMaxConv,
            true_value_score: trueValueScore,
            valid_from: data.valid_from ?? existingBonus.valid_from,
            valid_until: data.valid_until ?? existingBonus.valid_until,
            status: data.status || "ACTIVE",
            updated_at: now,
            verified_at: now,
          },
        });
      });
    }

    // No active bonus exists, create a new Bonus record with status ACTIVE
    return prisma.bonus.create({
      data: {
        ...data,
        status: data.status || "ACTIVE",
        true_value_score: trueValueScore,
        created_at: now,
        updated_at: now,
        verified_at: now,
      },
    });
  }
}
