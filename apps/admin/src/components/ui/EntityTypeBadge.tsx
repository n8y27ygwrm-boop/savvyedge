import React from "react";

export type EntityType = "CASINO" | "BONUS" | "SLOT" | "LICENSE" | string;

interface EntityTypeBadgeProps {
  type: EntityType;
  size?: "sm" | "md";
}

export function EntityTypeBadge({ type, size = "md" }: EntityTypeBadgeProps) {
  const normalized = (type || "").toUpperCase();

  let bg = "rgba(255, 255, 255, 0.05)";
  let color = "var(--admin-muted)";
  let border = "var(--admin-border)";

  switch (normalized) {
    case "CASINO":
      bg = "rgba(56, 189, 248, 0.1)";
      color = "#38bdf8";
      border = "rgba(56, 189, 248, 0.25)";
      break;
    case "BONUS":
      bg = "rgba(168, 85, 247, 0.1)";
      color = "#c084fc";
      border = "rgba(168, 85, 247, 0.25)";
      break;
    case "SLOT":
      bg = "rgba(244, 63, 94, 0.1)";
      color = "#fb7185";
      border = "rgba(244, 63, 94, 0.25)";
      break;
    case "LICENSE":
      bg = "rgba(16, 185, 129, 0.1)";
      color = "#34d399";
      border = "rgba(16, 185, 129, 0.25)";
      break;
  }

  const isSmall = size === "sm";

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: isSmall ? "1px 6px" : "2px 8px",
        borderRadius: 4,
        fontSize: isSmall ? 10 : 11,
        fontWeight: 700,
        backgroundColor: bg,
        color: color,
        border: `1px solid ${border}`,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      }}
    >
      {type}
    </span>
  );
}
