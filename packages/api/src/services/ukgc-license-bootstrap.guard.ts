import {
  CURRENT_DATABASE_SQL,
  CURRENT_ROLE_SQL,
  SESSION_READ_ONLY_SQL,
  explicitlyDisablesPostgresTls,
  safeErrorCategory,
  type ReadOnlyProbeClient,
} from "./production-readonly-connection.guard";
import {
  APPROVED_UKGC_BOOTSTRAP_TARGET,
  type UkgcBootstrapApprovedTarget,
} from "../constants/ukgc-bootstrap-approved-target";

export const UKGC_BOOTSTRAP_URL_VARIABLE =
  "SAVVYEDGE_UKGC_BOOTSTRAP_DATABASE_URL";
export const UKGC_BOOTSTRAP_ROLE_VARIABLE = "SAVVYEDGE_UKGC_BOOTSTRAP_ROLE";
export const UKGC_BOOTSTRAP_DATABASE_VARIABLE =
  "SAVVYEDGE_UKGC_BOOTSTRAP_DATABASE";
export const UKGC_BOOTSTRAP_CONFIRM_VARIABLE =
  "SAVVYEDGE_UKGC_BOOTSTRAP_CONFIRM";

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

type UkgcBootstrapTablePrivilege =
  | "SELECT"
  | "INSERT"
  | "UPDATE"
  | "DELETE"
  | "TRUNCATE"
  | "REFERENCES"
  | "TRIGGER";

type UkgcBootstrapObservedTablePrivilege =
  | UkgcBootstrapTablePrivilege
  | `${UkgcBootstrapTablePrivilege} WITH GRANT OPTION`;

/**
 * The sole source-controlled allowlist for the guarded bootstrap. The catalog
 * proof below enumerates what PostgreSQL says the role can actually do and
 * compares the result with this list; SQL does not carry a second policy copy.
 */
export const REQUIRED_UKGC_BOOTSTRAP_TABLE_PRIVILEGES = [
  ["Casino", "SELECT"],
  ["Casino", "UPDATE"],
  ["Jurisdiction", "SELECT"],
  ["Jurisdiction", "INSERT"],
  ["Jurisdiction", "UPDATE"],
  ["Regulator", "SELECT"],
  ["Regulator", "INSERT"],
  ["Regulator", "UPDATE"],
  ["DataSource", "SELECT"],
  ["DataSource", "INSERT"],
  ["DataSource", "UPDATE"],
  ["ReviewActor", "SELECT"],
  ["ReviewActor", "INSERT"],
  ["ReviewActor", "UPDATE"],
  ["License", "SELECT"],
  ["License", "INSERT"],
  ["License", "UPDATE"],
  ["EvidenceRecord", "SELECT"],
  ["EvidenceRecord", "INSERT"],
  ["LicenseEvidenceClaim", "SELECT"],
  ["LicenseEvidenceClaim", "INSERT"],
  ["CasinoHistoryEvent", "SELECT"],
  ["CasinoHistoryEvent", "INSERT"],
  ["WorkflowAuditEvent", "SELECT"],
  ["WorkflowAuditEvent", "INSERT"],
  ["WorkflowEventClaim", "SELECT"],
  ["WorkflowEventClaim", "INSERT"],
] as const satisfies ReadonlyArray<
  readonly [string, UkgcBootstrapTablePrivilege]
>;

const REACHABLE_ROLES_CTE = `
WITH reachable_roles(role_oid) AS (
  SELECT role_object.oid
  FROM pg_catalog.pg_roles role_object
  WHERE role_object.rolname = current_user
     OR pg_catalog.pg_has_role(current_user, role_object.oid, 'USAGE')
     OR pg_catalog.pg_has_role(
       current_user,
       role_object.oid,
       CASE
         WHEN current_setting('server_version_num')::int >= 160000 THEN 'SET'
         ELSE 'MEMBER'
       END
     )
)`.trim();

const SETTABLE_ROLES_CTE = `
WITH settable_roles(role_oid) AS (
  SELECT role_object.oid
  FROM pg_catalog.pg_roles role_object
  WHERE role_object.rolname = current_user
     OR pg_catalog.pg_has_role(
       current_user,
       role_object.oid,
       CASE
         WHEN current_setting('server_version_num')::int >= 160000 THEN 'SET'
         ELSE 'MEMBER'
       END
     )
)`.trim();

/** Includes attributes reachable with SET ROLE, not only currently inherited. */
export const UKGC_BOOTSTRAP_ROLE_ATTRIBUTES_SQL = `
${SETTABLE_ROLES_CTE}
SELECT
  COALESCE(bool_or(r.rolsuper), false) AS has_superuser,
  COALESCE(bool_or(r.rolbypassrls), false) AS has_bypassrls,
  COALESCE(
    bool_or(r.rolcreatedb OR r.rolcreaterole OR r.rolreplication),
    false
  ) AS has_escalation,
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members membership
    JOIN settable_roles holder ON holder.role_oid = membership.member
    WHERE membership.admin_option
  ) AS has_membership_admin
FROM settable_roles reachable
JOIN pg_catalog.pg_roles r ON r.oid = reachable.role_oid`.trim();

