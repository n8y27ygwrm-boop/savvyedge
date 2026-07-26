import React from "react";

interface GlassPanelProps {
  children: React.ReactNode;
  raised?: boolean;
  className?: string;
  style?: React.CSSProperties;
  padding?: string | number;
}

export function GlassPanel({
  children,
  raised = false,
  style,
  padding = "20px",
}: GlassPanelProps) {
  return (
    <div
      className={raised ? "glass-panel-raised" : "glass-panel"}
      style={{
        padding,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
