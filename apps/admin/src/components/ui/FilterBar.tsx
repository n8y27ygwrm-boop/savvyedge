import React from "react";

export interface FilterOption {
  label: string;
  value: string;
  count?: number;
}

interface FilterBarGroupProps {
  label: string;
  options: FilterOption[];
  currentValue: string;
  onSelect: (value: string) => void;
}

export function FilterBarGroup({
  label,
  options,
  currentValue,
  onSelect,
}: FilterBarGroupProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: "var(--admin-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}:
      </span>
      <div style={{ display: "flex", background: "rgba(0, 0, 0, 0.4)", padding: 2, borderRadius: 6, border: "1px solid var(--admin-border)" }}>
        {options.map((opt) => {
          const isActive = currentValue.toUpperCase() === opt.value.toUpperCase();
          return (
            <button
              key={opt.value}
              onClick={() => onSelect(opt.value)}
              style={{
                background: isActive ? "rgba(255, 255, 255, 0.12)" : "transparent",
                color: isActive ? "#ffffff" : "var(--admin-muted)",
                border: "none",
                borderRadius: 4,
                padding: "3px 10px",
                fontSize: 12,
                fontWeight: isActive ? 600 : 400,
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              {opt.label}
              {opt.count !== undefined && (
                <span
                  style={{
                    marginLeft: 6,
                    fontSize: 10,
                    padding: "1px 5px",
                    borderRadius: 10,
                    background: isActive ? "rgba(255, 255, 255, 0.2)" : "rgba(255, 255, 255, 0.05)",
                  }}
                >
                  {opt.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
