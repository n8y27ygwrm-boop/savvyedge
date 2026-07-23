import { chromium } from "playwright";
import path from "path";

async function captureScreenshots() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();

  const artifactsDir = "/Users/redjonhalilaj/.gemini/antigravity-ide/brain/fc7f8d7b-ee08-4738-b3d0-bb45719a7698";

  console.log("Capturing Homepage screenshot...");
  await page.goto("http://localhost:3001/", { waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(artifactsDir, "phase1_trust_homepage_desktop.png"), fullPage: false });

  console.log("Capturing Casino Directory screenshot...");
  await page.goto("http://localhost:3001/casinos", { waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(artifactsDir, "phase1_trust_casinos_desktop.png"), fullPage: false });

  console.log("Capturing Bonus Directory screenshot...");
  await page.goto("http://localhost:3001/bonuses", { waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(artifactsDir, "phase1_trust_bonuses_desktop.png"), fullPage: false });

  console.log("Capturing Comparison page screenshot...");
  await page.goto("http://localhost:3001/compare", { waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(artifactsDir, "phase1_trust_compare_desktop.png"), fullPage: false });

  console.log("Capturing Slots page screenshot...");
  await page.goto("http://localhost:3001/slots", { waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(artifactsDir, "phase1_trust_slots_desktop.png"), fullPage: false });

  await browser.close();
  console.log("✓ All desktop screenshots captured successfully!");
}

captureScreenshots().catch((err) => {
  console.error("Screenshot capture failed:", err);
  process.exit(1);
});
