/**
 * D3C fixture builder: the active-observation relation graph a bonus must carry
 * for the publication gate to consider it fresh.
 *
 * Mirrors `PublicationGateService.bonusActiveEvidenceInclude()`, so a fixture
 * built here has exactly the shape a public loader hands the runtime gate.
 * Synthetic values only — nothing here resolves to a real source.
 */

import { createHash } from "node:crypto";
import {
  EXTRACTION_CONTRACT_VERSION,
  bonusExtractionKey,
} from "@savvyedge/ai-agents/extraction-contract";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function activeBonusExtractionKey(seed: string): string {
  return bonusExtractionKey({
    snapshotLocator: `test-fixture://active-bonus-evidence/${seed}`,
    htmlHash: sha256(`html:${seed}`),
    contentHash: sha256(`content:${seed}`),
  });
}

export interface ActiveBonusEvidenceOptions {
  bonusId: string;
  /** The authoritative observation instant. */
  observedAt: Date;
  /** Defaults to `observedAt`; set differently to prove they are distinct. */
  extractedAt?: Date;
  sourceUrl?: string;
  evidenceId?: string;
  extractionKey?: string;
  contractVersion?: string | null;
  dataSourceId?: string;
  scrapeJobId?: string;
  scrapeJobDataSourceId?: string;
  canonicalUrl?: string | null;
  /** Pointer owner, when proving a foreign-subject pointer is rejected. */
  pointerBonusId?: string;
  /** Pointer source identity, when proving a composite mismatch. */
  pointerDataSourceId?: string;
  /** Pointer key, when proving a pointer/evidence extraction mismatch. */
  pointerExtractionKey?: string;
  /** Pointer target, when proving a pointer/evidence identity mismatch. */
  pointerEvidenceId?: string;
  validFrom?: Date | null;
  expiresAt?: Date | null;
  verdict?: string;
  /** Claim owner, when proving a foreign-subject claim is rejected. */
  claimBonusId?: string;
  /** Drops every claim, to prove historical-only support is rejected. */
  withoutClaims?: boolean;
  /** Drops the evidence record the pointer names. */
  withoutEvidence?: boolean;
  extractionContext?: string;
}

export function activeBonusEvidence(options: ActiveBonusEvidenceOptions) {
  const {
    bonusId,
    observedAt,
    extractedAt = observedAt,
    sourceUrl = "https://operator.example.test/bonus-terms",
    evidenceId = `evidence-active-${bonusId}`,
    extractionKey = activeBonusExtractionKey(`${bonusId}:${evidenceId}`),
    contractVersion = EXTRACTION_CONTRACT_VERSION,
    dataSourceId = `data-source-${bonusId}`,
    scrapeJobId,
    scrapeJobDataSourceId = dataSourceId,
    canonicalUrl,
    pointerBonusId = bonusId,
    pointerDataSourceId = dataSourceId,
    pointerExtractionKey,
    pointerEvidenceId,
    validFrom = null,
    expiresAt = null,
    verdict = "SUPPORTS",
    claimBonusId = bonusId,
    withoutClaims = false,
    withoutEvidence = false,
    extractionContext = "BONUS",
  } = options;

  return [
    {
      extraction_context: extractionContext,
      contract_version: contractVersion,
      bonus_id: pointerBonusId,
      data_source_id: pointerDataSourceId,
      evidence_id: pointerEvidenceId ?? evidenceId,
      extraction_key: pointerExtractionKey ?? extractionKey,
      evidence: withoutEvidence
        ? null
        : {
            id: evidenceId,
            data_source_id: dataSourceId,
            scrape_job_id: scrapeJobId ?? null,
            source_url: sourceUrl,
            observed_at: observedAt,
            extracted_at: extractedAt,
            valid_from: validFrom,
            expires_at: expiresAt,
            extraction_key: extractionKey,
            scrape_job: scrapeJobId
              ? {
                  id: scrapeJobId,
                  data_source_id: scrapeJobDataSourceId,
                  canonical_url: canonicalUrl ?? null,
                }
              : null,
            bonus_claims: withoutClaims
              ? []
              : [{ bonus_id: claimBonusId, verdict }],
          },
    },
  ];
}
