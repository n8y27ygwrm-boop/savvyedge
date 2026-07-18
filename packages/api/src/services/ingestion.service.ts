import { prisma } from "@savvyedge/database";
import { ScraperAgent, BonusAgent, CasinoResolutionAgent } from "@savvyedge/ai-agents";
import { BonusService } from "./bonus.service";
import { CasinoService } from "./casino.service";

export interface IngestBonusInput {
  url: string;
  casino_id?: string;
}

export class IngestionService {
  private static scraperAgent = new ScraperAgent();
  private static bonusAgent = new BonusAgent();
  private static casinoResolutionAgent = new CasinoResolutionAgent();

  public static async ingestBonusFromUrl({ url, casino_id }: IngestBonusInput) {
    const startTime = Date.now();
    console.log(`[IngestionService] Starting ingestion for URL: ${url}`);

    // 1. Fetch and extract page text & HTML metadata
    const scrapeResult = await this.scraperAgent.run({ url });

    // 2. Extract domain from URL
    let domain = "example.com";
    try {
      domain = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      domain = url;
    }

    // 3. Resolve Casino Entity (no fallback to benchmark casino)
    let activeCasino;
    if (casino_id) {
      activeCasino = await prisma.casino.findUnique({ where: { id: casino_id } });
    }

    if (!activeCasino) {
      console.log(`[IngestionService] Resolving casino entity for domain '${domain}'...`);
      const resolvedIdentity = await this.casinoResolutionAgent.run({
        url,
        domain,
        pageMetadata: scrapeResult.metadata,
        scrapedContentSnippet: scrapeResult.content,
      });

      activeCasino = await CasinoService.resolveOrCreateCasino({
        name: resolvedIdentity.name,
        slug: resolvedIdentity.slug,
        domain: resolvedIdentity.domain || domain,
        website_url: resolvedIdentity.website_url,
        license_info: resolvedIdentity.license_info,
      });
    }

    // 4. Process raw text via BonusAgent -> Zod Validated CreateBonusInput attached to activeCasino.id
    const bonusInput = await this.bonusAgent.run({
      rawBonusText: scrapeResult.content,
      casino_id: activeCasino.id,
    });

    // 5. Persist Bonus into PostgreSQL via BonusService
    const savedBonus = await BonusService.createBonus(bonusInput);

    // 6. Audit ScrapeJob entry in PostgreSQL
    const durationMs = Date.now() - startTime;
    const dataSource = await prisma.dataSource.create({
      data: {
        url,
        source_type: "CASINO_PROMOTION_PAGE",
        last_scraped_at: new Date(),
      },
    });

    const scrapeJob = await prisma.scrapeJob.create({
      data: {
        data_source_id: dataSource.id,
        status: "COMPLETED",
        started_at: new Date(startTime),
        completed_at: new Date(),
      },
    });

    return {
      bonus: savedBonus,
      casino: activeCasino,
      scrapeJob,
      meta: {
        durationMs,
        extractedContentLength: scrapeResult.content.length,
      },
    };
  }
}
