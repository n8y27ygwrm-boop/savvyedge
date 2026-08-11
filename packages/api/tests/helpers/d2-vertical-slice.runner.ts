import { createHash, randomUUID } from "node:crypto";
import {
  ActorKind,
  EvidenceType,
  PublicationStatus,
  ReviewStatus,
  WorkflowEventType,
  prisma,
} from "@savvyedge/database";
import {
  IngestionService,
  OrchestratorService,
  PublicationGateService,
  UkgcDatasets,
  UkgcLicenseVerifierService,
  UKGC_DATASET_URLS,
  WorkflowTransitionService,
  EvidenceArtifactStorageService,
} from "../../src";
import {
  isD2AcceptanceEnabled,
  validateD2DatabaseUrl,
} from "./d2-acceptance-database-guard";

export interface D2AcceptanceRunnerOptions {
  log?: (message: string) => void;
}

export interface D2AcceptanceResult {
  success: boolean;
  runId: string;
  domain: string;
  casinoId: string;
  bonusId: string;
  licenseId: string;
  stagesCompleted: number;
}

/**
 * Executes the complete 11-stage D2 vertical-slice acceptance harness.
 * Operates strictly on the configured, isolated local database.
 */
export async function executeD2AcceptanceRunner(
  options: D2AcceptanceRunnerOptions = {},
): Promise<D2AcceptanceResult> {
  const log = options.log || (() => undefined);

  // =========================================================================
  // STAGE 1 — Safety guard (Strict fail-closed checks)
  // =========================================================================
  if (!isD2AcceptanceEnabled()) {
    throw new Error(
      "[D2 SAFETY VIOLATION] SAVVYEDGE_D2_ACCEPTANCE=1 is required in the environment to execute the D2 acceptance runner.",
    );
  }

  log("=================================================");
  log("      D2 REPEATABLE VERTICAL-SLICE HARNESS       ");
  log("=================================================\n");
  log("STAGE 1: Validating Database Safety Contract...");

  const safety = validateD2DatabaseUrl(process.env.DATABASE_URL);
  if (!safety.safe) {
    throw new Error(`[D2 SAFETY VIOLATION] ${safety.reason}`);
  }
  log(` [PASS] Isolated database confirmed: '${safety.databaseName}' on host '${safety.hostname}'\n`);

  const runId = randomUUID().replace(/-/g, "").slice(0, 8);
  const domain = `d2-${runId}.example.test`;
  const offerUrl = `https://${domain}/promotions/welcome-bonus`;
  const workflowService = new WorkflowTransitionService(prisma);

  // Generate a 6-digit numeric UKGC account number unique to this run (never 45322)
  const numericRunOffset = parseInt(runId.slice(0, 6), 16) % 300000;
  const ukgcAccount = String(600000 + numericRunOffset);
  const ukgcBusinessName = `D2 Operator ${runId} Limited`;
  const ukgcLicenceNo = `0${ukgcAccount}-R-${runId.toUpperCase()}-001`;

  const deterministicUkgcDatasets: UkgcDatasets = {
    domainsCsv: `"Account Number","Domain Name","Status"\n"${ukgcAccount}","${domain}","Active"\n`,
    businessesCsv: `"Account Number","Licence Account Name"\n"${ukgcAccount}","${ukgcBusinessName}"\n`,
    licencesCsv: `"Account Number","Licence Number","Status","Type","Activity","Start Date","End Date"\n"${ukgcAccount}","${ukgcLicenceNo}","Active","Remote","Casino","2020-01-01T00:00:00+00:00",""\n`,
  };

  // =========================================================================
  // STAGE 2 — Governed ingestion
  // =========================================================================
  log(`STAGE 2: Governed Ingestion for host '${domain}'...`);

  // Stub agent runtime methods on IngestionService with deterministic fixtures
  const originalCasinoAgentRun = (IngestionService as any).casinoResolutionAgent.run;
  const originalBonusAgentRun = (IngestionService as any).bonusAgent.run;
  const originalScraperAgentRun = (IngestionService as any).scraperAgent.run;
  const originalPersistObservation =
    EvidenceArtifactStorageService.persistObservation;

  // Capture original environment values to contain synthetic AI environment strictly to ingestion scope
  const originalActiveAiProvider = process.env.ACTIVE_AI_PROVIDER;
  const originalOpenAiApiKey = process.env.OPENAI_API_KEY;

  try {
    process.env.ACTIVE_AI_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "d2-acceptance-key";

    EvidenceArtifactStorageService.persistObservation = async (input) => ({
      locator: `d2-fixtures/${input.observationId}.html`,
      htmlHash: input.expectedHtmlHash,
      byteSize: Buffer.byteLength(input.rawHtml, "utf8"),
    });

    (IngestionService as any).casinoResolutionAgent.run = async () => ({
      name: `D2 Casino ${runId}`,
      slug: `d2-casino-${runId}`,
      domain,
      website_url: `https://${domain}`,
      license_info: "UKGC Licensed Remote Operator",
    });

    (IngestionService as any).bonusAgent.run = async ({ casino_id }: any) => ({
      casino_id,
      type: "WELCOME",
      headline_value: "100% Match Bonus up to £200",
      wagering_requirement: 35,
      max_conversion: 500,
      status: "ACTIVE",
      valid_from: new Date("2026-01-01T00:00:00.000Z"),
      valid_until: null,
    });

    (IngestionService as any).scraperAgent.run = async () => {
      const rawHtml =
        "<html><body>100% Match Bonus up to £200. Wagering 35x. Max conversion £500.</body></html>";
      return {
        url: offerUrl,
        finalUrl: offerUrl,
        title: "D2 Welcome Bonus Terms",
        content:
          "100% Match Bonus up to £200. Wagering 35x. Max conversion £500.",
        rawHtml,
        contentHash: `content-${runId}`,
        htmlHash: createHash("sha256").update(rawHtml).digest("hex"),
        timestamp: new Date(),
      };
    };

    await IngestionService.ingestBonusFromUrl({ url: offerUrl });
  } finally {
    // Restore synthetic AI environment
    if (originalActiveAiProvider !== undefined) {
      process.env.ACTIVE_AI_PROVIDER = originalActiveAiProvider;
    } else {
      delete process.env.ACTIVE_AI_PROVIDER;
    }

    if (originalOpenAiApiKey !== undefined) {
      process.env.OPENAI_API_KEY = originalOpenAiApiKey;
    } else {
      delete process.env.OPENAI_API_KEY;
    }

    (IngestionService as any).casinoResolutionAgent.run = originalCasinoAgentRun;
    (IngestionService as any).bonusAgent.run = originalBonusAgentRun;
    (IngestionService as any).scraperAgent.run = originalScraperAgentRun;
    EvidenceArtifactStorageService.persistObservation =
      originalPersistObservation;
  }

  const initialCasino = await prisma.casino.findFirstOrThrow({
    where: { slug: `d2-casino-${runId}` },
    include: { bonuses: true },
  });
  const initialBonus = initialCasino.bonuses[0];
  if (!initialBonus) {
    throw new Error(`Ingestion failed: No bonus linked to Casino ${initialCasino.id}`);
  }

  // Assert Stage 2 Casino properties
  if (initialCasino.status !== "ACTIVE") throw new Error("Casino status must be ACTIVE");
  if (initialCasino.verified_at !== null) throw new Error("Casino verified_at must be null at Stage 2");
  if (initialCasino.review_status !== ReviewStatus.AWAITING_REVIEW) {
    throw new Error(`Casino review_status must be AWAITING_REVIEW, got ${initialCasino.review_status}`);
  }
  if (initialCasino.publication_status !== PublicationStatus.UNPUBLISHED) {
    throw new Error("Casino publication_status must be UNPUBLISHED");
  }
  if (initialCasino.governance_version !== 1) {
    throw new Error(`Casino governance_version must be 1, got ${initialCasino.governance_version}`);
  }

  // Assert Stage 2 Bonus properties
  if (initialBonus.status !== "ACTIVE") throw new Error("Bonus status must be ACTIVE");
  if (initialBonus.verified_at !== null) throw new Error("Bonus verified_at must be null at Stage 2");
  if (initialBonus.review_status !== ReviewStatus.AWAITING_REVIEW) {
    throw new Error(`Bonus review_status must be AWAITING_REVIEW, got ${initialBonus.review_status}`);
  }
  if (initialBonus.publication_status !== PublicationStatus.UNPUBLISHED) {
    throw new Error("Bonus publication_status must be UNPUBLISHED");
  }
  if (initialBonus.governance_version !== 1) {
    throw new Error(`Bonus governance_version must be 1, got ${initialBonus.governance_version}`);
  }
  if (initialBonus.casino_id !== initialCasino.id) {
    throw new Error("Bonus casino_id does not match parent Casino ID");
  }

  // Assert Stage 2 Evidence & Claims
  const operatorEvidence = await prisma.evidenceRecord.findFirst({
    where: { source_url: offerUrl, evidence_type: EvidenceType.OPERATOR_PAGE },
  });
  if (!operatorEvidence) throw new Error("Operator page EvidenceRecord not found");

  const casinoClaims = await prisma.casinoEvidenceClaim.findMany({ where: { casino_id: initialCasino.id } });
  if (casinoClaims.length === 0) throw new Error("No CasinoEvidenceClaim records found");

  const bonusClaims = await prisma.bonusEvidenceClaim.findMany({ where: { bonus_id: initialBonus.id } });
  if (bonusClaims.length === 0) throw new Error("No BonusEvidenceClaim records found");

  const casinoReviewAudit = await prisma.workflowAuditEvent.findFirst({
    where: { casino_id: initialCasino.id, event_type: WorkflowEventType.REVIEW_REQUESTED },
  });
  if (!casinoReviewAudit) throw new Error("Casino REVIEW_REQUESTED audit event missing");

  const bonusReviewAudit = await prisma.workflowAuditEvent.findFirst({
    where: { bonus_id: initialBonus.id, event_type: WorkflowEventType.REVIEW_REQUESTED },
  });
  if (!bonusReviewAudit) throw new Error("Bonus REVIEW_REQUESTED audit event missing");

  log(` [PASS] Governed ingestion created Casino (${initialCasino.id}) and Bonus (${initialBonus.id})\n`);

  // =========================================================================
  // STAGE 3 — UKGC machine verification
  // =========================================================================
  log("STAGE 3: Authoritative UKGC Machine Verification...");

  const ukgcVerifyNow = new Date();
  const ukgcResult = await UkgcLicenseVerifierService.verifyCasinoLicense({
    casinoId: initialCasino.id,
    domain,
    now: ukgcVerifyNow,
    fetcher: async () => deterministicUkgcDatasets,
  });

  if (!ukgcResult.verified || !ukgcResult.licenseId) {
    throw new Error(`UKGC verification failed: ${ukgcResult.reason}`);
  }

  // Assert synthetic account provenance (must not reuse real D1 account 45322)
  if (ukgcResult.accountNumber === "45322") {
    throw new Error("UKGC verification must not use real D1 account 45322");
  }
  if (ukgcResult.accountNumber !== ukgcAccount) {
    throw new Error(`UKGC verification account number must match synthetic fixture '${ukgcAccount}', got '${ukgcResult.accountNumber}'`);
  }
  if (ukgcResult.legalEntityName !== ukgcBusinessName) {
    throw new Error(`UKGC verification legal entity name must match '${ukgcBusinessName}', got '${ukgcResult.legalEntityName}'`);
  }
  if (ukgcResult.licenceNumber !== ukgcLicenceNo) {
    throw new Error(`UKGC verification licence number must match '${ukgcLicenceNo}', got '${ukgcResult.licenceNumber}'`);
  }

  const verifiedCasino = await prisma.casino.findUniqueOrThrow({ where: { id: initialCasino.id } });
  const verifiedLicense = await prisma.license.findUniqueOrThrow({ where: { id: ukgcResult.licenseId } });

  if (verifiedLicense.license_no !== ukgcLicenceNo) {
    throw new Error(`License record license_no must match '${ukgcLicenceNo}', got '${verifiedLicense.license_no}'`);
  }

  if (!verifiedCasino.verified_at) throw new Error("Casino verified_at must be populated after UKGC verification");
  if (verifiedCasino.review_status !== ReviewStatus.AWAITING_REVIEW) {
    throw new Error("Casino review_status must remain AWAITING_REVIEW");
  }
  if (verifiedCasino.publication_status !== PublicationStatus.UNPUBLISHED) {
    throw new Error("Casino publication_status must remain UNPUBLISHED");
  }
  if (verifiedCasino.governance_version !== 1) {
    throw new Error("Casino governance_version must remain unchanged at Stage 3");
  }

  const casinoHistory = await prisma.casinoHistoryEvent.findFirst({
    where: { casino_id: initialCasino.id, event_type: "VERIFICATION" },
  });
  if (!casinoHistory) throw new Error("VERIFICATION CasinoHistoryEvent missing");
  if (casinoHistory.source_url !== UKGC_DATASET_URLS.domains) {
    throw new Error(`CasinoHistoryEvent source_url must be domains register, got ${casinoHistory.source_url}`);
  }

  if (verifiedLicense.status !== "ACTIVE") throw new Error("License status must be ACTIVE");
  if (!verifiedLicense.verified_at) throw new Error("License verified_at must be populated");
  if (verifiedLicense.review_status !== ReviewStatus.AWAITING_REVIEW) {
    throw new Error("License review_status must be AWAITING_REVIEW");
  }

  const licenseClaims = await prisma.licenseEvidenceClaim.findMany({
    where: { license_id: verifiedLicense.id },
  });
  if (licenseClaims.length !== 4) {
    throw new Error(`Expected exactly 4 LicenseEvidenceClaims, got ${licenseClaims.length}`);
  }

  log(` [PASS] UKGC verification created License (${verifiedLicense.id}) and verified Casino\n`);

  // =========================================================================
  // STAGE 4 — HUMAN License governance
  // =========================================================================
  log("STAGE 4: HUMAN License Governance Workflow...");

  const humanActor = await prisma.reviewActor.upsert({
    where: { stable_key: `human:d2-${runId}` },
    update: { active: true },
    create: {
      kind: ActorKind.HUMAN,
      stable_key: `human:d2-${runId}`,
      display_name: `D2 Human Reviewer ${runId}`,
      active: true,
    },
  });

  const licenseClaimIds = licenseClaims.map((c) => c.id);

  // AWAITING_REVIEW -> IN_REVIEW
  const licInReview = await workflowService.transitionLicenseReview({
    subjectId: verifiedLicense.id,
    actorId: humanActor.id,
    expectedVersion: verifiedLicense.governance_version,
    toStatus: ReviewStatus.IN_REVIEW,
    internalReason: "Human reviewer started UKGC license review",
  });

  // IN_REVIEW -> APPROVED
  const licApproved = await workflowService.transitionLicenseReview({
    subjectId: verifiedLicense.id,
    actorId: humanActor.id,
    expectedVersion: licInReview.governanceVersion,
    toStatus: ReviewStatus.APPROVED,
    claimIds: licenseClaimIds,
    internalReason: "Human reviewer approved verified UKGC license",
  });

  const approvedLicense = await prisma.license.findUniqueOrThrow({ where: { id: verifiedLicense.id } });
  if (approvedLicense.review_status !== ReviewStatus.APPROVED) {
    throw new Error("License review_status must be APPROVED");
  }
  if (approvedLicense.governance_version !== 3) {
    throw new Error(`License governance_version must be 3, got ${approvedLicense.governance_version}`);
  }

  const licApproveAudit = await prisma.workflowAuditEvent.findFirstOrThrow({
    where: { id: licApproved.workflowEventId },
    include: { evidence_claims: true },
  });
  if (licApproveAudit.actor_id !== humanActor.id) throw new Error("License approval audit actor must be human actor");
  if (licApproveAudit.evidence_claims.length === 0) throw new Error("License approval claims must be linked to audit event");

  log(` [PASS] Human actor (${humanActor.id}) approved License (${approvedLicense.id})\n`);

  // =========================================================================
  // STAGE 5 — Bonus machine verification
  // =========================================================================
  log("STAGE 5: Bonus Machine Verification via Orchestrator VALIDATE_BONUS...");

  const bonusReverificationNow = new Date();
  const taskHandlers = OrchestratorService.getQueueHandlers([], {
    now: bonusReverificationNow,
    scraperAgent: {
      run: async () => {
        const rawHtml =
          "<html><body>100% Match Bonus up to £200. Wagering 35x. Max conversion £500.</body></html>";
        return {
          url: offerUrl,
          finalUrl: offerUrl,
          title: "D2 Welcome Bonus Terms",
          content:
            "100% Match Bonus up to £200. Wagering 35x. Max conversion £500.",
          rawHtml,
          contentHash: `reverify-content-${runId}`,
          htmlHash: createHash("sha256").update(rawHtml).digest("hex"),
          timestamp: bonusReverificationNow,
        };
      },
    },
    artifactStore: {
      persistObservation: async (input) => ({
        locator: `d2-fixtures/${input.observationId}.html`,
        htmlHash: input.expectedHtmlHash,
        byteSize: Buffer.byteLength(input.rawHtml, "utf8"),
      }),
    },
    bonusAgent: {
      run: async ({ casino_id }) => ({
        casino_id,
        type: "WELCOME",
        headline_value: "100% Match Bonus up to £200",
        wagering_requirement: 35,
        max_conversion: 500,
        status: "ACTIVE",
        valid_from: new Date("2026-01-01T00:00:00.000Z"),
        valid_until: null,
      }),
    },
  });
  await taskHandlers.VALIDATE_BONUS({
    bonusId: initialBonus.id,
    url: offerUrl,
  });

  const machineVerifiedBonus = await prisma.bonus.findUniqueOrThrow({ where: { id: initialBonus.id } });
  if (machineVerifiedBonus.status !== "ACTIVE") throw new Error("Bonus status must be ACTIVE");
  if (!machineVerifiedBonus.verified_at) throw new Error("Bonus verified_at must be populated after VALIDATE_BONUS");
  if (machineVerifiedBonus.review_status !== ReviewStatus.AWAITING_REVIEW) {
    throw new Error("Bonus review_status must remain AWAITING_REVIEW");
  }
  if (machineVerifiedBonus.publication_status !== PublicationStatus.UNPUBLISHED) {
    throw new Error("Bonus publication_status must remain UNPUBLISHED");
  }
  if (machineVerifiedBonus.governance_version !== 1) {
    throw new Error("Bonus governance_version must remain unchanged at Stage 5");
  }

  const bonusVerificationHistory = await prisma.bonusHistoryEvent.findFirst({
    where: { bonus_id: initialBonus.id, field_changed: "verified_at" },
  });
  if (!bonusVerificationHistory) throw new Error("verified_at BonusHistoryEvent missing");
  if (bonusVerificationHistory.source_url !== offerUrl) {
    throw new Error(`BonusHistoryEvent source_url must match offerUrl, got ${bonusVerificationHistory.source_url}`);
  }

  log(` [PASS] Bonus verified_at populated with matching BonusHistoryEvent\n`);

  // =========================================================================
  // STAGE 6 — Pre-publication PublicationGate fail-closed check
  // =========================================================================
  log("STAGE 6: Pre-Publication PublicationGate Fail-Closed Assertion...");

  const prePubCasino = await prisma.casino.findUniqueOrThrow({
    where: { id: initialCasino.id },
    include: { licenses: true, history_events: true },
  });
  const prePubBonus = await prisma.bonus.findUniqueOrThrow({
    where: { id: initialBonus.id },
    include: {
      casino: { include: { licenses: true, history_events: true } },
      history_events: true,
    },
  });

  const casinoEvidencePre = PublicationGateService.getQualifyingCasinoEvidence(prePubCasino);
  const bonusEvidencePre = PublicationGateService.getQualifyingBonusEvidence(prePubBonus);

  if (!casinoEvidencePre) throw new Error("Qualifying Casino evidence must not be null");
  if (!bonusEvidencePre) throw new Error("Qualifying Bonus evidence must not be null");

  if (PublicationGateService.isCasinoPubliclyEligible(prePubCasino) !== false) {
    throw new Error("Unapproved/unpublished Casino must fail PublicationGate");
  }
  if (PublicationGateService.isBonusPubliclyEligible(prePubBonus, prePubCasino) !== false) {
    throw new Error("Unapproved/unpublished Bonus must fail PublicationGate");
  }

  log(" [PASS] PublicationGate fails closed prior to human approval and publication\n");

  // =========================================================================
  // STAGE 7 — HUMAN Casino governance
  // =========================================================================
  log("STAGE 7: HUMAN Casino Governance Workflow...");

  const casinoClaimIds = casinoClaims.map((c) => c.id);

  // AWAITING_REVIEW -> IN_REVIEW
  const casInReview = await workflowService.transitionCasinoReview({
    subjectId: initialCasino.id,
    actorId: humanActor.id,
    expectedVersion: verifiedCasino.governance_version,
    toStatus: ReviewStatus.IN_REVIEW,
    internalReason: "Human review started for Casino",
  });

  // IN_REVIEW -> APPROVED
  const casApproved = await workflowService.transitionCasinoReview({
    subjectId: initialCasino.id,
    actorId: humanActor.id,
    expectedVersion: casInReview.governanceVersion,
    toStatus: ReviewStatus.APPROVED,
    claimIds: casinoClaimIds,
    internalReason: "Human reviewer approved Casino",
  });

  const approvedCasino = await prisma.casino.findUniqueOrThrow({ where: { id: initialCasino.id } });
  if (approvedCasino.review_status !== ReviewStatus.APPROVED) throw new Error("Casino review_status must be APPROVED");
  if (approvedCasino.publication_status !== PublicationStatus.UNPUBLISHED) {
    throw new Error("Casino publication_status must remain UNPUBLISHED");
  }
  if (approvedCasino.governance_version !== 3) {
    throw new Error(`Casino governance_version must be 3, got ${approvedCasino.governance_version}`);
  }

  const casApproveAudit = await prisma.workflowAuditEvent.findFirstOrThrow({
    where: { id: casApproved.workflowEventId },
    include: { evidence_claims: true },
  });
  if (casApproveAudit.actor_id !== humanActor.id) throw new Error("Casino approval actor must be human actor");
  if (casApproveAudit.evidence_claims.length === 0) throw new Error("Casino approval claims must be linked");

  log(` [PASS] Casino (${approvedCasino.id}) approved by human actor\n`);

  // =========================================================================
  // STAGE 8 — HUMAN Bonus governance
  // =========================================================================
  log("STAGE 8: HUMAN Bonus Governance Workflow...");

  const bonusClaimIds = bonusClaims.map((c) => c.id);

  // AWAITING_REVIEW -> IN_REVIEW
  const bonInReview = await workflowService.transitionBonusReview({
    subjectId: initialBonus.id,
    actorId: humanActor.id,
    expectedVersion: machineVerifiedBonus.governance_version,
    toStatus: ReviewStatus.IN_REVIEW,
    internalReason: "Human review started for Bonus",
  });

  // IN_REVIEW -> APPROVED
  const bonApproved = await workflowService.transitionBonusReview({
    subjectId: initialBonus.id,
    actorId: humanActor.id,
    expectedVersion: bonInReview.governanceVersion,
    toStatus: ReviewStatus.APPROVED,
    claimIds: bonusClaimIds,
    internalReason: "Human reviewer approved Bonus",
  });

  const approvedBonus = await prisma.bonus.findUniqueOrThrow({ where: { id: initialBonus.id } });
  if (approvedBonus.review_status !== ReviewStatus.APPROVED) throw new Error("Bonus review_status must be APPROVED");
  if (approvedBonus.publication_status !== PublicationStatus.UNPUBLISHED) {
    throw new Error("Bonus publication_status must remain UNPUBLISHED");
  }
  if (approvedBonus.governance_version !== 3) {
    throw new Error(`Bonus governance_version must be 3, got ${approvedBonus.governance_version}`);
  }

  const bonApproveAudit = await prisma.workflowAuditEvent.findFirstOrThrow({
    where: { id: bonApproved.workflowEventId },
    include: { evidence_claims: true },
  });
  if (bonApproveAudit.actor_id !== humanActor.id) throw new Error("Bonus approval actor must be human actor");
  if (bonApproveAudit.evidence_claims.length === 0) throw new Error("Bonus approval claims must be linked");

  log(` [PASS] Bonus (${approvedBonus.id}) approved by human actor\n`);

  // =========================================================================
  // STAGE 9 — Casino publication
  // =========================================================================
  log("STAGE 9: Casino Publication Transition...");

  const casPubResult = await workflowService.transitionCasinoPublication({
    subjectId: initialCasino.id,
    actorId: humanActor.id,
    expectedVersion: approvedCasino.governance_version,
    toStatus: PublicationStatus.PUBLISHED,
    claimIds: casinoClaimIds,
    internalReason: "Publisher published Casino",
  });

  const publishedCasino = await prisma.casino.findUniqueOrThrow({ where: { id: initialCasino.id } });
  if (publishedCasino.publication_status !== PublicationStatus.PUBLISHED) {
    throw new Error("Casino publication_status must be PUBLISHED");
  }
  if (publishedCasino.governance_version !== 4) {
    throw new Error(`Casino governance_version must be 4, got ${publishedCasino.governance_version}`);
  }

  const casPubAudit = await prisma.workflowAuditEvent.findFirstOrThrow({
    where: { id: casPubResult.workflowEventId },
    include: { evidence_claims: true },
  });
  if (casPubAudit.event_type !== WorkflowEventType.PUBLISHED) throw new Error("Audit event must be PUBLISHED");
  if (casPubAudit.actor_id !== humanActor.id) throw new Error("Audit actor must be human actor");

  // Verify Casino claims linked, but License claims are NOT linked to Casino publication event
  const casPubClaimIds = casPubAudit.evidence_claims.map((c) => c.casino_evidence_claim_id).filter(Boolean);
  const licPubClaimIds = casPubAudit.evidence_claims.map((c) => c.license_evidence_claim_id).filter(Boolean);

  for (const cc of casinoClaimIds) {
    if (!casPubClaimIds.includes(cc)) throw new Error(`Casino claim ${cc} missing from publication event`);
  }
  if (licPubClaimIds.length > 0) {
    throw new Error("License claims must not be linked to Casino publication event");
  }

  log(` [PASS] Casino (${publishedCasino.id}) published (version: ${publishedCasino.governance_version})\n`);

  // =========================================================================
  // STAGE 10 — Bonus publication
  // =========================================================================
  log("STAGE 10: Bonus Publication Transition...");

  const bonPubResult = await workflowService.transitionBonusPublication({
    subjectId: initialBonus.id,
    actorId: humanActor.id,
    expectedVersion: approvedBonus.governance_version,
    toStatus: PublicationStatus.PUBLISHED,
    claimIds: bonusClaimIds,
    internalReason: "Publisher published Bonus",
  });

  const publishedBonus = await prisma.bonus.findUniqueOrThrow({ where: { id: initialBonus.id } });
  if (publishedBonus.publication_status !== PublicationStatus.PUBLISHED) {
    throw new Error("Bonus publication_status must be PUBLISHED");
  }
  if (publishedBonus.governance_version !== 4) {
    throw new Error(`Bonus governance_version must be 4, got ${publishedBonus.governance_version}`);
  }

  const bonPubAudit = await prisma.workflowAuditEvent.findFirstOrThrow({
    where: { id: bonPubResult.workflowEventId },
    include: { evidence_claims: true },
  });
  if (bonPubAudit.event_type !== WorkflowEventType.PUBLISHED) throw new Error("Audit event must be PUBLISHED");
  if (bonPubAudit.actor_id !== humanActor.id) throw new Error("Audit actor must be human actor");

  const bonPubClaimIds = bonPubAudit.evidence_claims.map((c) => c.bonus_evidence_claim_id).filter(Boolean);
  for (const bc of bonusClaimIds) {
    if (!bonPubClaimIds.includes(bc)) throw new Error(`Bonus claim ${bc} missing from publication event`);
  }

  log(` [PASS] Bonus (${publishedBonus.id}) published (version: ${publishedBonus.governance_version})\n`);

  // =========================================================================
  // STAGE 11 — Final PublicationGate
  // =========================================================================
  log("STAGE 11: Final End-to-End PublicationGate Eligibility Verification...");

  const finalCasino = await prisma.casino.findUniqueOrThrow({
    where: { id: initialCasino.id },
    include: { licenses: true, history_events: true },
  });
  const finalBonus = await prisma.bonus.findUniqueOrThrow({
    where: { id: initialBonus.id },
    include: {
      casino: { include: { licenses: true, history_events: true } },
      history_events: true,
    },
  });

  if (PublicationGateService.isCasinoPubliclyEligible(finalCasino) !== true) {
    throw new Error("Final published Casino must pass PublicationGateService.isCasinoPubliclyEligible");
  }
  if (PublicationGateService.isBonusPubliclyEligible(finalBonus, finalCasino) !== true) {
    throw new Error("Final published Bonus must pass PublicationGateService.isBonusPubliclyEligible");
  }

  const finalCasinoEvidence = PublicationGateService.getQualifyingCasinoEvidence(finalCasino);
  if (!finalCasinoEvidence) throw new Error("Final Casino qualifying evidence missing");
  if (finalCasinoEvidence.event_type !== "VERIFICATION") {
    throw new Error(`Casino qualifying evidence event_type must be VERIFICATION, got ${finalCasinoEvidence.event_type}`);
  }
  if (finalCasinoEvidence.source_url !== UKGC_DATASET_URLS.domains) {
    throw new Error(`Casino qualifying evidence source_url must match domains register, got ${finalCasinoEvidence.source_url}`);
  }
  if (new Date(finalCasinoEvidence.occurred_at).getTime() !== new Date(finalCasino.verified_at!).getTime()) {
    throw new Error("Casino qualifying evidence occurred_at must correlate exactly with Casino.verified_at");
  }

  const finalBonusEvidence = PublicationGateService.getQualifyingBonusEvidence(finalBonus);
  if (!finalBonusEvidence) throw new Error("Final Bonus qualifying evidence missing");
  if (finalBonusEvidence.field_changed !== "verified_at") {
    throw new Error(`Bonus qualifying evidence field_changed must be verified_at, got ${finalBonusEvidence.field_changed}`);
  }
  if (new Date(finalBonusEvidence.changed_at).getTime() !== new Date(finalBonus.verified_at!).getTime()) {
    throw new Error("Bonus qualifying evidence changed_at must correlate exactly with Bonus.verified_at");
  }
  if (finalBonusEvidence.source_url !== offerUrl) {
    throw new Error(`Bonus qualifying evidence source_url must match offerUrl, got ${finalBonusEvidence.source_url}`);
  }

  log(" [PASS] PublicationGate verified: both Casino and Bonus are publicly eligible with exact provenance!\n");

  return {
    success: true,
    runId,
    domain,
    casinoId: finalCasino.id,
    bonusId: finalBonus.id,
    licenseId: verifiedLicense.id,
    stagesCompleted: 11,
  };
}
