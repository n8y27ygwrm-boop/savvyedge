import { describe, expect, it, vi } from "vitest";
import type { ProductionCoverageApprovedTarget } from "../src/constants/production-coverage-approved-target";

const TEST_SECURITY = vi.hoisted(() => {
  const auditor = "savvyedge_coverage_auditor";
  const database = "savvyedge_coverage_test";
  return {
    auditor,
    database,
    approvedTarget: {
      endpoints: [
        {
          hostname: "127.0.0.1",
          port: 5432,
          routingUsername: "savvyedge_coverage_router",
        },
      ],
      database,
      role: auditor,
    },
  };
});

vi.mock("../src/constants/production-coverage-approved-target", () => ({
  APPROVED_PRODUCTION_COVERAGE_TARGET: TEST_SECURITY.approvedTarget,
}));

import {
  COVERAGE_SCAN_TRANSACTION_OPTIONS,
  CoverageAuditConnectionRefusedError,
  auditPopulationWhere,
  coverageBonusSelect,
  legacySourceSelect,
  resolveSourceClassification,
  scanProductionBonusCoverage,
  toCoverageInput,
  type CoverageScanClient,
  type CoverageScanRunner,
} from "../src/services/production-bonus-coverage.loader";
import {
  CURRENT_DATABASE_SQL,
  CURRENT_ROLE_SQL,
  ROLE_ATTRIBUTES_SQL,
  SCHEMA_CREATE_SQL,
  SESSION_READ_ONLY_SQL,
  WRITABLE_TABLES_SQL,
  PRODUCTION_MODE_ROLE_VARIABLE,
  PRODUCTION_MODE_URL_VARIABLE,
  proveAuthorizedReadOnlyConnection,
  resolveCoverageAuditMode,
  type ProductionCoverageAuditAuthorization,
} from "../src/services/production-readonly-connection.guard";
import { DEFAULT_BONUS_FRESHNESS_POLICY } from "../src/services/freshness.policy";
import { EXCLUDED_DATA_SOURCES } from "../src/services/publication-gate.service";
import { createBonusSourceOfferKey } from "../src/utils/bonus-source-identity";
import { activeBonusEvidence } from "./helpers/active-bonus-evidence.fixture";

const AUDIT_NOW = new Date("2026-08-10T12:00:00.000Z");
const SOURCE_URL = "https://operator.example.test/bonus-terms";
const AUDITOR = TEST_SECURITY.auditor;
const DATABASE = TEST_SECURITY.database;
const APPROVED_TARGET =
  TEST_SECURITY.approvedTarget satisfies ProductionCoverageApprovedTarget;

function productionAuthorization(): ProductionCoverageAuditAuthorization {
  const selected = resolveCoverageAuditMode({
    [PRODUCTION_MODE_URL_VARIABLE]: `postgresql://savvyedge_coverage_router:secret@127.0.0.1:5432/${DATABASE}`,
    [PRODUCTION_MODE_ROLE_VARIABLE]: AUDITOR,
  });
  if (selected.mode !== "production-readonly") {
    throw new Error("Expected isolated approved production test target");
  }
  return selected.authorization;
}

function compliantProofAnswers(): Record<string, unknown> {
  return {
    [SESSION_READ_ONLY_SQL]: [{ transaction_read_only: "on" }],
    [CURRENT_ROLE_SQL]: [{ current_role: AUDITOR, session_role: AUDITOR }],
    [WRITABLE_TABLES_SQL]: [{ writable_tables: 0 }],
    [ROLE_ATTRIBUTES_SQL]: [
      { has_superuser: false, has_bypassrls: false, has_escalation: false },
    ],
    [SCHEMA_CREATE_SQL]: [{ can_create: false }],
    [CURRENT_DATABASE_SQL]: [{ database_name: DATABASE }],
  };
}

/**
 * An in-memory stand-in for the Prisma client. It records every call so the
 * tests can prove the scan issues reads only, and it exposes no write methods
 * at all — a mutation attempt would be a TypeError, not a silent success.
 */