export const UKGC_BOOTSTRAP_OWNERSHIP_SQL = `
${REACHABLE_ROLES_CTE}
SELECT
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_database database_object
    JOIN reachable_roles owner
      ON owner.role_oid = database_object.datdba
    WHERE database_object.datname = current_database()
  ) AS owns_database,
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_namespace schema_object
    JOIN reachable_roles owner
      ON owner.role_oid = schema_object.nspowner
    WHERE schema_object.nspname = 'public'
  ) AS owns_schema,
  (
    SELECT count(*)::int
    FROM pg_catalog.pg_class relation_object
    JOIN pg_catalog.pg_namespace namespace
      ON namespace.oid = relation_object.relnamespace
    JOIN reachable_roles owner ON owner.role_oid = relation_object.relowner
    WHERE namespace.nspname = 'public'
      AND relation_object.relkind IN ('r', 'p', 'v', 'm', 'f')
  ) AS owned_relations,
  (
    SELECT count(*)::int
    FROM pg_catalog.pg_class sequence_object
    JOIN pg_catalog.pg_namespace namespace
      ON namespace.oid = sequence_object.relnamespace
    JOIN reachable_roles owner ON owner.role_oid = sequence_object.relowner
    WHERE namespace.nspname = 'public'
      AND sequence_object.relkind = 'S'
  ) AS owned_sequences,
  (
    SELECT count(*)::int
    FROM pg_catalog.pg_proc routine_object
    JOIN pg_catalog.pg_namespace namespace
      ON namespace.oid = routine_object.pronamespace
    JOIN reachable_roles owner ON owner.role_oid = routine_object.proowner
    WHERE namespace.nspname = 'public'
  ) AS owned_routines`.trim();

export const UKGC_BOOTSTRAP_DATABASE_PRIVILEGES_SQL = `
${REACHABLE_ROLES_CTE}
SELECT
  pg_catalog.has_database_privilege(
    current_user,
    current_database(),
    'CONNECT'
  ) AS can_connect,
  COALESCE(
    bool_or(
      pg_catalog.has_database_privilege(
        reachable.role_oid,
        current_database(),
        'CONNECT WITH GRANT OPTION'
      )
    ),
    false
  ) AS can_grant_connect,
  COALESCE(
    bool_or(
      pg_catalog.has_database_privilege(
        reachable.role_oid,
        current_database(),
        'CREATE'
      )
    ),
    false
  ) AS can_create,
  COALESCE(
    bool_or(
      pg_catalog.has_database_privilege(
        reachable.role_oid,
        current_database(),
        'TEMP'
      )
    ),
    false
  ) AS can_create_temp
FROM reachable_roles reachable`.trim();

export const UKGC_BOOTSTRAP_SCHEMA_PRIVILEGES_SQL = `
${REACHABLE_ROLES_CTE}
SELECT
  pg_catalog.has_schema_privilege(current_user, 'public', 'USAGE') AS can_use,
  COALESCE(
    bool_or(
      pg_catalog.has_schema_privilege(
        reachable.role_oid,
        'public',
        'USAGE WITH GRANT OPTION'
      )
    ),
    false
  ) AS can_grant_usage,
  COALESCE(
    bool_or(
      pg_catalog.has_schema_privilege(reachable.role_oid, 'public', 'CREATE')
    ),
    false
  ) AS can_create
FROM reachable_roles reachable`.trim();

/** Additional application schemas are outside the bootstrap capability. */
export const UKGC_BOOTSTRAP_NON_PUBLIC_SCHEMA_PRIVILEGES_SQL = `
${REACHABLE_ROLES_CTE}
SELECT count(*)::int AS accessible_schemas
FROM pg_catalog.pg_namespace namespace
WHERE namespace.nspname <> 'public'
  AND namespace.nspname <> 'information_schema'
  AND namespace.nspname !~ '^pg_'
  AND EXISTS (
    SELECT 1 FROM reachable_roles reachable
    WHERE namespace.nspowner = reachable.role_oid
       OR pg_catalog.has_schema_privilege(reachable.role_oid, namespace.oid, 'USAGE')
       OR pg_catalog.has_schema_privilege(reachable.role_oid, namespace.oid, 'CREATE')
  )`.trim();

