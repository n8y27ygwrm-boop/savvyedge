import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";
import {
  resolveSnapshotRoot,
  verifyPathConfinement,
} from "@savvyedge/ai-agents";
import {
  computeEvidenceArtifactHash,
  MAX_EVIDENCE_ARTIFACT_SIZE_BYTES,
} from "./evidence-artifact-storage.service";

export type EvidenceArtifactLocatorType = "SUPABASE" | "FILESYSTEM";

export interface ReadEvidenceArtifactInput {
  locator: string;
  expectedHtmlHash: string;
}

export interface ReadEvidenceArtifactResult {
  bytes: Buffer;
  htmlHash: string;
  byteSize: number;
  locatorType: EvidenceArtifactLocatorType;
}

export interface EvidenceArtifactReader {
  readArtifact(
    input: ReadEvidenceArtifactInput,
  ): Promise<ReadEvidenceArtifactResult>;
}

export type EvidenceArtifactRetrievalErrorCode =
  | "ARTIFACT_NOT_AVAILABLE"
  | "UNSUPPORTED_ARTIFACT_LOCATOR"
  | "ARTIFACT_INTEGRITY_FAILED"
  | "ARTIFACT_READ_FAILED";

export class EvidenceArtifactRetrievalError extends Error {
  public constructor(public readonly code: EvidenceArtifactRetrievalErrorCode) {
    super(`Evidence artifact retrieval failed (${code})`);
    this.name = "EvidenceArtifactRetrievalError";
  }
}

interface StorageErrorLike {
  message?: string;
  status?: number | string;
  statusCode?: number | string;
}

interface SupabaseDownloadBucketLike {
  download(
    objectKey: string,
  ): Promise<{ data: unknown; error: StorageErrorLike | null }>;
}

export interface SupabaseDownloadClientLike {
  storage: {
    from(bucket: string): SupabaseDownloadBucketLike;
  };
}

export interface EvidenceArtifactRetrievalOptions {
  env?: NodeJS.ProcessEnv;
  supabaseClient?: SupabaseDownloadClientLike;
}

interface ParsedSupabaseLocator {
  bucket: string;
  objectKey: string;
}

const HASH_PATTERN = /^[a-f0-9]{64}$/i;
const BUCKET_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const SAFE_HOST_PATTERN = /^[a-z0-9][a-z0-9._-]{0,99}$/;
const OBSERVATION_FILE_PATTERN =
  /^\d{8}T\d{9}Z_[a-zA-Z0-9_-]{1,128}_([a-f0-9]{64})\.html$/;
const URI_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;
const SAFE_FILESYSTEM_SEGMENT_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

function retrievalError(
  code: EvidenceArtifactRetrievalErrorCode,
): EvidenceArtifactRetrievalError {
  return new EvidenceArtifactRetrievalError(code);
}

function normalizeExpectedHash(expectedHtmlHash: string): string {
  if (
    typeof expectedHtmlHash !== "string" ||
    !HASH_PATTERN.test(expectedHtmlHash)
  ) {
    throw retrievalError("ARTIFACT_INTEGRITY_FAILED");
  }
  return expectedHtmlHash.toLowerCase();
}

function verifyRetrievedBytes(bytes: Buffer, expectedHtmlHash: string): string {
  if (bytes.byteLength > MAX_EVIDENCE_ARTIFACT_SIZE_BYTES) {
    throw retrievalError("ARTIFACT_INTEGRITY_FAILED");
  }
  const htmlHash = computeEvidenceArtifactHash(bytes);
  if (htmlHash !== expectedHtmlHash) {
    throw retrievalError("ARTIFACT_INTEGRITY_FAILED");
  }
  return htmlHash;
}

function isMissingStorageObject(error: StorageErrorLike): boolean {
  const status = String(error.statusCode ?? error.status ?? "");
  const message = String(error.message ?? "").toLowerCase();
  return status === "404" || message.includes("not found");
}

