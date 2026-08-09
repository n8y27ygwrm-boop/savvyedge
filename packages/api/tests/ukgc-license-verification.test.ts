import { describe, expect, it, vi } from "vitest";
import {
  hashString,
  isApplicableRemoteCasinoActivity,
  mapUkgcStrictStatus,
  normalizeUkgcHost,
  parseBusinessDataset,
  parseDomainDataset,
  parseLicenceDataset,
  resolveAuthoritativeUkgcLicence,
  UkgcDatasets,
  UkgcLicenseVerifierService,
  UKGC_DATASET_URLS,
} from "../src";
import {
  ActorKind,
  EvidenceType,
  EvidenceVerdict,
  LicenseEvidenceField,
  ReviewStatus,
} from "@savvyedge/database";

// Real UKGC CSV Dataset Fixtures matching official Gambling Commission headers
const MOCK_DOMAINS_CSV = `
"Account Number","Domain Name","Status"
"45322","unibet.co.uk","Active"
"45322","bingo.unibet.co.uk","Active"
"45322","maria.co.uk","Active"
"45322","old-brand.co.uk","Inactive"
"45322","partner-whitelabel.co.uk","White Label"
"88888","suspended-licence.co.uk","Active"
"77777","betting-only.co.uk","Active"
"77776","bingo-only.co.uk","Active"
"66666","ambiguous-casino.co.uk","Active"
"55555","shared-brand.co.uk","Active"
"44444","shared-brand.co.uk","Active"
"33333","expired-casino.co.uk","Active"
"22222","non-remote-casino.co.uk","Active"
`;

const MOCK_BUSINESSES_CSV = `
"Account Number","Licence Account Name"
"45322","Platinum Gaming Limited"
"88888","Suspended Licence Limited"
"77777","Betting Only Limited"
"77776","Bingo Only Limited"
"66666","Ambiguous Gaming Limited"
"55555","MultiAccount Gaming Limited"
"44444","MultiAccount Two Limited"
"33333","Expired Licence Limited"
"22222","Land Based Casino Limited"
`;

const MOCK_LICENCES_CSV = `
"Account Number","Licence Number","Status","Type","Activity","Start Date","End Date"
"45322","045322-R-324275-019","Active","Remote","Casino","2016-07-12T00:00:00+00:00",""
"45322","045322-R-324275-019","Active","Remote","General Betting Standard - Real Event","2016-07-12T00:00:00+00:00",""
"45322","045322-N-100001-001","Active","Non-Remote","Casino","2016-07-12T00:00:00+00:00",""
"88888","088888-R-000001-001","Suspended","Remote","Casino","2018-01-01T00:00:00+00:00",""
"77777","077777-R-000001-001","Active","Remote","General Betting Standard - Real Event","2019-01-01T00:00:00+00:00",""
"77776","077776-R-000001-001","Active","Remote","Bingo","2019-01-01T00:00:00+00:00",""
"66666","066666-R-000001-001","Active","Remote","Casino","2020-01-01T00:00:00+00:00",""
"66666","066666-R-000002-001","Active","Remote","Casino","2020-01-01T00:00:00+00:00",""
"33333","033333-R-000001-001","Expired","Remote","Casino","2015-01-01T00:00:00+00:00",""
"22222","022222-N-000001-001","Active","Non-Remote","Casino","2015-01-01T00:00:00+00:00",""
`;

const standardMockDatasets: UkgcDatasets = {
  domainsCsv: MOCK_DOMAINS_CSV,
  businessesCsv: MOCK_BUSINESSES_CSV,
  licencesCsv: MOCK_LICENCES_CSV,
};

