import { describe, it, expect, beforeEach } from "vitest";
import { prisma, AdminRole, AdminUserStatus } from "@savvyedge/database";
import { executeAdminBootstrap } from "../../../apps/admin/scripts/bootstrap-admin";

const databaseUrl = process.env.PHASE2_WORKFLOW_TEST_DATABASE_URL || process.env.DATABASE_URL;

describe.runIf(Boolean(databaseUrl))("Admin Bootstrap Hardening Integration Tests (Real DB)", () => {
  const testEmail = "test-bootstrap-admin@savvyedge.com";

  beforeEach(async () => {
    // Clean up test bootstrap user & sessions
    const existing = await prisma.adminUser.findUnique({
      where: { email: testEmail },
      select: { id: true, actor_id: true },
    });
    if (existing) {
      await prisma.adminSession.deleteMany({ where: { user_id: existing.id } });
      await prisma.adminUser.delete({ where: { id: existing.id } });
      await prisma.reviewActor.delete({ where: { id: existing.actor_id } }).catch(() => {});
    }
  });

  it("fails when required environment variables are missing or empty", async () => {
    await expect(executeAdminBootstrap({ email: "", password: "Pass123!Valid", name: "Admin" })).rejects.toThrow(
      "SEED_ADMIN_EMAIL environment variable is required"
    );

    await expect(executeAdminBootstrap({ email: testEmail, password: "", name: "Admin" })).rejects.toThrow(
      "SEED_ADMIN_PASSWORD environment variable is required"
    );

    await expect(executeAdminBootstrap({ email: testEmail, password: "Pass123!Valid", name: "" })).rejects.toThrow(
      "SEED_ADMIN_NAME environment variable is required"
    );
  });

  it("fails when email format is invalid or password is too short", async () => {
    await expect(
      executeAdminBootstrap({ email: "invalid-email-string", password: "Pass123!Valid", name: "Admin" })
    ).rejects.toThrow("Invalid email address format");

    await expect(
      executeAdminBootstrap({ email: testEmail, password: "short", name: "Admin" })
    ).rejects.toThrow("SEED_ADMIN_PASSWORD must be at least 8 characters long");
  });

  it("successfully performs first bootstrap with valid config and actor linkage", async () => {
    const result = await executeAdminBootstrap({
      email: testEmail,
      password: "StrongPassword123!",
      name: "Test Administrator",
    });

    expect(result.status).toBe("created");
    expect(result.email).toBe(testEmail);

    const user = await prisma.adminUser.findUnique({
      where: { email: testEmail },
      include: { actor: true },
    });

    expect(user).not.toBeNull();
    expect(user?.role).toBe(AdminRole.ADMIN);
    expect(user?.status).toBe(AdminUserStatus.ACTIVE);
    expect(user?.actor).not.toBeNull();
    expect(user?.actor.display_name).toBe("Test Administrator");
    expect(user?.actor.stable_key).toBe(`admin-user:${user?.id}`);
  });

  it("refuses to overwrite active admin on repeated execution without force option", async () => {
    // First creation
    await executeAdminBootstrap({
      email: testEmail,
      password: "StrongPassword123!",
      name: "Test Administrator",
    });

    // Second execution without force
    const repeatResult = await executeAdminBootstrap({
      email: testEmail,
      password: "NewPassword999!",
      name: "Updated Name",
      force: false,
    });

    expect(repeatResult.status).toBe("skipped");

    const user = await prisma.adminUser.findUnique({
      where: { email: testEmail },
    });
    expect(user?.display_name).toBe("Test Administrator");
  });

  it("updates existing user when force option is true without creating orphan actor", async () => {
    // First creation
    const firstResult = await executeAdminBootstrap({
      email: testEmail,
      password: "StrongPassword123!",
      name: "Original Name",
    });

    const initialActorCount = await prisma.reviewActor.count();

    // Forced re-bootstrap
    const forceResult = await executeAdminBootstrap({
      email: testEmail,
      password: "NewPassword999!",
      name: "Forced Updated Name",
      force: true,
    });

    expect(forceResult.status).toBe("updated");

    const finalActorCount = await prisma.reviewActor.count();
    expect(finalActorCount).toBe(initialActorCount); // No orphan actor created!

    const user = await prisma.adminUser.findUnique({
      where: { email: testEmail },
      include: { actor: true },
    });

    expect(user?.display_name).toBe("Forced Updated Name");
    expect(user?.actor.display_name).toBe("Forced Updated Name");
  });
});
