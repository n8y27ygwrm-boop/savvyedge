"use client";

import { useState } from "react";
import { AdminRole, AdminUserStatus } from "@savvyedge/database";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { InlineAlert } from "@/components/ui/InlineAlert";
import { LoadingButton } from "@/components/ui/LoadingButton";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog";

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

  const handleCreateUser = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: newEmail.trim(),
          displayName: newDisplayName.trim(),
          password: newPassword,
          role: newRole,
        }),
      });

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to create user");
      }

      setSuccess(`Admin account '${data.user.email}' created successfully.`);
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

      setSuccess("User role updated successfully.");
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

      setSuccess(`Account status for '${user.email}' updated to ${newStatus}.`);
      await refreshUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Status toggle failed");
    }
  };

  const handleResetPassword = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
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

      setSuccess(`Password reset successfully for '${resetUser.email}'. Active sessions revoked.`);
      setResetUser(null);
      setResetPasswordVal("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Password reset failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {error && (
        <InlineAlert
          type="error"
          title="Operation Failed"
          message={error}
          onDismiss={() => setError(null)}
        />
      )}
      {success && (
        <InlineAlert
          type="success"
          title="Success"
          message={success}
          onDismiss={() => setSuccess(null)}
        />
      )}

      {/* Action Bar */}
      <GlassPanel padding="14px 20px">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 13, color: "var(--admin-muted)" }}>
            Total Authenticated Accounts: <strong style={{ color: "var(--admin-text)" }}>{users.length}</strong>
          </div>
          <LoadingButton
            onClick={() => setShowCreateModal(true)}
            variant="primary"
            size="sm"
          >
            + Provision Admin Account
          </LoadingButton>
        </div>
      </GlassPanel>

      {/* Users Data Table */}
      <GlassPanel padding={0} style={{ overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "rgba(0, 0, 0, 0.4)", borderBottom: "1px solid var(--admin-border)" }}>
                <th style={{ padding: "12px 16px", color: "var(--admin-muted)", fontWeight: 600, textTransform: "uppercase", fontSize: 11, letterSpacing: "0.05em" }}>
                  Operator Name &amp; Email
                </th>
                <th style={{ padding: "12px 16px", color: "var(--admin-muted)", fontWeight: 600, textTransform: "uppercase", fontSize: 11, letterSpacing: "0.05em" }}>
                  Role Assignment
                </th>
                <th style={{ padding: "12px 16px", color: "var(--admin-muted)", fontWeight: 600, textTransform: "uppercase", fontSize: 11, letterSpacing: "0.05em" }}>
                  Status
                </th>
                <th style={{ padding: "12px 16px", color: "var(--admin-muted)", fontWeight: 600, textTransform: "uppercase", fontSize: 11, letterSpacing: "0.05em" }}>
                  Last Login
                </th>
                <th style={{ padding: "12px 16px", color: "var(--admin-muted)", fontWeight: 600, textTransform: "uppercase", fontSize: 11, letterSpacing: "0.05em", textAlign: "right" }}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr
                  key={u.id}
                  style={{ borderBottom: "1px solid var(--admin-border)", transition: "background 0.15s ease" }}
                >
                  <td style={{ padding: "14px 16px" }}>
                    <div style={{ fontWeight: 600, color: "var(--admin-text)", fontSize: 14 }}>{u.display_name}</div>
                    <div style={{ fontSize: 12, color: "var(--admin-muted)" }}>{u.email}</div>
                  </td>

                  <td style={{ padding: "14px 16px" }}>
                    <select
                      value={u.role}
                      onChange={(e) => handleRoleChange(u.id, e.target.value as AdminRole)}
                      style={{
                        padding: "4px 8px",
                        borderRadius: 6,
                        fontSize: 12,
                        fontWeight: 600,
                        background: "#12141d",
                        color: "var(--admin-text)",
                        border: "1px solid var(--admin-border-bright)",
                        outline: "none",
                        cursor: "pointer",
                      }}
                    >
                      <option value={AdminRole.REVIEWER}>REVIEWER</option>
                      <option value={AdminRole.SENIOR_REVIEWER}>SENIOR_REVIEWER</option>
                      <option value={AdminRole.PUBLISHER}>PUBLISHER</option>
                      <option value={AdminRole.ADMIN}>ADMIN</option>
                    </select>
                  </td>

                  <td style={{ padding: "14px 16px" }}>
                    <StatusBadge status={u.status} size="sm" />
                  </td>

                  <td style={{ padding: "14px 16px", fontSize: 12, color: "var(--admin-muted)" }} className="tabular-nums">
                    {u.last_login_at ? new Date(u.last_login_at).toISOString().slice(0, 19).replace("T", " ") : "Never"}
                  </td>

                  <td style={{ padding: "14px 16px", textAlign: "right" }}>
                    <div style={{ display: "inline-flex", gap: 8 }}>
                      <LoadingButton
                        onClick={() => handleToggleStatus(u)}
                        variant={u.status === AdminUserStatus.ACTIVE ? "outline" : "success"}
                        size="sm"
                      >
                        {u.status === AdminUserStatus.ACTIVE ? "Disable" : "Enable"}
                      </LoadingButton>

                      <LoadingButton
                        onClick={() => setResetUser(u)}
                        variant="secondary"
                        size="sm"
                      >
                        Reset Password
                      </LoadingButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </GlassPanel>

      {/* Create User Modal */}
      <ConfirmationDialog
        isOpen={showCreateModal}
        title="Provision New Admin Account"
        description="Create a new authenticated operator account and assign granular governance role permissions."
        confirmLabel={loading ? "Creating..." : "Create Account"}
        onConfirm={handleCreateUser}
        onCancel={() => setShowCreateModal(false)}
        loading={loading}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--admin-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
              Email Address
            </label>
            <input
              type="email"
              required
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="operator@savvyedge.com"
              style={{
                width: "100%",
                padding: "8px 12px",
                fontSize: 13,
                borderRadius: 6,
                border: "1px solid var(--admin-border-bright)",
                background: "rgba(0, 0, 0, 0.4)",
                color: "var(--admin-text)",
                outline: "none",
              }}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--admin-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
              Display Name
            </label>
            <input
              type="text"
              required
              value={newDisplayName}
              onChange={(e) => setNewDisplayName(e.target.value)}
              placeholder="Jane Doe"
              style={{
                width: "100%",
                padding: "8px 12px",
                fontSize: 13,
                borderRadius: 6,
                border: "1px solid var(--admin-border-bright)",
                background: "rgba(0, 0, 0, 0.4)",
                color: "var(--admin-text)",
                outline: "none",
              }}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--admin-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
              Password (min 8 chars)
            </label>
            <input
              type="password"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              style={{
                width: "100%",
                padding: "8px 12px",
                fontSize: 13,
                borderRadius: 6,
                border: "1px solid var(--admin-border-bright)",
                background: "rgba(0, 0, 0, 0.4)",
                color: "var(--admin-text)",
                outline: "none",
              }}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--admin-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
              Governance Role
            </label>
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as AdminRole)}
              style={{
                width: "100%",
                padding: "8px 12px",
                fontSize: 13,
                borderRadius: 6,
                border: "1px solid var(--admin-border-bright)",
                background: "#12141d",
                color: "var(--admin-text)",
                outline: "none",
              }}
            >
              <option value={AdminRole.REVIEWER}>REVIEWER (Read, Begin Review, Reject)</option>
              <option value={AdminRole.SENIOR_REVIEWER}>SENIOR_REVIEWER (+ Approve, Clear Quarantine)</option>
              <option value={AdminRole.PUBLISHER}>PUBLISHER (+ Publish, Unpublish)</option>
              <option value={AdminRole.ADMIN}>ADMIN (Full Permissions &amp; User Management)</option>
            </select>
          </div>
        </div>
      </ConfirmationDialog>

      {/* Reset Password Modal */}
      {resetUser && (
        <ConfirmationDialog
          isOpen={Boolean(resetUser)}
          title="Security Reset Password"
          description={`Setting a new password for '${resetUser.email}'. All active sessions for this account will be invalidated immediately upon confirmation.`}
          confirmLabel={loading ? "Resetting..." : "Set New Password"}
          onConfirm={handleResetPassword}
          onCancel={() => setResetUser(null)}
          loading={loading}
        >
          <div>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--admin-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
              New Password (min 8 chars)
            </label>
            <input
              type="password"
              required
              minLength={8}
              value={resetPasswordVal}
              onChange={(e) => setResetPasswordVal(e.target.value)}
              style={{
                width: "100%",
                padding: "8px 12px",
                fontSize: 13,
                borderRadius: 6,
                border: "1px solid var(--admin-border-bright)",
                background: "rgba(0, 0, 0, 0.4)",
                color: "var(--admin-text)",
                outline: "none",
              }}
            />
          </div>
        </ConfirmationDialog>
      )}
    </div>
  );
}