/** Built-ins live in system schemas; no application routine is approved. */
export const UKGC_BOOTSTRAP_ROUTINE_PRIVILEGES_SQL = `
${REACHABLE_ROLES_CTE}
SELECT count(*)::int AS executable_routines
FROM pg_catalog.pg_proc routine
JOIN pg_catalog.pg_namespace namespace ON namespace.oid = routine.pronamespace
WHERE namespace.nspname <> 'information_schema'
  AND namespace.nspname !~ '^pg_'
  AND EXISTS (
    SELECT 1 FROM reachable_roles reachable
    WHERE pg_catalog.has_schema_privilege(reachable.role_oid, namespace.oid, 'USAGE')
      AND pg_catalog.has_function_privilege(reachable.role_oid, routine.oid, 'EXECUTE')
  )`.trim();

/**
 * Rejects grant options and PostgreSQL privilege classes unknown to this
 * guard. This ACL enumeration is deliberately separate from the fixed
 * has_*_privilege probes so a newer server privilege (for example MAINTAIN)
 * cannot disappear merely because an older server would reject that name.
 */
export const UKGC_BOOTSTRAP_UNEXPECTED_ACL_SQL = `
${REACHABLE_ROLES_CTE},
applicable_acl AS (
  SELECT
    'RELATION'::text AS object_kind,
    relation_acl.grantee,
    relation_acl.privilege_type,
    relation_acl.is_grantable
  FROM pg_catalog.pg_class relation_object
  JOIN pg_catalog.pg_namespace namespace
    ON namespace.oid = relation_object.relnamespace
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    COALESCE(
      relation_object.relacl,
      pg_catalog.acldefault('r', relation_object.relowner)
    )
  ) relation_acl
  WHERE namespace.nspname = 'public'
    AND relation_object.relkind IN ('r', 'p', 'v', 'm', 'f')

  UNION ALL

  SELECT
    'COLUMN'::text AS object_kind,
    column_acl.grantee,
    column_acl.privilege_type,
    column_acl.is_grantable
  FROM pg_catalog.pg_class relation_object
  JOIN pg_catalog.pg_namespace namespace
    ON namespace.oid = relation_object.relnamespace
  JOIN pg_catalog.pg_attribute attribute
    ON attribute.attrelid = relation_object.oid
  CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) column_acl
  WHERE namespace.nspname = 'public'
    AND relation_object.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped

  UNION ALL

  SELECT
    'SEQUENCE'::text AS object_kind,
    sequence_acl.grantee,
    sequence_acl.privilege_type,
    sequence_acl.is_grantable
  FROM pg_catalog.pg_class sequence_object
  JOIN pg_catalog.pg_namespace namespace
    ON namespace.oid = sequence_object.relnamespace
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    COALESCE(
      sequence_object.relacl,
      pg_catalog.acldefault('S', sequence_object.relowner)
    )
  ) sequence_acl
  WHERE namespace.nspname = 'public'
    AND sequence_object.relkind = 'S'
)
SELECT count(*)::int AS unexpected_acl_entries
FROM applicable_acl acl
WHERE (
    acl.grantee = 0
    OR EXISTS (
      SELECT 1
      FROM reachable_roles reachable
      WHERE reachable.role_oid = acl.grantee
    )
  )
  AND (
    acl.is_grantable
    OR (
      acl.object_kind = 'RELATION'
      AND acl.privilege_type NOT IN (
        'SELECT',
        'INSERT',
        'UPDATE',
        'DELETE',
        'TRUNCATE',
        'REFERENCES',
        'TRIGGER'
      )
    )
    OR (
      acl.object_kind = 'COLUMN'
      AND acl.privilege_type NOT IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
    )
    OR acl.object_kind = 'SEQUENCE'
  )`.trim();

export const UKGC_BOOTSTRAP_TABLE_PRIVILEGES_SQL = `
${REACHABLE_ROLES_CTE},
table_privileges(privilege_name) AS (
  VALUES
    ('SELECT'),
    ('INSERT'),
    ('UPDATE'),
    ('DELETE'),
    ('TRUNCATE'),
    ('REFERENCES'),
    ('TRIGGER'),
    ('SELECT WITH GRANT OPTION'),
    ('INSERT WITH GRANT OPTION'),
    ('UPDATE WITH GRANT OPTION'),
    ('DELETE WITH GRANT OPTION'),
    ('TRUNCATE WITH GRANT OPTION'),
    ('REFERENCES WITH GRANT OPTION'),
    ('TRIGGER WITH GRANT OPTION')
)
SELECT
  relation_object.relname::text AS table_name,
  table_privileges.privilege_name::text AS privilege_name,
  pg_catalog.has_table_privilege(
    current_user,
    relation_object.oid,
    table_privileges.privilege_name
  ) AS is_currently_effective
FROM pg_catalog.pg_class relation_object
JOIN pg_catalog.pg_namespace namespace
  ON namespace.oid = relation_object.relnamespace
CROSS JOIN table_privileges
WHERE namespace.nspname = 'public'
  AND relation_object.relkind IN ('r', 'p', 'v', 'm', 'f')
  AND EXISTS (
    SELECT 1
    FROM reachable_roles reachable
    WHERE pg_catalog.has_table_privilege(
      reachable.role_oid,
      relation_object.oid,
      table_privileges.privilege_name
    )
  )
ORDER BY relation_object.relname, table_privileges.privilege_name`.trim();

