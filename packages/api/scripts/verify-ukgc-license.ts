import { prisma } from "@savvyedge/database";
import { UkgcLicenseVerifierService, UKGC_DATASET_URLS } from "../src/services/ukgc-license-verifier.service";
import { normalizeUkgcHost } from "../src/services/ukgc-parser";

/**
 * Manual development verification script for authoritative UKGC license verification.
 * Usage:
 *   tsx scripts/verify-ukgc-license.ts --domain <domain> [--casino-id <id>] [--account <accountNumber>]
 */
async function main() {
  const args = process.argv.slice(2);
  let domain = "";
  let casinoId = "";
  let account = "";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--domain" && args[i + 1]) {
      domain = args[++i];
    } else if (args[i] === "--casino-id" && args[i + 1]) {
      casinoId = args[++i];
    } else if (args[i] === "--account" && args[i + 1]) {
      account = args[++i];
    }
  }

  if (!domain && !casinoId) {
    console.error("Usage: tsx scripts/verify-ukgc-license.ts --domain <domain> [--casino-id <id>] [--account <accountNumber>]");
    process.exit(1);
  }

  let normalizedDomain = normalizeUkgcHost(domain);

  console.log("=================================================");
  console.log("     UKGC AUTHORITATIVE LICENSE VERIFIER         ");
  if (domain) console.log(` -> Domain:             ${domain}`);
  if (normalizedDomain) console.log(` -> Normalized Domain:  ${normalizedDomain}`);
  if (casinoId) console.log(` -> Casino ID Override: ${casinoId}`);
  if (account) console.log(` -> Diagnostic Account: ${account}`);
  console.log("=================================================\n");

  // 1. Locate existing Casino record. MUST NOT create a casino.
  let casino = null;
  if (casinoId) {
    casino = await prisma.casino.findUnique({
      where: { id: casinoId },
    });
  } else if (normalizedDomain) {
    casino = await prisma.casino.findFirst({
      where: {
        OR: [
          { website_url: { contains: normalizedDomain } },
          { slug: normalizedDomain.replace(/\.[a-z.]+$/, "") },
        ],
      },
    });
  }

  if (!casino) {
    console.error(`[ERROR] No matching Casino entity found in database for domain '${normalizedDomain || domain}'.`);
    console.error("[SAFETY] Verification utility will NOT create a synthetic Casino entity. Aborting.");
    process.exit(1);
  }

  if (!normalizedDomain && casino.website_url) {
    normalizedDomain = normalizeUkgcHost(casino.website_url);
  }

  console.log(`[INFO] Found matching Casino record: ${casino.name} (ID: ${casino.id})`);
  console.log("[INFO] Querying authoritative UK Gambling Commission register datasets...");

  // 2. Execute authoritative verification
  const result = await UkgcLicenseVerifierService.verifyCasinoLicense({
    casinoId: casino.id,
    domain: normalizedDomain,
    diagnosticAccountOverride: account || undefined,
  });

  console.log("\n=================================================");
  console.log("             VERIFICATION REPORT                 ");
  console.log("=================================================");
  console.log(` -> Verified Status:        ${result.verified ? "VERIFIED (PASS)" : "FAILED"}`);
  if (!result.verified) {
    console.log(` -> Failure Reason:         ${result.reason}`);
    if (result.details) {
      console.log(` -> Details:                ${JSON.stringify(result.details)}`);
    }
  } else {
    console.log(` -> Business Account #:     ${result.accountNumber}`);
    console.log(` -> Legal Entity Name:      ${result.legalEntityName}`);
    console.log(` -> Operating Licence #:    ${result.licenceNumber}`);
    console.log(` -> Licence Activity:       ${result.licenceActivity}`);
    console.log(` -> Regulator Status:       ${result.status}`);
    console.log(` -> Domain Association:     EXACT MATCH CONFIRMED (Active)`);
    console.log(` -> Licence ID:             ${result.licenseId}`);
    console.log(` -> Evidence Records:       3 records created across official datasets`);
    console.log(`    - Domain Evidence ID:   ${result.evidenceRecordIds?.domainEvidenceId}`);
    console.log(`    - Business Evidence ID: ${result.evidenceRecordIds?.businessEvidenceId}`);
    console.log(`    - Licence Evidence ID:  ${result.evidenceRecordIds?.licenceEvidenceId}`);
    console.log(` -> Evidence Claims Linked: ${result.evidenceClaimIds?.length || 0} claims`);
    console.log(` -> Review Status:          ${result.reviewStatus}`);
    console.log(` -> Governance Version:     ${result.governanceVersion}`);
    console.log(` -> Human Approval Status:  ${result.humanApprovalRequired ? "AWAITING HUMAN APPROVAL" : "APPROVED"}`);
    console.log(` -> Authoritative Datasets:`);
    console.log(`    - ${UKGC_DATASET_URLS.domains}`);
    console.log(`    - ${UKGC_DATASET_URLS.businesses}`);
    console.log(`    - ${UKGC_DATASET_URLS.licences}`);
  }
  console.log("=================================================\n");

  if (!result.verified) {
    process.exit(1);
  }
}

main()
  .catch((err) => {
    console.error("[ERROR] Unexpected failure during UKGC verification:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
