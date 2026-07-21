import { prisma } from "@savvyedge/database";
import { ScraperAgent, BonusAgent, CasinoResolutionAgent, GameListAgent } from "@savvyedge/ai-agents";
import { BonusService } from "./bonus.service";
import { CasinoService } from "./casino.service";
import { JobQueueService } from "./job-queue.service";

export interface IngestBonusInput {
  url: string;
  casino_id?: string;
  taskContext?: "BONUS" | "GAME_LIST";
}

export class IngestionService {
  private static scraperAgent = new ScraperAgent();
  private static bonusAgent = new BonusAgent();
  private static casinoResolutionAgent = new CasinoResolutionAgent();
  private static gameListAgent = new GameListAgent();

  /**
   * Enqueues an ingestion pipeline for a given URL.
   * This is the asynchronous entrypoint.
   */
  public static async enqueueIngestion({ url, casino_id, taskContext = "BONUS" }: IngestBonusInput) {
    console.log(`[IngestionService] Enqueueing ingestion for URL: ${url} (context: ${taskContext})`);

    if (taskContext === "GAME_LIST" && !casino_id) {
      throw new Error("GAME_LIST ingestion requires a casino_id");
    }

    const sourceType = taskContext === "GAME_LIST" ? "CASINO_GAME_LOBBY_PAGE" : "CASINO_PROMOTION_PAGE";

    // 1. Find or create DataSource
    let dataSource = await prisma.dataSource.findFirst({ where: { url } });
    if (!dataSource) {
      dataSource = await prisma.dataSource.create({
        data: {
          url,
          source_type: sourceType,
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
      taskContext,
    });

    return scrapeJob;
  }

  /**
   * The crawl handler (Step 1)
   */
  public static async handleCrawl(payload: {
    scrapeJobId: string;
    url: string;
    casinoId?: string;
    taskContext?: "BONUS" | "GAME_LIST";
  }) {
    const { scrapeJobId, url, casinoId, taskContext = "BONUS" } = payload;
    console.log(`[IngestionService] [Worker] Crawling URL: ${url} (context: ${taskContext})`);

    // Run Playwright Scraper
    let scrapeResult;
    try {
      scrapeResult = await this.scraperAgent.run({ url });
    } catch (err: any) {
      await prisma.scrapeJob.update({
        where: { id: scrapeJobId },
        data: {
          status: "FAILED",
          error_log: err.stack || err.message || String(err),
          completed_at: new Date(),
        },
      });
      throw err;
    }

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

    // Enqueue extraction step based on taskContext
    if (taskContext === "GAME_LIST") {
      if (!casinoId) {
        throw new Error("GAME_LIST crawl payload missing mandatory casinoId");
      }
      await JobQueueService.enqueue("ingestion-queue", "EXTRACT_GAME_LIST", {
        scrapeJobId,
        url,
        casinoId,
        scrapedContent: scrapeResult.content,
      });
    } else {
      await JobQueueService.enqueue("ingestion-queue", "EXTRACT_BONUS", {
        scrapeJobId,
        url,
        casinoId,
        scrapedContent: scrapeResult.content,
        scrapedMetadata: scrapeResult.metadata,
      });
    }
  }

  /**
   * The extraction handler (Step 2 - Bonus)
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
   * The extraction handler (Step 2 - Game List)
   */
  public static async handleGameListExtraction(payload: {
    scrapeJobId: string;
    url: string;
    casinoId: string;
    scrapedContent: string;
  }) {
    const { scrapeJobId, url, casinoId, scrapedContent } = payload;
    console.log(`[IngestionService] [Worker] Extracting game list for Casino ${casinoId} from URL: ${url}`);

    const gameListResult = await this.gameListAgent.run({
      url,
      casinoId,
      scrapedContent,
    });

    const existingSlots = await prisma.slot.findMany();

    const normalizeGameName = (name: string): string => {
      return name
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ")
        .replace(/['’\.]/g, "");
    };

    const slotMap = new Map<string, string>();
    for (const slot of existingSlots) {
      slotMap.set(normalizeGameName(slot.name), slot.id);
    }

    let matchedCount = 0;
    const unmatchedNames: string[] = [];

    for (const game of gameListResult.games) {
      const normalizedInputName = normalizeGameName(game.name);
      const matchedSlotId = slotMap.get(normalizedInputName);

      if (matchedSlotId) {
        matchedCount++;
        await prisma.casinoSlot.upsert({
          where: {
            casino_id_slot_id: {
              casino_id: casinoId,
              slot_id: matchedSlotId,
            },
          },
          update: {
            source_url: url,
            verified_at: new Date(),
          },
          create: {
            casino_id: casinoId,
            slot_id: matchedSlotId,
            source_url: url,
            verified_at: new Date(),
          },
        });
      } else {
        unmatchedNames.push(game.name);
      }
    }

    console.log(
      `[GameListExtraction] Casino ${casinoId}: ${gameListResult.games.length} games extracted, ${matchedCount} matched to existing slots, ${unmatchedNames.length} unmatched: [${unmatchedNames.join(", ")}]`
    );

    await prisma.scrapeJob.update({
      where: { id: scrapeJobId },
      data: {
        status: "COMPLETED",
        completed_at: new Date(),
      },
    });
  }

  /**
   * Returns a map of handlers for the worker
   */
  public static getQueueHandlers() {
    return {
      CRAWL_URL: (payload: any) => this.handleCrawl(payload),
      EXTRACT_BONUS: (payload: any) => this.handleExtraction(payload),
      EXTRACT_GAME_LIST: (payload: any) => this.handleGameListExtraction(payload),
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
