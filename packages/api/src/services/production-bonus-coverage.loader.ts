/**
 * Read-only loader for the pure production Bonus coverage audit.
 *
 * This module is the *impure* half of the audit and deliberately lives outside
 * `src/audits/`, which stays dependency-pure. It performs database reads only:
 * no create/update/upsert/delete, no raw execution, no schema access.
 *
 * It owns no policy. Freshness is decided exclusively by the canonical D3C
 * evaluator reached through `classifyProductionBonusCoverage`, source
 * precedence exclusively by `BonusReverificationService`, and the totals
 * exclusively by `reconcileProductionBonusCoverage`.
 */

import { Prisma, PublicationStatus, ReviewStatus } from "@savvyedge/database";
import { BONUS_EXTRACTION_CONTEXT } from "../constants/extraction-context";
import {
  DEFAULT_BONUS_FRESHNESS_POLICY,
  type ActiveObservationRejectionCode,
  type BonusFreshnessPolicy,
} from "./freshness.policy";
import {
  EXCLUDED_DATA_SOURCES,
  PublicationGateService,
} from "./publication-gate.service";
import { BonusReverificationService } from "./bonus-reverification.service";
import { createBonusSourceOfferKey } from "../utils/bonus-source-identity";
import {
  proveAuthorizedReadOnlyConnection,
  type ProductionCoverageAuditAuthorization,
  type ReadOnlyProbeClient,
  type ReadOnlyProofCheck,
} from "./production-readonly-connection.guard";
import {
  classifyProductionBonusCoverage,
  reconcileProductionBonusCoverage,
} from "../audits/production-bonus-coverage.classifier";
import type {
  ProductionBonusCoverageInput,
  ProductionBonusCoverageReconciliationResult,
  PublicationGovernanceClaimInput,
  PublicationGovernanceDiagnostic,
  ReverificationSourceResolution,
} from "../audits/production-bonus-coverage.contract";

export const PRODUCTION_BONUS_COVERAGE_PAGE_SIZE = 200;

/**
 * The scan's interactive-transaction bounds, declared once.
 *
 * REPEATABLE READ gives the count and every page one consistent snapshot.
 * Prisma's default interactive-transaction timeout is 5s, which would abort a
 * real population mid-scan, so the ceiling is stated explicitly rather than
 * inherited. These values are reported with every run so a rehearsal against
 * production-scale data can measure against the limits actually in force.
 */
export const COVERAGE_SCAN_TRANSACTION_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  /** Longest wait for a free connection before the scan gives up. */
  maxWait: 10_000,
  /** Hard ceiling on snapshot duration: 15 minutes. */
  timeout: 900_000,
} as const;

/* -------------------------------------------------------------------------
 * Zero-filled histogram seeds.
 *
 * Each seed is typed as a total `Record` over its canonical union, so a new
 * canonical code cannot be added upstream without breaking this build. These
 * are compile-time mirrors for reporting shape only — they define no rule.
 * ---------------------------------------------------------------------- */

function zeroRejectionCodeCounts(): Record<
  ActiveObservationRejectionCode,
  number
> {
  return {
    MISSING_ACTIVE_POINTER: 0,
    AMBIGUOUS_ACTIVE_POINTER: 0,
    MISSING_ACTIVE_EVIDENCE: 0,
    ACTIVE_EVIDENCE_MISMATCH: 0,
    INVALID_EXTRACTION_IDENTITY: 0,
    MISSING_SUPPORTING_CLAIM: 0,
    INVALID_EVIDENCE_SOURCE: 0,
    INVALID_OBSERVATION: 0,
    FUTURE_OBSERVATION: 0,
    PREMATURE_EVIDENCE: 0,
    EXPIRED_EVIDENCE: 0,
    STALE_OBSERVATION: 0,
    PROJECTION_MISMATCH: 0,
  };
}

function zeroSourceResolutionCounts(): Record<
  ReverificationSourceResolution,
  number
> {
  return { ACTIVE_POINTER: 0, LEGACY_EVIDENCE: 0, UNRESOLVED: 0 };
}

function zeroGovernanceDiagnosticCounts(): Record<
  PublicationGovernanceDiagnostic,
  number
