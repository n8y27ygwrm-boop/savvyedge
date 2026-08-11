import { createHash } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createElement } from "../../../apps/admin/node_modules/react/index.js";
import { renderToStaticMarkup } from "../../../apps/admin/node_modules/react-dom/server.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EvidenceArtifactRetrievalError,
  EvidenceArtifactRetrievalService,
  MAX_EVIDENCE_ARTIFACT_SIZE_BYTES,
  type EvidenceArtifactReader,
  type SupabaseDownloadClientLike,
} from "../src";
import {
  AdminEvidenceRetrievalError,
  retrieveGovernedAdminEvidence,
  type AdminEvidenceRetrievalResult,
} from "../../../apps/admin/src/lib/evidence-retrieval";
import {
  createAdminEvidenceGetHandler,
  type AdminEvidenceRouteDependencies,
} from "../../../apps/admin/src/app/api/admin/evidence/[id]/route";
import {
  EvidenceArtifactText,
} from "../../../apps/admin/src/components/evidence/EvidenceArtifactViewer";

const EVIDENCE_ID = "11111111-1111-4111-8111-111111111111";
const RAW_HTML =
  '<html><body><script>window.pwned=true</script><img src=x onerror="alert(1)"></body></html>';

function sha256(bytes: string | Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalLocator(
  htmlHash = sha256(RAW_HTML),
  bucket = "savvyedge-evidence",
): string {
  return (
    `supabase://${bucket}/v1/observations/2026/08/11/` +
    `casino.example.com/20260811T102030456Z_observation-123_${htmlHash}.html`
  );
}

function fakeSupabase(options?: {
  bytes?: Buffer;
  error?: { statusCode?: string; message?: string } | null;
  reject?: Error;
}) {
  const download = options?.reject
    ? vi.fn().mockRejectedValue(options.reject)
    : vi.fn().mockResolvedValue({
        data: new Blob([options?.bytes ?? Buffer.from(RAW_HTML, "utf8")]),
        error: options?.error ?? null,
      });
  const from = vi.fn().mockReturnValue({ download });
  return {
    client: { storage: { from } } as SupabaseDownloadClientLike,
    from,
    download,
  };
}

function supabaseReader(
  fake: ReturnType<typeof fakeSupabase>,
  env: NodeJS.ProcessEnv = {},
) {
  return new EvidenceArtifactRetrievalService({
    env: {
      SAVVY_EVIDENCE_STORAGE_BUCKET: "savvyedge-evidence",
      ...env,
    },
    supabaseClient: fake.client,
  });
}

function evidenceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: EVIDENCE_ID,
    evidence_type: "OPERATOR_PAGE",
    source_url: "https://casino.example.com/offer",
    snapshot_path: canonicalLocator(),
    html_hash: sha256(RAW_HTML),
    observed_at: new Date("2026-08-11T10:20:30.456Z"),
    extracted_at: new Date("2026-08-11T10:21:00.000Z"),
    ...overrides,
  };
}

function fakeDatabase(result: ReturnType<typeof evidenceRow> | null) {
  const findFirst = vi.fn().mockResolvedValue(result);
  return {
    findFirst,
    database: {
      evidenceRecord: { findFirst },
    } as never,
  };
}

function retrievedEvidence(
  overrides: Partial<AdminEvidenceRetrievalResult> = {},
): AdminEvidenceRetrievalResult {
  return {
    id: EVIDENCE_ID,
    evidenceType: "OPERATOR_PAGE",
    sourceUrl: "https://casino.example.com/offer",
    observedAt: "2026-08-11T10:20:30.456Z",
    extractedAt: "2026-08-11T10:21:00.000Z",
    htmlHash: sha256(RAW_HTML),
    locatorType: "SUPABASE",
    byteSize: Buffer.byteLength(RAW_HTML, "utf8"),
    availability: "AVAILABLE",
    content: RAW_HTML,
    ...overrides,
  };
}

