import { z } from "zod";

// --- Casino Schemas ---

export const CasinoSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  license_info: z.string().nullable(),
  status: z.string(),
  website_url: z.string().nullable(),
  created_at: z.date(),
  updated_at: z.date(),
  verified_at: z.date().nullable(),
});

export type Casino = z.infer<typeof CasinoSchema>;

export const CreateCasinoInputSchema = CasinoSchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
});

export type CreateCasinoInput = z.infer<typeof CreateCasinoInputSchema>;

// --- Bonus Schemas ---

export const BonusSchema = z.object({
  id: z.string().uuid(),
  casino_id: z.string().uuid(),
  type: z.string(),
  headline_value: z.string().nullable(),
  wagering_requirement: z.number().nullable(),
  max_conversion: z.number().nullable(),
  true_value_score: z.number().nullable(),
  valid_from: z.date().nullable(),
  valid_until: z.date().nullable(),
  status: z.string(),
});

export type Bonus = z.infer<typeof BonusSchema>;

export const CreateBonusInputSchema = BonusSchema.omit({
  id: true,
  true_value_score: true, // Calculated by the server
});

export type CreateBonusInput = z.infer<typeof CreateBonusInputSchema>;

// --- Shared Meta ---

export const PaginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().default(50),
});
