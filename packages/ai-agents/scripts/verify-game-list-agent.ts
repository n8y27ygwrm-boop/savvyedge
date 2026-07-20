import { GameListAgent } from "./src/agents/GameListAgent";

async function main() {
  const agent = new GameListAgent();

  const lobby1 = `
    Content:
    1. Starburst by NetEnt
    2. Book of Dead
    3. Sweet Bonanza by Pragmatic Play
  `;

  const lobby2 = `
    Content:
    - Dead or Alive 2 by NetEnt
    - Mega Moolah by Microgaming
    - Reactoonz
    - Immortal Romance by Microgaming
  `;

  console.log("=== TEST 1 (3 games) ===");
  const res1 = await agent.run({
    url: "https://casino1.com/lobby",
    casinoId: "11111111-1111-1111-1111-111111111111",
    scrapedContent: lobby1,
  });
  console.log(JSON.stringify(res1, null, 2));

  console.log("\n=== TEST 2 (4 games) ===");
  const res2 = await agent.run({
    url: "https://casino2.com/lobby",
    casinoId: "22222222-2222-2222-2222-222222222222",
    scrapedContent: lobby2,
  });
  console.log(JSON.stringify(res2, null, 2));
}

main().catch(console.error);
