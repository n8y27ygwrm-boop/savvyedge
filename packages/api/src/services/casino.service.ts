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

  static async resolveOrCreateCasino(input: {
    name: string;
    slug: string;
    domain: string;
    website_url?: string | null;
    license_info?: string | null;
  }) {
    const cleanDomain = input.domain.replace(/^www\./, "").toLowerCase();
    const websiteUrl = input.website_url || `https://${cleanDomain}`;

    // 1. Search existing casino by website_url or domain or slug
    const existingCasino = await prisma.casino.findFirst({
      where: {
        OR: [
          { website_url: { contains: cleanDomain, mode: "insensitive" } },
          { slug: input.slug.toLowerCase() },
        ],
      },
    });

    if (existingCasino) {
      console.log(`[CasinoService] Found existing Casino ID: ${existingCasino.id} for domain: ${cleanDomain}`);
      return existingCasino;
    }

    // 2. Create new Casino if not existing
    let finalSlug = input.slug.toLowerCase();
    const existingSlug = await prisma.casino.findUnique({ where: { slug: finalSlug } });
    if (existingSlug) {
      finalSlug = `${finalSlug}-${Date.now().toString(36)}`;
    }

    console.log(`[CasinoService] Creating new Casino record for brand '${input.name}' (slug: ${finalSlug})`);
    return prisma.casino.create({
      data: {
        name: input.name,
        slug: finalSlug,
        website_url: websiteUrl,
        license_info: input.license_info || null,
        status: "ACTIVE",
        verified_at: new Date(),
      },
    });
  }
}