> {
  return {
    MISSING_CURRENT_PUBLICATION_EVENT: 0,
    ACTIVE_EVIDENCE_UNAVAILABLE: 0,
    MISSING_RELIED_UPON_PUBLICATION_CLAIMS: 0,
    PUBLICATION_CLAIM_SUBJECT_MISMATCH: 0,
    PUBLICATION_CLAIM_NOT_SUPPORTS: 0,
    PUBLICATION_CLAIM_NOT_ACTIVE_EVIDENCE: 0,
  };
}

/* -------------------------------------------------------------------------
 * Population
 * ---------------------------------------------------------------------- */

/**
 * The audit population: every bonus that is *claimed* to be publicly live.
 *
 * PUBLISHED + APPROVED + ACTIVE + not quarantined + an allowed data source +
 * a publicly eligible casino.
 *
 * Deliberately excludes the freshness floor, the `verified_at` window and the
 * `active_extractions` existence clause that `whereBonusPublic` also applies.
 * Those are the very conditions this audit measures: including them would
 * pre-filter away every non-compliant bonus and report 100% compliance by
 * construction. This predicate must therefore never be swapped for
 * `PublicationGateService.whereBonusPublic()`.
 */
export function auditPopulationWhere(): Prisma.BonusWhereInput {
  return {
    publication_status: PublicationStatus.PUBLISHED,
    review_status: ReviewStatus.APPROVED,
    status: "ACTIVE",
    quarantine_reason: null,
    data_source_type: { notIn: EXCLUDED_DATA_SOURCES },
    casino: PublicationGateService.whereCasinoPublic(),
  };
}

/**
 * Exactly the relations the canonical evaluator and the audit classifier need.
 *
 * The publication gate's active-evidence graph is preserved and augmented with
 * canonical ScrapeJob provenance for authoritative-source classification.
 */
export function coverageBonusSelect() {
  const activeEvidenceInclude =
    PublicationGateService.bonusActiveEvidenceInclude();

  return {
    id: true,
    verified_at: true,
    source_offer_key: true,
    active_extractions: {
      ...activeEvidenceInclude.active_extractions,
      select: {
        ...activeEvidenceInclude.active_extractions.select,
        evidence: {
          select: {
            ...activeEvidenceInclude.active_extractions.select.evidence.select,
            scrape_job_id: true,
            scrape_job: {
              select: {
                id: true,
                data_source_id: true,
                canonical_url: true,
              },
            },
          },
        },
      },
    },
    workflow_events: {
      where: { to_publication_status: PublicationStatus.PUBLISHED },
      orderBy: { occurred_at: "desc" },
      take: 1,
      select: {
        id: true,
        evidence_claims: {
          select: {
            bonus_evidence_claim: {
              select: {
                id: true,
                bonus_id: true,
                verdict: true,
                evidence_id: true,
              },
            },
          },
        },
      },
    },
  } as const;
}

/**
 * The legacy provenance relations, loaded only for bonuses with no pointer.
 *
 * `history_events` is filtered to `verified_at` exactly as the canonical legacy
 * resolver filters it, so the audit sees the same candidate set. It is a WHERE
 * and never a TAKE: truncating would let an older valid candidate be dropped
 * and change the resolution outcome.
 */
export function legacySourceSelect() {
  return {
    id: true,
    source_offer_key: true,
    evidence_claims: {
      select: {
        id: true,
        verdict: true,
        created_at: true,
        evidence: {
          select: {
            id: true,
            source_url: true,
            observed_at: true,
            extracted_at: true,
          },
        },
      },
    },
    history_events: {
      where: { field_changed: "verified_at" },
      select: {
        id: true,
        field_changed: true,
        source_url: true,
        changed_at: true,
      },
    },
  } as const;
}

/* -------------------------------------------------------------------------
 * Row -> classifier input
 * ---------------------------------------------------------------------- */

function bonusPointers(row: any): any[] {
  return Array.isArray(row?.active_extractions)
    ? row.active_extractions.filter(
        (pointer: any) =>
          pointer &&
          typeof pointer === "object" &&
          pointer.extraction_context === BONUS_EXTRACTION_CONTEXT,
      )
    : [];
}

function safeCanonicalKey(url: string | null): string | undefined {
  if (typeof url !== "string" || url === "") return undefined;
  try {
    return createBonusSourceOfferKey(url);
  } catch {
    // An underivable identity is an unverifiable one: fail closed.
    return undefined;
  }
}

