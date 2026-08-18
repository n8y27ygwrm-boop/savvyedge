/**
 * Lightweight ingestion control-plane entrypoint for the Vercel web runtime.
 *
 * Exposes exactly what the enqueue endpoint needs — authorization + enqueue —
 * so the serverless bundle never reaches the @savvyedge/api root barrel and
 * therefore never loads worker/execution-plane code (@savvyedge/ai-agents,
 * Playwright, orchestrator handlers).
 */
export { verifyApiAuthorization } from "./utils/auth.utils";
export type { AuthCheckResult } from "./utils/auth.utils";
export { IngestionEnqueueService } from "./services/ingestion-enqueue.service";
export type { IngestBonusInput } from "./services/ingestion-enqueue.service";
