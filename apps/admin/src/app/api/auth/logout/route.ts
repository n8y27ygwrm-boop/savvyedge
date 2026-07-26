import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, revokeAdminSession } from "../../../../lib/auth";

export async function POST(request: Request) {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get(ADMIN_COOKIE_NAME);
    if (sessionCookie?.value) {
      await revokeAdminSession(sessionCookie.value);
    }

    const requestUrl = new URL(request.url);
    const response = NextResponse.redirect(new URL("/login", requestUrl.origin), 303);
    response.cookies.set({
      name: ADMIN_COOKIE_NAME,
      value: "",
      path: "/",
      maxAge: 0,
    });

    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Logout failed";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