function memoryRunner(
  rows: any[],
  legacyRows: any[] = [],
  proofAnswers: Record<string, unknown> = {},
) {
  const calls: Array<{ method: string; args: any }> = [];
  let transactionOptions: Record<string, unknown> | undefined;

  const client: CoverageScanClient = {
    async $queryRawUnsafe<T>(query: string): Promise<T> {
      calls.push({ method: "probe", args: query });
      return proofAnswers[query] as T;
    },
    bonus: {
      async count(args: any) {
        calls.push({ method: "count", args });
        return rows.length;
      },
      async findMany(args: any) {
        calls.push({ method: "findMany", args });
        if (args?.where?.id?.in) {
          const wanted = new Set(args.where.id.in);
          return legacyRows.filter((row) => wanted.has(row.id));
        }
        const ordered = [...rows].sort((left, right) =>
          String(left.id).localeCompare(String(right.id)),
        );
        const start = args?.cursor?.id
          ? ordered.findIndex((row) => row.id === args.cursor.id) +
            (args.skip ?? 0)
          : 0;
        return ordered.slice(start, start + (args?.take ?? ordered.length));
      },
    },
  };

  const runner: CoverageScanRunner = {
    async $transaction(handler, options) {
      transactionOptions = options;
      return handler(client);
    },
  };

  return {
    runner,
    calls,
    get transactionOptions() {
      return transactionOptions;
    },
  };
}

function compliantRow(id: string, observedAt: Date = AUDIT_NOW) {
  return {
    id,
    verified_at: observedAt,
    source_offer_key: createBonusSourceOfferKey(SOURCE_URL),
    active_extractions: activeBonusEvidence({
      bonusId: id,
      observedAt,
      extractedAt: AUDIT_NOW,
      sourceUrl: SOURCE_URL,
    }),
    workflow_events: [
      {
        id: `event-${id}`,
        evidence_claims: [
          {
            bonus_evidence_claim: {
              id: `claim-${id}`,
              bonus_id: id,
              verdict: "SUPPORTS",
              evidence_id: `evidence-active-${id}`,
            },
          },
        ],
      },
    ],
  };
}

describe("production Bonus coverage population predicate", () => {
  it("selects the claimed-live population without any freshness prefilter", () => {
    const where: any = auditPopulationWhere();

    expect(where).toMatchObject({
      publication_status: "PUBLISHED",
      review_status: "APPROVED",
      status: "ACTIVE",
      quarantine_reason: null,
    });
    // Item 2: the canonical excluded-source list, consumed directly.
    expect(where.data_source_type).toEqual({ notIn: EXCLUDED_DATA_SOURCES });
    expect(EXCLUDED_DATA_SOURCES).toContain("DEV_MOCK");
    expect(where.casino).toBeDefined();

    // The audit measures these; including them would pre-filter away every
    // non-compliant bonus and report 100% compliance by construction.
    expect(where.verified_at).toBeUndefined();
    expect(where.active_extractions).toBeUndefined();
    expect(where.history_events).toBeUndefined();
    expect(where.OR).toBeUndefined();
  });

  it("loads only the relations the evaluator and audit need", () => {
    const select: any = coverageBonusSelect();
    const evidenceSelect =
      select.active_extractions.select.evidence.select.bonus_claims.select;

    expect(Object.keys(select).sort()).toEqual([
      "active_extractions",
      "id",
      "source_offer_key",
      "verified_at",
      "workflow_events",
    ]);
    // Claim payloads are governance internals and must never be read.
    expect(evidenceSelect).toEqual({ bonus_id: true, verdict: true });
    expect(evidenceSelect.observed_value).toBeUndefined();
    expect(evidenceSelect.normalized_value_hash).toBeUndefined();
    expect(select.active_extractions.select.evidence.select.scrape_job).toEqual(
      {
        select: {
          id: true,
          data_source_id: true,
          canonical_url: true,
        },
      },
    );
  });

  it("filters legacy history without truncating the candidate set", () => {
    const select: any = legacySourceSelect();
    expect(select.history_events.where).toEqual({
      field_changed: "verified_at",
    });
    expect(select.history_events.take).toBeUndefined();
    expect(select.evidence_claims.take).toBeUndefined();
  });
});

