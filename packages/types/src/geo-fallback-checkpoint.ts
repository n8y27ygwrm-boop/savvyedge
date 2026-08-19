import { z } from "zod";

export const GEO_FALLBACK_CHECKPOINT_VERSION = 1 as const;
export const MAX_GEO_FALLBACK_CHECKPOINT_BYTES = 4 * 1024;

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const ObservedAtSchema = z
  .string()
  .datetime({ offset: true })
  .refine((value: string) => Number.isFinite(new Date(value).getTime()));
const Sha256Pattern = "[a-f0-9]{64}";
const SafeHostPattern = "[a-z0-9][a-z0-9._-]{0,99}";
const ObservationFilenamePattern = `\\d{8}T\\d{9}Z_[a-zA-Z0-9_-]{1,128}_${Sha256Pattern}\\.html`;
const EvidenceLocatorPattern = new RegExp(
  `^(?:` +
    `supabase:\\/\\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}\\/` +
    `v1\\/observations\\/\\d{4}\\/(?:0[1-9]|1[0-2])\\/` +
    `(?:0[1-9]|[12]\\d|3[01])\\/${SafeHostPattern}\\/${ObservationFilenamePattern}` +
    `|v1_observations_\\d{4}_(?:0[1-9]|1[0-2])_` +
    `(?:0[1-9]|[12]\\d|3[01])_${SafeHostPattern}_${ObservationFilenamePattern}` +
    `)$`,
);
const InternalLocatorSchema = z
  .string()
  .min(1)
  .max(1_024)
  .regex(EvidenceLocatorPattern);

export const GeoFallbackProviderFailureCodeSchema = z.enum([
  "CONFIGURATION_ERROR",
  "TIMEOUT",
  "NETWORK_ERROR",
  "PROVIDER_4XX",
  "PROVIDER_5XX",
  "RESPONSE_TOO_LARGE",
  "INVALID_RESPONSE",
]);

export const GeoFallbackRejectionCodeSchema = z.enum([
  "STILL_GEO_BLOCKED",
  "SOURCE_PAGE_REJECTED",
]);

export const GeoFallbackExtractionRejectionCodeSchema = z.literal(
  "EXTRACTION_INPUT_INSUFFICIENT",
);

const BaseCheckpointSchema = z.object({
  version: z.literal(GEO_FALLBACK_CHECKPOINT_VERSION),
});

const ArtifactCheckpointFields = {
  locator: InternalLocatorSchema,
  htmlHash: Sha256Schema,
  contentHash: Sha256Schema,
  observedAt: ObservedAtSchema,
} as const;

export const GeoFallbackCheckpointSchema = z.discriminatedUnion("state", [
  BaseCheckpointSchema.extend({ state: z.literal("PRIMARY_BLOCKED") }).strict(),
  BaseCheckpointSchema.extend({ state: z.literal("REQUEST_CLAIMED") }).strict(),
  BaseCheckpointSchema.extend({
    state: z.literal("RESULT_READY"),
    ...ArtifactCheckpointFields,
  }).strict(),
  BaseCheckpointSchema.extend({
    state: z.literal("AVAILABLE"),
    ...ArtifactCheckpointFields,
  }).strict(),
  BaseCheckpointSchema.extend({
    state: z.literal("LOCAL_RECOVERED"),
    ...ArtifactCheckpointFields,
  }).strict(),
  BaseCheckpointSchema.extend({
    state: z.literal("EXTRACTION_REJECTED"),
    ...ArtifactCheckpointFields,
    reason: GeoFallbackExtractionRejectionCodeSchema,
  }).strict(),
  BaseCheckpointSchema.extend({
    state: z.literal("PROVIDER_FAILED"),
    reason: GeoFallbackProviderFailureCodeSchema,
  }).strict(),
  BaseCheckpointSchema.extend({
    state: z.literal("FALLBACK_REJECTED"),
    reason: GeoFallbackRejectionCodeSchema,
  }).strict(),
  BaseCheckpointSchema.extend({
    state: z.literal("DEDUPLICATED"),
    priorScrapeJobId: z.string().uuid(),
  }).strict(),
]);

export type GeoFallbackCheckpoint = z.infer<typeof GeoFallbackCheckpointSchema>;
export type GeoFallbackCheckpointState = GeoFallbackCheckpoint["state"];

export class GeoFallbackCheckpointError extends Error {
  public readonly code = "INVALID_GEO_FALLBACK_CHECKPOINT" as const;

  public constructor() {
    super("Geo fallback checkpoint is invalid");
    this.name = "GeoFallbackCheckpointError";
  }
}

function assertBoundedSerializedCheckpoint(value: unknown): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new GeoFallbackCheckpointError();
  }
  if (
    typeof serialized !== "string" ||
    new TextEncoder().encode(serialized).byteLength >
      MAX_GEO_FALLBACK_CHECKPOINT_BYTES
  ) {
    throw new GeoFallbackCheckpointError();
  }
}

export function parseGeoFallbackCheckpoint(
  value: unknown,
): GeoFallbackCheckpoint | null {
  if (value === null || value === undefined) {
    return null;
  }
  assertBoundedSerializedCheckpoint(value);
  const parsed = GeoFallbackCheckpointSchema.safeParse(value);
  if (!parsed.success) {
    throw new GeoFallbackCheckpointError();
  }
  return parsed.data;
}

export function createGeoFallbackCheckpoint<T extends GeoFallbackCheckpoint>(
  value: T,
): T {
  assertBoundedSerializedCheckpoint(value);
  const parsed = GeoFallbackCheckpointSchema.safeParse(value);
  if (!parsed.success) {
    throw new GeoFallbackCheckpointError();
  }
  return parsed.data as T;
}
