import { createClient } from "@supabase/supabase-js";
import {
  buildEvidenceArtifactObjectKey,
  computeEvidenceArtifactHash,
  EvidenceArtifactConfigurationError,
  EvidenceArtifactPersistenceError,
  type EvidenceArtifactStore,
  type PersistObservationInput,
  type PersistObservationResult,
  validateObservationInput,
} from "./evidence-artifact-storage.service";

interface StorageErrorLike {
  message?: string;
  status?: number | string;
  statusCode?: number | string;
  error?: string;
  errorCode?: string;
}

interface SupabaseBucketClientLike {
  upload(
    path: string,
    body: Buffer,
    options: {
      contentType: string;
      cacheControl: string;
      upsert: boolean;
    },
  ): Promise<{ data: unknown; error: StorageErrorLike | null }>;
  download(
    path: string,
  ): Promise<{ data: unknown; error: StorageErrorLike | null }>;
}

export interface SupabaseStorageClientLike {
  storage: {
    from(bucket: string): SupabaseBucketClientLike;
  };
}

export interface SupabaseEvidenceArtifactStoreOptions {
  supabaseUrl: string;
  supabaseSecretKey: string;
  bucket: string;
  client?: SupabaseStorageClientLike;
}

function isAlreadyExistsError(error: StorageErrorLike | null): boolean {
  if (!error) return false;
  const status = String(error.statusCode ?? error.status ?? "");
  const code = String(error.errorCode ?? error.error ?? "").toLowerCase();
  const message = String(error.message ?? "").toLowerCase();
  return (
    status === "409" ||
    (status === "400" &&
      (code.includes("duplicate") || message.includes("already exists")))
  );
}

async function downloadedBytes(data: unknown): Promise<Buffer> {
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
    return Buffer.from(
      await (data as { arrayBuffer(): Promise<ArrayBuffer> }).arrayBuffer(),
    );
  }
  throw new EvidenceArtifactPersistenceError(
    "STORED_OBJECT_VERIFICATION_FAILED",
  );
}

export class SupabaseEvidenceArtifactStore implements EvidenceArtifactStore {
  private readonly bucket: string;
  private readonly client: SupabaseStorageClientLike;

  constructor(options: SupabaseEvidenceArtifactStoreOptions) {
    const url = options.supabaseUrl?.trim();
    const secret = options.supabaseSecretKey?.trim();
    const bucket = options.bucket?.trim();
    if (!url || !secret || !bucket) {
      throw new EvidenceArtifactConfigurationError(
        "Invalid Supabase evidence storage configuration",
      );
    }
    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.protocol !== "https:" && parsedUrl.hostname !== "localhost") {
        throw new Error("invalid protocol");
      }
    } catch {
      throw new EvidenceArtifactConfigurationError(
        "Invalid Supabase evidence storage URL",
      );
    }
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(bucket)) {
      throw new EvidenceArtifactConfigurationError(
        "Invalid Supabase evidence storage bucket",
      );
    }

    this.bucket = bucket;
    this.client =
      options.client ??
      (createClient(url, secret, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false,
        },
      }) as unknown as SupabaseStorageClientLike);
  }

  public async persistObservation(
    input: PersistObservationInput,
  ): Promise<PersistObservationResult> {
    const { bytes, htmlHash } = validateObservationInput(input);
    const objectKey = buildEvidenceArtifactObjectKey(input, htmlHash);
    const bucketClient = this.client.storage.from(this.bucket);

    let upload: Awaited<ReturnType<SupabaseBucketClientLike["upload"]>>;
    try {
      upload = await bucketClient.upload(objectKey, bytes, {
        contentType: "text/html; charset=utf-8",
        cacheControl: "0",
        upsert: false,
      });
    } catch {
      throw new EvidenceArtifactPersistenceError("PERSISTENCE_FAILED");
    }

    if (upload.error && !isAlreadyExistsError(upload.error)) {
      throw new EvidenceArtifactPersistenceError("PERSISTENCE_FAILED");
    }

    let downloaded: Awaited<ReturnType<SupabaseBucketClientLike["download"]>>;
    try {
      downloaded = await bucketClient.download(objectKey);
    } catch {
      throw new EvidenceArtifactPersistenceError(
        "STORED_OBJECT_VERIFICATION_FAILED",
      );
    }
    if (downloaded.error) {
      throw new EvidenceArtifactPersistenceError(
        "STORED_OBJECT_VERIFICATION_FAILED",
      );
    }

    const persistedBytes = await downloadedBytes(downloaded.data);
    if (
      persistedBytes.byteLength !== bytes.byteLength ||
      computeEvidenceArtifactHash(persistedBytes) !== htmlHash ||
      !persistedBytes.equals(bytes)
    ) {
      throw new EvidenceArtifactPersistenceError(
        upload.error ? "OBJECT_COLLISION" : "STORED_OBJECT_VERIFICATION_FAILED",
      );
    }

    return {
      locator: `supabase://${this.bucket}/${objectKey}`,
      htmlHash,
      byteSize: bytes.byteLength,
    };
  }
}
