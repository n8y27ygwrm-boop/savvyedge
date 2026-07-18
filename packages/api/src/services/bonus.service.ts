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

  static async createBonus(data: CreateBonusInput) {
    // Basic True Value Calculation Placeholder
    // Formula logic will evolve, but currently (headline_value - (wagering_req * max_conversion_penalty)) etc.
    let trueValueScore = 0;
    
    if (data.headline_value && data.wagering_requirement) {
      // Very naive placeholder for MVP
      const baseVal = parseFloat(data.headline_value.replace(/[^0-9.]/g, '')) || 0;
      trueValueScore = baseVal > 0 ? baseVal / data.wagering_requirement : 0;
    }

    return prisma.bonus.create({
      data: {
        ...data,
        true_value_score: trueValueScore,
      },
    });
  }
}
