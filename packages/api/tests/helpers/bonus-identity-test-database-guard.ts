export interface BonusIdentityTestDatabaseUrls {
  DATABASE_URL?: string;
  DIRECT_URL?: string;
  PHASE2_WORKFLOW_TEST_DATABASE_URL?: string;
}

interface EffectivePostgresTarget {
  protocol: string;
  hostname: string;
  port: string;
  databaseName: string;
  username: string;
  passwordPresent: boolean;
  password: string;
  parameters: Array<[string, string]>;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
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
const SUPPORTED_CONNECTION_PARAMETERS = new Set([
  "application_name",
  "channel_binding",
  "connect_timeout",
  "connection_limit",
  "options",
  "pgbouncer",
  "pool_timeout",
  "schema",
  "search_path",
  "socket_timeout",
  "sslaccept",
  "sslcert",
  "sslidentity",
  "sslmode",
  "sslpassword",
  "statement_cache_size",
]);

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function hasExplicitPassword(rawUrl: string): boolean | null {
  const authorityMatch = rawUrl.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i);
  if (!authorityMatch) return null;
  const authority = authorityMatch[1];
  const atIndex = authority.lastIndexOf("@");
  if (atIndex < 0) return false;
  return authority.slice(0, atIndex).includes(":");
}

function parseEffectiveTarget(rawUrl: string): EffectivePostgresTarget | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  if (!new Set(["postgres:", "postgresql:"]).has(parsed.protocol)) {
    return null;
  }
  const hostname = parsed.hostname.toLowerCase();
  if (!LOOPBACK_HOSTS.has(hostname) || parsed.hash) return null;

  const username = safeDecode(parsed.username);
  const password = safeDecode(parsed.password);
  const passwordPresent = hasExplicitPassword(rawUrl);
  const databaseName = safeDecode(parsed.pathname.slice(1));
  if (
    username === null ||
    password === null ||
    passwordPresent === null ||
    databaseName === null ||
    !username ||
    !databaseName ||
    databaseName.includes("/") ||
    !/(^|[_-])test([_-]|$)/.test(databaseName.toLowerCase())
  ) {
    return null;
  }

  const parameters: Array<[string, string]> = [];
  const seenParameterNames = new Set<string>();
  for (const [rawName, value] of parsed.searchParams.entries()) {
    const normalizedName = rawName.toLowerCase();
    if (
      !rawName ||
      seenParameterNames.has(normalizedName) ||
      TARGET_OVERRIDE_PARAMETERS.has(normalizedName) ||
      !SUPPORTED_CONNECTION_PARAMETERS.has(normalizedName)
    ) {
      return null;
    }
    seenParameterNames.add(normalizedName);
    parameters.push([rawName, value]);
  }
  parameters.sort(([leftName], [rightName]) =>
    leftName.localeCompare(rightName),
  );

  return {
    protocol: parsed.protocol,
    hostname,
    port: parsed.port || "5432",
    databaseName,
    username,
    passwordPresent,
    password,
    parameters,
  };
}

function targetsMatch(
  left: EffectivePostgresTarget,
  right: EffectivePostgresTarget,
): boolean {
  return (
    left.protocol === right.protocol &&
    left.hostname === right.hostname &&
    left.port === right.port &&
    left.databaseName === right.databaseName &&
    left.username === right.username &&
    left.passwordPresent === right.passwordPresent &&
    left.password === right.password &&
    JSON.stringify(left.parameters) === JSON.stringify(right.parameters)
  );
}

export function isApprovedBonusIdentityTestDatabase(
  urls: BonusIdentityTestDatabaseUrls,
): boolean {
  if (
    !urls.DATABASE_URL ||
    !urls.DIRECT_URL ||
    !urls.PHASE2_WORKFLOW_TEST_DATABASE_URL
  ) {
    return false;
  }

  const databaseTarget = parseEffectiveTarget(urls.DATABASE_URL);
  const directTarget = parseEffectiveTarget(urls.DIRECT_URL);
  const assertedTarget = parseEffectiveTarget(
    urls.PHASE2_WORKFLOW_TEST_DATABASE_URL,
  );
  return Boolean(
    databaseTarget &&
      directTarget &&
      assertedTarget &&
      targetsMatch(databaseTarget, directTarget) &&
      targetsMatch(databaseTarget, assertedTarget),
  );
}
