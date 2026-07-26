# SavvyEdge Admin Staging Deployment Runbook

This runbook documents the step-by-step procedure for deploying the **SavvyEdge Admin Governance Console (`apps/admin`)** to a staging environment hosted on **Vercel** backed by a separate **Supabase / PostgreSQL staging database**.

---

## 1. Prerequisites

- Access to the GitHub repository: `n8y27ygwrm-boop/savvyedge`
- Vercel account with project creation permissions
- Supabase account (or dedicated PostgreSQL staging host)
- Installed CLI tools: `pnpm`, `git`, `node` (v20)

---

## 2. Separate Staging Database Setup

1. Create a new isolated Supabase project named `savvyedge-staging`.
2. Retrieve database connection strings from Supabase Project Settings -> Database:
   - **`DATABASE_URL`**: Pooled connection string (port `6543`, transaction mode).
   - **`DIRECT_URL`**: Direct connection string (port `5432`, session mode for migrations).
3. Confirm this database is completely separate from local development, CI test databases, and production data.

---

## 3. Vercel Project Setup (`apps/admin`)

1. Log into Vercel and click **Add New... -> Project**.
2. Import the `savvyedge` repository.
3. Configure project settings:
   - **Framework Preset**: Next.js
   - **Root Directory**: `apps/admin`
   - **Build Command**: `pnpm --filter admin run build`
   - **Install Command**: `pnpm install --frozen-lockfile`
   - **Node.js Version**: `20.x`
4. Add Staging Environment Variables in Vercel Project Settings:
   - `DATABASE_URL`: `postgresql://...` (Pooled connection)
   - `DIRECT_URL`: `postgresql://...` (Direct connection)
   - `NEXT_PUBLIC_APP_ENV`: `staging`
   - `SAVVY_ENV`: `staging`
   - `ADMIN_JWT_SECRET`: `<64-character-random-hex-string>`
   - `INTERNAL_API_SECRET`: `<secure-random-internal-api-secret>`

---

## 4. GitHub Staging Environment & Secrets

1. Navigate to GitHub Repository Settings -> **Environments** -> **New environment**: `staging`.
2. Add Environment Secrets under `staging`:
   - `STAGING_DATABASE_URL`: Staging pooled connection string
   - `STAGING_DIRECT_URL`: Staging direct connection string

---

## 5. Deployment Order & Staging Execution

Always follow this exact deployment sequence:

### Step A: Database Backup / Checkpoint
Create a manual backup/snapshot in Supabase before applying new migrations.

### Step B: Execute Staging Database Migrations
1. In GitHub Actions, navigate to **Deploy Staging Database Migrations** (`.github/workflows/staging-migrate.yml`).
2. Click **Run workflow** -> Select `main` branch -> **Run workflow**.
3. Confirm that `db:validate`, `db:migrate:status`, and `prisma migrate deploy` complete with green status.

### Step C: Deploy Admin Application to Vercel
1. Trigger a deployment on Vercel (or push to `main` if automatic preview/staging deployments are enabled).
2. Wait for Next.js build and Vercel edge deployment to complete.

### Step D: Execute Health & Readiness Verification
Run the non-destructive smoke-test script against the deployed staging URL:
```bash
STAGING_BASE_URL="https://admin-staging.savvyedge.com" pnpm --filter admin run smoke-test
```

### Step E: Bootstrap First Staging Administrator (If No Admin Exists)
Run the hardened bootstrap script supplying explicit staging environment variables:
```bash
SEED_ADMIN_EMAIL="admin-staging@savvyedge.com" \
SEED_ADMIN_PASSWORD="ReplaceWithSecureStagingPassword123!" \
SEED_ADMIN_NAME="Staging Administrator" \
DATABASE_URL="<STAGING_DATABASE_URL>" \
DIRECT_URL="<STAGING_DIRECT_URL>" \
pnpm --filter admin run bootstrap:admin
```

---

## 6. Log Inspection & Troubleshooting

- **Vercel Runtime Logs**: Inspect Vercel Project Dashboard -> **Logs** for HTTP 500 errors or unhandled server exceptions.
- **Health Check Endpoint**: Query `GET /api/health` on the staging host. It will return `{"status": "ok", "environment": "staging", "timestamp": "..."}` when the database is connected.

---

## 7. Rollback Procedure

### Application Rollback
- In Vercel Dashboard -> **Deployments**, locate the previous successful deployment and click **Promote to Production / Instant Rollback**.

### Database Rollback
- **DO NOT** run destructive SQL `down` migrations or `prisma db push` in staging.
- Restore the Supabase point-in-time backup or apply a reviewed forward-fix migration via a new PR.

---

## 8. Known Limitations

- Inline CSS styling in prototype components currently prevents strict `Content-Security-Policy` header enforcement without nonces. Standard security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`) are active.
