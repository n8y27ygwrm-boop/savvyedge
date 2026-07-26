import { redirect } from "next/navigation";
import { prisma } from "@savvyedge/database";
import { verifyAdminSession } from "@/lib/auth";
import { canPerformAdminAction } from "@/lib/permissions";
import UserManagementClient from "./components/UserManagementClient";

export default async function AdminUsersPage() {
  const session = await verifyAdminSession();
  if (!session.authenticated || !session.user) {
    redirect("/login");
  }

  if (!canPerformAdminAction(session.user.role, "MANAGE_ADMIN_USERS")) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-12 text-slate-100">
        <div className="rounded-xl border border-red-500/30 bg-red-950/20 p-8 text-center backdrop-blur-md">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-900/50 text-red-400">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-red-200">Access Restricted (403 Forbidden)</h1>
          <p className="mt-2 text-sm text-slate-400">
            Your current role (<span className="font-semibold text-slate-200">{session.user.role}</span>) does not have permission to access Admin User Management.
          </p>
        </div>
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
    <div className="mx-auto max-w-7xl px-4 py-8 text-slate-100 sm:px-6 lg:px-8">
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-50">Admin User Management</h1>
            <p className="mt-1 text-sm text-slate-400">
              Manage authenticated governance accounts, roles, access status, and password resets.
            </p>
          </div>
        </div>
      </div>

      <UserManagementClient initialUsers={serializedUsers} />
    </div>
  );
}
