import { IngestionService } from "../src/services/ingestion.service";
import { BonusService } from "../src/services/bonus.service";
import { JobQueueService } from "../src/services/job-queue.service";
import { prisma } from "@savvyedge/database";

async function verifyVerticalSlice() {
  console.log("=================================================");
  console.log("      STARTING E2E VERTICAL SLICE VERIFICATION   ");
  console.log("=================================================\n");

  const casinoUrl1 = "https://www.askgamblers.com/online-casinos/bonuses/";
  const casinoUrl2 = "https://www.casinos.com/us/bonuses";
  const existingCasinoUrl = "https://www.askgamblers.com/online-casinos/no-deposit-bonuses/";

  try {
    // Clean up queue database table first to ensure a clean test run
    await prisma.jobQueue.deleteMany({});
    
    console.log("Step 1: Enqueueing URL 1 (Asynchronously)...");
    const job1 = await IngestionService.enqueueIngestion({ url: casinoUrl1 });
    console.log(` -> Enqueued Job ID: ${job1.id} (Status: ${job1.status})`);

    console.log("\nStep 2: Starting JobQueue Worker to process enqueued jobs...");
    const handlers = IngestionService.getQueueHandlers();
    
    // Programmatically process all jobs in the queue
    let processedAny = true;
    let iterations = 0;
    while (processedAny && iterations < 10) {
      processedAny = await JobQueueService.processNextJob("ingestion-queue", handlers);
      iterations++;
    }
    console.log(` -> JobQueue execution drained. Processed ${iterations - 1} steps.`);

    // Query database to ensure entities were created asynchronously
    // 1. Get resolved casino
    let domain1 = "askgamblers.com";
    try {
      domain1 = new URL(casinoUrl1).hostname.replace(/^www\./, "");
    } catch {}

    const casino1 = await prisma.casino.findFirst({
      where: { website_url: { contains: domain1, mode: "insensitive" } },
      include: { bonuses: true }
    });

    if (!casino1) {
      throw new Error(`Asynchronous processing failed: Casino record not found for domain ${domain1}`);
    }
    console.log(` [PASS] Casino resolved and created: ID: ${casino1.id} (${casino1.name})`);
    
    if (casino1.bonuses.length === 0) {
      throw new Error(`Asynchronous processing failed: No bonuses created for Casino ${casino1.name}`);
    }
    const bonus1 = casino1.bonuses[0];
    console.log(` [PASS] Bonus created and linked: ID: ${bonus1.id} (${bonus1.headline_value})`);

    console.log(`\nStep 3: Ingesting URL 2 (Synchronous Fallback Compatibility)...`);
    const result2 = await IngestionService.ingestBonusFromUrl({ url: casinoUrl2 });
    console.log(` -> Ingested Bonus ID: ${result2.bonus.id}`);
    console.log(` -> Attached to Casino ID: ${result2.casino.id} (${result2.casino.name})`);

    console.log(`\nStep 4: Ingesting URL from existing domain (Synchronous Fallback)...`);
    const result3 = await IngestionService.ingestBonusFromUrl({ url: existingCasinoUrl });
    console.log(` -> Ingested Bonus ID: ${result3.bonus.id}`);
    console.log(` -> Attached to Casino ID: ${result3.casino.id} (${result3.casino.name})`);

    console.log("\nStep 5: Validating Entity Resolution & Casino Disambiguation...");
    
    // Check 1: Two distinct casino records for URL1 & URL2
    if (casino1.id === result2.casino.id) {
      throw new Error(`Entity Resolution Failed: Both URLs attached to same Casino ID (${casino1.id})!`);
    }
    console.log(" [PASS] Two distinct Casino records created for two different URLs.");

    // Check 2: Re-ingested URL matched existing Casino record
    if (result3.casino.id !== casino1.id) {
      throw new Error(`Entity Resolution Failed: URL from existing domain created duplicate Casino ID (${result3.casino.id}) instead of matching existing (${casino1.id})!`);
    }
    console.log(" [PASS] Ingesting URL from existing domain matched existing Casino record.");

    // Check 3: Bonuses belong to correct casinos
    if (bonus1.casino_id !== casino1.id) {
      throw new Error(`Bonus 1 casino_id (${bonus1.casino_id}) does not match Casino 1 ID (${casino1.id})`);
    }
    if (result2.bonus.casino_id !== result2.casino.id) {
      throw new Error(`Bonus 2 casino_id (${result2.bonus.casino_id}) does not match Casino 2 ID (${result2.casino.id})`);
    }
    if (result3.bonus.casino_id !== casino1.id) {
      throw new Error(`Bonus 3 casino_id (${result3.bonus.casino_id}) does not match Casino 1 ID (${casino1.id})`);
    }
    console.log(" [PASS] Bonuses are correctly attached to their respective Casino records.");

    // Check 4: Canonical benchmark casino fallback is removed
    if (
      casino1.slug === "canonical-benchmark-casino" ||
      result2.casino.slug === "canonical-benchmark-casino" ||
      result3.casino.slug === "canonical-benchmark-casino"
    ) {
      throw new Error("Entity Resolution Failed: Pipeline still used 'canonical-benchmark-casino' fallback!");
    }
    console.log(" [PASS] No fallback behavior to Canonical Benchmark Casino detected.");

    console.log("\nStep 6: Querying REST API Service Layer (GET /api/v1/bonuses)...");
    const retrieved = await BonusService.getBonuses({ page: 1, limit: 100 });
    console.log(`Retrieved ${retrieved.data.length} bonuses from Postgres.`);

    const match1 = retrieved.data.find((b) => b.id === bonus1.id);
    const match2 = retrieved.data.find((b) => b.id === result2.bonus.id);

    if (match1 && match2) {
      console.log(" [PASS] Both ingested Bonuses retrieved successfully via API layer.");
      console.log(`   - Bonus 1 (Casino: ${(match1 as any).casino?.name}): ${match1.id}`);
      console.log(`   - Bonus 2 (Casino: ${(match2 as any).casino?.name}): ${match2.id}`);
    } else {
      throw new Error("Failed to retrieve both ingested bonuses from API layer.");
    }

    console.log("\nStep 7: Verifying Content Fingerprinting & Pipeline Short-Circuiting...");
    
    // Count ScrapeJob records before re-run
    const initialBonusCount = await prisma.bonus.count();

    // Re-ingest casinoUrl1 asynchronously
    console.log(` -> Re-enqueueing URL 1 (${casinoUrl1})...`);
    const job2 = await IngestionService.enqueueIngestion({ url: casinoUrl1 });
    
    let processedAny2 = true;
    let iterations2 = 0;
    while (processedAny2 && iterations2 < 5) {
      processedAny2 = await JobQueueService.processNextJob("ingestion-queue", handlers);
      iterations2++;
    }
    console.log(` -> Re-crawling processed steps: ${iterations2 - 1}`);
    
    // Check if EXTRACT_BONUS was skipped due to short-circuiting
    const reCrawlJob = await prisma.scrapeJob.findUniqueOrThrow({ where: { id: job2.id } });
    if (reCrawlJob.status !== "COMPLETED") {
      throw new Error(`Short-circuit failed: ScrapeJob status is ${reCrawlJob.status}, expected COMPLETED.`);
    }
    if (!reCrawlJob.content_hash || !reCrawlJob.html_hash) {
      throw new Error(`Content fingerprinting failed: content_hash or html_hash is missing from ScrapeJob.`);
    }
    console.log(` [PASS] Short-circuited successfully! ScrapeJob completed with content_hash: ${reCrawlJob.content_hash.substring(0, 12)}...`);

    const finalBonusCount = await prisma.bonus.count();
    if (finalBonusCount !== initialBonusCount) {
      throw new Error(`Deduplication failed: Bonus count increased from ${initialBonusCount} to ${finalBonusCount} after short-circuiting!`);
    }
    console.log(` [PASS] No duplicate bonus created during short-circuited ingestion (Bonus count remained ${finalBonusCount}).`);

    console.log("\nStep 8: Verifying Bonus Field Updates & History Audit Event Logging...");
    // Simulate updating bonus fields with differing values
    const updatedBonus = await BonusService.createBonus({
      casino_id: casino1.id,
      type: "WELCOME",
      headline_value: "Exclusive 200% Bonus Up to $1000",
      wagering_requirement: 40,
      max_conversion: 500,
      status: "ACTIVE",
    }, casinoUrl1);

    if (updatedBonus.id !== bonus1.id) {
      throw new Error(`Deduplication failed: Updating fields created a new bonus ${updatedBonus.id} instead of updating ${bonus1.id}`);
    }

    const historyEvents = await prisma.bonusHistoryEvent.findMany({
      where: { bonus_id: bonus1.id },
    });

    if (historyEvents.length === 0) {
      throw new Error("Audit logging failed: No BonusHistoryEvent entries created during bonus update!");
    }
    console.log(` [PASS] Bonus updated in-place and ${historyEvents.length} BonusHistoryEvent records logged:`);
    for (const event of historyEvents) {
      console.log(`   - Field '${event.field_changed}': '${event.old_value}' -> '${event.new_value}' (Source: ${event.source_url})`);
    }

    console.log("\n=================================================");
    console.log("      E2E VERTICAL SLICE VERIFICATION PASSED!     ");
    console.log("=================================================");
  } catch (error: any) {
    console.error("\n[FAILED] E2E Vertical Slice Verification Failed:", error);
    process.exit(1);
  }
}

verifyVerticalSlice();
