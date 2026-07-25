import { NextResponse } from "next/server";
import crypto from "crypto";
import { ADMIN_COOKIE_NAME, generateSessionToken } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { password } = body || {};

    const expectedPassword = process.env.ADMIN_PASSWORD || "admin-secret-key-12345";
    const passwordBuffer = Buffer.from(typeof password === "string" ? password : "");
    const expectedBuffer = Buffer.from(expectedPassword);

    const isMatch =
      passwordBuffer.length === expectedBuffer.length &&
      crypto.timingSafeEqual(passwordBuffer, expectedBuffer);

    if (!isMatch) {
      return NextResponse.json(
        { success: false, error: "Invalid password credentials" },
        { status: 401 }
      );
    }

    const token = generateSessionToken(password);
    const response = NextResponse.json({ success: true });

    response.cookies.set({
      name: ADMIN_COOKIE_NAME,
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24, // 24 hours
    });

    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Authentication failed";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
