import { verifyApiAuthorization } from "../src/utils/auth.utils";
import { PublicationGateService } from "../src/services/publication-gate.service";
import fs from "fs";
import path from "path";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
}

async function runTrustVerificationSuite() {
  console.log("==========================================");
  console.log("Phase 1 Trust & Safety Verification Suite");
  console.log("==========================================\n");

  // 1. Authorization Tests
  console.log("1. Testing Centralized Server-Side Authorization Utility...");
  const originalSecret = process.env.INTERNAL_API_SECRET;
  process.env.INTERNAL_API_SECRET = "secret-key-999";

  const reqNoHeader = new Request("http://localhost/api/v1/casinos", { method: "POST" });
  const authNoHeader = verifyApiAuthorization(reqNoHeader);
  assert(authNoHeader.authorized === false, "Missing header must be unauthorized");
  assert(authNoHeader.statusCode === 401, "Missing header status must be 401");

  const reqBadKey = new Request("http://localhost/api/v1/casinos", {
    method: "POST",
    headers: { Authorization: "Bearer wrong-key" },
  });
  const authBadKey = verifyApiAuthorization(reqBadKey);
  assert(authBadKey.authorized === false, "Invalid key must be forbidden");
  assert(authBadKey.statusCode === 403, "Invalid key status must be 403");

  const reqValidBearer = new Request("http://localhost/api/v1/casinos", {
    method: "POST",
    headers: { Authorization: "Bearer secret-key-999" },
  });
  const authValidBearer = verifyApiAuthorization(reqValidBearer);
  assert(authValidBearer.authorized === true, "Valid Bearer key must be authorized");

  delete process.env.INTERNAL_API_SECRET;
  const reqFailClosed = new Request("http://localhost/api/v1/casinos", {
    method: "POST",
    headers: { Authorization: "Bearer secret-key-999" },
  });
  const authFailClosed = verifyApiAuthorization(reqFailClosed);
  assert(authFailClosed.authorized === false, "Missing server secret must fail closed");
  assert(authFailClosed.statusCode === 503, "Missing server secret status must be 503");

  process.env.INTERNAL_API_SECRET = originalSecret;
  console.log("   ✓ Authorization checks passed successfully.\n");

  // 2. Exact Identity Quarantine Matcher Tests
  console.log("2. Testing Exact Identity Quarantine Matcher...");
  assert(PublicationGateService.isQuarantinedIdentity("AskGamblers", "askgamblers", "https://askgamblers.com") === true, "Exact askgamblers identity must reject");
  assert(PublicationGateService.isQuarantinedIdentity("Casinos.com", "casinos-com", "https://www.casinos.com") === true, "Exact casinos.com identity must reject");
  assert(PublicationGateService.isQuarantinedIdentity("Community Casino", "community-casino", "https://community-casino.com") === false, "Unrelated brand with 'com' must pass");
  assert(PublicationGateService.isQuarantinedIdentity("Organic Casino", "organic-casino", "https://organic-casino.net") === false, "Unrelated brand with 'org' fragment must pass");
  console.log("   ✓ Quarantine matcher checks passed successfully.\n");

  // 3. Deterministic Current-State Verification Evidence & Verification Badge Tests
  console.log("3. Testing Deterministic Current-State Evidence Selectors & Verification Badge...");
  const verifiedDate = new Date("2026-01-01T12:00:00Z");

  const casinoIngestionEvent = {
    id: "c-100",
    name: "Apex Casino",
    slug: "apex-casino",
    website_url: "https://apexcasino.com",
    status: "ACTIVE",
    data_source_type: "MANUAL_AUDIT",
    verified_at: verifiedDate,
    licenses: [{ status: "ACTIVE", verified_at: verifiedDate, license_no: "LIC-1" }],
    history_events: [{ event_type: "INGESTION", source_url: "https://apexcasino.com/chat", occurred_at: verifiedDate }],
  };
  assert(PublicationGateService.getQualifyingCasinoEvidence(casinoIngestionEvent) === null, "INGESTION history event must fail verification evidence selector");
  assert(PublicationGateService.isCasinoPubliclyEligible(casinoIngestionEvent) === false, "Casino with INGESTION history event must fail eligibility");

  const eligibleCasino = {
    id: "c-101",
    name: "Royal Crown Casino",
    slug: "royal-crown-casino",
    website_url: "https://royalcrown.com",
    status: "ACTIVE",
    data_source_type: "MANUAL_AUDIT",
    verified_at: verifiedDate,
    licenses: [{ status: "ACTIVE", verified_at: verifiedDate, license_no: "LIC-101" }],
    history_events: [{ event_type: "VERIFICATION", source_url: "https://ukgc.gov.uk/license/101", occurred_at: verifiedDate }],
  };
  assert(PublicationGateService.getQualifyingCasinoEvidence(eligibleCasino) !== null, "Explicit VERIFICATION event must be selected");
  assert(PublicationGateService.isCasinoPubliclyEligible(eligibleCasino) === true, "Casino with valid VERIFICATION evidence must pass eligibility");
  assert(PublicationGateService.isVerificationBadgeEligible(eligibleCasino) === false, "Phase 1 verification badge must fail closed (return false)");

  console.log("   ✓ Deterministic evidence & verification badge checks passed successfully.\n");

  // 4. Codebase Architectural Coverage Checks
  console.log("4. Verifying Codebase Import Coverage...");
  const rootDir = path.resolve(__dirname, "../../../apps/web/src/app");
  const protectedRoutes = [
    "api/v1/casinos/route.ts",
    "api/v1/bonuses/route.ts",
    "api/v1/bonuses/ingest/route.ts",
    "api/v1/discovery/route.ts",
    "api/v1/orchestrator/metrics/route.ts",
  ];
  for (const p of protectedRoutes) {
    const content = fs.readFileSync(path.join(rootDir, p), "utf-8");
    assert(content.includes("verifyApiAuthorization"), `${p} must import verifyApiAuthorization`);
  }
  console.log("   ✓ Architectural import coverage verified.\n");

  console.log("==========================================");
  console.log("ALL PHASE 1 TRUST VERIFICATION TESTS PASSED");
  console.log("==========================================");
}

runTrustVerificationSuite().catch((err) => {
  console.error("Verification suite failed:", err);
  process.exit(1);
});
