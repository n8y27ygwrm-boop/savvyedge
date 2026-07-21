import { prisma } from "@savvyedge/database";
import { BonusService } from "../src/services/bonus.service";

async function main() {
  console.log("=== STARTING TRUE VALUE SCORE BACKFILL ===");

  const bonuses = await prisma.bonus.findMany();
  let totalChecked = 0;
  let totalCorrected = 0;

  for (const bonus of bonuses) {
    totalChecked++;
    const recomputed = BonusService.calculateTrueValueScore(
      bonus.headline_value,
      bonus.wagering_requirement,
      bonus.max_conversion
    );

    const oldScore = bonus.true_value_score;

    // Compare with epsilon tolerance for float differences
    const isDifferent =
      oldScore === null || Math.abs(oldScore - recomputed) > 0.001;

    if (isDifferent) {
      await prisma.bonus.update({
        where: { id: bonus.id },
        data: { true_value_score: recomputed },
      });
      totalCorrected++;
      console.log(`[Backfill] Bonus ${bonus.id}: ${oldScore} -> ${recomputed}`);
    }
  }

  console.log("\n=== BACKFILL SUMMARY ===");
  console.log(`Total Checked: ${totalChecked}`);
  console.log(`Total Corrected: ${totalCorrected}`);
}

main()
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
