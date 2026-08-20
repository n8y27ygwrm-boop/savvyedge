import { prisma } from "@savvyedge/database";
import { BONUS_EXTRACTION_CONTEXT } from "./ingestion.service";

/**
 * Active-versus-historical evidence resolution.
 *
 * "Active" is defined by an explicit pointer row, never by ordering on
 * extracted_at or a random UUID: reprocessing time is not observation time, and
 * a UUID is not an authority. Historical rows stay queryable and immutable;
 * they are simply no longer referenced.
 */

export interface ActiveBonusEvidence {
  evidenceId: string;
  extractionKey: string;
  contractVersion: string;
  activatedAt: Date;
}

/**
 * The active BONUS extraction for a bonus, or null when that bonus predates
 * the extraction contract.
 */
export async function getActiveBonusEvidence(
  bonusId: string,
  db: typeof prisma = prisma,
): Promise<ActiveBonusEvidence | null> {
  const pointer = await db.activeExtractionPointer.findUnique({
    where: {
      bonus_id_extraction_context: {
        bonus_id: bonusId,
        extraction_context: BONUS_EXTRACTION_CONTEXT,
      },
    },
  });
  if (!pointer) return null;

  return {
    evidenceId: pointer.evidence_id,
    extractionKey: pointer.extraction_key,
    contractVersion: pointer.contract_version,
    activatedAt: pointer.activated_at,
  };
}

/**
 * Claim ids that may be supplied to a governance transition for a bonus.
 *
 * Before this bonus has an active pointer, this returns every claim —
 * preserving pre-contract behaviour exactly. Once its pointer exists, only
 * claims belonging to that evidence are governance eligible; a superseded
 * claim such as the retracted `20 SUPPORTS` stays queryable but can never
 * evidence a new approval.
 */
export async function getGovernanceEligibleBonusClaimIds(
  bonusId: string,
  db: typeof prisma = prisma,
): Promise<string[]> {
  const claims = await db.bonusEvidenceClaim.findMany({
    where: { bonus_id: bonusId },
    select: {
      id: true,
      evidence_id: true,
    },
  });
  if (claims.length === 0) return [];

  const pointer = await db.activeExtractionPointer.findUnique({
    where: {
      bonus_id_extraction_context: {
        bonus_id: bonusId,
        extraction_context: BONUS_EXTRACTION_CONTEXT,
      },
    },
    select: { evidence_id: true },
  });

  // Legacy: no pointer for this bonus -> unchanged behaviour.
  if (!pointer) {
    return claims.map((claim) => claim.id);
  }

  return claims
    .filter((claim) => claim.evidence_id === pointer.evidence_id)
    .map((claim) => claim.id);
}

/**
 * Partitions a bonus's claims for reviewer display.
 */
export async function partitionBonusClaimsByActivity(
  bonusId: string,
  db: typeof prisma = prisma,
): Promise<{ activeClaimIds: Set<string>; hasActivePointer: boolean }> {
  const eligible = await getGovernanceEligibleBonusClaimIds(bonusId, db);
  const pointer = await db.activeExtractionPointer.findUnique({
    where: {
      bonus_id_extraction_context: {
        bonus_id: bonusId,
        extraction_context: BONUS_EXTRACTION_CONTEXT,
      },
    },
    select: { id: true },
  });
  return {
    activeClaimIds: new Set(eligible),
    hasActivePointer: pointer !== null,
  };
}
