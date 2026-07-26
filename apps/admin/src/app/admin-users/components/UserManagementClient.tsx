"use client";

import { useState } from "react";
import { AdminRole, AdminUserStatus } from "@savvyedge/database";

export interface SerializedAdminUser {
  id: string;
  email: string;
  display_name: string;
  role: AdminRole;
  status: AdminUserStatus;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
}

interface Props {
  initialUsers: SerializedAdminUser[];
}

export default function UserManagementClient({ initialUsers }: Props) {
  const [users, setUsers] = useState<SerializedAdminUser[]>(initialUsers);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Create User Form State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<AdminRole>(AdminRole.REVIEWER);

  // Password Reset Modal State
  const [resetUser, setResetUser] = useState<SerializedAdminUser | null>(null);
  const [resetPasswordVal, setResetPasswordVal] = useState("");

  const refreshUsers = async () => {
    try {
      const res = await fetch("/api/admin/users");
      const data = await res.json();
      if (data.success) {
        setUsers(data.users);
      }
    } catch (err) {
      console.error("Failed to refresh users:", err);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: newEmail,
          displayName: newDisplayName,
          password: newPassword,
          role: newRole,
        }),
      });

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to create user");
      }

      setSuccess(`User '${data.user.email}' created successfully.`);
      setNewEmail("");
      setNewDisplayName("");
      setNewPassword("");
      setNewRole(AdminRole.REVIEWER);
      setShowCreateModal(false);
      await refreshUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Creation failed");
    } finally {
      setLoading(false);
    }
  };

  const handleRoleChange = async (userId: string, role: AdminRole) => {
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "UPDATE_ROLE", role }),
      });

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to update role");
      }

      setSuccess("Role updated successfully.");
      await refreshUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Role update failed");
    }
  };

  const handleToggleStatus = async (user: SerializedAdminUser) => {
    setError(null);
    setSuccess(null);
    const newStatus = user.status === AdminUserStatus.ACTIVE ? AdminUserStatus.DISABLED : AdminUserStatus.ACTIVE;

    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "SET_STATUS", status: newStatus }),
      });

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to update status");
      }

      setSuccess(`Status for '${user.email}' changed to ${newStatus}.`);
      await refreshUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Status toggle failed");
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetUser) return;
    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      const res = await fetch(`/api/admin/users/${resetUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "RESET_PASSWORD", newPassword: resetPasswordVal }),
      });

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || "Password reset failed");
      }

      setSuccess(`Password reset successfully for '${resetUser.email}'.`);
      setResetUser(null);
      setResetPasswordVal("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Password reset failed");
    } finally {
      setLoading(false);
    }
  };

  const getRoleBadge = (role: AdminRole) => {
    switch (role) {
      case AdminRole.ADMIN:
        return "bg-purple-950/80 text-purple-300 border-purple-500/30";
      case AdminRole.SENIOR_REVIEWER:
        return "bg-cyan-950/80 text-cyan-300 border-cyan-500/30";
      case AdminRole.PUBLISHER:
        return "bg-emerald-950/80 text-emerald-300 border-emerald-500/30";
      case AdminRole.REVIEWER:
      default:
        return "bg-slate-800 text-slate-300 border-slate-700";
    }
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-950/30 p-4 text-sm text-red-300">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/30 p-4 text-sm text-emerald-300">
          {success}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-400">
          Total Accounts: <span className="font-semibold text-slate-200">{users.length}</span>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white shadow-md hover:bg-cyan-500 transition-colors"
        >
          + Create Admin User
        </button>
      </div>

      {/* Users Table */}
      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60 backdrop-blur-md">
        <table className="w-full text-left text-sm text-slate-300">
          <thead className="border-b border-slate-800 bg-slate-950/50 text-xs uppercase tracking-wider text-slate-400">
            <tr>
              <th className="px-6 py-4">User</th>
              <th className="px-6 py-4">Role</th>
              <th className="px-6 py-4">Status</th>
              <th className="px-6 py-4">Last Login</th>
              <th className="px-6 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {users.map((user) => (
              <tr key={user.id} className="hover:bg-slate-800/30 transition-colors">
                <td className="px-6 py-4">
                  <div className="font-semibold text-slate-100">{user.display_name}</div>
                  <div className="text-xs text-slate-400">{user.email}</div>
                </td>
                <td className="px-6 py-4">
                  <select
                    value={user.role}
                    onChange={(e) => handleRoleChange(user.id, e.target.value as AdminRole)}
                    className={`rounded-md border px-2.5 py-1 text-xs font-semibold backdrop-blur-md focus:outline-none ${getRoleBadge(user.role)}`}
                  >
                    <option value={AdminRole.REVIEWER} className="bg-slate-900 text-slate-200">REVIEWER</option>
                    <option value={AdminRole.SENIOR_REVIEWER} className="bg-slate-900 text-slate-200">SENIOR_REVIEWER</option>
                    <option value={AdminRole.PUBLISHER} className="bg-slate-900 text-slate-200">PUBLISHER</option>
                    <option value={AdminRole.ADMIN} className="bg-slate-900 text-slate-200">ADMIN</option>
                  </select>
                </td>
                <td className="px-6 py-4">
                  <span
                    className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                      user.status === AdminUserStatus.ACTIVE
                        ? "border-emerald-500/30 bg-emerald-950/60 text-emerald-400"
                        : "border-red-500/30 bg-red-950/60 text-red-400"
                    }`}
                  >
                    {user.status}
                  </span>
                </td>
                <td className="px-6 py-4 text-xs text-slate-400">
                  {user.last_login_at ? new Date(user.last_login_at).toLocaleString() : "Never"}
                </td>
                <td className="px-6 py-4 text-right space-x-2">
                  <button
                    onClick={() => handleToggleStatus(user)}
                    className={`rounded border px-2.5 py-1 text-xs font-medium transition-colors ${
                      user.status === AdminUserStatus.ACTIVE
                        ? "border-amber-500/30 text-amber-300 hover:bg-amber-950/40"
                        : "border-emerald-500/30 text-emerald-300 hover:bg-emerald-950/40"
                    }`}
                  >
                    {user.status === AdminUserStatus.ACTIVE ? "Disable" : "Enable"}
                  </button>

                  <button
                    onClick={() => setResetUser(user)}
                    className="rounded border border-slate-700 bg-slate-800/80 px-2.5 py-1 text-xs font-medium text-slate-300 hover:bg-slate-700 transition-colors"
                  >
                    Reset Password
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create User Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
            <h2 className="text-lg font-bold text-slate-100 mb-4">Create New Admin User</h2>
            <form onSubmit={handleCreateUser} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Email Address</label>
                <input
                  type="email"
                  required
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-cyan-500 focus:outline-none"
                  placeholder="name@savvyedge.com"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Display Name</label>
                <input
                  type="text"
                  required
                  value={newDisplayName}
                  onChange={(e) => setNewDisplayName(e.target.value)}
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-cyan-500 focus:outline-none"
                  placeholder="Jane Doe"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Password (min 8 chars)</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Governance Role</label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as AdminRole)}
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-cyan-500 focus:outline-none"
                >
                  <option value={AdminRole.REVIEWER}>REVIEWER (Read, Begin Review, Reject)</option>
                  <option value={AdminRole.SENIOR_REVIEWER}>SENIOR_REVIEWER (+ Approve, Clear Quarantine)</option>
                  <option value={AdminRole.PUBLISHER}>PUBLISHER (+ Publish, Unpublish)</option>
                  <option value={AdminRole.ADMIN}>ADMIN (Full Permissions & User Management)</option>
                </select>
              </div>

              <div className="mt-6 flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
                >
                  {loading ? "Creating..." : "Create User"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {resetUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
            <h2 className="text-lg font-bold text-slate-100 mb-2">Reset Password</h2>
            <p className="text-xs text-slate-400 mb-4">
              Setting new password for <span className="font-semibold text-slate-200">{resetUser.email}</span>. Active sessions for this user will be revoked immediately.
            </p>
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">New Password (min 8 chars)</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={resetPasswordVal}
                  onChange={(e) => setResetPasswordVal(e.target.value)}
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <div className="mt-6 flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setResetUser(null)}
                  className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
                >
                  {loading ? "Resetting..." : "Set New Password"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
