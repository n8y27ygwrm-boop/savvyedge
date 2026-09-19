/**
 * Server-enforced read-only proof for the production bonus coverage verifier.
 *
 * This module is a security boundary, not a convenience check. The coverage
 * verifier must never treat "the current code contains no writes" as its
 * safety property: a later edit, an injected dependency or a mistaken call
 * would silently break it. Instead the verifier refuses to scan unless the
 * connected session can *prove*, using SELECT/SHOW-only catalogue queries,
 * that the database itself would reject a write.
 *
 * Every statement here is a fixed module-level constant. No value is ever
 * interpolated into SQL, no write is ever attempted, and no probe result is
 * trusted unless it has the exact expected shape. Refusal reasons carry only
 * the error's class name: a Prisma error message embeds the host and port it
 * failed to reach, and this guard runs only against production targets. Any failure — mismatch, null,
 * unexpected shape, or a thrown error — is a refusal. An exception is never
 * evidence of read-only.
 *
 * Deliberately free of Prisma and database imports so it can be unit-tested
 * against a plain object and cannot open a connection of its own.
 */

import {
  APPROVED_PRODUCTION_COVERAGE_TARGET,
  type ProductionCoverageApprovedTarget,
} from "../constants/production-coverage-approved-target";

/** The minimum client surface the proof needs: one raw read method. */
export interface ReadOnlyProbeClient {
  $queryRawUnsafe<T = unknown>(query: string): Promise<T>;
}

export type ReadOnlyProofCheck =
  | "SESSION_READ_ONLY"
  | "CURRENT_ROLE"
  | "TABLE_WRITE_PRIVILEGE"
  | "ROLE_ATTRIBUTES"
  | "SCHEMA_CREATE_PRIVILEGE"
  | "TARGET_DATABASE";

export interface ReadOnlyProofDetails {
  /** Effective role the scan will run as. */
  role: string;
  /** Login role, compared to detect a SET ROLE narrowing that could be reset. */
  sessionRole: string;
  transactionReadOnly: string;
  writableTableCount: number;
  canCreateInPublic: boolean;
  /**
   * The database the scan will actually read. Reported so a run is attributable
   * to a target; the host, port, user and URL are never surfaced.
   */
  databaseName: string;
}

export type ReadOnlyProof =
  | { proven: true; details: ReadOnlyProofDetails }
  | { proven: false; failedCheck: ReadOnlyProofCheck; reason: string };

/**
 * Opaque capability issued only after the operational resolver binds runtime
 * connection parameters to the source-controlled approved target. Runtime
 * membership in the private WeakMap, not this public shape, establishes trust.
 */
export interface ProductionCoverageAuditAuthorization {
  readonly kind: "PRODUCTION_COVERAGE_AUDIT_AUTHORIZATION";
}

const authorizedProductionTargets = new WeakMap<
  object,
  ProductionCoverageApprovedTarget
>();

/* -------------------------------------------------------------------------
 * Fixed probe statements. SELECT-only, no interpolation, no side effects.
 * ---------------------------------------------------------------------- */

/** Equivalent to `SHOW transaction_read_only`, in a shape Prisma maps cleanly. */
export const SESSION_READ_ONLY_SQL =
  "SELECT current_setting('transaction_read_only') AS transaction_read_only";

export const CURRENT_ROLE_SQL =
  "SELECT current_user::text AS current_role, session_user::text AS session_role";

/**
 * Counts base and partitioned tables in `public` on which the current role
 * holds any write privilege. `has_table_privilege` accounts for ownership and
 * for privileges inherited through role membership, so table ownership needs no
 * separate probe: an owner reports true here.
 */
export const WRITABLE_TABLES_SQL = `
SELECT count(*)::int AS writable_tables
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p')
  AND (
    pg_catalog.has_table_privilege(c.oid, 'INSERT')
    OR pg_catalog.has_table_privilege(c.oid, 'UPDATE')
    OR pg_catalog.has_table_privilege(c.oid, 'DELETE')
    OR pg_catalog.has_table_privilege(c.oid, 'TRUNCATE')
  )`.trim();

/**
 * Any role reachable from the current role by membership. A superuser bypasses
 * every privilege check and can clear read-only, so an inherited superuser path
 * defeats the other probes entirely.
 */
