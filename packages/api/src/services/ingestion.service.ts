import { prisma } from "@savvyedge/database";
import { ScraperAgent, BonusAgent } from "@savvyedge/ai-agents";
import { BonusService } from "./bonus.service";

export interface IngestBonusInput {
  url: string;
  casino_id?: string;
}

export class IngestionService {
  private static scraperAgent = new ScraperAgent();
  private static bonusAgent = new BonusAgent();

  public static async ingestBonusFromUrl({ url, casino_id }: IngestBonusInput) {
    const startTime = Date.now();
    console.log(`[IngestionService] Starting ingestion for URL: ${url}`);

    // 1. Ensure a valid Casino ID exists
    let activeCasinoId = casino_id;
    if (!activeCasinoId) {
      let defaultCasino = await prisma.casino.findFirst({
        where: { slug: "canonical-benchmark-casino" },
      });

      if (!defaultCasino) {
        defaultCasino = await prisma.casino.create({
          data: {
            slug: "canonical-benchmark-casino",
            name: "Canonical Benchmark Casino",
            status: "ACTIVE",
            license_info: "MGA/B2C/100/2024",
            website_url: "https://example-casino.com",
            verified_at: new Date(),
          },
        });
      }
      activeCasinoId = defaultCasino.id;
    }

    // 2. Fetch and extract page text
    const scrapeResult = await this.scraperAgent.run({ url });

    // 3. Process raw text via BonusAgent -> Zod Validated CreateBonusInput
    const bonusInput = await this.bonusAgent.run({
      rawBonusText: scrapeResult.content,
      casino_id: activeCasinoId,
    });

    // 4. Persist Bonus into PostgreSQL via BonusService
    const savedBonus = await BonusService.createBonus(bonusInput);

    // 5. Audit ScrapeJob entry in PostgreSQL
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
      scrapeJob,
      meta: {
        durationMs,
        extractedContentLength: scrapeResult.content.length,
      },
    };
  }
}
