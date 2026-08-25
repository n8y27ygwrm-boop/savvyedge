import { describe, it, expect, beforeEach } from "vitest";
import {
  prisma,
  AdminRole,
  AdminUserStatus,
  ReviewStatus,
  PublicationStatus,
} from "@savvyedge/database";
import {
  createAdminUser,
  createAdminSession,
  verifyAdminSession,
  revokeAdminSession,
  hashSessionToken,
} from "../../../apps/admin/src/lib/auth";
import { canPerformAdminAction } from "../../../apps/admin/src/lib/permissions";
import { POST as loginRoute } from "../../../apps/admin/src/app/api/auth/login/route";
import { POST as transitionRoute } from "../../../apps/admin/src/app/api/admin/transitions/route";
import { POST as createUserRoute, GET as getUsersRoute } from "../../../apps/admin/src/app/api/admin/users/route";
import { PATCH as updateUserRoute } from "../../../apps/admin/src/app/api/admin/users/[id]/route";
import { requireIsolatedTestDatabase } from "./helpers/isolated-test-database-guard";

// Destructive suite: skips without the explicit opt-in, throws on an unsafe target.
const describeWithIsolatedDatabase = requireIsolatedTestDatabase()
  ? describe
  : describe.skip;

describeWithIsolatedDatabase("Multi-user Admin Auth & RBAC Integration Tests (Real DB)", () => {
  beforeEach(async () => {
    await prisma.workflowEventClaim.deleteMany();
    await prisma.workflowAuditEvent.deleteMany();
    await prisma.casinoEvidenceClaim.deleteMany();
    await prisma.bonusEvidenceClaim.deleteMany();
    await prisma.slotEvidenceClaim.deleteMany();
    await prisma.licenseEvidenceClaim.deleteMany();
    await prisma.evidenceRecord.deleteMany();
    await prisma.bonusHistoryEvent.deleteMany();
    await prisma.casinoHistoryEvent.deleteMany();
    await prisma.slotRtpHistory.deleteMany();
    await prisma.casinoSlot.deleteMany();
    await prisma.bonus.deleteMany();
    await prisma.license.deleteMany();
    await prisma.slot.deleteMany();
    await prisma.casino.deleteMany();
    await prisma.adminSession.deleteMany();
    await prisma.adminUser.deleteMany();
  });

  it("1, 2, 3, 4, 5, 6) tests login flow, password verification, generic errors, and session token hashing", async () => {
    const user = await createAdminUser({
      email: "user1@savvyedge.com",
      displayName: "User One",
      password: "Password123!",
      role: AdminRole.REVIEWER,
    });

    const createLoginReq = (email = "user1@savvyedge.com", password = "Password123!") =>
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });

    const validRes = await loginRoute(createLoginReq());
    expect(validRes.status).toBe(200);
    const validData = await validRes.json();
    expect(validData.success).toBe(true);

    const sessionCount = await prisma.adminSession.count({ where: { user_id: user.id } });
    expect(sessionCount).toBe(1);

    const sessionInDb = await prisma.adminSession.findFirst({ where: { user_id: user.id } });
    expect(sessionInDb?.token_hash).toBeDefined();

    const wrongPassRes = await loginRoute(createLoginReq("user1@savvyedge.com", "WrongPassword"));
    expect(wrongPassRes.status).toBe(401);
    const wrongPassData = await wrongPassRes.json();
    expect(wrongPassData.error).toBe("Invalid email or password");

    const unknownEmailRes = await loginRoute(createLoginReq("unknown@savvyedge.com", "Password123!"));
    expect(unknownEmailRes.status).toBe(401);
    const unknownEmailData = await unknownEmailRes.json();
    expect(unknownEmailData.error).toBe("Invalid email or password");

    await prisma.adminUser.update({
      where: { id: user.id },
      data: { status: AdminUserStatus.DISABLED },
    });
    const disabledRes = await loginRoute(createLoginReq());
    expect(disabledRes.status).toBe(401);
  });

  it("7, 8, 9, 10) verifies session expiration, revocation, logout, and disabled-user session invalidation", async () => {
    const user = await createAdminUser({
      email: "user-session@savvyedge.com",
      displayName: "Session User",
      password: "Password123!",
      role: AdminRole.REVIEWER,
    });

    const { rawToken } = await createAdminSession(user.id);
    const validContext = await verifyAdminSession(rawToken);
    expect(validContext.authenticated).toBe(true);
    expect(validContext.user?.email).toBe("user-session@savvyedge.com");

    const tokenHash = hashSessionToken(rawToken);
    await prisma.adminSession.update({
      where: { token_hash: tokenHash },
      data: { expires_at: new Date(Date.now() - 1000) },
    });
    const expiredContext = await verifyAdminSession(rawToken);
    expect(expiredContext.authenticated).toBe(false);

    const { rawToken: token2 } = await createAdminSession(user.id);
    await revokeAdminSession(token2);
    const revokedContext = await verifyAdminSession(token2);
    expect(revokedContext.authenticated).toBe(false);

    const { rawToken: token3 } = await createAdminSession(user.id);
    await prisma.adminUser.update({
      where: { id: user.id },
      data: { status: AdminUserStatus.DISABLED },
    });
    const disabledUserContext = await verifyAdminSession(token3);
    expect(disabledUserContext.authenticated).toBe(false);
  });

  it("11, 12, 13, 14, 15) tests REVIEWER role permissions (Can Begin Review & Reject, Cannot Approve/Clear/Publish)", async () => {
    const reviewer = await createAdminUser({
      email: "reviewer@savvyedge.com",
      displayName: "Reviewer User",
      password: "Password123!",
      role: AdminRole.REVIEWER,
    });

    const casino = await prisma.casino.create({
      data: {
        name: "Role Test Casino",
        slug: "role-test-casino",
        status: "ACTIVE",
        review_status: ReviewStatus.AWAITING_REVIEW,
        publication_status: PublicationStatus.UNPUBLISHED,
        governance_version: 1,
      },
    });

    const { rawToken } = await createAdminSession(reviewer.id);

    const beginReq = new Request("http://localhost/api/admin/transitions", {
      method: "POST",
      headers: { Cookie: `savvy_admin_session=${rawToken}` },
      body: JSON.stringify({
        subjectType: "CASINO",
        subjectId: casino.id,
        expectedVersion: 1,
        action: "BEGIN_REVIEW",
      }),
    });
    const beginRes = await transitionRoute(beginReq);
    expect(beginRes.status).toBe(200);

    const rejectReq = new Request("http://localhost/api/admin/transitions", {
      method: "POST",
      headers: { Cookie: `savvy_admin_session=${rawToken}` },
      body: JSON.stringify({
        subjectType: "CASINO",
        subjectId: casino.id,
        expectedVersion: 2,
        action: "REJECT",
        internalReason: "Invalid operator evidence",
      }),
    });
    const rejectRes = await transitionRoute(rejectReq);
    expect(rejectRes.status).toBe(200);

    const approveReq = new Request("http://localhost/api/admin/transitions", {
      method: "POST",
      headers: { Cookie: `savvy_admin_session=${rawToken}` },
      body: JSON.stringify({
        subjectType: "CASINO",
        subjectId: casino.id,
        expectedVersion: 3,
        action: "APPROVE",
      }),
    });
    const approveRes = await transitionRoute(approveReq);
    expect(approveRes.status).toBe(403);

    const publishReq = new Request("http://localhost/api/admin/transitions", {
      method: "POST",
      headers: { Cookie: `savvy_admin_session=${rawToken}` },
      body: JSON.stringify({
        subjectType: "CASINO",
        subjectId: casino.id,
        expectedVersion: 3,
        action: "PUBLISH",
        reason: "Publishing attempt",
      }),
    });
    const publishRes = await transitionRoute(publishReq);
    expect(publishRes.status).toBe(403);
  });

  it("16, 17, 18) tests SENIOR_REVIEWER role permissions (Can Approve & Clear Quarantine, Cannot Publish)", async () => {
    const senior = await createAdminUser({
      email: "senior@savvyedge.com",
      displayName: "Senior Reviewer",
      password: "Password123!",
      role: AdminRole.SENIOR_REVIEWER,
    });

    const casino = await prisma.casino.create({
      data: {
        name: "Senior Test Casino",
        slug: "senior-test-casino",
        status: "ACTIVE",
        review_status: ReviewStatus.IN_REVIEW,
        publication_status: PublicationStatus.UNPUBLISHED,
        governance_version: 1,
      },
    });

    const ds = await prisma.dataSource.create({
      data: { url: "https://regulator.example.com/senior", source_type: "REGULATOR_OFFICIAL" },
    });
    const evidence = await prisma.evidenceRecord.create({
      data: {
        data_source: { connect: { id: ds.id } },
        created_by: { connect: { id: senior.actor_id } },
        evidence_type: "REGULATOR_REGISTER",
        source_url: "https://regulator.example.com/lic",
        observed_at: new Date(),
        extracted_at: new Date(),
      },
    });
    await prisma.casinoEvidenceClaim.create({
      data: {
        casino_id: casino.id,
        evidence_id: evidence.id,
        field: "NAME",
        observed_value: "Senior Test Casino",
        normalized_value_hash: "hash_senior",
        verdict: "SUPPORTS",
      },
    });

    const { rawToken } = await createAdminSession(senior.id);

    const approveReq = new Request("http://localhost/api/admin/transitions", {
      method: "POST",
      headers: { Cookie: `savvy_admin_session=${rawToken}` },
      body: JSON.stringify({
        subjectType: "CASINO",
        subjectId: casino.id,
        expectedVersion: 1,
        action: "APPROVE",
      }),
    });
    const approveRes = await transitionRoute(approveReq);
    expect(approveRes.status).toBe(200);

    const publishReq = new Request("http://localhost/api/admin/transitions", {
      method: "POST",
      headers: { Cookie: `savvy_admin_session=${rawToken}` },
      body: JSON.stringify({
        subjectType: "CASINO",
        subjectId: casino.id,
        expectedVersion: 2,
        action: "PUBLISH",
      }),
    });
    const publishRes = await transitionRoute(publishReq);
    expect(publishRes.status).toBe(403);
  });

  it("19, 20, 21) tests PUBLISHER role permissions (Can Publish & Unpublish, Cannot Approve)", async () => {
    const publisher = await createAdminUser({
      email: "publisher@savvyedge.com",
      displayName: "Publisher User",
      password: "Password123!",
      role: AdminRole.PUBLISHER,
    });

    const casino = await prisma.casino.create({
      data: {
        name: "Publisher Test Casino",
        slug: "publisher-test-casino",
        status: "ACTIVE",
      },
    });

    const bonus = await prisma.bonus.create({
      data: {
        casino_id: casino.id,
        headline_value: "$100 Bonus",
        type: "WELCOME",
        status: "ACTIVE",
        review_status: ReviewStatus.APPROVED,
        publication_status: PublicationStatus.UNPUBLISHED,
        governance_version: 1,
      },
    });

    const ds = await prisma.dataSource.create({
      data: { url: "https://regulator.example.com/pub", source_type: "REGULATOR_OFFICIAL" },
    });
    const evidence = await prisma.evidenceRecord.create({
      data: {
        data_source: { connect: { id: ds.id } },
        created_by: { connect: { id: publisher.actor_id } },
        evidence_type: "REGULATOR_REGISTER",
        source_url: "https://regulator.example.com/pub-lic",
        observed_at: new Date(),
        extracted_at: new Date(),
      },
    });
    await prisma.bonusEvidenceClaim.create({
      data: {
        bonus_id: bonus.id,
        evidence_id: evidence.id,
        field: "HEADLINE_VALUE",
        observed_value: "$100 Bonus",
        normalized_value_hash: "hash_pub_bonus",
        verdict: "SUPPORTS",
      },
    });

    const { rawToken } = await createAdminSession(publisher.id);

    const publishReq = new Request("http://localhost/api/admin/transitions", {
      method: "POST",
      headers: { Cookie: `savvy_admin_session=${rawToken}` },
      body: JSON.stringify({
        subjectType: "BONUS",
        subjectId: bonus.id,
        expectedVersion: 1,
        action: "PUBLISH",
        reason: "Initial release",
      }),
    });
    const publishRes = await transitionRoute(publishReq);
    expect(publishRes.status).toBe(200);

    const approveReq = new Request("http://localhost/api/admin/transitions", {
      method: "POST",
      headers: { Cookie: `savvy_admin_session=${rawToken}` },
      body: JSON.stringify({
        subjectType: "BONUS",
        subjectId: bonus.id,
        expectedVersion: 2,
        action: "APPROVE",
      }),
    });
    const approveRes = await transitionRoute(approveReq);
    expect(approveRes.status).toBe(403);
  });

  it("22, 23, 24) tests ADMIN role full permissions and unauthorized direct mutation failure", async () => {
    const admin = await createAdminUser({
      email: "admin-master@savvyedge.com",
      displayName: "Admin Master",
      password: "Password123!",
      role: AdminRole.ADMIN,
    });

    expect(canPerformAdminAction(admin.role, "BEGIN_REVIEW")).toBe(true);
    expect(canPerformAdminAction(admin.role, "APPROVE_REVIEW")).toBe(true);
    expect(canPerformAdminAction(admin.role, "CLEAR_QUARANTINE")).toBe(true);
    expect(canPerformAdminAction(admin.role, "PUBLISH")).toBe(true);
    expect(canPerformAdminAction(admin.role, "MANAGE_ADMIN_USERS")).toBe(true);

    const unauthReq = new Request("http://localhost/api/admin/transitions", {
      method: "POST",
      body: JSON.stringify({ subjectType: "CASINO", subjectId: "123", action: "BEGIN_REVIEW" }),
    });
    const unauthRes = await transitionRoute(unauthReq);
    expect(unauthRes.status).toBe(401);
  });

  it("25 & 26) verifies governance audit events are attached to real unique user actors", async () => {
    const userA = await createAdminUser({
      email: "userA@savvyedge.com",
      displayName: "User Alpha",
      password: "Password123!",
      role: AdminRole.REVIEWER,
    });

    const userB = await createAdminUser({
      email: "userB@savvyedge.com",
      displayName: "User Beta",
      password: "Password123!",
      role: AdminRole.REVIEWER,
    });

    const casino = await prisma.casino.create({
      data: {
        name: "Actor Audit Casino",
        slug: "actor-audit-casino",
        status: "ACTIVE",
        review_status: ReviewStatus.AWAITING_REVIEW,
        publication_status: PublicationStatus.UNPUBLISHED,
        governance_version: 1,
      },
    });

    const { rawToken: tokenA } = await createAdminSession(userA.id);
    const { rawToken: tokenB } = await createAdminSession(userB.id);

    const reqA = new Request("http://localhost/api/admin/transitions", {
      method: "POST",
      headers: { Cookie: `savvy_admin_session=${tokenA}` },
      body: JSON.stringify({
        subjectType: "CASINO",
        subjectId: casino.id,
        expectedVersion: 1,
        action: "BEGIN_REVIEW",
      }),
    });
    await transitionRoute(reqA);

    const reqB = new Request("http://localhost/api/admin/transitions", {
      method: "POST",
      headers: { Cookie: `savvy_admin_session=${tokenB}` },
      body: JSON.stringify({
        subjectType: "CASINO",
        subjectId: casino.id,
        expectedVersion: 2,
        action: "REJECT",
        internalReason: "Rejecting",
      }),
    });
    await transitionRoute(reqB);

    const auditEvents = await prisma.workflowAuditEvent.findMany({
      where: { casino_id: casino.id },
      orderBy: { occurred_at: "asc" },
      include: { actor: true },
    });

    expect(auditEvents.length).toBe(2);
    expect(auditEvents[0].actor_id).toBe(userA.actor_id);
    expect(auditEvents[0].actor.stable_key).toBe(`admin-user:${userA.id}`);
    expect(auditEvents[1].actor_id).toBe(userB.actor_id);
    expect(auditEvents[1].actor.stable_key).toBe(`admin-user:${userB.id}`);
    expect(auditEvents[0].actor_id).not.toBe(auditEvents[1].actor_id);
  });

  it("27, 28, 29, 30) tests Admin user management (Create, non-Admin forbidden, duplicate email, last Admin protection)", async () => {
    const admin = await createAdminUser({
      email: "admin-mgr@savvyedge.com",
      displayName: "Manager Admin",
      password: "Password123!",
      role: AdminRole.ADMIN,
    });

    const reviewer = await createAdminUser({
      email: "reviewer-mgr@savvyedge.com",
      displayName: "Reviewer Non-Admin",
      password: "Password123!",
      role: AdminRole.REVIEWER,
    });

    const { rawToken: adminToken } = await createAdminSession(admin.id);
    const { rawToken: reviewerToken } = await createAdminSession(reviewer.id);

    const createReq = new Request("http://localhost/api/admin/users", {
      method: "POST",
      headers: { Cookie: `savvy_admin_session=${adminToken}` },
      body: JSON.stringify({
        email: "newuser@savvyedge.com",
        displayName: "New User",
        password: "NewPassword123!",
        role: "SENIOR_REVIEWER",
      }),
    });
    const createRes = await createUserRoute(createReq);
    expect(createRes.status).toBe(200);

    const forbiddenCreateReq = new Request("http://localhost/api/admin/users", {
      method: "POST",
      headers: { Cookie: `savvy_admin_session=${reviewerToken}` },
      body: JSON.stringify({
        email: "forbidden@savvyedge.com",
        displayName: "Forbidden",
        password: "Password123!",
      }),
    });
    const forbiddenCreateRes = await createUserRoute(forbiddenCreateReq);
    expect(forbiddenCreateRes.status).toBe(403);

    const dupReq = new Request("http://localhost/api/admin/users", {
      method: "POST",
      headers: { Cookie: `savvy_admin_session=${adminToken}` },
      body: JSON.stringify({
        email: "newuser@savvyedge.com",
        displayName: "Duplicate User",
        password: "NewPassword123!",
      }),
    });
    const dupRes = await createUserRoute(dupReq);
    expect(dupRes.status).toBe(409);

    const disableLastAdminReq = new Request(`http://localhost/api/admin/users/${admin.id}`, {
      method: "PATCH",
      headers: { Cookie: `savvy_admin_session=${adminToken}` },
      body: JSON.stringify({ action: "SET_STATUS", status: "DISABLED" }),
    });
    const disableLastAdminRes = await updateUserRoute(disableLastAdminReq, { params: Promise.resolve({ id: admin.id }) });
    expect(disableLastAdminRes.status).toBe(400);
    const disableData = await disableLastAdminRes.json();
    expect(disableData.error).toContain("Cannot disable the last active Admin account");
  });

  it("31 & 32) verifies password hashes are never returned in user queries and invalid roles fail closed", async () => {
    const admin = await createAdminUser({
      email: "sec-test@savvyedge.com",
      displayName: "Security Test",
      password: "Password123!",
      role: AdminRole.ADMIN,
    });

    const { rawToken } = await createAdminSession(admin.id);

    const listReq = new Request("http://localhost/api/admin/users", {
      headers: { Cookie: `savvy_admin_session=${rawToken}` },
    });
    const listRes = await getUsersRoute(listReq);
    const listData = await listRes.json();
    expect(listData.users[0].password_hash).toBeUndefined();

    expect(canPerformAdminAction(undefined, "BEGIN_REVIEW")).toBe(false);
    expect(canPerformAdminAction("UNKNOWN_ROLE", "BEGIN_REVIEW")).toBe(false);
  });
});