export const ROLE_ATTRIBUTES_SQL = `
SELECT
  COALESCE(bool_or(r.rolsuper), false) AS has_superuser,
  COALESCE(bool_or(r.rolbypassrls), false) AS has_bypassrls,
  COALESCE(
    bool_or(r.rolcreatedb OR r.rolcreaterole OR r.rolreplication),
    false
  ) AS has_escalation
FROM pg_catalog.pg_roles r
WHERE pg_catalog.pg_has_role(current_user, r.oid, 'USAGE')`.trim();

/** CREATE on `public` would let the role make a table it then owns and writes. */
export const SCHEMA_CREATE_SQL =
  "SELECT pg_catalog.has_schema_privilege('public', 'CREATE') AS can_create";

/**
 * Names the audited database so a run is attributable. Deliberately returns the
 * database name alone: host, port and user stay out of the report entirely.
 */
export const CURRENT_DATABASE_SQL =
  "SELECT current_database()::text AS database_name";

/* ---------------------------------------------------------------------- */

function refuse(
  failedCheck: ReadOnlyProofCheck,
  reason: string,
): ReadOnlyProof {
  return { proven: false, failedCheck, reason };
}

/** Exactly one row, an object, or the probe is unusable. */
function singleRow(rows: unknown): Record<string, unknown> | null {
  if (!Array.isArray(rows) || rows.length !== 1) return null;
  const row = rows[0];
  return typeof row === "object" && row !== null
    ? (row as Record<string, unknown>)
    : null;
}

async function probe(
  client: ReadOnlyProbeClient,
  sql: string,
): Promise<Record<string, unknown> | null> {
  // A thrown probe is a refusal, never a pass.
  const rows = await client.$queryRawUnsafe(sql);
  return singleRow(rows);
}

/**
 * Proves the connection is read-only at the server, not merely in this code.
 *
 * Refuses on the first failed check. The caller must abandon the run and
 * disconnect; there is no partial-pass outcome.
 */