export const UKGC_BOOTSTRAP_COLUMN_PRIVILEGES_SQL = `
${REACHABLE_ROLES_CTE},
column_privileges(privilege_name) AS (
  VALUES
    ('SELECT'),
    ('INSERT'),
    ('UPDATE'),
    ('REFERENCES'),
    ('SELECT WITH GRANT OPTION'),
    ('INSERT WITH GRANT OPTION'),
    ('UPDATE WITH GRANT OPTION'),
    ('REFERENCES WITH GRANT OPTION')
)
SELECT
  relation_object.relname::text AS table_name,
  attribute.attname::text AS column_name,
  column_privileges.privilege_name::text AS privilege_name
FROM pg_catalog.pg_class relation_object
JOIN pg_catalog.pg_namespace namespace
  ON namespace.oid = relation_object.relnamespace
JOIN pg_catalog.pg_attribute attribute
  ON attribute.attrelid = relation_object.oid
CROSS JOIN column_privileges
WHERE namespace.nspname = 'public'
  AND relation_object.relkind IN ('r', 'p', 'v', 'm', 'f')
  AND attribute.attnum > 0
  AND NOT attribute.attisdropped
  AND EXISTS (
    SELECT 1
    FROM reachable_roles reachable
    WHERE pg_catalog.has_column_privilege(
      reachable.role_oid,
      relation_object.oid,
      attribute.attnum,
      column_privileges.privilege_name
    )
  )
ORDER BY
  relation_object.relname,
  attribute.attnum,
  column_privileges.privilege_name`.trim();

export const UKGC_BOOTSTRAP_SEQUENCE_PRIVILEGES_SQL = `
${REACHABLE_ROLES_CTE},
sequence_privileges(privilege_name) AS (
  VALUES
    ('SELECT'),
    ('USAGE'),
    ('UPDATE'),
    ('SELECT WITH GRANT OPTION'),
    ('USAGE WITH GRANT OPTION'),
    ('UPDATE WITH GRANT OPTION')
)
SELECT
  sequence_object.relname::text AS sequence_name,
  sequence_privileges.privilege_name::text AS privilege_name
FROM pg_catalog.pg_class sequence_object
JOIN pg_catalog.pg_namespace namespace
  ON namespace.oid = sequence_object.relnamespace
CROSS JOIN sequence_privileges
WHERE namespace.nspname = 'public'
  AND sequence_object.relkind = 'S'
  AND EXISTS (
    SELECT 1
    FROM reachable_roles reachable
    WHERE pg_catalog.has_sequence_privilege(
      reachable.role_oid,
      sequence_object.oid,
      sequence_privileges.privilege_name
    )
  )
ORDER BY sequence_object.relname, sequence_privileges.privilege_name`.trim();

export class UkgcBootstrapGuardError extends Error {
  public constructor(
    public readonly code:
      "INVALID_ARGUMENTS" | "CONFIGURATION_REFUSED" | "CONNECTION_REFUSED",
    message: string,
  ) {
    super(message);
    this.name = "UkgcBootstrapGuardError";
  }
}

export interface UkgcBootstrapCliArguments {
  casinoId: string;
  execute: boolean;
}

export interface UkgcBootstrapConnectionConfig extends UkgcBootstrapCliArguments {
  url: string;
  approvedTarget: UkgcBootstrapApprovedTarget;
}

export function parseUkgcBootstrapArguments(
  argv: readonly string[],
): UkgcBootstrapCliArguments {
  let casinoId: string | undefined;
  let execute = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--casino-id") {
      if (casinoId !== undefined || !argv[index + 1]) {
        throw new UkgcBootstrapGuardError(
          "INVALID_ARGUMENTS",
          "Exactly one --casino-id value is required.",
        );
      }
      casinoId = argv[index + 1];
      index += 1;
      continue;
    }
    if (argument === "--execute" && !execute) {
      execute = true;
      continue;
    }
    throw new UkgcBootstrapGuardError(
      "INVALID_ARGUMENTS",
      "Only --casino-id and the optional --execute intent flag are accepted.",
    );
  }

  if (!casinoId?.trim()) {
    throw new UkgcBootstrapGuardError(
      "INVALID_ARGUMENTS",
      "Exactly one --casino-id value is required.",
    );
  }

  return { casinoId: casinoId.trim(), execute };
}

function requiredEnvironmentValue(
  env: Record<string, string | undefined>,
  name: string,
): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new UkgcBootstrapGuardError(
      "CONFIGURATION_REFUSED",
      `${name} is required.`,
    );
  }
  return value;
}

