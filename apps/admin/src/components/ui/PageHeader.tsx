import React from "react";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumbs?: Array<{ label: string; href?: string }>;
}

export function PageHeader({
  title,
  subtitle,
  badge,
  actions,
  breadcrumbs,
}: PageHeaderProps) {
  return (
    <div style={{ marginBottom: 24 }}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav
          aria-label="Breadcrumbs"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 12,
            color: "var(--admin-muted)",
            marginBottom: 8,
          }}
        >
          {breadcrumbs.map((crumb, idx) => (
            <React.Fragment key={idx}>
              {idx > 0 && <span>/</span>}
              {crumb.href ? (
                <a
                  href={crumb.href}
                  style={{
                    color: "var(--admin-muted)",
                    textDecoration: "none",
                  }}
                  className="hover:text-white"
                >
                  {crumb.label}
                </a>
              ) : (
                <span style={{ color: "var(--admin-text)" }}>{crumb.label}</span>
              )}
            </React.Fragment>
          ))}
        </nav>
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <h1
              style={{
                fontSize: 22,
                fontWeight: 700,
                color: "var(--admin-text)",
                margin: 0,
                letterSpacing: "-0.01em",
              }}
            >
              {title}
            </h1>
            {badge}
          </div>
          {subtitle && (
            <p
              style={{
                fontSize: 14,
                color: "var(--admin-muted)",
                margin: "4px 0 0 0",
                lineHeight: 1.4,
              }}
            >
              {subtitle}
            </p>
          )}
        </div>

        {actions && (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
