import { createHash } from "crypto";
import { extractSafeHostForSnapshot } from "@savvyedge/ai-agents";
import { FilesystemEvidenceArtifactStore } from "./filesystem-evidence-artifact-store";
import { SupabaseEvidenceArtifactStore } from "./supabase-evidence-artifact-store";

export const MAX_EVIDENCE_ARTIFACT_SIZE_BYTES = 5 * 1024 * 1024;

export type EvidenceArtifactStorageBackend = "filesystem" | "supabase";

export interface PersistObservationInput {
  rawHtml: string;
  expectedHtmlHash: string;
  observationId: string;
  sourceUrl: string;
  observedAt: Date;
}

export interface PersistObservationResult {
  locator: string;
  htmlHash: string;
  byteSize: number;
}

export interface EvidenceArtifactStore {
  persistObservation(
    input: PersistObservationInput,
  ): Promise<PersistObservationResult>;
}

export type EvidenceArtifactPersistenceErrorCode =
  | "INVALID_OBSERVATION"
  | "MAX_SIZE_EXCEEDED"
  | "HASH_MISMATCH"
  | "PERSISTENCE_FAILED"
  | "OBJECT_COLLISION"
  | "STORED_OBJECT_VERIFICATION_FAILED";

export class EvidenceArtifactPersistenceError extends Error {
  constructor(public readonly code: EvidenceArtifactPersistenceErrorCode) {
    super(`Evidence artifact persistence failed (${code})`);
    this.name = "EvidenceArtifactPersistenceError";
  }
}

export class EvidenceArtifactConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvidenceArtifactConfigurationError";
  }
}

export type EvidenceArtifactStorageConfig =
  | {
      backend: "filesystem";
      snapshotRoot?: string;
    }
  | {
      backend: "supabase";
      supabaseUrl: string;
      supabaseSecretKey: string;
      bucket: string;
    };

function normalizedEnvironmentValues(env: NodeJS.ProcessEnv): string[] {
  return [env.SAVVY_ENV, env.NEXT_PUBLIC_APP_ENV, env.NODE_ENV]
    .map((value) => value?.trim().toLowerCase())
    .filter((value): value is string => Boolean(value));
}

export function isExplicitProductionEnvironment(
  env: NodeJS.ProcessEnv,
): boolean {
  return normalizedEnvironmentValues(env).some(
    (value) => value === "production" || value === "prod",
  );
}

function isExplicitDevelopmentOrTestEnvironment(
  env: NodeJS.ProcessEnv,
): boolean {
  return normalizedEnvironmentValues(env).some((value) =>
    ["development", "dev", "test"].includes(value),
  );
}

function requireConfigValue(
  name: string,
  value: string | undefined,
): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new EvidenceArtifactConfigurationError(
      `Invalid evidence storage configuration: ${name} is required`,
    );
  }
  return normalized;
}

export function resolveEvidenceArtifactStorageConfig(
  env: NodeJS.ProcessEnv = process.env,
): EvidenceArtifactStorageConfig {
  const configuredBackend = env.SAVVY_EVIDENCE_STORAGE_BACKEND
    ?.trim()
    .toLowerCase();
  const production = isExplicitProductionEnvironment(env);

  if (configuredBackend === "filesystem") {
    if (production) {
      throw new EvidenceArtifactConfigurationError(
        "Invalid production evidence storage configuration: filesystem backend is forbidden",
      );
    }
    return {
      backend: "filesystem",
      snapshotRoot: env.SAVVY_SNAPSHOT_ROOT?.trim() || undefined,
    };
  }

  if (configuredBackend === "supabase") {
    return {
      backend: "supabase",
      supabaseUrl: requireConfigValue("SUPABASE_URL", env.SUPABASE_URL),
      supabaseSecretKey: requireConfigValue(
        "SUPABASE_SECRET_KEY",
        env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY,
      ),
      bucket: requireConfigValue(
        "SAVVY_EVIDENCE_STORAGE_BUCKET",
        env.SAVVY_EVIDENCE_STORAGE_BUCKET,
      ),
    };
  }

  if (configuredBackend) {
    throw new EvidenceArtifactConfigurationError(
      "Invalid evidence storage configuration: SAVVY_EVIDENCE_STORAGE_BACKEND must be filesystem or supabase",
    );
  }

  if (isExplicitDevelopmentOrTestEnvironment(env)) {
    return {
      backend: "filesystem",
      snapshotRoot: env.SAVVY_SNAPSHOT_ROOT?.trim() || undefined,
    };
  }

  throw new EvidenceArtifactConfigurationError(
    production
      ? "Invalid production evidence storage configuration: SAVVY_EVIDENCE_STORAGE_BACKEND must explicitly equal supabase"
      : "Invalid evidence storage configuration: SAVVY_EVIDENCE_STORAGE_BACKEND is required outside development/test",
  );
}

