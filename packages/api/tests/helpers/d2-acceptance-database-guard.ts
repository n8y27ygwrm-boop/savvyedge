export interface D2DatabaseValidationResult {
  safe: boolean;
  reason?: string;
  databaseName?: string;
  hostname?: string;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

const TARGET_OVERRIDE_PARAMETERS = new Set([
  "database",
  "dbname",
  "host",
  "hostaddr",
  "password",
  "port",
  "service",
  "servicefile",
  "socket",
  "user",
  "username",
]);

const UNSAFE_EXACT_DATABASE_NAMES = new Set([
  "savvy",
  "savvyedge",
  "postgres",
  "production",
  "prod",
  "staging",
]);

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function isD2AcceptanceEnabled(): boolean {
  return process.env.SAVVYEDGE_D2_ACCEPTANCE === "1";
}

/**
 * Validates that a PostgreSQL connection string targets strictly an isolated, local test/pilot database.
 * Rejects cloud hosts, production names, and missing/malformed targets.
 */
export function validateD2DatabaseUrl(rawUrl?: string): D2DatabaseValidationResult {
  if (!rawUrl || typeof rawUrl !== "string" || rawUrl.trim() === "") {
    return {
      safe: false,
      reason: "DATABASE_URL is missing or empty",
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return {
      safe: false,
      reason: "DATABASE_URL is not a valid URL format",
    };
  }

  if (!new Set(["postgres:", "postgresql:"]).has(parsed.protocol)) {
    return {
      safe: false,
      reason: `Unsupported database protocol '${parsed.protocol}'. Must be postgres: or postgresql:`,
    };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!LOOPBACK_HOSTS.has(hostname) || parsed.hash) {
    return {
      safe: false,
      reason: `Unsafe database host '${hostname}'. Host must be strictly loopback (localhost, 127.0.0.1, or ::1)`,
      hostname,
    };
  }

  const rawDbName = parsed.pathname.slice(1);
  const databaseName = safeDecode(rawDbName);

  if (!databaseName || databaseName.includes("/")) {
    return {
      safe: false,
      reason: "DATABASE_URL must specify a valid database name",
    };
  }

  const normalizedDb = databaseName.toLowerCase();

  if (UNSAFE_EXACT_DATABASE_NAMES.has(normalizedDb)) {
    return {
      safe: false,
      reason: `Unsafe database name '${databaseName}'. Production, default, and root database names are strictly forbidden`,
      databaseName,
      hostname,
    };
  }

  // Reject prod / production / staging when they appear as delimited database-name tokens anywhere in the name
  if (/(^|[_-])(prod|production|staging)([_-]|$)/i.test(normalizedDb)) {
    return {
      safe: false,
      reason: `Unsafe database name '${databaseName}'. Contains forbidden production/staging environment token`,
      databaseName,
      hostname,
    };
  }

  // Must match explicit isolated test/pilot/d2 pattern
  const isIsolatedNamed = /(^|[_-])(d2|test|pilot)([_-]|$)/i.test(normalizedDb);
  if (!isIsolatedNamed) {
    return {
      safe: false,
      reason: `Database name '${databaseName}' does not contain recognized isolated suffix/tag ('d2', 'test', or 'pilot')`,
      databaseName,
      hostname,
    };
  }

  // Check search params for prohibited target overrides
  for (const [rawParam] of parsed.searchParams.entries()) {
    const paramLower = rawParam.toLowerCase();
    if (TARGET_OVERRIDE_PARAMETERS.has(paramLower)) {
      return {
        safe: false,
        reason: `Target override parameter '${rawParam}' is not permitted in DATABASE_URL`,
        databaseName,
        hostname,
      };
    }
  }

  return {
    safe: true,
    databaseName,
    hostname,
  };
}
