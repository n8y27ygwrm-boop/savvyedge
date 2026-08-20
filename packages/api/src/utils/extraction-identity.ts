import { Prisma } from "@savvyedge/database";

export const EXTRACTION_IDENTITY_CONSTRAINT =
  "EvidenceRecord_data_source_id_extraction_key_key";

const EXTRACTION_IDENTITY_FIELDS = [
  "data_source_id",
  "extraction_key",
] as const;

/**
 * Recognises a unique violation on EvidenceRecord(data_source_id, extraction_key).
 *
 * This is the final serialization point for "exactly one effective extraction
 * per data source, authoritative artifact, context and contract version". A
 * violation therefore means another execution already committed the identical
 * extraction — a benign losing race, not a failure.
 *
 * Deliberately distinct from isBonusIdentityUniqueViolation, which matches
 * casino_id + source_offer_key and carries different recovery semantics.
 */
export function isExtractionKeyUniqueViolation(error: unknown): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== "P2002"
  ) {
    return false;
  }

  const target = error.meta?.target;
  if (Array.isArray(target)) {
    return (
      target.length === EXTRACTION_IDENTITY_FIELDS.length &&
      target.every(
        (field, index) => field === EXTRACTION_IDENTITY_FIELDS[index],
      )
    );
  }

  // Some Prisma/PostgreSQL combinations expose the stable SQL constraint name
  // instead of its field list. Exact equality is intentional: substring
  // matching could misclassify an unrelated P2002 as a benign race.
  return target === EXTRACTION_IDENTITY_CONSTRAINT;
}
