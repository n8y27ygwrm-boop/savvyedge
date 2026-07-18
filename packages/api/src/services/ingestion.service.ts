import { prisma } from "@savvyedge/database";
import { ScraperAgent, BonusAgent, CasinoResolutionAgent } from "@savvyedge/ai-agents";
import { BonusService } from "./bonus.service";
import { CasinoService } from "./casino.service";
import { JobQueueService } from "./job-queue.service";

export interface IngestBonusInput {
  url: string;
  casino_id?: string;
}

export class IngestionService {
  private static scraperAgent = new ScraperAgent();
  private static bonusAgent = new BonusAgent();
  private static casinoResolutionAgent = new CasinoResolutionAgent();

  /**
   * Enqueues an ingestion pipeline for a given URL.
   * This is the asynchronous entrypoint.
   */
  public static async enqueueIngestion({ url, casino_id }: IngestBonusInput) {
    console.log(`[IngestionService] Enqueueing ingestion for URL: ${url}`);

    // 1. Find or create DataSource
    let dataSource = await prisma.dataSource.findFirst({ where: { url } });
    if (!dataSource) {
      dataSource = await prisma.dataSource.create({
        data: {
          url,
          source_type: "CASINO_PROMOTION_PAGE",
          last_scraped_at: new Date(),
        },
      });
    } else {
      await prisma.dataSource.update({
        where: { id: dataSource.id },
        data: { last_scraped_at: new Date() },
      });
    }

    // 2. Create ScrapeJob in PROCESSING state
    const scrapeJob = await prisma.scrapeJob.create({
      data: {
        data_source_id: dataSource.id,
        status: "PROCESSING",
        started_at: new Date(),
        retry_count: 0,
      },
    });

    // 3. Enqueue CRAWL_URL job
    await JobQueueService.enqueue("ingestion-queue", "CRAWL_URL", {
      scrapeJobId: scrapeJob.id,
      url,
      casinoId: casino_id,
    });

    return scrapeJob;
  }

  /**
   * The crawl handler (Step 1)
   */
  public static async handleCrawl(payload: { scrapeJobId: string; url: string; casinoId?: string }) {
    const { scrapeJobId, url, casinoId } = payload;
    console.log(`[IngestionService] [Worker] Crawling URL: ${url}`);

    // Run Playwright Scraper
    const scrapeResult = await this.scraperAgent.run({ url });

    // Fetch current job to get data_source_id
    const currentJob = await prisma.scrapeJob.findUniqueOrThrow({
      where: { id: scrapeJobId },
    });

    // Update ScrapeJob with snapshot path, hashes, and canonical URL
    await prisma.scrapeJob.update({
      where: { id: scrapeJobId },
      data: {
        snapshot_path: scrapeResult.snapshotPath || null,
        html_hash: scrapeResult.htmlHash || null,
        content_hash: scrapeResult.contentHash || null,
        canonical_url: scrapeResult.canonicalUrl || null,
      },
    });

    // Look up previous successful ScrapeJob for the same DataSource
    const previousJob = await prisma.scrapeJob.findFirst({
      where: {
        data_source_id: currentJob.data_source_id,
        status: "COMPLETED",
        id: { not: scrapeJobId },
      },
      orderBy: { completed_at: "desc" },
    });

    if (
      previousJob &&
      ((scrapeResult.contentHash && previousJob.content_hash === scrapeResult.contentHash) ||
        (scrapeResult.htmlHash && previousJob.html_hash === scrapeResult.htmlHash))
    ) {
      console.log(
        `[IngestionService] Content hash matches previous crawl. Short-circuiting ingestion. Skipping LLM parsing.`
      );
      await prisma.scrapeJob.update({
        where: { id: scrapeJobId },
        data: {
          status: "COMPLETED",
          completed_at: new Date(),
        },
      });
      return;
    }

    // Enqueue extraction step
    await JobQueueService.enqueue("ingestion-queue", "EXTRACT_BONUS", {
      scrapeJobId,
      url,
      casinoId,
      scrapedContent: scrapeResult.content,
      scrapedMetadata: scrapeResult.metadata,
    });
  }

