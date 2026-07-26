import React from "react";

interface TopBarProps {
  user?: {
    id: string;
    email: string;
    displayName: string;
    role: string;
  };
}

function getEnvironmentBadge() {
  const envStr = (
    process.env.NEXT_PUBLIC_APP_ENV ||
    process.env.SAVVY_ENV ||
    process.env.NODE_ENV ||
    "development"
  ).toLowerCase();

  if (envStr === "production" || envStr === "prod") {
    return {
      label: "PRODUCTION ENVIRONMENT",
      color: "#10b981",
      bg: "rgba(16, 185, 129, 0.1)",
      border: "rgba(16, 185, 129, 0.3)",
      glow: "0 0 8px rgba(16, 185, 129, 0.4)",
    };
  }

  if (envStr === "staging" || envStr === "stage") {
    return {
      label: "STAGING ENVIRONMENT",
      color: "#f59e0b",
      bg: "rgba(245, 158, 11, 0.1)",
      border: "rgba(245, 158, 11, 0.3)",
      glow: "0 0 8px rgba(245, 158, 11, 0.4)",
    };
  }

  return {
    label: "LOCAL DEVELOPMENT",
    color: "#9ca3af",
    bg: "rgba(255, 255, 255, 0.05)",
    border: "rgba(255, 255, 255, 0.12)",
    glow: "none",
  };
}

export function TopBar({ user }: TopBarProps) {
  const envBadge = getEnvironmentBadge();

  return (
    <header
      style={{
        height: 52,
        background: "rgba(9, 10, 15, 0.8)",
        backdropFilter: "blur(12px)",
        borderBottom: "1px solid var(--admin-border)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 24px",
        position: "sticky",
        top: 0,
        zIndex: 30,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: envBadge.color,
            boxShadow: envBadge.glow,
          }}
        />
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: envBadge.color,
            letterSpacing: "0.06em",
            padding: "2px 8px",
            borderRadius: 4,
            background: envBadge.bg,
            border: `1px solid ${envBadge.border}`,
          }}
        >
          {envBadge.label}
        </span>
      </div>

      {user && (
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 13 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, color: "var(--admin-muted)" }}>Operator:</span>
            <span style={{ fontWeight: 600, color: "var(--admin-text)" }}>{user.displayName}</span>
          </div>
        </div>
      )}
    </header>
  );
}
