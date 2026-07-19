import { BonusService, HOUSE_EDGE_ASSUMPTION } from "../src/services/bonus.service";

async function verifyBonusEV() {
  console.log("=================================================");
  console.log("      VERIFYING BONUS EV CALCULATION SERVICE     ");
  console.log("=================================================\n");

  console.log(`HOUSE_EDGE_ASSUMPTION constant: ${HOUSE_EDGE_ASSUMPTION}`);

  // Test Case 1: Standard 100% up to €500 with 35x wagering
  const res1 = BonusService.calculateBonusEV({
    depositAmount: 100,
    headlineValue: "100% up to €500",
    wageringRequirement: 35,
    maxConversion: 500,
    validUntil: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
    gameContributionPct: 100,
  });

  console.log("\nTest Case 1 (100% up to €500, €100 deposit, 35x):", res1);
  if (res1.bonusAmount !== 100) throw new Error(`Expected bonusAmount 100, got ${res1.bonusAmount}`);
  if (res1.totalWageringRequired !== 7000) throw new Error(`Expected totalWageringRequired 7000, got ${res1.totalWageringRequired}`);
  if (res1.expectedValue !== -110) throw new Error(`Expected EV -110, got ${res1.expectedValue}`);
  if (res1.daysUntilExpiry !== 10) throw new Error(`Expected daysUntilExpiry 10, got ${res1.daysUntilExpiry}`);
  if (res1.houseEdgeUsed !== 0.03) throw new Error(`Expected houseEdgeUsed 0.03, got ${res1.houseEdgeUsed}`);
  if (res1.houseEdgeSource !== "default_assumption") throw new Error(`Expected houseEdgeSource default_assumption, got ${res1.houseEdgeSource}`);

  // Test Case 2: Positive EV bonus (Low 5x wagering on €50 bonus)
  const res2 = BonusService.calculateBonusEV({
    depositAmount: 50,
    headlineValue: "100% up to €100",
    wageringRequirement: 5,
    maxConversion: null,
    validUntil: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    gameContributionPct: 100,
  });

  console.log("\nTest Case 2 (Low 5x wagering, €50 deposit):", res2);
  if (res2.bonusAmount !== 50) throw new Error(`Expected bonusAmount 50, got ${res2.bonusAmount}`);
  if (res2.totalWageringRequired !== 500) throw new Error(`Expected totalWageringRequired 500, got ${res2.totalWageringRequired}`);
  if (res2.expectedValue !== 35) throw new Error(`Expected EV 35, got ${res2.expectedValue}`);
  if (res2.daysUntilExpiry !== 3) throw new Error(`Expected daysUntilExpiry 3, got ${res2.daysUntilExpiry}`);

  // Test Case 3: Reduced game contribution (50%)
  const res3 = BonusService.calculateBonusEV({
    depositAmount: 100,
    headlineValue: "100% up to €500",
    wageringRequirement: 35,
    maxConversion: 500,
    validUntil: null,
    gameContributionPct: 50,
  });

  console.log("\nTest Case 3 (50% game contribution):", res3);
  if (res3.totalWageringRequired !== 14000) throw new Error(`Expected totalWageringRequired 14000, got ${res3.totalWageringRequired}`);

  // Test Case 4 (RTP-based house edge): slotRtp = 94.2 -> houseEdgeUsed = 0.058, houseEdgeSource = "slot_rtp"
  const res4 = BonusService.calculateBonusEV({
    depositAmount: 100,
    headlineValue: "100% up to €500",
    wageringRequirement: 35,
    maxConversion: 500,
    validUntil: null,
    gameContributionPct: 100,
    slotRtp: 94.2,
  });

  console.log("\nTest Case 4 (Slot RTP 94.2%):", res4);
  if (res4.houseEdgeUsed !== 0.058) throw new Error(`Expected houseEdgeUsed 0.058, got ${res4.houseEdgeUsed}`);
  if (res4.houseEdgeSource !== "slot_rtp") throw new Error(`Expected houseEdgeSource slot_rtp, got ${res4.houseEdgeSource}`);

  // Test Case 5 (Capped Payout): expectedValue (35) + bonusAmount (50) = 85 > maxConversion (60)
  const res5 = BonusService.calculateBonusEV({
    depositAmount: 50,
    headlineValue: "100% up to €100",
    wageringRequirement: 5,
    maxConversion: 60,
    validUntil: null,
    gameContributionPct: 100,
  });

  console.log("\nTest Case 5 (Capped payout max_conversion=60):", res5);
  if (!res5.isCapped) throw new Error(`Expected isCapped true, got ${res5.isCapped}`);
  if (res5.cappedPayout !== 60) throw new Error(`Expected cappedPayout 60, got ${res5.cappedPayout}`);

  // Test Case 6 (Over-cap deposit parsing): depositAmount = 800 for 100% up to €500
  const res6 = BonusService.calculateBonusEV({
    depositAmount: 800,
    headlineValue: "100% up to €500",
    wageringRequirement: 35,
    maxConversion: 1000,
    validUntil: null,
    gameContributionPct: 100,
  });

  console.log("\nTest Case 6 (Deposit €800 with 100% up to €500):", res6);
  if (res6.bonusAmount !== 500) throw new Error(`Expected bonusAmount 500, got ${res6.bonusAmount}`);

  // Test Case 7 (Null expiry): validUntil = null
  const res7 = BonusService.calculateBonusEV({
    depositAmount: 100,
    headlineValue: "100% up to €500",
    wageringRequirement: 35,
    maxConversion: null,
    validUntil: null,
    gameContributionPct: 100,
  });

  console.log("\nTest Case 7 (validUntil = null):", res7);
  if (res7.daysUntilExpiry !== null) throw new Error(`Expected daysUntilExpiry null, got ${res7.daysUntilExpiry}`);

  // Test Case 8 (Zero deposit): depositAmount = 0
  const res8 = BonusService.calculateBonusEV({
    depositAmount: 0,
    headlineValue: "100% up to €500",
    wageringRequirement: 35,
    maxConversion: 500,
    validUntil: null,
    gameContributionPct: 100,
  });

  console.log("\nTest Case 8 (depositAmount = 0):", res8);
  if (res8.bonusAmount !== 0) throw new Error(`Expected bonusAmount 0, got ${res8.bonusAmount}`);
  if (res8.totalWageringRequired !== 0) throw new Error(`Expected totalWageringRequired 0, got ${res8.totalWageringRequired}`);

  // Test Case 9 (Unrecognized headline formats return 0):
  const unibetParsed = BonusService.parseBonusAmount("€25 Free Bet + €500 Bonus", 200);
  const casumoParsed = BonusService.parseBonusAmount("50 Free Spins No Deposit", 20);
  console.log("\nTest Case 9 (Unrecognized headlines return 0):", { unibetParsed, casumoParsed });
  if (unibetParsed !== 0) throw new Error(`Expected parseBonusAmount to return 0 for Unibet, got ${unibetParsed}`);
  if (casumoParsed !== 0) throw new Error(`Expected parseBonusAmount to return 0 for Casumo, got ${casumoParsed}`);

  // Test Case 10 (isCalculable assertion):
  const resUnibet = BonusService.calculateBonusEV({
    depositAmount: 100,
    headlineValue: "€25 Free Bet + €500 Bonus",
    wageringRequirement: 35,
    maxConversion: 500,
    validUntil: null,
    gameContributionPct: 100,
  });
  if (resUnibet.isCalculable !== false) throw new Error(`Expected isCalculable false for Unibet, got ${resUnibet.isCalculable}`);

  const res100Pct = BonusService.calculateBonusEV({
    depositAmount: 100,
    headlineValue: "100% up to €500",
    wageringRequirement: 35,
    maxConversion: 500,
    validUntil: null,
    gameContributionPct: 100,
  });
  if (res100Pct.isCalculable !== true) throw new Error(`Expected isCalculable true for 100%, got ${res100Pct.isCalculable}`);
  
  console.log("\nTest Case 10 (isCalculable logic):", { resUnibetIsCalculable: resUnibet.isCalculable, res100PctIsCalculable: res100Pct.isCalculable });

  console.log("\n✅ ALL BONUS EV CALCULATION TESTS PASSED!");
}

verifyBonusEV();
