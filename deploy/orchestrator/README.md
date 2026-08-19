# SavvyEdge production orchestrator

Railway must build `deploy/orchestrator/Dockerfile` with the repository root as
the Docker build context. This service runs no public HTTP server and must not
be assigned a public domain.

Production v1 supports exactly one scheduler-enabled Railway replica. Multiple
scheduler-enabled replicas are unsupported until persisted leader coordination
is implemented.

Required D4B1 scheduler profile:

```text
SAVVY_ENV=production
ORCHESTRATOR_ENABLE_WORKERS=true
ORCHESTRATOR_ENABLE_RECOVERY=true
ORCHESTRATOR_ENABLE_DISCOVERY_SCHEDULER=false
ORCHESTRATOR_ENABLE_BONUS_REVERIFICATION_SCHEDULER=true
VERIFICATION_INTERVAL_MS=900000
```

`DATABASE_URL` and the selected AI provider credentials are also required.
`SEED_SOURCES` is intentionally optional while discovery is disabled. If
discovery is enabled later, production startup fails unless explicit seeds are
provided.

The image pins the Microsoft Playwright Noble runtime to `1.61.1`, matching the
resolved repository dependency, and runs the orchestrator as the image's
unprivileged `pwuser`. Railway must send `SIGTERM` during shutdown so the
existing graceful worker and database cleanup can complete.

## Worker identity is instance-scoped

Each orchestrator process owns `WorkerNode` rows named
`<instance-id>:worker-node-<n>`, so a terminating deployment can only mark its
own workers `DEAD`. Without this, a rolling deploy's outgoing process marked the
replacement's globally named `worker-node-1..N` rows `DEAD`, and the new
deployment's heartbeat (which only touches `ACTIVE` rows) then matched nothing.

The invariant is that no two *simultaneously live* orchestrator processes share
an identity. The instance id is resolved once per process, and the most specific
per-replica identity wins:

1. `RAILWAY_REPLICA_ID` — Railway's per-replica identity, authoritative whenever
   it is present.
2. `ORCHESTRATOR_INSTANCE_ID` — explicit identity for runtimes that expose no
   per-replica id of their own. Where it is used, operators are responsible for
   keeping it distinct per live process.
3. A random UUID, when neither is present (local runs, non-Railway hosts).

`ORCHESTRATOR_INSTANCE_ID` deliberately does **not** outrank the replica id. A
static value set at Railway service or environment scope is inherited by every
replica and by both sides of a rolling deploy, so letting it win would recreate
the original collision. `RAILWAY_DEPLOYMENT_ID` is unused for the same reason —
every replica of a deployment shares it.

A `SIGKILL`ed process never marks its rows `DEAD`, and its identity is not
reclaimed by any successor, so stale `ACTIVE` rows accumulate until a future
reaper prunes them by `last_heartbeat`.
