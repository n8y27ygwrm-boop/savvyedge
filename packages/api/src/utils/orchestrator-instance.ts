import { randomUUID } from "crypto";

/**
 * Instance-scoped orchestrator worker identity.
 *
 * WorkerNode rows are owned by exactly one orchestrator process. Globally fixed
 * names (`worker-node-1..N`) made every deployment claim the same rows, so a
 * terminating deployment's shutdown marked the *replacement* deployment's
 * workers DEAD during Railway's rolling-deploy overlap — after which the new
 * process's heartbeat (which only touches ACTIVE rows) matched nothing and the
 * live deployment stayed represented as DEAD forever.
 *
 * Scoping every worker name with a per-process instance id makes ownership
 * disjoint: a process can only ever mutate rows it created. The property that
 * matters is uniqueness among simultaneously live replicas and deployments.
 */

/** Separates the instance id from the logical worker slot in a worker name. */
export const WORKER_NAME_DELIMITER = ":";

/** Upper bound on a stored instance id, keeping worker names small and loggable. */
export const MAX_INSTANCE_ID_LENGTH = 64;

/**
 * Reduces an identifier to a bounded, delimiter-safe token.
 * Anything outside [A-Za-z0-9_-] (including the name delimiter) is collapsed to
 * a single dash so an instance id can never forge an extra name segment.
 */
export function sanitizeInstanceId(rawInstanceId: string): string {
  return rawInstanceId
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_INSTANCE_ID_LENGTH)
    .replace(/-+$/g, "");
}

/**
 * Resolves this process's orchestrator instance id.
 *
 * The invariant being protected is that no two *simultaneously live*
 * orchestrator processes share an identity, so the most-specific per-replica
 * runtime identity always wins:
 *
 *  1. `RAILWAY_REPLICA_ID` — Railway's per-replica runtime identity, and
 *     therefore authoritative whenever it is present. It deliberately outranks
 *     the operator override: a static `ORCHESTRATOR_INSTANCE_ID` configured at
 *     Railway service/environment scope is inherited by *every* replica and by
 *     both sides of a rolling deploy, which would reintroduce exactly the
 *     collision this module exists to prevent.
 *  2. `ORCHESTRATOR_INSTANCE_ID` — explicit operator identity, used only on
 *     runtimes that expose no per-replica id of their own. Operators setting it
 *     there are responsible for keeping it distinct per live process.
 *  3. A random UUID generated once for this process (local/dev, or any host
 *     that exposes no suitable runtime identity).
 *
 * Deliberately does NOT fall back to `RAILWAY_DEPLOYMENT_ID`: that value is
 * shared by every replica of one deployment, which would also collide.
 *
 * Carries no secrets — only opaque platform identifiers.
 */
export function resolveOrchestratorInstanceId(
  env: NodeJS.ProcessEnv = process.env,
): string {
  for (const candidate of [env.RAILWAY_REPLICA_ID, env.ORCHESTRATOR_INSTANCE_ID]) {
    if (typeof candidate === "string" && candidate.trim() !== "") {
      const sanitized = sanitizeInstanceId(candidate);
      if (sanitized !== "") {
        return sanitized;
      }
    }
  }
  return sanitizeInstanceId(randomUUID());
}

let cachedInstanceId: string | null = null;

/**
 * Returns the instance id for this process, resolved once and then stable for
 * the process lifetime so start/heartbeat/stop always agree on ownership.
 */
export function getOrchestratorInstanceId(
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (cachedInstanceId === null) {
    cachedInstanceId = resolveOrchestratorInstanceId(env);
  }
  return cachedInstanceId;
}

/** Test-only: clears the memoized instance id so resolution can be re-exercised. */
export function resetOrchestratorInstanceIdCache(): void {
  cachedInstanceId = null;
}

/**
 * Builds this instance's owned worker names. Worker concurrency semantics are
 * unchanged — `workerConcurrency` still yields exactly that many worker slots,
 * numbered 1..N; only the ownership prefix is new.
 */
export function buildOwnedWorkerNames(
  instanceId: string,
  workerConcurrency: number,
): string[] {
  return Array.from(
    { length: workerConcurrency },
    (_, index) => `${instanceId}${WORKER_NAME_DELIMITER}worker-node-${index + 1}`,
  );
}
