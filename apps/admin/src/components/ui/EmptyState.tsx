import React from "react";
import { GlassPanel } from "./GlassPanel";

interface EmptyStateProps {
  title: string;
  description: string;
  guide?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
}

export function EmptyState({
  title,
  description,
  guide,
  icon,
  action,
}: EmptyStateProps) {
  return (
    <GlassPanel padding="28px 24px">
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          maxWidth: 480,
          margin: "0 auto",
        }}
      >
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: "50%",
            background: "rgba(255, 255, 255, 0.04)",
            border: "1px solid var(--admin-border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--admin-muted)",
            marginBottom: 14,
          }}
        >
          {icon || (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
            </svg>
          )}
        </div>

        <h3 style={{ margin: "0 0 6px 0", fontSize: 15, fontWeight: 600, color: "var(--admin-text)" }}>
          {title}
        </h3>

        <p style={{ margin: 0, fontSize: 13, color: "var(--admin-muted)", lineHeight: 1.5 }}>
          {description}
        </p>

        {guide && (
          <div
            style={{
              marginTop: 16,
              padding: "10px 14px",
              borderRadius: 6,
              background: "rgba(0, 0, 0, 0.3)",
              border: "1px solid var(--admin-border)",
              fontSize: 12,
              color: "var(--admin-muted-dark)",
              textAlign: "left",
              lineHeight: 1.45,
            }}
          >
            <strong style={{ color: "var(--admin-muted)", display: "block", marginBottom: 2 }}>
              Governance Operation Notice
            </strong>
            {guide}
          </div>
        )}

        {action && <div style={{ marginTop: 16 }}>{action}</div>}
      </div>
    </GlassPanel>
  );
}
