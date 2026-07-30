"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SavvyLogo } from "./SavvyLogo";
import { StatusBadge } from "./StatusBadge";

interface SidebarNavigationProps {
  user?: {
    id: string;
    email: string;
    displayName: string;
    role: string;
  };
}

export function SidebarNavigation({ user }: SidebarNavigationProps) {
  const pathname = usePathname();

  const isReviewActive = pathname.startsWith("/review");
  const isPublicationActive = pathname.startsWith("/publication");
  const isQuarantineActive = pathname.startsWith("/quarantine");
  const isAuditActive = pathname.startsWith("/audit");
  const isAdminUsersActive = pathname.startsWith("/admin-users");

  return (
    <aside
      style={{
        width: 240,
        minWidth: 240,
        background: "rgba(12, 14, 22, 0.95)",
        borderRight: "1px solid var(--admin-border)",
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        position: "sticky",
        top: 0,
        padding: "20px 16px",
        zIndex: 40,
      }}
    >
      {/* Brand Header */}
      <div
        style={{
          padding: "0 8px 24px 8px",
          borderBottom: "1px solid var(--admin-border)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <SavvyLogo size={32} />
          <div>
            <div
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: "var(--admin-text)",
                letterSpacing: "-0.01em",
              }}
            >
              SavvyEdge
            </div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: "var(--admin-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              Governance Console
            </div>
          </div>
        </div>
      </div>

      {/* Nav Groups */}
      <div style={{ flex: 1, padding: "20px 0", overflowY: "auto" }}>
        {/* Governance Group */}
        <div style={{ marginBottom: 24 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "var(--admin-muted-dark)",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              padding: "0 8px 8px 8px",
            }}
          >
            Governance Operations
          </div>
          <nav style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <Link
              href="/review"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 12px",
                borderRadius: 6,
                fontSize: 13,
                fontWeight: isReviewActive ? 600 : 400,
                color: isReviewActive ? "#ffffff" : "var(--admin-muted)",
                background: isReviewActive
                  ? "rgba(16, 185, 129, 0.12)"
                  : "transparent",
                borderLeft: isReviewActive
                  ? "2px solid #10b981"
                  : "2px solid transparent",
                textDecoration: "none",
                transition: "all 0.15s ease",
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke={isReviewActive ? "#34d399" : "currentColor"}
                strokeWidth="2"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              Review Queue
            </Link>

            <Link
              href="/publication"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 12px",
                borderRadius: 6,
                fontSize: 13,
                fontWeight: isPublicationActive ? 600 : 400,
                color: isPublicationActive ? "#ffffff" : "var(--admin-muted)",
                background: isPublicationActive
                  ? "rgba(59, 130, 246, 0.12)"
                  : "transparent",
                borderLeft: isPublicationActive
                  ? "2px solid #3b82f6"
                  : "2px solid transparent",
                textDecoration: "none",
                transition: "all 0.15s ease",
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke={isPublicationActive ? "#60a5fa" : "currentColor"}
                strokeWidth="2"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5 12h14m-5-5 5 5-5 5"
                />
              </svg>
              Publication Queue
            </Link>

            <Link
              href="/quarantine"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 12px",
                borderRadius: 6,
                fontSize: 13,
                fontWeight: isQuarantineActive ? 600 : 400,
                color: isQuarantineActive ? "#ffffff" : "var(--admin-muted)",
                background: isQuarantineActive
                  ? "rgba(245, 158, 11, 0.12)"
                  : "transparent",
                borderLeft: isQuarantineActive
                  ? "2px solid #f59e0b"
                  : "2px solid transparent",
                textDecoration: "none",
                transition: "all 0.15s ease",
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke={isQuarantineActive ? "#fbbf24" : "currentColor"}
                strokeWidth="2"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              Quarantine Queue
            </Link>

            <Link
              href="/audit"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 12px",
                borderRadius: 6,
                fontSize: 13,
                fontWeight: isAuditActive ? 600 : 400,
                color: isAuditActive ? "#ffffff" : "var(--admin-muted)",
                background: isAuditActive
                  ? "rgba(255, 255, 255, 0.08)"
                  : "transparent",
                borderLeft: isAuditActive
                  ? "2px solid var(--admin-border-bright)"
                  : "2px solid transparent",
                textDecoration: "none",
                transition: "all 0.15s ease",
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke={isAuditActive ? "#f3f4f6" : "currentColor"}
                strokeWidth="2"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                />
              </svg>
              Audit Log
            </Link>
          </nav>
        </div>

        {/* Administration Group (RBAC Protected link display) */}
        {user?.role === "ADMIN" && (
          <div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: "var(--admin-muted-dark)",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                padding: "0 8px 8px 8px",
              }}
            >
              Administration
            </div>
            <nav style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <Link
                href="/admin-users"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 12px",
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: isAdminUsersActive ? 600 : 400,
                  color: isAdminUsersActive ? "#ffffff" : "var(--admin-muted)",
                  background: isAdminUsersActive
                    ? "rgba(168, 85, 247, 0.12)"
                    : "transparent",
                  borderLeft: isAdminUsersActive
                    ? "2px solid #c084fc"
                    : "2px solid transparent",
                  textDecoration: "none",
                  transition: "all 0.15s ease",
                }}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={isAdminUsersActive ? "#c084fc" : "currentColor"}
                  strokeWidth="2"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
                  />
                </svg>
                Admin Users
              </Link>
            </nav>
          </div>
        )}
      </div>

      {/* User Info Profile Box at Bottom */}
      {user && (
        <div
          style={{
            padding: 12,
            borderRadius: 8,
            background: "rgba(0, 0, 0, 0.4)",
            border: "1px solid var(--admin-border)",
            marginTop: "auto",
          }}
        >
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--admin-text)",
              marginBottom: 2,
            }}
          >
            {user.displayName}
          </div>
          <div
            style={{
              fontSize: 11,
              color: "var(--admin-muted)",
              marginBottom: 8,
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {user.email}
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <StatusBadge status={user.role} size="sm" />
            <form action="/api/auth/logout" method="POST">
              <button
                type="submit"
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--admin-muted)",
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                Log Out
              </button>
            </form>
          </div>
        </div>
      )}
    </aside>
  );
}
