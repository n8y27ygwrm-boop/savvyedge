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
  const session = await verifyAdminSession();
  const { authenticated, user } = session;

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, -apple-system, sans-serif", background: "#f8fafc", color: "#0f172a" }}>
        <header style={{ background: "#1e293b", color: "#f8fafc", padding: "12px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
            <span style={{ fontWeight: "bold", fontSize: 18, color: "#38bdf8" }}>SavvyEdge Admin</span>
            {authenticated && user && (
              <nav style={{ display: "flex", gap: 16, fontSize: 14 }}>
                <Link href="/review" style={{ color: "#f1f5f9", textDecoration: "none" }}>
                  Review Queue
                </Link>
                <Link href="/quarantine" style={{ color: "#f1f5f9", textDecoration: "none" }}>
                  Quarantine Queue
                </Link>
                <Link href="/audit" style={{ color: "#f1f5f9", textDecoration: "none" }}>
                  Audit Log
                </Link>
                {user.role === "ADMIN" && (
                  <Link href="/admin-users" style={{ color: "#38bdf8", textDecoration: "none", fontWeight: "600" }}>
                    Admin Users
                  </Link>
                )}
              </nav>
            )}
          </div>
          {authenticated && user ? (
            <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 13 }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                <span style={{ color: "#f8fafc", fontWeight: "600" }}>{user.displayName} ({user.email})</span>
                <span style={{ fontSize: 11, color: "#cbd5e1", background: "#334155", padding: "1px 6px", borderRadius: 4, marginTop: 2 }}>{user.role}</span>
              </div>
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
