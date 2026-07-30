import { createHash } from "node:crypto";
import {
  ActorKind,
  BonusEvidenceField,
  CasinoEvidenceField,
  EvidenceType,
  EvidenceVerdict,
  GovernedSubjectType,
  Prisma,
  PrismaClient,
  PublicationStatus,
  QuarantineReason,
  ReviewStatus,
  SlotEvidenceField,
} from "@savvyedge/database";
import { WorkflowTransitionService } from "../../../packages/api/src/services/workflow-transition.service";

const STAGING_CONFIRMATION = "SavvyEdge";
const FIXTURE_TIME = new Date("2026-07-01T12:00:00.000Z");
const EVIDENCE_EXPIRY = new Date("2027-07-01T12:00:00.000Z");

const IDS = {
  actor: "57a00000-0000-4000-8000-000000000001",
  casinoAlpha: "57a00000-0000-4000-8000-000000000101",
  casinoBeta: "57a00000-0000-4000-8000-000000000102",
  provider: "57a00000-0000-4000-8000-000000000201",
  slotValid: "57a00000-0000-4000-8000-000000000301",
  slotIncomplete: "57a00000-0000-4000-8000-000000000302",
  slotInvalid: "57a00000-0000-4000-8000-000000000303",
  bonusValid: "57a00000-0000-4000-8000-000000000401",
  bonusIncomplete: "57a00000-0000-4000-8000-000000000402",
  bonusInvalid: "57a00000-0000-4000-8000-000000000403",
  sourceAlpha: "57a00000-0000-4000-8000-000000000501",
  sourceBeta: "57a00000-0000-4000-8000-000000000502",
  sourceProvider: "57a00000-0000-4000-8000-000000000503",
  scrapeAlpha: "57a00000-0000-4000-8000-000000000601",
  scrapeBeta: "57a00000-0000-4000-8000-000000000602",
  scrapeProvider: "57a00000-0000-4000-8000-000000000603",
  evidenceAlpha: "57a00000-0000-4000-8000-000000000701",
  evidenceBeta: "57a00000-0000-4000-8000-000000000702",
  evidenceProvider: "57a00000-0000-4000-8000-000000000703",
  casinoAlphaNameClaim: "57a00000-0000-4000-8000-000000000801",
  casinoAlphaHostClaim: "57a00000-0000-4000-8000-000000000802",
  bonusValidHeadlineClaim: "57a00000-0000-4000-8000-000000000811",
  bonusValidTypeClaim: "57a00000-0000-4000-8000-000000000812",
  bonusValidWageringClaim: "57a00000-0000-4000-8000-000000000813",
  bonusInvalidHeadlineClaim: "57a00000-0000-4000-8000-000000000821",
  slotValidNameClaim: "57a00000-0000-4000-8000-000000000831",
  slotValidProviderClaim: "57a00000-0000-4000-8000-000000000832",
  slotValidAvailabilityClaim: "57a00000-0000-4000-8000-000000000833",
  slotInvalidNameClaim: "57a00000-0000-4000-8000-000000000841",
  casinoSlotAlphaValid: "57a00000-0000-4000-8000-000000000901",
  casinoSlotAlphaIncomplete: "57a00000-0000-4000-8000-000000000902",
  casinoSlotBetaInvalid: "57a00000-0000-4000-8000-000000000903",
} as const;

type ChangeKind = "created" | "updated" | "skipped";

interface SeedSummary {
  created: string[];
  updated: string[];
  skipped: string[];
}

function databaseTargetFingerprint(databaseUrl: string): string {
  const parsed = new URL(databaseUrl);
  const identity = `${parsed.hostname.toLowerCase()}:${parsed.port || "default"}${parsed.pathname.toLowerCase()}`;
  return createHash("sha256").update(identity).digest("hex").slice(0, 12);
}

export function assertStagingSeedSafety(
  environment: NodeJS.ProcessEnv = process.env,
): { databaseUrl: string; targetFingerprint: string } {
  if (environment.SAVVY_ENV !== "staging") {
    throw new Error("Refusing staging seed: SAVVY_ENV must equal 'staging'.");
  }
  if (environment.SEED_STAGING_CONFIRM !== STAGING_CONFIRMATION) {
    throw new Error(
      `Refusing staging seed: SEED_STAGING_CONFIRM must equal '${STAGING_CONFIRMATION}'.`,
    );
  }

  const databaseUrl = environment.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("Refusing staging seed: DATABASE_URL is required.");
  }

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("Refusing staging seed: DATABASE_URL is not a valid URL.");
  }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new Error("Refusing staging seed: DATABASE_URL must use PostgreSQL.");
  }

  const targetText = [
    parsed.hostname,
    parsed.pathname,
    parsed.searchParams.get("application_name") ?? "",
  ]
    .join(" ")
    .toLowerCase();
  const productionPattern = /(^|[^a-z0-9])(prod|production|live)([^a-z0-9]|$)/i;
  const configuredProductionUrls = [
    environment.PRODUCTION_DATABASE_URL,
    environment.PROD_DATABASE_URL,
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.trim());

  if (
    productionPattern.test(targetText) ||
    configuredProductionUrls.includes(databaseUrl)
  ) {
    throw new Error(
      "Refusing staging seed: DATABASE_URL appears to target production.",
    );
  }

  return {
    databaseUrl,
    targetFingerprint: databaseTargetFingerprint(databaseUrl),
  };
}

