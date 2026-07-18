import { z } from "zod";

export const ClassificationResultSchema = z.object({
  category: z.string(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().optional(),
});

export type ClassificationResult = z.infer<typeof ClassificationResultSchema>;

export const EntityComparisonSchema = z.object({
  summary: z.string(),
  differences: z.array(z.string()),
  winnerId: z.string().optional(),
  scoreA: z.number().optional(),
  scoreB: z.number().optional(),
});

export type EntityComparison = z.infer<typeof EntityComparisonSchema>;

export const ReviewSummarySchema = z.object({
  headline: z.string(),
  keyTakeaways: z.array(z.string()),
  pros: z.array(z.string()),
  cons: z.array(z.string()),
  overallRating: z.number().min(0).max(10),
});

export type ReviewSummary = z.infer<typeof ReviewSummarySchema>;
