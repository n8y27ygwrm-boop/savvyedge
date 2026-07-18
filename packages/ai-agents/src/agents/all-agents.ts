import { z } from "zod";
import { BaseAgent } from "../core/BaseAgent";
import { AIEngine } from "../engine/ai.engine";
import { CreateCasinoInputSchema, CreateBonusInputSchema, CreateCasinoInput, CreateBonusInput } from "@savvyedge/types";

const engine = new AIEngine();

// 1. Research Agent
const ResearchInputSchema = z.object({ topic: z.string() });
type ResearchInput = z.infer<typeof ResearchInputSchema>;
const ResearchOutputSchema = z.object({ summary: z.string(), sources: z.array(z.string()) });
type ResearchOutput = z.infer<typeof ResearchOutputSchema>;

export class ResearchAgent extends BaseAgent<ResearchInput, ResearchOutput> {
  protected inputSchema = ResearchInputSchema;
  protected outputSchema = ResearchOutputSchema;
  protected async execute(input: ResearchInput) {
    const res = await engine.generateStructuredObject(`Research topic: ${input.topic}`, this.outputSchema);
    return res.data;
  }
}

// 2. Casino Discovery Agent
const CasinoDiscoveryInputSchema = z.object({ geoRegion: z.string() });
type CasinoDiscoveryInput = z.infer<typeof CasinoDiscoveryInputSchema>;
const CasinoDiscoveryOutputSchema = z.object({ discoveredCasinos: z.array(z.string()) });
type CasinoDiscoveryOutput = z.infer<typeof CasinoDiscoveryOutputSchema>;

export class CasinoDiscoveryAgent extends BaseAgent<CasinoDiscoveryInput, CasinoDiscoveryOutput> {
  protected inputSchema = CasinoDiscoveryInputSchema;
  protected outputSchema = CasinoDiscoveryOutputSchema;
  protected async execute(input: CasinoDiscoveryInput) {
    const res = await engine.generateStructuredObject(`Discover active online casinos operating in region: ${input.geoRegion}`, this.outputSchema);
    return res.data;
  }
}

// 3. Bonus Agent
const BonusInputSchema = z.object({ rawBonusText: z.string(), casino_id: z.string().uuid() });
type BonusInput = z.infer<typeof BonusInputSchema>;

export class BonusAgent extends BaseAgent<BonusInput, CreateBonusInput> {
  protected inputSchema = BonusInputSchema;
  protected outputSchema = CreateBonusInputSchema;
  protected async execute(input: BonusInput) {
    const prompt = `Extract bonus information for casino ID '${input.casino_id}' from the raw text below:\n\n${input.rawBonusText}`;
    const res = await engine.generateStructuredObject(prompt, this.outputSchema);
    return res.data;
  }
}

// 4. Review Agent
const ReviewInputSchema = z.object({ rawReviewText: z.string() });
type ReviewInput = z.infer<typeof ReviewInputSchema>;
const ReviewOutputSchema = z.object({ headline: z.string(), pros: z.array(z.string()), cons: z.array(z.string()) });
type ReviewOutput = z.infer<typeof ReviewOutputSchema>;

export class ReviewAgent extends BaseAgent<ReviewInput, ReviewOutput> {
  protected inputSchema = ReviewInputSchema;
  protected outputSchema = ReviewOutputSchema;
  protected async execute(input: ReviewInput) {
    const res = await engine.generateStructuredObject(`Analyze casino review: ${input.rawReviewText}`, this.outputSchema);
    return res.data;
  }
}

// 5. SEO Agent
const SEOInputSchema = z.object({ content: z.string() });
type SEOInput = z.infer<typeof SEOInputSchema>;
const SEOOutputSchema = z.object({ targetKeywords: z.array(z.string()), metaTitle: z.string(), metaDescription: z.string() });
type SEOOutput = z.infer<typeof SEOOutputSchema>;

export class SEOAgent extends BaseAgent<SEOInput, SEOOutput> {
  protected inputSchema = SEOInputSchema;
  protected outputSchema = SEOOutputSchema;
  protected async execute(input: SEOInput) {
    const res = await engine.generateStructuredObject(`Generate SEO metadata for content: ${input.content}`, this.outputSchema);
    return res.data;
  }
}

// 6. Content Agent
const ContentInputSchema = z.object({ topic: z.string(), tone: z.string().default("analytical") });
type ContentInput = z.infer<typeof ContentInputSchema>;
const ContentOutputSchema = z.object({ title: z.string(), bodyMarkdown: z.string() });
type ContentOutput = z.infer<typeof ContentOutputSchema>;