/**
 * Pre-resolves the source classification the pure contract requires.
 *
 * The branch is inferred structurally — exactly one BONUS pointer means the
 * active-pointer branch — while the URL itself always comes from the canonical
 * `resolveAuthoritativeSourceUrl`. No precedence rule is reimplemented here,
 * and `LEGACY_EVIDENCE` is claimed only when that canonical legacy path
 * actually produced a URL.
 */
export function resolveSourceClassification(
  row: any,
  legacyRow: any,
): {
  sourceResolution: ReverificationSourceResolution;
  resolvedCanonicalSourceOfferKey: string | undefined;
} {
  const pointers = bonusPointers(row);

  if (pointers.length === 1) {
    const resolved = BonusReverificationService.resolveAuthoritativeSourceUrl({
      id: row?.id,
      source_offer_key: row?.source_offer_key,
      active_extractions: row?.active_extractions ?? [],
    });
    return {
      sourceResolution: "ACTIVE_POINTER",
      resolvedCanonicalSourceOfferKey:
        "url" in resolved ? safeCanonicalKey(resolved.url) : undefined,
    };
  }

  if (pointers.length === 0 && legacyRow) {
    const resolved = BonusReverificationService.resolveAuthoritativeSourceUrl({
      id: row?.id,
      source_offer_key: row?.source_offer_key,
      active_extractions: [],
      evidence_claims: legacyRow.evidence_claims ?? [],
      history_events: legacyRow.history_events ?? [],
    });
    if ("url" in resolved) {
      return {
        sourceResolution: "LEGACY_EVIDENCE",
        resolvedCanonicalSourceOfferKey: safeCanonicalKey(resolved.url),
      };
    }
  }

  return {
    sourceResolution: "UNRESOLVED",
    resolvedCanonicalSourceOfferKey: undefined,
  };
}

/**
 * Builds the governance input.
 *
 * `activeEvidenceAvailable` is derived *structurally* — one pointer resolving
 * to a loaded evidence row — and never from the freshness decision, so
 * publication governance stays independent of active-observation compliance.
 */
function toGovernanceInput(
  row: any,
): ProductionBonusCoverageInput["publicationGovernance"] {
  const pointers = bonusPointers(row);
  const activeEvidenceId =
    pointers.length === 1 && typeof pointers[0]?.evidence?.id === "string"
      ? pointers[0].evidence.id
      : null;

  const event = Array.isArray(row?.workflow_events)
    ? row.workflow_events[0]
    : undefined;

  const reliedUponClaims: PublicationGovernanceClaimInput[] = (
    Array.isArray(event?.evidence_claims) ? event.evidence_claims : []
  )
    .map((link: any) => link?.bonus_evidence_claim)
    .filter((claim: any) => claim && typeof claim === "object")
    .map((claim: any) => ({
      subjectBonusIdMatches:
        typeof row?.id === "string" &&
        row.id !== "" &&
        claim.bonus_id === row.id,
      verdict: claim.verdict,
      resolvesToActiveEvidence:
        activeEvidenceId !== null && claim.evidence_id === activeEvidenceId,
    }));

  return {
    currentPublicationEventAvailable: Boolean(event),
    activeEvidenceAvailable: activeEvidenceId !== null,
    reliedUponClaims,
  };
}

export function toCoverageInput(
  row: any,
  legacyRow: any,
): ProductionBonusCoverageInput {
  const { sourceResolution, resolvedCanonicalSourceOfferKey } =
    resolveSourceClassification(row, legacyRow);

  return {
    activeObservation: { bonus: row ?? null },
    reverificationReadiness: {
      sourceResolution,
      sourceOfferKey: row?.source_offer_key,
      resolvedCanonicalSourceOfferKey,
    },
    publicationGovernance: toGovernanceInput(row),
  };
}

/* -------------------------------------------------------------------------
 * Scan
 * ---------------------------------------------------------------------- */

export interface CoverageScanClient extends ReadOnlyProbeClient {
  bonus: {
    count(args: any): Promise<number>;
    findMany(args: any): Promise<any[]>;
  };
}

export interface CoverageScanRunner {
  $transaction<T>(
    handler: (tx: CoverageScanClient) => Promise<T>,
    options?: Record<string, unknown>,
  ): Promise<T>;
}