describe("D4B2B API-owned evidence artifact retrieval", () => {
  const temporaryRoots: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const root of temporaryRoots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("accepts only a canonical configured-bucket Supabase locator and rehashes downloaded bytes", async () => {
    const fake = fakeSupabase();
    const result = await supabaseReader(fake).readArtifact({
      locator: canonicalLocator(),
      expectedHtmlHash: sha256(RAW_HTML),
    });

    expect(fake.from).toHaveBeenCalledWith("savvyedge-evidence");
    expect(fake.download).toHaveBeenCalledWith(
      expect.stringMatching(/^v1\/observations\/2026\/08\/11\//),
    );
    expect(result).toMatchObject({
      htmlHash: sha256(RAW_HTML),
      byteSize: Buffer.byteLength(RAW_HTML, "utf8"),
      locatorType: "SUPABASE",
    });
    expect(result.bytes.equals(Buffer.from(RAW_HTML, "utf8"))).toBe(true);
  });

  it("rejects Supabase bucket mismatch before any storage call", async () => {
    const fake = fakeSupabase();
    await expect(
      supabaseReader(fake).readArtifact({
        locator: canonicalLocator(sha256(RAW_HTML), "other-bucket"),
        expectedHtmlHash: sha256(RAW_HTML),
      }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_ARTIFACT_LOCATOR" });
    expect(fake.from).not.toHaveBeenCalled();
  });

  it.each([
    "supabase://savvyedge-evidence/v1/observations/2026/08/11/casino.example.com/../artifact.html",
    "supabase://savvyedge-evidence/v1/observations/2026/08/11//artifact.html",
    "supabase://savvyedge-evidence/v1/observations/2026/08/11/casino.example.com/%2e%2e.html",
    "supabase://savvyedge-evidence/v1/observations/2026/08/11/casino.example.com/artifact.html?download=1",
    "supabase://savvyedge-evidence/v1/observations/2026/08/11/casino.example.com\\artifact.html",
  ])("rejects malformed Supabase object key %s", async (locator) => {
    const fake = fakeSupabase();
    await expect(
      supabaseReader(fake).readArtifact({
        locator,
        expectedHtmlHash: sha256(RAW_HTML),
      }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_ARTIFACT_LOCATOR" });
    expect(fake.download).not.toHaveBeenCalled();
  });

  it("fails closed on missing, invalid, or mismatched hashes", async () => {
    const fake = fakeSupabase();
    await expect(
      supabaseReader(fake).readArtifact({
        locator: canonicalLocator(),
        expectedHtmlHash: "invalid",
      }),
    ).rejects.toMatchObject({ code: "ARTIFACT_INTEGRITY_FAILED" });

    await expect(
      supabaseReader(fake).readArtifact({
        locator: canonicalLocator(sha256("different-key-hash")),
        expectedHtmlHash: sha256(RAW_HTML),
      }),
    ).rejects.toMatchObject({ code: "ARTIFACT_INTEGRITY_FAILED" });

    const different = "<html>different</html>";
    const mismatchFake = fakeSupabase({ bytes: Buffer.from(different) });
    await expect(
      supabaseReader(mismatchFake).readArtifact({
        locator: canonicalLocator(),
        expectedHtmlHash: sha256(RAW_HTML),
      }),
    ).rejects.toMatchObject({ code: "ARTIFACT_INTEGRITY_FAILED" });
  });

  it("enforces the five MiB bound on downloaded bytes", async () => {
    const oversized = Buffer.alloc(MAX_EVIDENCE_ARTIFACT_SIZE_BYTES + 1, 120);
    const oversizedHash = sha256(oversized);
    const fake = fakeSupabase({ bytes: oversized });
    await expect(
      supabaseReader(fake).readArtifact({
        locator: canonicalLocator(oversizedHash),
        expectedHtmlHash: oversizedHash,
      }),
    ).rejects.toMatchObject({ code: "ARTIFACT_INTEGRITY_FAILED" });
  });

  it("bounds missing objects and rejected Supabase/network reads without leaking details", async () => {
    const missing = fakeSupabase({
      error: { statusCode: "404", message: "secret object key not found" },
    });
    await expect(
      supabaseReader(missing).readArtifact({
        locator: canonicalLocator(),
        expectedHtmlHash: sha256(RAW_HTML),
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "ARTIFACT_NOT_AVAILABLE",
        message:
          "Evidence artifact retrieval failed (ARTIFACT_NOT_AVAILABLE)",
      }),
    );

    const rejected = fakeSupabase({
      reject: new Error("https://secret.supabase.co/private/object-key"),
    });
    await expect(
      supabaseReader(rejected).readArtifact({
        locator: canonicalLocator(),
        expectedHtmlHash: sha256(RAW_HTML),
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "ARTIFACT_READ_FAILED",
        message: "Evidence artifact retrieval failed (ARTIFACT_READ_FAILED)",
      }),
    );
  });

  it("reads only a confined regular legacy filesystem artifact", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "savvy-read-root-"));
    temporaryRoots.push(root);
    fs.mkdirSync(path.join(root, "legacy"));
    fs.writeFileSync(path.join(root, "legacy", "snapshot.html"), RAW_HTML);
    const reader = new EvidenceArtifactRetrievalService({
      env: { SAVVY_SNAPSHOT_ROOT: root },
    });

    const result = await reader.readArtifact({
      locator: "legacy/snapshot.html",
      expectedHtmlHash: sha256(RAW_HTML),
    });
    expect(result.locatorType).toBe("FILESYSTEM");
    expect(result.bytes.equals(Buffer.from(RAW_HTML))).toBe(true);
  });

  it.each([
    "/etc/passwd",
    "../outside.html",
    "legacy/../outside.html",
    "legacy\\snapshot.html",
    "file:///tmp/snapshot.html",
    "https://example.com/snapshot.html",
    ".env",
    "legacy/notes.txt",
  ])("rejects unsafe legacy locator %s", async (locator) => {
    const reader = new EvidenceArtifactRetrievalService({
      env: { SAVVY_SNAPSHOT_ROOT: os.tmpdir() },
    });
    await expect(
      reader.readArtifact({ locator, expectedHtmlHash: sha256(RAW_HTML) }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_ARTIFACT_LOCATOR" });
  });

  it("rejects a filesystem symlink escape after realpath confinement", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "savvy-read-root-"));
    const outside = fs.mkdtempSync(
      path.join(os.tmpdir(), "savvy-read-outside-"),
    );
    temporaryRoots.push(root, outside);
    fs.writeFileSync(path.join(outside, "secret.html"), RAW_HTML);
    fs.symlinkSync(outside, path.join(root, "linked"));
    const reader = new EvidenceArtifactRetrievalService({
      env: { SAVVY_SNAPSHOT_ROOT: root },
    });

    await expect(
      reader.readArtifact({
        locator: "linked/secret.html",
        expectedHtmlHash: sha256(RAW_HTML),
      }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_ARTIFACT_LOCATOR" });
  });

  it("maps missing legacy files and filesystem failures to bounded outcomes", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "savvy-read-root-"));
    temporaryRoots.push(root);
    const reader = new EvidenceArtifactRetrievalService({
      env: { SAVVY_SNAPSHOT_ROOT: root },
    });
    await expect(
      reader.readArtifact({
        locator: "missing.html",
        expectedHtmlHash: sha256(RAW_HTML),
      }),
    ).rejects.toMatchObject({ code: "ARTIFACT_NOT_AVAILABLE" });

    fs.writeFileSync(path.join(root, "snapshot.html"), RAW_HTML);
    vi.spyOn(fs.promises, "readFile").mockRejectedValueOnce(
      new Error(`/private/path/${canonicalLocator()}`),
    );
    await expect(
      reader.readArtifact({
        locator: "snapshot.html",
        expectedHtmlHash: sha256(RAW_HTML),
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "ARTIFACT_READ_FAILED",
        message: "Evidence artifact retrieval failed (ARTIFACT_READ_FAILED)",
      }),
    );
  });
});

