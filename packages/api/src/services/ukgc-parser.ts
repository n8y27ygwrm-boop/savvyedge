import crypto from "crypto";

export interface UkgcDomainRow {
  accountNumber: string;
  domainName: string;
  status: string;
}

export interface UkgcBusinessRow {
  accountNumber: string;
  accountName: string;
}

export interface UkgcLicenceRow {
  accountNumber: string;
  licenceNumber: string;
  status: string;
  type: string;
  activity: string;
  startDate?: string;
  endDate?: string;
}

export interface UkgcDatasets {
  domainsCsv: string;
  businessesCsv: string;
  licencesCsv: string;
}

export interface ResolvedUkgcLicence {
  accountNumber: string;
  accountName: string;
  domainName: string;
  domainStatus: "ACTIVE";
  licenceNumber: string;
  licenceType: string;
  licenceActivity: string;
  licenceStatus: "ACTIVE";
  startDate?: string;
  endDate?: string;
  domainEvidenceHash: string;
  businessEvidenceHash: string;
  licenceEvidenceHash: string;
}

export type UkgcResolutionResult =
  | { success: true; data: ResolvedUkgcLicence }
  | { success: false; reason: string; details?: Record<string, unknown> };

/**
 * Normalizes host strings by stripping protocol, trailing dots, ports, paths, and www. prefix.
 * Strict rules:
 * - Does NOT strip 'm.' prefix.
 * - Does NOT perform reverse subdomain matching.
 */
export function normalizeUkgcHost(rawHostOrUrl: string): string {
  if (!rawHostOrUrl) {
    return "";
  }

  let host = rawHostOrUrl.trim().toLowerCase();
  if (host.startsWith("http://") || host.startsWith("https://")) {
    try {
      host = new URL(host).hostname;
    } catch {
      // Fall through to string cleanup
    }
  }

  host = host
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .replace(/\.+$/, "")
    .trim();

  if (host.startsWith("www.")) {
    host = host.slice(4);
  }

  return host;
}

/**
 * Strict status mapper. ONLY exact "Active" maps to "ACTIVE".
 * "Registered", "Granted", "Pending", "Suspended", "Surrendered", "Revoked", "Expired", etc. do NOT map to "ACTIVE".
 */
export function mapUkgcStrictStatus(
  rawStatus: string,
): "ACTIVE" | "SUSPENDED" | "SURRENDERED" | "REVOKED" | "EXPIRED" | "LAPSED" | "FORFEITED" | "PENDING" | "UNKNOWN" {
  const normalized = (rawStatus || "").trim().toLowerCase();
  if (normalized === "active") {
    return "ACTIVE";
  }
  if (normalized === "suspended") {
    return "SUSPENDED";
  }
  if (normalized === "surrendered") {
    return "SURRENDERED";
  }
  if (normalized.startsWith("revoked")) {
    return "REVOKED";
  }
  if (normalized === "expired") {
    return "EXPIRED";
  }
  if (normalized === "lapsed") {
    return "LAPSED";
  }
  if (normalized === "forfeited") {
    return "FORFEITED";
  }
  if (normalized === "pending") {
    return "PENDING";
  }
  return "UNKNOWN";
}

/**
 * Simple, robust zero-dependency CSV parser handling quoted values.
 */
export function parseCsvRows(csvText: string): Record<string, string>[] {
  if (!csvText || !csvText.trim()) {
    return [];
  }

  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    return [];
  }

  const parseLine = (line: string): string[] => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === "," && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  };

  const normalizeHeader = (h: string) =>
    h.toLowerCase().replace(/[^a-z0-9]/g, "");

  const headers = parseLine(lines[0]).map(normalizeHeader);
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseLine(lines[i]);
    if (values.length === 0 || (values.length === 1 && values[0] === "")) {
      continue;
    }
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] !== undefined ? values[idx] : "";
    });
    rows.push(row);
  }

  return rows;
}

/**
 * Parses official Domain Names dataset CSV:
 * Headers: Account Number,Domain Name,Status
 */
export function parseDomainDataset(csvText: string): UkgcDomainRow[] {
  const rows = parseCsvRows(csvText);
  return rows
    .map((r) => ({
      accountNumber: r["accountnumber"] || r["accountno"] || r["account"] || "",
      domainName: r["domainname"] || r["domain"] || r["website"] || "",
      status: r["status"] || r["domainstatus"] || "",
    }))
    .filter((d) => d.domainName.length > 0);
}

