import React from "react";

interface SavvyLogoProps {
  size?: number;
}

export function SavvyLogo({ size = 28 }: SavvyLogoProps) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.22),
        background: "rgba(18, 20, 29, 0.9)",
        border: "1px solid rgba(255, 255, 255, 0.12)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.15)",
        flexShrink: 0,
      }}
    >
      <svg
        width={Math.round(size * 0.75)}
        height={Math.round(size * 0.75)}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* Upper/Left Silver Plane Gradient */}
          <linearGradient id="savvy-silver-plane" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#FFFFFF" />
            <stop offset="50%" stopColor="#E5E7EB" />
            <stop offset="100%" stopColor="#9CA3AF" />
          </linearGradient>
          {/* Lower/Right Emerald Plane Gradient */}
          <linearGradient id="savvy-emerald-plane" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#34D399" />
            <stop offset="60%" stopColor="#10B981" />
            <stop offset="100%" stopColor="#059669" />
          </linearGradient>
        </defs>

        {/* Folded Ribbon "S" Geometry */}
        {/* Upper Silver Fold */}
        <path
          d="M18 4H9.5C6.46243 4 4 6.46243 4 9.5C4 12.5376 6.46243 15 9.5 15H14.5"
          stroke="url(#savvy-silver-plane)"
          strokeWidth="3.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Lower Emerald Fold */}
        <path
          d="M6 20H14.5C17.5376 20 20 17.5376 20 14.5C20 11.4624 17.5376 9 14.5 9H9.5"
          stroke="url(#savvy-emerald-plane)"
          strokeWidth="3.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