describe("production Bonus coverage source classification", () => {
  it("classifies a single BONUS pointer as ACTIVE_POINTER with a derived key", () => {
    const row = compliantRow("bonus-active");
    const resolved = resolveSourceClassification(row, undefined);

    expect(resolved.sourceResolution).toBe("ACTIVE_POINTER");
    expect(resolved.resolvedCanonicalSourceOfferKey).toBe(
      createBonusSourceOfferKey(SOURCE_URL),
    );
  });

  it("classifies linked canonical provenance when the requested evidence URL differs", () => {
    const canonicalUrl = SOURCE_URL;
    const row = compliantRow("bonus-canonical-redirect");
    row.active_extractions = activeBonusEvidence({
      bonusId: row.id,
      observedAt: AUDIT_NOW,
      sourceUrl: "https://operator.example.test/go/bonus-terms",
      scrapeJobId: "scrape-canonical-redirect",
      canonicalUrl,
    });

    expect(resolveSourceClassification(row, undefined)).toEqual({
      sourceResolution: "ACTIVE_POINTER",
      resolvedCanonicalSourceOfferKey: createBonusSourceOfferKey(canonicalUrl),
    });
  });

  it("treats multiple pointers as UNRESOLVED rather than guessing", () => {
    const row = compliantRow("bonus-ambiguous");
    row.active_extractions = [
      ...row.active_extractions,
      ...activeBonusEvidence({
        bonusId: "bonus-ambiguous",
        observedAt: AUDIT_NOW,
        evidenceId: "evidence-second",
        extractionKey: "extraction-second",
      }),
    ];

    expect(resolveSourceClassification(row, undefined)).toEqual({
      sourceResolution: "UNRESOLVED",
      resolvedCanonicalSourceOfferKey: undefined,
    });
  });

  it("uses LEGACY_EVIDENCE only when the canonical legacy path yields a URL", () => {
    const key = createBonusSourceOfferKey(SOURCE_URL);
    const row = {
      id: "bonus-legacy",
      verified_at: AUDIT_NOW,
      source_offer_key: key,
      active_extractions: [],
      workflow_events: [],
    };
    const legacyRow = {
      id: "bonus-legacy",
      source_offer_key: key,
      evidence_claims: [
        {
          id: "claim-legacy",
          verdict: "SUPPORTS",
          created_at: AUDIT_NOW,
          evidence: {
            id: "evidence-legacy",
            source_url: SOURCE_URL,
            observed_at: AUDIT_NOW,
            extracted_at: AUDIT_NOW,
          },
        },
      ],
      history_events: [],
    };

    expect(resolveSourceClassification(row, legacyRow)).toEqual({
      sourceResolution: "LEGACY_EVIDENCE",
      resolvedCanonicalSourceOfferKey: key,
    });
  });

  it("falls back to UNRESOLVED when a pointerless bonus has no usable identity", () => {
    const row = {
      id: "bonus-orphan",
      verified_at: AUDIT_NOW,
      source_offer_key: null,
      active_extractions: [],
      workflow_events: [],
    };
    const legacyRow = {
      id: "bonus-orphan",
      source_offer_key: null,
      evidence_claims: [],
      history_events: [],
    };

    expect(resolveSourceClassification(row, legacyRow).sourceResolution).toBe(
      "UNRESOLVED",
    );
  });
});

describe("production Bonus coverage governance input", () => {
  it("derives activeEvidenceAvailable structurally, not from freshness", () => {
    // A stale observation: freshness fails, but the evidence row still exists,
    // so governance must remain assessable.
    const stale = compliantRow(
      "bonus-stale",
      new Date(AUDIT_NOW.getTime() - 10 * 24 * 60 * 60 * 1000),
    );
    const input = toCoverageInput(stale, undefined);

    expect(input.publicationGovernance.activeEvidenceAvailable).toBe(true);
    expect(input.publicationGovernance.currentPublicationEventAvailable).toBe(
      true,
    );
  });

  it("reports a claim bound to superseded evidence as not active", () => {
    const row = compliantRow("bonus-superseded");
    row.workflow_events[0].evidence_claims[0].bonus_evidence_claim.evidence_id =
      "evidence-historical";

    const input = toCoverageInput(row, undefined);
    expect(input.publicationGovernance.reliedUponClaims).toEqual([
      {
        subjectBonusIdMatches: true,
        verdict: "SUPPORTS",
        resolvesToActiveEvidence: false,
      },
    ]);
  });
});

