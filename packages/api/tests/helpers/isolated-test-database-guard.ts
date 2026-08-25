/**
 * Centralized safety boundary for destructive real-database integration suites.
 *
 * Destructive suites (broad `deleteMany()`, `TRUNCATE ... CASCADE`, bootstrap
 * overwrites) may only run once the active Prisma target is *proven* to be an
 * isolated, loopback-only test database. `DATABASE_URL` alone is never
 * permission to run: the process that runs the suites may already point at a
 * hosted production database.
 *
 * Contract:
 *   - `PHASE2_WORKFLOW_TEST_DATABASE_URL` is the explicit opt-in. Without it the
 *     suite is disabled and must skip without issuing a single query.
 *   - With the opt-in present, `DATABASE_URL` and `DIRECT_URL` are the variables
 *     the runtime actually connects through, so all three must resolve to the
 *     same effective PostgreSQL target. Anything else is a hard failure, never a
 *     silent skip.
 *
 * Effective-target comparison contract (deliberately strict — two URLs are
 * equivalent only when a PostgreSQL client cannot distinguish them):
 *   - An omitted port is normalized to `5432`, so `localhost` ≡ `localhost:5432`.
 *   - Query parameter order is normalized, so `?a=1&b=2` ≡ `?b=2&a=1`.
 *   - Hostnames are lowercased but *not* aliased: `localhost`, `127.0.0.1`, and
 *     `[::1]` are three distinct targets even though all three are loopback.
 *   - Parameter names are compared verbatim, so `?schema=` and `?SCHEMA=` are a
 *     mismatch (PostgreSQL/Prisma option handling is case-sensitive).
 *   - An explicit empty password (`user:@host`) differs from an absent password
 *     (`user@host`).
 *
 * This module must never import Prisma or open a connection: it exists to be
 * evaluated *before* anything touches a database.
 */

export const ISOLATED_TEST_DATABASE_OPT_IN_VARIABLE =
  "PHASE2_WORKFLOW_TEST_DATABASE_URL";

export const ISOLATED_TEST_DATABASE_REQUIRED_VARIABLES = [
  "PHASE2_WORKFLOW_TEST_DATABASE_URL",
  "DATABASE_URL",
  "DIRECT_URL",
] as const;

export interface IsolatedTestDatabaseUrls {
  DATABASE_URL?: string;
  DIRECT_URL?: string;
  PHASE2_WORKFLOW_TEST_DATABASE_URL?: string;
}

export type IsolatedTestDatabaseDecision =
  | { status: "enabled"; hostname: string; databaseName: string }
  | { status: "disabled"; reason: string }
  | { status: "unsafe"; reason: string };

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

type EffectiveTargetResult =
  | { ok: true; target: EffectivePostgresTarget }
  | { ok: false; reason: string };

/** `new URL()` renders an IPv6 host in its bracketed form, hence `[::1]`. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const POSTGRES_PROTOCOLS = new Set(["postgres:", "postgresql:"]);

/** Parameters that can redirect a connection away from the URL's own target. */
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

/** A bounded `test` token, so `savvyedge_test` passes and `latest` does not. */
const BOUNDED_TEST_MARKER = /(^|[_-])test([_-]|$)/;

/** Environment tokens that disqualify a name even alongside a `test` marker. */
const FORBIDDEN_ENVIRONMENT_MARKER = /(^|[_-])(prod|production|staging)([_-]|$)/;

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function normalizeRawUrl(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function hasExplicitPassword(rawUrl: string): boolean | null {
  const authorityMatch = rawUrl.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i);
  if (!authorityMatch) return null;
  const authority = authorityMatch[1];
  const atIndex = authority.lastIndexOf("@");
  if (atIndex < 0) return false;
  return authority.slice(0, atIndex).includes(":");
}

