import {
  Prisma,
  PrismaClient,
  PublicationStatus,
  ReviewStatus,
} from "@savvyedge/database";
import {
  defaultUkgcDatasetFetcher,
  UkgcLicenseVerifierService,
  type UkgcDatasetFetcher,
  type VerifyUkgcLicenseInput,
  type VerifyUkgcLicenseResult,
} from "./ukgc-license-verifier.service";
import { normalizeUkgcHost, type UkgcDatasets } from "./ukgc-parser";
import type { OperationalConnectionProof } from "./ukgc-license-bootstrap.guard";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type TargetDatabase = Pick<Prisma.TransactionClient, "casino" | "license">;

interface ReadyTarget {
  status: "READY";
  casinoId: string;
  domain: string;
  casinoReviewStatus: ReviewStatus;
  casinoPublicationStatus: PublicationStatus;
  existingLicenseCount: 0;
}

export type UkgcLicenseBootstrapPreflight =
  | ReadyTarget
  | {
      status:
        | "INVALID_CASINO_ID"
        | "CASINO_NOT_FOUND"
        | "CASINO_WEBSITE_MISSING"
        | "CASINO_WEBSITE_INVALID"
        | "CASINO_DOMAIN_AMBIGUOUS"
        | "EXISTING_LICENSE";
      casinoId: string;
      existingLicenseCount?: number;
    };

export type UkgcLicenseBootstrapResult =
  | (UkgcLicenseBootstrapPreflight & { mode: "PREFLIGHT" })
  | {
      mode: "EXECUTE";
      status: "BOOTSTRAPPED";
      casinoId: string;
      licenseId: string;
      reviewStatus: "AWAITING_REVIEW";
      existingLicenseCount: 1;
    }
  | {
      mode: "EXECUTE";
      status: "EXISTING_LICENSE";
      casinoId: string;
      existingLicenseCount: number;
    }
  | {
      mode: "EXECUTE";
      status: "CASINO_DOMAIN_CHANGED";
      casinoId: string;
    }
  | {
      mode: "EXECUTE";
      status: "CONNECTION_REFUSED";
      casinoId: string;
      failedCheck: Extract<
        OperationalConnectionProof,
        { proven: false }
      >["failedCheck"];
    }
  | {
      mode: "EXECUTE";
      status: "AUTHORITATIVE_VERIFICATION_FAILED";
      casinoId: string;
      reason: string;
    }
  | (Exclude<UkgcLicenseBootstrapPreflight, ReadyTarget> & {
      mode: "EXECUTE";
    });

export interface RunUkgcLicenseBootstrapInput {
  casinoId: string;
  execute?: boolean;
}

export interface RunUkgcLicenseBootstrapDependencies {
  database: PrismaClient;
  fetcher?: UkgcDatasetFetcher;
  provePersistenceConnection: (
    database: Pick<Prisma.TransactionClient, "$queryRawUnsafe">,
  ) => Promise<OperationalConnectionProof>;
  verifier?: (
    input: VerifyUkgcLicenseInput,
  ) => Promise<VerifyUkgcLicenseResult>;
}

class AuthoritativeVerificationRefusal extends Error {
  public constructor(public readonly reason: string) {
    super("Authoritative UKGC verification refused the target.");
    this.name = "AuthoritativeVerificationRefusal";
  }
}