function parseSupabaseLocator(
  locator: string,
  configuredBucket: string,
  expectedHtmlHash: string,
): ParsedSupabaseLocator {
  if (
    !locator.startsWith("supabase://") ||
    locator.includes("\\") ||
    locator.includes("\0") ||
    locator.includes("?") ||
    locator.includes("#") ||
    locator.includes("%")
  ) {
    throw retrievalError("UNSUPPORTED_ARTIFACT_LOCATOR");
  }

  const remainder = locator.slice("supabase://".length);
  const firstSlash = remainder.indexOf("/");
  if (firstSlash <= 0 || firstSlash === remainder.length - 1) {
    throw retrievalError("UNSUPPORTED_ARTIFACT_LOCATOR");
  }

  const bucket = remainder.slice(0, firstSlash);
  const objectKey = remainder.slice(firstSlash + 1);
  if (!BUCKET_PATTERN.test(bucket) || bucket !== configuredBucket) {
    throw retrievalError("UNSUPPORTED_ARTIFACT_LOCATOR");
  }

  const segments = objectKey.split("/");
  if (
    segments.length !== 7 ||
    segments.some(
      (segment) => segment.length === 0 || segment === "." || segment === "..",
    ) ||
    segments[0] !== "v1" ||
    segments[1] !== "observations" ||
    !/^\d{4}$/.test(segments[2]) ||
    !/^(0[1-9]|1[0-2])$/.test(segments[3]) ||
    !/^(0[1-9]|[12]\d|3[01])$/.test(segments[4]) ||
    !SAFE_HOST_PATTERN.test(segments[5])
  ) {
    throw retrievalError("UNSUPPORTED_ARTIFACT_LOCATOR");
  }

  const fileMatch = OBSERVATION_FILE_PATTERN.exec(segments[6]);
  if (!fileMatch) {
    throw retrievalError("UNSUPPORTED_ARTIFACT_LOCATOR");
  }
  if (fileMatch[1] !== expectedHtmlHash) {
    throw retrievalError("ARTIFACT_INTEGRITY_FAILED");
  }

  return { bucket, objectKey };
}

function parseLegacyFilesystemLocator(locator: string): string[] {
  if (
    !locator ||
    locator.includes("\\") ||
    locator.includes("\0") ||
    locator.includes("%") ||
    locator.includes("?") ||
    locator.includes("#") ||
    URI_SCHEME_PATTERN.test(locator) ||
    path.isAbsolute(locator) ||
    path.win32.isAbsolute(locator)
  ) {
    throw retrievalError("UNSUPPORTED_ARTIFACT_LOCATOR");
  }

  const segments = locator.split("/");
  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        !SAFE_FILESYSTEM_SEGMENT_PATTERN.test(segment),
    ) ||
    !segments.at(-1)?.toLowerCase().endsWith(".html")
  ) {
    throw retrievalError("UNSUPPORTED_ARTIFACT_LOCATOR");
  }
  return segments;
}

async function bytesFromDownload(data: unknown): Promise<Buffer> {
  if (
    data &&
    typeof data === "object" &&
    "size" in data &&
    typeof (data as { size?: unknown }).size === "number" &&
    (data as { size: number }).size > MAX_EVIDENCE_ARTIFACT_SIZE_BYTES
  ) {
    throw retrievalError("ARTIFACT_INTEGRITY_FAILED");
  }
  if (data instanceof Uint8Array) {
    return Buffer.from(data);
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }
  if (
    data &&
    typeof data === "object" &&
    "arrayBuffer" in data &&
    typeof (data as { arrayBuffer?: unknown }).arrayBuffer === "function"
  ) {
    try {
      return Buffer.from(
        await (data as { arrayBuffer(): Promise<ArrayBuffer> }).arrayBuffer(),
      );
    } catch {
      throw retrievalError("ARTIFACT_READ_FAILED");
    }
  }
  throw retrievalError("ARTIFACT_READ_FAILED");
}

function requiredSupabaseValue(
  value: string | undefined,
): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw retrievalError("ARTIFACT_READ_FAILED");
  }
  return normalized;
}