export async function proveReadOnlyConnection(
  client: ReadOnlyProbeClient,
  approvedIdentity: Pick<ProductionCoverageApprovedTarget, "database" | "role">,
): Promise<ReadOnlyProof> {
  const expectedRole = approvedIdentity?.role;
  const expectedDatabase = approvedIdentity?.database;
  if (typeof expectedRole !== "string" || expectedRole.trim() === "") {
    return refuse("CURRENT_ROLE", "No expected auditor role was configured");
  }
  if (typeof expectedDatabase !== "string" || expectedDatabase.trim() === "") {
    return refuse(
      "TARGET_DATABASE",
      "No expected audit database was configured",
    );
  }

  // 1. Session read-only.
  let transactionReadOnly: string;
  try {
    const row = await probe(client, SESSION_READ_ONLY_SQL);
    const value = row?.transaction_read_only;
    if (typeof value !== "string") {
      return refuse(
        "SESSION_READ_ONLY",
        "transaction_read_only probe returned an unexpected shape",
      );
    }
    if (value !== "on") {
      return refuse(
        "SESSION_READ_ONLY",
        `transaction_read_only is '${value}', expected 'on'`,
      );
    }
    transactionReadOnly = value;
  } catch (error) {
    return refuse(
      "SESSION_READ_ONLY",
      `transaction_read_only probe failed: ${safeErrorCategory(error)}`,
    );
  }

  // 2. Identity.
  let role: string;
  let sessionRole: string;
  try {
    const row = await probe(client, CURRENT_ROLE_SQL);
    const current = row?.current_role;
    const session = row?.session_role;
    if (typeof current !== "string" || typeof session !== "string") {
      return refuse(
        "CURRENT_ROLE",
        "role identity probe returned an unexpected shape",
      );
    }
    if (current !== expectedRole) {
      return refuse(
        "CURRENT_ROLE",
        "effective role does not match the approved auditor role",
      );
    }
    if (session !== expectedRole) {
      // A SET ROLE narrowing can be reset with RESET ROLE, so the login role
      // must be the auditor too.
      return refuse(
        "CURRENT_ROLE",
        "login role does not match the approved auditor role",
      );
    }
    role = current;
    sessionRole = session;
  } catch (error) {
    return refuse(
      "CURRENT_ROLE",
      `role identity probe failed: ${safeErrorCategory(error)}`,
    );
  }

  // 3. No write privilege on any base table in public.
  let writableTableCount: number;
  try {
    const row = await probe(client, WRITABLE_TABLES_SQL);
    const value = row?.writable_tables;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
      return refuse(
        "TABLE_WRITE_PRIVILEGE",
        "table privilege probe returned an unexpected shape",
      );
    }
    if (value !== 0) {
      return refuse(
        "TABLE_WRITE_PRIVILEGE",
        `role holds INSERT/UPDATE/DELETE/TRUNCATE on ${value} table(s) in public`,
      );
    }
    writableTableCount = value;
  } catch (error) {
    return refuse(
      "TABLE_WRITE_PRIVILEGE",
      `table privilege probe failed: ${safeErrorCategory(error)}`,
    );
  }

  // 4. No superuser / bypass / escalation path.
  try {
    const row = await probe(client, ROLE_ATTRIBUTES_SQL);
    const superuser = row?.has_superuser;
    const bypassRls = row?.has_bypassrls;
    const escalation = row?.has_escalation;
    if (
      typeof superuser !== "boolean" ||
      typeof bypassRls !== "boolean" ||
      typeof escalation !== "boolean"
    ) {
      return refuse(
        "ROLE_ATTRIBUTES",
        "role attribute probe returned an unexpected shape",
      );
    }
    if (superuser) {
      return refuse(
        "ROLE_ATTRIBUTES",
        "role has a superuser path, which bypasses every read-only control",
      );
    }
    if (bypassRls) {
      return refuse("ROLE_ATTRIBUTES", "role can bypass row-level security");
    }
    if (escalation) {
      return refuse(
        "ROLE_ATTRIBUTES",
        "role holds CREATEDB, CREATEROLE or REPLICATION",
      );
    }
  } catch (error) {
    return refuse(
      "ROLE_ATTRIBUTES",
      `role attribute probe failed: ${safeErrorCategory(error)}`,
    );
  }

  // 5. No CREATE on public.
  let canCreateInPublic: boolean;
  try {
    const row = await probe(client, SCHEMA_CREATE_SQL);
    const value = row?.can_create;
    if (typeof value !== "boolean") {
      return refuse(
        "SCHEMA_CREATE_PRIVILEGE",
        "schema privilege probe returned an unexpected shape",
      );
    }
    if (value) {
      return refuse(
        "SCHEMA_CREATE_PRIVILEGE",
        "role holds CREATE on schema public and could create a writable table",
      );
    }
    canCreateInPublic = value;
  } catch (error) {
    return refuse(
      "SCHEMA_CREATE_PRIVILEGE",
      `schema privilege probe failed: ${safeErrorCategory(error)}`,
    );
  }

  // 6. Target identity, so the run is attributable to a database.
  let databaseName: string;
  try {
    const row = await probe(client, CURRENT_DATABASE_SQL);
    const value = row?.database_name;
    if (typeof value !== "string" || value === "") {
      return refuse(
        "TARGET_DATABASE",
        "current_database probe returned an unexpected shape",
      );
    }
    if (value !== expectedDatabase) {
      return refuse(
        "TARGET_DATABASE",
        "connected database does not match the approved audit target",
      );
    }
    databaseName = value;
  } catch (error) {
    return refuse(
      "TARGET_DATABASE",
      `current_database probe failed: ${safeErrorCategory(error)}`,
    );
  }

  return {
    proven: true,
    details: {
      role,
      sessionRole,
      transactionReadOnly,
      writableTableCount,
      canCreateInPublic,
      databaseName,
    },
  };
}

/**
 * Re-proves a connection against the source-authorized identity represented by
 * an opaque operational capability. A caller-constructed lookalike fails
 * closed and cannot authorize a production report.
 */
export async function proveAuthorizedReadOnlyConnection(
  client: ReadOnlyProbeClient,
  authorization: ProductionCoverageAuditAuthorization,
): Promise<ReadOnlyProof> {
  const approvedTarget =
    typeof authorization === "object" && authorization !== null
      ? authorizedProductionTargets.get(authorization)
      : undefined;
  if (!approvedTarget) {
    return refuse(
      "TARGET_DATABASE",
      "The production coverage audit authorization is invalid",
    );
  }
  return proveReadOnlyConnection(client, approvedTarget);
}

/**
 * A production-safe error category: the error's class name and nothing else.
 *
 * The name is validated against a strict identifier pattern rather than
 * trusted, so a crafted or wrapped error whose `name` carries a URL, a
 * credential or a row identifier cannot smuggle it into output.
 */
export function safeErrorCategory(error: unknown): string {
  if (
    error instanceof Error &&
    typeof error.name === "string" &&
    /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(error.name)
  ) {
    return error.name;
  }
  return "UnknownError";
}

