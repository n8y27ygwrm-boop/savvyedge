/**
 * One code-reviewed endpoint that may carry the UKGC bootstrap connection.
 * Hostnames use the lowercase representation returned by URL.hostname; ports
 * are explicit so a different service on the same host is not interchangeable.
 */
export interface UkgcBootstrapApprovedEndpoint {
  readonly hostname: string;
  readonly port: number;
  /** Exact decoded URL username, including any pooler tenant/project suffix. */
  readonly routingUsername: string;
}

/**
 * Identity authorized independently of operator-supplied connection values.
 * Database and role are later compared with current_database(), current_user,
 * and session_user on the exact Prisma client used for persistence.
 */
export interface UkgcBootstrapApprovedTarget {
  readonly endpoints: readonly UkgcBootstrapApprovedEndpoint[];
  readonly database: string;
  readonly role: string;
}

/**
 * Fail closed until the real UKGC bootstrap target is approved through source
 * review. Never populate this value from process.env or from a connection URL.
 * Multiple endpoints may identify separately approved direct and pooler paths
 * to the same database and role.
 */
export const APPROVED_UKGC_BOOTSTRAP_TARGET: UkgcBootstrapApprovedTarget | null =
  null;
