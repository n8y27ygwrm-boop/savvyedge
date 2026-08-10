import {
  isD2AcceptanceEnabled,
  validateD2DatabaseUrl,
} from "../tests/helpers/d2-acceptance-database-guard";

async function main() {
  if (!isD2AcceptanceEnabled()) {
    console.error(
      "\n[D2 SAFETY ERROR] SAVVYEDGE_D2_ACCEPTANCE=1 is required in the environment to execute the D2 acceptance harness.\n",
    );
    process.exit(1);
  }

  const safety = validateD2DatabaseUrl(process.env.DATABASE_URL);
  if (!safety.safe) {
    console.error(
      `\n[D2 SAFETY ERROR] Database validation failed: ${safety.reason}\n`,
    );
    process.exit(1);
  }

  // Dynamically import the database runner ONLY after safety checks pass
  const { executeD2AcceptanceRunner } = await import(
    "../tests/helpers/d2-vertical-slice.runner"
  );
  const { prisma } = await import("@savvyedge/database");

  try {
    const result = await executeD2AcceptanceRunner({ log: console.log });

    console.log("=================================================");
    console.log("             D2 ACCEPTANCE SUMMARY               ");
    console.log("=================================================");
    console.log(` -> Run ID:            ${result.runId}`);
    console.log(` -> Synthetic Domain:  ${result.domain}`);
    console.log(` -> Casino ID:         ${result.casinoId}`);
    console.log(` -> Bonus ID:          ${result.bonusId}`);
    console.log(` -> License ID:        ${result.licenseId}`);
    console.log(` -> Stages Completed:  ${result.stagesCompleted} / 11`);
    console.log("=================================================");
    console.log("         D2_END_TO_END_ACCEPTANCE: PASS          ");
    console.log("=================================================\n");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("\n[FATAL] D2 Acceptance Harness Failed:", err);
  process.exit(1);
});
