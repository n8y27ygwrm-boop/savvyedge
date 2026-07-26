"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
      <div style={{ padding: "0 8px 24px 8px", borderBottom: "1px solid var(--admin-border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              background: "linear-gradient(135deg, #2563eb, #0d9488)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 800,
              fontSize: 14,
              color: "#fff",
              boxShadow: "0 2px 8px rgba(37, 99, 235, 0.4)",
            }}
          >
            S
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--admin-text)", letterSpacing: "-0.01em" }}>
              SavvyEdge
            </div>
            <div style={{ fontSize: 10, fontWeight: 600, color: "var(--admin-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
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
                background: isReviewActive ? "rgba(255, 255, 255, 0.08)" : "transparent",
                textDecoration: "none",
                transition: "all 0.15s ease",
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Review Queue
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
                background: isQuarantineActive ? "rgba(255, 255, 255, 0.08)" : "transparent",
                textDecoration: "none",
                transition: "all 0.15s ease",
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
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
                background: isAuditActive ? "rgba(255, 255, 255, 0.08)" : "transparent",
                textDecoration: "none",
                transition: "all 0.15s ease",
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
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
                  background: isAdminUsersActive ? "rgba(255, 255, 255, 0.08)" : "transparent",
                  textDecoration: "none",
                  transition: "all 0.15s ease",
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
                Admin Users
              </Link>
            </nav>
          </div>
        )}
      </div>

      {/* User Footer */}
      {user && (
        <div style={{ paddingTop: 16, borderTop: "1px solid var(--admin-border)" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ overflow: "hidden" }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--admin-text)", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
                  {user.displayName}
                </div>
                <div style={{ fontSize: 11, color: "var(--admin-muted)", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
                  {user.email}
                </div>
              </div>
              <StatusBadge status={user.role} size="sm" />
            </div>

            <form action="/api/auth/logout" method="POST" style={{ margin: 0 }}>
              <button
                type="submit"
                style={{
                  width: "100%",
                  padding: "6px 12px",
                  borderRadius: 6,
                  background: "rgba(255, 255, 255, 0.04)",
                  color: "var(--admin-muted)",
                  border: "1px solid var(--admin-border)",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  transition: "all 0.15s ease",
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                Sign Out
              </button>
            </form>
          </div>
        </div>
      )}
    </aside>
  );
}
