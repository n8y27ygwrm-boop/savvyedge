import React from "react";

interface SavvyLogoProps {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

export function SavvyLogo({ size = 32, className, style }: SavvyLogoProps) {
  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.2),
        background: "radial-gradient(circle at 50% 30%, #1e2230 0%, #0c0e16 100%)",
        border: "1px solid rgba(255, 255, 255, 0.12)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 4px 16px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.15)",
        flexShrink: 0,
        position: "relative",
        overflow: "hidden",
        ...style,
      }}
    >
      <svg
        width={Math.round(size * 0.72)}
        height={Math.round(size * 0.72)}
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* Silver Gradients for Upper Planes */}
          <linearGradient id="silver-top" x1="50" y1="15" x2="80" y2="27" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#FFFFFF" />
            <stop offset="100%" stopColor="#CBD5E1" />
          </linearGradient>

          <linearGradient id="silver-left" x1="20" y1="38" x2="50" y2="15" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#94A3B8" />
            <stop offset="100%" stopColor="#E2E8F0" />
          </linearGradient>

          <linearGradient id="silver-center" x1="20" y1="38" x2="50" y2="50" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#64748B" />
            <stop offset="100%" stopColor="#CBD5E1" />
          </linearGradient>

          {/* Emerald Gradients for Lower Planes */}
          <linearGradient id="emerald-bottom" x1="20" y1="85" x2="50" y2="73" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#047857" />
            <stop offset="100%" stopColor="#10B981" />
          </linearGradient>

          <linearGradient id="emerald-right" x1="80" y1="62" x2="50" y2="85" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#34D399" />
            <stop offset="100%" stopColor="#059669" />
          </linearGradient>

          <linearGradient id="emerald-center-overlay" x1="50" y1="38" x2="80" y2="62" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#34D399" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#10B981" stopOpacity="0.85" />
          </linearGradient>

          {/* Emerald Drop Shadow / Glow */}
          <filter id="emerald-glow" x="30%" y="30%" width="70%" height="70%">
            <feDropShadow dx="0" dy="4" stdDeviation="6" floodColor="#10B981" floodOpacity="0.4" />
          </filter>
        </defs>

        {/* --- UPPER SILVER HALF --- */}
        {/* Top Flat Plane */}
        <polygon points="50,15 80,15 65,27 50,27" fill="url(#silver-top)" />

        {/* Upper Outer Left Facet */}
        <polygon points="50,15 20,38 35,44 50,27" fill="url(#silver-left)" />

        {/* Upper Inner Center Facet */}
        <polygon points="20,38 50,50 50,27 35,44" fill="url(#silver-center)" />

        {/* --- LOWER EMERALD HALF --- */}
        {/* Bottom Flat Plane */}
        <polygon points="50,85 20,85 35,73 50,73" fill="url(#emerald-bottom)" />

        {/* Lower Outer Right Facet */}
        <polygon points="50,85 80,62 65,56 50,73" fill="url(#emerald-right)" />

        {/* Center Emerald Overlap Facet (Extends from y=38 down to y=62) */}
        <polygon
          points="50,38 80,62 65,56 50,50"
          fill="url(#emerald-center-overlay)"
          filter="url(#emerald-glow)"
        />
      </svg>
    </div>
  );
}