/**
 * The only fatal text production-readonly mode may print.
 *
 * Prisma errors can carry the failing query and its parameters — and this
 * scan's paging parameter is a real bonus id — so no message, `meta`, stack or
 * datasource detail is ever included.
 */
export function productionFatalMessage(error: unknown): string {
  return (
    `Production bonus coverage audit failed (${safeErrorCategory(error)}). ` +
    "Diagnostic details are suppressed in production-readonly mode."
  );
}

/* -------------------------------------------------------------------------
 * Mode resolution
 * ---------------------------------------------------------------------- */

export const ISOLATED_MODE_VARIABLE = "SAVVYEDGE_COVERAGE_AUDIT_DATABASE_URL";
export const PRODUCTION_MODE_URL_VARIABLE =
  "SAVVYEDGE_COVERAGE_AUDIT_PRODUCTION_URL";
export const PRODUCTION_MODE_ROLE_VARIABLE = "SAVVYEDGE_COVERAGE_AUDIT_ROLE";

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
  "pgbouncer",
  "pool_timeout",
  "schema",
  "socket_timeout",
  "sslaccept",
  "sslcert",
  "sslidentity",
  "sslmode",
  "sslpassword",
  "statement_cache_size",
]);

/** An explicit transport downgrade is never valid for an approved target. */
export function explicitlyDisablesPostgresTls(
  name: string,
  value: string,
): boolean {
  return name === "sslmode" && value.trim().toLowerCase() === "disable";
}

export type CoverageAuditConfiguration =
  | { mode: "isolated" }
  | {
      mode: "production-readonly";
      url: string;
      role: string;
      approvedTarget: ProductionCoverageApprovedTarget;
    }
  | { mode: "refused"; reason: string };

export type CoverageAuditMode =
  | { mode: "isolated" }
  | {
      mode: "production-readonly";
      url: string;
      role: string;
      authorization: ProductionCoverageAuditAuthorization;
    }
  | { mode: "refused"; reason: string };

function present(value: string | undefined): boolean {
  return typeof value === "string" && value.trim() !== "";
}

function isValidApprovedTarget(
  target: ProductionCoverageApprovedTarget | null,
): target is ProductionCoverageApprovedTarget {
  if (
    !target ||
    typeof target.role !== "string" ||
    target.role.trim() !== target.role ||
    target.role === "" ||
    typeof target.database !== "string" ||
    target.database.trim() !== target.database ||
    target.database === "" ||
    target.database.includes("/") ||
    !Array.isArray(target.endpoints) ||
    target.endpoints.length === 0
  ) {
    return false;
  }

  return target.endpoints.every(
    (endpoint) =>
      typeof endpoint === "object" &&
      endpoint !== null &&
      typeof endpoint.hostname === "string" &&
      endpoint.hostname.trim().toLowerCase() === endpoint.hostname &&
      endpoint.hostname !== "" &&
      typeof endpoint.routingUsername === "string" &&
      endpoint.routingUsername.trim() === endpoint.routingUsername &&
      endpoint.routingUsername !== "" &&
      Number.isInteger(endpoint.port) &&
      endpoint.port >= 1 &&
      endpoint.port <= 65_535,
  );
}

/**
 * The two modes are disjoint by construction: configuring both, or neither, is
 * a refusal rather than a precedence rule. There is deliberately no default and
 * no fallback from production mode to the isolated path.
 */
