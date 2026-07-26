# SavvyEdge Staging Deployment Checklist

- [ ] Separate staging PostgreSQL/Supabase database created & isolated
- [ ] Environment secrets configured in GitHub Actions (`STAGING_DATABASE_URL`, `STAGING_DIRECT_URL`)
- [ ] Vercel project created (`apps/admin` root directory, pnpm, Node 20)
- [ ] Vercel staging environment variables configured (`ADMIN_JWT_SECRET`, `INTERNAL_API_SECRET`, `NEXT_PUBLIC_APP_ENV=staging`)
- [ ] `Deploy Staging Database Migrations` workflow (`.github/workflows/staging-migrate.yml`) executed & green
- [ ] Vercel staging app build & deployment green
- [ ] `GET /api/health` returns HTTP 200 `{"status":"ok","environment":"staging"}`
- [ ] First Admin account bootstrapped with explicit `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD`
- [ ] Unauthenticated access to `/review` fails closed (redirects to `/login`)
- [ ] Login & RBAC permissions verified for REVIEWER, SENIOR_REVIEWER, PUBLISHER, and ADMIN roles
- [ ] Non-destructive staging smoke test script (`smoke-test`) passed
- [ ] Rollback procedures recorded & team alerted
