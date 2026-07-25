import { cookies } from "next/headers";
import crypto from "crypto";
import { prisma, ActorKind } from "@savvyedge/database";

export const ADMIN_COOKIE_NAME = "savvy_admin_session";

function getAdminPassword(): string {
  const secret = process.env.ADMIN_PASSWORD;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("[SECURITY CONFIG ERROR] ADMIN_PASSWORD environment variable is missing or empty!");
    }
    return "admin-secret-key-12345";
  }
  return secret;
}

export function generateSessionToken(password: string): string {
  const secret = getAdminPassword();
  return crypto.createHmac("sha256", secret).update(password).digest("hex");
}

export function isValidSessionToken(token: string): boolean {
  if (!token || typeof token !== "string") return false;
  const expectedToken = generateSessionToken(getAdminPassword());
  const expectedBuffer = Buffer.from(expectedToken);
  const tokenBuffer = Buffer.from(token);

  if (expectedBuffer.length !== tokenBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, tokenBuffer);
}

export async function verifyAdminSession(): Promise<{ authenticated: boolean; username?: string }> {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get(ADMIN_COOKIE_NAME);
    if (!sessionCookie || !sessionCookie.value) {
      return { authenticated: false };
    }
    if (!isValidSessionToken(sessionCookie.value)) {
      return { authenticated: false };
    }
    return { authenticated: true, username: "Administrator" };
  } catch {
    return { authenticated: false };
  }
}

export async function getOrCreateAdminActor(db = prisma): Promise<{ id: string }> {
  const actor = await db.reviewActor.upsert({
    where: { stable_key: "admin:default" },
    update: { active: true },
    create: {
      kind: ActorKind.HUMAN,
      stable_key: "admin:default",
      display_name: "Admin Reviewer",
      active: true,
    },
    select: { id: true },
  });
  return actor;
}
