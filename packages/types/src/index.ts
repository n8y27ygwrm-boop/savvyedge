import { z } from "zod";

export * from "./evidence-governance";

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
  data_source_type: z.string().optional().default("SCRAPED"),
});

export type Casino = z.infer<typeof CasinoSchema>;

export const CreateCasinoInputSchema = CasinoSchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
  data_source_type: true,
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
  data_source_type: z.string().default("SCRAPED"),
});

export type Bonus = z.infer<typeof BonusSchema>;

export const CreateBonusInputSchema = BonusSchema.omit({
  id: true,
  true_value_score: true, // Calculated by the server
  data_source_type: true, // Set by the server
});

export type CreateBonusInput = z.infer<typeof CreateBonusInputSchema>;

// --- Shared Meta ---

export const PaginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().default(50),
});

// --- Jurisdiction Schemas ---
export const JurisdictionSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  country: z.string().nullable(),
});
export type Jurisdiction = z.infer<typeof JurisdictionSchema>;
export const CreateJurisdictionInputSchema = JurisdictionSchema.omit({ id: true });
export type CreateJurisdictionInput = z.infer<typeof CreateJurisdictionInputSchema>;

// --- Regulator Schemas ---
export const RegulatorSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  jurisdiction_id: z.string().uuid(),
  website_url: z.string().nullable(),
});
export type Regulator = z.infer<typeof RegulatorSchema>;
export const CreateRegulatorInputSchema = RegulatorSchema.omit({ id: true });
export type CreateRegulatorInput = z.infer<typeof CreateRegulatorInputSchema>;

// --- License Schemas ---
export const LicenseSchema = z.object({
  id: z.string().uuid(),
  casino_id: z.string().uuid(),
  regulator_id: z.string().uuid(),
  license_no: z.string(),
  status: z.string(),
  verified_at: z.date().nullable(),
  created_at: z.date(),
  updated_at: z.date(),
});
export type License = z.infer<typeof LicenseSchema>;
export const CreateLicenseInputSchema = LicenseSchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
});
export type CreateLicenseInput = z.infer<typeof CreateLicenseInputSchema>;

// --- JobQueue Schemas ---
export const JobQueueSchema = z.object({
  id: z.string().uuid(),
  queue_name: z.string(),
  task_type: z.string(),
  payload: z.string(),
  status: z.string(),
  attempts: z.number().int().nonnegative(),
  max_attempts: z.number().int().positive(),
  run_at: z.date(),
  locked_until: z.date().nullable(),
  error_log: z.string().nullable(),
  created_at: z.date(),
  updated_at: z.date(),
});
export type JobQueue = z.infer<typeof JobQueueSchema>;
export const CreateJobQueueInputSchema = JobQueueSchema.omit({
  id: true,
  attempts: true,
  locked_until: true,
  error_log: true,
  created_at: true,
  updated_at: true,
});
export type CreateJobQueueInput = z.infer<typeof CreateJobQueueInputSchema>;

