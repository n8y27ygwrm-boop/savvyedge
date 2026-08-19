export const GEO_BLOCK_MAX_TITLE_CHARS = 512;
export const GEO_BLOCK_MAX_CONTENT_CHARS = 4_000;

/**
 * A real geo-block page normally contains little beyond the unavailability
 * notice. Requiring fewer than this many normalized readable characters keeps
 * rich legitimate pages with incidental location wording from spending paid
 * scraping credits.
 */
export const GEO_BLOCK_SPARSE_CONTENT_THRESHOLD = 600;

export type GeoBlockClassificationCode =
  | "LOCATION_UNAVAILABLE_HTTP_451"
  | "LOCATION_UNAVAILABLE_SPARSE"
  | "NO_LOCATION_UNAVAILABILITY_SIGNAL"
  | "LOCATION_SIGNAL_NOT_CORROBORATED";

export type GeoBlockClassification =
  | {
      blocked: true;
      code: "LOCATION_UNAVAILABLE_HTTP_451" | "LOCATION_UNAVAILABLE_SPARSE";
    }
  | {
      blocked: false;
      code:
        | "NO_LOCATION_UNAVAILABILITY_SIGNAL"
        | "LOCATION_SIGNAL_NOT_CORROBORATED";
    };

export interface GeoBlockClassifierInput {
  title?: string | null;
  content?: string | null;
  httpStatus?: number | null;
}

const LOCATION_UNAVAILABILITY_PATTERN =
  /\b(?:[a-z0-9.-]+\s+is\s+|services?\s+(?:is|are)\s+)?(?:not\s+available|unavailable)\s+(?:at|in|for)\s+(?:your|this)\s+(?:location|country|region)\b/i;

/**
 * Adjacent rendered block elements are frequently emitted without separating
 * source whitespace, so readable-text extraction concatenates the last word of
 * one block with the first word of the next (`...at your location` followed by
 * `It seems...` becomes `locationIt`). That defeats the trailing `\b` of
 * LOCATION_UNAVAILABILITY_PATTERN because `I` is a word character.
 *
 * Restoring only lowercase-to-uppercase transitions repairs that boundary
 * without inventing one inside an ordinary lowercase word, so continuations
 * such as `locationized` or `regional` still fail the pattern. The repair is
 * classifier-local on purpose: changing extraction would change content hashes
 * and deduplication for every source.
 */
const BLOCK_CONCATENATION_BOUNDARY_PATTERN = /([a-z])(?=[A-Z])/g;

function boundedText(
  value: string | null | undefined,
  maximum: number,
): string {
  return typeof value === "string" ? value.slice(0, maximum) : "";
}

function withRestoredBlockBoundaries(value: string): string {
  return value.replace(BLOCK_CONCATENATION_BOUNDARY_PATTERN, "$1 ");
}

/**
 * The bounded inspected text is tested as extracted first, and only then with
 * repaired block boundaries. Checking both keeps the repair strictly additive:
 * it can recover a concatenated phrase, never invalidate one that already
 * matched.
 */
function hasLocationUnavailabilitySignal(inspected: string): boolean {
  return (
    LOCATION_UNAVAILABILITY_PATTERN.test(inspected) ||
    LOCATION_UNAVAILABILITY_PATTERN.test(withRestoredBlockBoundaries(inspected))
  );
}

function normalizedReadableLength(value: string): number {
  return value.replace(/\s+/g, " ").trim().length;
}

/**
 * Credit-protective geo-block classification.
 *
 * A location-specific unavailability phrase is always required, evaluated over
 * bounded text with rendered block-concatenation boundaries repaired. It must
 * also be corroborated by HTTP 451 or by a sparse rendered document. Status
 * codes, sparse text, generic access denial and extraction insufficiency never
 * trigger paid fallback by themselves.
 */
export function classifyGeoBlock(
  input: GeoBlockClassifierInput,
): GeoBlockClassification {
  const title = boundedText(input.title, GEO_BLOCK_MAX_TITLE_CHARS);
  const content = boundedText(input.content, GEO_BLOCK_MAX_CONTENT_CHARS);
  const inspected = `${title}\n${content}`;

  if (!hasLocationUnavailabilitySignal(inspected)) {
    return { blocked: false, code: "NO_LOCATION_UNAVAILABILITY_SIGNAL" };
  }

  if (input.httpStatus === 451) {
    return { blocked: true, code: "LOCATION_UNAVAILABLE_HTTP_451" };
  }

  if (normalizedReadableLength(content) < GEO_BLOCK_SPARSE_CONTENT_THRESHOLD) {
    return { blocked: true, code: "LOCATION_UNAVAILABLE_SPARSE" };
  }

  return { blocked: false, code: "LOCATION_SIGNAL_NOT_CORROBORATED" };
}
