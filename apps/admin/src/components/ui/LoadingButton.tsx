import React from "react";

interface LoadingButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
  variant?: "primary" | "secondary" | "danger" | "success" | "outline";
  size?: "sm" | "md" | "lg";
  children: React.ReactNode;
}

export function LoadingButton({
  loading = false,
  variant = "primary",
  size = "md",
  children,
  disabled,
  style,
  ...props
}: LoadingButtonProps) {
  let bg = "#059669"; // SavvyEdge Primary Emerald Accent
  let color = "#ffffff";
  let border = "1px solid rgba(16, 185, 129, 0.4)";

  if (variant === "secondary") {
    bg = "rgba(255, 255, 255, 0.08)";
    color = "var(--admin-text)";
    border = "1px solid var(--admin-border)";
  } else if (variant === "danger") {
    bg = "#dc2626";
    color = "#ffffff";
    border = "1px solid rgba(239, 68, 68, 0.4)";
  } else if (variant === "success") {
    bg = "#10b981";
    color = "#ffffff";
    border = "1px solid rgba(16, 185, 129, 0.5)";
  } else if (variant === "outline") {
    bg = "transparent";
    color = "var(--admin-text)";
    border = "1px solid var(--admin-border-bright)";
  }

  let padding = "8px 16px";
  let fontSize = 13;

  if (size === "sm") {
    padding = "5px 10px";
    fontSize = 12;
  } else if (size === "lg") {
    padding = "12px 20px";
    fontSize = 14;
  }

  return (
    <button
      disabled={disabled || loading}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        padding,
        fontSize,
        fontWeight: 600,
        borderRadius: 6,
        background: bg,
        color: color,
        border,
        cursor: disabled || loading ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
        transition: "all 0.15s ease",
        boxShadow: variant === "primary" ? "0 2px 8px rgba(5, 150, 105, 0.3)" : "none",
        ...style,
      }}
      {...props}
    >
      {loading && (
        <span
          style={{
            width: 14,
            height: 14,
            border: "2px solid rgba(255, 255, 255, 0.3)",
            borderTopColor: "#ffffff",
            borderRadius: "50%",
            animation: "spin 0.8s linear infinite",
          }}
        />
      )}
      {children}
    </button>
  );
}
