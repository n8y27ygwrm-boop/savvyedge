import {
  ActorKind,
  EvidenceType,
  EvidenceVerdict,
  LicenseEvidenceField,
  Prisma,
  ReviewStatus,
} from "@savvyedge/database";
import { prisma as defaultPrisma } from "@savvyedge/database";
import {
  hashString,
  normalizeUkgcHost,
  resolveAuthoritativeUkgcLicence,
  ResolvedUkgcLicence,
  UkgcDatasets,
} from "./ukgc-parser";

import { WorkflowTransitionService } from "./workflow-transition.service";

export type UkgcDatasetFetcher = () => Promise<UkgcDatasets>;

export interface VerifyUkgcLicenseInput {
  casinoId: string;
  domain: string;
  diagnosticAccountOverride?: string;
  humanActorId?: string;
  now?: Date;
  fetcher?: UkgcDatasetFetcher;
  db?: Prisma.TransactionClient | typeof defaultPrisma;
}

export interface VerifyUkgcLicenseResult {
  verified: boolean;
  reason?: string;
  accountNumber?: string;
  legalEntityName?: string;
  licenceNumber?: string;
  licenceActivity?: string;
  status?: string;
  regulatorId?: string;
  licenseId?: string;
  evidenceRecordIds?: {
    domainEvidenceId: string;
    businessEvidenceId: string;
    licenceEvidenceId: string;
  };
  evidenceClaimIds?: string[];
  reviewStatus?: ReviewStatus;
  governanceVersion?: number;
  humanApprovalRequired?: boolean;
  details?: Record<string, unknown>;
}

export const UKGC_DATASET_URLS = {
  domains:
    "https://www.gamblingcommission.gov.uk/downloads/business-licence-register-domain-names.csv",
  businesses:
    "https://www.gamblingcommission.gov.uk/downloads/business-licence-register-businesses.csv",
  licences:
    "https://www.gamblingcommission.gov.uk/downloads/business-licence-register-licences.csv",
} as const;


/**
 * Default network fetcher for the 3 official UKGC register CSV datasets.
 */
export const defaultUkgcDatasetFetcher: UkgcDatasetFetcher = async (): Promise<UkgcDatasets> => {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "text/csv,text/plain;q=0.9,*/*;q=0.8",
  };

  const [domainsRes, businessesRes, licencesRes] = await Promise.all([
    fetch(UKGC_DATASET_URLS.domains, { headers }),
    fetch(UKGC_DATASET_URLS.businesses, { headers }),
    fetch(UKGC_DATASET_URLS.licences, { headers }),
  ]);

  if (!domainsRes.ok || !businessesRes.ok || !licencesRes.ok) {
    throw new Error(
      `Failed to fetch UKGC datasets: domains=${domainsRes.status}, businesses=${businessesRes.status}, licences=${licencesRes.status}`,
    );
  }

  const [domainsCsv, businessesCsv, licencesCsv] = await Promise.all([
    domainsRes.text(),
    businessesRes.text(),
    licencesRes.text(),
  ]);

  return { domainsCsv, businessesCsv, licencesCsv };
};

/**
 * Authoritative UKGC License Verification Service.
 *
 * Implements strict domain -> account -> applicable Remote Casino licence resolution
 * from official UK Gambling Commission public register datasets.
 */
export class UkgcLicenseVerifierService {
  public static readonly UKGC_EVIDENCE_TTL_DAYS = 90;

  /**
   * Performs authoritative UKGC license verification for a casino entity and domain.
   */
  public static async verifyCasinoLicense(
    input: VerifyUkgcLicenseInput,
  ): Promise<VerifyUkgcLicenseResult> {
    const {
      casinoId,
      domain,
      diagnosticAccountOverride,
      humanActorId,
      now = new Date(),
      fetcher = defaultUkgcDatasetFetcher,
    } = input;

    const normalizedDomain = normalizeUkgcHost(domain);
    if (!normalizedDomain || !normalizedDomain.includes(".")) {
      return {
        verified: false,
        reason: "INVALID_DOMAIN",
        details: { domain },
      };
    }

    // 1. Fetch authoritative UKGC datasets
    let datasets: UkgcDatasets;
    try {
      datasets = await fetcher();
    } catch (err: any) {
      return {
        verified: false,
        reason: "UKGC_DATASETS_UNAVAILABLE",
        details: { error: err.message },
      };
    }

    // 2. Resolve authoritative domain -> account -> active Remote Casino licence
    const resolution = resolveAuthoritativeUkgcLicence(
      normalizedDomain,
      datasets,
      diagnosticAccountOverride,
    );

    if (!resolution.success) {
      return {
        verified: false,
        reason: resolution.reason,
        details: resolution.details,
      };
    }

    const resolved = resolution.data;
    const db = input.db || defaultPrisma;

    // 3. Execute atomic persistence and governance workflow
    return this.persistAuthoritativeLicense(
      db,
      casinoId,
      resolved,
      humanActorId,
      now,
    );
  }

