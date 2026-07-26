import { redirect } from "next/navigation";
import { prisma } from "@savvyedge/database";
import { verifyAdminSession } from "@/lib/auth";
import { canPerformAdminAction } from "@/lib/permissions";
import { PageHeader } from "@/components/ui/PageHeader";
import { GlassPanel } from "@/components/ui/GlassPanel";
import UserManagementClient from "./components/UserManagementClient";

export default async function AdminUsersPage() {
  const session = await verifyAdminSession();
  if (!session.authenticated || !session.user) {
    redirect("/login");
  }

  if (!canPerformAdminAction(session.user.role, "MANAGE_ADMIN_USERS")) {
    return (
      <div style={{ maxWidth: 600, margin: "60px auto", padding: 16 }}>
        <GlassPanel padding="36px" style={{ background: "rgba(239, 68, 68, 0.05)", border: "1px solid var(--admin-danger-border)", textAlign: "center" }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: "50%",
              background: "rgba(239, 68, 68, 0.15)",
              color: "#f87171",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 16px auto",
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: "#f87171", margin: "0 0 8px 0" }}>
            Access Restricted (HTTP 403 Forbidden)
          </h1>
          <p style={{ fontSize: 13, color: "var(--admin-muted)", margin: 0, lineHeight: 1.5 }}>
            Your current role (<strong style={{ color: "var(--admin-text)" }}>{session.user.role}</strong>) does not have permission to access Admin User Management.
          </p>
        </GlassPanel>
      </div>
    );
  }

  const users = await prisma.adminUser.findMany({
    orderBy: { created_at: "asc" },
    select: {
      id: true,
      email: true,
      display_name: true,
      role: true,
      status: true,
      created_at: true,
      updated_at: true,
      last_login_at: true,
    },
  });

  const serializedUsers = users.map((user) => ({
    ...user,
    created_at: user.created_at.toISOString(),
    updated_at: user.updated_at.toISOString(),
    last_login_at: user.last_login_at ? user.last_login_at.toISOString() : null,
  }));

  return (
    <div>
      <PageHeader
        title="Admin User & Access Management"
        subtitle="Manage authenticated operator accounts, assign governance roles, toggle access status, and execute security resets."
      />

      <UserManagementClient initialUsers={serializedUsers} />
    </div>
  );
}
