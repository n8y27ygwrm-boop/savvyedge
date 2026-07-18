import { IngestionService } from "../src/services/ingestion.service";
import * as fs from "fs";

const REAL_CASINO_URLS = [
  "https://www.askgamblers.com/online-casinos/bonuses/",
  "https://www.casinos.com/us/bonuses",
  "https://www.gambling.com/us/online-casinos/bonuses",
];

async function verifyRealScraping() {
  console.log("=================================================");
  console.log("   STARTING REAL PLAYWRIGHT SCRAPING VERIFICATION ");
  console.log("=================================================\n");

  let successCount = 0;

  for (let i = 0; i < REAL_CASINO_URLS.length; i++) {
    const url = REAL_CASINO_URLS[i];
    console.log(`\n[${i + 1}/${REAL_CASINO_URLS.length}] Processing URL: ${url}`);

    try {
      const result = await IngestionService.ingestBonusFromUrl({ url });

      console.log(` -> Scraped Content Length: ${result.meta.extractedContentLength} bytes`);
      console.log(` -> Ingested Bonus ID: ${result.bonus.id}`);
      console.log(` -> Linked Casino ID: ${result.casino.id} (${result.casino.name}, website: ${result.casino.website_url})`);
      console.log(` -> Audit ScrapeJob Status: ${result.scrapeJob.status} (ID: ${result.scrapeJob.id})`);
      console.log(` -> HTML Snapshot Path: ${result.scrapeJob.snapshot_path}`);

      // Verification checks
      if (result.scrapeJob.status !== "COMPLETED") {
        throw new Error(`ScrapeJob status is not COMPLETED (got ${result.scrapeJob.status})`);
      }

      if (!result.scrapeJob.snapshot_path) {
        throw new Error("No snapshot_path saved to ScrapeJob in database!");
      }

      if (!fs.existsSync(result.scrapeJob.snapshot_path)) {
        throw new Error(`HTML snapshot file does not exist on disk at path: ${result.scrapeJob.snapshot_path}`);
      }

      const fileSize = fs.statSync(result.scrapeJob.snapshot_path).size;
      if (fileSize === 0) {
        throw new Error(`HTML snapshot file is empty (0 bytes) at path: ${result.scrapeJob.snapshot_path}`);
      }

      console.log(` [PASS] Playwright scraped JS rendered page successfully. HTML snapshot verified on disk (${fileSize} bytes).`);
      successCount++;
    } catch (err: any) {
      console.error(` [FAIL] Scraping failed for ${url}:`, err.message);
    }
  }

  console.log("\n=================================================");
  console.log(`   SCRAPING VERIFICATION COMPLETE (${successCount}/${REAL_CASINO_URLS.length} PASSED)`);
  console.log("=================================================");

  if (successCount < REAL_CASINO_URLS.length) {
    process.exit(1);
  }
}

verifyRealScraping();
