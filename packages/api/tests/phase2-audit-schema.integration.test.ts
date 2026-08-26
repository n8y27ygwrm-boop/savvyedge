import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@savvyedge/database";
import { requireConfiguredIsolatedTestDatabase } from "./helpers/isolated-test-database-guard";

/**
 * `PHASE2_TEST_DATABASE_URL` is this suite's explicit opt-in *and* the only URL
 * it connects through, for both Prisma and `psql`. Presence alone is not
 * permission: the centralized guard validates it strictly (loopback host,
 * bounded `test` marker, no target-overriding parameters) at module scope, so an
 * explicitly configured but unsafe URL throws before any Prisma client is
 * constructed or any `psql` process is spawned. Without the opt-in only the
 * real-database describes are skipped; the migration source policy below has no
 * database dependency and stays enabled.
 */
const phase2Database = requireConfiguredIsolatedTestDatabase({
  optInVariable: "PHASE2_TEST_DATABASE_URL",
});
const databaseUrl =
  phase2Database.status === "enabled" ? phase2Database.url : undefined;
const upgradeScenario = process.env.PHASE2_UPGRADE_TEST_SCENARIO as
  | "ordinary"
  | "superseded"
  | "merged"
  | "overflow"
  | undefined;
const describePostMigration =
  databaseUrl && !upgradeScenario ? describe : describe.skip;
const describeUpgrade =
  databaseUrl && upgradeScenario ? describe : describe.skip;
const migrationPath = fileURLToPath(
  new URL(
    "../../database/prisma/migrations/20260724120000_complete_workflow_audit/migration.sql",
    import.meta.url,
  ),
);
const migrationSql = readFileSync(migrationPath, "utf8");
const executableMigrationSql = migrationSql.replace(/--.*$/gm, "");

const ids = {
  actor: "10000000-0000-4000-8000-000000000001",
  casinoA: "20000000-0000-4000-8000-000000000001",
  casinoB: "20000000-0000-4000-8000-000000000002",
  bonusA: "30000000-0000-4000-8000-000000000001",
  bonusB: "30000000-0000-4000-8000-000000000002",
  dataSource: "40000000-0000-4000-8000-000000000001",
  evidence: "50000000-0000-4000-8000-000000000001",
  casinoClaim: "60000000-0000-4000-8000-000000000001",
} as const;

type EventInput = {
  id: string;
  subjectType?: "CASINO" | "BONUS";
  casinoId?: string | null;
  bonusId?: string | null;
  eventType?: "REVIEW_STARTED" | "SUPERSEDED" | "MERGED";
  expectedVersion?: number;
  resultingVersion?: number;
  canonicalCasinoId?: string | null;
  canonicalBonusId?: string | null;
};

describe("Phase 2.2A migration policy", () => {
  it("fails before altering the table and never infers a historical target", () => {
    const historicalGuardPosition = executableMigrationSql.indexOf(
      `"event_type" IN ('SUPERSEDED', 'MERGED')`,
    );
    const firstColumnPosition = executableMigrationSql.indexOf(
      `ADD COLUMN "resulting_version"`,
    );

    expect(historicalGuardPosition).toBeGreaterThan(-1);
    expect(historicalGuardPosition).toBeLessThan(firstColumnPosition);
    expect(executableMigrationSql).not.toContain("duplicate_of_id");
    expect(executableMigrationSql).not.toMatch(
      /SET\s+"canonical_(casino|bonus|slot|license)_id"/,
    );
  });
});

