import { createHash } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EvidenceArtifactConfigurationError,
  EvidenceArtifactPersistenceError,
  MAX_EVIDENCE_ARTIFACT_SIZE_BYTES,
  prepareEvidenceArtifact,
  resolveEvidenceArtifactStorageConfig,
  type PersistObservationInput,
} from "../src/services/evidence-artifact-storage.service";
import { FilesystemEvidenceArtifactStore } from "../src/services/filesystem-evidence-artifact-store";
import {
  SupabaseEvidenceArtifactStore,
  type SupabaseStorageClientLike,
} from "../src/services/supabase-evidence-artifact-store";

function hash(rawHtml: string): string {
  return createHash("sha256").update(Buffer.from(rawHtml, "utf8")).digest("hex");
}

function observation(
  overrides: Partial<PersistObservationInput> = {},
): PersistObservationInput {
  const rawHtml = overrides.rawHtml ?? "<html><body>£100 – café</body></html>";
  return {
    rawHtml,
    expectedHtmlHash: overrides.expectedHtmlHash ?? hash(rawHtml),
    observationId: overrides.observationId ?? "observation-123",
    sourceUrl:
      overrides.sourceUrl ??
      "https://user:secret@casino.example.com/offer?token=private#fragment",
    observedAt:
      overrides.observedAt ?? new Date("2026-08-11T10:20:30.456Z"),
  };
}

function fakeSupabaseClient(options?: {
  uploadError?: { statusCode: string; message: string } | null;
  downloadedHtml?: string;
}) {
  const upload = vi.fn().mockResolvedValue({
    data: { path: "stored" },
    error: options?.uploadError ?? null,
  });
  const download = vi.fn().mockImplementation(async () => ({
    data: new Blob([
      options?.downloadedHtml ?? observation().rawHtml,
    ]),
    error: null,
  }));
  const from = vi.fn().mockReturnValue({ upload, download });
  return {
    client: { storage: { from } } as SupabaseStorageClientLike,
    from,
    upload,
    download,
  };
}

