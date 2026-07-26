"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { InlineAlert } from "@/components/ui/InlineAlert";
import { LoadingButton } from "@/components/ui/LoadingButton";
import { StatusBadge } from "@/components/ui/StatusBadge";

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
    <GlassPanel raised padding="20px">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--admin-text)" }}>
          Governance Actions
        </h3>
        <div style={{ display: "flex", gap: 8 }}>
          <StatusBadge status={reviewStatus} size="sm" />
          <StatusBadge status={publicationStatus} size="sm" />
        </div>
      </div>

      {error && (
        <InlineAlert
          type="error"
          title="Action Failed"
          message={error}
          onDismiss={() => setError(null)}
          style={{ marginBottom: 16 }}
        />
      )}

      {isQuarantined && (
        <div
          style={{
            padding: 12,
            marginBottom: 16,
            background: "rgba(245, 158, 11, 0.1)",
            border: "1px solid rgba(245, 158, 11, 0.3)",
            borderRadius: 6,
            fontSize: 13,
            color: "#fbbf24",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div>
            <strong>Quarantine Active:</strong> {quarantineReason}. Publication is blocked until quarantine is cleared.
          </div>
          <Link
            href={`/quarantine/${subjectType.toLowerCase()}/${subjectId}`}
            style={{
              color: "#fbbf24",
              fontWeight: 700,
              textDecoration: "underline",
              fontSize: 12,
              whiteSpace: "nowrap",
            }}
          >
            Clear Quarantine →
          </Link>
        </div>
      )}

      {/* Action Buttons */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        {/* 1. Begin Review */}
        {isAwaitingReview && (
          <LoadingButton
            onClick={() => executeTransition("BEGIN_REVIEW")}
            loading={loading}
            variant="primary"
          >
            Begin Review
          </LoadingButton>
        )}

        {/* 2. Approve */}
        {isInReview && (
          <LoadingButton
            onClick={() => executeTransition("APPROVE")}
            loading={loading}
            variant="success"
          >
            Approve Review
          </LoadingButton>
        )}

        {/* 3. Reject */}
        {(isInReview || isApproved) && !showRejectForm && (
          <LoadingButton
            onClick={() => setShowRejectForm(true)}
            disabled={loading}
            variant="danger"
          >
            Reject...
          </LoadingButton>
        )}

        {/* 4. Publish */}
        {canPublish && !showPublishForm && (
          <LoadingButton
            onClick={() => setShowPublishForm(true)}
            disabled={loading}
            variant="primary"
          >
            Publish Entity
          </LoadingButton>
        )}

        {!isAwaitingReview && !isInReview && !canPublish && !showRejectForm && !showPublishForm && (
          <span style={{ fontSize: 13, color: "var(--admin-muted)" }}>
            Current state is stable. No pending transition actions available.
          </span>
        )}
      </div>

      {/* Reject Form */}
      {showRejectForm && (
        <div
          style={{
            marginTop: 16,
            padding: 16,
            background: "rgba(0, 0, 0, 0.4)",
            border: "1px solid var(--admin-danger-border)",
            borderRadius: 6,
          }}
        >
          <h4 style={{ margin: "0 0 6px 0", fontSize: 14, color: "#f87171" }}>
            Reject Review
          </h4>
          <p style={{ margin: "0 0 12px 0", fontSize: 12, color: "var(--admin-muted)" }}>
            Rejection requires a non-empty explanation detailing why the entity or claims were rejected.
          </p>
          <textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Enter explicit rejection reason..."
            rows={3}
            style={{
              width: "100%",
              padding: 10,
              fontSize: 13,
              borderRadius: 6,
              border: "1px solid var(--admin-border-bright)",
              background: "rgba(0, 0, 0, 0.6)",
              color: "var(--admin-text)",
              marginBottom: 12,
              outline: "none",
            }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <LoadingButton
              onClick={() => executeTransition("REJECT", { internalReason: rejectReason })}
              loading={loading}
              disabled={!rejectReason.trim()}
              variant="danger"
              size="sm"
            >
              Confirm Rejection
            </LoadingButton>
            <LoadingButton
              onClick={() => setShowRejectForm(false)}
              disabled={loading}
              variant="outline"
              size="sm"
            >
              Cancel
            </LoadingButton>
          </div>
        </div>
      )}

      {/* Publish Form */}
      {showPublishForm && (
        <div
          style={{
            marginTop: 16,
            padding: 16,
            background: "rgba(0, 0, 0, 0.4)",
            border: "1px solid var(--admin-emerald-border)",
            borderRadius: 6,
          }}
        >
          <h4 style={{ margin: "0 0 6px 0", fontSize: 14, color: "#34d399" }}>
            Publish Entity
          </h4>
          <p style={{ margin: "0 0 12px 0", fontSize: 12, color: "var(--admin-muted)" }}>
            Publishing makes the approved entity eligible for public API listings and search queries.
          </p>
          <input
            type="text"
            value={publishReason}
            onChange={(e) => setPublishReason(e.target.value)}
            placeholder="Optional publication note..."
            style={{
              width: "100%",
              padding: 10,
              fontSize: 13,
              borderRadius: 6,
              border: "1px solid var(--admin-border-bright)",
              background: "rgba(0, 0, 0, 0.6)",
              color: "var(--admin-text)",
              marginBottom: 12,
              outline: "none",
            }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <LoadingButton
              onClick={() => executeTransition("PUBLISH", { reason: publishReason })}
              loading={loading}
              variant="success"
              size="sm"
            >
              Confirm Publication
            </LoadingButton>
            <LoadingButton
              onClick={() => setShowPublishForm(false)}
              disabled={loading}
              variant="outline"
              size="sm"
            >
              Cancel
            </LoadingButton>
          </div>
        </div>
      )}
    </GlassPanel>
  );
}
