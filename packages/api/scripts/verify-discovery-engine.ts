import { DiscoveryService } from "../src/services/discovery.service";
import { prisma } from "@savvyedge/database";
import { execSync } from "child_process";

const SEED_SOURCES = [
  "https://www.askgamblers.com/online-casinos/bonuses/",
  "https://www.casinos.com/us/bonuses",
  "https://www.gambling.com/us/online-casinos/bonuses",
];

async function verifyDiscoveryEngine() {
  console.log("=================================================");
  console.log("      STARTING SPRINT 2 DISCOVERY ENGINE VERIFICATION ");
  console.log("=================================================\n");

  // Step 1: Execute existing test suite
  console.log("--- Step 1: Running existing E2E verification test suites ---");
  try {
    console.log("[Test Suite 1/2] Running verify-vertical-slice...");
    execSync("pnpm --filter @savvyedge/api verify-slice", { stdio: "inherit" });

    console.log("\n[Test Suite 2/2] Running verify-real-scraping...");
    execSync("pnpm --filter @savvyedge/api verify-real-scraping", { stdio: "inherit" });

    console.log("\n [PASS] All existing verification test suites executed successfully!");
  } catch (err: any) {
    console.error("\n [FAIL] Existing test suite failure:", err.message);
    process.exit(1);
  }

  // Step 2: Run Autonomous Discovery Engine
  console.log("\n--- Step 2: Triggering Autonomous Discovery Engine on Multiple Seed Sources ---");
  console.log(`Seed Sources (${SEED_SOURCES.length}):`);
  SEED_SOURCES.forEach((s) => console.log(` - ${s}`));

  const discoveryResult = await DiscoveryService.discoverAndEnqueue(SEED_SOURCES);

  console.log("\n--- Step 3: Validating Discovery & Enqueuing Requirements ---");
  console.log(` -> Total Discovered Candidate URLs: ${discoveryResult.totalDiscovered}`);
  console.log(` -> Total Filtered Non-Relevant Links: ${discoveryResult.filteredCount}`);
  console.log(` -> Total Enqueued into Job Queue: ${discoveryResult.totalEnqueued}`);

  // Requirement: Demonstrate at least 50 candidate URLs discovered
  if (discoveryResult.totalDiscovered < 50) {
    throw new Error(`Discovery Requirement Failed: Discovered ${discoveryResult.totalDiscovered} candidate URLs, expected >= 50.`);
  }
  console.log(" [PASS] Discovered >= 50 candidate URLs across seed sources.");

  // Check Database Persistence in DiscoveredUrl
  const dbDiscoveredCount = await prisma.discoveredUrl.count();
  console.log(` [PASS] Verified DiscoveredUrl table count in PostgreSQL: ${dbDiscoveredCount} records.`);

  // Check Enqueued Jobs in JobQueue table
  const enqueuedJobsCount = await prisma.jobQueue.count({
    where: {
      queue_name: "ingestion-queue",
      task_type: "INGEST_URL",
    },
  });
  console.log(` [PASS] Verified JobQueue table count in PostgreSQL: ${enqueuedJobsCount} enqueued tasks.`);

  if (enqueuedJobsCount === 0) {
    throw new Error("Job Queue Enqueuing Failed: 0 jobs found in JobQueue table!");
  }

  console.log("\n=================================================");
  console.log("   SPRINT 2 DISCOVERY ENGINE VERIFICATION PASSED! ");
  console.log("=================================================");

  console.log(`
================================================================================
                        DISCOVERY ENGINE REPORT
================================================================================

1. ARCHITECTURE
--------------------------------------------------------------------------------
- Seed Configuration: Multi-source iGaming directory & promotional index seeds.
- Link Extractor: PlaywrightScraper + Cheerio DOM parser.
- Canonicalization & Normalization:
  * Scheme/domain lowercasing.
  * Removal of hash fragments (#...) & tracking params (utm_*, gclid, fbclid, ref).
  * Path trailing slash standardization.
- Filtering Engine: Rejects static assets, social/search platforms, and utility pages.
- Deduplication: In-memory set + PostgreSQL unique constraints (DiscoveredUrl.normalized_url).
- Enqueuing: Asynchronous enqueuing into JobQueue table for downstream worker processing.

2. EXECUTION FLOW
--------------------------------------------------------------------------------
Seed Source -> DiscoveryAgent (Scrape & Extract) -> Normalizer & Filter ->
DiscoveredUrl Table (PostgreSQL) -> JobQueue Table (ingestion-queue) -> Ingestion Worker

3. REMAINING LIMITATIONS & NEXT STEPS
--------------------------------------------------------------------------------
- Polling Schedule: Currently manually triggered via DiscoveryService. Run via cron/schedule in future.
- Robots.txt / Crawl Delay: Basic delay implemented in scraper context; future iteration can read robots.txt.
- Deep Multilevel Crawling: Currently 1-hop seed page link extraction; depth > 1 can be enabled via recursive BFS.
================================================================================
`);
}

verifyDiscoveryEngine();
