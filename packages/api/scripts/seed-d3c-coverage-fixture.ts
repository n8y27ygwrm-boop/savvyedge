/**
 * Isolated D3C coverage fixture seeder.
 *
 * Creates the smallest deterministic population that exercises the production
 * bonus coverage verifier with a non-zero population:
 *
 *   - one PUBLISHED + APPROVED + ACTIVE bonus that is fully D3C compliant;
 *   - one PUBLISHED + APPROVED + ACTIVE bonus that fails on exactly one rule,
 *     STALE_OBSERVATION, while staying READY for re-verification and
 *     CONSISTENT for publication governance.
 *
 * SAFETY: refuses to run unless the opt-in URL, DATABASE_URL and DIRECT_URL all
 * resolve to the same loopback target *and* that database is on this file's
 * explicit allow-list. Every row carries a fixed `d3cfix-` id and is inserted
 * once in a single transaction; a concurrent seed fails on the fixed IDs.
 * Committed workflow rows are append-only, so the only cleanup is
 * `--destroy-test-database`: it requires a second matching opt-in,
 * proves the live target, and drops the entire disposable database. It never
 * deletes fixture rows or disables triggers.
 *
 * The fixture is time-relative: the stale bonus is seeded one millisecond past
 * the canonical freshness window, so the compliant bonus goes stale 72h after
 * seeding. A committed fixture cannot be re-seeded: destroy and recreate its
 * disposable database before another verifier run rather than rewriting
 * historical evidence linked to append-only workflow claims.
 */

import { createHash } from "crypto";
import {
  EXTRACTION_CONTRACT_VERSION,
  bonusExtractionKey,
} from "@savvyedge/ai-agents/extraction-contract";
import { DEFAULT_BONUS_FRESHNESS_POLICY } from "../src/services/freshness.policy";
import {
  UnsafeTestDatabaseError,
  requireConfiguredIsolatedTestDatabase,
} from "../tests/helpers/isolated-test-database-guard";

const OPT_IN_VARIABLE = "SAVVYEDGE_D3C_FIXTURE_DATABASE_URL";
const DESTROY_OPT_IN_VARIABLE = "SAVVYEDGE_D3C_DESTROY_TEST_DATABASE_URL";
/**
 * The only databases this fixture may ever touch. An explicit allow-list, not a
 * pattern: the shared isolated guard would accept any loopback `*test*`
 * database, which is broader than this fixture's blast radius should be.
 */
const PERMITTED_DATABASE_NAMES = [
  "savvyedge_d3c_test",
  "savvyedge_coverage_rehearsal_test",
] as const;

const EXIT_OK = 0;
const EXIT_REFUSED = 1;

const ID = {
  actor: "d3cfix-actor",
  casino: "d3cfix-casino",
  casinoHistory: "d3cfix-casino-history",
  dataSourceA: "d3cfix-ds-a",
  dataSourceB: "d3cfix-ds-b",
  bonusCompliant: "d3cfix-bonus-compliant",
  bonusStale: "d3cfix-bonus-stale",
  evidenceA: "d3cfix-ev-a",
  evidenceB: "d3cfix-ev-b",
  claimA: "d3cfix-claim-a",
  claimB: "d3cfix-claim-b",
  pointerA: "d3cfix-ptr-a",
  pointerB: "d3cfix-ptr-b",
  workflowA: "d3cfix-wf-a",
  workflowB: "d3cfix-wf-b",
  workflowClaimA: "d3cfix-wfc-a",
  workflowClaimB: "d3cfix-wfc-b",
} as const;

const CASINO_SLUG = "d3c-fixture-operator";
const CASINO_SITE = "https://d3c-fixture-operator.test";
const SOURCE_URL_A = `${CASINO_SITE}/bonus/welcome`;
const SOURCE_URL_B = `${CASINO_SITE}/bonus/reload`;
const HEADLINE_A = "100% up to 200 on first deposit";
const HEADLINE_B = "50% reload up to 100";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function extractionKeyFor(seed: string): string {
  return bonusExtractionKey({
    snapshotLocator: `d3cfix/snapshots/${seed}.html`,
    htmlHash: sha256(`${seed}-html`),
    contentHash: sha256(`${seed}-content`),
  });
}

