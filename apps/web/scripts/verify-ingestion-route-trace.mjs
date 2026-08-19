import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDirectory, "..");
const tracePath = path.join(
  webRoot,
  ".next/server/app/api/v1/ingestion/jobs/route.js.nft.json",
);
const routePath = path.join(
  webRoot,
  ".next/server/app/api/v1/ingestion/jobs/route.js",
);

if (!fs.existsSync(tracePath) || !fs.existsSync(routePath)) {
  throw new Error(
    "Built ingestion route trace is missing; run the web production build first",
  );
}

const trace = JSON.parse(fs.readFileSync(tracePath, "utf8"));
if (!Array.isArray(trace.files)) {
  throw new Error("Built ingestion route trace has an invalid files list");
}

const normalizedFiles = trace.files.map((file) =>
  String(file).replaceAll("\\", "/"),
);
const forbiddenPathPatterns = [
  /(?:^|\/)packages\/ai-agents(?:\/|$)/i,
  /(?:^|\/)playwright(?:-core)?(?:\/|$|@)/i,
  /(?:^|\/)\.local-browsers(?:\/|$)/i,
  /(?:^|\/)@ai-sdk(?:\/|\+|$)/i,
  /(?:^|\/)node_modules\/\.pnpm\/ai@/i,
  /scrapingant-fallback\.service/i,
];
const pathViolations = normalizedFiles.filter((file) =>
  forbiddenPathPatterns.some((pattern) => pattern.test(file)),
);

const traceDirectory = path.dirname(tracePath);
const inspectableFiles = [
  routePath,
  ...trace.files
    .map((file) => path.resolve(traceDirectory, String(file)))
    .filter((file) => /\.(?:cjs|js|mjs)$/.test(file) && fs.existsSync(file)),
];
const forbiddenRuntimePatterns = [
  /api\.scrapingant\.com\/v2\/general/i,
  /ScrapingAntFallbackService/,
  /buildScrapeResultFromHtml/,
  /playwright-core/i,
  /@savvyedge\/ai-agents/i,
];
const contentViolations = [];
for (const file of new Set(inspectableFiles)) {
  const source = fs.readFileSync(file, "utf8");
  for (const pattern of forbiddenRuntimePatterns) {
    if (pattern.test(source)) {
      contentViolations.push(
        `${path.relative(webRoot, file).replaceAll("\\", "/")} matched ${pattern}`,
      );
    }
  }
}

if (pathViolations.length > 0 || contentViolations.length > 0) {
  throw new Error(
    `Ingestion route includes execution-plane runtime:\n${[
      ...pathViolations,
      ...contentViolations,
    ].join("\n")}`,
  );
}

console.log(
  `Verified isolated ingestion route trace (${normalizedFiles.length} traced files)`,
);
