"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { InlineAlert } from "@/components/ui/InlineAlert";
import { LoadingButton } from "@/components/ui/LoadingButton";

export interface ClearQuarantineControlsProps {
  subjectType: "CASINO" | "BONUS" | "SLOT" | "LICENSE";
  subjectId: string;
  quarantineReason: string | null;
  expectedVersion: number;
  claimIds: string[];
}

export function ClearQuarantineControls({
  subjectType,
  subjectId,
  quarantineReason,
  expectedVersion,
  claimIds,
}: ClearQuarantineControlsProps) {
  const [clearReason, setClearReason] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleClearQuarantine() {
    if (!clearReason.trim()) {
      setError("Quarantine clearance requires an explicit administrator explanation.");
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/admin/transitions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectType,
          subjectId,
          action: "CLEAR_QUARANTINE",
          expectedVersion,
          internalReason: clearReason.trim(),
          claimIds,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || "Quarantine clearance transition failed.");
        setLoading(false);
        return;
      }

      setLoading(false);
      setShowConfirm(false);
      router.refresh();
    } catch {
      setError("Network error occurred during quarantine clearance.");
      setLoading(false);
    }
  }

  if (!quarantineReason) {
    return (
      <GlassPanel padding="16px" style={{ background: "rgba(16, 185, 129, 0.08)", border: "1px solid rgba(16, 185, 129, 0.2)" }}>
        <div style={{ color: "#34d399", fontSize: 13, fontWeight: 600 }}>
          ✓ Quarantine Inactive: This entity is operating under standard review lifecycle.
        </div>
      </GlassPanel>
    );
  }

  return (
    <GlassPanel raised padding="20px">
      <h3 style={{ margin: "0 0 12px 0", fontSize: 16, fontWeight: 700, color: "#f87171" }}>
        Quarantine Governance Action
      </h3>

      {error && (
        <InlineAlert
          type="error"
          title="Action Failed"
          message={error}
          onDismiss={() => setError(null)}
          style={{ marginBottom: 16 }}
        />
      )}

      <div
        style={{
          padding: 12,
          marginBottom: 16,
          background: "rgba(245, 158, 11, 0.1)",
          border: "1px solid rgba(245, 158, 11, 0.3)",
          borderRadius: 6,
          fontSize: 13,
          color: "#fbbf24",
        }}
      >
        <strong>Active Quarantine Override:</strong> Reason: <em>{quarantineReason}</em>.
      </div>

      {!showConfirm ? (
        <LoadingButton
          onClick={() => setShowConfirm(true)}
          disabled={loading}
          variant="danger"
        >
          Clear Quarantine...
        </LoadingButton>
      ) : (
        <div
          style={{
            padding: 16,
            background: "rgba(0, 0, 0, 0.4)",
            border: "1px solid var(--admin-warning-border)",
            borderRadius: 6,
          }}
        >
          <h4 style={{ margin: "0 0 8px 0", fontSize: 14, color: "#fbbf24" }}>
            Confirm Quarantine Clearance
          </h4>

          <div
            style={{
              padding: 12,
              marginBottom: 14,
              background: "rgba(59, 130, 246, 0.1)",
              border: "1px solid rgba(59, 130, 246, 0.25)",
              borderRadius: 6,
              fontSize: 12,
              color: "#93c5fd",
            }}
          >
            <strong>Governance Disclaimer:</strong>
            <ul style={{ margin: "4px 0 0 0", paddingLeft: 18, lineHeight: 1.5 }}>
              <li>Clearing quarantine restores the entity to <strong>AWAITING_REVIEW</strong>.</li>
              <li>Clearing quarantine <strong>does NOT approve</strong> the entity.</li>
              <li>Clearing quarantine <strong>does NOT publish</strong> the entity.</li>
              <li>Separate review approval and publication transitions remain strictly required.</li>
            </ul>
          </div>

          <p style={{ margin: "0 0 8px 0", fontSize: 12, color: "var(--admin-muted)" }}>
            Please provide a mandatory, detailed administrator explanation for clearing quarantine:
          </p>
          <textarea
            value={clearReason}
            onChange={(e) => setClearReason(e.target.value)}
            placeholder="Explain why quarantine is being cleared and what verification was conducted..."
            rows={3}
            maxLength={1000}
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
              onClick={handleClearQuarantine}
              loading={loading}
              disabled={!clearReason.trim()}
              variant="danger"
              size="sm"
            >
              Confirm &amp; Clear Quarantine
            </LoadingButton>
            <LoadingButton
              onClick={() => setShowConfirm(false)}
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