describe("D4B2B governed Admin evidence lookup", () => {
  it("queries by EvidenceRecord ID with governed claim existence and passes only the DB locator/hash to storage", async () => {
    const fakeDb = fakeDatabase(evidenceRow());
    const readArtifact = vi.fn().mockResolvedValue({
      bytes: Buffer.from(RAW_HTML),
      htmlHash: sha256(RAW_HTML),
      byteSize: Buffer.byteLength(RAW_HTML),
      locatorType: "SUPABASE",
    });

    const result = await retrieveGovernedAdminEvidence(EVIDENCE_ID, {
      database: fakeDb.database,
      artifactReader: { readArtifact } as EvidenceArtifactReader,
    });

    expect(fakeDb.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: EVIDENCE_ID,
          OR: expect.arrayContaining([
            { casino_claims: { some: {} } },
            { bonus_claims: { some: {} } },
            { slot_claims: { some: {} } },
            { license_claims: { some: {} } },
          ]),
        }),
      }),
    );
    expect(readArtifact).toHaveBeenCalledWith({
      locator: canonicalLocator(),
      expectedHtmlHash: sha256(RAW_HTML),
    });
    expect(result.content).toBe(RAW_HTML);
    expect(result).not.toHaveProperty("snapshot_path");
    expect(result).not.toHaveProperty("locator");
  });

  it("rejects malformed, unknown, and ungoverned EvidenceRecord IDs", async () => {
    const malformedDb = fakeDatabase(evidenceRow());
    await expect(
      retrieveGovernedAdminEvidence("../../etc/passwd", {
        database: malformedDb.database,
      }),
    ).rejects.toBeInstanceOf(AdminEvidenceRetrievalError);
    expect(malformedDb.findFirst).not.toHaveBeenCalled();

    const missingDb = fakeDatabase(null);
    await expect(
      retrieveGovernedAdminEvidence(EVIDENCE_ID, {
        database: missingDb.database,
      }),
    ).rejects.toMatchObject({ code: "EVIDENCE_NOT_FOUND" });
  });

  it("maps a null database locator to ARTIFACT_NOT_AVAILABLE without storage access", async () => {
    const fakeDb = fakeDatabase(evidenceRow({ snapshot_path: null }));
    const readArtifact = vi.fn();
    await expect(
      retrieveGovernedAdminEvidence(EVIDENCE_ID, {
        database: fakeDb.database,
        artifactReader: { readArtifact } as EvidenceArtifactReader,
      }),
    ).rejects.toMatchObject({ code: "ARTIFACT_NOT_AVAILABLE" });
    expect(readArtifact).not.toHaveBeenCalled();
  });

  it("fails closed when the governed database hash is null", async () => {
    const fakeDb = fakeDatabase(evidenceRow({ html_hash: null }));
    const readArtifact = vi.fn();
    await expect(
      retrieveGovernedAdminEvidence(EVIDENCE_ID, {
        database: fakeDb.database,
        artifactReader: { readArtifact } as EvidenceArtifactReader,
      }),
    ).rejects.toMatchObject({ code: "ARTIFACT_INTEGRITY_FAILED" });
    expect(readArtifact).not.toHaveBeenCalled();
  });
});

