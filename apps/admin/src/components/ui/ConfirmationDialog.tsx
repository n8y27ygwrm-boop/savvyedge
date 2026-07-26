import React from "react";
import { GlassPanel } from "./GlassPanel";

interface ConfirmationDialogProps {
  isOpen: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isDanger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: React.ReactNode;
}

export function ConfirmationDialog({
  isOpen,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  isDanger = false,
  loading = false,
  onConfirm,
  onCancel,
  children,
}: ConfirmationDialogProps) {
  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: "rgba(0, 0, 0, 0.75)",
        backdropFilter: "blur(6px)",
      }}
    >
      <div style={{ maxWidth: 440, width: "100%" }}>
        <GlassPanel raised padding="24px">
          <h3 style={{ margin: "0 0 8px 0", fontSize: 18, fontWeight: 700, color: "var(--admin-text)" }}>
            {title}
          </h3>
          <p style={{ margin: "0 0 16px 0", fontSize: 14, color: "var(--admin-muted)", lineHeight: 1.5 }}>
            {description}
          </p>

          {children}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 24 }}>
            <button
              type="button"
              onClick={onCancel}
              disabled={loading}
              style={{
                padding: "8px 16px",
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 600,
                background: "rgba(255, 255, 255, 0.05)",
                color: "var(--admin-text)",
                border: "1px solid var(--admin-border)",
                cursor: loading ? "not-allowed" : "pointer",
              }}
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={loading}
              style={{
                padding: "8px 16px",
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 600,
                background: isDanger ? "#dc2626" : "#2563eb",
                color: "#ffffff",
                border: "none",
                cursor: loading ? "wait" : "pointer",
              }}
            >
              {loading ? "Processing..." : confirmLabel}
            </button>
          </div>
        </GlassPanel>
      </div>
    </div>
  );
}
