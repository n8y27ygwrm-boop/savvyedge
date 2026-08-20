import { createHash, randomUUID } from "crypto";
import {
  ActorKind,
  BonusEvidenceField,
  EvidenceType,
  EvidenceVerdict,
  Prisma,
  PublicationStatus,
  ReviewStatus,
  prisma,
} from "@savvyedge/database";
import { CreateBonusInput } from "@savvyedge/types";
import {
  BonusAgent,
  ScraperAgent,
  normalizeBonusExtraction,
  type BonusSourceSemantics,
} from "@savvyedge/ai-agents";
import { evaluateSourcePageEligibility } from "./source-page-eligibility";
import { WorkflowTransitionService } from "./workflow-transition.service";
import { WorkflowTransitionError } from "./workflow-transition.errors";
import { BonusService } from "./bonus.service";
import {
  EXTRACTION_CONTRACT_VERSION,
  bonusExtractionKey,
} from "@savvyedge/ai-agents";
import { BONUS_EXTRACTION_CONTEXT } from "./ingestion.service";
import { resolveHeadlineEvidenceObservation } from "./ingestion.service";
import { createBonusSourceOfferKey } from "../utils/bonus-source-identity";
import {
  EvidenceArtifactStorageService,
  type EvidenceArtifactStore,
} from "./evidence-artifact-storage.service";

export interface ReverificationOverrides {
  scraperAgent?: { run: (input: { url: string }) => Promise<any> };
  bonusAgent?: {
    run: (input: { rawBonusText: string; casino_id: string }) => Promise<any>;
  };
  now?: Date;
  overrideSourceUrl?: string;
  artifactStore?: EvidenceArtifactStore;
}

export interface BonusFieldDiff {
  field: string;
  oldVal: string | null;
  newVal: string | null;
}

export type ReverificationResult =
  | {
      status: "VERIFIED_UNCHANGED";
      bonusId: string;
      verifiedAt: Date;
      evidenceRecordId: string;
      claimIds: string[];
    }
  | {
      status: "MATERIAL_CHANGE_DETECTED";
      bonusId: string;
      diffs: BonusFieldDiff[];
      reviewStatus: ReviewStatus;
      governanceVersion: number;
      evidenceRecordId: string;
      claimIds: string[];
    }
  | {
      status: "OFFER_INACTIVE";
      bonusId: string;
      diffs: BonusFieldDiff[];
      reviewStatus: ReviewStatus;
      governanceVersion: number;
      evidenceRecordId: string;
      claimIds: string[];
    }
  | {
      status: "SOURCE_REJECTED";
      bonusId: string;
      category: string;
      reason: string;
    }
  | {
      status: "EXTRACTION_FAILED";
      bonusId: string;
      reason: string;
    }
  | {
      status: "NO_AUTHORITATIVE_SOURCE_URL";
      bonusId: string;
      reason: string;
    }
  | {
      status: "SOURCE_IDENTITY_MISMATCH";
      bonusId: string;
      reason: string;
    }
  | {
      status: "LICENSE_INELIGIBLE";
      bonusId: string;
      reason: string;
    }
  | {
      status: "BONUS_NOT_FOUND";
      bonusId: string;
    };

function hashString(val: string): string {
  return createHash("sha256")
    .update(val.trim().toLowerCase())
    .digest("hex")
    .slice(0, 16);
}

type ReverificationDatabase = Prisma.TransactionClient | typeof prisma;

interface SourceCandidate {
  url: string;
  observedAt: Date | null;
  createdAt: Date | null;
  id: string;
}

function asValidDate(value: unknown): Date | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }
  return null;
}

function compareNewestSource(
  left: SourceCandidate,
  right: SourceCandidate,
): number {
  const leftObserved = left.observedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  const rightObserved = right.observedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  const observedOrder =
    rightObserved === leftObserved ? 0 : rightObserved > leftObserved ? 1 : -1;
  if (observedOrder !== 0) return observedOrder;

  const leftCreated = left.createdAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  const rightCreated = right.createdAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  const createdOrder =
    rightCreated === leftCreated ? 0 : rightCreated > leftCreated ? 1 : -1;
  if (createdOrder !== 0) return createdOrder;
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return left.url.localeCompare(right.url);
}