function deriveStoredCasinoDomain(
  websiteUrl: string | null,
):
  | { status: "valid"; domain: string }
  | { status: "missing" }
  | { status: "invalid" } {
  if (!websiteUrl?.trim()) return { status: "missing" };

  const candidate = websiteUrl.includes("://")
    ? websiteUrl.trim()
    : `https://${websiteUrl.trim()}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { status: "invalid" };
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    return { status: "invalid" };
  }

  const domain = normalizeUkgcHost(parsed.hostname);
  if (!domain || !domain.includes(".") || domain.includes(" ")) {
    return { status: "invalid" };
  }
  return { status: "valid", domain };
}

export async function inspectUkgcLicenseBootstrapTarget(
  database: TargetDatabase,
  casinoId: string,
): Promise<UkgcLicenseBootstrapPreflight> {
  if (!UUID_PATTERN.test(casinoId)) {
    return { status: "INVALID_CASINO_ID", casinoId };
  }

  const casino = await database.casino.findUnique({
    where: { id: casinoId },
    select: {
      id: true,
      website_url: true,
      review_status: true,
      publication_status: true,
    },
  });
  if (!casino) return { status: "CASINO_NOT_FOUND", casinoId };

  // Bootstrap-only is the first domain decision after target existence: a
  // pre-existing License suppresses source resolution and every downstream
  // verifier/evidence write, even if the Casino's website later became invalid.
  const existingLicenseCount = await database.license.count({
    where: { casino_id: casinoId },
  });
  if (existingLicenseCount > 0) {
    return {
      status: "EXISTING_LICENSE",
      casinoId,
      existingLicenseCount,
    };
  }

  const target = deriveStoredCasinoDomain(casino.website_url);
  if (target.status === "missing") {
    return { status: "CASINO_WEBSITE_MISSING", casinoId };
  }
  if (target.status === "invalid") {
    return { status: "CASINO_WEBSITE_INVALID", casinoId };
  }

  const websiteCandidates = await database.casino.findMany({
    where: { website_url: { not: null } },
    select: { id: true, website_url: true },
  });
  const conflictingCasino = websiteCandidates.some((candidate) => {
    if (candidate.id === casinoId) return false;
    const resolved = deriveStoredCasinoDomain(candidate.website_url);
    return resolved.status === "valid" && resolved.domain === target.domain;
  });
  if (conflictingCasino) {
    return { status: "CASINO_DOMAIN_AMBIGUOUS", casinoId };
  }

  return {
    status: "READY",
    casinoId,
    domain: target.domain,
    casinoReviewStatus: casino.review_status,
    casinoPublicationStatus: casino.publication_status,
    existingLicenseCount: 0,
  };
}

function fixedDatasetFetcher(datasets: UkgcDatasets): UkgcDatasetFetcher {
  return async () => datasets;
}

export async function runUkgcLicenseBootstrap(
  input: RunUkgcLicenseBootstrapInput,
  dependencies: RunUkgcLicenseBootstrapDependencies,
): Promise<UkgcLicenseBootstrapResult> {
  const initial = await inspectUkgcLicenseBootstrapTarget(
    dependencies.database,
    input.casinoId,
  );
  if (!input.execute || initial.status !== "READY") {
    return {
      ...initial,
      mode: input.execute ? "EXECUTE" : "PREFLIGHT",
    } as UkgcLicenseBootstrapResult;
  }

  let datasets: UkgcDatasets;
  try {
    datasets = await (dependencies.fetcher ?? defaultUkgcDatasetFetcher)();
  } catch {
    return {
      mode: "EXECUTE",
      status: "AUTHORITATIVE_VERIFICATION_FAILED",
      casinoId: input.casinoId,
      reason: "UKGC_DATASETS_UNAVAILABLE",
    };
  }

  const verifier =
    dependencies.verifier ??
    ((verificationInput: VerifyUkgcLicenseInput) =>
      UkgcLicenseVerifierService.verifyCasinoLicense(verificationInput));

  try {
    return await dependencies.database.$transaction(
      async (transaction) => {
        const connectionProof =
          await dependencies.provePersistenceConnection(transaction);
        if (!connectionProof.proven) {
          return {
            mode: "EXECUTE" as const,
            status: "CONNECTION_REFUSED" as const,
            casinoId: input.casinoId,
            failedCheck: connectionProof.failedCheck,
          };
        }

        // This row lock serializes every bootstrap attempt for the Casino and
        // remains held through the verifier's persistence. A concurrent License
        // INSERT must also validate this Casino foreign key and cannot bypass the
        // conflicting row lock.
        const lockedRows = await transaction.$queryRaw<Array<{ id: string }>>(
          Prisma.sql`SELECT "id" FROM "Casino" WHERE "id" = ${input.casinoId} FOR UPDATE`,
        );
        if (lockedRows.length !== 1) {
          return {
            mode: "EXECUTE" as const,
            status: "CASINO_NOT_FOUND" as const,
            casinoId: input.casinoId,
          };
        }

        // READ COMMITTED gives this post-lock statement a fresh snapshot, so an
        // attempt that waited for a prior bootstrap sees the committed License.
        const lockedTarget = await inspectUkgcLicenseBootstrapTarget(
          transaction,
          input.casinoId,
        );
        if (lockedTarget.status !== "READY") {
          return {
            ...lockedTarget,
            mode: "EXECUTE" as const,
          };
        }
        if (lockedTarget.domain !== initial.domain) {
          return {
            mode: "EXECUTE" as const,
            status: "CASINO_DOMAIN_CHANGED" as const,
            casinoId: input.casinoId,
          };
        }

        const verification = await verifier({
          casinoId: input.casinoId,
          domain: lockedTarget.domain,
          fetcher: fixedDatasetFetcher(datasets),
          db: transaction,
        });
        if (!verification.verified || !verification.licenseId) {
          throw new AuthoritativeVerificationRefusal(
            verification.reason ?? "AUTHORITATIVE_VERIFICATION_FAILED",
          );
        }

        const [licenses, casinoAfter] = await Promise.all([
          transaction.license.findMany({
            where: { casino_id: input.casinoId },
            select: { id: true, review_status: true },
          }),
          transaction.casino.findUnique({
            where: { id: input.casinoId },
            select: {
              review_status: true,
              publication_status: true,
            },
          }),
        ]);
        const created = licenses[0];
        if (
          licenses.length !== 1 ||
          created?.id !== verification.licenseId ||
          created.review_status !== ReviewStatus.AWAITING_REVIEW ||
          casinoAfter?.review_status !== lockedTarget.casinoReviewStatus ||
          casinoAfter.publication_status !==
            lockedTarget.casinoPublicationStatus
        ) {
          throw new Error("UKGC_LICENSE_BOOTSTRAP_POSTCONDITION_FAILED");
        }

        return {
          mode: "EXECUTE" as const,
          status: "BOOTSTRAPPED" as const,
          casinoId: input.casinoId,
          licenseId: created.id,
          reviewStatus: ReviewStatus.AWAITING_REVIEW,
          existingLicenseCount: 1 as const,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 10_000,
        timeout: 30_000,
      },
    );
  } catch (error) {
    if (error instanceof AuthoritativeVerificationRefusal) {
      return {
        mode: "EXECUTE",
        status: "AUTHORITATIVE_VERIFICATION_FAILED",
        casinoId: input.casinoId,
        reason: error.reason,
      };
    }
    throw error;
  }
}