function log(label: string, value: string | number): void {
  console.log(` -> ${label.padEnd(32)} ${value}`);
}

async function main(): Promise<number> {
  const arguments_ = process.argv.slice(2);
  const destroyDatabase =
    arguments_.length === 1 && arguments_[0] === "--destroy-test-database";

  console.log("=================================================");
  console.log("      D3C COVERAGE FIXTURE SEEDER                ");
  console.log(
    `      mode: ${destroyDatabase ? "DESTROY TEST DATABASE" : "SEED"}`,
  );
  console.log("=================================================");

  if (arguments_.length > 0 && !destroyDatabase) {
    console.error(
      "\n[FIXTURE REFUSED] Unknown mode. Committed append-only rows cannot " +
        "be row-deleted; use --destroy-test-database on a disposable database.\n",
    );
    return EXIT_REFUSED;
  }

  const decision = requireConfiguredIsolatedTestDatabase({
    optInVariable: OPT_IN_VARIABLE,
    targets: [
      "DATABASE_URL",
      "DIRECT_URL",
      ...(destroyDatabase ? [DESTROY_OPT_IN_VARIABLE] : []),
    ],
  });
  if (decision.status !== "enabled") {
    console.error(`\n[FIXTURE REFUSED] ${decision.reason}\n`);
    return EXIT_REFUSED;
  }
  // Narrower than the shared guard: only these two named test databases qualify.
  if (
    !(PERMITTED_DATABASE_NAMES as readonly string[]).includes(
      decision.databaseName,
    )
  ) {
    console.error(
      `\n[FIXTURE REFUSED] target database is '${decision.databaseName}', ` +
        `but this fixture may only touch ${PERMITTED_DATABASE_NAMES.map(
          (name) => `'${name}'`,
        ).join(" or ")}.\n`,
    );
    return EXIT_REFUSED;
  }

  log("Target host", decision.hostname);
  log("Target database", decision.databaseName);

  const {
    prisma,
    PrismaClient,
    ActorKind,
    BonusEvidenceField,
    EvidenceType,
    EvidenceVerdict,
    GovernedSubjectType,
    PublicationStatus,
    ReviewStatus,
    WorkflowEventType,
  } = await import("@savvyedge/database");
  const { createBonusSourceOfferKey } =
    await import("../src/utils/bonus-source-identity");

  try {
    // All 17 fixed IDs, grouped by table. Seeding requires a fresh fixture;
    // database destruction requires all rows to be present.
    const fixtureCounts: Array<[string, number, number]> = [
      [
        "ReviewActor",
        1,
        await prisma.reviewActor.count({ where: { id: ID.actor } }),
      ],
      ["Casino", 1, await prisma.casino.count({ where: { id: ID.casino } })],
      [
        "CasinoHistoryEvent",
        1,
        await prisma.casinoHistoryEvent.count({
          where: { id: ID.casinoHistory },
        }),
      ],
      [
        "DataSource",
        2,
        await prisma.dataSource.count({
          where: { id: { in: [ID.dataSourceA, ID.dataSourceB] } },
        }),
      ],
      [
        "Bonus",
        2,
        await prisma.bonus.count({
          where: { id: { in: [ID.bonusCompliant, ID.bonusStale] } },
        }),
      ],
      [
        "EvidenceRecord",
        2,
        await prisma.evidenceRecord.count({
          where: { id: { in: [ID.evidenceA, ID.evidenceB] } },
        }),
      ],
      [
        "BonusEvidenceClaim",
        2,
        await prisma.bonusEvidenceClaim.count({
          where: { id: { in: [ID.claimA, ID.claimB] } },
        }),
      ],
      [
        "ActiveExtractionPointer",
        2,
        await prisma.activeExtractionPointer.count({
          where: { id: { in: [ID.pointerA, ID.pointerB] } },
        }),
      ],
      [
        "WorkflowAuditEvent",
        2,
        await prisma.workflowAuditEvent.count({
          where: { id: { in: [ID.workflowA, ID.workflowB] } },
        }),
      ],
      [
        "WorkflowEventClaim",
        2,
        await prisma.workflowEventClaim.count({
          where: { id: { in: [ID.workflowClaimA, ID.workflowClaimB] } },
        }),
      ],
    ];
    if (destroyDatabase) {
      // No row-level DELETE, UPDATE, TRUNCATE, or trigger override is cleanup.
      if (fixtureCounts.some(([, expected, actual]) => actual !== expected)) {
        console.error(
          "\n[FIXTURE REFUSED] The 17-row committed fixture is incomplete; " +
            "the disposable database was not destroyed.\n",
        );
        return EXIT_REFUSED;
      }

      const expectedUrl = new URL(decision.url);
      const expectedPort = Number(expectedUrl.port || "5432");
      const expectedRole = decodeURIComponent(expectedUrl.username);
      type ConnectionProof = {
        database_name: string;
        session_role: string;
        server_address: string | null;
        server_port: number | null;
      };
      const proofSql = `SELECT current_database()::text AS database_name,
        session_user::text AS session_role,
        host(inet_server_addr())::text AS server_address,
        inet_server_port()::int AS server_port`;
      const [targetProof] =
        await prisma.$queryRawUnsafe<ConnectionProof[]>(proofSql);
      if (
        targetProof?.database_name !== decision.databaseName ||
        targetProof.session_role !== expectedRole ||
        !["127.0.0.1", "::1"].includes(targetProof.server_address ?? "") ||
        targetProof.server_port !== expectedPort
      ) {
        console.error(
          "\n[FIXTURE REFUSED] Connected test database identity did not match the approved target" +
            ` (database=${String(targetProof?.database_name === decision.databaseName)}, ` +
            `role=${String(targetProof?.session_role === expectedRole)}, ` +
            `loopback=${String(["127.0.0.1", "::1"].includes(targetProof?.server_address ?? ""))} ` +
            `(${String(targetProof?.server_address)}), ` +
            `port=${String(targetProof?.server_port === expectedPort)}).\n`,
        );
        return EXIT_REFUSED;
      }

      // DROP DATABASE cannot target the current session's database. The
      // maintenance connection is derived from the already guarded URL, and
      // both its live identity and the full opt-in contract are checked again
      // immediately before the one destructive statement.
      await prisma.$disconnect();
      const maintenanceUrl = new URL(decision.url);
      maintenanceUrl.pathname = "/postgres";
      const maintenance = new PrismaClient({
        datasourceUrl: maintenanceUrl.toString(),
      });
      try {
        const [maintenanceProof] =
          await maintenance.$queryRawUnsafe<ConnectionProof[]>(proofSql);
        const [targetExists] = await maintenance.$queryRawUnsafe<
          Array<{ exists: boolean }>
        >(
          "SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_database WHERE datname = $1) AS exists",
          decision.databaseName,
        );
        if (
          maintenanceProof?.database_name !== "postgres" ||
          maintenanceProof.session_role !== expectedRole ||
          maintenanceProof.server_address !== targetProof.server_address ||
          maintenanceProof.server_port !== expectedPort ||
          targetExists?.exists !== true
        ) {
          console.error(
            "\n[FIXTURE REFUSED] Maintenance connection did not prove the same loopback server and target.\n",
          );
          return EXIT_REFUSED;
        }
        const rechecked = requireConfiguredIsolatedTestDatabase({
          optInVariable: OPT_IN_VARIABLE,
          targets: ["DATABASE_URL", "DIRECT_URL", DESTROY_OPT_IN_VARIABLE],
        });
        if (
          rechecked.status !== "enabled" ||
          rechecked.url !== decision.url ||
          rechecked.databaseName !== decision.databaseName
        ) {
          console.error(
            "\n[FIXTURE REFUSED] Destructive test opt-ins changed before database destruction.\n",
          );
          return EXIT_REFUSED;
        }
        const quotedName = `"${decision.databaseName.replaceAll('"', '""')}"`;
        await maintenance.$executeRawUnsafe(`DROP DATABASE ${quotedName}`);
        const [remaining] = await maintenance.$queryRawUnsafe<
          Array<{ exists: boolean }>
        >(
          "SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_database WHERE datname = $1) AS exists",
          decision.databaseName,
        );
        if (remaining?.exists !== false) {
          throw new Error(
            "Disposable fixture database still exists after DROP DATABASE",
          );
        }
        console.log("\nD3C_COVERAGE_TEST_DATABASE: DESTROYED\n");
        return EXIT_OK;
      } finally {
        await maintenance.$disconnect();
      }
    }

    if (fixtureCounts.some(([, , actual]) => actual !== 0)) {
      console.error(
        "\n[FIXTURE REFUSED] Fixed fixture rows already exist. Destroy and " +
          "recreate the disposable test database before re-seeding; " +
          "historical evidence must not be rewritten.\n",
      );
      return EXIT_REFUSED;
    }

    const seedNow = new Date();
    const observedFresh = seedNow;
    // One millisecond past the canonical window. The 72-hour value is never
    // restated here: it is read from the single freshness constant.
    const observedStale = new Date(
      seedNow.getTime() - DEFAULT_BONUS_FRESHNESS_POLICY.maxAgeMs - 1,
    );

    const keyA = extractionKeyFor("bonus-compliant");
    const keyB = extractionKeyFor("bonus-stale");
    const offerKeyA = createBonusSourceOfferKey(SOURCE_URL_A);
    const offerKeyB = createBonusSourceOfferKey(SOURCE_URL_B);

    await prisma.$transaction(async (tx) => {
      await tx.reviewActor.create({
        data: {
          id: ID.actor,
          kind: ActorKind.SYSTEM,
          stable_key: "d3cfix-system-actor",
          display_name: "D3C Fixture Seeder",
          active: true,
        },
      });

      const casinoFields = {
        slug: CASINO_SLUG,
        name: "D3C Fixture Operator",
        status: "ACTIVE",
        website_url: CASINO_SITE,
        verified_at: observedFresh,
        data_source_type: "SCRAPED",
        review_status: ReviewStatus.APPROVED,
        publication_status: PublicationStatus.PUBLISHED,
        quarantine_reason: null,
        governance_version: 1,
      };
      await tx.casino.create({
        data: { id: ID.casino, ...casinoFields },
      });

      // whereCasinoPublic() requires a history event carrying a source_url.
      const historyFields = {
        casino_id: ID.casino,
        event_type: "VERIFIED",
        description: "D3C fixture casino provenance",
        source_url: CASINO_SITE,
        occurred_at: observedFresh,
      };
      await tx.casinoHistoryEvent.create({
        data: { id: ID.casinoHistory, ...historyFields },
      });

      for (const source of [
        { id: ID.dataSourceA, url: SOURCE_URL_A },
        { id: ID.dataSourceB, url: SOURCE_URL_B },
      ]) {
        const fields = {
          url: source.url,
          normalized_url: source.url,
          source_type: "OPERATOR_PAGE",
        };
        await tx.dataSource.create({
          data: { id: source.id, ...fields },
        });
      }

      const bonuses = [
        {
          id: ID.bonusCompliant,
          headline: HEADLINE_A,
          offerKey: offerKeyA,
          observedAt: observedFresh,
          extractedAt: observedFresh,
        },
        {
          id: ID.bonusStale,
          headline: HEADLINE_B,
          offerKey: offerKeyB,
          observedAt: observedStale,
          extractedAt: observedStale,
        },
      ];
      for (const bonus of bonuses) {
        // verified_at projects observed_at exactly, so the stale bonus is
        // rejected for staleness and never for a drifted projection.
        const fields = {
          casino_id: ID.casino,
          type: "DEPOSIT_MATCH",
          headline_value: bonus.headline,
          wagering_requirement: 35,
          max_conversion: 500,
          status: "ACTIVE",
          valid_from: null,
          valid_until: null,
          verified_at: bonus.observedAt,
          data_source_type: "SCRAPED",
          source_offer_key: bonus.offerKey,
          review_status: ReviewStatus.APPROVED,
          publication_status: PublicationStatus.PUBLISHED,
          quarantine_reason: null,
          governance_version: 1,
        };
        await tx.bonus.create({
          data: { id: bonus.id, ...fields },
        });
      }

      const extractions = [
        {
          evidenceId: ID.evidenceA,
          dataSourceId: ID.dataSourceA,
          bonusId: ID.bonusCompliant,
          claimId: ID.claimA,
          pointerId: ID.pointerA,
          workflowId: ID.workflowA,
          workflowClaimId: ID.workflowClaimA,
          sourceUrl: SOURCE_URL_A,
          extractionKey: keyA,
          headline: HEADLINE_A,
          observedAt: observedFresh,
          extractedAt: observedFresh,
          seed: "bonus-compliant",
        },
        {
          evidenceId: ID.evidenceB,
          dataSourceId: ID.dataSourceB,
          bonusId: ID.bonusStale,
          claimId: ID.claimB,
          pointerId: ID.pointerB,
          workflowId: ID.workflowB,
          workflowClaimId: ID.workflowClaimB,
          sourceUrl: SOURCE_URL_B,
          extractionKey: keyB,
          headline: HEADLINE_B,
          observedAt: observedStale,
          extractedAt: observedStale,
          seed: "bonus-stale",
        },
      ];

      for (const extraction of extractions) {
        const evidenceFields = {
          data_source_id: extraction.dataSourceId,
          evidence_type: EvidenceType.OPERATOR_PAGE,
          source_url: extraction.sourceUrl,
          observed_at: extraction.observedAt,
          extracted_at: extraction.extractedAt,
          valid_from: null,
          expires_at: null,
          extraction_key: extraction.extractionKey,
          html_hash: sha256(`${extraction.seed}-html`),
          content_hash: sha256(`${extraction.seed}-content`),
          created_by_id: ID.actor,
        };
        await tx.evidenceRecord.create({
          data: { id: extraction.evidenceId, ...evidenceFields },
        });

        const claimFields = {
          evidence_id: extraction.evidenceId,
          bonus_id: extraction.bonusId,
          field: BonusEvidenceField.HEADLINE_VALUE,
          observed_value: extraction.headline,
          normalized_value_hash: sha256(extraction.headline),
          verdict: EvidenceVerdict.SUPPORTS,
        };
        await tx.bonusEvidenceClaim.create({
          data: { id: extraction.claimId, ...claimFields },
        });

        const pointerFields = {
          bonus_id: extraction.bonusId,
          extraction_context: "BONUS",
          data_source_id: extraction.dataSourceId,
          evidence_id: extraction.evidenceId,
          extraction_key: extraction.extractionKey,
          contract_version: EXTRACTION_CONTRACT_VERSION,
          activated_at: extraction.extractedAt,
        };
        await tx.activeExtractionPointer.create({
          data: { id: extraction.pointerId, ...pointerFields },
        });

        const workflowFields = {
          subject_type: GovernedSubjectType.BONUS,
          bonus_id: extraction.bonusId,
          actor_id: ID.actor,
          event_type: WorkflowEventType.PUBLISHED,
          from_review_status: ReviewStatus.APPROVED,
          to_review_status: ReviewStatus.APPROVED,
          from_publication_status: PublicationStatus.UNPUBLISHED,
          to_publication_status: PublicationStatus.PUBLISHED,
          expected_version: 0,
          resulting_version: 1,
          occurred_at: extraction.extractedAt,
        };
        // Both workflow tables are trigger-enforced append-only. The fixed-ID
        // inserts are create-only, including under concurrent seed attempts.
        await tx.workflowAuditEvent.create({
          data: { id: extraction.workflowId, ...workflowFields },
        });

        const workflowClaimFields = {
          workflow_event_id: extraction.workflowId,
          bonus_evidence_claim_id: extraction.claimId,
        };
        await tx.workflowEventClaim.create({
          data: { id: extraction.workflowClaimId, ...workflowClaimFields },
        });
      }
    });

    console.log("\n--- Seeded ---");
    log("Seed clock (UTC)", seedNow.toISOString());
    log("Compliant observed_at", observedFresh.toISOString());
    log("Stale observed_at", observedStale.toISOString());
    log("Freshness window (ms)", DEFAULT_BONUS_FRESHNESS_POLICY.maxAgeMs);
    log("Fixed fixture rows", Object.keys(ID).length);
    console.log("\nD3C_COVERAGE_FIXTURE: SEEDED\n");
    return EXIT_OK;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    if (error instanceof UnsafeTestDatabaseError) {
      console.error(`\n[FIXTURE SAFETY ERROR] ${error.message}\n`);
    } else {
      console.error("\n[FATAL] D3C fixture seeding failed:", error);
    }
    process.exit(EXIT_REFUSED);
  });