export function createEvidenceArtifactStore(
  env: NodeJS.ProcessEnv = process.env,
): EvidenceArtifactStore {
  const config = resolveEvidenceArtifactStorageConfig(env);
  if (config.backend === "filesystem") {
    return new FilesystemEvidenceArtifactStore({
      snapshotRoot: config.snapshotRoot,
    });
  }
  return new SupabaseEvidenceArtifactStore(config);
}

export function computeEvidenceArtifactHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function validateObservationInput(
  input: PersistObservationInput,
): { bytes: Buffer; htmlHash: string } {
  if (
    !input ||
    typeof input.rawHtml !== "string" ||
    typeof input.observationId !== "string" ||
    input.observationId.trim().length === 0 ||
    typeof input.sourceUrl !== "string" ||
    input.sourceUrl.trim().length === 0 ||
    !(input.observedAt instanceof Date) ||
    !Number.isFinite(input.observedAt.getTime()) ||
    !/^[a-f0-9]{64}$/i.test(input.expectedHtmlHash)
  ) {
    throw new EvidenceArtifactPersistenceError("INVALID_OBSERVATION");
  }

  const bytes = Buffer.from(input.rawHtml, "utf8");
  if (bytes.byteLength > MAX_EVIDENCE_ARTIFACT_SIZE_BYTES) {
    throw new EvidenceArtifactPersistenceError("MAX_SIZE_EXCEEDED");
  }

  const htmlHash = computeEvidenceArtifactHash(bytes);
  if (htmlHash !== input.expectedHtmlHash.toLowerCase()) {
    throw new EvidenceArtifactPersistenceError("HASH_MISMATCH");
  }
  return { bytes, htmlHash };
}

function safeObservationId(observationId: string): string {
  const normalized = observationId
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 128);
  if (!normalized) {
    throw new EvidenceArtifactPersistenceError("INVALID_OBSERVATION");
  }
  return normalized;
}

export function buildEvidenceArtifactObjectKey(
  input: PersistObservationInput,
  htmlHash = input.expectedHtmlHash.toLowerCase(),
): string {
  const year = input.observedAt.getUTCFullYear().toString().padStart(4, "0");
  const month = (input.observedAt.getUTCMonth() + 1)
    .toString()
    .padStart(2, "0");
  const day = input.observedAt.getUTCDate().toString().padStart(2, "0");
  const observedUtc = input.observedAt
    .toISOString()
    .replace(/[-:.]/g, "");
  const safeHost = extractSafeHostForSnapshot(input.sourceUrl);

  return [
    "v1",
    "observations",
    year,
    month,
    day,
    safeHost,
    `${observedUtc}_${safeObservationId(input.observationId)}_${htmlHash}.html`,
  ].join("/");
}

export class EvidenceArtifactStorageService {
  public static async persistObservation(
    input: PersistObservationInput,
    env: NodeJS.ProcessEnv = process.env,
  ): Promise<PersistObservationResult> {
    return createEvidenceArtifactStore(env).persistObservation(input);
  }
}