export function resolveCoverageAuditConfiguration(
  env: Record<string, string | undefined>,
  approvedTarget: ProductionCoverageApprovedTarget | null,
): CoverageAuditConfiguration {
  const isolated = present(env[ISOLATED_MODE_VARIABLE]);
  const production = present(env[PRODUCTION_MODE_URL_VARIABLE]);

  if (isolated && production) {
    return {
      mode: "refused",
      reason:
        `${ISOLATED_MODE_VARIABLE} and ${PRODUCTION_MODE_URL_VARIABLE} are both set; ` +
        "the isolated and production modes are mutually exclusive",
    };
  }
  if (!isolated && !production) {
    return {
      mode: "refused",
      reason:
        `Neither ${ISOLATED_MODE_VARIABLE} nor ${PRODUCTION_MODE_URL_VARIABLE} is set; ` +
        "the verifier has no configured mode",
    };
  }
  if (isolated) {
    return { mode: "isolated" };
  }

  if (!isValidApprovedTarget(approvedTarget)) {
    return {
      mode: "refused",
      reason: "A valid code-reviewed production coverage target is required",
    };
  }

  const role = env[PRODUCTION_MODE_ROLE_VARIABLE];
  if (!present(role)) {
    return {
      mode: "refused",
      reason:
        `${PRODUCTION_MODE_ROLE_VARIABLE} must confirm the approved read-only auditor role ` +
        `when ${PRODUCTION_MODE_URL_VARIABLE} is set`,
    };
  }
  if ((role as string).trim() !== approvedTarget.role) {
    return {
      mode: "refused",
      reason: "The requested production coverage role is not approved",
    };
  }

  const url = (env[PRODUCTION_MODE_URL_VARIABLE] as string).trim();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      mode: "refused",
      reason: `${PRODUCTION_MODE_URL_VARIABLE} is not a parseable URL`,
    };
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    return {
      mode: "refused",
      reason: `${PRODUCTION_MODE_URL_VARIABLE} must use PostgreSQL`,
    };
  }
  if (
    parsed.hash ||
    !parsed.hostname ||
    !parsed.username ||
    !parsed.pathname.slice(1)
  ) {
    return {
      mode: "refused",
      reason: `${PRODUCTION_MODE_URL_VARIABLE} does not identify one unambiguous PostgreSQL target`,
    };
  }

  const seenParameters = new Set<string>();
  for (const [name, value] of parsed.searchParams) {
    const normalizedName = name.toLowerCase();
    if (seenParameters.has(normalizedName)) {
      return {
        mode: "refused",
        reason: `${PRODUCTION_MODE_URL_VARIABLE} contains a repeated connection parameter`,
      };
    }
    seenParameters.add(normalizedName);
    if (TARGET_OVERRIDE_PARAMETERS.has(normalizedName)) {
      return {
        mode: "refused",
        reason: `${PRODUCTION_MODE_URL_VARIABLE} contains a target-override parameter`,
      };
    }
    if (!SUPPORTED_CONNECTION_PARAMETERS.has(normalizedName)) {
      return {
        mode: "refused",
        reason: `${PRODUCTION_MODE_URL_VARIABLE} contains an unsupported connection parameter`,
      };
    }
    if (explicitlyDisablesPostgresTls(normalizedName, value)) {
      return {
        mode: "refused",
        reason: `${PRODUCTION_MODE_URL_VARIABLE} explicitly disables TLS`,
      };
    }
    if (normalizedName === "schema" && value !== "public") {
      return {
        mode: "refused",
        reason: `${PRODUCTION_MODE_URL_VARIABLE} must target the public schema`,
      };
    }
  }

  let connectionUsername: string;
  let urlDatabase: string;
  try {
    connectionUsername = decodeURIComponent(parsed.username);
    urlDatabase = decodeURIComponent(parsed.pathname.slice(1));
  } catch {
    return {
      mode: "refused",
      reason: `${PRODUCTION_MODE_URL_VARIABLE} contains malformed target encoding`,
    };
  }

  const connectionHostname = parsed.hostname.toLowerCase();
  const connectionPort = Number(parsed.port || "5432");
  const approvedEndpoint = approvedTarget.endpoints.some(
    (endpoint) =>
      endpoint.hostname === connectionHostname &&
      endpoint.port === connectionPort &&
      endpoint.routingUsername === connectionUsername,
  );
  if (!approvedEndpoint) {
    return {
      mode: "refused",
      reason: "The production coverage connection endpoint is not approved",
    };
  }
  if (
    !urlDatabase ||
    urlDatabase.includes("/") ||
    urlDatabase !== approvedTarget.database
  ) {
    return {
      mode: "refused",
      reason: "The production coverage connection database is not approved",
    };
  }

  return {
    mode: "production-readonly",
    url,
    role: approvedTarget.role,
    approvedTarget,
  };
}

/**
 * Operational mode resolution. Only the source-controlled target can mint the
 * authorization required by the production scan; the injectable pure resolver
 * above cannot mint one.
 */
export function resolveCoverageAuditMode(
  env: Record<string, string | undefined>,
): CoverageAuditMode {
  const configured = resolveCoverageAuditConfiguration(
    env,
    APPROVED_PRODUCTION_COVERAGE_TARGET,
  );
  if (configured.mode !== "production-readonly") return configured;

  const authorization: ProductionCoverageAuditAuthorization = Object.freeze({
    kind: "PRODUCTION_COVERAGE_AUDIT_AUTHORIZATION",
  });
  authorizedProductionTargets.set(authorization, configured.approvedTarget);
  return {
    mode: configured.mode,
    url: configured.url,
    role: configured.role,
    authorization,
  };
}