export class BonusReverificationService {
  /**
   * Resolves the authoritative offer source URL from immutable evidence records or history.
   */
  public static resolveAuthoritativeSourceUrl(
    bonus: {
      source_offer_key?: string | null;
      evidence_claims?: Array<{
        id?: string;
        verdict?: string;
        created_at?: Date | string | null;
        evidence?: {
          id?: string;
          source_url?: string | null;
          observed_at?: Date | string | null;
          extracted_at?: Date | string | null;
        } | null;
      }>;
      history_events?: Array<{
        id?: string;
        field_changed?: string;
        source_url?: string | null;
        changed_at?: Date | string | null;
      }>;
    },
    overrideUrl?: string,
  ):
    | { url: string }
    | {
        error: "NO_AUTHORITATIVE_SOURCE_URL" | "SOURCE_IDENTITY_MISMATCH";
        reason: string;
      } {
    const validateCandidate = (
      rawUrl: string,
    ): { url: string } | { identityMismatch: true } | null => {
      const url = rawUrl.trim();
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          return null;
        }
        if (
          bonus.source_offer_key &&
          createBonusSourceOfferKey(url) !== bonus.source_offer_key
        ) {
          return { identityMismatch: true };
        }
        return { url };
      } catch {
        return null;
      }
    };

    if (typeof overrideUrl === "string" && overrideUrl.trim().length > 0) {
      const explicit = validateCandidate(overrideUrl);
      if (explicit && "url" in explicit) return explicit;
      return {
        error: bonus.source_offer_key
          ? "SOURCE_IDENTITY_MISMATCH"
          : "NO_AUTHORITATIVE_SOURCE_URL",
        reason: bonus.source_offer_key
          ? "Explicit source URL does not match the stored source_offer_key"
          : "Explicit source URL is not a valid HTTP(S) URL",
      };
    }

    let sawIdentityMismatch = false;
    const evidenceCandidates: SourceCandidate[] = [];
    for (const claim of bonus.evidence_claims ?? []) {
      const sourceUrl = claim.evidence?.source_url;
      if (claim.verdict !== EvidenceVerdict.SUPPORTS || !sourceUrl) continue;
      const candidate = validateCandidate(sourceUrl);
      if (candidate && "identityMismatch" in candidate) {
        sawIdentityMismatch = true;
        continue;
      }
      if (!candidate) continue;
      evidenceCandidates.push({
        url: candidate.url,
        observedAt: asValidDate(claim.evidence?.observed_at),
        createdAt: asValidDate(claim.created_at),
        id: claim.evidence?.id ?? claim.id ?? "",
      });
    }

    evidenceCandidates.sort(compareNewestSource);
    if (evidenceCandidates[0]) return { url: evidenceCandidates[0].url };

    const historyCandidates: SourceCandidate[] = [];
    for (const event of bonus.history_events ?? []) {
      if (event.field_changed !== "verified_at" || !event.source_url) continue;
      const candidate = validateCandidate(event.source_url);
      if (candidate && "identityMismatch" in candidate) {
        sawIdentityMismatch = true;
        continue;
      }
      if (!candidate) continue;
      const changedAt = asValidDate(event.changed_at);
      historyCandidates.push({
        url: candidate.url,
        observedAt: changedAt,
        createdAt: changedAt,
        id: event.id ?? "",
      });
    }

    historyCandidates.sort(compareNewestSource);
    if (historyCandidates[0]) return { url: historyCandidates[0].url };

    return sawIdentityMismatch
      ? {
          error: "SOURCE_IDENTITY_MISMATCH",
          reason: "No provenance source matches the stored source_offer_key",
        }
      : {
          error: "NO_AUTHORITATIVE_SOURCE_URL",
          reason:
            "No authoritative source URL could be recovered from supporting evidence or verified_at history",
        };
  }

  /**
   * Core Re-Verification Execution Pipeline
   */
  public static async reverifyBonus(
    bonusId: string,
    options?: ReverificationOverrides,
    db: ReverificationDatabase = prisma,
  ): Promise<ReverificationResult> {
    const evaluationStartedAt = options?.now ?? new Date();

    // 1. Load Bonus with Relations
    const bonus = await db.bonus.findUnique({
      where: { id: bonusId },
      include: {
        casino: {
          select: {
            id: true,
            name: true,
            website_url: true,
            governance_version: true,
          },
        },
        evidence_claims: {
          include: {
            evidence: true,
          },
          orderBy: { created_at: "desc" },
        },
        history_events: {
          orderBy: { changed_at: "desc" },
        },
      },
    });

    if (!bonus) {
      return { status: "BONUS_NOT_FOUND", bonusId };
    }

    // 2. Authoritative Source URL Resolution
    const resolved = this.resolveAuthoritativeSourceUrl(
      bonus,
      options?.overrideSourceUrl,
    );
    if ("error" in resolved) {
      return {
        status: resolved.error,
        bonusId,
        reason: resolved.reason,
      };
    }
    const sourceUrl = resolved.url;

    // 3. Assert Casino Has Eligible License
    const workflowService = new WorkflowTransitionService(db as any);
    try {
      await workflowService.assertCasinoHasOneEligibleLicense(bonus.casino_id);
    } catch (error) {
      if (error instanceof WorkflowTransitionError) {
        return {
          status: "LICENSE_INELIGIBLE",
          bonusId,
          reason: error.code,
        };
      }
      throw error;
    }

    // 4. Fresh Source Observation (Crawl)
    const scraper = options?.scraperAgent ?? new ScraperAgent();
    let scrapeResult: any;
    try {
      scrapeResult = await scraper.run({ url: sourceUrl });
    } catch (err: any) {
      return {
        status: "SOURCE_REJECTED",
        bonusId,
        category: "CRAWL_FAILED",
        reason: err?.message ?? "Scraper failed to retrieve source URL",
      };
    }

    // 5. Source Page Eligibility Check
    const eligibilityInput = {
      requestedUrl: sourceUrl,
      finalUrl: scrapeResult.finalUrl || scrapeResult.url || sourceUrl,
      canonicalUrl: scrapeResult.canonicalUrl,
      title: scrapeResult.title || scrapeResult.metadata?.title,
      content: scrapeResult.content,
      taskContext: "BONUS" as const,
    };
    const eligibility = evaluateSourcePageEligibility(eligibilityInput);
    if (!eligibility.eligible) {
      return {
        status: "SOURCE_REJECTED",
        bonusId,
        category: eligibility.category,
        reason: eligibility.reason,
      };
    }

    const observedAt = asValidDate(scrapeResult.timestamp);
    const extractedAt = options?.now ?? new Date();
    if (
      !observedAt ||
      observedAt.getTime() < evaluationStartedAt.getTime() ||
      observedAt.getTime() > extractedAt.getTime()
    ) {
      return {
        status: "SOURCE_REJECTED",
        bonusId,
        category: "CRAWL_FAILED",
        reason:
          "Scraper did not return a timestamp for the current source observation",
      };
    }

    // 6. Durable observation persistence. Failures intentionally escape so
    // the VALIDATE_BONUS queue retries instead of completing normally.
    const observationId = randomUUID();
    const artifactInput = {
      rawHtml: scrapeResult.rawHtml,
      expectedHtmlHash: scrapeResult.htmlHash,
      observationId,
      sourceUrl: scrapeResult.finalUrl || scrapeResult.url || sourceUrl,
      observedAt,
    };
    const persistedArtifact = options?.artifactStore
      ? await options.artifactStore.persistObservation(artifactInput)
      : await EvidenceArtifactStorageService.persistObservation(artifactInput);

    // 7. Fresh Extraction & Normalization
    const bonusAgent = options?.bonusAgent ?? new BonusAgent();
    let rawExtraction: any;
    try {
      rawExtraction = await bonusAgent.run({
        rawBonusText: scrapeResult.content,
        casino_id: bonus.casino_id,
      });
    } catch (err: any) {
      return {
        status: "EXTRACTION_FAILED",
        bonusId,
        reason: `BonusAgent extraction failed: ${err?.message ?? String(err)}`,
      };
    }

    let normalizedBonus: CreateBonusInput;
    let semantics: BonusSourceSemantics;
    try {
      const normResult = normalizeBonusExtraction(
        scrapeResult.content,
        rawExtraction,
      );
      normalizedBonus = normResult.bonus;
      semantics = normResult.semantics;
    } catch (err: any) {
      return {
        status: "EXTRACTION_FAILED",
        bonusId,
        reason: `Bonus extraction normalization failed: ${err?.message ?? String(err)}`,
      };
    }

    const observedContent =
      typeof scrapeResult.content === "string" ? scrapeResult.content : "";
    const contentHash =
      typeof scrapeResult.contentHash === "string" &&
      scrapeResult.contentHash.trim().length > 0
        ? scrapeResult.contentHash
        : createHash("sha256").update(observedContent).digest("hex");

    // Observation-scoped extraction identity for this reverification.
    //
    // An unchanged reverification is still a new, timestamped observation: it
    // persisted its own artifact at its own locator, so it earns its own
    // identity and its own EvidenceRecord. The old record is never reused to
    // dodge the composite unique index. Computed here, before any transaction,
    // so it is stable for the whole call.
    // Fails closed. persistObservation only returns after verifying the bytes
    // against a real SHA-256, so a malformed value here is an integrity fault,
    // not a tolerable degradation. A governed write must never deliberately
    // create a NULL extraction key.
    const reverificationExtractionKey = bonusExtractionKey({
      snapshotLocator: persistedArtifact.locator,
      htmlHash: persistedArtifact.htmlHash,
      contentHash,
    });

    if (
      !normalizedBonus.headline_value ||
      normalizedBonus.headline_value.trim() === ""
    ) {
      return {
        status: "EXTRACTION_FAILED",
        bonusId,
        reason: "Extracted headline_value is null or empty",
      };
    }

    // 8. Material Term Diff Computation
    const diffs = this.computeBonusDiffs(bonus, normalizedBonus);
    const normalizedStatus = BonusService.normalizeLifecycleStatus(
      normalizedBonus.status,
    );
    const isOfferInactive = normalizedStatus === "INACTIVE";
    const hasMaterialChanges = diffs.length > 0 || isOfferInactive;

    // 9. Execute Atomic Transitions
    if (!hasMaterialChanges) {
      // -------------------------------------------------------------
      // BRANCH A: UNCHANGED TERMS & ACTIVE OFFER -> RENEW VERIFICATION
      // -------------------------------------------------------------
      return await this.runInTransaction(db, async (tx) => {
        // a. Actor
        const actor = await tx.reviewActor.upsert({
          where: { stable_key: "service:bonus-reverification" },
          update: { active: true },
          create: {
            kind: ActorKind.SERVICE,
            stable_key: "service:bonus-reverification",
            display_name: "Bonus Reverification Service",
            active: true,
          },
          select: { id: true },
        });

        // b. DataSource
        let ds = await tx.dataSource.findFirst({ where: { url: sourceUrl } });
        if (!ds) {
          ds = await tx.dataSource.create({
            data: {
              url: sourceUrl,
              source_type: "CASINO_PROMOTION_PAGE",
              last_scraped_at: observedAt,
            },
          });
        }

        // c. EvidenceRecord
        const evidenceRecord = await tx.evidenceRecord.create({
          data: {
            data_source_id: ds.id,
            evidence_type: EvidenceType.OPERATOR_PAGE,
            source_url: sourceUrl,
            snapshot_path: persistedArtifact.locator,
            html_hash: persistedArtifact.htmlHash,
            content_hash: contentHash,
            extraction_key: reverificationExtractionKey,
            observed_at: observedAt,
            extracted_at: extractedAt,
            created_by_id: actor.id,
          },
        });

        // This observation becomes authoritative for governance. The prior
        // observation becomes historical by pointer derivation only; its
        // EvidenceRecord and claims are never mutated.
        await tx.activeExtractionPointer.upsert({
          where: {
            bonus_id_extraction_context: {
              bonus_id: bonus.id,
              extraction_context: BONUS_EXTRACTION_CONTEXT,
            },
          },
          create: {
            bonus_id: bonus.id,
            data_source_id: ds.id,
            extraction_context: BONUS_EXTRACTION_CONTEXT,
            evidence_id: evidenceRecord.id,
            extraction_key: reverificationExtractionKey,
            contract_version: EXTRACTION_CONTRACT_VERSION,
            activated_at: extractedAt,
          },
          update: {
            data_source_id: ds.id,
            evidence_id: evidenceRecord.id,
            extraction_key: reverificationExtractionKey,
            contract_version: EXTRACTION_CONTRACT_VERSION,
            activated_at: extractedAt,
          },
        });

        // d. BonusEvidenceClaims
        const claimIds = await this.persistBonusEvidenceClaims(
          tx,
          evidenceRecord.id,
          bonus.id,
          normalizedBonus,
          semantics,
        );

        // e. Update Bonus.verified_at
        const freshnessCas = await tx.bonus.updateMany({
          where: this.createBonusCasPredicate(bonus),
          data: {
            verified_at: extractedAt,
            updated_at: extractedAt,
          },
        });
        if (freshnessCas.count !== 1) {
          throw new WorkflowTransitionError("STALE_GOVERNANCE_VERSION");
        }

        // f. Append verified_at BonusHistoryEvent
        await tx.bonusHistoryEvent.create({
          data: {
            bonus_id: bonus.id,
            field_changed: "verified_at",
            old_value: bonus.verified_at
              ? bonus.verified_at.toISOString()
              : null,
            new_value: extractedAt.toISOString(),
            changed_at: extractedAt,
            source_url: sourceUrl,
          },
        });

        return {
          status: "VERIFIED_UNCHANGED" as const,
          bonusId: bonus.id,
          verifiedAt: extractedAt,
          evidenceRecordId: evidenceRecord.id,
          claimIds,
        };
      });
    } else {
      // -------------------------------------------------------------
      // BRANCH B/E: MATERIAL CHANGES DETECTED OR INACTIVE OFFER
      // -------------------------------------------------------------
      return await this.runInTransaction(db, async (tx) => {
        // a. Actor
        const actor = await tx.reviewActor.upsert({
          where: { stable_key: "service:bonus-reverification" },
          update: { active: true },
          create: {
            kind: ActorKind.SERVICE,
            stable_key: "service:bonus-reverification",
            display_name: "Bonus Reverification Service",
            active: true,
          },
          select: { id: true },
        });

        // b. DataSource
        let ds = await tx.dataSource.findFirst({ where: { url: sourceUrl } });
        if (!ds) {
          ds = await tx.dataSource.create({
            data: {
              url: sourceUrl,
              source_type: "CASINO_PROMOTION_PAGE",
              last_scraped_at: observedAt,
            },
          });
        }

        // c. EvidenceRecord
        const evidenceRecord = await tx.evidenceRecord.create({
          data: {
            data_source_id: ds.id,
            evidence_type: EvidenceType.OPERATOR_PAGE,
            source_url: sourceUrl,
            snapshot_path: persistedArtifact.locator,
            html_hash: persistedArtifact.htmlHash,
            content_hash: contentHash,
            extraction_key: reverificationExtractionKey,
            observed_at: observedAt,
            extracted_at: extractedAt,
            created_by_id: actor.id,
          },
        });

        // This observation becomes authoritative for governance. The prior
        // observation becomes historical by pointer derivation only; its
        // EvidenceRecord and claims are never mutated.
        await tx.activeExtractionPointer.upsert({
          where: {
            bonus_id_extraction_context: {
              bonus_id: bonus.id,
              extraction_context: BONUS_EXTRACTION_CONTEXT,
            },
          },
          create: {
            bonus_id: bonus.id,
            data_source_id: ds.id,
            extraction_context: BONUS_EXTRACTION_CONTEXT,
            evidence_id: evidenceRecord.id,
            extraction_key: reverificationExtractionKey,
            contract_version: EXTRACTION_CONTRACT_VERSION,
            activated_at: extractedAt,
          },
          update: {
            data_source_id: ds.id,
            evidence_id: evidenceRecord.id,
            extraction_key: reverificationExtractionKey,
            contract_version: EXTRACTION_CONTRACT_VERSION,
            activated_at: extractedAt,
          },
        });

        // d. BonusEvidenceClaims
        const claimIds = await this.persistBonusEvidenceClaims(
          tx,
          evidenceRecord.id,
          bonus.id,
          normalizedBonus,
          semantics,
        );

        // e. Append field diff BonusHistoryEvents
        for (const diff of diffs) {
          await tx.bonusHistoryEvent.create({
            data: {
              bonus_id: bonus.id,
              field_changed: diff.field,
              old_value: diff.oldVal,
              new_value: diff.newVal,
              source_url: sourceUrl,
              changed_at: extractedAt,
            },
          });
        }

        const isApprovedOrPublished =
          bonus.review_status === ReviewStatus.APPROVED ||
          bonus.publication_status === PublicationStatus.PUBLISHED;

        let resultingVersion = bonus.governance_version;
        let resultingReviewStatus = bonus.review_status;

        if (bonus.review_status === ReviewStatus.APPROVED) {
          // Do NOT mutate governed fields in-place.
          // Do NOT refresh verified_at.
          // Transition review APPROVED -> AWAITING_REVIEW via CAS
          const txWorkflow = new WorkflowTransitionService(tx as any);
          const transitionRes = await txWorkflow.transitionBonusReview({
            subjectId: bonus.id,
            actorId: actor.id,
            expectedVersion: bonus.governance_version,
            toStatus: ReviewStatus.AWAITING_REVIEW,
            claimIds,
            internalReason: isOfferInactive
              ? "Offer observed as INACTIVE during source re-verification"
              : "Material terms changed during source re-verification",
          });
          resultingVersion = transitionRes.governanceVersion;
          resultingReviewStatus = transitionRes.reviewStatus;
        } else if (
          bonus.publication_status === PublicationStatus.PUBLISHED &&
          bonus.review_status === ReviewStatus.AWAITING_REVIEW
        ) {
          // A prior material observation already reset review. Record this new
          // observation, but do not create a duplicate same-state transition.
          const repeatedChangeCas = await tx.bonus.updateMany({
            where: this.createBonusCasPredicate(bonus),
            data: { updated_at: extractedAt },
          });
          if (repeatedChangeCas.count !== 1) {
            throw new WorkflowTransitionError("STALE_GOVERNANCE_VERSION");
          }
        } else if (isApprovedOrPublished) {
          throw new WorkflowTransitionError("INVALID_TRANSITION");
        } else {
          // Unapproved/Draft record can be updated with new proposed values
          const updateCas = await tx.bonus.updateMany({
            where: this.createBonusCasPredicate(bonus),
            data: {
              headline_value: normalizedBonus.headline_value,
              type: normalizedBonus.type,
              wagering_requirement: normalizedBonus.wagering_requirement,
              max_conversion: normalizedBonus.max_conversion,
              valid_from: normalizedBonus.valid_from,
              valid_until: normalizedBonus.valid_until,
              status: normalizedStatus,
              updated_at: extractedAt,
            },
          });
          if (updateCas.count !== 1) {
            throw new WorkflowTransitionError("STALE_GOVERNANCE_VERSION");
          }
        }

        const outcomeStatus = isOfferInactive
          ? ("OFFER_INACTIVE" as const)
          : ("MATERIAL_CHANGE_DETECTED" as const);

        return {
          status: outcomeStatus,
          bonusId: bonus.id,
          diffs,
          reviewStatus: resultingReviewStatus,
          governanceVersion: resultingVersion,
          evidenceRecordId: evidenceRecord.id,
          claimIds,
        };
      });
    }
  }

  private static createBonusCasPredicate(bonus: any) {
    return {
      id: bonus.id,
      governance_version: bonus.governance_version,
      review_status: bonus.review_status,
      publication_status: bonus.publication_status,
      source_offer_key: bonus.source_offer_key ?? null,
      type: bonus.type,
      headline_value: bonus.headline_value ?? null,
      wagering_requirement: bonus.wagering_requirement ?? null,
      max_conversion: bonus.max_conversion ?? null,
      valid_from: bonus.valid_from ?? null,
      valid_until: bonus.valid_until ?? null,
      status: bonus.status,
      verified_at: bonus.verified_at ?? null,
    };
  }

  private static async runInTransaction<T>(
    db: ReverificationDatabase,
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    if (typeof (db as any).$transaction !== "function") {
      return operation(db as Prisma.TransactionClient);
    }

    try {
      return await (db as typeof prisma).$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034"
      ) {
        throw new WorkflowTransitionError("STALE_GOVERNANCE_VERSION");
      }
      throw error;
    }
  }

  private static computeBonusDiffs(
    existingBonus: any,
    candidate: CreateBonusInput,
  ): BonusFieldDiff[] {
    const diffs: BonusFieldDiff[] = [];

    // headline_value
    const oldHeadline = existingBonus.headline_value ?? null;
    const newHeadline = candidate.headline_value ?? null;
    if (oldHeadline !== newHeadline) {
      diffs.push({
        field: "headline_value",
        oldVal: oldHeadline,
        newVal: newHeadline,
      });
    }

    // type
    if (existingBonus.type !== candidate.type) {
      diffs.push({
        field: "type",
        oldVal: existingBonus.type,
        newVal: candidate.type,
      });
    }

    // wagering_requirement
    const oldWagering = existingBonus.wagering_requirement ?? null;
    const newWagering = candidate.wagering_requirement ?? null;
    if (oldWagering !== newWagering) {
      diffs.push({
        field: "wagering_requirement",
        oldVal: oldWagering !== null ? String(oldWagering) : null,
        newVal: newWagering !== null ? String(newWagering) : null,
      });
    }

    // max_conversion
    const oldMaxConv = existingBonus.max_conversion ?? null;
    const newMaxConv = candidate.max_conversion ?? null;
    if (oldMaxConv !== newMaxConv) {
      diffs.push({
        field: "max_conversion",
        oldVal: oldMaxConv !== null ? String(oldMaxConv) : null,
        newVal: newMaxConv !== null ? String(newMaxConv) : null,
      });
    }

    // valid_from
    const oldValidFrom = existingBonus.valid_from
      ? existingBonus.valid_from instanceof Date
        ? existingBonus.valid_from.toISOString()
        : new Date(existingBonus.valid_from).toISOString()
      : null;
    const newValidFrom = candidate.valid_from
      ? candidate.valid_from instanceof Date
        ? candidate.valid_from.toISOString()
        : new Date(candidate.valid_from).toISOString()
      : null;
    if (oldValidFrom !== newValidFrom) {
      diffs.push({
        field: "valid_from",
        oldVal: oldValidFrom,
        newVal: newValidFrom,
      });
    }

    // valid_until
    const oldValidUntil = existingBonus.valid_until
      ? existingBonus.valid_until instanceof Date
        ? existingBonus.valid_until.toISOString()
        : new Date(existingBonus.valid_until).toISOString()
      : null;
    const newValidUntil = candidate.valid_until
      ? candidate.valid_until instanceof Date
        ? candidate.valid_until.toISOString()
        : new Date(candidate.valid_until).toISOString()
      : null;
    if (oldValidUntil !== newValidUntil) {
      diffs.push({
        field: "valid_until",
        oldVal: oldValidUntil,
        newVal: newValidUntil,
      });
    }

    // status
    const normalizedCandidateStatus = BonusService.normalizeLifecycleStatus(
      candidate.status,
    );
    if (existingBonus.status !== normalizedCandidateStatus) {
      diffs.push({
        field: "status",
        oldVal: existingBonus.status,
        newVal: normalizedCandidateStatus,
      });
    }

    return diffs;
  }

  private static async persistBonusEvidenceClaims(
    tx: Prisma.TransactionClient,
    evidenceId: string,
    bonusId: string,
    bonusInput: CreateBonusInput,
    bonusSourceSemantics: BonusSourceSemantics,
  ): Promise<string[]> {
    const claimIds: string[] = [];

    // TYPE
    if (bonusInput.type) {
      const claim = await tx.bonusEvidenceClaim.create({
        data: {
          evidence_id: evidenceId,
          bonus_id: bonusId,
          field: BonusEvidenceField.TYPE,
          observed_value: bonusInput.type,
          normalized_value_hash: `normalizer-v1:TYPE:${hashString(bonusInput.type)}`,
          verdict: EvidenceVerdict.SUPPORTS,
        },
      });
      claimIds.push(claim.id);
    }

    // HEADLINE_VALUE
    const headlineEvidence = resolveHeadlineEvidenceObservation(
      bonusInput,
      bonusSourceSemantics,
    );
    if (headlineEvidence) {
      const claim = await tx.bonusEvidenceClaim.create({
        data: {
          evidence_id: evidenceId,
          bonus_id: bonusId,
          field: BonusEvidenceField.HEADLINE_VALUE,
          observed_value: headlineEvidence,
          normalized_value_hash: `normalizer-v1:HEADLINE:${hashString(headlineEvidence)}`,
          verdict: EvidenceVerdict.SUPPORTS,
        },
      });
      claimIds.push(claim.id);
    }

    // WAGERING_REQUIREMENT
    if (
      bonusInput.wagering_requirement !== null &&
      bonusInput.wagering_requirement !== undefined
    ) {
      const valStr =
        bonusSourceSemantics.wagering?.scope === "FREE_SPIN_WINNINGS" &&
        bonusSourceSemantics.wagering.multiplier ===
          bonusInput.wagering_requirement
          ? bonusSourceSemantics.wagering.sourceText
          : String(bonusInput.wagering_requirement);
      const claim = await tx.bonusEvidenceClaim.create({
        data: {
          evidence_id: evidenceId,
          bonus_id: bonusId,
          field: BonusEvidenceField.WAGERING_REQUIREMENT,
          observed_value: valStr,
          normalized_value_hash: `normalizer-v1:WAGERING:${hashString(valStr)}`,
          verdict: EvidenceVerdict.SUPPORTS,
        },
      });
      claimIds.push(claim.id);
    }

    // MAX_CONVERSION
    if (
      bonusInput.max_conversion !== null &&
      bonusInput.max_conversion !== undefined
    ) {
      const valStr = String(bonusInput.max_conversion);
      const claim = await tx.bonusEvidenceClaim.create({
        data: {
          evidence_id: evidenceId,
          bonus_id: bonusId,
          field: BonusEvidenceField.MAX_CONVERSION,
          observed_value: valStr,
          normalized_value_hash: `normalizer-v1:MAX_CONVERSION:${valStr}`,
          verdict: EvidenceVerdict.SUPPORTS,
        },
      });
      claimIds.push(claim.id);
    }

    // VALID_FROM
    if (bonusInput.valid_from) {
      const valStr =
        bonusInput.valid_from instanceof Date
          ? bonusInput.valid_from.toISOString()
          : String(bonusInput.valid_from);
      const claim = await tx.bonusEvidenceClaim.create({
        data: {
          evidence_id: evidenceId,
          bonus_id: bonusId,
          field: BonusEvidenceField.VALID_FROM,
          observed_value: valStr,
          normalized_value_hash: `normalizer-v1:VALID_FROM:${hashString(String(bonusInput.valid_from))}`,
          verdict: EvidenceVerdict.SUPPORTS,
        },
      });
      claimIds.push(claim.id);
    }

    // VALID_UNTIL
    if (bonusInput.valid_until) {
      const valStr =
        bonusInput.valid_until instanceof Date
          ? bonusInput.valid_until.toISOString()
          : String(bonusInput.valid_until);
      const claim = await tx.bonusEvidenceClaim.create({
        data: {
          evidence_id: evidenceId,
          bonus_id: bonusId,
          field: BonusEvidenceField.VALID_UNTIL,
          observed_value: valStr,
          normalized_value_hash: `normalizer-v1:VALID_UNTIL:${hashString(String(bonusInput.valid_until))}`,
          verdict: EvidenceVerdict.SUPPORTS,
        },
      });
      claimIds.push(claim.id);
    }

    return claimIds;
  }
}