export class ContentAgent extends BaseAgent<ContentInput, ContentOutput> {
  protected inputSchema = ContentInputSchema;
  protected outputSchema = ContentOutputSchema;
  protected async execute(input: ContentInput) {
    const res = await engine.generateStructuredObject(`Write analytical data article on: ${input.topic}`, this.outputSchema);
    return res.data;
  }
}

// 7. Translation Agent
const TranslationInputSchema = z.object({ text: z.string(), targetLanguage: z.string() });
type TranslationInput = z.infer<typeof TranslationInputSchema>;
const TranslationOutputSchema = z.object({ translatedText: z.string() });
type TranslationOutput = z.infer<typeof TranslationOutputSchema>;

export class TranslationAgent extends BaseAgent<TranslationInput, TranslationOutput> {
  protected inputSchema = TranslationInputSchema;
  protected outputSchema = TranslationOutputSchema;
  protected async execute(input: TranslationInput) {
    const res = await engine.generateStructuredObject(`Translate to ${input.targetLanguage}: ${input.text}`, this.outputSchema);
    return res.data;
  }
}

// 8. License Verification Agent
const LicenseVerificationInputSchema = z.object({ casinoName: z.string(), licenseNumber: z.string() });
type LicenseVerificationInput = z.infer<typeof LicenseVerificationInputSchema>;
const LicenseVerificationOutputSchema = z.object({ isValid: z.boolean(), issuer: z.string() });
type LicenseVerificationOutput = z.infer<typeof LicenseVerificationOutputSchema>;

export class LicenseVerificationAgent extends BaseAgent<LicenseVerificationInput, LicenseVerificationOutput> {
  protected inputSchema = LicenseVerificationInputSchema;
  protected outputSchema = LicenseVerificationOutputSchema;
  protected async execute(input: LicenseVerificationInput) {
    const res = await engine.generateStructuredObject(`Verify license ${input.licenseNumber} for ${input.casinoName}`, this.outputSchema);
    return res.data;
  }
}

// 9. Payment Methods Agent
const PaymentMethodsInputSchema = z.object({ text: z.string() });
type PaymentMethodsInput = z.infer<typeof PaymentMethodsInputSchema>;
const PaymentMethodsOutputSchema = z.object({ depositMethods: z.array(z.string()), withdrawalMethods: z.array(z.string()) });
type PaymentMethodsOutput = z.infer<typeof PaymentMethodsOutputSchema>;

export class PaymentMethodsAgent extends BaseAgent<PaymentMethodsInput, PaymentMethodsOutput> {
  protected inputSchema = PaymentMethodsInputSchema;
  protected outputSchema = PaymentMethodsOutputSchema;
  protected async execute(input: PaymentMethodsInput) {
    const res = await engine.generateStructuredObject(`Extract payment methods from text: ${input.text}`, this.outputSchema);
    return res.data;
  }
}

// 10. GEO Agent
const GEOInputSchema = z.object({ ipOrCountry: z.string() });
type GEOInput = z.infer<typeof GEOInputSchema>;
const GEOOutputSchema = z.object({ restrictedCasinos: z.array(z.string()), legalStatus: z.string() });
type GEOOutput = z.infer<typeof GEOOutputSchema>;

export class GEOAgent extends BaseAgent<GEOInput, GEOOutput> {
  protected inputSchema = GEOInputSchema;
  protected outputSchema = GEOOutputSchema;
  protected async execute(input: GEOInput) {
    const res = await engine.generateStructuredObject(`Determine iGaming legal status in GEO: ${input.ipOrCountry}`, this.outputSchema);
    return res.data;
  }
}

// 11. Competitor Intelligence Agent
const CompetitorIntelInputSchema = z.object({ competitorUrl: z.string().url() });
type CompetitorIntelInput = z.infer<typeof CompetitorIntelInputSchema>;
const CompetitorIntelOutputSchema = z.object({ bonusChangesDetected: z.array(z.string()), rtpShifts: z.array(z.string()) });
type CompetitorIntelOutput = z.infer<typeof CompetitorIntelOutputSchema>;

export class CompetitorIntelAgent extends BaseAgent<CompetitorIntelInput, CompetitorIntelOutput> {
  protected inputSchema = CompetitorIntelInputSchema;
  protected outputSchema = CompetitorIntelOutputSchema;
  protected async execute(input: CompetitorIntelInput) {
    const res = await engine.generateStructuredObject(`Extract competitor intelligence from: ${input.competitorUrl}`, this.outputSchema);
    return res.data;
  }
}

// 12. Data Validation Agent
const DataValidationInputSchema = z.object({ entityData: z.record(z.any()) });
type DataValidationInput = z.infer<typeof DataValidationInputSchema>;
const DataValidationOutputSchema = z.object({ isCompliant: z.boolean(), discrepancies: z.array(z.string()) });
type DataValidationOutput = z.infer<typeof DataValidationOutputSchema>;

