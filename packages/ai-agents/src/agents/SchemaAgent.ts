import { z } from "zod";
import { BaseAgent, AgentContext } from "../core/BaseAgent";
import { CreateCasinoInputSchema, CreateCasinoInput, CreateBonusInputSchema, CreateBonusInput } from "@savvyedge/types";

export const SchemaInputSchema = z.object({
  rawContent: z.string(),
  targetEntity: z.enum(["Casino", "Bonus"]),
});

// A union type of all possible valid output schemas
export const SchemaOutputSchema = z.union([
  CreateCasinoInputSchema,
  CreateBonusInputSchema,
]);

export type SchemaInput = z.infer<typeof SchemaInputSchema>;
export type SchemaOutput = CreateCasinoInput | CreateBonusInput;

export class SchemaAgent extends BaseAgent<SchemaInput, SchemaOutput> {
  protected inputSchema = SchemaInputSchema;
  protected outputSchema = SchemaOutputSchema;

  protected async execute(input: SchemaInput, context?: AgentContext): Promise<SchemaOutput> {
    // Stub implementation
    // Future: Call LLM API with 'rawContent' and 'targetEntity', 
    // requesting JSON output that matches the respective Zod Schema.
    console.log(`[SchemaAgent] Structuring ${input.targetEntity} from raw content...`);

    if (input.targetEntity === "Casino") {
      return {
        slug: "stub-casino",
        name: "Stub Casino",
        status: "ACTIVE",
        license_info: "Mock License",
        website_url: "https://example.com",
        verified_at: new Date(),
      };
    } else {
      return {
        casino_id: "00000000-0000-0000-0000-000000000000",
        type: "WELCOME_BONUS",
        headline_value: "100% up to 100",
        wagering_requirement: 35,
        max_conversion: 500,
        valid_from: new Date(),
        valid_until: null,
        status: "ACTIVE",
      };
    }
  }
}
