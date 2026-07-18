import { IngestionService } from "../src/services/ingestion.service";
import { BonusService } from "../src/services/bonus.service";

async function verifyVerticalSlice() {
  console.log("=================================================");
  console.log("      STARTING E2E VERTICAL SLICE VERIFICATION   ");
  console.log("=================================================\n");

  const targetUrl = "https://example.com";
  console.log(`Step 1: Triggering Ingestion Pipeline for target URL: ${targetUrl}`);

  try {
    const result = await IngestionService.ingestBonusFromUrl({ url: targetUrl });
    console.log("\n[SUCCESS] Pipeline Executed Successfully!");
    console.log("-------------------------------------------------");
    console.log("1. Scraped & Cleaned Content Length:", result.meta.extractedContentLength, "bytes");
    console.log("2. Audit ScrapeJob Created ID:", result.scrapeJob.id);
    console.log("3. Bonus Record Persisted to Postgres:");
    console.log(JSON.stringify(result.bonus, null, 2));

    console.log("\nStep 2: Querying REST API Service Layer (GET /api/v1/bonuses)...");
    const retrieved = await BonusService.getBonuses({ page: 1, limit: 10 });
    console.log(`Retrieved ${retrieved.data.length} bonuses from Postgres.`);

    const matched = retrieved.data.find((b) => b.id === result.bonus.id);
    if (matched) {
      console.log("\n[VERIFIED] Newly ingested Bonus record was successfully retrieved from Postgres via API layer!");
      console.log(`Matched Bonus ID: ${matched.id}, Headline: "${matched.headline_value}", True Value Score: ${matched.true_value_score}`);
    } else {
      throw new Error(`Failed to find bonus ${result.bonus.id} in API query results.`);
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
