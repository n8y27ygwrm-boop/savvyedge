/**
 * One code-reviewed endpoint that may carry the production coverage-audit
 * connection. Hostnames use the lowercase representation returned by
 * URL.hostname; ports are explicit so a different service on the same host is
 * not interchangeable.
 */
export interface ProductionCoverageApprovedEndpoint {
  readonly hostname: string;
  readonly port: number;
  /** Exact decoded URL username, including any pooler tenant/project suffix. */
  readonly routingUsername: string;
}

/**
 * Audit identity authorized independently of operator-supplied connection
 * values. Database and role are compared with current_database(), current_user,
 * and session_user on both the initial client and the exact scan transaction.
 */
export interface ProductionCoverageApprovedTarget {
  readonly endpoints: readonly ProductionCoverageApprovedEndpoint[];
  readonly database: string;
  readonly role: string;
}

/**
 * Fail closed until the real production coverage-audit target is approved
 * through source review. Never populate this value from process.env or from a
 * connection URL. Multiple endpoints may identify separately approved direct
 * and pooler paths to the same database and role.
 */
export const APPROVED_PRODUCTION_COVERAGE_TARGET: ProductionCoverageApprovedTarget | null =
  null;
