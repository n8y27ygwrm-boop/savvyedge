/**
 * Lightweight extraction-context vocabulary shared across runtime boundaries.
 *
 * Keep this module dependency-free: Vercel-facing evidence readers import it
 * without pulling the ingestion worker, AI providers, or browser runtime into
 * their serverless bundles.
 */
export const BONUS_EXTRACTION_CONTEXT = "BONUS" as const;
