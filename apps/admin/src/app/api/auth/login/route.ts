import { NextResponse } from "next/server";
import { prisma, AdminUserStatus } from "@savvyedge/database";
import {
  ADMIN_COOKIE_NAME,
  verifyPassword,
  createAdminSession,
} from "../../../../lib/auth";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, password } = body || {};

    if (!email || !password || typeof email !== "string" || typeof password !== "string") {
      return NextResponse.json(
        { success: false, error: "Invalid email or password" },
        { status: 401 },
      );
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = await prisma.adminUser.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user || user.status !== AdminUserStatus.ACTIVE) {
      return NextResponse.json(
        { success: false, error: "Invalid email or password" },
        { status: 401 },
      );
    }

    const isMatch = verifyPassword(password, user.password_hash);
    if (!isMatch) {
      return NextResponse.json(
        { success: false, error: "Invalid email or password" },
        { status: 401 },
      );
    }

    const { rawToken, session } = await createAdminSession(user.id);

    await prisma.adminUser.update({
      where: { id: user.id },
      data: { last_login_at: new Date() },
    });

    const response = NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        role: user.role,
      },
    });

    response.cookies.set({
      name: ADMIN_COOKIE_NAME,
      value: rawToken,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_APP_ENV === "staging" || process.env.SAVVY_ENV === "staging",
      sameSite: "lax",
      path: "/",
      expires: session.expiresAt,
    });

    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Authentication failed";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