describe("durable evidence artifact storage", () => {
  const roots: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps PlaywrightScraper free of snapshot persistence authority", () => {
    const source = fs.readFileSync(
      path.resolve(
        import.meta.dirname,
        "../../ai-agents/src/services/PlaywrightScraper.ts",
      ),
      "utf8",
    );
    expect(source).not.toContain('from "./SnapshotStorage"');
    expect(source).not.toContain("SnapshotStorage.saveSnapshot");
  });

  it("persists and verifies exact UTF-8 bytes through the filesystem adapter", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "savvy-evidence-"));
    roots.push(root);
    const store = new FilesystemEvidenceArtifactStore({ snapshotRoot: root });
    const input = observation();

    const result = await store.persistObservation(input);
    const prepared = prepareEvidenceArtifact(input, {
      NODE_ENV: "test",
      SAVVY_EVIDENCE_STORAGE_BACKEND: "filesystem",
      SAVVY_SNAPSHOT_ROOT: root,
    });
    const persisted = fs.readFileSync(path.join(root, result.locator));

    expect(prepared).toEqual(result);
    expect(persisted.equals(Buffer.from(input.rawHtml, "utf8"))).toBe(true);
    expect(result.htmlHash).toBe(input.expectedHtmlHash);
    expect(result.byteSize).toBe(Buffer.byteLength(input.rawHtml, "utf8"));
    expect(result.locator).not.toContain("secret");
    expect(result.locator).not.toContain("token");
    expect(result.locator).not.toContain("fragment");
  });

  it("enforces the existing five MiB bound and expected SHA-256", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "savvy-evidence-"));
    roots.push(root);
    const store = new FilesystemEvidenceArtifactStore({ snapshotRoot: root });
    const oversized = "x".repeat(MAX_EVIDENCE_ARTIFACT_SIZE_BYTES + 1);

    await expect(
      store.persistObservation(observation({ rawHtml: oversized })),
    ).rejects.toMatchObject({ code: "MAX_SIZE_EXCEEDED" });
    await expect(
      store.persistObservation(
        observation({ expectedHtmlHash: "0".repeat(64) }),
      ),
    ).rejects.toMatchObject({ code: "HASH_MISMATCH" });
  });

  it("uploads the exact Buffer with immutable Supabase options and locator", async () => {
    const fake = fakeSupabaseClient();
    const store = new SupabaseEvidenceArtifactStore({
      supabaseUrl: "https://project.supabase.co",
      supabaseSecretKey: "sb_secret_test_only",
      bucket: "savvyedge-evidence",
      client: fake.client,
    });
    const input = observation();

    const result = await store.persistObservation(input);
    const prepared = prepareEvidenceArtifact(input, {
      NODE_ENV: "test",
      SAVVY_EVIDENCE_STORAGE_BACKEND: "supabase",
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_SECRET_KEY: "sb_secret_test_only",
      SAVVY_EVIDENCE_STORAGE_BUCKET: "savvyedge-evidence",
    });
    const [objectKey, body, options] = fake.upload.mock.calls[0];

    expect(prepared).toEqual(result);
    expect(fake.from).toHaveBeenCalledWith("savvyedge-evidence");
    expect(Buffer.isBuffer(body)).toBe(true);
    expect(body.equals(Buffer.from(input.rawHtml, "utf8"))).toBe(true);
    expect(options).toEqual({
      contentType: "text/html; charset=utf-8",
      cacheControl: "0",
      upsert: false,
    });
    expect(objectKey).toMatch(
      /^v1\/observations\/2026\/08\/11\/casino\.example\.com\//,
    );
    expect(objectKey).toContain(input.expectedHtmlHash);
    expect(objectKey).not.toContain("secret");
    expect(result.locator).toBe(
      `supabase://savvyedge-evidence/${objectKey}`,
    );
    expect(fake.download).toHaveBeenCalledWith(objectKey);
  });

  it("gives separate immutable keys to separate observations of identical HTML", async () => {
    const fake = fakeSupabaseClient();
    const store = new SupabaseEvidenceArtifactStore({
      supabaseUrl: "https://project.supabase.co",
      supabaseSecretKey: "sb_secret_test_only",
      bucket: "savvyedge-evidence",
      client: fake.client,
    });

    await store.persistObservation(observation({ observationId: "obs-a" }));
    await store.persistObservation(
      observation({
        observationId: "obs-b",
        observedAt: new Date("2026-08-11T10:21:30.456Z"),
      }),
    );

    expect(fake.upload.mock.calls[0][0]).not.toBe(fake.upload.mock.calls[1][0]);
  });

  it("accepts an already-existing retry only after exact byte verification", async () => {
    const fake = fakeSupabaseClient({
      uploadError: { statusCode: "400", message: "Asset Already Exists" },
    });
    const store = new SupabaseEvidenceArtifactStore({
      supabaseUrl: "https://project.supabase.co",
      supabaseSecretKey: "sb_secret_test_only",
      bucket: "savvyedge-evidence",
      client: fake.client,
    });

    await expect(store.persistObservation(observation())).resolves.toMatchObject({
      htmlHash: observation().expectedHtmlHash,
    });
    expect(fake.upload.mock.calls[0][2].upsert).toBe(false);
    expect(fake.download).toHaveBeenCalledOnce();
  });

  it("fails closed when an existing object has different bytes", async () => {
    const fake = fakeSupabaseClient({
      uploadError: { statusCode: "400", message: "Asset Already Exists" },
      downloadedHtml: "<html>different observation</html>",
    });
    const store = new SupabaseEvidenceArtifactStore({
      supabaseUrl: "https://project.supabase.co",
      supabaseSecretKey: "sb_secret_test_only",
      bucket: "savvyedge-evidence",
      client: fake.client,
    });

    await expect(store.persistObservation(observation())).rejects.toEqual(
      expect.objectContaining<EvidenceArtifactPersistenceError>({
        code: "OBJECT_COLLISION",
      }),
    );
  });

  it("bounds rejected Supabase transport errors", async () => {
    const fake = fakeSupabaseClient();
    fake.upload.mockRejectedValueOnce(new Error("request leaked internal detail"));
    const store = new SupabaseEvidenceArtifactStore({
      supabaseUrl: "https://project.supabase.co",
      supabaseSecretKey: "sb_secret_test_only",
      bucket: "savvyedge-evidence",
      client: fake.client,
    });

    await expect(store.persistObservation(observation())).rejects.toEqual(
      expect.objectContaining<EvidenceArtifactPersistenceError>({
        code: "PERSISTENCE_FAILED",
        message: "Evidence artifact persistence failed (PERSISTENCE_FAILED)",
      }),
    );

    fake.upload.mockResolvedValueOnce({ data: { path: "stored" }, error: null });
    fake.download.mockRejectedValueOnce(new Error("response leaked detail"));
    await expect(store.persistObservation(observation())).rejects.toEqual(
      expect.objectContaining<EvidenceArtifactPersistenceError>({
        code: "STORED_OBJECT_VERIFICATION_FAILED",
        message:
          "Evidence artifact persistence failed (STORED_OBJECT_VERIFICATION_FAILED)",
      }),
    );
  });
});

describe("evidence storage configuration", () => {
  it("allows explicit or implicit filesystem only in development/test", () => {
    expect(
      resolveEvidenceArtifactStorageConfig({
        NODE_ENV: "development",
        SAVVY_EVIDENCE_STORAGE_BACKEND: "filesystem",
      }),
    ).toMatchObject({ backend: "filesystem" });
    expect(
      resolveEvidenceArtifactStorageConfig({ NODE_ENV: "test" }),
    ).toMatchObject({ backend: "filesystem" });
  });

  it("rejects filesystem and implicit fallback in production", () => {
    expect(() =>
      resolveEvidenceArtifactStorageConfig({
        SAVVY_ENV: "production",
        SAVVY_EVIDENCE_STORAGE_BACKEND: "filesystem",
      }),
    ).toThrowError(EvidenceArtifactConfigurationError);
    expect(() =>
      resolveEvidenceArtifactStorageConfig({ SAVVY_ENV: "production" }),
    ).toThrowError(EvidenceArtifactConfigurationError);
  });

  it.each([
    ["SUPABASE_URL", { SUPABASE_URL: "" }],
    ["SUPABASE_SECRET_KEY", { SUPABASE_SECRET_KEY: "" }],
    ["SAVVY_EVIDENCE_STORAGE_BUCKET", { SAVVY_EVIDENCE_STORAGE_BUCKET: "" }],
  ])("rejects missing %s", (_name, override) => {
    expect(() =>
      resolveEvidenceArtifactStorageConfig({
        NODE_ENV: "test",
        SAVVY_EVIDENCE_STORAGE_BACKEND: "supabase",
        SUPABASE_URL: "https://project.supabase.co",
        SUPABASE_SECRET_KEY: "sb_secret_test_only",
        SAVVY_EVIDENCE_STORAGE_BUCKET: "savvyedge-evidence",
        ...override,
      }),
    ).toThrowError(EvidenceArtifactConfigurationError);
  });
});
