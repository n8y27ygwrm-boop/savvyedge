"use client";

import { useEffect, useRef, useState } from "react";

interface EvidenceArtifactResponse {
  id: string;
  evidenceType: string;
  sourceUrl: string;
  observedAt: string;
  extractedAt: string;
  htmlHash: string;
  locatorType: "SUPABASE" | "FILESYSTEM";
  byteSize: number;
  availability: "AVAILABLE";
  content: string;
}

interface EvidenceArtifactViewerProps {
  evidenceId: string;
}

export function EvidenceArtifactText({ content }: { content: string }) {
  return (
    <pre
      style={{
        margin: 0,
        maxHeight: "55vh",
        overflow: "auto",
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
        padding: 16,
        borderRadius: 6,
        border: "1px solid var(--admin-border)",
        background: "#07080c",
        color: "#d1d5db",
        fontSize: 11,
        lineHeight: 1.55,
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      }}
    >
      {content}
    </pre>
  );
}

function isSafeSourceUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "Unavailable";
}

export function EvidenceArtifactViewer({
  evidenceId,
}: EvidenceArtifactViewerProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [evidence, setEvidence] = useState<EvidenceArtifactResponse | null>(
    null,
  );
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const requestController = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      requestController.current?.abort();
    },
    [],
  );

  async function openViewer() {
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    setOpen(true);
    setLoading(true);
    setEvidence(null);
    setErrorCode(null);

    try {
      const response = await fetch(
        `/api/admin/evidence/${encodeURIComponent(evidenceId)}`,
        {
          method: "GET",
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        },
      );
      const payload = (await response.json()) as {
        success?: boolean;
        evidence?: EvidenceArtifactResponse;
        errorCode?: string;
      };
      if (!response.ok || !payload.success || !payload.evidence) {
        setErrorCode(payload.errorCode || "ARTIFACT_READ_FAILED");
        return;
      }
      setEvidence(payload.evidence);
    } catch (error: unknown) {
      if (!(error instanceof Error && error.name === "AbortError")) {
        setErrorCode("ARTIFACT_READ_FAILED");
      }
    } finally {
      if (requestController.current === controller) {
        setLoading(false);
      }
    }
  }

  function closeViewer() {
    requestController.current?.abort();
    requestController.current = null;
    setOpen(false);
    setLoading(false);
    setEvidence(null);
    setErrorCode(null);
  }

  return (
    <>
      <button
        type="button"
        onClick={openViewer}
        style={{
          marginTop: 10,
          padding: "6px 10px",
          borderRadius: 6,
          border: "1px solid rgba(96, 165, 250, 0.35)",
          background: "rgba(59, 130, 246, 0.12)",
          color: "#60a5fa",
          fontSize: 12,
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        View governed artifact
      </button>

      {open && (
        <div
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) closeViewer();
          }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            display: "flex",
            justifyContent: "flex-end",
            background: "rgba(0, 0, 0, 0.72)",
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Governed evidence artifact"
            style={{
              width: "min(760px, 94vw)",
              height: "100%",
              overflowY: "auto",
              padding: 24,
              background: "#10121a",
              borderLeft: "1px solid var(--admin-border)",
              boxShadow: "-16px 0 40px rgba(0, 0, 0, 0.45)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 16,
                marginBottom: 20,
              }}
            >
              <div>
                <h2
                  style={{
                    margin: 0,
                    color: "var(--admin-text)",
                    fontSize: 18,
                  }}
                >
                  Governed Evidence Artifact
                </h2>
                <div
                  style={{
                    marginTop: 4,
                    color: "var(--admin-muted)",
                    fontSize: 11,
                    fontFamily: "monospace",
                  }}
                >
                  Evidence ID: {evidenceId}
                </div>
              </div>
              <button
                type="button"
                onClick={closeViewer}
                aria-label="Close evidence viewer"
                style={{
                  border: "1px solid var(--admin-border)",
                  borderRadius: 6,
                  background: "rgba(255, 255, 255, 0.05)",
                  color: "var(--admin-text)",
                  padding: "6px 10px",
                  cursor: "pointer",
                }}
              >
                Close
              </button>
            </div>

            {loading && (
              <div style={{ color: "var(--admin-muted)", fontSize: 13 }}>
                Loading and verifying artifact integrity…
              </div>
            )}

            {!loading && errorCode && (
              <div
                role="alert"
                style={{
                  padding: 14,
                  borderRadius: 6,
                  border: "1px solid rgba(239, 68, 68, 0.35)",
                  background: "rgba(239, 68, 68, 0.08)",
                  color: "#f87171",
                  fontSize: 13,
                }}
              >
                Artifact unavailable: {errorCode}
              </div>
            )}

            {!loading && evidence && (
              <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                <dl
                  style={{
                    display: "grid",
                    gridTemplateColumns: "150px minmax(0, 1fr)",
                    gap: "10px 16px",
                    margin: 0,
                    padding: 16,
                    borderRadius: 6,
                    border: "1px solid var(--admin-border)",
                    background: "rgba(0, 0, 0, 0.25)",
                    fontSize: 12,
                  }}
                >
                  <dt style={{ color: "var(--admin-muted)" }}>Availability</dt>
                  <dd style={{ margin: 0, color: "#34d399", fontWeight: 700 }}>
                    {evidence.availability} · INTEGRITY VERIFIED
                  </dd>
                  <dt style={{ color: "var(--admin-muted)" }}>Evidence type</dt>
                  <dd style={{ margin: 0 }}>{evidence.evidenceType}</dd>
                  <dt style={{ color: "var(--admin-muted)" }}>Locator type</dt>
                  <dd style={{ margin: 0 }}>{evidence.locatorType}</dd>
                  <dt style={{ color: "var(--admin-muted)" }}>Source URL</dt>
                  <dd style={{ margin: 0, overflowWrap: "anywhere" }}>
                    {isSafeSourceUrl(evidence.sourceUrl) ? (
                      <a
                        href={evidence.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: "#60a5fa" }}
                      >
                        {evidence.sourceUrl}
                      </a>
                    ) : (
                      evidence.sourceUrl
                    )}
                  </dd>
                  <dt style={{ color: "var(--admin-muted)" }}>Observed</dt>
                  <dd style={{ margin: 0, fontFamily: "monospace" }}>
                    {formatTimestamp(evidence.observedAt)}
                  </dd>
                  <dt style={{ color: "var(--admin-muted)" }}>Extracted</dt>
                  <dd style={{ margin: 0, fontFamily: "monospace" }}>
                    {formatTimestamp(evidence.extractedAt)}
                  </dd>
                  <dt style={{ color: "var(--admin-muted)" }}>SHA-256</dt>
                  <dd
                    style={{
                      margin: 0,
                      fontFamily: "monospace",
                      overflowWrap: "anywhere",
                    }}
                  >
                    {evidence.htmlHash}
                  </dd>
                  <dt style={{ color: "var(--admin-muted)" }}>Byte size</dt>
                  <dd style={{ margin: 0 }}>
                    {evidence.byteSize.toLocaleString()} bytes
                  </dd>
                </dl>

                <div>
                  <h3
                    style={{
                      margin: "0 0 8px",
                      color: "var(--admin-text)",
                      fontSize: 14,
                    }}
                  >
                    Raw HTML (text-only)
                  </h3>
                  <EvidenceArtifactText content={evidence.content} />
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}
