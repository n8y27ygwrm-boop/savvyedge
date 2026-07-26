import { NextResponse } from "next/server";
import { prisma, AdminRole, AdminUserStatus } from "@savvyedge/database";
import {
  verifyAdminSession,
  hashPassword,
  revokeAllUserSessions,
} from "../../../../../lib/auth";
import { canPerformAdminAction } from "../../../../../lib/permissions";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifyAdminSession(request);
  if (!session.authenticated || !session.user) {
    return NextResponse.json({ success: false, error: "Unauthorized access" }, { status: 401 });
  }

  if (!canPerformAdminAction(session.user.role, "MANAGE_ADMIN_USERS")) {
    return NextResponse.json(
      { success: false, error: "Forbidden: Insufficient permissions for user management" },
      { status: 403 },
    );
  }

  const { id: targetUserId } = await params;
  if (!targetUserId) {
    return NextResponse.json({ success: false, error: "User ID is required" }, { status: 400 });
  }

  try {
    const targetUser = await prisma.adminUser.findUnique({
      where: { id: targetUserId },
    });

    if (!targetUser) {
      return NextResponse.json({ success: false, error: "Admin user not found" }, { status: 404 });
    }

    const body = await request.json();
    const { action, role, status, newPassword } = body || {};

    if (action === "UPDATE_ROLE") {
      if (!role || !Object.values(AdminRole).includes(role as AdminRole)) {
        return NextResponse.json({ success: false, error: "Invalid role specified" }, { status: 400 });
      }

      if (targetUser.role === AdminRole.ADMIN && role !== AdminRole.ADMIN) {
        const activeAdminCount = await prisma.adminUser.count({
          where: { role: AdminRole.ADMIN, status: AdminUserStatus.ACTIVE },
        });
        if (activeAdminCount <= 1) {
          return NextResponse.json(
            { success: false, error: "Cannot change the role of the last active Admin account." },
            { status: 400 },
          );
        }
      }

      const updated = await prisma.adminUser.update({
        where: { id: targetUserId },
        data: { role: role as AdminRole },
        select: {
          id: true,
          email: true,
          display_name: true,
          role: true,
          status: true,
          updated_at: true,
        },
      });

      return NextResponse.json({ success: true, user: updated });
    }

    if (action === "SET_STATUS") {
      if (!status || !Object.values(AdminUserStatus).includes(status as AdminUserStatus)) {
        return NextResponse.json({ success: false, error: "Invalid status specified" }, { status: 400 });
      }

      if (status === AdminUserStatus.DISABLED && targetUser.role === AdminRole.ADMIN) {
        const activeAdminCount = await prisma.adminUser.count({
          where: { role: AdminRole.ADMIN, status: AdminUserStatus.ACTIVE },
        });
        if (activeAdminCount <= 1) {
          return NextResponse.json(
            { success: false, error: "Cannot disable the last active Admin account." },
            { status: 400 },
          );
        }
      }

      const updated = await prisma.adminUser.update({
        where: { id: targetUserId },
        data: { status: status as AdminUserStatus },
        select: {
          id: true,
          email: true,
          display_name: true,
          role: true,
          status: true,
          updated_at: true,
        },
      });

      if (status === AdminUserStatus.DISABLED) {
        await revokeAllUserSessions(targetUserId);
      }

      return NextResponse.json({ success: true, user: updated });
    }

    if (action === "RESET_PASSWORD") {
      if (!newPassword || typeof newPassword !== "string" || newPassword.length < 8) {
        return NextResponse.json(
          { success: false, error: "New password must be at least 8 characters long." },
          { status: 400 },
        );
      }

      const passwordHash = hashPassword(newPassword);
      await prisma.adminUser.update({
        where: { id: targetUserId },
        data: { password_hash: passwordHash },
      });

      await revokeAllUserSessions(targetUserId);

      return NextResponse.json({ success: true, message: "Password updated and active sessions revoked." });
    }

    return NextResponse.json({ success: false, error: "Invalid action specified." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update admin user";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