describe("Authoritative UKGC License Verification (Real CSV Data Shapes)", () => {
  describe("1. Pure Deterministic CSV Parsers & Real Header Models", () => {
    it("parses real official domain, business, and licence CSV datasets correctly", () => {
      const domains = parseDomainDataset(MOCK_DOMAINS_CSV);
      expect(domains.length).toBeGreaterThan(5);
      expect(domains[0]).toEqual({
        accountNumber: "45322",
        domainName: "unibet.co.uk",
        status: "Active",
      });

      const businesses = parseBusinessDataset(MOCK_BUSINESSES_CSV);
      expect(businesses.length).toBeGreaterThan(3);
      expect(businesses[0]).toEqual({
        accountNumber: "45322",
        accountName: "Platinum Gaming Limited",
      });

      const licences = parseLicenceDataset(MOCK_LICENCES_CSV);
      expect(licences.length).toBeGreaterThan(5);
      expect(licences[0]).toEqual({
        accountNumber: "45322",
        licenceNumber: "045322-R-324275-019",
        status: "Active",
        type: "Remote",
        activity: "Casino",
        startDate: "2016-07-12T00:00:00+00:00",
        endDate: "",
      });
    });

    it("evaluates remote casino activities accurately with exact Type=Remote and Activity=Casino predicate", () => {
      expect(isApplicableRemoteCasinoActivity("Remote", "Casino")).toBe(true);
      expect(isApplicableRemoteCasinoActivity("remote", "casino")).toBe(true);
      expect(isApplicableRemoteCasinoActivity("Remote", "Bingo")).toBe(false);
      expect(isApplicableRemoteCasinoActivity("Remote", "General Betting Standard - Real Event")).toBe(false);
      expect(isApplicableRemoteCasinoActivity("Non-Remote", "Casino")).toBe(false);
      expect(isApplicableRemoteCasinoActivity("Remote", "Gambling Software")).toBe(false);
    });
  });

  describe("2. Domain Normalization & Association Rules", () => {
    it("normalizes www. prefixes, protocol, and ports without stripping m.", () => {
      expect(normalizeUkgcHost("https://www.unibet.co.uk/casino")).toBe("unibet.co.uk");
      expect(normalizeUkgcHost("http://WWW.UNIBET.CO.UK:443/")).toBe("unibet.co.uk");
      // Must NOT strip m. prefix
      expect(normalizeUkgcHost("https://m.unibet.co.uk")).toBe("m.unibet.co.uk");
    });

    it("does not allow reverse-subdomain authorization", () => {
      const datasetsWithoutParent: UkgcDatasets = {
        domainsCsv: `"Account Number","Domain Name","Status"\n"45322","bingo.unibet.co.uk","Active"`,
        businessesCsv: MOCK_BUSINESSES_CSV,
        licencesCsv: MOCK_LICENCES_CSV,
      };

      const res = resolveAuthoritativeUkgcLicence("unibet.co.uk", datasetsWithoutParent);
      expect(res.success).toBe(false);
      expect(res.reason).toBe("DOMAIN_NOT_FOUND");
    });
  });

  describe("3. Strict Status Policy Mapping", () => {
    it("only exact 'Active' maps to 'ACTIVE'", () => {
      expect(mapUkgcStrictStatus("Active")).toBe("ACTIVE");
      expect(mapUkgcStrictStatus("active")).toBe("ACTIVE");

      // Registered and Granted do NOT map to ACTIVE
      expect(mapUkgcStrictStatus("Registered")).toBe("UNKNOWN");
      expect(mapUkgcStrictStatus("Granted")).toBe("UNKNOWN");
      expect(mapUkgcStrictStatus("registered")).toBe("UNKNOWN");
      expect(mapUkgcStrictStatus("granted")).toBe("UNKNOWN");

      // Other non-active statuses
      expect(mapUkgcStrictStatus("Suspended")).toBe("SUSPENDED");
      expect(mapUkgcStrictStatus("Surrendered")).toBe("SURRENDERED");
      expect(mapUkgcStrictStatus("Revoked")).toBe("REVOKED");
      expect(mapUkgcStrictStatus("Revoked (Non payment of fee)")).toBe("REVOKED");
      expect(mapUkgcStrictStatus("Expired")).toBe("EXPIRED");
      expect(mapUkgcStrictStatus("Lapsed")).toBe("LAPSED");
      expect(mapUkgcStrictStatus("Forfeited")).toBe("FORFEITED");
      expect(mapUkgcStrictStatus("Pending")).toBe("PENDING");
    });
  });

  describe("4. Authoritative Domain -> Account -> Licence Resolution", () => {
    it("resolves exact active domain to account and actual operating licence number", () => {
      const res = resolveAuthoritativeUkgcLicence("unibet.co.uk", standardMockDatasets);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.accountNumber).toBe("45322");
        expect(res.data.accountName).toBe("Platinum Gaming Limited");
        expect(res.data.licenceNumber).toBe("045322-R-324275-019");
        expect(res.data.licenceNumber).not.toBe("45322");
        expect(res.data.licenceType).toBe("Remote");
        expect(res.data.licenceActivity).toBe("Casino");
        expect(res.data.licenceStatus).toBe("ACTIVE");
        expect(res.data.domainStatus).toBe("ACTIVE");
        expect(res.data.startDate).toBe("2016-07-12T00:00:00+00:00");
      }
    });

    it("does not create false ambiguity when multiple rows share the same licence number for different activities", () => {
      // Account 45322 has rows for Casino and General Betting Standard both with licence '045322-R-324275-019'
      const res = resolveAuthoritativeUkgcLicence("unibet.co.uk", standardMockDatasets);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.licenceNumber).toBe("045322-R-324275-019");
      }
    });

    it("fails closed when Remote + Bingo only (no Casino licence)", () => {
      const res = resolveAuthoritativeUkgcLicence("bingo-only.co.uk", standardMockDatasets);
      expect(res.success).toBe(false);
      expect(res.reason).toBe("NO_REMOTE_CASINO_LICENCE");
    });

    it("fails closed when Remote + General Betting Standard only (no Casino licence)", () => {
      const res = resolveAuthoritativeUkgcLicence("betting-only.co.uk", standardMockDatasets);
      expect(res.success).toBe(false);
      expect(res.reason).toBe("NO_REMOTE_CASINO_LICENCE");
    });

    it("fails closed when Non-Remote + Casino only (no Remote Casino licence)", () => {
      const res = resolveAuthoritativeUkgcLicence("non-remote-casino.co.uk", standardMockDatasets);
      expect(res.success).toBe(false);
      expect(res.reason).toBe("NO_REMOTE_CASINO_LICENCE");
    });

    it("fails closed when Remote + Casino licence is Suspended", () => {
      const res = resolveAuthoritativeUkgcLicence("suspended-licence.co.uk", standardMockDatasets);
      expect(res.success).toBe(false);
      expect(res.reason).toBe("LICENCE_STATUS_SUSPENDED");
    });

    it("fails closed when Remote + Casino licence is Expired", () => {
      const res = resolveAuthoritativeUkgcLicence("expired-casino.co.uk", standardMockDatasets);
      expect(res.success).toBe(false);
      expect(res.reason).toBe("LICENCE_STATUS_EXPIRED");
    });

    it("fails closed when two distinct active Remote Casino licence numbers exist (ambiguity)", () => {
      const res = resolveAuthoritativeUkgcLicence("ambiguous-casino.co.uk", standardMockDatasets);
      expect(res.success).toBe(false);
      expect(res.reason).toBe("AMBIGUOUS_APPLICABLE_LICENCE");
    });

    it("fails closed when domain is Inactive", () => {
      const res = resolveAuthoritativeUkgcLicence("old-brand.co.uk", standardMockDatasets);
      expect(res.success).toBe(false);
      expect(res.reason).toBe("DOMAIN_INACTIVE");
    });

    it("fails closed when domain is White Label in this boundary", () => {
      const res = resolveAuthoritativeUkgcLicence("partner-whitelabel.co.uk", standardMockDatasets);
      expect(res.success).toBe(false);
      expect(res.reason).toBe("DOMAIN_WHITE_LABEL");
    });

    it("fails closed when domain is not in the dataset", () => {
      const res = resolveAuthoritativeUkgcLicence("nonexistent-casino.co.uk", standardMockDatasets);
      expect(res.success).toBe(false);
      expect(res.reason).toBe("DOMAIN_NOT_FOUND");
    });
  });

  describe("5. Persistence, Multi-Evidence Provenance & Governance Integrity", () => {
    const createMockDatabase = () => {
      const state = {
        jurisdictions: new Map<string, any>(),
        regulators: new Map<string, any>(),
        dataSources: new Map<string, any>(),
        reviewActors: new Map<string, any>(),
        licenses: new Map<string, any>(),
        evidenceRecords: new Map<string, any>(),
        licenseEvidenceClaims: new Map<string, any>(),
        workflowAuditEvents: new Map<string, any>(),
        workflowEventClaims: new Map<string, any>(),
      };

      let idCounter = 1;
      const nextId = (prefix: string) => `${prefix}-${idCounter++}`;

      const mockDb: any = {
        jurisdiction: {
          upsert: vi.fn().mockImplementation(async ({ create }: any) => {
            const row = { id: nextId("jurisdiction"), ...create };
            state.jurisdictions.set(row.slug, row);
            return row;
          }),
        },
        regulator: {
          upsert: vi.fn().mockImplementation(async ({ create }: any) => {
            const row = { id: nextId("regulator"), ...create };
            state.regulators.set(row.slug, row);
            return row;
          }),
        },
        dataSource: {
          findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
            for (const ds of state.dataSources.values()) {
              if (ds.url === where.url) return ds;
            }
            return null;
          }),
          create: vi.fn().mockImplementation(async ({ data }: any) => {
            const row = { id: nextId("datasource"), ...data };
            state.dataSources.set(row.id, row);
            return row;
          }),
          update: vi.fn(),
        },
        reviewActor: {
          upsert: vi.fn().mockImplementation(async ({ create }: any) => {
            const row = { id: nextId("actor"), ...create };
            state.reviewActors.set(row.stable_key, row);
            state.reviewActors.set(row.id, row);
            return row;
          }),
          findUnique: vi.fn().mockImplementation(async ({ where }: any) => {
            if (where.id) return state.reviewActors.get(where.id) || null;
            if (where.stable_key) return state.reviewActors.get(where.stable_key) || null;
            return null;
          }),
        },
        license: {
          findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
            for (const lic of state.licenses.values()) {
              if (
                lic.casino_id === where.casino_id &&
                lic.normalized_license_no === where.normalized_license_no
              ) {
                return lic;
              }
            }
            return null;
          }),
          findUnique: vi.fn().mockImplementation(async ({ where }: any) => {
            return state.licenses.get(where.id) || null;
          }),
          create: vi.fn().mockImplementation(async ({ data }: any) => {
            const row = { id: nextId("license"), ...data };
            state.licenses.set(row.id, row);
            return row;
          }),
          update: vi.fn().mockImplementation(async ({ where, data }: any) => {
            const existing = state.licenses.get(where.id);
            const updated = { ...existing, ...data };
            state.licenses.set(where.id, updated);
            return updated;
          }),
          updateMany: vi.fn().mockImplementation(async ({ where, data }: any) => {
            let count = 0;
            for (const [id, license] of state.licenses.entries()) {
              if (
                (!where.id || where.id === id) &&
                (!where.review_status || where.review_status === license.review_status) &&
                (where.governance_version === undefined || where.governance_version === license.governance_version)
              ) {
                const newVersion =
                  data.governance_version && typeof data.governance_version === "object" && "increment" in data.governance_version
                    ? (license.governance_version || 0) + data.governance_version.increment
                    : data.governance_version !== undefined
                      ? data.governance_version
                      : license.governance_version;

                state.licenses.set(id, {
                  ...license,
                  ...data,
                  governance_version: newVersion,
                });
                count++;
              }
            }
            return { count };
          }),
        },
        evidenceRecord: {
          create: vi.fn().mockImplementation(async ({ data }: any) => {
            const row = { id: nextId("evidence"), ...data };
            state.evidenceRecords.set(row.id, row);
            return row;
          }),
          findMany: vi.fn().mockImplementation(async ({ where }: any) => {
            return Array.from(state.evidenceRecords.values()).filter((e) =>
              where.id.in.includes(e.id),
            );
          }),
        },
        licenseEvidenceClaim: {
          create: vi.fn().mockImplementation(async ({ data }: any) => {
            const row = { id: nextId("claim"), ...data };
            state.licenseEvidenceClaims.set(row.id, row);
            return row;
          }),
          findMany: vi.fn().mockImplementation(async ({ where }: any) => {
            return Array.from(state.licenseEvidenceClaims.values()).filter((c) =>
              where.id.in.includes(c.id),
            );
          }),
        },
        workflowAuditEvent: {
          create: vi.fn().mockImplementation(async ({ data }: any) => {
            const row = { id: nextId("event"), ...data };
            state.workflowAuditEvents.set(row.id, row);
            return row;
          }),
        },
        workflowEventClaim: {
          create: vi.fn().mockImplementation(async ({ data }: any) => {
            const row = { id: nextId("eventclaim"), ...data };
            state.workflowEventClaims.set(row.id, row);
            return row;
          }),
        },
        casino: {
          findUnique: vi.fn().mockResolvedValue({
            id: "casino-123",
            name: "Unibet",
          }),
        },
      };

      return { mockDb, state };
    };

    it("verifies active domain and creates 3 distinct evidence records with SERVICE actor, stopping at AWAITING_REVIEW", async () => {
      const { mockDb, state } = createMockDatabase();
      const mockFetcher = vi.fn().mockResolvedValue(standardMockDatasets);
      const now = new Date();

      const result = await UkgcLicenseVerifierService.verifyCasinoLicense({
        casinoId: "casino-123",
        domain: "www.unibet.co.uk",
        now,
        fetcher: mockFetcher,
        db: mockDb,
      });

      expect(result.verified).toBe(true);
      expect(result.accountNumber).toBe("45322");
      expect(result.legalEntityName).toBe("Platinum Gaming Limited");
      expect(result.licenceNumber).toBe("045322-R-324275-019");
      expect(result.status).toBe("ACTIVE");
      expect(result.humanApprovalRequired).toBe(true);
      expect(result.reviewStatus).toBe(ReviewStatus.AWAITING_REVIEW);

      // Verify Service Actor was created (NO fake human actor)
      const serviceActor = state.reviewActors.get("service:ukgc-verifier");
      expect(serviceActor).toBeDefined();
      expect(serviceActor.kind).toBe(ActorKind.SERVICE);
      expect(state.reviewActors.has("human:ukgc-verifier")).toBe(false);

      // Verify License record
      expect(state.licenses.size).toBe(1);
      const license = Array.from(state.licenses.values())[0];
      expect(license.casino_id).toBe("casino-123");
      expect(license.license_no).toBe("045322-R-324275-019");
      expect(license.normalized_license_no).toBe("045322-R-324275-019");
      expect(license.status).toBe("ACTIVE");
      expect(license.review_status).toBe(ReviewStatus.AWAITING_REVIEW);

      // Verify 3 distinct Evidence Records
      expect(state.evidenceRecords.size).toBe(3);
      const evidenceRecords = Array.from(state.evidenceRecords.values());
      const sourceUrls = evidenceRecords.map((e) => e.source_url);
      expect(sourceUrls).toContain(UKGC_DATASET_URLS.domains);
      expect(sourceUrls).toContain(UKGC_DATASET_URLS.businesses);
      expect(sourceUrls).toContain(UKGC_DATASET_URLS.licences);

      // Real non-fabricated timestamps
      evidenceRecords.forEach((e) => {
        expect(e.observed_at.getTime()).toBe(now.getTime());
        expect(e.extracted_at.getTime()).toBe(now.getTime());
        expect(e.expires_at.getTime()).toBe(now.getTime() + 90 * 24 * 60 * 60 * 1000);
      });

      // Licence evidence valid_from is mapped from Start Date
      const licenceEv = evidenceRecords.find((e) => e.source_url === UKGC_DATASET_URLS.licences);
      expect(licenceEv?.valid_from).toEqual(new Date("2016-07-12T00:00:00+00:00"));

      // Verify License Evidence Claims with standard hash convention
      expect(state.licenseEvidenceClaims.size).toBe(4);
      const claims = Array.from(state.licenseEvidenceClaims.values());
      claims.forEach((c) => {
        expect(c.normalized_value_hash).toMatch(/^normalizer-v1:[A-Z_]+:[0-9a-f]{16}$/);
        expect(c.verdict).toBe(EvidenceVerdict.SUPPORTS);
      });

      const associationClaim = claims.find((c) => c.field === LicenseEvidenceField.CASINO_ASSOCIATION);
      expect(associationClaim?.observed_value).toBe("unibet.co.uk");
      expect(associationClaim?.normalized_value_hash).toBe(
        `normalizer-v1:CASINO_ASSOCIATION:${hashString("unibet.co.uk")}`,
      );

      const licenceNumClaim = claims.find((c) => c.field === LicenseEvidenceField.LICENSE_NUMBER);
      expect(licenceNumClaim?.observed_value).toBe("045322-R-324275-019");
      expect(licenceNumClaim?.normalized_value_hash).toBe(
        `normalizer-v1:LICENSE_NUMBER:${hashString("045322-R-324275-019")}`,
      );
    });

    it("approves license through legal workflow transitions when a genuine HUMAN actor is provided", async () => {
      const { mockDb, state } = createMockDatabase();
      const mockFetcher = vi.fn().mockResolvedValue(standardMockDatasets);
      const now = new Date();

      // Seed a real human reviewer
      const humanReviewer = {
        id: "human-reviewer-123",
        kind: ActorKind.HUMAN,
        stable_key: "human:john-reviewer",
        display_name: "John Reviewer",
        active: true,
      };
      state.reviewActors.set(humanReviewer.id, humanReviewer);
      state.reviewActors.set(humanReviewer.stable_key, humanReviewer);

      const result = await UkgcLicenseVerifierService.verifyCasinoLicense({
        casinoId: "casino-123",
        domain: "unibet.co.uk",
        humanActorId: humanReviewer.id,
        now,
        fetcher: mockFetcher,
        db: mockDb,
      });

      expect(result.verified).toBe(true);
      expect(result.reviewStatus).toBe(ReviewStatus.APPROVED);
      expect(result.humanApprovalRequired).toBe(false);
      expect(result.governanceVersion).toBe(3); // NEW -> AWAITING_REVIEW (v1) -> IN_REVIEW (v2) -> APPROVED (v3)

      const license = Array.from(state.licenses.values())[0];
      expect(license.review_status).toBe(ReviewStatus.APPROVED);
      expect(license.governance_version).toBe(3);
    });

    it("remains idempotent on re-verification without creating duplicate License records", async () => {
      const { mockDb, state } = createMockDatabase();
      const mockFetcher = vi.fn().mockResolvedValue(standardMockDatasets);

      const run1 = await UkgcLicenseVerifierService.verifyCasinoLicense({
        casinoId: "casino-123",
        domain: "unibet.co.uk",
        fetcher: mockFetcher,
        db: mockDb,
      });
      expect(run1.verified).toBe(true);
      expect(state.licenses.size).toBe(1);
      const licenseId = run1.licenseId;

      const run2 = await UkgcLicenseVerifierService.verifyCasinoLicense({
        casinoId: "casino-123",
        domain: "unibet.co.uk",
        fetcher: mockFetcher,
        db: mockDb,
      });
      expect(run2.verified).toBe(true);
      expect(run2.licenseId).toBe(licenseId);
      expect(state.licenses.size).toBe(1);
    });
  });
});
