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
