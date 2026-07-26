import { prisma, AdminRole, AdminUserStatus } from "@savvyedge/database";
import crypto from "crypto";

function hashPassword(password: string): string {
  if (!password || password.length < 8) {
    throw new Error("Password must be at least 8 characters long.");
  }
  const salt = crypto.randomBytes(16);
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${derivedKey.toString("hex")}`;
}

async function main() {
  const email = (process.env.SEED_ADMIN_EMAIL || "admin@savvyedge.com").trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD || "AdminPass123!";
  const displayName = process.env.SEED_ADMIN_NAME || "System Administrator";
  const force = process.env.FORCE_BOOTSTRAP === "true";

  console.log(`[Bootstrap] Checking existing Admin accounts...`);
  const existingAdminCount = await prisma.adminUser.count({
    where: { role: AdminRole.ADMIN, status: AdminUserStatus.ACTIVE },
  });

  if (existingAdminCount > 0 && !force) {
    console.log(`[Bootstrap] Active Admin account already exists (${existingAdminCount} found). Skipping bootstrap.`);
    process.exit(0);
  }

  const userId = crypto.randomUUID();
  const stableKey = `admin-user:${userId}`;

  console.log(`[Bootstrap] Creating ReviewActor '${stableKey}'...`);
  const actor = await prisma.reviewActor.upsert({
    where: { stable_key: stableKey },
    update: { display_name: displayName, active: true },
    create: {
      kind: "HUMAN",
      stable_key: stableKey,
      display_name: displayName,
      active: true,
    },
  });

  const passwordHash = hashPassword(password);

  console.log(`[Bootstrap] Provisioning AdminUser '${email}'...`);
  const user = await prisma.adminUser.upsert({
    where: { email },
    update: {
      display_name: displayName,
      password_hash: passwordHash,
      role: AdminRole.ADMIN,
      status: AdminUserStatus.ACTIVE,
    },
    create: {
      id: userId,
      email,
      display_name: displayName,
      password_hash: passwordHash,
      role: AdminRole.ADMIN,
      status: AdminUserStatus.ACTIVE,
      actor_id: actor.id,
    },
    select: {
      id: true,
      email: true,
      display_name: true,
      role: true,
      status: true,
      created_at: true,
    },
  });

  console.log(`[Bootstrap SUCCESS] Admin user '${user.email}' (${user.role}) provisioned successfully. ID: ${user.id}`);
}

main()
  .catch((err) => {
    console.error("[Bootstrap ERROR]", err.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
