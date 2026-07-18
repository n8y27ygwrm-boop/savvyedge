import { IngestionService } from "../src/services/ingestion.service";
import { BonusService } from "../src/services/bonus.service";

async function verifyVerticalSlice() {
  console.log("=================================================");
  console.log("      STARTING E2E VERTICAL SLICE VERIFICATION   ");
  console.log("=================================================\n");

  const casinoUrl1 = "https://spin-casino.com/promotions/welcome";
  const casinoUrl2 = "https://royalvegas.com/promotions/vip";

  try {
    console.log(`Step 1: Ingesting URL 1: ${casinoUrl1}`);
    const result1 = await IngestionService.ingestBonusFromUrl({ url: casinoUrl1 });
    console.log(` -> Ingested Bonus ID: ${result1.bonus.id}`);
    console.log(` -> Attached to Casino ID: ${result1.casino.id} (${result1.casino.name}, slug: ${result1.casino.slug})`);

    console.log(`\nStep 2: Ingesting URL 2: ${casinoUrl2}`);
    const result2 = await IngestionService.ingestBonusFromUrl({ url: casinoUrl2 });
    console.log(` -> Ingested Bonus ID: ${result2.bonus.id}`);
    console.log(` -> Attached to Casino ID: ${result2.casino.id} (${result2.casino.name}, slug: ${result2.casino.slug})`);

    const existingCasinoUrl = "https://spin-casino.com/terms/bonus-rules";
    console.log(`\nStep 3: Ingesting URL from existing domain: ${existingCasinoUrl}`);
    const result3 = await IngestionService.ingestBonusFromUrl({ url: existingCasinoUrl });
    console.log(` -> Ingested Bonus ID: ${result3.bonus.id}`);
    console.log(` -> Attached to Casino ID: ${result3.casino.id} (${result3.casino.name}, slug: ${result3.casino.slug})`);

    console.log("\nStep 4: Validating Entity Resolution & Casino Disambiguation...");
    
    // Check 1: Two distinct casino records for URL1 & URL2
    if (result1.casino.id === result2.casino.id) {
      throw new Error(`Entity Resolution Failed: Both URLs attached to same Casino ID (${result1.casino.id})!`);
    }
    console.log(" [PASS] Two distinct Casino records created for two different URLs.");

    // Check 2: Re-ingested URL matched existing Casino record
    if (result3.casino.id !== result1.casino.id) {
      throw new Error(`Entity Resolution Failed: URL from existing domain created duplicate Casino ID (${result3.casino.id}) instead of matching existing (${result1.casino.id})!`);
    }
    console.log(" [PASS] Ingesting URL from existing domain matched existing Casino record.");

    // Check 3: Bonuses belong to correct casinos
    if (result1.bonus.casino_id !== result1.casino.id) {
      throw new Error(`Bonus 1 casino_id (${result1.bonus.casino_id}) does not match Casino 1 ID (${result1.casino.id})`);
    }
    if (result2.bonus.casino_id !== result2.casino.id) {
      throw new Error(`Bonus 2 casino_id (${result2.bonus.casino_id}) does not match Casino 2 ID (${result2.casino.id})`);
    }
    if (result3.bonus.casino_id !== result1.casino.id) {
      throw new Error(`Bonus 3 casino_id (${result3.bonus.casino_id}) does not match Casino 1 ID (${result1.casino.id})`);
    }
    console.log(" [PASS] Bonuses are correctly attached to their respective Casino records.");

    // Check 4: Canonical benchmark casino fallback is removed
    if (
      result1.casino.slug === "canonical-benchmark-casino" ||
      result2.casino.slug === "canonical-benchmark-casino" ||
      result3.casino.slug === "canonical-benchmark-casino"
    ) {
      throw new Error("Entity Resolution Failed: Pipeline still used 'canonical-benchmark-casino' fallback!");
    }
    console.log(" [PASS] No fallback behavior to Canonical Benchmark Casino detected.");

    console.log("\nStep 4: Querying REST API Service Layer (GET /api/v1/bonuses)...");
    const retrieved = await BonusService.getBonuses({ page: 1, limit: 10 });
    console.log(`Retrieved ${retrieved.data.length} bonuses from Postgres.`);

    const match1 = retrieved.data.find((b) => b.id === result1.bonus.id);
    const match2 = retrieved.data.find((b) => b.id === result2.bonus.id);

    if (match1 && match2) {
      console.log(" [PASS] Both ingested Bonuses retrieved successfully via API layer.");
      console.log(`   - Bonus 1 (Casino: ${(match1 as any).casino?.name}): ${match1.id}`);
      console.log(`   - Bonus 2 (Casino: ${(match2 as any).casino?.name}): ${match2.id}`);
    } else {
      throw new Error("Failed to retrieve both ingested bonuses from API layer.");
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
