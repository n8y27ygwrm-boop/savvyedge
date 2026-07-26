import React from "react";
import { GlassPanel } from "./GlassPanel";

interface MetricCardProps {
  label: string;
  value: number | string;
  subtext?: string;
  accentColor?: "emerald" | "amber" | "rose" | "blue" | "neutral";
  icon?: React.ReactNode;
}

export function MetricCard({
  label,
  value,
  subtext,
  accentColor = "neutral",
  icon,
}: MetricCardProps) {
  let color = "var(--admin-text)";
  let iconBg = "rgba(255, 255, 255, 0.05)";

  switch (accentColor) {
    case "emerald":
      color = "#34d399";
      iconBg = "rgba(16, 185, 129, 0.15)";
      break;
    case "amber":
      color = "#fbbf24";
      iconBg = "rgba(245, 158, 11, 0.15)";
      break;
    case "rose":
      color = "#f87171";
      iconBg = "rgba(239, 68, 68, 0.15)";
      break;
    case "blue":
      color = "#60a5fa";
      iconBg = "rgba(59, 130, 246, 0.15)";
      break;
  }

  return (
    <GlassPanel padding="16px">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "var(--admin-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              marginBottom: 6,
            }}
          >
            {label}
          </div>
          <div
            className="tabular-nums"
            style={{
              fontSize: 26,
              fontWeight: 700,
              color: color,
              lineHeight: 1.1,
            }}
          >
            {value}
          </div>
          {subtext && (
            <div style={{ fontSize: 12, color: "var(--admin-muted-dark)", marginTop: 4 }}>
              {subtext}
            </div>
          )}
        </div>
        {icon && (
          <div
            style={{
              padding: 8,
              borderRadius: 6,
              background: iconBg,
              color: color,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {icon}
          </div>
        )}
      </div>
    </GlassPanel>
  );
}
