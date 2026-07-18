import { prisma } from "@savvyedge/database";
import { CreateCasinoInput } from "@savvyedge/types";

export class CasinoService {
  static async getCasinos({ page = 1, limit = 50 }: { page?: number; limit?: number }) {
    const skip = (page - 1) * limit;
    
    const [data, total] = await Promise.all([
      prisma.casino.findMany({
        skip,
        take: limit,
        orderBy: { verified_at: 'desc' },
      }),
      prisma.casino.count(),
    ]);

    return { data, meta: { page, limit, total } };
  }

  static async getCasinoBySlug(slug: string) {
    return prisma.casino.findUnique({
      where: { slug },
      include: {
        bonuses: true,
      }
    });
  }

  static async createCasino(data: CreateCasinoInput) {
    return prisma.casino.create({
      data,
    });
  }
}