export class EvidenceArtifactRetrievalService
  implements EvidenceArtifactReader
{
  private readonly env: NodeJS.ProcessEnv;
  private readonly injectedSupabaseClient?: SupabaseDownloadClientLike;

  public constructor(options: EvidenceArtifactRetrievalOptions = {}) {
    this.env = options.env ?? process.env;
    this.injectedSupabaseClient = options.supabaseClient;
  }

  public async readArtifact(
    input: ReadEvidenceArtifactInput,
  ): Promise<ReadEvidenceArtifactResult> {
    const expectedHtmlHash = normalizeExpectedHash(input.expectedHtmlHash);
    if (typeof input.locator !== "string" || input.locator.length === 0) {
      throw retrievalError("ARTIFACT_NOT_AVAILABLE");
    }

    if (input.locator.startsWith("supabase://")) {
      return this.readSupabaseArtifact(
        input.locator,
        expectedHtmlHash,
      );
    }
    if (URI_SCHEME_PATTERN.test(input.locator)) {
      throw retrievalError("UNSUPPORTED_ARTIFACT_LOCATOR");
    }
    return this.readFilesystemArtifact(input.locator, expectedHtmlHash);
  }

  private async readSupabaseArtifact(
    locator: string,
    expectedHtmlHash: string,
  ): Promise<ReadEvidenceArtifactResult> {
    const configuredBucket = requiredSupabaseValue(
      this.env.SAVVY_EVIDENCE_STORAGE_BUCKET,
    );
    if (!BUCKET_PATTERN.test(configuredBucket)) {
      throw retrievalError("ARTIFACT_READ_FAILED");
    }
    const parsed = parseSupabaseLocator(
      locator,
      configuredBucket,
      expectedHtmlHash,
    );

    let client = this.injectedSupabaseClient;
    if (!client) {
      const supabaseUrl = requiredSupabaseValue(this.env.SUPABASE_URL);
      const supabaseSecret = requiredSupabaseValue(
        this.env.SUPABASE_SECRET_KEY || this.env.SUPABASE_SERVICE_ROLE_KEY,
      );
      try {
        const parsedUrl = new URL(supabaseUrl);
        if (
          parsedUrl.protocol !== "https:" &&
          parsedUrl.hostname !== "localhost"
        ) {
          throw new Error("invalid protocol");
        }
        client = createClient(supabaseUrl, supabaseSecret, {
          auth: {
            autoRefreshToken: false,
            persistSession: false,
            detectSessionInUrl: false,
          },
        }) as unknown as SupabaseDownloadClientLike;
      } catch {
        throw retrievalError("ARTIFACT_READ_FAILED");
      }
    }

    let download: { data: unknown; error: StorageErrorLike | null };
    try {
      download = await client.storage
        .from(parsed.bucket)
        .download(parsed.objectKey);
    } catch {
      throw retrievalError("ARTIFACT_READ_FAILED");
    }
    if (download.error) {
      throw retrievalError(
        isMissingStorageObject(download.error)
          ? "ARTIFACT_NOT_AVAILABLE"
          : "ARTIFACT_READ_FAILED",
      );
    }

    const bytes = await bytesFromDownload(download.data);
    const htmlHash = verifyRetrievedBytes(bytes, expectedHtmlHash);
    return {
      bytes,
      htmlHash,
      byteSize: bytes.byteLength,
      locatorType: "SUPABASE",
    };
  }

  private async readFilesystemArtifact(
    locator: string,
    expectedHtmlHash: string,
  ): Promise<ReadEvidenceArtifactResult> {
    const segments = parseLegacyFilesystemLocator(locator);
    const snapshotRoot = resolveSnapshotRoot(
      this.env.SAVVY_SNAPSHOT_ROOT?.trim() || undefined,
    );
    const lexicalTarget = path.resolve(snapshotRoot, ...segments);

    try {
      verifyPathConfinement(snapshotRoot, lexicalTarget);
      const directStats = await fs.promises.lstat(lexicalTarget);
      if (directStats.isSymbolicLink()) {
        throw retrievalError("UNSUPPORTED_ARTIFACT_LOCATOR");
      }

      const [realRoot, realTarget] = await Promise.all([
        fs.promises.realpath(snapshotRoot),
        fs.promises.realpath(lexicalTarget),
      ]);
      verifyPathConfinement(realRoot, realTarget);

      const targetStats = await fs.promises.stat(realTarget);
      if (!targetStats.isFile()) {
        throw retrievalError("ARTIFACT_NOT_AVAILABLE");
      }
      if (targetStats.size > MAX_EVIDENCE_ARTIFACT_SIZE_BYTES) {
        throw retrievalError("ARTIFACT_INTEGRITY_FAILED");
      }

      const bytes = await fs.promises.readFile(realTarget);
      const htmlHash = verifyRetrievedBytes(bytes, expectedHtmlHash);
      return {
        bytes,
        htmlHash,
        byteSize: bytes.byteLength,
        locatorType: "FILESYSTEM",
      };
    } catch (error: unknown) {
      if (error instanceof EvidenceArtifactRetrievalError) {
        throw error;
      }
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        ["ENOENT", "ENOTDIR"].includes(
          String((error as { code?: unknown }).code),
        )
      ) {
        throw retrievalError("ARTIFACT_NOT_AVAILABLE");
      }
      if (
        error instanceof Error &&
        error.message === "PATH_CONFINEMENT_VIOLATION"
      ) {
        throw retrievalError("UNSUPPORTED_ARTIFACT_LOCATOR");
      }
      throw retrievalError("ARTIFACT_READ_FAILED");
    }
  }
}

export async function readEvidenceArtifact(
  input: ReadEvidenceArtifactInput,
  options: EvidenceArtifactRetrievalOptions = {},
): Promise<ReadEvidenceArtifactResult> {
  return new EvidenceArtifactRetrievalService(options).readArtifact(input);
}