describe("production Bonus coverage scan", () => {
  it("proves the approved identity on the exact transaction before reading the population", async () => {
    const memory = memoryRunner(
      [compliantRow("bonus-attested")],
      [],
      compliantProofAnswers(),
    );

    const report = await scanProductionBonusCoverage({
      auditNow: AUDIT_NOW,
      mode: "production-readonly",
      authorization: productionAuthorization(),
      db: memory.runner,
    });

    expect(memory.calls.map((call) => call.method)).toEqual([
      "probe",
      "probe",
      "probe",
      "probe",
      "probe",
      "probe",
      "count",
      "findMany",
    ]);
    expect(
      memory.calls
        .filter((call) => call.method === "probe")
        .map((call) => call.args),
    ).toEqual([
      SESSION_READ_ONLY_SQL,
      CURRENT_ROLE_SQL,
      WRITABLE_TABLES_SQL,
      ROLE_ATTRIBUTES_SQL,
      SCHEMA_CREATE_SQL,
      CURRENT_DATABASE_SQL,
    ]);
    expect(report.connectionAttestation).toBe("EXACT_TRANSACTION_PROVEN");
  });

  it("rejects a caller-constructed production authorization before population reads", async () => {
    const memory = memoryRunner(
      [compliantRow("bonus-must-not-be-read")],
      [],
      compliantProofAnswers(),
    );
    const forged = {
      kind: "PRODUCTION_COVERAGE_AUDIT_AUTHORIZATION",
    } as ProductionCoverageAuditAuthorization;

    await expect(
      scanProductionBonusCoverage({
        auditNow: AUDIT_NOW,
        mode: "production-readonly",
        authorization: forged,
        db: memory.runner,
      }),
    ).rejects.toMatchObject({
      name: "CoverageAuditConnectionRefusedError",
      failedCheck: "TARGET_DATABASE",
    });
    expect(memory.calls).toEqual([]);
  });

  it.each([
    [
      "database changes",
      CURRENT_DATABASE_SQL,
      [{ database_name: "unintended_test" }],
      "TARGET_DATABASE",
    ],
    [
      "current role changes",
      CURRENT_ROLE_SQL,
      [{ current_role: "other_auditor", session_role: AUDITOR }],
      "CURRENT_ROLE",
    ],
    [
      "session role changes",
      CURRENT_ROLE_SQL,
      [{ current_role: AUDITOR, session_role: "other_auditor" }],
      "CURRENT_ROLE",
    ],
    [
      "transaction becomes read-write",
      SESSION_READ_ONLY_SQL,
      [{ transaction_read_only: "off" }],
      "SESSION_READ_ONLY",
    ],
  ])(
    "aborts before any population read when the transaction %s",
    async (_label, statement, answer, failedCheck) => {
      const initialAnswers = compliantProofAnswers();
      const initial = memoryRunner([], [], initialAnswers);
      const authorization = productionAuthorization();
      const initialProof = await initial.runner.$transaction((tx) =>
        proveAuthorizedReadOnlyConnection(tx, authorization),
      );
      expect(initialProof.proven).toBe(true);

      const transactionAnswers = compliantProofAnswers();
      transactionAnswers[statement] = answer;
      const transaction = memoryRunner(
        [compliantRow("bonus-must-not-be-read")],
        [],
        transactionAnswers,
      );

      let thrown: unknown;
      try {
        await scanProductionBonusCoverage({
          auditNow: AUDIT_NOW,
          mode: "production-readonly",
          authorization,
          db: transaction.runner,
        });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(CoverageAuditConnectionRefusedError);
      expect(thrown).toMatchObject({ failedCheck });
      expect(
        transaction.calls.some(
          (call) => call.method === "count" || call.method === "findMany",
        ),
      ).toBe(false);
    },
  );

  it("reads a consistent snapshot and issues no mutations", async () => {
    const memory = memoryRunner([
      compliantRow("bonus-a"),
      compliantRow("bonus-b"),
    ]);

    const report = await scanProductionBonusCoverage({
      auditNow: AUDIT_NOW,
      mode: "isolated",
      db: memory.runner,
      pageSize: 50,
    });

    // Explicit bounds: Prisma's 5s default interactive-transaction timeout
    // would abort a production-scale scan mid-flight.
    expect(memory.transactionOptions).toEqual({
      isolationLevel: "RepeatableRead",
      maxWait: 10_000,
      timeout: 900_000,
    });
    expect(memory.calls.map((call) => call.method).sort()).toEqual([
      "count",
      "findMany",
    ]);
    expect(report.population).toBe(2);
    expect(report.connectionAttestation).toBe("ISOLATED_MODE_NOT_ATTESTED");
    expect(report.scanned).toBe(2);
    expect(report.reconciliation.valid).toBe(true);
    expect(report.fullyCompliant).toBe(true);
    expect(report.activeObservation.compliant).toBe(2);
  });

  it("declares the scan transaction bounds once and reports them", async () => {
    expect(COVERAGE_SCAN_TRANSACTION_OPTIONS).toEqual({
      isolationLevel: "RepeatableRead",
      maxWait: 10_000,
      timeout: 900_000,
    });

    const memory = memoryRunner([compliantRow("bonus-tx")]);
    const report = await scanProductionBonusCoverage({
      auditNow: AUDIT_NOW,
      mode: "isolated",
      db: memory.runner,
    });

    // The reported limits are the ones actually handed to $transaction, so a
    // rehearsal measures against the bounds in force rather than assumed ones.
    expect(report.scanTransaction).toEqual({
      isolationLevel: "RepeatableRead",
      maxWaitMs: 10_000,
      timeoutMs: 900_000,
    });
    expect(memory.transactionOptions).toBe(COVERAGE_SCAN_TRANSACTION_OPTIONS);
  });

  it("pages deterministically and still reconciles", async () => {
    const rows = ["a", "b", "c", "d", "e"].map((suffix) =>
      compliantRow(`bonus-${suffix}`),
    );
    const memory = memoryRunner(rows);

    const report = await scanProductionBonusCoverage({
      auditNow: AUDIT_NOW,
      mode: "isolated",
      db: memory.runner,
      pageSize: 2,
    });

    expect(report.pagesScanned).toBeGreaterThan(1);
    expect(report.scanned).toBe(5);
    expect(report.reconciliation.valid).toBe(true);
  });

  it("counts a non-compliant bonus under its exact canonical code", async () => {
    const stale = compliantRow(
      "bonus-stale",
      new Date(AUDIT_NOW.getTime() - 10 * 24 * 60 * 60 * 1000),
    );
    const report = await scanProductionBonusCoverage({
      auditNow: AUDIT_NOW,
      mode: "isolated",
      db: memoryRunner([stale]).runner,
    });

    expect(report.activeObservation.nonCompliant).toBe(1);
    expect(
      report.activeObservation.primaryFailureCounts.STALE_OBSERVATION,
    ).toBe(1);
    expect(report.reconciliation.valid).toBe(true);
    expect(report.fullyCompliant).toBe(false);
  });

  it("counts a matching malformed extraction identity as non-compliant", async () => {
    const malformed = compliantRow("bonus-malformed-identity");
    malformed.active_extractions[0].extraction_key = "active-extraction";
    malformed.active_extractions[0].evidence!.extraction_key =
      "active-extraction";

    const report = await scanProductionBonusCoverage({
      auditNow: AUDIT_NOW,
      mode: "isolated",
      db: memoryRunner([malformed]).runner,
    });

    expect(report.activeObservation.compliant).toBe(0);
    expect(report.activeObservation.nonCompliant).toBe(1);
    expect(
      report.activeObservation.primaryFailureCounts.INVALID_EXTRACTION_IDENTITY,
    ).toBe(1);
    expect(report.reconciliation.valid).toBe(true);
    expect(report.fullyCompliant).toBe(false);
  });

  it("reports the full canonical rejection-code histogram including zeros", async () => {
    const report = await scanProductionBonusCoverage({
      auditNow: AUDIT_NOW,
      mode: "isolated",
      db: memoryRunner([compliantRow("bonus-only")]).runner,
    });

    expect(
      Object.keys(report.activeObservation.primaryFailureCounts).sort(),
    ).toEqual([
      "ACTIVE_EVIDENCE_MISMATCH",
      "AMBIGUOUS_ACTIVE_POINTER",
      "EXPIRED_EVIDENCE",
      "FUTURE_OBSERVATION",
      "INVALID_EVIDENCE_SOURCE",
      "INVALID_EXTRACTION_IDENTITY",
      "INVALID_OBSERVATION",
      "MISSING_ACTIVE_EVIDENCE",
      "MISSING_ACTIVE_POINTER",
      "MISSING_SUPPORTING_CLAIM",
      "PREMATURE_EVIDENCE",
      "PROJECTION_MISMATCH",
      "STALE_OBSERVATION",
    ]);
  });

  it("honours an explicit non-default freshness window", async () => {
    // Observed two hours ago: fresh under the 72h default, stale under 1h.
    const twoHoursAgo = new Date(AUDIT_NOW.getTime() - 2 * 60 * 60 * 1000);
    const row = compliantRow("bonus-window", twoHoursAgo);

    const underDefault = await scanProductionBonusCoverage({
      auditNow: AUDIT_NOW,
      mode: "isolated",
      db: memoryRunner([row]).runner,
    });
    const underShortWindow = await scanProductionBonusCoverage({
      auditNow: AUDIT_NOW,
      mode: "isolated",
      policy: { maxAgeMs: 60 * 60 * 1000 },
      db: memoryRunner([row]).runner,
    });

    expect(underDefault.activeObservation.compliant).toBe(1);
    expect(underDefault.freshnessMaxAgeMs).toBe(
      DEFAULT_BONUS_FRESHNESS_POLICY.maxAgeMs,
    );

    expect(underShortWindow.activeObservation.nonCompliant).toBe(1);
    expect(
      underShortWindow.activeObservation.primaryFailureCounts.STALE_OBSERVATION,
    ).toBe(1);
    // The report states the window it actually measured, not the default.
    expect(underShortWindow.freshnessMaxAgeMs).toBe(60 * 60 * 1000);
    expect(underShortWindow.reconciliation.valid).toBe(true);
  });

  it("is byte-identical whether the default policy is omitted or stated", async () => {
    const row = compliantRow("bonus-default-equivalence");

    const omitted = await scanProductionBonusCoverage({
      auditNow: AUDIT_NOW,
      mode: "isolated",
      db: memoryRunner([row]).runner,
    });
    const stated = await scanProductionBonusCoverage({
      auditNow: AUDIT_NOW,
      mode: "isolated",
      policy: { maxAgeMs: DEFAULT_BONUS_FRESHNESS_POLICY.maxAgeMs },
      db: memoryRunner([row]).runner,
    });

    expect(omitted).toEqual(stated);
  });

  it("fails the audit rather than reporting a short scan as compliant", async () => {
    const memory = memoryRunner([compliantRow("bonus-a")]);
    // Population claims two rows while the page yields one: the audit must
    // refuse to reconcile instead of silently under-reporting.
    memory.runner.$transaction = async (handler) =>
      handler({
        async $queryRawUnsafe<T>(): Promise<T> {
          throw new Error("isolated scans must not issue raw probes");
        },
        bonus: {
          async count() {
            return 2;
          },
          async findMany() {
            return [compliantRow("bonus-a")];
          },
        },
      });

    const report = await scanProductionBonusCoverage({
      auditNow: AUDIT_NOW,
      mode: "isolated",
      db: memory.runner,
    });

    expect(report.reconciliation.valid).toBe(false);
    expect(report.fullyCompliant).toBe(false);
    expect(report.reconciliation.issues.map((issue) => issue.code)).toContain(
      "ACTIVE_OBSERVATION_TOTAL_MISMATCH",
    );
  });

  it("counts a malformed row instead of skipping it", async () => {
    const malformed = { ...compliantRow("bonus-ok"), id: "" };
    const report = await scanProductionBonusCoverage({
      auditNow: AUDIT_NOW,
      mode: "isolated",
      db: memoryRunner([malformed]).runner,
    });

    expect(report.malformedRows).toBe(1);
    expect(report.scanned).toBe(1);
    expect(report.activeObservation.nonCompliant).toBe(1);
    expect(report.fullyCompliant).toBe(false);
  });

  it("emits aggregate counts only — no identifiers, URLs or evidence content", async () => {
    const report = await scanProductionBonusCoverage({
      auditNow: AUDIT_NOW,
      mode: "isolated",
      db: memoryRunner([compliantRow("bonus-secret-id")]).runner,
    });

    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("bonus-secret-id");
    expect(serialized).not.toContain(SOURCE_URL);
    expect(serialized).not.toContain("operator.example.test");
    expect(serialized).not.toContain("bonus-url-v1:");
  });
});
