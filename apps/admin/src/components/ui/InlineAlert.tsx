import React from "react";

interface InlineAlertProps {
  type?: "error" | "warning" | "success" | "info";
  title?: string;
  message: string;
  onDismiss?: () => void;
  style?: React.CSSProperties;
}

export function InlineAlert({
  type = "info",
  title,
  message,
  onDismiss,
  style,
}: InlineAlertProps) {
  let bg = "var(--admin-info-bg)";
  let border = "var(--admin-info-border)";
  let color = "#93c5fd";

  if (type === "error") {
    bg = "var(--admin-danger-bg)";
    border = "var(--admin-danger-border)";
    color = "#fca5a5";
  } else if (type === "warning") {
    bg = "var(--admin-warning-bg)";
    border = "var(--admin-warning-border)";
    color = "#fcd34d";
  } else if (type === "success") {
    bg = "var(--admin-emerald-bg)";
    border = "var(--admin-emerald-border)";
    color = "#6ee7b7";
  }

  return (
    <div
      style={{
        padding: "12px 16px",
        borderRadius: 6,
        background: bg,
        border: `1px solid ${border}`,
        color: color,
        fontSize: 13,
        lineHeight: 1.4,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        gap: 12,
        ...style,
      }}
    >
      <div>
        {title && <div style={{ fontWeight: 700, marginBottom: 2 }}>{title}</div>}
        <div>{message}</div>
      </div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          style={{
            background: "transparent",
            border: "none",
            color: color,
            cursor: "pointer",
            padding: 0,
            fontSize: 16,
            lineHeight: 1,
            opacity: 0.8,
          }}
          aria-label="Dismiss alert"
        >
          ×
        </button>
      )}
    </div>
  );
}
