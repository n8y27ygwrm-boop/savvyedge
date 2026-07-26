import React from "react";

export type StatusBadgeType =
  | "AWAITING_REVIEW"
  | "IN_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "QUARANTINED"
  | "PUBLISHED"
  | "UNPUBLISHED"
  | "SUPERSEDED"
  | "NEW"
  | "ACTIVE"
  | "DISABLED"
  | string;

interface StatusBadgeProps {
  status: StatusBadgeType;
  size?: "sm" | "md";
}

export function StatusBadge({ status, size = "md" }: StatusBadgeProps) {
  const normalized = (status || "").toUpperCase();

  let bg = "rgba(255, 255, 255, 0.06)";
  let color = "var(--admin-muted)";
  let border = "var(--admin-border)";
  let label = status;

  switch (normalized) {
    case "AWAITING_REVIEW":
    case "NEW":
      bg = "rgba(245, 158, 11, 0.12)";
      color = "#f59e0b";
      border = "rgba(245, 158, 11, 0.3)";
      label = normalized === "AWAITING_REVIEW" ? "Awaiting Review" : "New";
      break;

    case "IN_REVIEW":
      bg = "rgba(59, 130, 246, 0.12)";
      color = "#60a5fa";
      border = "rgba(59, 130, 246, 0.3)";
      label = "In Review";
      break;

    case "APPROVED":
    case "PUBLISHED":
    case "ACTIVE":
      bg = "rgba(16, 185, 129, 0.12)";
      color = "#34d399";
      border = "rgba(16, 185, 129, 0.3)";
      label =
        normalized === "APPROVED"
          ? "Approved"
          : normalized === "PUBLISHED"
          ? "Published"
          : "Active";
      break;

    case "REJECTED":
    case "QUARANTINED":
    case "DISABLED":
      bg = "rgba(239, 68, 68, 0.12)";
      color = "#f87171";
      border = "rgba(239, 68, 68, 0.3)";
      label =
        normalized === "REJECTED"
          ? "Rejected"
          : normalized === "QUARANTINED"
          ? "Quarantined"
          : "Disabled";
      break;

    case "UNPUBLISHED":
    case "SUPERSEDED":
      bg = "rgba(255, 255, 255, 0.05)";
      color = "#9ca3af";
      border = "rgba(255, 255, 255, 0.1)";
      label = normalized === "UNPUBLISHED" ? "Unpublished" : "Superseded";
      break;
  }

  const isSmall = size === "sm";

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: isSmall ? "1px 6px" : "2px 8px",
        borderRadius: 4,
        fontSize: isSmall ? 11 : 12,
        fontWeight: 600,
        backgroundColor: bg,
        color: color,
        border: `1px solid ${border}`,
        letterSpacing: "0.02em",
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          width: 5,
          height: 5,
          borderRadius: "50%",
          backgroundColor: color,
        }}
      />
      {label}
    </span>
  );
}