  /**
   * The extraction handler (Step 2)
   */
  public static async handleExtraction(payload: {
    scrapeJobId: string;
    url: string;
    casinoId?: string;
    scrapedContent: string;
    scrapedMetadata: any;
  }) {
    const { scrapeJobId, url, casinoId, scrapedContent, scrapedMetadata } = payload;
    console.log(`[IngestionService] [Worker] Extracting entities for URL: ${url}`);

    // 1. Resolve domain
    let domain = "example.com";
    try {
      domain = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      domain = url;
    }

    // 2. Resolve Casino Entity
    let activeCasino;
    if (casinoId) {
      activeCasino = await prisma.casino.findUnique({ where: { id: casinoId } });
    }

    if (!activeCasino) {
      console.log(`[IngestionService] [Worker] Resolving casino entity for domain '${domain}'...`);
      const resolvedIdentity = await this.casinoResolutionAgent.run({
        url,
        domain,
        pageMetadata: scrapedMetadata,
        scrapedContentSnippet: scrapedContent,
      });

      activeCasino = await CasinoService.resolveOrCreateCasino({
        name: resolvedIdentity.name,
        slug: resolvedIdentity.slug,
        domain: resolvedIdentity.domain || domain,
        website_url: resolvedIdentity.website_url,
        license_info: resolvedIdentity.license_info,
      });
    }

    // 3. Process raw text via BonusAgent
    const bonusInput = await this.bonusAgent.run({
      rawBonusText: scrapedContent,
      casino_id: activeCasino.id,
    });

    // 4. Persist Bonus into PostgreSQL with deduplication and source_url
    const savedBonus = await BonusService.createBonus(bonusInput, url);

    // 5. Update ScrapeJob status to COMPLETED
    await prisma.scrapeJob.update({
      where: { id: scrapeJobId },
      data: {
        status: "COMPLETED",
        completed_at: new Date(),
      },
    });

    console.log(`[IngestionService] [Worker] Extraction complete. Linked Casino ID: ${activeCasino.id}, Bonus ID: ${savedBonus.id}`);
  }

  /**
   * Returns a map of handlers for the worker
   */
  public static getQueueHandlers() {
    return {
      CRAWL_URL: (payload: any) => this.handleCrawl(payload),
      EXTRACT_BONUS: (payload: any) => this.handleExtraction(payload),
    };
  }

  /**
   * Retained for backward compatibility (runs execution steps inline synchronously)
   */
  public static async ingestBonusFromUrl({ url, casino_id }: IngestBonusInput) {
    const startTime = Date.now();
    
    // Create job record and queue the crawl job
    const scrapeJob = await this.enqueueIngestion({ url, casino_id });
    
    // Execute crawl handler inline synchronously
    await this.handleCrawl({ scrapeJobId: scrapeJob.id, url, casinoId: casino_id });
    
    // Mark enqueued CRAWL_URL job for this scrapeJob as COMPLETED since executed inline
    await prisma.jobQueue.updateMany({
      where: {
        queue_name: "ingestion-queue",
        payload: { contains: scrapeJob.id },
        status: "PENDING",
      },
      data: { status: "COMPLETED" },
    });

    const updatedJob = await prisma.scrapeJob.findUniqueOrThrow({ where: { id: scrapeJob.id } });

    if (updatedJob.status === "COMPLETED") {
      console.log(`[IngestionService] Ingestion short-circuited for job ${scrapeJob.id}. Retrieving existing entities.`);
      let domain = "example.com";
      try {
        domain = new URL(url).hostname.replace(/^www\./, "");
      } catch {}

      const casino = await prisma.casino.findFirstOrThrow({
        where: {
          OR: [
            { website_url: { contains: domain, mode: "insensitive" } },
          ],
        },
        orderBy: { created_at: "desc" },
      });

      const bonus = await prisma.bonus.findFirstOrThrow({
        where: { casino_id: casino.id },
        orderBy: { created_at: "desc" },
      });

      return {
        bonus,
        casino,
        scrapeJob: updatedJob,
        meta: {
          durationMs: Date.now() - startTime,
          extractedContentLength: 0,
          snapshotPath: updatedJob.snapshot_path,
          shortCircuited: true,
        },
      };
    }

    // Find the queued EXTRACT_BONUS job that was created by handleCrawl
    const queuedJob = await prisma.jobQueue.findFirst({
      where: {
        queue_name: "ingestion-queue",
        task_type: "EXTRACT_BONUS",
        status: "PENDING",
      },
      orderBy: { created_at: "desc" },
    });
    
    if (!queuedJob) {
      throw new Error("Queued EXTRACT_BONUS job not found during synchronous execution");
    }
    
    const payload = JSON.parse(queuedJob.payload);
    await this.handleExtraction(payload);
    
    // Mark queued jobs as COMPLETED
    await prisma.jobQueue.updateMany({
      where: {
        queue_name: "ingestion-queue",
        payload: { contains: scrapeJob.id },
      },
      data: { status: "COMPLETED" },
    });

    // Retrieve database results
    const finalJob = await prisma.scrapeJob.findUniqueOrThrow({ where: { id: scrapeJob.id } });
    
    // Find resolved casino & bonus
    let domain = "example.com";
    try {
      domain = new URL(url).hostname.replace(/^www\./, "");
    } catch {}
    
    const casino = await prisma.casino.findFirstOrThrow({
      where: {
        OR: [
          { website_url: { contains: domain, mode: "insensitive" } },
        ],
      },
      orderBy: { created_at: "desc" },
    });
    
    const bonus = await prisma.bonus.findFirstOrThrow({
      where: { casino_id: casino.id },
      orderBy: { created_at: "desc" },
    });

    return {
      bonus,
      casino,
      scrapeJob: finalJob,
      meta: {
        durationMs: Date.now() - startTime,
        extractedContentLength: payload.scrapedContent.length,
        snapshotPath: finalJob.snapshot_path,
        shortCircuited: false,
      },
    };
  }
}