export function resolveUkgcBootstrapConnectionConfig(
  args: UkgcBootstrapCliArguments,
  env: Record<string, string | undefined> = process.env,
  approvedTarget: UkgcBootstrapApprovedTarget | null = APPROVED_UKGC_BOOTSTRAP_TARGET,
): UkgcBootstrapConnectionConfig {
  if (
    !approvedTarget ||
    approvedTarget.role.trim() !== approvedTarget.role ||
    approvedTarget.role === "" ||
    approvedTarget.database.trim() !== approvedTarget.database ||
    approvedTarget.database === "" ||
    approvedTarget.database.includes("/") ||
    approvedTarget.endpoints.length === 0
  ) {
    throw new UkgcBootstrapGuardError(
      "CONFIGURATION_REFUSED",
      "A valid code-reviewed UKGC bootstrap target is required.",
    );
  }

  for (const endpoint of approvedTarget.endpoints) {
    if (
      endpoint.hostname.trim().toLowerCase() !== endpoint.hostname ||
      endpoint.hostname === "" ||
      endpoint.routingUsername.trim() !== endpoint.routingUsername ||
      endpoint.routingUsername === "" ||
      !Number.isInteger(endpoint.port) ||
      endpoint.port < 1 ||
      endpoint.port > 65_535
    ) {
      throw new UkgcBootstrapGuardError(
        "CONFIGURATION_REFUSED",
        "The code-reviewed UKGC bootstrap target is malformed.",
      );
    }
  }

  const url = requiredEnvironmentValue(env, UKGC_BOOTSTRAP_URL_VARIABLE);
  const requestedRole = requiredEnvironmentValue(
    env,
    UKGC_BOOTSTRAP_ROLE_VARIABLE,
  );
  const requestedDatabase = requiredEnvironmentValue(
    env,
    UKGC_BOOTSTRAP_DATABASE_VARIABLE,
  );
  if (
    requestedRole !== approvedTarget.role ||
    requestedDatabase !== approvedTarget.database
  ) {
    throw new UkgcBootstrapGuardError(
      "CONFIGURATION_REFUSED",
      "The requested UKGC bootstrap identity is not approved.",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UkgcBootstrapGuardError(
      "CONFIGURATION_REFUSED",
      `${UKGC_BOOTSTRAP_URL_VARIABLE} is not a parseable URL.`,
    );
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new UkgcBootstrapGuardError(
      "CONFIGURATION_REFUSED",
      `${UKGC_BOOTSTRAP_URL_VARIABLE} must use PostgreSQL.`,
    );
  }
  if (
    parsed.hash ||
    !parsed.hostname ||
    !parsed.username ||
    !parsed.pathname.slice(1)
  ) {
    throw new UkgcBootstrapGuardError(
      "CONFIGURATION_REFUSED",
      `${UKGC_BOOTSTRAP_URL_VARIABLE} does not identify one unambiguous PostgreSQL target.`,
    );
  }

  const seenParameters = new Set<string>();
  for (const [name, value] of parsed.searchParams) {
    const normalizedName = name.toLowerCase();
    if (seenParameters.has(normalizedName)) {
      throw new UkgcBootstrapGuardError(
        "CONFIGURATION_REFUSED",
        `${UKGC_BOOTSTRAP_URL_VARIABLE} contains a repeated connection parameter.`,
      );
    }
    seenParameters.add(normalizedName);
    if (TARGET_OVERRIDE_PARAMETERS.has(normalizedName)) {
      throw new UkgcBootstrapGuardError(
        "CONFIGURATION_REFUSED",
        `${UKGC_BOOTSTRAP_URL_VARIABLE} contains a target-override parameter.`,
      );
    }
    if (!SUPPORTED_CONNECTION_PARAMETERS.has(normalizedName)) {
      throw new UkgcBootstrapGuardError(
        "CONFIGURATION_REFUSED",
        `${UKGC_BOOTSTRAP_URL_VARIABLE} contains an unsupported connection parameter.`,
      );
    }
    if (explicitlyDisablesPostgresTls(normalizedName, value)) {
      throw new UkgcBootstrapGuardError(
        "CONFIGURATION_REFUSED",
        `${UKGC_BOOTSTRAP_URL_VARIABLE} explicitly disables TLS.`,
      );
    }
    if (normalizedName === "schema" && value !== "public") {
      throw new UkgcBootstrapGuardError(
        "CONFIGURATION_REFUSED",
        `${UKGC_BOOTSTRAP_URL_VARIABLE} must target the public schema.`,
      );
    }
  }

  let connectionUsername: string;
  let urlDatabase: string;
  try {
    connectionUsername = decodeURIComponent(parsed.username);
    urlDatabase = decodeURIComponent(parsed.pathname.slice(1));
  } catch {
    throw new UkgcBootstrapGuardError(
      "CONFIGURATION_REFUSED",
      `${UKGC_BOOTSTRAP_URL_VARIABLE} contains malformed target encoding.`,
    );
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
    throw new UkgcBootstrapGuardError(
      "CONFIGURATION_REFUSED",
      "The UKGC bootstrap connection endpoint is not approved.",
    );
  }
  if (
    !urlDatabase ||
    urlDatabase.includes("/") ||
    urlDatabase !== approvedTarget.database
  ) {
    throw new UkgcBootstrapGuardError(
      "CONFIGURATION_REFUSED",
      "The UKGC bootstrap connection database is not approved.",
    );
  }

  if (args.execute) {
    const requiredConfirmation = `EXECUTE:${args.casinoId}`;
    if (env[UKGC_BOOTSTRAP_CONFIRM_VARIABLE] !== requiredConfirmation) {
      throw new UkgcBootstrapGuardError(
        "CONFIGURATION_REFUSED",
        `${UKGC_BOOTSTRAP_CONFIRM_VARIABLE} must confirm this exact Casino target.`,
      );
    }
  }

  return {
    ...args,
    url,
    approvedTarget,
  };
}

export type OperationalConnectionProof =
  | { proven: true; role: string; databaseName: string }
  | {
      proven: false;
      failedCheck:
        | "SESSION_MODE"
        | "CURRENT_ROLE"
        | "ROLE_ATTRIBUTES"
        | "OWNERSHIP"
        | "DATABASE_PRIVILEGES"
        | "SCHEMA_CREATE_PRIVILEGE"
        | "NON_PUBLIC_SCHEMA_PRIVILEGE"
        | "ROUTINE_PRIVILEGE_ENVELOPE"
        | "TARGET_DATABASE"
        | "REQUIRED_PRIVILEGES"
        | "TABLE_PRIVILEGE_ENVELOPE"
        | "COLUMN_PRIVILEGE_ENVELOPE"
        | "SEQUENCE_PRIVILEGE_ENVELOPE";
      reason: string;
    };

function refusal(
  failedCheck: Exclude<
    OperationalConnectionProof,
    { proven: true }
  >["failedCheck"],
  reason: string,
): OperationalConnectionProof {
  return { proven: false, failedCheck, reason };
}

async function oneRow(
  client: ReadOnlyProbeClient,
  sql: string,
): Promise<Record<string, unknown> | null> {
  const rows = await client.$queryRawUnsafe<unknown>(sql);
  if (!Array.isArray(rows) || rows.length !== 1) return null;
  const row = rows[0];
  return typeof row === "object" && row !== null
    ? (row as Record<string, unknown>)
    : null;
}

async function rows(
  client: ReadOnlyProbeClient,
  sql: string,
): Promise<Record<string, unknown>[] | null> {
  const result = await client.$queryRawUnsafe<unknown>(sql);
  if (!Array.isArray(result)) return null;
  const records: Record<string, unknown>[] = [];
  for (const row of result) {
    if (typeof row !== "object" || row === null) return null;
    records.push(row as Record<string, unknown>);
  }
  return records;
}

const TABLE_PRIVILEGES = new Set<UkgcBootstrapObservedTablePrivilege>([
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
  "SELECT WITH GRANT OPTION",
  "INSERT WITH GRANT OPTION",
  "UPDATE WITH GRANT OPTION",
  "DELETE WITH GRANT OPTION",
  "TRUNCATE WITH GRANT OPTION",
  "REFERENCES WITH GRANT OPTION",
  "TRIGGER WITH GRANT OPTION",
]);

function tablePrivilegeKey(tableName: string, privilegeName: string): string {
  return `${tableName}\u0000${privilegeName}`;
}

function parseTablePrivilegeRows(
  result: Record<string, unknown>[] | null,
): { reachable: Set<string>; current: Set<string> } | null {
  if (!result) return null;
  const reachable = new Set<string>();
  const current = new Set<string>();
  for (const row of result) {
    const tableName = row.table_name;
    const privilegeName = row.privilege_name;
    if (
      typeof tableName !== "string" ||
      tableName === "" ||
      typeof privilegeName !== "string" ||
      typeof row.is_currently_effective !== "boolean" ||
      !TABLE_PRIVILEGES.has(
        privilegeName as UkgcBootstrapObservedTablePrivilege,
      )
    ) {
      return null;
    }
    const key = tablePrivilegeKey(tableName, privilegeName);
    if (reachable.has(key)) return null;
    reachable.add(key);
    if (row.is_currently_effective) current.add(key);
  }
  return { reachable, current };
}

function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * Proves that execution uses the code-reviewed, non-escalating writer role on
 * the code-reviewed database and that the role has the minimum table operations
 * required by the existing UKGC verifier.
 */
export async function proveUkgcBootstrapWriteConnection(
  client: ReadOnlyProbeClient,
  approvedTarget: UkgcBootstrapApprovedTarget,
): Promise<OperationalConnectionProof> {
  let activeCheck: Exclude<
    OperationalConnectionProof,
    { proven: true }
  >["failedCheck"] = "SESSION_MODE";

  try {
    const session = await oneRow(client, SESSION_READ_ONLY_SQL);
    if (session?.transaction_read_only !== "off") {
      return refusal("SESSION_MODE", "The execution session is not writable.");
    }

    activeCheck = "CURRENT_ROLE";
    const identity = await oneRow(client, CURRENT_ROLE_SQL);
    if (
      identity?.current_role !== approvedTarget.role ||
      identity?.session_role !== approvedTarget.role
    ) {
      return refusal(
        "CURRENT_ROLE",
        "The effective and login roles do not match the expected operator role.",
      );
    }

    activeCheck = "ROLE_ATTRIBUTES";
    const attributes = await oneRow(client, UKGC_BOOTSTRAP_ROLE_ATTRIBUTES_SQL);
    if (
      attributes?.has_superuser !== false ||
      attributes?.has_bypassrls !== false ||
      attributes?.has_escalation !== false ||
      attributes?.has_membership_admin !== false
    ) {
      return refusal(
        "ROLE_ATTRIBUTES",
        "The operator role has unsafe or unprovable escalation attributes.",
      );
    }

    activeCheck = "TARGET_DATABASE";
    const database = await oneRow(client, CURRENT_DATABASE_SQL);
    if (database?.database_name !== approvedTarget.database) {
      return refusal(
        "TARGET_DATABASE",
        "The connected database does not match the expected target.",
      );
    }

    activeCheck = "OWNERSHIP";
    const ownership = await oneRow(client, UKGC_BOOTSTRAP_OWNERSHIP_SQL);
    if (
      ownership?.owns_database !== false ||
      ownership?.owns_schema !== false ||
      !isNonnegativeInteger(ownership?.owned_relations) ||
      ownership.owned_relations !== 0 ||
      !isNonnegativeInteger(ownership?.owned_sequences) ||
      ownership.owned_sequences !== 0 ||
      !isNonnegativeInteger(ownership?.owned_routines) ||
      ownership.owned_routines !== 0
    ) {
      return refusal(
        "OWNERSHIP",
        "The operator role has an unsafe or unprovable ownership path.",
      );
    }

    activeCheck = "DATABASE_PRIVILEGES";
    const databasePrivileges = await oneRow(
      client,
      UKGC_BOOTSTRAP_DATABASE_PRIVILEGES_SQL,
    );
    if (
      databasePrivileges?.can_connect !== true ||
      databasePrivileges?.can_grant_connect !== false ||
      databasePrivileges?.can_create !== false ||
      databasePrivileges?.can_create_temp !== false
    ) {
      return refusal(
        "DATABASE_PRIVILEGES",
        "The operator role has an unsafe or unprovable database privilege envelope.",
      );
    }

    activeCheck = "SCHEMA_CREATE_PRIVILEGE";
    const schema = await oneRow(client, UKGC_BOOTSTRAP_SCHEMA_PRIVILEGES_SQL);
    if (
      schema?.can_use !== true ||
      schema?.can_grant_usage !== false ||
      schema?.can_create !== false
    ) {
      return refusal(
        "SCHEMA_CREATE_PRIVILEGE",
        "The operator role has an unsafe or unprovable public schema privilege envelope.",
      );
    }

    activeCheck = "NON_PUBLIC_SCHEMA_PRIVILEGE";
    const extraSchemas = await oneRow(
      client,
      UKGC_BOOTSTRAP_NON_PUBLIC_SCHEMA_PRIVILEGES_SQL,
    );
    if (extraSchemas?.accessible_schemas !== 0) {
      return refusal(
        "NON_PUBLIC_SCHEMA_PRIVILEGE",
        "The operator role can access an unapproved application schema.",
      );
    }

    activeCheck = "ROUTINE_PRIVILEGE_ENVELOPE";
    const routines = await oneRow(
      client,
      UKGC_BOOTSTRAP_ROUTINE_PRIVILEGES_SQL,
    );
    if (routines?.executable_routines !== 0) {
      return refusal(
        "ROUTINE_PRIVILEGE_ENVELOPE",
        "The operator role can execute an unapproved application routine.",
      );
    }

    const expectedTablePrivileges = new Set(
      REQUIRED_UKGC_BOOTSTRAP_TABLE_PRIVILEGES.map(([table, privilege]) =>
        tablePrivilegeKey(table, privilege),
      ),
    );
    activeCheck = "TABLE_PRIVILEGE_ENVELOPE";
    const observedTablePrivileges = parseTablePrivilegeRows(
      await rows(client, UKGC_BOOTSTRAP_TABLE_PRIVILEGES_SQL),
    );
    if (!observedTablePrivileges) {
      return refusal(
        "TABLE_PRIVILEGE_ENVELOPE",
        "The effective table privilege catalog result is malformed.",
      );
    }
    if (
      [...expectedTablePrivileges].some(
        (privilege) => !observedTablePrivileges.current.has(privilege),
      )
    ) {
      return refusal(
        "REQUIRED_PRIVILEGES",
        "The operator role lacks one or more required table privileges.",
      );
    }
    if (
      [...observedTablePrivileges.reachable].some(
        (privilege) => !expectedTablePrivileges.has(privilege),
      )
    ) {
      return refusal(
        "TABLE_PRIVILEGE_ENVELOPE",
        "The operator role has one or more unexpected table privileges.",
      );
    }

    activeCheck = "COLUMN_PRIVILEGE_ENVELOPE";
    const columnPrivileges = await rows(
      client,
      UKGC_BOOTSTRAP_COLUMN_PRIVILEGES_SQL,
    );
    if (!columnPrivileges) {
      return refusal(
        "COLUMN_PRIVILEGE_ENVELOPE",
        "The effective column privilege catalog result is malformed.",
      );
    }
    const observedColumns = new Set<string>();
    for (const row of columnPrivileges) {
      const tableName = row.table_name;
      const columnName = row.column_name;
      const privilegeName = row.privilege_name;
      if (
        typeof tableName !== "string" ||
        tableName === "" ||
        typeof columnName !== "string" ||
        columnName === "" ||
        (privilegeName !== "SELECT" &&
          privilegeName !== "INSERT" &&
          privilegeName !== "UPDATE" &&
          privilegeName !== "REFERENCES" &&
          privilegeName !== "SELECT WITH GRANT OPTION" &&
          privilegeName !== "INSERT WITH GRANT OPTION" &&
          privilegeName !== "UPDATE WITH GRANT OPTION" &&
          privilegeName !== "REFERENCES WITH GRANT OPTION")
      ) {
        return refusal(
          "COLUMN_PRIVILEGE_ENVELOPE",
          "The effective column privilege catalog result is malformed.",
        );
      }
      const columnKey = `${tablePrivilegeKey(
        tableName,
        privilegeName,
      )}\u0000${columnName}`;
      if (
        observedColumns.has(columnKey) ||
        privilegeName.endsWith(" WITH GRANT OPTION") ||
        !expectedTablePrivileges.has(
          tablePrivilegeKey(tableName, privilegeName),
        )
      ) {
        return refusal(
          "COLUMN_PRIVILEGE_ENVELOPE",
          "The operator role has an unexpected effective column write privilege.",
        );
      }
      observedColumns.add(columnKey);
    }

    activeCheck = "SEQUENCE_PRIVILEGE_ENVELOPE";
    const sequencePrivileges = await rows(
      client,
      UKGC_BOOTSTRAP_SEQUENCE_PRIVILEGES_SQL,
    );
    if (!sequencePrivileges) {
      return refusal(
        "SEQUENCE_PRIVILEGE_ENVELOPE",
        "The effective sequence privilege catalog result is malformed.",
      );
    }
    if (sequencePrivileges.length !== 0) {
      for (const row of sequencePrivileges) {
        if (
          typeof row.sequence_name !== "string" ||
          row.sequence_name === "" ||
          (row.privilege_name !== "SELECT" &&
            row.privilege_name !== "USAGE" &&
            row.privilege_name !== "UPDATE" &&
            row.privilege_name !== "SELECT WITH GRANT OPTION" &&
            row.privilege_name !== "USAGE WITH GRANT OPTION" &&
            row.privilege_name !== "UPDATE WITH GRANT OPTION")
        ) {
          return refusal(
            "SEQUENCE_PRIVILEGE_ENVELOPE",
            "The effective sequence privilege catalog result is malformed.",
          );
        }
      }
      return refusal(
        "SEQUENCE_PRIVILEGE_ENVELOPE",
        "The operator role has an unexpected effective sequence privilege.",
      );
    }

    activeCheck = "TABLE_PRIVILEGE_ENVELOPE";
    const unexpectedAcl = await oneRow(
      client,
      UKGC_BOOTSTRAP_UNEXPECTED_ACL_SQL,
    );
    if (unexpectedAcl?.unexpected_acl_entries !== 0) {
      return refusal(
        "TABLE_PRIVILEGE_ENVELOPE",
        "The operator role has an unexpected or unprovable catalog privilege.",
      );
    }

    return {
      proven: true,
      role: approvedTarget.role,
      databaseName: approvedTarget.database,
    };
  } catch (error) {
    return refusal(
      activeCheck,
      `Connection proof failed (${safeErrorCategory(error)}).`,
    );
  }
}
