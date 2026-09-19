/**
 * Guarded, single-Casino authoritative UKGC License bootstrap.
 *
 * Default mode is a non-mutating preflight against the exact approved,
 * least-privilege bootstrap identity. `--execute` additionally requires a
 * target-specific confirmation. Both modes prove the same writer envelope;
 * only execute mode reaches the authoritative transaction.
 * The connection URL is supplied only through this operation's isolated variable;
 * DATABASE_URL and DIRECT_URL are neither read nor rewritten.
 */
import {
  UkgcBootstrapGuardError,
  parseUkgcBootstrapArguments,
  proveUkgcBootstrapWriteConnection,
  resolveUkgcBootstrapConnectionConfig,
} from "../src/services/ukgc-license-bootstrap.guard";
import { safeErrorCategory } from "../src/services/production-readonly-connection.guard";

function line(name: string, value: string | number | boolean): void {
  console.log(`${name}=${String(value)}`);
}

function safeReason(reason: string): string {
  return /^[A-Z][A-Z0-9_]{0,95}$/.test(reason)
    ? reason
    : "AUTHORITATIVE_VERIFICATION_FAILED";
}

async function main(): Promise<number> {
  const args = parseUkgcBootstrapArguments(process.argv.slice(2));
  const config = resolveUkgcBootstrapConnectionConfig(args);

  const { PrismaClient } = await import("@savvyedge/database");
  const database = new PrismaClient({
    datasources: { db: { url: config.url } },
  });

  try {
    const proof = await proveUkgcBootstrapWriteConnection(
      database,
      config.approvedTarget,
    );
    if (!proof.proven) {
      line("mode", config.execute ? "execute" : "preflight");
      line("status", "CONNECTION_REFUSED");
      line("failed_check", proof.failedCheck);
      return 1;
    }

    const { runUkgcLicenseBootstrap } =
      await import("../src/services/ukgc-license-bootstrap.service");
    const result = await runUkgcLicenseBootstrap(
      { casinoId: config.casinoId, execute: config.execute },
      {
        database,
        provePersistenceConnection: (transaction) =>
          proveUkgcBootstrapWriteConnection(transaction, config.approvedTarget),
      },
    );

    line("mode", result.mode.toLowerCase());
    line("status", result.status);
    line("casino_id", result.casinoId);
    if ("existingLicenseCount" in result) {
      line("existing_license_count", result.existingLicenseCount ?? 0);
    }
    if (result.status === "READY") {
      line("would_execute", true);
    } else if (result.status === "BOOTSTRAPPED") {
      line("license_id", result.licenseId);
      line("review_status", result.reviewStatus);
    } else if (result.status === "AUTHORITATIVE_VERIFICATION_FAILED") {
      line("reason", safeReason(result.reason));
    } else if (result.status === "CONNECTION_REFUSED") {
      line("failed_check", result.failedCheck);
    }

    return result.status === "READY" ||
      result.status === "BOOTSTRAPPED" ||
      result.status === "EXISTING_LICENSE"
      ? 0
      : 1;
  } finally {
    await database.$disconnect();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    line(
      "status",
      error instanceof UkgcBootstrapGuardError ? error.code : "FAILED",
    );
    line("error", safeErrorCategory(error));
    process.exitCode = 1;
  });
