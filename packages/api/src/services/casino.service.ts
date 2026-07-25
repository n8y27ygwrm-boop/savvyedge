import { Prisma, PublicationStatus, ReviewStatus, prisma } from "@savvyedge/database";
import { CreateCasinoInput } from "@savvyedge/types";
import { AIEngine } from "@savvyedge/ai-agents";

export class CasinoService {
  static async getCasinos({ page = 1, limit = 50 }: { page?: number; limit?: number }) {
    const skip = (page - 1) * limit;
    
    const [data, total] = await Promise.all([
      prisma.casino.findMany({
        skip,
        take: limit,
        orderBy: { verified_at: 'desc' },
        include: {
          bonuses: true,
          licenses: true,
        },
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
        licenses: true,
        history_events: true,
      },
    });
  }

  static async createCasino(data: CreateCasinoInput, db: Prisma.TransactionClient | typeof prisma = prisma) {
    const isDevMock = new AIEngine().getActiveProvider().constructor.name === "DevAIProvider";
    return db.casino.create({
      data: {
        ...data,
        status: data.status || "ACTIVE",
        verified_at: null,
        data_source_type: isDevMock ? "DEV_MOCK" : "SCRAPED",
        review_status: ReviewStatus.NEW,
        publication_status: PublicationStatus.UNPUBLISHED,
        quarantine_reason: null,
        governance_version: 0,
      },
    });
  }

  static async resolveOrCreateCasino(
    input: {
      name: string;
      slug: string;
      domain: string;
      website_url?: string | null;
      license_info?: string | null;
    },
    db: Prisma.TransactionClient | typeof prisma = prisma
  ): Promise<{ casino: any; isNew: boolean; isApprovedOrPublished: boolean; hasFieldDiffs: boolean }> {
    const cleanDomain = input.domain.replace(/^www\./, "").toLowerCase();
    const websiteUrl = input.website_url || `https://${cleanDomain}`;

    // 1. Search existing casino by website_url or domain or slug
    const existingCasino = await db.casino.findFirst({
      where: {
        OR: [
          { website_url: { contains: cleanDomain, mode: "insensitive" } },
          { slug: input.slug.toLowerCase() },
        ],
      },
    });

    if (existingCasino) {
      console.log(`[CasinoService] Found existing Casino ID: ${existingCasino.id} for domain: ${cleanDomain}`);
      const isApprovedOrPublished =
        existingCasino.review_status === ReviewStatus.APPROVED ||
        existingCasino.publication_status === PublicationStatus.PUBLISHED;

      const hasFieldDiffs =
        (input.name && input.name !== existingCasino.name) ||
        (websiteUrl && websiteUrl !== existingCasino.website_url) ||
        (input.license_info !== undefined && input.license_info !== existingCasino.license_info);

      return { casino: existingCasino, isNew: false, isApprovedOrPublished, hasFieldDiffs: Boolean(hasFieldDiffs) };
    }

    // 2. Create new Casino if not existing
    let finalSlug = input.slug.toLowerCase();
    const existingSlug = await db.casino.findUnique({ where: { slug: finalSlug } });
    if (existingSlug) {
      finalSlug = `${finalSlug}-${Date.now().toString(36)}`;
    }

    console.log(`[CasinoService] Creating new Casino record for brand '${input.name}' (slug: ${finalSlug})`);
    const isDevMock = new AIEngine().getActiveProvider().constructor.name === "DevAIProvider";

    const created = await db.casino.create({
      data: {
        name: input.name,
        slug: finalSlug,
        website_url: websiteUrl,
        license_info: input.license_info || null,
        status: "ACTIVE",
        verified_at: null,
        data_source_type: isDevMock ? "DEV_MOCK" : "SCRAPED",
        review_status: ReviewStatus.NEW,
        publication_status: PublicationStatus.UNPUBLISHED,
        quarantine_reason: null,
        governance_version: 0,
      },
    });

    return { casino: created, isNew: true, isApprovedOrPublished: false, hasFieldDiffs: false };
  }
}
