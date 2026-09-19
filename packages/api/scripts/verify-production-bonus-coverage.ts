/**
 * Read-only production Bonus coverage verifier.
 *
 * Reads the PUBLISHED + APPROVED + ACTIVE bonus population and classifies each
 * member with the pure audit classifier. It issues zero writes.
 *
 * Two disjoint modes, selected by which opt-in variable is set. Configuring
 * both, or neither, is a refusal — there is no default and no fallback.
 *
 *   isolated             SAVVYEDGE_COVERAGE_AUDIT_DATABASE_URL
 *                        Loopback test databases only, via the existing
 *                        isolated-database guard. Behaviour unchanged.
 *
 *   production-readonly  SAVVYEDGE_COVERAGE_AUDIT_PRODUCTION_URL
 *                        + SAVVYEDGE_COVERAGE_AUDIT_ROLE
 *                        Connects, then refuses to scan unless the session
 *                        proves server-enforced read-only access. The security
 *                        boundary is the database's own privilege system, never
 *                        the absence of writes in this code.
 *
 * Output is aggregate counts only. No bonus IDs, URLs, evidence content, claim
 * values, connection strings or credentials are ever printed.
 */

import {
  DEFAULT_BONUS_FRESHNESS_POLICY,
  type BonusFreshnessPolicy,
} from "../src/services/freshness.policy";
import type { CoverageScanRunner } from "../src/services/production-bonus-coverage.loader";
import {
  productionFatalMessage,
  proveAuthorizedReadOnlyConnection,
  resolveCoverageAuditMode,
  safeErrorCategory,
} from "../src/services/production-readonly-connection.guard";
import {
  UnsafeTestDatabaseError,
  requireConfiguredIsolatedTestDatabase,
} from "../tests/helpers/isolated-test-database-guard";

/**
 * The single place this verifier decides which freshness window it audits
 * against. It is passed explicitly into the scan and printed with the report,
 * so a future non-default production window cannot be silently assumed.
 */
const EFFECTIVE_FRESHNESS_POLICY: BonusFreshnessPolicy = {
  ...DEFAULT_BONUS_FRESHNESS_POLICY,
};

/** Audit valid and the population is fully compliant. */
const EXIT_COMPLIANT = 0;
/** Technical failure: guard refused, scan threw, or totals did not reconcile. */
const EXIT_AUDIT_INVALID = 1;
/** Audit valid and trustworthy, but the population is not fully compliant. */
const EXIT_NON_COMPLIANT = 2;

// Captured once after fail-closed mode resolution so fatal handling never
// reinterprets a production failure through later process.env mutation.
let productionModeSelected = false;

const ISOLATED_MODE_VARIABLE = "SAVVYEDGE_COVERAGE_AUDIT_DATABASE_URL";

function line(label: string, value: string | number): void {
  console.log(` -> ${label.padEnd(34)} ${value}`);
}

function section(title: string): void {
  console.log(`\n--- ${title} ---`);
}