interface ProductionBonusCoverageScanBaseOptions {
  /** One immutable clock for the whole scan. */
  auditNow: Date;
  /**
   * The freshness window the audit measures against. Omit to audit under the
   * canonical default. Whatever is resolved here is passed to every
   * classification and reported, so the audit's window is always explicit.
   */
  policy?: Partial<BonusFreshnessPolicy>;
  pageSize?: number;
  /** Injectable for tests; production supplies the Prisma client. */
  db: CoverageScanRunner;
}

export type ProductionBonusCoverageScanOptions =
  | (ProductionBonusCoverageScanBaseOptions & {
      /** Local/rehearsal result only; never an attestation of production. */
      mode: "isolated";
    })
  | (ProductionBonusCoverageScanBaseOptions & {
      mode: "production-readonly";
      authorization: ProductionCoverageAuditAuthorization;
    });

/**
 * Fixed, production-safe failure used when the exact scan transaction cannot
 * prove the approved identity and read-only guarantees. It deliberately omits
 * database, role, URL, query, and Prisma error details.
 */
export class CoverageAuditConnectionRefusedError extends Error {
  public constructor(public readonly failedCheck: ReadOnlyProofCheck) {
    super("The production coverage scan transaction was not authorized.");
    this.name = "CoverageAuditConnectionRefusedError";
  }
}

export interface ProductionBonusCoverageReport {
  auditNow: string;
  freshnessMaxAgeMs: number;
  connectionAttestation:
    "EXACT_TRANSACTION_PROVEN" | "ISOLATED_MODE_NOT_ATTESTED";
  /** The transaction bounds this scan actually ran under. */
  scanTransaction: {
    isolationLevel: string;
    maxWaitMs: number;
    timeoutMs: number;
  };
  population: number;
  scanned: number;
  pagesScanned: number;
  malformedRows: number;
  activeObservation: {
    compliant: number;
    nonCompliant: number;
    primaryFailureCounts: Record<ActiveObservationRejectionCode, number>;
  };
  reverificationReadiness: {
    ready: number;
    notReady: number;
    bySourceResolution: Record<ReverificationSourceResolution, number>;
  };
  publicationGovernance: {
    consistent: number;
    inconsistent: number;
    notAssessable: number;
    diagnosticCounts: Record<PublicationGovernanceDiagnostic, number>;
  };
  reconciliation: ProductionBonusCoverageReconciliationResult;
  fullyCompliant: boolean;
}

/**
 * Reads the published population and classifies every member.
 *
 * The count and every page run inside one REPEATABLE READ transaction, so the
 * totals reconcile against a single consistent snapshot rather than a moving
 * population. In production-readonly mode the approved identity and read-only
 * guarantees are re-proved on that transaction's exact connection before its
 * first population read. Isolated mode remains the lower-level local test path.
 * Zero writes are issued.
 */
