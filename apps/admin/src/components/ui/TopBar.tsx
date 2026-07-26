import React from "react";

interface TopBarProps {
  user?: {
    id: string;
    email: string;
    displayName: string;
    role: string;
  };
}

export function TopBar({ user }: TopBarProps) {
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
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: "#10b981",
            boxShadow: "0 0 8px #10b981",
          }}
        />
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--admin-muted)", letterSpacing: "0.05em", textTransform: "uppercase" }}>
          SavvyEdge Production Environment
        </span>
      </div>

      {user && (
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 13 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, color: "var(--admin-muted)" }}>Logged in as</span>
            <span style={{ fontWeight: 600, color: "var(--admin-text)" }}>{user.displayName}</span>
          </div>
        </div>
      )}
    </header>
  );
}
