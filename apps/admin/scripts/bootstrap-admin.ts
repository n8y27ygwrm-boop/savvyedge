import { prisma, AdminRole, AdminUserStatus, ActorKind, type PrismaClient } from "@savvyedge/database";
import crypto from "crypto";

function hashPassword(password: string): string {
  if (!password || password.length < 8) {
    throw new Error("Password must be at least 8 characters long.");
  }
  const salt = crypto.randomBytes(16);
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${derivedKey.toString("hex")}`;
}

export interface BootstrapConfig {
  email?: string;
  password?: string;
  name?: string;
  force?: boolean;
}

export async function executeAdminBootstrap(
  config: BootstrapConfig = {},
  db: PrismaClient = prisma,
): Promise<{ status: "created" | "updated" | "skipped"; email: string; userId: string }> {
  const rawEmail = config.email ?? process.env.SEED_ADMIN_EMAIL;
  const password = config.password ?? process.env.SEED_ADMIN_PASSWORD;
  const displayName = config.name ?? process.env.SEED_ADMIN_NAME;
  const force = config.force ?? (process.env.FORCE_BOOTSTRAP === "true");

  if (!rawEmail || !rawEmail.trim()) {
    throw new Error("[Bootstrap Error] SEED_ADMIN_EMAIL environment variable is required.");
  }
  if (!password || !password.trim()) {
    throw new Error("[Bootstrap Error] SEED_ADMIN_PASSWORD environment variable is required.");
  }
  if (!displayName || !displayName.trim()) {
    throw new Error("[Bootstrap Error] SEED_ADMIN_NAME environment variable is required.");
  }

  const email = rawEmail.trim().toLowerCase();
  if (!email.includes("@") || email.length < 5) {
    throw new Error(`[Bootstrap Error] Invalid email address format: '${email}'`);
  }
  if (password.length < 8) {
    throw new Error("[Bootstrap Error] SEED_ADMIN_PASSWORD must be at least 8 characters long.");
  }

  const existingUser = await db.adminUser.findUnique({
    where: { email },
    include: { actor: true },
  });

  if (existingUser && existingUser.status === AdminUserStatus.ACTIVE && !force) {
    return { status: "skipped", email: existingUser.email, userId: existingUser.id };
  }

  const passwordHash = hashPassword(password);

  if (existingUser) {
    // Update existing user without creating orphan ReviewActor
    await db.reviewActor.update({
      where: { id: existingUser.actor_id },
      data: { display_name: displayName, active: true },
    });

    const updatedUser = await db.adminUser.update({
      where: { id: existingUser.id },
      data: {
        display_name: displayName,
        password_hash: passwordHash,
        role: AdminRole.ADMIN,
        status: AdminUserStatus.ACTIVE,
      },
    });

    return { status: "updated", email: updatedUser.email, userId: updatedUser.id };
  }

  // Create new user & actor
  const userId = crypto.randomUUID();
  const stableKey = `admin-user:${userId}`;

  const actor = await db.reviewActor.create({
    data: {
      kind: ActorKind.HUMAN,
      stable_key: stableKey,
      display_name: displayName,
      active: true,
    },
  });

  const newUser = await db.adminUser.create({
    data: {
      id: userId,
      email,
      display_name: displayName,
      password_hash: passwordHash,
      role: AdminRole.ADMIN,
      status: AdminUserStatus.ACTIVE,
      actor_id: actor.id,
    },
  });

  return { status: "created", email: newUser.email, userId: newUser.id };
}

// CLI Execution
if (require.main === module) {
  executeAdminBootstrap()
    .then((result) => {
      if (result.status === "skipped") {
        console.log(`[Bootstrap] Active Admin account '${result.email}' already exists. Skipping bootstrap.`);
      } else {
        console.log(`[Bootstrap SUCCESS] Admin account '${result.email}' (${result.status}) provisioned successfully.`);
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error("[Bootstrap ERROR]", err.message);
      process.exit(1);
    });
}
