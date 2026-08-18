import { prisma } from "@savvyedge/database";
import { INGESTION_QUEUE_NAME } from "../constants/queue-names";
import { JobQueueService } from "./job-queue.service";

/**
 * Ingestion control plane.
 *
 * This module is the Vercel-facing (serverless) half of ingestion: it only
 * records intent (DataSource + ScrapeJob) and enqueues the canonical
 * CRAWL_URL job. It must never import worker/execution-plane code
 * (@savvyedge/ai-agents, Playwright, orchestrator handlers) — all crawling and
 * extraction happens exclusively in the Railway orchestrator worker.
 *
 * Keep the transitive import graph of this file limited to database + queue
 * primitives. `tests/ingestion-entrypoint-boundary.test.ts` enforces this.
 */

export interface IngestBonusInput {
  url: string;
  casino_id?: string;
  taskContext?: "BONUS" | "GAME_LIST";
}

/**
 * Sanitizes a URL for safe operational logging.
 * Strips authentication credentials, query parameters, path tokens, and hash fragments.
 * Returns only protocol + host (e.g. "https://example.com").
 */
export function sanitizeUrlForLogging(
  rawUrl: string | undefined | null,
): string {
  if (!rawUrl || typeof rawUrl !== "string") {
    return "<unknown-url>";
  }
  try {
    const parsed = new URL(rawUrl.trim());
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return "<invalid-url>";
  }
}

export class IngestionEnqueueService {
  /**
   * Enqueues an ingestion pipeline for a given URL.
   * Asynchronous entrypoint — returns as soon as the job is queued.
   */
  public static async enqueueIngestion({ url, casino_id, taskContext = "BONUS" }: IngestBonusInput) {
    const safeUrl = sanitizeUrlForLogging(url);
    console.log(`[IngestionService] Enqueueing ingestion for URL: ${safeUrl} (context: ${taskContext})`);

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

    // 2. Create ScrapeJob
    const scrapeJob = await prisma.scrapeJob.create({
      data: {
        data_source_id: dataSource.id,
        status: "PROCESSING",
        started_at: new Date(),
        retry_count: 0,
      },
    });

    // 3. Enqueue CRAWL_URL job
    await JobQueueService.enqueue(INGESTION_QUEUE_NAME, "CRAWL_URL", {
      scrapeJobId: scrapeJob.id,
      url,
      casinoId: casino_id,
      taskContext,
    });

    return scrapeJob;
  }
}
