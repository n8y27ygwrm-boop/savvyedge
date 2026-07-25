import type { Metadata } from "next";
import Link from "next/link";
import { verifyAdminSession } from "@/lib/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "SavvyEdge Admin Governance",
  description: "Internal SavvyEdge Workflow Governance Administration",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { authenticated, username } = await verifyAdminSession();

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, -apple-system, sans-serif", background: "#f8fafc", color: "#0f172a" }}>
        <header style={{ background: "#1e293b", color: "#f8fafc", padding: "12px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
            <span style={{ fontWeight: "bold", fontSize: 18, color: "#38bdf8" }}>SavvyEdge Admin</span>
            {authenticated && (
              <nav style={{ display: "flex", gap: 16, fontSize: 14 }}>
                <Link href="/review" style={{ color: "#f1f5f9", textDecoration: "none" }}>
                  Review Queue
                </Link>
                <Link href="/quarantine" style={{ color: "#f1f5f9", textDecoration: "none" }}>
                  Quarantine Queue
                </Link>
                <span style={{ color: "#64748b", cursor: "not-allowed" }} title="Placeholder for Audit navigation">
                  Audit Log
                </span>
              </nav>
            )}
          </div>
          {authenticated ? (
            <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 14 }}>
              <span style={{ color: "#94a3b8" }}>User: <strong style={{ color: "#f8fafc" }}>{username}</strong></span>
              <form action="/api/auth/logout" method="POST" style={{ margin: 0 }}>
                <button
                  type="submit"
                  style={{ background: "#475569", color: "#fff", border: "none", padding: "6px 12px", borderRadius: 4, cursor: "pointer", fontSize: 13 }}
                >
                  Logout
                </button>
              </form>
            </div>
          ) : (
            <span style={{ fontSize: 13, color: "#94a3b8" }}>Unauthenticated</span>
          )}
        </header>
        <main style={{ padding: "24px", maxWidth: 1200, margin: "0 auto" }}>
          {children}
        </main>
      </body>
    </html>
  );
}