describe("D4B2B Admin evidence route and viewer security", () => {
  function routeDependencies(
    overrides: Partial<AdminEvidenceRouteDependencies> = {},
  ): AdminEvidenceRouteDependencies {
    return {
      verifySession: vi.fn().mockResolvedValue({
        authenticated: true,
        user: { role: "REVIEWER" },
      }),
      canViewDetails: vi.fn().mockReturnValue(true),
      retrieveEvidence: vi.fn().mockResolvedValue(retrievedEvidence()),
      ...overrides,
    };
  }

  function callRoute(dependencies: AdminEvidenceRouteDependencies) {
    return createAdminEvidenceGetHandler(dependencies)(
      new Request(`http://localhost/api/admin/evidence/${EVIDENCE_ID}`),
      { params: Promise.resolve({ id: EVIDENCE_ID }) },
    );
  }

  it("allows an authenticated VIEW_DETAILS Admin and sets all response protections", async () => {
    const dependencies = routeDependencies();
    const response = await callRoute(dependencies);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.evidence.content).toBe(RAW_HTML);
    expect(body.evidence).not.toHaveProperty("snapshot_path");
    expect(body.evidence).not.toHaveProperty("locator");
    expect(response.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("vary")).toBe("Cookie");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cross-origin-resource-policy")).toBe(
      "same-origin",
    );
    expect(response.headers.get("content-security-policy")).toBe(
      "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; sandbox",
    );
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="evidence-${EVIDENCE_ID}.json"`,
    );
    expect(response.headers.has("access-control-allow-origin")).toBe(false);
  });

  it("returns 401 before authorization, DB, or storage retrieval", async () => {
    const canViewDetails = vi.fn();
    const retrieveEvidence = vi.fn();
    const response = await callRoute(
      routeDependencies({
        verifySession: vi.fn().mockResolvedValue({ authenticated: false }),
        canViewDetails,
        retrieveEvidence,
      }),
    );

    expect(response.status).toBe(401);
    expect(canViewDetails).not.toHaveBeenCalled();
    expect(retrieveEvidence).not.toHaveBeenCalled();
  });

  it("returns 403 before DB or storage retrieval when VIEW_DETAILS is denied", async () => {
    const retrieveEvidence = vi.fn();
    const response = await callRoute(
      routeDependencies({
        canViewDetails: vi.fn().mockReturnValue(false),
        retrieveEvidence,
      }),
    );

    expect(response.status).toBe(403);
    expect(retrieveEvidence).not.toHaveBeenCalled();
  });

  it.each([
    [new AdminEvidenceRetrievalError(), 404, "EVIDENCE_NOT_FOUND"],
    [
      new EvidenceArtifactRetrievalError("ARTIFACT_NOT_AVAILABLE"),
      404,
      "ARTIFACT_NOT_AVAILABLE",
    ],
    [
      new EvidenceArtifactRetrievalError("UNSUPPORTED_ARTIFACT_LOCATOR"),
      422,
      "UNSUPPORTED_ARTIFACT_LOCATOR",
    ],
    [
      new EvidenceArtifactRetrievalError("ARTIFACT_INTEGRITY_FAILED"),
      409,
      "ARTIFACT_INTEGRITY_FAILED",
    ],
    [
      new EvidenceArtifactRetrievalError("ARTIFACT_READ_FAILED"),
      502,
      "ARTIFACT_READ_FAILED",
    ],
  ])("maps bounded error %# without leaking storage details", async (error, status, code) => {
    const response = await callRoute(
      routeDependencies({
        retrieveEvidence: vi.fn().mockRejectedValue(error),
      }),
    );
    const responseText = await response.text();

    expect(response.status).toBe(status);
    expect(JSON.parse(responseText).errorCode).toBe(code);
    expect(responseText).not.toContain("supabase://");
    expect(responseText).not.toContain("v1/observations");
    expect(responseText).not.toContain("SAVVY_SNAPSHOT_ROOT");
    expect(responseText).not.toContain("SUPABASE_SECRET_KEY");
  });

  it("renders hostile artifact HTML as escaped text", () => {
    const markup = renderToStaticMarkup(
      createElement(EvidenceArtifactText, { content: RAW_HTML }),
    );
    expect(markup).toContain("&lt;script&gt;");
    expect(markup).toContain("onerror=&quot;alert(1)&quot;");
    expect(markup).not.toContain("<script>");
    expect(markup).not.toContain("<img src=x");
  });

  it("keeps the viewer ID-only and free of executable HTML APIs", () => {
    const viewerPath = path.resolve(
      import.meta.dirname,
      "../../../apps/admin/src/components/evidence/EvidenceArtifactViewer.tsx",
    );
    const source = fs.readFileSync(viewerPath, "utf8");
    const forbidden = [
      "dangerouslySet" + "InnerHTML",
      "src" + "Doc",
      "document" + ".write",
      "createObject" + "URL",
      "text" + "/html",
    ];
    for (const token of forbidden) {
      expect(source).not.toContain(token);
    }
    expect(source).toContain("evidenceId: string");
    expect(source).toContain("<EvidenceArtifactText content={evidence.content} />");
    expect(source).toContain("setEvidence(null)");
  });
});
