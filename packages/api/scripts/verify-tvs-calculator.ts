import { BonusService } from "../src/services/bonus.service";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    process.exit(1);
  }
}

console.log("=== RUNNING REVISED STRICT TVS CALCULATOR VERIFICATION ===");

// 1. "100% up to $500" parses nominal value 500 => score 500/35 = 14.29
const score1 = BonusService.calculateTrueValueScore("100% up to $500", 35);
console.log(`1. Single cap ("100% up to $500", 35x) => ${score1}`);
assert(score1 === 14.29, `Expected 14.29 for "100% up to $500", got: ${score1}`);

// 2. "200% up to €1,000" parses nominal value 1000 => score 1000/25 = 40
const score2 = BonusService.calculateTrueValueScore("200% up to €1,000", 25);
console.log(`2. Comma-formatted cap ("200% up to €1,000", 25x) => ${score2}`);
assert(score2 === 40, `Expected 40 for "200% up to €1,000", got: ${score2}`);

// 3. "100% up to $500 + 100 Free Spins" returns 0
const score3 = BonusService.calculateTrueValueScore("100% up to $500 + 100 Free Spins", 35);
console.log(`3. Monetary cap + Free Spins ("100% up to $500 + 100 Free Spins", 35x) => ${score3}`);
assert(score3 === 0, `Expected 0 for combined free spins, got: ${score3}`);

// 4. "100% up to $500 + 50% up to $250" returns 0
const score4 = BonusService.calculateTrueValueScore("100% up to $500 + 50% up to $250", 35);
console.log(`4. Multiple monetary caps ("100% up to $500 + 50% up to $250", 35x) => ${score4}`);
assert(score4 === 0, `Expected 0 for multiple caps, got: ${score4}`);

// 5. "100% Deposit Match" returns 0
const score5 = BonusService.calculateTrueValueScore("100% Deposit Match", 35);
console.log(`5. Percentage-only ("100% Deposit Match", 35x) => ${score5}`);
assert(score5 === 0, `Expected 0 for percentage-only, got: ${score5}`);

// 6. "100 Free Spins" returns 0
const score6 = BonusService.calculateTrueValueScore("100 Free Spins", 35);
console.log(`6. Free-spins-only ("100 Free Spins", 35x) => ${score6}`);
assert(score6 === 0, `Expected 0 for free-spins-only, got: ${score6}`);

// 7. Empty, malformed, NaN, Infinity, zero-wagering and negative-wagering cases return 0
const scoreEmpty = BonusService.calculateTrueValueScore("", 35);
const scoreNull = BonusService.calculateTrueValueScore(null, 35);
const scoreNoDigits = BonusService.calculateTrueValueScore("Welcome Offer", 35);
const scoreZeroWagering = BonusService.calculateTrueValueScore("100% up to $500", 0);
const scoreNegWagering = BonusService.calculateTrueValueScore("100% up to $500", -10);
const scoreNanWagering = BonusService.calculateTrueValueScore("100% up to $500", NaN);
const scoreInfWagering = BonusService.calculateTrueValueScore("100% up to $500", Infinity);
const scoreNegInfWagering = BonusService.calculateTrueValueScore("100% up to $500", -Infinity);

console.log(`7. Malformed/Zero/Negative/Non-finite => empty:${scoreEmpty}, null:${scoreNull}, noDigits:${scoreNoDigits}, zeroWagering:${scoreZeroWagering}, negWagering:${scoreNegWagering}, nanWagering:${scoreNanWagering}, infWagering:${scoreInfWagering}, negInfWagering:${scoreNegInfWagering}`);
assert(
  scoreEmpty === 0 &&
    scoreNull === 0 &&
    scoreNoDigits === 0 &&
    scoreZeroWagering === 0 &&
    scoreNegWagering === 0 &&
    scoreNanWagering === 0 &&
    scoreInfWagering === 0 &&
    scoreNegInfWagering === 0,
  "All malformed/zero/negative/non-finite cases must return 0"
);

// 8. Confirm no case produces digit concatenation
const nominalConcatenationCheck = BonusService.extractNominalBonusValue("100% up to $500 + 100 Free Spins");
console.log(`8. Digit Concatenation Check (nominal value for "100% up to $500 + 100 Free Spins") => ${nominalConcatenationCheck}`);
assert(nominalConcatenationCheck === 0, "Must not concatenate digits!");

console.log("\n✅ ALL REVISED STRICT TVS CALCULATOR VERIFICATION TESTS PASSED!");
