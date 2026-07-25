import { NextResponse } from "next/server";
import { ADMIN_COOKIE_NAME } from "@/lib/auth";

export async function POST() {
  const response = NextResponse.redirect(new URL("/login", "http://localhost:3000"), 303);
  response.cookies.delete(ADMIN_COOKIE_NAME);
  return response;
}