export async function scanProductionBonusCoverage(
  options: ProductionBonusCoverageScanOptions,
): Promise<ProductionBonusCoverageReport> {
  const { auditNow, db } = options;
  // Resolved once, then passed explicitly to every classification below.
  const effectivePolicy: BonusFreshnessPolicy = {
    ...DEFAULT_BONUS_FRESHNESS_POLICY,
    ...(options.policy ?? {}),
  };
  const pageSize = options.pageSize ?? PRODUCTION_BONUS_COVERAGE_PAGE_SIZE;
  const where = auditPopulationWhere();
  const select = coverageBonusSelect();
  const legacySelect = legacySourceSelect();

  return db.$transaction(async (tx) => {
    if (options.mode === "production-readonly") {
      const proof = await proveAuthorizedReadOnlyConnection(
        tx,
        options.authorization,
      );
      if (!proof.proven) {
        throw new CoverageAuditConnectionRefusedError(proof.failedCheck);
      }
    }

    const population = await tx.bonus.count({ where });

    const primaryFailureCounts = zeroRejectionCodeCounts();
    const bySourceResolution = zeroSourceResolutionCounts();
    const diagnosticCounts = zeroGovernanceDiagnosticCounts();
    let compliant = 0;
    let nonCompliant = 0;
    let ready = 0;
    let notReady = 0;
    let governanceConsistent = 0;
    let governanceInconsistent = 0;
    let governanceNotAssessable = 0;
    let malformedRows = 0;
    let scanned = 0;
    let pagesScanned = 0;
    let cursor: string | undefined;

    for (;;) {
      const rows: any[] = await tx.bonus.findMany({
        where,
        select,
        orderBy: { id: "asc" },
        take: pageSize,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (rows.length === 0) break;
      pagesScanned += 1;

      const legacyIds = rows
        .filter((row) => bonusPointers(row).length === 0)
        .map((row) => row?.id)
        .filter((id): id is string => typeof id === "string" && id !== "");
      const legacyById = new Map<string, any>();
      if (legacyIds.length > 0) {
        const legacyRows: any[] = await tx.bonus.findMany({
          where: { id: { in: legacyIds } },
          select: legacySelect,
        });
        for (const legacyRow of legacyRows) {
          if (typeof legacyRow?.id === "string") {
            legacyById.set(legacyRow.id, legacyRow);
          }
        }
      }

      for (const row of rows) {
        scanned += 1;
        if (typeof row?.id !== "string" || row.id === "") {
          malformedRows += 1;
        }

        const result = classifyProductionBonusCoverage(
          toCoverageInput(
            row,
            typeof row?.id === "string" ? legacyById.get(row.id) : undefined,
          ),
          auditNow,
          effectivePolicy,
        );

        if (result.activeObservation.activeObservationCompliant) {
          compliant += 1;
        } else {
          nonCompliant += 1;
          const failure =
            result.activeObservation.activeObservationPrimaryFailure;
          if (failure) primaryFailureCounts[failure] += 1;
        }

        bySourceResolution[result.reverificationReadiness.sourceResolution] +=
          1;
        if (result.reverificationReadiness.readiness === "READY") ready += 1;
        else notReady += 1;

        if (result.publicationGovernance.assessment === "CONSISTENT") {
          governanceConsistent += 1;
        } else if (result.publicationGovernance.assessment === "INCONSISTENT") {
          governanceInconsistent += 1;
        } else {
          governanceNotAssessable += 1;
        }
        for (const diagnostic of result.publicationGovernance.diagnostics) {
          diagnosticCounts[diagnostic] += 1;
        }
      }

      const lastId = rows[rows.length - 1]?.id;
      if (
        rows.length < pageSize ||
        typeof lastId !== "string" ||
        lastId === ""
      ) {
        // A short page ends the scan; an unusable cursor stops it early and
        // the reconciliation below then fails on the short total.
        break;
      }
      cursor = lastId;
    }

    const reconciliation = reconcileProductionBonusCoverage({
      publishedApprovedActive: population,
      activeObservationCompliant: compliant,
      activeObservationNonCompliant: nonCompliant,
      activeObservationPrimaryFailureCounts: primaryFailureCounts,
      reverificationReady: ready,
      reverificationNotReady: notReady,
      governanceConsistent,
      governanceInconsistent,
      governanceNotAssessable,
    });

    return {
      auditNow: auditNow.toISOString(),
      freshnessMaxAgeMs: effectivePolicy.maxAgeMs,
      connectionAttestation:
        options.mode === "production-readonly"
          ? "EXACT_TRANSACTION_PROVEN"
          : "ISOLATED_MODE_NOT_ATTESTED",
      scanTransaction: {
        isolationLevel: COVERAGE_SCAN_TRANSACTION_OPTIONS.isolationLevel,
        maxWaitMs: COVERAGE_SCAN_TRANSACTION_OPTIONS.maxWait,
        timeoutMs: COVERAGE_SCAN_TRANSACTION_OPTIONS.timeout,
      },
      population,
      scanned,
      pagesScanned,
      malformedRows,
      activeObservation: { compliant, nonCompliant, primaryFailureCounts },
      reverificationReadiness: { ready, notReady, bySourceResolution },
      publicationGovernance: {
        consistent: governanceConsistent,
        inconsistent: governanceInconsistent,
        notAssessable: governanceNotAssessable,
        diagnosticCounts,
      },
      reconciliation,
      fullyCompliant:
        reconciliation.valid &&
        malformedRows === 0 &&
        nonCompliant === 0 &&
        notReady === 0 &&
        governanceInconsistent === 0 &&
        governanceNotAssessable === 0,
    };
  }, COVERAGE_SCAN_TRANSACTION_OPTIONS);
}
