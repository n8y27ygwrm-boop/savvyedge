"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface ReviewActionControlsProps {
  subjectType: "CASINO" | "BONUS";
  subjectId: string;
  reviewStatus: string;
  publicationStatus: string;
  quarantineReason: string | null;
  expectedVersion: number;
  claimIds: string[];
}

export function ReviewActionControls({
  subjectType,
  subjectId,
  reviewStatus,
  publicationStatus,
  quarantineReason,
  expectedVersion,
  claimIds,
}: ReviewActionControlsProps) {
  const [rejectReason, setRejectReason] = useState("");
  const [publishReason, setPublishReason] = useState("");
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [showPublishForm, setShowPublishForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function executeTransition(action: string, extraPayload: Record<string, unknown> = {}) {
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/admin/transitions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectType,
          subjectId,
          action,
          expectedVersion,
          claimIds,
          ...extraPayload,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || `Transition '${action}' failed`);
        setLoading(false);
        return;
      }

      setLoading(false);
      setShowRejectForm(false);
      setShowPublishForm(false);
      router.refresh();
    } catch {
      setError("Network error occurred during workflow transition");
      setLoading(false);
    }
  }

  const isAwaitingReview = reviewStatus === "AWAITING_REVIEW";
  const isInReview = reviewStatus === "IN_REVIEW";
  const isApproved = reviewStatus === "APPROVED";
  const isUnpublished = publicationStatus === "UNPUBLISHED";
  const isQuarantined = Boolean(quarantineReason);
  const canPublish = isApproved && isUnpublished && !isQuarantined;

  return (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", padding: 20, borderRadius: 8, marginTop: 24 }}>
      <h3 style={{ margin: "0 0 16px 0", fontSize: 18 }}>Governance Actions</h3>

      {error && (
        <div style={{ padding: 12, marginBottom: 16, background: "#fee2e2", color: "#991b1b", borderRadius: 4, fontSize: 14 }}>
          <strong>Action Failed:</strong> {error}
        </div>
      )}

      {isQuarantined && (
        <div style={{ padding: 12, marginBottom: 16, background: "#fef3c7", color: "#92400e", borderRadius: 4, fontSize: 13, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <strong>Quarantine Override Active:</strong> Reason: <em>{quarantineReason}</em>. Entity cannot be published until quarantine is cleared.
          </div>
          <a href={`/quarantine/${subjectType.toLowerCase()}/${subjectId}`} style={{ color: "#c2410c", fontWeight: "bold", textDecoration: "underline", fontSize: 12 }}>
            Inspect &amp; Clear Quarantine &rarr;
          </a>
        </div>
      )}

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        {/* 1. Begin Review */}
        {isAwaitingReview && (
          <button
            onClick={() => executeTransition("BEGIN_REVIEW")}
            disabled={loading}
            style={{ padding: "10px 18px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 4, fontWeight: "bold", cursor: loading ? "wait" : "pointer" }}
          >
            {loading ? "Processing..." : "Begin Review"}
          </button>
        )}

        {/* 2. Approve */}
        {isInReview && (
          <button
            onClick={() => executeTransition("APPROVE")}
            disabled={loading}
            style={{ padding: "10px 18px", background: "#16a34a", color: "#fff", border: "none", borderRadius: 4, fontWeight: "bold", cursor: loading ? "wait" : "pointer" }}
          >
            {loading ? "Processing..." : "Approve Review"}
          </button>
        )}

        {/* 3. Reject */}
        {(isInReview || isApproved) && !showRejectForm && (
          <button
            onClick={() => setShowRejectForm(true)}
            disabled={loading}
            style={{ padding: "10px 18px", background: "#dc2626", color: "#fff", border: "none", borderRadius: 4, fontWeight: "bold", cursor: loading ? "wait" : "pointer" }}
          >
            Reject...
          </button>
        )}

        {/* 4. Publish */}
        {canPublish && !showPublishForm && (
          <button
            onClick={() => setShowPublishForm(true)}
            disabled={loading}
            style={{ padding: "10px 18px", background: "#0d9488", color: "#fff", border: "none", borderRadius: 4, fontWeight: "bold", cursor: loading ? "wait" : "pointer" }}
          >
            Publish to Public API...
          </button>
        )}

        {/* Status badges */}
        {!isAwaitingReview && !isInReview && !canPublish && !showRejectForm && !showPublishForm && (
          <span style={{ fontSize: 14, color: "#64748b" }}>
            Current state: <strong>{reviewStatus}</strong> / <strong>{publicationStatus}</strong>. No additional actions available.
          </span>
        )}
      </div>

      {/* Reject Form */}
      {showRejectForm && (
        <div style={{ marginTop: 16, padding: 16, background: "#f8fafc", border: "1px solid #cbd5e1", borderRadius: 6 }}>
          <h4 style={{ margin: "0 0 8px 0", color: "#991b1b" }}>Reject Review</h4>
          <p style={{ margin: "0 0 12px 0", fontSize: 13, color: "#64748b" }}>
            Rejection requires a non-empty explanation detailing why the entity or claims were rejected.
          </p>
          <textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Enter explicit rejection reason..."
            rows={3}
            style={{ width: "100%", padding: 8, fontSize: 14, borderRadius: 4, border: "1px solid #ccc", marginBottom: 12 }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => executeTransition("REJECT", { internalReason: rejectReason })}
              disabled={loading || !rejectReason.trim()}
              style={{ padding: "8px 16px", background: "#dc2626", color: "#fff", border: "none", borderRadius: 4, fontWeight: "bold", cursor: loading || !rejectReason.trim() ? "not-allowed" : "pointer" }}
            >
              Confirm Rejection
            </button>
            <button
              onClick={() => setShowRejectForm(false)}
              disabled={loading}
              style={{ padding: "8px 16px", background: "#94a3b8", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Publish Form */}
      {showPublishForm && (
        <div style={{ marginTop: 16, padding: 16, background: "#f8fafc", border: "1px solid #cbd5e1", borderRadius: 6 }}>
          <h4 style={{ margin: "0 0 8px 0", color: "#0f766e" }}>Publish Entity</h4>
          <p style={{ margin: "0 0 12px 0", fontSize: 13, color: "#64748b" }}>
            Publishing makes the approved entity eligible for public API listings and search queries.
          </p>
          <input
            type="text"
            value={publishReason}
            onChange={(e) => setPublishReason(e.target.value)}
            placeholder="Optional publication note..."
            style={{ width: "100%", padding: 8, fontSize: 14, borderRadius: 4, border: "1px solid #ccc", marginBottom: 12 }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => executeTransition("PUBLISH", { reason: publishReason })}
              disabled={loading}
              style={{ padding: "8px 16px", background: "#0d9488", color: "#fff", border: "none", borderRadius: 4, fontWeight: "bold", cursor: loading ? "wait" : "pointer" }}
            >
              Confirm Publication
            </button>
            <button
              onClick={() => setShowPublishForm(false)}
              disabled={loading}
              style={{ padding: "8px 16px", background: "#94a3b8", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