/**
 * Parses official Businesses dataset CSV:
 * Headers: Account Number,Licence Account Name
 */
export function parseBusinessDataset(csvText: string): UkgcBusinessRow[] {
  const rows = parseCsvRows(csvText);
  return rows
    .map((r) => ({
      accountNumber: r["accountnumber"] || r["accountno"] || r["account"] || "",
      accountName: r["licenceaccountname"] || r["accountname"] || r["businessname"] || "",
    }))
    .filter((b) => b.accountNumber.length > 0);
}

/**
 * Parses official Licences dataset CSV:
 * Headers: Account Number,Licence Number,Status,Type,Activity,Start Date,End Date
 */
export function parseLicenceDataset(csvText: string): UkgcLicenceRow[] {
  const rows = parseCsvRows(csvText);
  return rows
    .map((r) => ({
      accountNumber: r["accountnumber"] || r["accountno"] || r["account"] || "",
      licenceNumber: r["licencenumber"] || r["licencereference"] || r["licenseno"] || r["licenceno"] || "",
      status: r["status"] || r["licencestatus"] || "",
      type: r["type"] || r["licencetype"] || "",
      activity: r["activity"] || r["licenceactivity"] || "",
      startDate: r["startdate"] || r["grantdate"] || r["effectivedate"] || "",
      endDate: r["enddate"] || "",
    }))
    .filter((l) => l.licenceNumber.length > 0);
}

/**
 * Standard repository hash function for evidence claims.
 * Matches `normalizer-v1:${field}:${hashString(val)}`.
 */
export function hashString(val: string): string {
  return crypto.createHash("sha256").update(val.trim().toLowerCase()).digest("hex").slice(0, 16);
}

/**
 * Strict predicate for applicable Remote Casino licence row.
 * Evaluates both Type == Remote and Activity == Casino.
 * Case-insensitive, trimmed comparison.
 */
export function isApplicableRemoteCasinoActivity(type: string, activity: string): boolean {
  const normType = (type || "").trim().toLowerCase();
  const normActivity = (activity || "").trim().toLowerCase();
  return normType === "remote" && normActivity === "casino";
}

/**
 * Resolves full authoritative UKGC license evidence for a target domain using the 3 authoritative UKGC datasets:
 * 1. domain -> active domain row -> account number
 * 2. account number -> business entity name
 * 3. account number -> active applicable Remote Casino operating licence
 */