describeUpgrade(
  `Phase 2.2A ${upgradeScenario ?? "unknown"} upgrade policy`,
  () => {
    let database: PrismaClient;

    const actorId = "01000000-0000-4000-8000-000000000001";
    const subjectId = "02000000-0000-4000-8000-000000000001";
    const canonicalId = "02000000-0000-4000-8000-000000000002";
    const eventId = "03000000-0000-4000-8000-000000000001";

    beforeAll(async () => {
      database = new PrismaClient({
        datasources: { db: { url: databaseUrl } },
      });

      await database.$executeRawUnsafe(
        `INSERT INTO "ReviewActor"
          ("id", "kind", "stable_key", "display_name")
         VALUES ($1, 'MIGRATION', 'migration:phase2-upgrade-test', 'Upgrade Test')`,
        actorId,
      );
      await database.$executeRawUnsafe(
        `INSERT INTO "Casino"
          ("id", "slug", "name", "status", "updated_at")
         VALUES
          ($1, 'upgrade-subject', 'Upgrade Subject', 'ACTIVE', CURRENT_TIMESTAMP),
          ($2, 'upgrade-canonical', 'Upgrade Canonical', 'ACTIVE', CURRENT_TIMESTAMP)`,
        subjectId,
        canonicalId,
      );

      if (upgradeScenario === "superseded") {
        await database.$executeRawUnsafe(
          `UPDATE "Casino"
           SET "review_status" = 'SUPERSEDED', "duplicate_of_id" = $1
           WHERE "id" = $2`,
          canonicalId,
          subjectId,
        );
      }

      const eventType =
        upgradeScenario === "superseded"
          ? "SUPERSEDED"
          : upgradeScenario === "merged"
            ? "MERGED"
            : "REVIEW_STARTED";
      const expectedVersion =
        upgradeScenario === "overflow" ? 2_147_483_647 : 4;

      await database.$executeRawUnsafe(
        `INSERT INTO "WorkflowAuditEvent" (
          "id",
          "subject_type",
          "casino_id",
          "actor_id",
          "event_type",
          "expected_version",
          "internal_note"
        ) VALUES (
          $1,
          'CASINO',
          $2,
          $3,
          $4::"WorkflowEventType",
          $5,
          'pre-amendment row'
        )`,
        eventId,
        subjectId,
        actorId,
        eventType,
        expectedVersion,
      );
    });

    afterAll(async () => {
      await database?.$disconnect();
    });

    it("applies only safe ordinary history and rolls every unsafe case back completely", async () => {
      const applyMigration = () =>
        execFileSync(
          "psql",
          [databaseUrl!, "-v", "ON_ERROR_STOP=1", "-f", migrationPath],
          { encoding: "utf8", stdio: "pipe" },
        );

      if (upgradeScenario === "ordinary") {
        expect(applyMigration).not.toThrow();

        const rows = await database.$queryRawUnsafe<
          Array<{
            expected_version: number;
            resulting_version: number;
            canonical_casino_id: string | null;
            canonical_bonus_id: string | null;
            canonical_slot_id: string | null;
            canonical_license_id: string | null;
          }>
        >(
          `SELECT
            "expected_version",
            "resulting_version",
            "canonical_casino_id",
            "canonical_bonus_id",
            "canonical_slot_id",
            "canonical_license_id"
           FROM "WorkflowAuditEvent"
           WHERE "id" = $1`,
          eventId,
        );
        expect(rows).toEqual([
          {
            expected_version: 4,
            resulting_version: 5,
            canonical_casino_id: null,
            canonical_bonus_id: null,
            canonical_slot_id: null,
            canonical_license_id: null,
          },
        ]);
        return;
      }

      expect(applyMigration).toThrow();

      const addedColumns = await database.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) AS count
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'WorkflowAuditEvent'
           AND column_name IN (
             'resulting_version',
             'canonical_casino_id',
             'canonical_bonus_id',
             'canonical_slot_id',
             'canonical_license_id'
           )`,
      );
      expect(addedColumns[0]?.count).toBe(0n);

      const rows = await database.$queryRawUnsafe<
        Array<{
          expected_version: number;
          internal_note: string | null;
          duplicate_of_id: string | null;
        }>
      >(
        `SELECT
          event."expected_version",
          event."internal_note",
          subject."duplicate_of_id"
         FROM "WorkflowAuditEvent" AS event
         JOIN "Casino" AS subject ON subject."id" = event."casino_id"
         WHERE event."id" = $1`,
        eventId,
      );
      expect(rows).toEqual([
        {
          expected_version:
            upgradeScenario === "overflow" ? 2_147_483_647 : 4,
          internal_note: "pre-amendment row",
          duplicate_of_id:
            upgradeScenario === "superseded" ? canonicalId : null,
        },
      ]);

      const triggerState = await database.$queryRawUnsafe<
        Array<{ tgenabled: string }>
      >(
        `SELECT "tgenabled"::text
         FROM "pg_trigger"
         WHERE "tgrelid" = '"WorkflowAuditEvent"'::regclass
           AND "tgname" = 'WorkflowAuditEvent_append_only'`,
      );
      expect(triggerState).toEqual([{ tgenabled: "O" }]);

      await expect(
        database.$executeRawUnsafe(
          `INSERT INTO "WorkflowAuditEvent" (
            "id",
            "subject_type",
            "casino_id",
            "actor_id",
            "event_type",
            "expected_version"
          ) VALUES (
            '03000000-0000-4000-8000-000000000002',
            'CASINO',
            $1,
            $2,
            'REVIEW_STARTED',
            0
          )`,
          canonicalId,
          actorId,
        ),
      ).resolves.toBe(1);
    });
  },
  30_000,
);

describePostMigration(
  "Phase 2.2A workflow audit database integrity",
  () => {
    let database: PrismaClient;

    const insertEvent = async ({
      id,
      subjectType = "CASINO",
      casinoId = ids.casinoA,
      bonusId = null,
      eventType = "REVIEW_STARTED",
      expectedVersion = 0,
      resultingVersion = 1,
      canonicalCasinoId = null,
      canonicalBonusId = null,
    }: EventInput) =>
      database.$executeRawUnsafe(
        `INSERT INTO "WorkflowAuditEvent" (
          "id",
          "subject_type",
          "casino_id",
          "bonus_id",
          "actor_id",
          "event_type",
          "expected_version",
          "resulting_version",
          "canonical_casino_id",
          "canonical_bonus_id"
        ) VALUES (
          $1,
          $2::"GovernedSubjectType",
          $3,
          $4,
          $5,
          $6::"WorkflowEventType",
          $7,
          $8,
          $9,
          $10
        )`,
        id,
        subjectType,
        casinoId,
        bonusId,
        ids.actor,
        eventType,
        expectedVersion,
        resultingVersion,
        canonicalCasinoId,
        canonicalBonusId,
      );

    beforeAll(async () => {
      database = new PrismaClient({
        datasources: { db: { url: databaseUrl } },
      });

      await database.$executeRawUnsafe(
        `INSERT INTO "ReviewActor"
          ("id", "kind", "stable_key", "display_name")
         VALUES ($1, 'SYSTEM', 'system:phase2-audit-test', 'Audit Test')`,
        ids.actor,
      );

      await database.$executeRawUnsafe(
        `INSERT INTO "Casino"
          ("id", "slug", "name", "status", "updated_at")
         VALUES
          ($1, 'audit-casino-a', 'Audit Casino A', 'ACTIVE', CURRENT_TIMESTAMP),
          ($2, 'audit-casino-b', 'Audit Casino B', 'ACTIVE', CURRENT_TIMESTAMP)`,
        ids.casinoA,
        ids.casinoB,
      );

      await database.$executeRawUnsafe(
        `INSERT INTO "Bonus"
          ("id", "casino_id", "type", "status")
         VALUES
          ($1, $3, 'WELCOME', 'ACTIVE'),
          ($2, $4, 'WELCOME', 'ACTIVE')`,
        ids.bonusA,
        ids.bonusB,
        ids.casinoA,
        ids.casinoB,
      );

      await database.$executeRawUnsafe(
        `INSERT INTO "DataSource" ("id", "url", "source_type")
         VALUES ($1, 'https://audit.example/source', 'TEST')`,
        ids.dataSource,
      );

      await database.$executeRawUnsafe(
        `INSERT INTO "EvidenceRecord" (
          "id",
          "data_source_id",
          "evidence_type",
          "source_url",
          "observed_at",
          "extracted_at",
          "created_by_id"
        ) VALUES (
          $1,
          $2,
          'OPERATOR_PAGE',
          'https://audit.example/source',
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP,
          $3
        )`,
        ids.evidence,
        ids.dataSource,
        ids.actor,
      );

      await database.$executeRawUnsafe(
        `INSERT INTO "CasinoEvidenceClaim" (
          "id",
          "evidence_id",
          "casino_id",
          "field",
          "observed_value",
          "normalized_value_hash",
          "verdict"
        ) VALUES (
          $1,
          $2,
          $3,
          'NAME',
          'Audit Casino A',
          'normalizer-v1:audit-casino-a',
          'SUPPORTS'
        )`,
        ids.casinoClaim,
        ids.evidence,
        ids.casinoA,
      );
    });

    afterAll(async () => {
      await database?.$disconnect();
    });

    it("stores expected and resulting versions on a valid insert", async () => {
      const eventId = "70000000-0000-4000-8000-000000000001";

      await expect(insertEvent({ id: eventId })).resolves.toBe(1);

      const rows = await database.$queryRawUnsafe<
        Array<{ expected_version: number; resulting_version: number }>
      >(
        `SELECT "expected_version", "resulting_version"
         FROM "WorkflowAuditEvent"
         WHERE "id" = $1`,
        eventId,
      );
      expect(rows).toEqual([{ expected_version: 0, resulting_version: 1 }]);
    });

    it("rejects a resulting version other than expected version plus one", async () => {
      await expect(
        insertEvent({
          id: "70000000-0000-4000-8000-000000000002",
          expectedVersion: 4,
          resultingVersion: 6,
        }),
      ).rejects.toThrow(/WorkflowAuditEvent_version_increment_check/);
    });

    it("accepts SUPERSEDED and MERGED only with a correct same-type canonical target", async () => {
      await expect(
        insertEvent({
          id: "70000000-0000-4000-8000-000000000003",
          eventType: "SUPERSEDED",
          canonicalCasinoId: ids.casinoB,
        }),
      ).resolves.toBe(1);

      await expect(
        insertEvent({
          id: "70000000-0000-4000-8000-000000000004",
          subjectType: "BONUS",
          casinoId: null,
          bonusId: ids.bonusA,
          eventType: "MERGED",
          canonicalBonusId: ids.bonusB,
        }),
      ).resolves.toBe(1);
    });

    it("rejects SUPERSEDED or MERGED without a canonical target", async () => {
      await expect(
        insertEvent({
          id: "70000000-0000-4000-8000-000000000005",
          eventType: "SUPERSEDED",
        }),
      ).rejects.toThrow(/WorkflowAuditEvent_canonical_cardinality_check/);
    });

    it("rejects a canonical target of the wrong subject type", async () => {
      await expect(
        insertEvent({
          id: "70000000-0000-4000-8000-000000000006",
          eventType: "MERGED",
          canonicalBonusId: ids.bonusB,
        }),
      ).rejects.toThrow(/WorkflowAuditEvent_canonical_type_check/);
    });

    it("rejects missing, multiple, or mismatched subjects", async () => {
      await expect(
        insertEvent({
          id: "70000000-0000-4000-8000-000000000012",
          casinoId: null,
        }),
      ).rejects.toThrow(/WorkflowAuditEvent_one_subject_check/);
      await expect(
        insertEvent({
          id: "70000000-0000-4000-8000-000000000013",
          bonusId: ids.bonusA,
        }),
      ).rejects.toThrow(/WorkflowAuditEvent_one_subject_check/);
      await expect(
        insertEvent({
          id: "70000000-0000-4000-8000-000000000014",
          subjectType: "BONUS",
          casinoId: ids.casinoA,
          bonusId: null,
        }),
      ).rejects.toThrow(/WorkflowAuditEvent_subject_type_check/);
    });

    it("rejects a nonexistent canonical foreign key", async () => {
      await expect(
        insertEvent({
          id: "70000000-0000-4000-8000-000000000015",
          eventType: "SUPERSEDED",
          canonicalCasinoId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        }),
      ).rejects.toThrow(/WorkflowAuditEvent_canonical_casino_id_fkey/);
    });

    it("rejects multiple canonical targets", async () => {
      await expect(
        insertEvent({
          id: "70000000-0000-4000-8000-000000000007",
          eventType: "SUPERSEDED",
          canonicalCasinoId: ids.casinoB,
          canonicalBonusId: ids.bonusB,
        }),
      ).rejects.toThrow(/WorkflowAuditEvent_canonical_cardinality_check/);
    });

    it("rejects self-targeting", async () => {
      await expect(
        insertEvent({
          id: "70000000-0000-4000-8000-000000000008",
          eventType: "SUPERSEDED",
          canonicalCasinoId: ids.casinoA,
        }),
      ).rejects.toThrow(/WorkflowAuditEvent_no_self_canonical_check/);
    });

    it("rejects canonical targets on ordinary events", async () => {
      await expect(
        insertEvent({
          id: "70000000-0000-4000-8000-000000000009",
          canonicalCasinoId: ids.casinoB,
        }),
      ).rejects.toThrow(/WorkflowAuditEvent_canonical_cardinality_check/);
    });

    it("blocks WorkflowAuditEvent UPDATE and DELETE after allowing INSERT", async () => {
      const eventId = "70000000-0000-4000-8000-000000000010";
      await expect(insertEvent({ id: eventId })).resolves.toBe(1);

      await expect(
        database.$executeRawUnsafe(
          `UPDATE "WorkflowAuditEvent"
           SET "internal_note" = 'mutated'
           WHERE "id" = $1`,
          eventId,
        ),
      ).rejects.toThrow(/append-only/);
      await expect(
        database.$executeRawUnsafe(
          `DELETE FROM "WorkflowAuditEvent" WHERE "id" = $1`,
          eventId,
        ),
      ).rejects.toThrow(/append-only/);
    });

    it("keeps WorkflowEventClaim INSERT-only", async () => {
      const eventId = "70000000-0000-4000-8000-000000000011";
      const linkId = "80000000-0000-4000-8000-000000000001";
      await insertEvent({ id: eventId });

      await expect(
        database.$executeRawUnsafe(
          `INSERT INTO "WorkflowEventClaim" (
            "id",
            "workflow_event_id",
            "casino_evidence_claim_id"
          ) VALUES ($1, $2, $3)`,
          linkId,
          eventId,
          ids.casinoClaim,
        ),
      ).resolves.toBe(1);
      await expect(
        database.$executeRawUnsafe(
          `UPDATE "WorkflowEventClaim"
           SET "casino_evidence_claim_id" = $1
           WHERE "id" = $2`,
          ids.casinoClaim,
          linkId,
        ),
      ).rejects.toThrow(/append-only/);
      await expect(
        database.$executeRawUnsafe(
          `DELETE FROM "WorkflowEventClaim" WHERE "id" = $1`,
          linkId,
        ),
      ).rejects.toThrow(/append-only/);
    });
  },
  30_000,
);