function parseEffectiveTarget(rawUrl: string): EffectiveTargetResult {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "value is not a parseable URL" };
  }

  if (!POSTGRES_PROTOCOLS.has(parsed.protocol)) {
    return {
      ok: false,
      reason: `protocol '${parsed.protocol}' is not postgres: or postgresql:`,
    };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!LOOPBACK_HOSTS.has(hostname)) {
    return {
      ok: false,
      reason: `host '${hostname}' is not loopback (localhost, 127.0.0.1, or ::1)`,
    };
  }
  if (parsed.hash) {
    return { ok: false, reason: "URL carries an ambiguous fragment" };
  }

  const username = safeDecode(parsed.username);
  const password = safeDecode(parsed.password);
  const passwordPresent = hasExplicitPassword(rawUrl);
  const databaseName = safeDecode(parsed.pathname.slice(1));

  if (
    username === null ||
    password === null ||
    passwordPresent === null ||
    databaseName === null
  ) {
    return { ok: false, reason: "URL contains malformed percent-encoding" };
  }
  if (!username) {
    return { ok: false, reason: "URL does not name a database user" };
  }
  if (!databaseName || databaseName.includes("/")) {
    return { ok: false, reason: "URL does not name exactly one database" };
  }

  const normalizedDatabaseName = databaseName.toLowerCase();
  if (FORBIDDEN_ENVIRONMENT_MARKER.test(normalizedDatabaseName)) {
    return {
      ok: false,
      reason: `database '${databaseName}' carries a production/staging token`,
    };
  }
  if (!BOUNDED_TEST_MARKER.test(normalizedDatabaseName)) {
    return {
      ok: false,
      reason: `database '${databaseName}' does not contain a bounded 'test' marker`,
    };
  }

  const parameters: Array<[string, string]> = [];
  const seenParameterNames = new Set<string>();
  for (const [rawName, value] of parsed.searchParams.entries()) {
    const normalizedName = rawName.toLowerCase();
    if (!rawName) {
      return { ok: false, reason: "URL carries an unnamed query parameter" };
    }
    if (seenParameterNames.has(normalizedName)) {
      return {
        ok: false,
        reason: `query parameter '${rawName}' is ambiguously repeated`,
      };
    }
    if (TARGET_OVERRIDE_PARAMETERS.has(normalizedName)) {
      return {
        ok: false,
        reason: `query parameter '${rawName}' can override the connection target`,
      };
    }
    if (!SUPPORTED_CONNECTION_PARAMETERS.has(normalizedName)) {
      return {
        ok: false,
        reason: `query parameter '${rawName}' is not a recognized connection option`,
      };
    }
    seenParameterNames.add(normalizedName);
    parameters.push([rawName, value]);
  }
  parameters.sort(([leftName], [rightName]) =>
    leftName.localeCompare(rightName),
  );

  return {
    ok: true,
    target: {
      protocol: parsed.protocol,
      hostname,
      port: parsed.port || "5432",
      databaseName,
      username,
      passwordPresent,
      password,
      parameters,
    },
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

/**
 * Decides whether destructive real-database work is permitted, without
 * connecting to anything.
 */
export function evaluateIsolatedTestDatabase(
  urls: IsolatedTestDatabaseUrls,
): IsolatedTestDatabaseDecision {
  const assertedUrl = normalizeRawUrl(urls.PHASE2_WORKFLOW_TEST_DATABASE_URL);
  if (!assertedUrl) {
    return {
      status: "disabled",
      reason: `${ISOLATED_TEST_DATABASE_OPT_IN_VARIABLE} is not set, so destructive real-database suites stay skipped`,
    };
  }

  const databaseUrl = normalizeRawUrl(urls.DATABASE_URL);
  const directUrl = normalizeRawUrl(urls.DIRECT_URL);
  const missing = [
    ["DATABASE_URL", databaseUrl],
    ["DIRECT_URL", directUrl],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) {
    return {
      status: "unsafe",
      reason: `${ISOLATED_TEST_DATABASE_OPT_IN_VARIABLE} is set but ${missing.join(
        " and ",
      )} ${missing.length === 1 ? "is" : "are"} missing, so the active Prisma target cannot be proven`,
    };
  }

  const parsedTargets: Array<[string, EffectivePostgresTarget]> = [];
  for (const [name, rawUrl] of [
    [ISOLATED_TEST_DATABASE_OPT_IN_VARIABLE, assertedUrl],
    ["DATABASE_URL", databaseUrl],
    ["DIRECT_URL", directUrl],
  ] as const) {
    const result = parseEffectiveTarget(rawUrl);
    if (!result.ok) {
      return {
        status: "unsafe",
        reason: `${name} is not an isolated local test database: ${result.reason}`,
      };
    }
    parsedTargets.push([name, result.target]);
  }

  const [[, assertedTarget], ...dependentTargets] = parsedTargets;
  for (const [name, target] of dependentTargets) {
    if (!targetsMatch(assertedTarget, target)) {
      return {
        status: "unsafe",
        reason: `${name} resolves to a different effective database target than ${ISOLATED_TEST_DATABASE_OPT_IN_VARIABLE}`,
      };
    }
  }

  return {
    status: "enabled",
    hostname: assertedTarget.hostname,
    databaseName: assertedTarget.databaseName,
  };
}

/**
 * Boolean form of {@link evaluateIsolatedTestDatabase}: true only when every
 * required URL proves the same isolated loopback test target.
 */
export function isApprovedIsolatedTestDatabase(
  urls: IsolatedTestDatabaseUrls,
): boolean {
  return evaluateIsolatedTestDatabase(urls).status === "enabled";
}

export class UnsafeTestDatabaseError extends Error {
  constructor(reason: string) {
    super(
      `Refusing to run destructive real-database integration tests: ${reason}.`,
    );
    this.name = "UnsafeTestDatabaseError";
  }
}

/**
 * Guard entry point for destructive suites. Returns `true` when the suite may
 * run, `false` when the explicit opt-in is absent (skip silently, zero
 * queries), and throws when the opt-in is present but the configuration is
 * malformed, hosted, or mismatched.
 */
export function requireIsolatedTestDatabase(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const decision = evaluateIsolatedTestDatabase({
    DATABASE_URL: env.DATABASE_URL,
    DIRECT_URL: env.DIRECT_URL,
    PHASE2_WORKFLOW_TEST_DATABASE_URL: env.PHASE2_WORKFLOW_TEST_DATABASE_URL,
  });
  if (decision.status === "unsafe") {
    throw new UnsafeTestDatabaseError(decision.reason);
  }
  return decision.status === "enabled";
}