export class DataValidationAgent extends BaseAgent<DataValidationInput, DataValidationOutput> {
  protected inputSchema = DataValidationInputSchema;
  protected outputSchema = DataValidationOutputSchema;
  protected async execute(input: DataValidationInput) {
    const res = await engine.generateStructuredObject(`Audit entity data for accuracy: ${JSON.stringify(input.entityData)}`, this.outputSchema);
    return res.data;
  }
}

// 13. Image Analysis Agent
const ImageAnalysisInputSchema = z.object({ imageUrl: z.string().url() });
type ImageAnalysisInput = z.infer<typeof ImageAnalysisInputSchema>;
const ImageAnalysisOutputSchema = z.object({ extractedText: z.string(), containsDisclaimers: z.boolean() });
type ImageAnalysisOutput = z.infer<typeof ImageAnalysisOutputSchema>;

export class ImageAnalysisAgent extends BaseAgent<ImageAnalysisInput, ImageAnalysisOutput> {
  protected inputSchema = ImageAnalysisInputSchema;
  protected outputSchema = ImageAnalysisOutputSchema;
  protected async execute(input: ImageAnalysisInput) {
    const res = await engine.generateStructuredObject(`Analyze promotional image at: ${input.imageUrl}`, this.outputSchema);
    return res.data;
  }
}

// 14. Video Analysis Agent
const VideoAnalysisInputSchema = z.object({ videoUrl: z.string().url() });
type VideoAnalysisInput = z.infer<typeof VideoAnalysisInputSchema>;
const VideoAnalysisOutputSchema = z.object({ summary: z.string(), highlightedFeatures: z.array(z.string()) });
type VideoAnalysisOutput = z.infer<typeof VideoAnalysisOutputSchema>;

export class VideoAnalysisAgent extends BaseAgent<VideoAnalysisInput, VideoAnalysisOutput> {
  protected inputSchema = VideoAnalysisInputSchema;
  protected outputSchema = VideoAnalysisOutputSchema;
  protected async execute(input: VideoAnalysisInput) {
    const res = await engine.generateStructuredObject(`Analyze slot gameplay video at: ${input.videoUrl}`, this.outputSchema);
    return res.data;
  }
}

// 15. RAG Agent
const RAGInputSchema = z.object({ query: z.string(), contextDocuments: z.array(z.string()) });
type RAGInput = z.infer<typeof RAGInputSchema>;
const RAGOutputSchema = z.object({ answer: z.string(), confidence: z.number() });
type RAGOutput = z.infer<typeof RAGOutputSchema>;

export class RAGAgent extends BaseAgent<RAGInput, RAGOutput> {
  protected inputSchema = RAGInputSchema;
  protected outputSchema = RAGOutputSchema;
  protected async execute(input: RAGInput) {
    const prompt = `Context:\n${input.contextDocuments.join("\n---\n")}\n\nQuery: ${input.query}`;
    const res = await engine.generateStructuredObject(prompt, this.outputSchema);
    return res.data;
  }
}

// 16. Analytics Agent
const AnalyticsInputSchema = z.object({ rawMetrics: z.record(z.any()) });
type AnalyticsInput = z.infer<typeof AnalyticsInputSchema>;
const AnalyticsOutputSchema = z.object({ insights: z.array(z.string()), anomalousMetrics: z.array(z.string()) });
type AnalyticsOutput = z.infer<typeof AnalyticsOutputSchema>;

export class AnalyticsAgent extends BaseAgent<AnalyticsInput, AnalyticsOutput> {
  protected inputSchema = AnalyticsInputSchema;
  protected outputSchema = AnalyticsOutputSchema;
  protected async execute(input: AnalyticsInput) {
    const res = await engine.generateStructuredObject(`Analyze raw telemetry metrics: ${JSON.stringify(input.rawMetrics)}`, this.outputSchema);
    return res.data;
  }
}

// 17. Reporting Agent
const ReportingInputSchema = z.object({ reportPeriod: z.string() });
type ReportingInput = z.infer<typeof ReportingInputSchema>;
const ReportingOutputSchema = z.object({ executiveSummary: z.string(), keyHighlights: z.array(z.string()) });
type ReportingOutput = z.infer<typeof ReportingOutputSchema>;

export class ReportingAgent extends BaseAgent<ReportingInput, ReportingOutput> {
  protected inputSchema = ReportingInputSchema;
  protected outputSchema = ReportingOutputSchema;
  protected async execute(input: ReportingInput) {
    const res = await engine.generateStructuredObject(`Generate executive intelligence report for period: ${input.reportPeriod}`, this.outputSchema);
    return res.data;
  }
}
