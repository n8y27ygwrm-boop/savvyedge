"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
      <div style={{ padding: 16, background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, color: "#166534", marginTop: 24 }}>
        <strong>Quarantine Inactive:</strong> This entity is not currently quarantined.
      </div>
    );
  }

  return (
    <div style={{ background: "#fff", border: "1px solid #fed7aa", padding: 20, borderRadius: 8, marginTop: 24 }}>
      <h3 style={{ margin: "0 0 12px 0", fontSize: 18, color: "#c2410c" }}>Quarantine Governance Action</h3>

      {error && (
        <div style={{ padding: 12, marginBottom: 16, background: "#fee2e2", color: "#991b1b", borderRadius: 4, fontSize: 14 }}>
          <strong>Action Failed:</strong> {error}
        </div>
      )}

      <div style={{ padding: 12, marginBottom: 16, background: "#fff7ed", border: "1px solid #ffedd5", borderRadius: 6, fontSize: 13, color: "#9a3412" }}>
        <strong>Active Quarantine Override:</strong> Reason: <em>{quarantineReason}</em>.
      </div>

      {!showConfirm ? (
        <button
          onClick={() => setShowConfirm(true)}
          disabled={loading}
          style={{ padding: "10px 18px", background: "#ea580c", color: "#fff", border: "none", borderRadius: 4, fontWeight: "bold", cursor: loading ? "wait" : "pointer" }}
        >
          Clear Quarantine...
        </button>
      ) : (
        <div style={{ padding: 16, background: "#f8fafc", border: "1px solid #cbd5e1", borderRadius: 6 }}>
          <h4 style={{ margin: "0 0 8px 0", color: "#c2410c" }}>Confirm Quarantine Clearance</h4>
          
          <div style={{ padding: 12, marginBottom: 14, background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 6, fontSize: 13, color: "#1e40af" }}>
            <strong>Governance Disclaimer:</strong>
            <ul style={{ margin: "6px 0 0 0", paddingLeft: 20 }}>
              <li>Clearing quarantine restores the entity to <strong>AWAITING_REVIEW</strong>.</li>
              <li>Clearing quarantine <strong>does NOT approve</strong> the entity.</li>
              <li>Clearing quarantine <strong>does NOT publish</strong> the entity.</li>
              <li>Separate review approval and publication transitions remain strictly required.</li>
            </ul>
          </div>

          <p style={{ margin: "0 0 8px 0", fontSize: 13, color: "#475569" }}>
            Please provide a mandatory, detailed administrator explanation for clearing quarantine:
          </p>
          <textarea
            value={clearReason}
            onChange={(e) => setClearReason(e.target.value)}
            placeholder="Explain why quarantine is being cleared and what verification was conducted..."
            rows={3}
            maxLength={1000}
            style={{ width: "100%", padding: 8, fontSize: 14, borderRadius: 4, border: "1px solid #ccc", marginBottom: 12 }}
          />

          <div style={{ display: "flex", gap: 12 }}>
            <button
              onClick={handleClearQuarantine}
              disabled={loading || !clearReason.trim()}
              style={{
                padding: "8px 16px",
                background: loading || !clearReason.trim() ? "#fdba74" : "#ea580c",
                color: "#fff",
                border: "none",
                borderRadius: 4,
                fontWeight: "bold",
                cursor: loading || !clearReason.trim() ? "not-allowed" : "pointer",
              }}
            >
              {loading ? "Processing..." : "Confirm & Clear Quarantine"}
            </button>
            <button
              onClick={() => setShowConfirm(false)}
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
