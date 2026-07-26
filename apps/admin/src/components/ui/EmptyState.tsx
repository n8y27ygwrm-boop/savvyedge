import React from "react";
import { GlassPanel } from "./GlassPanel";

interface EmptyStateProps {
  title: string;
  description: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
}

export function EmptyState({
  title,
  description,
  icon,
  action,
}: EmptyStateProps) {
  return (
    <GlassPanel padding="48px 24px">
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          maxWidth: 400,
          margin: "0 auto",
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: "50%",
            background: "rgba(255, 255, 255, 0.05)",
            border: "1px solid var(--admin-border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--admin-muted)",
            marginBottom: 16,
          }}
        >
          {icon || (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
            </svg>
          )}
        </div>
        <h3 style={{ margin: "0 0 8px 0", fontSize: 16, fontWeight: 600, color: "var(--admin-text)" }}>
          {title}
        </h3>
        <p style={{ margin: 0, fontSize: 13, color: "var(--admin-muted)", lineHeight: 1.5 }}>
          {description}
        </p>
        {action && <div style={{ marginTop: 20 }}>{action}</div>}
      </div>
    </GlassPanel>
  );
}