  /**
   * Persists the authoritative evidence, updates the canonical License record,
   * and executes legal workflow transitions without manufacturing human approvals.
   */
  private static async persistAuthoritativeLicense(
    db: Prisma.TransactionClient | typeof defaultPrisma,
    casinoId: string,
    resolved: ResolvedUkgcLicence,
    humanActorId: string | undefined,
    now: Date,
  ): Promise<VerifyUkgcLicenseResult> {

    const executeInTx = async (tx: Prisma.TransactionClient) => {
      // 1. Resolve Jurisdiction (UK)
      const jurisdiction = await tx.jurisdiction.upsert({
        where: { slug: "uk" },
        update: { name: "United Kingdom", country: "GB" },
        create: { slug: "uk", name: "United Kingdom", country: "GB" },
      });

      // 2. Resolve Regulator (UKGC)
      const regulator = await tx.regulator.upsert({
        where: { slug: "ukgc" },
        update: {
          name: "UK Gambling Commission",
          jurisdiction_id: jurisdiction.id,
          website_url: "https://www.gamblingcommission.gov.uk",
        },
        create: {
          slug: "ukgc",
          name: "UK Gambling Commission",
          jurisdiction_id: jurisdiction.id,
          website_url: "https://www.gamblingcommission.gov.uk",
        },
      });

      // 3. Resolve DataSources for each distinct dataset
      const resolveDataSource = async (url: string) => {
        let ds = await tx.dataSource.findFirst({ where: { url } });
        if (!ds) {
          ds = await tx.dataSource.create({
            data: {
              url,
              normalized_url: url,
              source_type: "REGULATOR_REGISTER",
              last_scraped_at: now,
              reliability_score: 1.0,
            },
          });
        } else {
          await tx.dataSource.update({
            where: { id: ds.id },
            data: { last_scraped_at: now },
          });
        }
        return ds;
      };

      const [domainDs, businessDs, licenceDs] = await Promise.all([
        resolveDataSource(UKGC_DATASET_URLS.domains),
        resolveDataSource(UKGC_DATASET_URLS.businesses),
        resolveDataSource(UKGC_DATASET_URLS.licences),
      ]);

      // 4. Resolve Automated Service ReviewActor (never impersonating a HUMAN)
      const serviceActor = await tx.reviewActor.upsert({
        where: { stable_key: "service:ukgc-verifier" },
        update: { active: true },
        create: {
          kind: ActorKind.SERVICE,
          stable_key: "service:ukgc-verifier",
          display_name: "UKGC License Verifier",
          active: true,
        },
      });

      // 5. Resolve Canonical License Record (Idempotent by casino_id + regulator_id + licence_number)
      let license = await tx.license.findFirst({
        where: {
          casino_id: casinoId,
          regulator_id: regulator.id,
          normalized_license_no: resolved.licenceNumber,
        },
      });

      if (!license) {
        license = await tx.license.create({
          data: {
            casino_id: casinoId,
            regulator_id: regulator.id,
            license_no: resolved.licenceNumber,
            normalized_license_no: resolved.licenceNumber,
            status: "ACTIVE",
            verified_at: now,
            review_status: ReviewStatus.NEW,
            governance_version: 0,
          },
        });
      } else {
        license = await tx.license.update({
          where: { id: license.id },
          data: {
            license_no: resolved.licenceNumber,
            status: "ACTIVE",
            verified_at: now,
          },
        });
      }

      // 6. Create 3 Distinct EvidenceRecords with real observation timestamps
      const expiresAt = new Date(
        now.getTime() + this.UKGC_EVIDENCE_TTL_DAYS * 24 * 60 * 60 * 1000,
      );

      let startDateParsed: Date | null = null;
      if (resolved.startDate) {
        const parsed = new Date(resolved.startDate);
        if (!isNaN(parsed.getTime())) {
          startDateParsed = parsed;
        }
      }

      const [domainEvidence, businessEvidence, licenceEvidence] =
        await Promise.all([
          tx.evidenceRecord.create({
            data: {
              data_source_id: domainDs.id,
              evidence_type: EvidenceType.REGULATOR_REGISTER,
              source_url: UKGC_DATASET_URLS.domains,
              observed_at: now,
              extracted_at: now,
              valid_from: null,
              expires_at: expiresAt,
              created_by_id: serviceActor.id,
              content_hash: resolved.domainEvidenceHash,
            },
          }),
          tx.evidenceRecord.create({
            data: {
              data_source_id: businessDs.id,
              evidence_type: EvidenceType.REGULATOR_REGISTER,
              source_url: UKGC_DATASET_URLS.businesses,
              observed_at: now,
              extracted_at: now,
              valid_from: null,
              expires_at: expiresAt,
              created_by_id: serviceActor.id,
              content_hash: resolved.businessEvidenceHash,
            },
          }),
          tx.evidenceRecord.create({
            data: {
              data_source_id: licenceDs.id,
              evidence_type: EvidenceType.REGULATOR_REGISTER,
              source_url: UKGC_DATASET_URLS.licences,
              observed_at: now,
              extracted_at: now,
              valid_from: startDateParsed,
              expires_at: expiresAt,
              created_by_id: serviceActor.id,
              content_hash: resolved.licenceEvidenceHash,
            },
          }),
        ]);


      // 7. Create LicenseEvidenceClaims with repository standard hash convention
      // normalizer-v1:${field}:${hashString(val)}
      const claimRecords = [
        {
          evidenceId: domainEvidence.id,
          field: LicenseEvidenceField.CASINO_ASSOCIATION,
          value: resolved.domainName,
        },
        {
          evidenceId: businessEvidence.id,
          field: LicenseEvidenceField.REGULATOR,
          value: "UK Gambling Commission",
        },
        {
          evidenceId: licenceEvidence.id,
          field: LicenseEvidenceField.LICENSE_NUMBER,
          value: resolved.licenceNumber,
        },
        {
          evidenceId: licenceEvidence.id,
          field: LicenseEvidenceField.STATUS,
          value: "ACTIVE",
        },
      ];

      const claimIds: string[] = [];
      for (const c of claimRecords) {
        const claim = await tx.licenseEvidenceClaim.create({
          data: {
            evidence_id: c.evidenceId,
            license_id: license.id,
            field: c.field,
            observed_value: c.value,
            normalized_value_hash: `normalizer-v1:${c.field}:${hashString(c.value)}`,
            verdict: EvidenceVerdict.SUPPORTS,
          },
        });
        claimIds.push(claim.id);
      }

      // 8. Governance Workflow Execution
      const workflowService = new WorkflowTransitionService(tx as any);
      let finalReviewStatus = license.review_status;
      let finalGovernanceVersion = license.governance_version;

      if (humanActorId) {
        // Human approval path: Verify human actor is genuine and execute legal transitions
        const humanActor = await tx.reviewActor.findUnique({
          where: { id: humanActorId },
        });

        if (!humanActor || humanActor.kind !== ActorKind.HUMAN || !humanActor.active) {
          throw new Error("Invalid or unauthorized human actor for approval");
        }

        if (finalReviewStatus === ReviewStatus.NEW) {
          const subRes = await workflowService.transitionLicenseReview({
            subjectId: license.id,
            actorId: serviceActor.id,
            expectedVersion: finalGovernanceVersion,
            toStatus: ReviewStatus.AWAITING_REVIEW,
            claimIds,
            internalReason: "Authoritative UKGC verification discovered valid active licence",
          });
          finalReviewStatus = subRes.reviewStatus;
          finalGovernanceVersion = subRes.governanceVersion;
        }

        if (finalReviewStatus === ReviewStatus.AWAITING_REVIEW) {
          const inRevRes = await workflowService.transitionLicenseReview({
            subjectId: license.id,
            actorId: humanActor.id,
            expectedVersion: finalGovernanceVersion,
            toStatus: ReviewStatus.IN_REVIEW,
            internalReason: "Human review started for UKGC license",
          });
          finalReviewStatus = inRevRes.reviewStatus;
          finalGovernanceVersion = inRevRes.governanceVersion;
        }

        if (finalReviewStatus === ReviewStatus.IN_REVIEW) {
          const appRes = await workflowService.transitionLicenseReview({
            subjectId: license.id,
            actorId: humanActor.id,
            expectedVersion: finalGovernanceVersion,
            toStatus: ReviewStatus.APPROVED,
            claimIds,
            internalReason: `Human reviewer approved verified UKGC licence ${resolved.licenceNumber}`,
          });
          finalReviewStatus = appRes.reviewStatus;
          finalGovernanceVersion = appRes.governanceVersion;
        }
      } else {
        // Automated ingestion path: Submit for review if NEW, leaving final approval to human reviewer
        if (finalReviewStatus === ReviewStatus.NEW) {
          const subRes = await workflowService.transitionLicenseReview({
            subjectId: license.id,
            actorId: serviceActor.id,
            expectedVersion: finalGovernanceVersion,
            toStatus: ReviewStatus.AWAITING_REVIEW,
            claimIds,
            internalReason: "Authoritative UKGC verification discovered valid active licence",
          });
          finalReviewStatus = subRes.reviewStatus;
          finalGovernanceVersion = subRes.governanceVersion;
        }
      }

      return {
        verified: true,
        accountNumber: resolved.accountNumber,
        legalEntityName: resolved.accountName,
        licenceNumber: resolved.licenceNumber,
        licenceActivity: resolved.licenceActivity,
        status: resolved.licenceStatus,
        regulatorId: regulator.id,
        licenseId: license.id,
        evidenceRecordIds: {
          domainEvidenceId: domainEvidence.id,
          businessEvidenceId: businessEvidence.id,
          licenceEvidenceId: licenceEvidence.id,
        },
        evidenceClaimIds: claimIds,
        reviewStatus: finalReviewStatus,
        governanceVersion: finalGovernanceVersion,
        humanApprovalRequired: finalReviewStatus !== ReviewStatus.APPROVED,
      };
    };

    if ("$transaction" in db) {
      return (db as typeof defaultPrisma).$transaction(executeInTx);
    } else {
      return executeInTx(db as Prisma.TransactionClient);
    }
  }
}
