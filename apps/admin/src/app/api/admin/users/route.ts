import { NextResponse } from "next/server";
import { prisma, AdminRole } from "@savvyedge/database";
import { verifyAdminSession, createAdminUser } from "../../../../lib/auth";
import { canPerformAdminAction } from "../../../../lib/permissions";

export async function GET(request?: Request) {
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

  try {
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

    return NextResponse.json({ success: true, users });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch admin users";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
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

  try {
    const body = await request.json();
    const { email, displayName, password, role } = body || {};

    if (!email || !displayName || !password || typeof email !== "string" || typeof displayName !== "string" || typeof password !== "string") {
      return NextResponse.json(
        { success: false, error: "Email, display name, and password are required." },
        { status: 400 },
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { success: false, error: "Password must be at least 8 characters long." },
        { status: 400 },
      );
    }

    const validRoles = Object.values(AdminRole);
    const assignedRole = role && validRoles.includes(role as AdminRole) ? (role as AdminRole) : AdminRole.REVIEWER;

    const user = await createAdminUser({
      email,
      displayName,
      password,
      role: assignedRole,
    });

    return NextResponse.json({ success: true, user });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create admin user";
    const status = message.includes("already exists") ? 409 : 400;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