export function resolveAuthoritativeUkgcLicence(
  queriedDomain: string,
  datasets: UkgcDatasets,
  diagnosticAccountOverride?: string,
): UkgcResolutionResult {
  const normalizedTargetDomain = normalizeUkgcHost(queriedDomain);
  if (!normalizedTargetDomain || !normalizedTargetDomain.includes(".")) {
    return { success: false, reason: "INVALID_DOMAIN", details: { queriedDomain } };
  }

  // 1. Resolve from Domain Names dataset
  const domainRows = parseDomainDataset(datasets.domainsCsv);
  const matchingDomains = domainRows.filter(
    (d) => normalizeUkgcHost(d.domainName) === normalizedTargetDomain,
  );

  if (matchingDomains.length === 0) {
    return { success: false, reason: "DOMAIN_NOT_FOUND", details: { normalizedTargetDomain } };
  }

  // Check domain status
  const activeMatchingDomains = matchingDomains.filter(
    (d) => d.status.trim().toLowerCase() === "active",
  );

  if (activeMatchingDomains.length === 0) {
    const statuses = matchingDomains.map((d) => d.status.trim());
    if (statuses.some((s) => s.toLowerCase() === "inactive")) {
      return { success: false, reason: "DOMAIN_INACTIVE", details: { domain: normalizedTargetDomain } };
    }
    if (statuses.some((s) => s.toLowerCase() === "white label")) {
      return { success: false, reason: "DOMAIN_WHITE_LABEL", details: { domain: normalizedTargetDomain } };
    }
    return {
      success: false,
      reason: `DOMAIN_STATUS_${statuses[0]?.toUpperCase().replace(/\s+/g, "_") || "NON_ACTIVE"}`,
      details: { domain: normalizedTargetDomain, rawStatus: statuses[0] },
    };
  }

  // Check for ambiguous multiple accounts
  const distinctAccountNumbers = Array.from(
    new Set(activeMatchingDomains.map((d) => d.accountNumber.trim())),
  );

  let targetAccountNumber = distinctAccountNumbers[0];
  if (distinctAccountNumbers.length > 1) {
    if (diagnosticAccountOverride && distinctAccountNumbers.includes(diagnosticAccountOverride.trim())) {
      targetAccountNumber = diagnosticAccountOverride.trim();
    } else {
      return {
        success: false,
        reason: "AMBIGUOUS_DOMAIN_ACCOUNT",
        details: { domain: normalizedTargetDomain, distinctAccountNumbers },
      };
    }
  }

  if (diagnosticAccountOverride && diagnosticAccountOverride.trim() !== targetAccountNumber) {
    return {
      success: false,
      reason: "DIAGNOSTIC_ACCOUNT_MISMATCH",
      details: { discoveredAccount: targetAccountNumber, overrideAccount: diagnosticAccountOverride },
    };
  }

  const selectedDomainRow = activeMatchingDomains.find(
    (d) => d.accountNumber.trim() === targetAccountNumber,
  )!;

  // 2. Resolve Business Identity (Legal Entity Name only; no status gating from businesses CSV)
  const businessRows = parseBusinessDataset(datasets.businessesCsv);
  const matchingBusiness = businessRows.find(
    (b) => b.accountNumber.trim() === targetAccountNumber,
  );

  const accountName = matchingBusiness?.accountName || `UKGC Account ${targetAccountNumber}`;

  // 3. Resolve Applicable Remote Casino Licences
  const licenceRows = parseLicenceDataset(datasets.licencesCsv);
  const accountLicences = licenceRows.filter(
    (l) => l.accountNumber.trim() === targetAccountNumber,
  );

  if (accountLicences.length === 0) {
    return {
      success: false,
      reason: "NO_LICENCES_FOUND_FOR_ACCOUNT",
      details: { accountNumber: targetAccountNumber },
    };
  }

  const remoteCasinoLicences = accountLicences.filter((l) =>
    isApplicableRemoteCasinoActivity(l.type, l.activity),
  );

  if (remoteCasinoLicences.length === 0) {
    return {
      success: false,
      reason: "NO_REMOTE_CASINO_LICENCE",
      details: {
        accountNumber: targetAccountNumber,
        availableRows: accountLicences.map((l) => ({ type: l.type, activity: l.activity })),
      },
    };
  }

  // Check strict active status for Remote Casino licences
  const activeCasinoLicences = remoteCasinoLicences.filter(
    (l) => mapUkgcStrictStatus(l.status) === "ACTIVE",
  );

  if (activeCasinoLicences.length === 0) {
    const rawStatuses = remoteCasinoLicences.map((l) => l.status.trim());
    return {
      success: false,
      reason: `LICENCE_STATUS_${mapUkgcStrictStatus(rawStatuses[0])}`,
      details: { accountNumber: targetAccountNumber, rawStatus: rawStatuses[0] },
    };
  }

  // Check for ambiguous multiple active Remote Casino licences with distinct licence numbers
  const distinctLicenceNumbers = Array.from(
    new Set(activeCasinoLicences.map((l) => l.licenceNumber.trim())),
  );

  if (distinctLicenceNumbers.length > 1) {
    return {
      success: false,
      reason: "AMBIGUOUS_APPLICABLE_LICENCE",
      details: { accountNumber: targetAccountNumber, distinctLicenceNumbers },
    };
  }

  const selectedLicence = activeCasinoLicences[0];

  const domainEvidenceHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(selectedDomainRow))
    .digest("hex");
  const businessEvidenceHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(matchingBusiness || { accountNumber: targetAccountNumber, accountName }))
    .digest("hex");
  const licenceEvidenceHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(selectedLicence))
    .digest("hex");

  return {
    success: true,
    data: {
      accountNumber: targetAccountNumber,
      accountName,
      domainName: normalizedTargetDomain,
      domainStatus: "ACTIVE",
      licenceNumber: selectedLicence.licenceNumber.trim(),
      licenceType: selectedLicence.type.trim(),
      licenceActivity: selectedLicence.activity.trim(),
      licenceStatus: "ACTIVE",
      startDate: selectedLicence.startDate?.trim() || undefined,
      endDate: selectedLicence.endDate?.trim() || undefined,
      domainEvidenceHash,
      businessEvidenceHash,
      licenceEvidenceHash,
    },
  };
}