async function main(): Promise<number> {
  console.log("=================================================");
  console.log("      PRODUCTION BONUS COVERAGE VERIFIER          ");
  console.log("           (read-only, zero mutations)           ");
  console.log("=================================================");

  const selected = resolveCoverageAuditMode(process.env);
  if (selected.mode === "refused") {
    console.error(`\n[COVERAGE AUDIT REFUSED] ${selected.reason}\n`);
    return EXIT_AUDIT_INVALID;
  }
  productionModeSelected = selected.mode === "production-readonly";
  line("Mode", selected.mode);

  let prisma: CoverageScanRunner;
  let disconnect: () => Promise<void>;

  if (selected.mode === "isolated") {
    // Unchanged isolated path: the guard still runs before anything
    // imports or constructs a database client.
    const decision = requireConfiguredIsolatedTestDatabase({
      optInVariable: ISOLATED_MODE_VARIABLE,
      targets: ["DATABASE_URL", "DIRECT_URL"],
    });
    if (decision.status !== "enabled") {
      console.error(
        `\n[COVERAGE AUDIT DISABLED] ${decision.reason}\n` +
          `Set ${ISOLATED_MODE_VARIABLE} to an isolated local database URL matching ` +
          `DATABASE_URL and DIRECT_URL to run this verifier.\n`,
      );
      return EXIT_AUDIT_INVALID;
    }
    // Host and database name only: never the URL, user or password.
    line("Target host", decision.hostname);
    line("Target database", decision.databaseName);
    const database = await import("@savvyedge/database");
    prisma = database.prisma as unknown as CoverageScanRunner;
    disconnect = () => database.prisma.$disconnect();
  } else {
    // Production mode. A dedicated client bound to the audit URL, so the
    // connection proved read-only is the same one that scans; the ambient
    // singleton is never used here.
    const database = await import("@savvyedge/database");
    const client = new database.PrismaClient({ datasourceUrl: selected.url });
    prisma = client as unknown as CoverageScanRunner;
    disconnect = () => client.$disconnect();

    line("Expected auditor role", selected.role);

    let proof: Awaited<ReturnType<typeof proveAuthorizedReadOnlyConnection>>;
    try {
      proof = await proveAuthorizedReadOnlyConnection(
        client as unknown as Parameters<
          typeof proveAuthorizedReadOnlyConnection
        >[0],
        selected.authorization,
      );
    } catch (error) {
      // A thrown proof is a refusal, never a pass.
      await disconnect();
      console.error(
        "\n[READ-ONLY PROOF FAILED] proof could not be completed " +
          `(${safeErrorCategory(error)})\n`,
      );
      return EXIT_AUDIT_INVALID;
    }

    if (!proof.proven) {
      await disconnect();
      console.error(
        `\n[READ-ONLY PROOF FAILED] ${proof.failedCheck}: ${proof.reason}\n` +
          "Refusing to scan. Server-enforced read-only access could not be " +
          "established; the absence of writes in this code is not a security " +
          "boundary.\n",
      );
      return EXIT_AUDIT_INVALID;
    }

    section("Initial read-only proof");
    line("Connected role", proof.details.role);
    line("Login role", proof.details.sessionRole);
    line("transaction_read_only", proof.details.transactionReadOnly);
    line("Writable tables in public", proof.details.writableTableCount);
    line("CREATE on public", String(proof.details.canCreateInPublic));
    // Name only: host, port, user and URL are never printed.
    line("Target database", proof.details.databaseName);
  }

  const { scanProductionBonusCoverage } =
    await import("../src/services/production-bonus-coverage.loader");

  try {
    // One immutable clock for the entire audit.
    const auditNow = new Date();
    const report = await scanProductionBonusCoverage({
      auditNow,
      policy: EFFECTIVE_FRESHNESS_POLICY,
      db: prisma,
      ...(selected.mode === "production-readonly"
        ? {
            mode: "production-readonly" as const,
            authorization: selected.authorization,
          }
        : { mode: "isolated" as const }),
    });

    section("Scan");
    line("Audit clock (UTC)", report.auditNow);
    line("Transaction connection proof", report.connectionAttestation);
    line("Effective freshness window (ms)", report.freshnessMaxAgeMs);
    line(
      "Scan transaction",
      `${report.scanTransaction.isolationLevel}, maxWait ` +
        `${report.scanTransaction.maxWaitMs}ms, timeout ` +
        `${report.scanTransaction.timeoutMs}ms`,
    );
    line("Population (published/approved)", report.population);
    line("Rows scanned", report.scanned);
    line("Pages scanned", report.pagesScanned);
    line("Malformed rows", report.malformedRows);

    section("Active-observation compliance");
    line("Compliant", report.activeObservation.compliant);
    line("Non-compliant", report.activeObservation.nonCompliant);
    for (const [code, count] of Object.entries(
      report.activeObservation.primaryFailureCounts,
    )) {
      line(`  ${code}`, count);
    }

    section("Re-verification readiness");
    line("Ready", report.reverificationReadiness.ready);
    line("Not ready", report.reverificationReadiness.notReady);
    for (const [resolution, count] of Object.entries(
      report.reverificationReadiness.bySourceResolution,
    )) {
      line(`  ${resolution}`, count);
    }

    section("Publication governance");
    line("Consistent", report.publicationGovernance.consistent);
    line("Inconsistent", report.publicationGovernance.inconsistent);
    line("Not assessable", report.publicationGovernance.notAssessable);
    for (const [diagnostic, count] of Object.entries(
      report.publicationGovernance.diagnosticCounts,
    )) {
      line(`  ${diagnostic}`, count);
    }

    section("Reconciliation");
    for (const [equation, held] of Object.entries(
      report.reconciliation.equations,
    )) {
      line(`  ${equation}`, held ? "BALANCED" : "MISMATCH");
    }
    line(
      "Primary-failure total",
      String(report.reconciliation.totals.activeObservationPrimaryFailures),
    );

    if (!report.reconciliation.valid) {
      console.error("\n[AUDIT INVALID] Population totals did not reconcile:");
      for (const issue of report.reconciliation.issues) {
        console.error(`  - ${issue.code} @ ${issue.field}`);
      }
      console.error(
        "\nNo coverage conclusion is reported: an audit that cannot balance " +
          "its own totals is not evidence of anything.\n",
      );
      return EXIT_AUDIT_INVALID;
    }

    console.log("\n=================================================");
    if (report.fullyCompliant) {
      console.log("  PRODUCTION_BONUS_COVERAGE: COMPLIANT           ");
      console.log("=================================================\n");
      return EXIT_COMPLIANT;
    }
    console.log("  PRODUCTION_BONUS_COVERAGE: NON-COMPLIANT       ");
    console.log("  (audit reconciled; population has gaps)        ");
    console.log("=================================================\n");
    return EXIT_NON_COMPLIANT;
  } finally {
    await disconnect();
  }
}

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((error) => {
    // Production mode is checked FIRST and unconditionally: no raw error object,
    // message, stack or Prisma metadata may ever reach production output.
    if (productionModeSelected) {
      console.error(`\n[FATAL] ${productionFatalMessage(error)}\n`);
    } else if (error instanceof UnsafeTestDatabaseError) {
      console.error(`\n[COVERAGE AUDIT SAFETY ERROR] ${error.message}\n`);
    } else {
      // Isolated mode keeps the verbose diagnostic: loopback test data only.
      console.error("\n[FATAL] Production bonus coverage audit failed:", error);
    }
    process.exit(EXIT_AUDIT_INVALID);
  });
