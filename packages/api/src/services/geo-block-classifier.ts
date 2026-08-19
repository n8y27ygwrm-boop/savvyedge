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

function boundedText(
  value: string | null | undefined,
  maximum: number,
): string {
  return typeof value === "string" ? value.slice(0, maximum) : "";
}

function normalizedReadableLength(value: string): number {
  return value.replace(/\s+/g, " ").trim().length;
}

/**
 * Credit-protective geo-block classification.
 *
 * A location-specific unavailability phrase is always required. It must also
 * be corroborated by HTTP 451 or by a sparse rendered document. Status codes,
 * sparse text, generic access denial and extraction insufficiency never trigger
 * paid fallback by themselves.
 */
export function classifyGeoBlock(
  input: GeoBlockClassifierInput,
): GeoBlockClassification {
  const title = boundedText(input.title, GEO_BLOCK_MAX_TITLE_CHARS);
  const content = boundedText(input.content, GEO_BLOCK_MAX_CONTENT_CHARS);
  const inspected = `${title}\n${content}`;

  if (!LOCATION_UNAVAILABILITY_PATTERN.test(inspected)) {
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