function hashValue(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

function stableContentHash(key: string): string {
  return createHash("sha256").update(`savvyedge-staging:${key}`).digest("hex");
}

function sameDate(left: Date | null, right: Date | null): boolean {
  return left?.getTime() === right?.getTime();
}

function note(summary: SeedSummary, kind: ChangeKind, label: string): void {
  summary[kind].push(label);
}

async function reconcileById<T extends { id: string }>(
  summary: SeedSummary,
  label: string,
  find: () => Promise<T | null>,
  create: () => Promise<T>,
  needsUpdate: (existing: T) => boolean,
  update: (existing: T) => Promise<T>,
): Promise<T> {
  const existing = await find();
  if (!existing) {
    const record = await create();
    note(summary, "created", `${label} (${record.id})`);
    return record;
  }
  if (needsUpdate(existing)) {
    const record = await update(existing);
    note(summary, "updated", `${label} (${record.id})`);
    return record;
  }
  note(summary, "skipped", `${label} (${existing.id})`);
  return existing;
}

async function seedBaseRecords(
  db: Prisma.TransactionClient,
  summary: SeedSummary,
) {
  const actor = await reconcileById(
    summary,
    "actor:service:staging-seed",
    () =>
      db.reviewActor.findUnique({
        where: { stable_key: "service:staging-seed" },
      }),
    () =>
      db.reviewActor.create({
        data: {
          id: IDS.actor,
          kind: ActorKind.SERVICE,
          stable_key: "service:staging-seed",
          display_name: "Staging Seed Service",
          active: true,
        },
      }),
    (row) =>
      row.kind !== ActorKind.SERVICE ||
      row.display_name !== "Staging Seed Service" ||
      !row.active,
    (row) =>
      db.reviewActor.update({
        where: { id: row.id },
        data: {
          kind: ActorKind.SERVICE,
          display_name: "Staging Seed Service",
          active: true,
        },
      }),
  );

  const casinoAlpha = await reconcileById(
    summary,
    "casino:staging-alpha-casino",
    () => db.casino.findUnique({ where: { slug: "staging-alpha-casino" } }),
    () =>
      db.casino.create({
        data: {
          id: IDS.casinoAlpha,
          slug: "staging-alpha-casino",
          name: "Staging Alpha Casino",
          website_url: "https://staging-alpha.example.com",
          license_info: null,
          status: "ACTIVE",
          data_source_type: "STAGING_FIXTURE",
          verified_at: null,
          review_status: ReviewStatus.NEW,
          publication_status: PublicationStatus.UNPUBLISHED,
        },
      }),
    (row) =>
      row.name !== "Staging Alpha Casino" ||
      row.website_url !== "https://staging-alpha.example.com" ||
      row.status !== "ACTIVE" ||
      row.data_source_type !== "STAGING_FIXTURE",
    (row) =>
      db.casino.update({
        where: { id: row.id },
        data: {
          name: "Staging Alpha Casino",
          website_url: "https://staging-alpha.example.com",
          status: "ACTIVE",
          data_source_type: "STAGING_FIXTURE",
        },
      }),
  );

  const casinoBeta = await reconcileById(
    summary,
    "casino:staging-beta-casino",
    () => db.casino.findUnique({ where: { slug: "staging-beta-casino" } }),
    () =>
      db.casino.create({
        data: {
          id: IDS.casinoBeta,
          slug: "staging-beta-casino",
          name: "Staging Beta Casino",
          website_url: "https://staging-beta.example.com",
          license_info: null,
          status: "ACTIVE",
          data_source_type: "STAGING_FIXTURE",
          verified_at: null,
          review_status: ReviewStatus.NEW,
          publication_status: PublicationStatus.UNPUBLISHED,
        },
      }),
    (row) =>
      row.name !== "Staging Beta Casino" ||
      row.website_url !== "https://staging-beta.example.com" ||
      row.status !== "ACTIVE" ||
      row.data_source_type !== "STAGING_FIXTURE",
    (row) =>
      db.casino.update({
        where: { id: row.id },
        data: {
          name: "Staging Beta Casino",
          website_url: "https://staging-beta.example.com",
          status: "ACTIVE",
          data_source_type: "STAGING_FIXTURE",
        },
      }),
  );

  const provider = await reconcileById(
    summary,
    "provider:staging-example-provider",
    () =>
      db.provider.findUnique({ where: { slug: "staging-example-provider" } }),
    () =>
      db.provider.create({
        data: {
          id: IDS.provider,
          slug: "staging-example-provider",
          name: "Staging Example Provider",
          website_url: "https://provider.example.com",
        },
      }),
    (row) =>
      row.name !== "Staging Example Provider" ||
      row.website_url !== "https://provider.example.com",
    (row) =>
      db.provider.update({
        where: { id: row.id },
        data: {
          name: "Staging Example Provider",
          website_url: "https://provider.example.com",
        },
      }),
  );

  const slotInputs = [
    {
      id: IDS.slotValid,
      slug: "staging-review-ready-slot",
      name: "Staging Review Ready Slot",
      rtp: 96.25,
      volatility: "MEDIUM",
      maxWin: 2500,
    },
    {
      id: IDS.slotIncomplete,
      slug: "staging-missing-evidence-slot",
      name: "Staging Missing Evidence Slot",
      rtp: null,
      volatility: null,
      maxWin: null,
    },
    {
      id: IDS.slotInvalid,
      slug: "staging-invalid-slot",
      name: "Staging Invalid Slot",
      rtp: null,
      volatility: "UNKNOWN",
      maxWin: null,
    },
  ] as const;
  const slots = [];
  for (const input of slotInputs) {
    slots.push(
      await reconcileById(
        summary,
        `slot:${input.slug}`,
        () => db.slot.findUnique({ where: { slug: input.slug } }),
        () =>
          db.slot.create({
            data: {
              id: input.id,
              slug: input.slug,
              name: input.name,
              provider_id: provider.id,
              rtp_current: input.rtp,
              volatility: input.volatility,
              max_win: input.maxWin,
              review_status: ReviewStatus.NEW,
              publication_status: PublicationStatus.UNPUBLISHED,
            },
          }),
        (row) =>
          row.name !== input.name ||
          row.provider_id !== provider.id ||
          row.rtp_current !== input.rtp ||
          row.volatility !== input.volatility ||
          row.max_win !== input.maxWin,
        (row) =>
          db.slot.update({
            where: { id: row.id },
            data: {
              name: input.name,
              provider_id: provider.id,
              rtp_current: input.rtp,
              volatility: input.volatility,
              max_win: input.maxWin,
            },
          }),
      ),
    );
  }
  const [slotValid, slotIncomplete, slotInvalid] = slots;

  const bonusInputs = [
    {
      id: IDS.bonusValid,
      casinoId: casinoAlpha.id,
      sourceKey: "staging:alpha:welcome",
      type: "WELCOME",
      headline: "Staging Welcome Bonus",
      wagering: 25,
      maxConversion: 100,
      validUntil: EVIDENCE_EXPIRY,
    },
    {
      id: IDS.bonusIncomplete,
      casinoId: casinoAlpha.id,
      sourceKey: "staging:alpha:missing-evidence",
      type: "WELCOME",
      headline: "Staging Missing Evidence Bonus",
      wagering: null,
      maxConversion: null,
      validUntil: null,
    },
    {
      id: IDS.bonusInvalid,
      casinoId: casinoBeta.id,
      sourceKey: "staging:beta:invalid",
      type: "UNKNOWN",
      headline: "Staging Invalid Bonus",
      wagering: -1,
      maxConversion: null,
      validUntil: null,
    },
  ] as const;
  const bonuses = [];
  for (const input of bonusInputs) {
    bonuses.push(
      await reconcileById(
        summary,
        `bonus:${input.sourceKey}`,
        () => db.bonus.findUnique({ where: { id: input.id } }),
        () =>
          db.bonus.create({
            data: {
              id: input.id,
              casino_id: input.casinoId,
              source_offer_key: input.sourceKey,
              type: input.type,
              headline_value: input.headline,
              wagering_requirement: input.wagering,
              max_conversion: input.maxConversion,
              valid_until: input.validUntil,
              status: "ACTIVE",
              data_source_type: "STAGING_FIXTURE",
              verified_at: null,
              review_status: ReviewStatus.NEW,
              publication_status: PublicationStatus.UNPUBLISHED,
            },
          }),
        (row) =>
          row.casino_id !== input.casinoId ||
          row.source_offer_key !== input.sourceKey ||
          row.type !== input.type ||
          row.headline_value !== input.headline ||
          row.wagering_requirement !== input.wagering ||
          row.max_conversion !== input.maxConversion ||
          !sameDate(row.valid_until, input.validUntil) ||
          row.status !== "ACTIVE" ||
          row.data_source_type !== "STAGING_FIXTURE",
        (row) =>
          db.bonus.update({
            where: { id: row.id },
            data: {
              casino_id: input.casinoId,
              source_offer_key: input.sourceKey,
              type: input.type,
              headline_value: input.headline,
              wagering_requirement: input.wagering,
              max_conversion: input.maxConversion,
              valid_until: input.validUntil,
              status: "ACTIVE",
              data_source_type: "STAGING_FIXTURE",
            },
          }),
      ),
    );
  }
  const [bonusValid, bonusIncomplete, bonusInvalid] = bonuses;

  const sourceInputs = [
    {
      id: IDS.sourceAlpha,
      url: "https://staging-alpha.example.com/promotions",
      type: "CASINO_PROMOTION_PAGE",
    },
    {
      id: IDS.sourceBeta,
      url: "https://staging-beta.example.com/promotions",
      type: "CASINO_PROMOTION_PAGE",
    },
    {
      id: IDS.sourceProvider,
      url: "https://provider.example.com/games",
      type: "PROVIDER_GAME_CATALOG",
    },
  ] as const;
  const sources = [];
  for (const input of sourceInputs) {
    sources.push(
      await reconcileById(
        summary,
        `data-source:${input.url}`,
        () => db.dataSource.findUnique({ where: { id: input.id } }),
        () =>
          db.dataSource.create({
            data: {
              id: input.id,
              url: input.url,
              normalized_url: input.url,
              source_type: input.type,
              last_scraped_at: FIXTURE_TIME,
              reliability_score: 0.8,
            },
          }),
        (row) =>
          row.url !== input.url ||
          row.normalized_url !== input.url ||
          row.source_type !== input.type ||
          !sameDate(row.last_scraped_at, FIXTURE_TIME) ||
          row.reliability_score !== 0.8,
        (row) =>
          db.dataSource.update({
            where: { id: row.id },
            data: {
              url: input.url,
              normalized_url: input.url,
              source_type: input.type,
              last_scraped_at: FIXTURE_TIME,
              reliability_score: 0.8,
            },
          }),
      ),
    );
  }
  const [sourceAlpha, sourceBeta, sourceProvider] = sources;

  const scrapeInputs = [
    { id: IDS.scrapeAlpha, sourceId: sourceAlpha.id, key: "alpha" },
    { id: IDS.scrapeBeta, sourceId: sourceBeta.id, key: "beta" },
    { id: IDS.scrapeProvider, sourceId: sourceProvider.id, key: "provider" },
  ] as const;
  const scrapeJobs = [];
  for (const input of scrapeInputs) {
    const contentHash = stableContentHash(input.key);
    scrapeJobs.push(
      await reconcileById(
        summary,
        `source-snapshot:${input.key}`,
        () => db.scrapeJob.findUnique({ where: { id: input.id } }),
        () =>
          db.scrapeJob.create({
            data: {
              id: input.id,
              data_source_id: input.sourceId,
              status: "COMPLETED",
              started_at: FIXTURE_TIME,
              completed_at: FIXTURE_TIME,
              snapshot_path: `staging-fixtures/${input.key}.html`,
              content_hash: contentHash,
              canonical_url:
                input.key === "provider"
                  ? "https://provider.example.com/games"
                  : `https://staging-${input.key}.example.com/promotions`,
            },
          }),
        (row) =>
          row.data_source_id !== input.sourceId ||
          row.status !== "COMPLETED" ||
          !sameDate(row.started_at, FIXTURE_TIME) ||
          !sameDate(row.completed_at, FIXTURE_TIME) ||
          row.snapshot_path !== `staging-fixtures/${input.key}.html` ||
          row.content_hash !== contentHash,
        (row) =>
          db.scrapeJob.update({
            where: { id: row.id },
            data: {
              data_source_id: input.sourceId,
              status: "COMPLETED",
              started_at: FIXTURE_TIME,
              completed_at: FIXTURE_TIME,
              snapshot_path: `staging-fixtures/${input.key}.html`,
              content_hash: contentHash,
            },
          }),
      ),
    );
  }
  const [scrapeAlpha, scrapeBeta, scrapeProvider] = scrapeJobs;

  const evidenceInputs = [
    {
      id: IDS.evidenceAlpha,
      sourceId: sourceAlpha.id,
      scrapeId: scrapeAlpha.id,
      sourceUrl: "https://staging-alpha.example.com/promotions",
      type: EvidenceType.OPERATOR_PAGE,
      key: "alpha",
    },
    {
      id: IDS.evidenceBeta,
      sourceId: sourceBeta.id,
      scrapeId: scrapeBeta.id,
      sourceUrl: "https://staging-beta.example.com/promotions",
      type: EvidenceType.OPERATOR_PAGE,
      key: "beta",
    },
    {
      id: IDS.evidenceProvider,
      sourceId: sourceProvider.id,
      scrapeId: scrapeProvider.id,
      sourceUrl: "https://provider.example.com/games",
      type: EvidenceType.PROVIDER_PAGE,
      key: "provider",
    },
  ] as const;
  const evidenceRecords = [];
  for (const input of evidenceInputs) {
    const contentHash = stableContentHash(input.key);
    evidenceRecords.push(
      await reconcileById(
        summary,
        `evidence:${input.key}`,
        () => db.evidenceRecord.findUnique({ where: { id: input.id } }),
        () =>
          db.evidenceRecord.create({
            data: {
              id: input.id,
              data_source_id: input.sourceId,
              scrape_job_id: input.scrapeId,
              evidence_type: input.type,
              source_url: input.sourceUrl,
              snapshot_path: `staging-fixtures/${input.key}.html`,
              content_hash: contentHash,
              extraction_key: `staging:${input.key}`,
              observed_at: FIXTURE_TIME,
              extracted_at: FIXTURE_TIME,
              expires_at: EVIDENCE_EXPIRY,
              created_by_id: actor.id,
            },
          }),
        (row) =>
          row.data_source_id !== input.sourceId ||
          row.scrape_job_id !== input.scrapeId ||
          row.evidence_type !== input.type ||
          row.source_url !== input.sourceUrl ||
          row.content_hash !== contentHash ||
          row.extraction_key !== `staging:${input.key}` ||
          !sameDate(row.observed_at, FIXTURE_TIME) ||
          !sameDate(row.extracted_at, FIXTURE_TIME) ||
          !sameDate(row.expires_at, EVIDENCE_EXPIRY),
        (row) =>
          db.evidenceRecord.update({
            where: { id: row.id },
            data: {
              data_source_id: input.sourceId,
              scrape_job_id: input.scrapeId,
              evidence_type: input.type,
              source_url: input.sourceUrl,
              snapshot_path: `staging-fixtures/${input.key}.html`,
              content_hash: contentHash,
              extraction_key: `staging:${input.key}`,
              observed_at: FIXTURE_TIME,
              extracted_at: FIXTURE_TIME,
              expires_at: EVIDENCE_EXPIRY,
              created_by_id: actor.id,
            },
          }),
      ),
    );
  }
  const [evidenceAlpha, evidenceBeta, evidenceProvider] = evidenceRecords;

  const casinoClaimInputs = [
    {
      id: IDS.casinoAlphaNameClaim,
      evidenceId: evidenceAlpha.id,
      casinoId: casinoAlpha.id,
      field: CasinoEvidenceField.NAME,
      value: "Staging Alpha Casino",
      verdict: EvidenceVerdict.SUPPORTS,
    },
    {
      id: IDS.casinoAlphaHostClaim,
      evidenceId: evidenceAlpha.id,
      casinoId: casinoAlpha.id,
      field: CasinoEvidenceField.WEBSITE_HOST,
      value: "staging-alpha.example.com",
      verdict: EvidenceVerdict.SUPPORTS,
    },
  ] as const;
  const casinoClaims = [];
  for (const input of casinoClaimInputs) {
    const valueHash = hashValue(input.value);
    casinoClaims.push(
      await reconcileById(
        summary,
        `casino-claim:${input.field}`,
        () => db.casinoEvidenceClaim.findUnique({ where: { id: input.id } }),
        () =>
          db.casinoEvidenceClaim.create({
            data: {
              id: input.id,
              evidence_id: input.evidenceId,
              casino_id: input.casinoId,
              field: input.field,
              observed_value: input.value,
              normalized_value_hash: valueHash,
              verdict: input.verdict,
            },
          }),
        (row) =>
          row.evidence_id !== input.evidenceId ||
          row.casino_id !== input.casinoId ||
          row.field !== input.field ||
          row.observed_value !== input.value ||
          row.normalized_value_hash !== valueHash ||
          row.verdict !== input.verdict,
        (row) =>
          db.casinoEvidenceClaim.update({
            where: { id: row.id },
            data: {
              evidence_id: input.evidenceId,
              casino_id: input.casinoId,
              field: input.field,
              observed_value: input.value,
              normalized_value_hash: valueHash,
              verdict: input.verdict,
            },
          }),
      ),
    );
  }

  const bonusClaimInputs = [
    {
      id: IDS.bonusValidHeadlineClaim,
      evidenceId: evidenceAlpha.id,
      bonusId: bonusValid.id,
      field: BonusEvidenceField.HEADLINE_VALUE,
      value: "Staging Welcome Bonus",
      verdict: EvidenceVerdict.SUPPORTS,
    },
    {
      id: IDS.bonusValidTypeClaim,
      evidenceId: evidenceAlpha.id,
      bonusId: bonusValid.id,
      field: BonusEvidenceField.TYPE,
      value: "WELCOME",
      verdict: EvidenceVerdict.SUPPORTS,
    },
    {
      id: IDS.bonusValidWageringClaim,
      evidenceId: evidenceAlpha.id,
      bonusId: bonusValid.id,
      field: BonusEvidenceField.WAGERING_REQUIREMENT,
      value: "25",
      verdict: EvidenceVerdict.SUPPORTS,
    },
    {
      id: IDS.bonusInvalidHeadlineClaim,
      evidenceId: evidenceBeta.id,
      bonusId: bonusInvalid.id,
      field: BonusEvidenceField.HEADLINE_VALUE,
      value: "Conflicting staging offer text",
      verdict: EvidenceVerdict.CONTRADICTS,
    },
  ] as const;
  const bonusClaims = [];
  for (const input of bonusClaimInputs) {
    const valueHash = hashValue(input.value);
    bonusClaims.push(
      await reconcileById(
        summary,
        `bonus-claim:${input.id}`,
        () => db.bonusEvidenceClaim.findUnique({ where: { id: input.id } }),
        () =>
          db.bonusEvidenceClaim.create({
            data: {
              id: input.id,
              evidence_id: input.evidenceId,
              bonus_id: input.bonusId,
              field: input.field,
              observed_value: input.value,
              normalized_value_hash: valueHash,
              verdict: input.verdict,
            },
          }),
        (row) =>
          row.evidence_id !== input.evidenceId ||
          row.bonus_id !== input.bonusId ||
          row.field !== input.field ||
          row.observed_value !== input.value ||
          row.normalized_value_hash !== valueHash ||
          row.verdict !== input.verdict,
        (row) =>
          db.bonusEvidenceClaim.update({
            where: { id: row.id },
            data: {
              evidence_id: input.evidenceId,
              bonus_id: input.bonusId,
              field: input.field,
              observed_value: input.value,
              normalized_value_hash: valueHash,
              verdict: input.verdict,
            },
          }),
      ),
    );
  }

  const slotClaimInputs = [
    {
      id: IDS.slotValidNameClaim,
      evidenceId: evidenceProvider.id,
      slotId: slotValid.id,
      field: SlotEvidenceField.NAME,
      value: "Staging Review Ready Slot",
      verdict: EvidenceVerdict.SUPPORTS,
    },
    {
      id: IDS.slotValidProviderClaim,
      evidenceId: evidenceProvider.id,
      slotId: slotValid.id,
      field: SlotEvidenceField.PROVIDER,
      value: "Staging Example Provider",
      verdict: EvidenceVerdict.SUPPORTS,
    },
    {
      id: IDS.slotValidAvailabilityClaim,
      evidenceId: evidenceAlpha.id,
      slotId: slotValid.id,
      field: SlotEvidenceField.CASINO_AVAILABILITY,
      value: "staging-alpha-casino",
      verdict: EvidenceVerdict.SUPPORTS,
    },
    {
      id: IDS.slotInvalidNameClaim,
      evidenceId: evidenceProvider.id,
      slotId: slotInvalid.id,
      field: SlotEvidenceField.NAME,
      value: "Different Unsupported Slot",
      verdict: EvidenceVerdict.CONTRADICTS,
    },
  ] as const;
  const slotClaims = [];
  for (const input of slotClaimInputs) {
    const valueHash = hashValue(input.value);
    slotClaims.push(
      await reconcileById(
        summary,
        `slot-claim:${input.id}`,
        () => db.slotEvidenceClaim.findUnique({ where: { id: input.id } }),
        () =>
          db.slotEvidenceClaim.create({
            data: {
              id: input.id,
              evidence_id: input.evidenceId,
              slot_id: input.slotId,
              field: input.field,
              observed_value: input.value,
              normalized_value_hash: valueHash,
              verdict: input.verdict,
            },
          }),
        (row) =>
          row.evidence_id !== input.evidenceId ||
          row.slot_id !== input.slotId ||
          row.field !== input.field ||
          row.observed_value !== input.value ||
          row.normalized_value_hash !== valueHash ||
          row.verdict !== input.verdict,
        (row) =>
          db.slotEvidenceClaim.update({
            where: { id: row.id },
            data: {
              evidence_id: input.evidenceId,
              slot_id: input.slotId,
              field: input.field,
              observed_value: input.value,
              normalized_value_hash: valueHash,
              verdict: input.verdict,
            },
          }),
      ),
    );
  }

  const casinoSlotInputs = [
    {
      id: IDS.casinoSlotAlphaValid,
      casinoId: casinoAlpha.id,
      slotId: slotValid.id,
      sourceUrl: "https://staging-alpha.example.com/games",
    },
    {
      id: IDS.casinoSlotAlphaIncomplete,
      casinoId: casinoAlpha.id,
      slotId: slotIncomplete.id,
      sourceUrl: "https://staging-alpha.example.com/games",
    },
    {
      id: IDS.casinoSlotBetaInvalid,
      casinoId: casinoBeta.id,
      slotId: slotInvalid.id,
      sourceUrl: "https://staging-beta.example.com/games",
    },
  ] as const;
  for (const input of casinoSlotInputs) {
    await reconcileById(
      summary,
      `casino-slot:${input.casinoId}:${input.slotId}`,
      () =>
        db.casinoSlot.findUnique({
          where: {
            casino_id_slot_id: {
              casino_id: input.casinoId,
              slot_id: input.slotId,
            },
          },
        }),
      () =>
        db.casinoSlot.create({
          data: {
            id: input.id,
            casino_id: input.casinoId,
            slot_id: input.slotId,
            source_url: input.sourceUrl,
            verified_at: null,
          },
        }),
      (row) => row.source_url !== input.sourceUrl,
      (row) =>
        db.casinoSlot.update({
          where: { id: row.id },
          data: { source_url: input.sourceUrl },
        }),
    );
  }

  return {
    actor,
    casinoAlpha,
    casinoBeta,
    slotValid,
    slotIncomplete,
    slotInvalid,
    bonusValid,
    bonusIncomplete,
    bonusInvalid,
    casinoClaims,
    bonusClaims,
    slotClaims,
  };
}

async function applyInitialWorkflow(
  db: PrismaClient,
  summary: SeedSummary,
  records: Awaited<ReturnType<typeof seedBaseRecords>>,
): Promise<void> {
  const workflow = new WorkflowTransitionService(db);
  const transitions = [
    {
      label: "workflow:casino:staging-alpha-casino:awaiting-review",
      type: GovernedSubjectType.CASINO,
      id: records.casinoAlpha.id,
      status: records.casinoAlpha.review_status,
      version: records.casinoAlpha.governance_version,
      target: ReviewStatus.AWAITING_REVIEW,
      claimIds: records.casinoClaims.map((claim) => claim.id),
    },
    {
      label: "workflow:casino:staging-beta-casino:awaiting-review",
      type: GovernedSubjectType.CASINO,
      id: records.casinoBeta.id,
      status: records.casinoBeta.review_status,
      version: records.casinoBeta.governance_version,
      target: ReviewStatus.AWAITING_REVIEW,
      claimIds: [],
    },
    {
      label: "workflow:bonus:welcome:awaiting-review",
      type: GovernedSubjectType.BONUS,
      id: records.bonusValid.id,
      status: records.bonusValid.review_status,
      version: records.bonusValid.governance_version,
      target: ReviewStatus.AWAITING_REVIEW,
      claimIds: records.bonusClaims
        .filter((claim) => claim.bonus_id === records.bonusValid.id)
        .map((claim) => claim.id),
    },
    {
      label: "workflow:bonus:missing-evidence:awaiting-review",
      type: GovernedSubjectType.BONUS,
      id: records.bonusIncomplete.id,
      status: records.bonusIncomplete.review_status,
      version: records.bonusIncomplete.governance_version,
      target: ReviewStatus.AWAITING_REVIEW,
      claimIds: [],
    },
    {
      label: "workflow:bonus:invalid:quarantined",
      type: GovernedSubjectType.BONUS,
      id: records.bonusInvalid.id,
      status: records.bonusInvalid.review_status,
      version: records.bonusInvalid.governance_version,
      target: ReviewStatus.QUARANTINED,
      claimIds: [],
      quarantineReason: QuarantineReason.CONFLICTING_EVIDENCE,
    },
    {
      label: "workflow:slot:review-ready:awaiting-review",
      type: GovernedSubjectType.SLOT,
      id: records.slotValid.id,
      status: records.slotValid.review_status,
      version: records.slotValid.governance_version,
      target: ReviewStatus.AWAITING_REVIEW,
      claimIds: records.slotClaims
        .filter((claim) => claim.slot_id === records.slotValid.id)
        .map((claim) => claim.id),
    },
    {
      label: "workflow:slot:invalid:quarantined",
      type: GovernedSubjectType.SLOT,
      id: records.slotInvalid.id,
      status: records.slotInvalid.review_status,
      version: records.slotInvalid.governance_version,
      target: ReviewStatus.QUARANTINED,
      claimIds: [],
      quarantineReason: QuarantineReason.CONFLICTING_EVIDENCE,
    },
  ] as const;

  for (const transition of transitions) {
    if (transition.status !== ReviewStatus.NEW) {
      note(
        summary,
        "skipped",
        `${transition.label} (current=${transition.status})`,
      );
      continue;
    }
    const command = {
      subjectId: transition.id,
      actorId: records.actor.id,
      expectedVersion: transition.version,
      toStatus: transition.target,
      claimIds: transition.claimIds,
      ...("quarantineReason" in transition
        ? { quarantineReason: transition.quarantineReason }
        : {}),
    };
    if (transition.type === GovernedSubjectType.CASINO) {
      await workflow.transitionCasinoReview(command);
    } else if (transition.type === GovernedSubjectType.BONUS) {
      await workflow.transitionBonusReview(command);
    } else {
      await workflow.transitionSlotReview(command);
    }
    note(summary, "updated", transition.label);
  }
}

async function workflowCounts(db: PrismaClient) {
  const [
    casinos,
    bonuses,
    slots,
    reviewQueueCount,
    quarantineCount,
    auditCount,
  ] = await Promise.all([
    db.casino.groupBy({
      by: ["review_status"],
      where: { slug: { in: ["staging-alpha-casino", "staging-beta-casino"] } },
      _count: { _all: true },
    }),
    db.bonus.groupBy({
      by: ["review_status"],
      where: {
        id: { in: [IDS.bonusValid, IDS.bonusIncomplete, IDS.bonusInvalid] },
      },
      _count: { _all: true },
    }),
    db.slot.groupBy({
      by: ["review_status"],
      where: {
        slug: {
          in: [
            "staging-review-ready-slot",
            "staging-missing-evidence-slot",
            "staging-invalid-slot",
          ],
        },
      },
      _count: { _all: true },
    }),
    db.casino
      .count({
        where: {
          slug: { in: ["staging-alpha-casino", "staging-beta-casino"] },
          review_status: {
            in: [ReviewStatus.AWAITING_REVIEW, ReviewStatus.IN_REVIEW],
          },
        },
      })
      .then(
        async (casinoCount) =>
          casinoCount +
          (await db.bonus.count({
            where: {
              id: {
                in: [IDS.bonusValid, IDS.bonusIncomplete, IDS.bonusInvalid],
              },
              review_status: {
                in: [ReviewStatus.AWAITING_REVIEW, ReviewStatus.IN_REVIEW],
              },
            },
          })),
      ),
    db.bonus
      .count({
        where: {
          id: { in: [IDS.bonusValid, IDS.bonusIncomplete, IDS.bonusInvalid] },
          review_status: ReviewStatus.QUARANTINED,
        },
      })
      .then(
        async (bonusCount) =>
          bonusCount +
          (await db.slot.count({
            where: {
              slug: {
                in: [
                  "staging-review-ready-slot",
                  "staging-missing-evidence-slot",
                  "staging-invalid-slot",
                ],
              },
              review_status: ReviewStatus.QUARANTINED,
            },
          })),
      ),
    db.workflowAuditEvent.count({
      where: {
        actor: { stable_key: "service:staging-seed" },
      },
    }),
  ]);

  const asObject = (
    groups: Array<{ review_status: ReviewStatus; _count: { _all: number } }>,
  ) =>
    Object.fromEntries(
      groups
        .sort((left, right) =>
          left.review_status.localeCompare(right.review_status),
        )
        .map((group) => [group.review_status, group._count._all]),
    );

  return {
    casinos: asObject(casinos),
    bonuses: asObject(bonuses),
    slots: asObject(slots),
    reviewQueueCount,
    quarantineCount,
    auditCount,
  };
}

async function main(): Promise<void> {
  const safety = assertStagingSeedSafety();
  const db = new PrismaClient({
    datasources: { db: { url: safety.databaseUrl } },
  });
  const summary: SeedSummary = { created: [], updated: [], skipped: [] };

  console.log(
    `SavvyEdge staging seed authorized (target fingerprint: ${safety.targetFingerprint}).`,
  );
  try {
    await db.$connect();
    const records = await db.$transaction(
      (tx) => seedBaseRecords(tx, summary),
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 60_000,
      },
    );
    await applyInitialWorkflow(db, summary, records);
    const counts = await workflowCounts(db);

    console.log("\nSeed summary");
    console.log(`created (${summary.created.length})`);
    summary.created.forEach((item) => console.log(`  + ${item}`));
    console.log(`updated (${summary.updated.length})`);
    summary.updated.forEach((item) => console.log(`  ~ ${item}`));
    console.log(`skipped (${summary.skipped.length})`);
    summary.skipped.forEach((item) => console.log(`  = ${item}`));
    console.log("\nSeeded workflow counts");
    console.log(JSON.stringify(counts, null, 2));
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Staging seed failed: ${message}`);
  process.exitCode = 1;
});
