import { BonusAgent } from "./src/agents/all-agents";

async function main() {
  const agent = new BonusAgent();

  const text1 = "Get 200% up to $1000 + 50 Free Spins with 40x wagering requirement and max cashout $2000!";
  const text2 = "Special promotion: 100 Free Spins with 25x wagering requirement and max payout $500";

  console.log("INPUT 1:");
  console.log(text1);
  console.log("OUTPUT 1:");
  const res1 = await agent.run({
    rawBonusText: text1,
    casino_id: "11111111-1111-1111-1111-111111111111",
  });
  console.log(JSON.stringify(res1, null, 2));

  console.log("\nINPUT 2:");
  console.log(text2);
  console.log("OUTPUT 2:");
  const res2 = await agent.run({
    rawBonusText: text2,
    casino_id: "22222222-2222-2222-2222-222222222222",
  });
  console.log(JSON.stringify(res2, null, 2));
}

main().catch(console.error);
