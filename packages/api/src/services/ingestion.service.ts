import crypto from "crypto";
import {
  prisma,
  ActorKind,
  EvidenceType,
  EvidenceVerdict,
  CasinoEvidenceField,
  BonusEvidenceField,
  ReviewStatus,
  PublicationStatus,
} from "@savvyedge/database";
import { ScraperAgent, BonusAgent, CasinoResolutionAgent, GameListAgent } from "@savvyedge/ai-agents";
import { BonusService } from "./bonus.service";
import { CasinoService } from "./casino.service";
import { JobQueueService } from "./job-queue.service";
import { WorkflowTransitionService } from "./workflow-transition.service";
import { PublicationGateService } from "./publication-gate.service";

function hashString(val: string): string {
  return crypto.createHash("sha256").update(val.trim().toLowerCase()).digest("hex").slice(0, 16);
}

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
   * Asynchronous entrypoint.
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

    let scrapeResult;
    try {
      scrapeResult = await this.scraperAgent.run({ url });
    } catch (err: any) {
      console.error(`[IngestionService] [Worker] Crawl failed for URL: ${url}`, err);
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

    const currentJob = await prisma.scrapeJob.findUniqueOrThrow({
      where: { id: scrapeJobId },
    });

    await prisma.scrapeJob.update({
      where: { id: scrapeJobId },
      data: {
        snapshot_path: scrapeResult.snapshotPath || null,
        html_hash: scrapeResult.htmlHash || null,
        content_hash: scrapeResult.contentHash || null,
        canonical_url: scrapeResult.canonicalUrl || null,
      },
    });

    // Check for identical content hash from previous job
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
    scrapeJobId?: string;
    url: string;
    casinoId?: string;
    scrapedContent: string;
    scrapedMetadata?: any;
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

    // 2. AI Entity Resolution (executed outside DB transaction)
    let initialCasino = casinoId ? await prisma.casino.findUnique({ where: { id: casinoId } }) : null;
    let resolvedIdentity: { name: string; slug: string; domain?: string; website_url?: string; license_info?: string | null } | null = null;

    if (!initialCasino) {
      console.log(`[IngestionService] [Worker] Resolving casino entity for domain '${domain}'...`);
      resolvedIdentity = await this.casinoResolutionAgent.run({
        url,
        domain,
        pageMetadata: scrapedMetadata,
        scrapedContentSnippet: scrapedContent,
      });
    }

    const dummyCasinoId = "00000000-0000-0000-0000-000000000000";
    const targetCasinoId = initialCasino?.id || dummyCasinoId;
    const bonusInput = await this.bonusAgent.run({
      rawBonusText: scrapedContent,
      casino_id: targetCasinoId,
    });

    // 3. Governed Persistence inside a Single Atomic Transaction
    const { casino, bonus, evidence } = await prisma.$transaction(async (tx) => {
      // a. Resolve/Upsert Service Actor (service:ingestion)
      const actor = await tx.reviewActor.upsert({
        where: { stable_key: "service:ingestion" },
        update: { active: true },
        create: {
          kind: ActorKind.SERVICE,
          stable_key: "service:ingestion",
          display_name: "Ingestion Service",
          active: true,
        },
        select: { id: true },
      });

      // b. Resolve or Create Casino
      let activeCasino = initialCasino;
      let isNewCasino = false;
      let isCasinoApprovedOrPublished = false;
      let hasCasinoFieldDiffs = false;
      if (!activeCasino) {
        const res = await CasinoService.resolveOrCreateCasino({
          name: resolvedIdentity!.name,
          slug: resolvedIdentity!.slug,
          domain: resolvedIdentity!.domain || domain,
          website_url: resolvedIdentity!.website_url,
          license_info: resolvedIdentity!.license_info ?? null,
        }, tx);
        activeCasino = res.casino;
        isNewCasino = res.isNew;
        isCasinoApprovedOrPublished = res.isApprovedOrPublished;
        hasCasinoFieldDiffs = res.hasFieldDiffs;
      } else {
        isCasinoApprovedOrPublished =
          activeCasino.review_status === ReviewStatus.APPROVED ||
          activeCasino.publication_status === PublicationStatus.PUBLISHED;
        hasCasinoFieldDiffs =
          Boolean(resolvedIdentity?.name && resolvedIdentity.name !== activeCasino.name) ||
          Boolean(resolvedIdentity?.website_url && resolvedIdentity.website_url !== activeCasino.website_url) ||
          Boolean(resolvedIdentity?.license_info !== undefined && resolvedIdentity.license_info !== activeCasino.license_info);
      }

      const safeCasino = activeCasino!;

      // c. Create or Update Bonus
      const bonusPayload = { ...bonusInput, casino_id: safeCasino.id };
      const {
        bonus: savedBonus,
        isNew: isNewBonus,
        isApprovedOrPublished: isBonusApprovedOrPublished,
        hasFieldDiffs: hasBonusFieldDiffs,
      } = await BonusService.saveGovernedBonus(bonusPayload, url, tx);

      // d. Resolve DataSource & ScrapeJob
      const scrapeJob = scrapeJobId ? await tx.scrapeJob.findUnique({ where: { id: scrapeJobId } }) : null;
      let dataSourceId = scrapeJob ? scrapeJob.data_source_id : null;
      if (!dataSourceId) {
        let ds = await tx.dataSource.findFirst({ where: { url } });
        if (!ds) {
          ds = await tx.dataSource.create({
            data: {
              url,
              source_type: "CASINO_PROMOTION_PAGE",
              last_scraped_at: new Date(),
            },
          });
        }
        dataSourceId = ds.id;
      }

      // e. Create Single Shared EvidenceRecord
      const now = new Date();
      const evidenceRecord = await tx.evidenceRecord.create({
        data: {
          data_source_id: dataSourceId,
          scrape_job_id: scrapeJob ? scrapeJob.id : null,
          evidence_type: EvidenceType.OPERATOR_PAGE,
          source_url: url,
          snapshot_path: scrapeJob?.snapshot_path || null,
          html_hash: scrapeJob?.html_hash || null,
          content_hash: scrapeJob?.content_hash || null,
          observed_at: scrapeJob?.started_at || now,
          extracted_at: now,
          created_by_id: actor.id,
        },
      });

      // f. Create Casino Evidence Claims
      const casinoClaimIds: string[] = [];
      const casinoObservedName = resolvedIdentity?.name || safeCasino.name;
      const casinoObservedUrl = resolvedIdentity?.website_url || safeCasino.website_url;
      const casinoObservedLicense = resolvedIdentity?.license_info ?? safeCasino.license_info;

      if (isNewCasino || hasCasinoFieldDiffs) {
        if (casinoObservedName) {
          const claim = await tx.casinoEvidenceClaim.create({
            data: {
              evidence_id: evidenceRecord.id,
              casino_id: safeCasino.id,
              field: CasinoEvidenceField.NAME,
              observed_value: casinoObservedName,
              normalized_value_hash: `normalizer-v1:NAME:${hashString(casinoObservedName)}`,
              verdict: EvidenceVerdict.SUPPORTS,
            },
          });
          casinoClaimIds.push(claim.id);
        }
        if (casinoObservedUrl) {
          const host = PublicationGateService.normalizeDomainHost(casinoObservedUrl);
          const claim = await tx.casinoEvidenceClaim.create({
            data: {
              evidence_id: evidenceRecord.id,
              casino_id: safeCasino.id,
              field: CasinoEvidenceField.WEBSITE_HOST,
              observed_value: casinoObservedUrl,
              normalized_value_hash: `normalizer-v1:WEBSITE_HOST:${hashString(host)}`,
              verdict: EvidenceVerdict.SUPPORTS,
            },
          });
          casinoClaimIds.push(claim.id);
        }
        if (casinoObservedLicense) {
          const claim = await tx.casinoEvidenceClaim.create({
            data: {
              evidence_id: evidenceRecord.id,
              casino_id: safeCasino.id,
              field: CasinoEvidenceField.LICENSE_ASSOCIATION,
              observed_value: casinoObservedLicense,
              normalized_value_hash: `normalizer-v1:LICENSE:${hashString(casinoObservedLicense)}`,
              verdict: EvidenceVerdict.SUPPORTS,
            },
          });
          casinoClaimIds.push(claim.id);
        }
      }

      // g. Create Bonus Evidence Claims from newly extracted bonusInput
      const bonusClaimIds: string[] = [];
      const extractedType = bonusInput.type || savedBonus.type;
      if (extractedType) {
        const claim = await tx.bonusEvidenceClaim.create({
          data: {
            evidence_id: evidenceRecord.id,
            bonus_id: savedBonus.id,
            field: BonusEvidenceField.TYPE,
            observed_value: extractedType,
            normalized_value_hash: `normalizer-v1:TYPE:${hashString(extractedType)}`,
            verdict: EvidenceVerdict.SUPPORTS,
          },
        });
        bonusClaimIds.push(claim.id);
      }

      if (bonusInput.headline_value) {
        const capParse = PublicationGateService.parseStructuredMonetaryCap(bonusInput.headline_value);
        if (capParse.status === "VALID") {
          const claim = await tx.bonusEvidenceClaim.create({
            data: {
              evidence_id: evidenceRecord.id,
              bonus_id: savedBonus.id,
              field: BonusEvidenceField.HEADLINE_VALUE,
              observed_value: bonusInput.headline_value,
              normalized_value_hash: `normalizer-v1:HEADLINE:${hashString(bonusInput.headline_value)}`,
              verdict: EvidenceVerdict.SUPPORTS,
            },
          });
          bonusClaimIds.push(claim.id);
        }
      }

      if (bonusInput.wagering_requirement !== null && bonusInput.wagering_requirement !== undefined) {
        const claim = await tx.bonusEvidenceClaim.create({
          data: {
            evidence_id: evidenceRecord.id,
            bonus_id: savedBonus.id,
            field: BonusEvidenceField.WAGERING_REQUIREMENT,
            observed_value: String(bonusInput.wagering_requirement),
            normalized_value_hash: `normalizer-v1:WAGERING:${bonusInput.wagering_requirement}`,
            verdict: EvidenceVerdict.SUPPORTS,
          },
        });
        bonusClaimIds.push(claim.id);
      }

      if (bonusInput.max_conversion !== null && bonusInput.max_conversion !== undefined) {
        const claim = await tx.bonusEvidenceClaim.create({
          data: {
            evidence_id: evidenceRecord.id,
            bonus_id: savedBonus.id,
            field: BonusEvidenceField.MAX_CONVERSION,
            observed_value: String(bonusInput.max_conversion),
            normalized_value_hash: `normalizer-v1:MAX_CONVERSION:${bonusInput.max_conversion}`,
            verdict: EvidenceVerdict.SUPPORTS,
          },
        });
        bonusClaimIds.push(claim.id);
      }

      if (bonusInput.valid_from) {
        const claim = await tx.bonusEvidenceClaim.create({
          data: {
            evidence_id: evidenceRecord.id,
            bonus_id: savedBonus.id,
            field: BonusEvidenceField.VALID_FROM,
            observed_value: bonusInput.valid_from instanceof Date ? bonusInput.valid_from.toISOString() : String(bonusInput.valid_from),
            normalized_value_hash: `normalizer-v1:VALID_FROM:${hashString(String(bonusInput.valid_from))}`,
            verdict: EvidenceVerdict.SUPPORTS,
          },
        });
        bonusClaimIds.push(claim.id);
      }

      if (bonusInput.valid_until) {
        const claim = await tx.bonusEvidenceClaim.create({
          data: {
            evidence_id: evidenceRecord.id,
            bonus_id: savedBonus.id,
            field: BonusEvidenceField.VALID_UNTIL,
            observed_value: bonusInput.valid_until instanceof Date ? bonusInput.valid_until.toISOString() : String(bonusInput.valid_until),
            normalized_value_hash: `normalizer-v1:VALID_UNTIL:${hashString(String(bonusInput.valid_until))}`,
            verdict: EvidenceVerdict.SUPPORTS,
          },
        });
        bonusClaimIds.push(claim.id);
      }

      // h. Execute Governed Workflow Transitions (NEW -> AWAITING_REVIEW or APPROVED -> AWAITING_REVIEW)
      const workflowService = new WorkflowTransitionService(tx as any);

      if (isNewCasino && casinoClaimIds.length > 0) {
        await workflowService.transitionCasinoReview({
          subjectId: safeCasino.id,
          actorId: actor.id,
          expectedVersion: 0,
          toStatus: ReviewStatus.AWAITING_REVIEW,
          claimIds: casinoClaimIds,
        });
      } else if (!isNewCasino && isCasinoApprovedOrPublished && hasCasinoFieldDiffs && casinoClaimIds.length > 0) {
        await workflowService.transitionCasinoReview({
          subjectId: safeCasino.id,
          actorId: actor.id,
          expectedVersion: safeCasino.governance_version,
          toStatus: ReviewStatus.AWAITING_REVIEW,
          claimIds: casinoClaimIds,
        });
      }

      if (isNewBonus && bonusClaimIds.length > 0) {
        await workflowService.transitionBonusReview({
          subjectId: savedBonus.id,
          actorId: actor.id,
          expectedVersion: 0,
          toStatus: ReviewStatus.AWAITING_REVIEW,
          claimIds: bonusClaimIds,
        });
      } else if (!isNewBonus && isBonusApprovedOrPublished && hasBonusFieldDiffs && bonusClaimIds.length > 0) {
        await workflowService.transitionBonusReview({
          subjectId: savedBonus.id,
          actorId: actor.id,
          expectedVersion: savedBonus.governance_version,
          toStatus: ReviewStatus.AWAITING_REVIEW,
          claimIds: bonusClaimIds,
        });
      }

      // i. Mark ScrapeJob Completed
      if (scrapeJobId) {
        await tx.scrapeJob.update({
          where: { id: scrapeJobId },
          data: {
            status: "COMPLETED",
            completed_at: now,
          },
        });
      }

      return { casino: safeCasino, bonus: savedBonus, evidence: evidenceRecord };
    });

    console.log(`[IngestionService] [Worker] Extraction complete. Linked Casino ID: ${casino.id}, Bonus ID: ${bonus.id}`);
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
