# SavvyEdge Engineering OS

### The Technical Constitution of the Company

*Companion document to the SavvyEdge Brain. Every technical decision below must serve the Brain's core thesis: the affiliate site is a distribution channel for a proprietary, structured, historically-tracked dataset that becomes a B2B SaaS product. Nothing here should optimize for "a website" — it optimizes for a data platform with one public-facing client.*

---

## 1\. Technical Vision

**Five-year evolution:**

- **Year 1:** A single Postgres-backed data platform with one client (the public SEO/affiliate site), built almost entirely with managed services and AI-assisted development by one founder.  
- **Year 2–3:** The same schema starts serving a second client — an internal competitive-intelligence dashboard used to validate the B2B thesis with a handful of pilot operators, still on the same database, same API layer.  
- **Year 4–5:** A public API and enterprise dashboard become first-class products; the affiliate site becomes just one of several data consumers rather than the center of the system.

**Engineering philosophy:** Build one data platform with many clients, not many one-off projects. Every feature request should be answered first with "does this belong in the schema/API layer, or only in the presentation layer?" — the schema/API layer is permanent infrastructure; presentation layers are disposable and should be built fast, cheaply, and replaced without fear.

**What should never be sacrificed:**

1. **Data provenance** — every record must trace back to a source and a timestamp. This is non-negotiable even under deadline pressure, because it's the entire B2B value proposition.  
2. **Single source of truth** — one canonical database, never duplicated data models per feature. Duplication here is the single fastest way for a solo founder's system to become unmaintainable.  
3. **AI-legibility** — the codebase, schema, and docs must stay simple and well-documented enough that an AI coding assistant with no memory of yesterday's session can safely work in it today. This is a harder constraint than "readable to a human," and it should be treated as the primary audience for internal documentation.

---

## 2\. System Architecture

                          ┌─────────────────────────┐

                          │   Data Sources Layer     │

                          │  (scrapers, APIs, feeds) │

                          └────────────┬─────────────┘

                                       │

                          ┌────────────▼─────────────┐

                          │      AI Ingestion Layer   │

                          │ (parse → structure → QA)  │

                          └────────────┬─────────────┘

                                       │

                          ┌────────────▼─────────────┐

                          │      Data Layer (Postgres)│

                          │  Canonical schema \+ history│

                          └──┬──────────────┬─────────┘

                             │              │

                 ┌───────────▼───┐   ┌──────▼────────────┐

                 │   API Layer    │   │  Search / Cache    │

                 │ (REST, typed)  │   │ (Postgres FTS/     │

                 │                │   │  Meilisearch, Redis)│

                 └───┬────────┬───┘   └────────┬───────────┘

                     │        │                │

        ┌────────────▼─┐  ┌──▼────────────┐ ┌──▼─────────────┐

        │ Public Site   │  │ Admin/Ops     │ │ Future: Public  │

        │ (Next.js, SSR)│  │ Dashboard     │ │ API \+ Enterprise│

        │               │  │               │ │ Dashboard       │

        └───────────────┘  └───────────────┘ └─────────────────┘

**Frontend:** Next.js (React) — server-rendered for SEO-critical pages, statically generated where data changes infrequently, incrementally revalidated where it doesn't. One codebase serves the public site; the future dashboard is a separate Next.js app sharing the same design system and API client.

**Backend:** A typed API layer (Node/TypeScript) sitting directly in front of Postgres — not a sprawling microservice mesh. At solo-founder scale, a well-organized modular monolith is dramatically more maintainable and AI-assistant-friendly than distributed services; split into services only when a specific module (e.g., the scraping/ingestion pipeline) has genuinely different scaling or deployment needs.

**AI Layer:** A dedicated ingestion/enrichment pipeline (see Section 7\) that sits between raw scraped data and the canonical database — this is the layer that turns "a scraped HTML page" into "a structured, validated, sourced database record." This layer is the actual product; everything else is presentation.

**Data Layer:** PostgreSQL as the single canonical store — chosen over a NoSQL/document store specifically because the long-term value is relational (casinos → bonuses → wagering terms → historical changes; slots → providers → RTP history) and because Postgres gives full-text search, JSONB flexibility, and strong consistency in one engine, minimizing the number of systems a solo founder must operate.

**Infrastructure:** Managed-everything — a PaaS for compute (Vercel or Railway), a managed Postgres (Supabase or Neon), managed object storage (Cloudflare R2 or S3), managed queue (Postgres-based queue like Graphile Worker, or a managed service like Upstash) — see Section 3 for full reasoning.

**Storage:** Object storage for media (images, generated video, scraped screenshots/PDFs), Postgres for everything structured. Never store binary blobs in Postgres.

**Authentication:** Managed auth (Clerk or Supabase Auth) for both internal admin users and future B2B customers — never hand-roll auth.

**Caching:** Redis (or Upstash's serverless Redis) for hot-path caching (rendered page fragments, API responses, rate-limit counters) — introduced only once real traffic justifies it, not on day one.

**Search:** Postgres full-text search initially (zero additional infrastructure); migrate to a dedicated engine (Meilisearch or Typesense) only once query complexity or volume genuinely requires it — resist adding Elasticsearch-class complexity prematurely.

**Analytics:** Product analytics (PostHog, self-hostable later if needed) separate from the core business database — analytics events should never live in the same schema as canonical business data.

**Logging/Monitoring:** Centralized structured logging (e.g., Axiom or Better Stack) plus error tracking (Sentry) from day one — cheap, managed, and essential for a solo founder debugging without a team.

**File Storage / Media Pipeline:** Object storage \+ a queue-driven processing pipeline for AI-generated images/video (see Product Modules) — never process media synchronously in the request path.

**Deployment:** Git-push-to-deploy on a managed platform (Vercel for the Next.js apps; Railway or Render for any long-running workers) — no self-managed Kubernetes, no self-managed servers, until scale genuinely demands it (it likely never will at this business's realistic scale).

**API Layer:** A single typed REST API is the contract between the database and every client (public site, admin dashboard, future public API, future enterprise dashboard) — this is the architectural decision that makes "the affiliate site is just one client" literally true in code, not just in strategy.

**Future SaaS Layer:** Designed in from day one as an API-key-authenticated, rate-limited superset of the same API used internally — the public API is not a separate system to be built later, it's the existing internal API with auth, quotas, and billing bolted on.

---

## 3\. Recommended Tech Stack

| Layer | Recommendation | Why | Alternatives Considered | Cost Profile |
| :---- | :---- | :---- | :---- | :---- |
| Frontend framework | **Next.js (React, TypeScript)** | Best-in-class SEO (SSR/ISR), huge AI-training-data footprint (coding assistants know it deeply), single framework for public site \+ future dashboards | Astro (better for pure static content, weaker for dashboards); Remix (strong but smaller AI-assistant familiarity) | Free (self-hosted) / Vercel free-to-low tier at this scale |
| Hosting | **Vercel** | Zero-config Next.js deploys, preview URLs per PR (critical for AI-assisted iteration), generous free tier | Netlify (comparable, slightly weaker Next.js integration); self-hosted (rejected — maintenance burden) | Free → \~$20/mo as traffic grows |
| Database | **PostgreSQL via Supabase or Neon** | Relational integrity for a genuinely relational domain; Supabase adds auth/storage/realtime for free; Neon adds serverless branching (a full copy of prod schema per feature branch — extremely valuable for AI-assisted schema changes) | MongoDB (rejected — the domain is relational, not document-shaped); PlanetScale/MySQL (viable, but weaker JSONB/full-text support) | Free tier covers Year 1 easily; \~$25–69/mo at real scale |
| ORM | **Prisma** | Best-in-class TypeScript type generation from schema, extremely well understood by AI coding assistants, strong migration tooling | Drizzle (lighter, faster, growing fast — worth revisiting in 12 months) | Free |
| Auth | **Clerk** (or Supabase Auth if already on Supabase) | Managed, handles B2C and future B2B org/team accounts out of the box, minimal code | Auth0 (pricier at scale); NextAuth/hand-rolled (rejected — auth is not a place to save money by DIY-ing) | Free tier → usage-based |
| Object storage | **Cloudflare R2** | S3-compatible API, zero egress fees (critical for a media-heavy SEO site serving lots of images) | AWS S3 (higher egress cost); Supabase Storage (fine at small scale, less cost-efficient at media volume) | Pennies at this scale; egress-free is the deciding factor |
| Background jobs / queue | **Graphile Worker** (Postgres-native) initially → **Inngest** or **Trigger.dev** as complexity grows | Postgres-native queue means zero new infrastructure to run scrapers/enrichment jobs on a schedule; Inngest/Trigger.dev add durable, observable, AI-agent-friendly workflows once pipelines get complex | Bull/BullMQ \+ Redis (adds a whole extra service earlier than needed); AWS SQS/Lambda (unnecessary complexity for this scale) | Free → low usage-based cost |
| Search | **Postgres full-text search** → **Meilisearch** later | Zero extra infra on day one; Postgres FTS is genuinely sufficient for tens of thousands of records | Algolia (excellent but pricey at scale); Elasticsearch (too heavy operationally for a solo founder) | Free → \~$0–30/mo self-hosted Meilisearch when needed |
| Cache | **Upstash Redis** (serverless) | Pay-per-request, zero server management, integrates cleanly with Vercel edge functions | Self-hosted Redis (rejected — unnecessary ops burden) | Free tier → cents |
| AI/LLM layer | **Anthropic Claude (API) as primary**, with a provider-abstraction layer so models are swappable | Best-in-class for structured extraction, long-context parsing of scraped pages, and content generation that must follow strict brand/data rules | OpenAI, Gemini as fallback/comparison models — architecture should never hard-lock to one vendor | Usage-based |
| Scraping infrastructure | **Managed scraping API** (e.g., Bright Data, ScraperAPI, or similar) rather than self-hosted headless browsers | Removes proxy/CAPTCHA/anti-bot maintenance entirely — this is exactly the kind of "constant maintenance" the founder should not own | Self-hosted Playwright/Puppeteer fleet (rejected as a primary strategy — high maintenance, fragile, exactly the DevOps burden to avoid; acceptable only as a narrow fallback for specific sources) | Usage-based, scales with data volume |
| Monitoring/errors | **Sentry** (errors) \+ **Better Stack or Axiom** (logs) | Managed, cheap, essential visibility for a one-person team | Self-hosted ELK (rejected — ops burden) | Free tier → low cost |
| Analytics | **PostHog** | Product analytics \+ feature flags \+ session replay in one tool, generous free tier, self-hostable later if data ownership becomes a concern | Google Analytics (weaker for product/funnel analysis); Mixpanel (comparable, pricier) | Free tier covers Year 1–2 |
| CI/CD | **GitHub Actions** | Free for reasonable usage, tightly integrated with the repo, trivial to wire AI-assisted PR checks into | GitLab CI, CircleCI (no compelling advantage here) | Free at this scale |

**Overall stack philosophy:** Every choice above optimizes for "runs itself" over "runs fastest" or "runs cheapest at hyperscale" — this company will never be bottlenecked by infrastructure cost or raw performance in years 1–3; it will only be bottlenecked by founder time. Every recommendation reflects that.

---

## 4\. Repository Architecture

**Monorepo vs Polyrepo: Monorepo.** For a solo founder using AI coding assistants across frontend, backend, and data pipelines, a single repository with shared types and shared context is dramatically more effective — an AI assistant working across the API and the frontend in the same session can see both, and shared types (via a `packages/types` package generated from the Prisma schema) prevent drift that would otherwise require constant manual synchronization across repos.

savvyedge/

├── apps/

│   ├── web/                 \# Public Next.js site (the affiliate/SEO client)

│   ├── admin/                \# Internal ops/admin dashboard

│   └── dashboard/            \# (Phase 7+) Enterprise B2B dashboard

├── packages/

│   ├── database/             \# Prisma schema, migrations, seed scripts

│   ├── api/                  \# Shared API layer (REST handlers, business logic)

│   ├── types/                 \# Generated/shared TypeScript types

│   ├── ui/                    \# Shared design-system components

│   ├── ai-agents/             \# Ingestion/enrichment/content agents (Section 7\)

│   └── config/                 \# Shared eslint/tsconfig/tailwind config

├── docs/

│   ├── brain.md               \# The SavvyEdge Brain (imported, not duplicated)

│   ├── engineering-os.md      \# This document

│   ├── schema.md               \# Living data-model documentation

│   └── agents/                  \# Per-agent operating docs (Section 7\)

├── .github/workflows/           \# CI/CD

└── turbo.json                    \# Turborepo pipeline config

**Tooling:** Turborepo for monorepo task orchestration (build/test/lint caching across packages) — chosen over Nx for simplicity; Nx is more powerful but has a steeper learning curve that isn't justified at this team size.

**Naming conventions:** `kebab-case` for files/folders, `PascalCase` for components, `camelCase` for functions/variables, database tables in `snake_case` (Postgres convention) mapped to `camelCase` in Prisma/TypeScript automatically.

**Documentation:** `docs/` is treated as a first-class part of the repo, not an afterthought — every new module ships with a corresponding doc update in the same PR, enforced by a lightweight CI check (see Section 8).

---

## 5\. Backend Architecture

**Services vs. Modules:** A modular monolith, not microservices. Organize by domain module (Casinos, Slots, Bonuses, Providers, Search, Ingestion), not by technical layer — each module owns its controllers, business logic, and schema slice, but all run in one deployable API service until a specific module has a genuinely distinct scaling profile (the scraping/ingestion pipeline is the most likely first candidate to split out, because it runs on schedules rather than serving requests).

**Business Logic:** Lives in a `services/` layer per module, called by thin controllers — controllers only handle HTTP concerns (parsing, validation, response shaping); no business logic in route handlers, ever. This separation matters enormously for AI-assisted development because it lets an assistant safely modify business logic without touching HTTP wiring, and vice versa.

**Controllers:** Thin, one per resource, delegate immediately to services.

**Schemas/Validation:** **Zod** for all input/output validation, shared between frontend and backend via the monorepo's `types` package — a single schema definition drives both runtime validation and TypeScript types, eliminating an entire class of drift bugs.

**Background Jobs / Workers:** All scraping, enrichment, and scheduled data-refresh work runs as background jobs, never inline in a request — request/response cycles are strictly for reads and light writes.

**Queues:** Postgres-native queue (Graphile Worker) for Year 1 simplicity; graduate to Inngest/Trigger.dev when multi-step, retryable, observable AI-agent workflows (scrape → parse → validate → publish) outgrow a simple queue.

**Event System:** A lightweight internal event bus (even just Postgres `LISTEN/NOTIFY` initially) for cross-module reactions (e.g., "bonus updated" triggers both a search-index refresh and a historical-record write) — avoid a heavyweight event-streaming platform (Kafka etc.) until data volume genuinely requires it, which is unlikely in years 1–3.

**API Standards:** REST, resource-oriented, consistent envelope (`{ data, meta, error }`), documented in Section 9\.

**Versioning:** URL-based versioning (`/api/v1/...`) from day one, even with only one version — retrofitting versioning later is far more painful than including it from the start.

**Error Handling:** A single centralized error-handling middleware producing consistent error shapes; domain errors are typed (`NotFoundError`, `ValidationError`, `RateLimitError`) rather than generic exceptions, so both humans and AI assistants can reason about failure modes predictably.

**Logging:** Structured JSON logs (never plain strings) with request IDs threaded through, shipped to the centralized log service.

**Testing:** Unit tests for business logic (services), integration tests for API endpoints against a real (branched/ephemeral) Postgres instance, and a small set of end-to-end tests for critical user flows on the public site — prioritize integration tests over exhaustive unit coverage at this stage, since they catch the most real bugs per hour invested.

---

## 6\. Database Architecture

**Core entities:**

Casino

 ├── id, slug, name, license\_info, status, website\_url

 ├── created\_at, updated\_at, verified\_at

 └── has many: CasinoBonus, CasinoReview, CasinoHistoryEvent

Provider (slot/game provider)

 ├── id, slug, name, website\_url

 └── has many: Slot

Slot

 ├── id, slug, name, provider\_id (FK)

 ├── rtp\_current, volatility, max\_win, release\_date

 └── has many: SlotRtpHistory

SlotRtpHistory

 ├── id, slot\_id (FK), rtp\_value, recorded\_at, source\_url

Bonus

 ├── id, casino\_id (FK), type (welcome/reload/free-spins/…)

 ├── headline\_value, wagering\_requirement, max\_conversion

 ├── true\_value\_score (calculated — the "Information Gain" field)

 ├── valid\_from, valid\_until, status

 └── has many: BonusHistoryEvent

BonusHistoryEvent

 ├── id, bonus\_id (FK), field\_changed, old\_value, new\_value, changed\_at, source\_url

CasinoHistoryEvent

 ├── id, casino\_id (FK), event\_type, description, occurred\_at, source\_url

Review

 ├── id, casino\_id (FK), author\_type (ai/human), content, rating

 ├── methodology\_version, published\_at, last\_verified\_at

DataSource

 ├── id, url, source\_type, last\_scraped\_at, reliability\_score

ScrapeJob

 ├── id, data\_source\_id (FK), status, started\_at, completed\_at, error\_log

**Relationships:** Casino → Bonuses (1:many), Casino → HistoryEvents (1:many), Provider → Slots (1:many), Slot → RtpHistory (1:many), Bonus → BonusHistoryEvent (1:many) — every mutable, business-critical field (RTP, bonus terms, casino status) has a corresponding `*HistoryEvent`/`*History` table. **This is the single most important schema decision in the entire platform** — it is what turns "a casino review site" into "a historical dataset," which is the entire B2B thesis. Current-state tables are a read-optimized cache of the latest history-event; the history tables are the actual source of truth.

**Indexes:** B-tree indexes on all foreign keys and slugs (used in URL routing); a composite index on `(entity_id, recorded_at)` on every history table (the dominant query pattern is "show me the trend for X over time"); a GIN index on any JSONB metadata columns and on full-text search columns.

**Normalization:** Third normal form for core entities; deliberate denormalization only for read-optimized "current state" fields (e.g., `Slot.rtp_current` is a denormalized cache of the latest `SlotRtpHistory` row, updated via trigger or application logic) — this keeps hot-path reads fast without sacrificing the historical source of truth.

**Historical tracking / Versioning:** As above — every business-critical entity has a companion history table populated by an insert-only append pattern (never update history rows). This is enforced structurally, not just by convention: history tables should have no `updated_at` column and no update endpoints, only inserts.

**Audit logs:** A generic `AuditLog` table (actor, action, entity\_type, entity\_id, diff, timestamp) captures all admin/system mutations, separate from the domain-specific history tables — domain history is "what changed in the gambling data," audit log is "who/what changed it in our system."

**Soft deletes:** `deleted_at` nullable timestamp on all core entities instead of hard deletes — a casino going offline is itself a historically meaningful event, not something to be erased.

**Future scalability:** The schema as designed can comfortably scale to hundreds of thousands of records on a single well-indexed Postgres instance; when/if true horizontal scaling is needed (unlikely before very significant B2B traction), the natural partition boundary is by entity type (Casinos/Bonuses vs. Slots/Providers), and Postgres read replicas handle the read-heavy public-site traffic long before any sharding is required.

---

## 7\. AI Architecture

Every agent below shares a common contract: **typed input → typed output, logged, retryable, and never allowed to write directly to production data without passing through validation.** Agents propose changes; a validation layer (automated \+ spot-check human review in Year 1\) commits them.

| Agent | Mission | Inputs | Outputs | Memory | Tools | Failure Handling | Trigger |
| :---- | :---- | :---- | :---- | :---- | :---- | :---- | :---- |
| **Research Agent** | Identify new casinos/slots/bonuses worth tracking | Search queries, seed lists, competitor sites | Candidate entity list with source URLs | Stateless (reads DataSource registry) | Web search, scraping API | Log and skip on ambiguous matches; never auto-create low-confidence entities | Scheduled (weekly) |
| **Scraper Agent** | Fetch raw content from tracked sources | URL, source type | Raw HTML/text \+ metadata | Stateless | Managed scraping API | Exponential backoff; mark source unreachable after N failures, alert | Scheduled per source, respecting `robots.txt` and rate limits |
| **Parser Agent** | Convert raw content into structured candidate records | Raw content, target schema | Structured JSON matching Zod schema | Stateless | LLM (Claude), schema definitions | On schema-validation failure, flag for human review rather than discard | Immediately after Scraper Agent completes |
| **Bonus Agent** | Specifically track bonus terms and calculate `true_value_score` | Parsed bonus data, wagering rules | Normalized bonus record \+ calculated score \+ diff vs. last known state | Reads BonusHistoryEvent for diffing | Calculation library, LLM for ambiguous term interpretation | If terms are ambiguous/contradictory, flag `needs_review = true`, never guess silently | Triggered by Parser Agent output for bonus-type sources |
| **Schema Agent** | Validate structured output against the canonical schema before write | Candidate record | Pass/fail \+ typed errors | Stateless | Zod schemas, Prisma client (read-only checks) | Hard block on failure — no record reaches the database without passing this agent | Every write path, no exceptions |
| **SEO Agent** | Generate/maintain metadata (titles, descriptions, schema.org markup, internal links) for published pages | Entity records | SEO metadata objects | Reads sitemap/entity graph for internal linking | LLM, internal link graph | Falls back to templated defaults if generation fails — never blocks publishing | On entity create/update |
| **Content Agent** | Draft/update review and comparison page copy following AI Writing Rules (Brain §10) | Entity data, brand style guide | Draft content object | Reads brand style guide \+ prior published content for consistency | LLM (Claude), style-guide document as system context | Drafts are never auto-published without passing Publishing Agent checks | On entity create/major update |
| **Publishing Agent** | Final gate before content goes live | Draft content, SEO metadata, schema-validated data | Publish/reject decision | Reads publishing checklist rules | Rule engine \+ LLM QA pass | Reject with specific reason code; queue for human review if rejected twice | After Content \+ SEO Agents complete |
| **Video Agent** | (Phase 5\) Generate short explainer/review video assets from structured data | Entity data, video template | Rendered video file → object storage | Stateless | Video generation API, template engine | Falls back to static image asset if generation fails | On-demand / scheduled for top-traffic entities |
| **Analytics Agent** | Summarize traffic/conversion/data-freshness metrics into digestible reports | Analytics events, database state | Structured report (JSON \+ rendered summary) | Reads prior reports for trend comparison | PostHog API, database queries | Never blocks — analytics failures are logged, not escalated urgently | Daily/weekly schedule |
| **Monitoring Agent** | Watch data freshness and pipeline health | ScrapeJob logs, DataSource `last_scraped_at` | Alerts (stale source, failed pipeline, anomalous data change) | Reads recent job history | Alerting integration (e.g., Slack/email webhook) | Escalates via alert; never auto-remediates | Continuous/scheduled |
| **Decision Agent** | (Later phase) Recommend prioritization — which sources/entities to refresh or expand next based on traffic \+ staleness \+ business value | Analytics \+ freshness \+ Brain's Decision Framework | Ranked recommendation list | Reads Analytics \+ Monitoring Agent outputs | Internal reasoning only (no external tools) | Advisory only — never auto-executes; a human (the founder) approves | Weekly |

**Prompt strategy (shared across content-generating agents):** Every generation prompt is composed from three layers, always in this order: (1) the SavvyEdge Brain's brand/writing rules as system context, (2) the specific structured data for the entity being written about, (3) the specific task instruction. This ordering ensures brand consistency is never dependent on the task-writer remembering to include it — it's structurally always present.

---

## 8\. Development Standards

**Coding conventions:** TypeScript strict mode everywhere, no `any` without an explicit justifying comment, Prettier \+ ESLint enforced via pre-commit hook and CI (not just editor config).

**Naming conventions:** See Section 4\. Additionally: booleans prefixed `is`/`has`/`should`; async functions that fetch data prefixed `get`/`fetch`; functions that mutate prefixed `create`/`update`/`delete`.

**Commit standards:** Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`) — this is not bureaucracy, it's what lets an AI assistant (or the founder six months later) understand repo history at a glance and auto-generate changelogs.

**Branch strategy:** Trunk-based with short-lived feature branches; every branch gets an automatic preview deployment (Vercel) — critical for AI-assisted iteration, since the founder should be able to see a live preview of any AI-generated change before merging.

**Code review standards:** Solo founder means self-review, but treat every PR as if a reviewer will read it: a PR description explaining *why*, not just *what*; screenshots for UI changes; a note on which doc was updated. This discipline is what keeps AI-assisted output legible over time.

**Documentation standards:** Every module has a `README.md` describing its purpose, key entities, and how it fits the overall architecture — written for "an AI assistant with no prior context," which also happens to be the most useful format for a returning human.

**Prompt engineering standards:** All agent prompts live as versioned files in `packages/ai-agents/prompts/`, not inline strings scattered through code — prompts are treated as configuration, reviewed and versioned like code, never edited ad hoc in production.

**AI pair-programming workflow:** For any non-trivial change: (1) state the goal and constraints explicitly to the assistant, (2) point it at the relevant doc (Brain, this Engineering OS, or the specific module README) rather than re-explaining context each time, (3) review the diff against the Decision Framework (Brain §14) before merging, (4) update docs in the same PR if the change affects architecture.

---

## 9\. API Design

**REST standards:** Resource-oriented URLs (`/api/v1/casinos`, `/api/v1/casinos/:slug/bonuses`), standard HTTP verbs, consistent JSON envelope:

{ "data": {}, "meta": { "page": 1, "total": 240 }, "error": null }

**Future GraphQL considerations:** Not recommended before the Public API phase (Phase 8\) — REST is simpler to secure, rate-limit, and document for external B2B consumers, and internal clients don't yet have the query-flexibility needs that would justify GraphQL's added complexity. Revisit only if enterprise customers specifically request flexible querying.

**Authentication:** Session-based (via Clerk) for the internal admin dashboard; API-key-based (scoped, rate-limited) for the future public API — both validated through the same middleware layer so authorization logic isn't duplicated.

**Pagination:** Cursor-based pagination for all list endpoints (not offset-based) — offset pagination degrades badly and produces inconsistent results under concurrent writes, which will matter once bonus/RTP data is updating frequently.

**Filtering/Sorting:** Query-param based (`?rtp_min=96&sort=-rtp_current`), validated against an explicit allow-list per endpoint (never pass raw query params to the database layer).

**Rate limiting:** Token-bucket rate limiting at the API gateway level (Upstash Redis-backed), tiered by auth type (generous for internal clients, metered/tiered for future external API keys — this is literally the future billing mechanism for the B2B product).

**Error responses:** Consistent error shape (`{ error: { code, message, details } }`) with typed error codes matching the backend's domain error types (Section 5).

**Versioning:** `/api/v1/` from day one (Section 5); breaking changes require a new version path, never in-place breaking changes to a live version once any external consumer exists.

**Documentation:** OpenAPI spec generated from the Zod schemas (via `zod-to-openapi` or similar) — documentation-as-code, never hand-maintained separately from the implementation, which would inevitably drift.

---

## 10\. Infrastructure

**Simplest possible cloud architecture:** Vercel (frontend \+ API routes) \+ Supabase or Neon (Postgres) \+ Cloudflare R2 (object storage) \+ Upstash (Redis/queue primitives) \+ a managed background-job runner (Trigger.dev/Inngest once needed). No servers to patch, no containers to orchestrate, no Kubernetes.

**Deployment strategy:** Git-push-to-deploy with automatic preview environments per branch and automatic production deploy on merge to `main`, gated by CI (lint, typecheck, tests) passing.

**Secrets management:** Platform-native secret stores (Vercel Environment Variables, Supabase/Neon connection secrets) — never committed to the repo, never shared over chat/email; a `.env.example` documents required variables without values.

**Backups:** Automated daily Postgres backups (built into Supabase/Neon) with point-in-time recovery enabled — verify restore procedure at least once at launch, not only when a disaster happens.

**Monitoring:** Sentry for errors, Better Stack/Axiom for logs, a simple uptime monitor (Better Stack or UptimeRobot) on the public site and API — cheap, managed, sufficient for this scale.

**Security:** HTTPS everywhere (default on all recommended platforms), least-privilege database roles (the API uses a role that cannot drop tables), dependency scanning via GitHub Dependabot, and secrets never exposed to client-side code (enforced by Next.js's server/client boundary conventions).

**Scaling:** Vertical scaling of the managed Postgres instance covers years of growth at this business's realistic scale; horizontal scaling (read replicas) is a config change on Supabase/Neon, not an architecture change — this is precisely why "boring managed Postgres" beats a more exotic database choice.

**Disaster recovery:** Documented runbook (in `docs/`) for: database restore from backup, redeploying from a known-good commit, and rotating credentials after a suspected leak — written once, tested once, updated whenever infrastructure changes.

---

## 11\. DevOps Philosophy

**CI/CD:** GitHub Actions running lint → typecheck → unit tests → integration tests on every PR; Vercel handles the actual deploy pipeline. No deploy reaches production without CI passing.

**Testing:** As described in Section 5 — integration tests prioritized over exhaustive unit tests at this stage; a small, high-value end-to-end suite (Playwright) covering the critical public-site paths (homepage, casino page, bonus comparison) run on a schedule against production to catch silent regressions.

**Preview Deployments:** Every branch/PR gets a live URL automatically (Vercel default) — this is the single highest-leverage DevOps practice for a solo founder using AI coding assistants, since it turns "did that AI-generated change actually work" into a 10-second visual check instead of a guess.

**Production Deployments:** Automatic on merge to `main`, with instant rollback available (Vercel's one-click rollback to any prior deployment) — no manual deployment steps, ever.

**Rollback Strategy:** Rollback the deployment first (seconds), then investigate — never debug in production while users are affected. Database migrations are written to be backward-compatible for at least one prior version (additive-first: add new columns/tables before removing old ones) so a deployment rollback never requires a simultaneous database rollback.

**Observability:** Structured logs \+ error tracking \+ uptime monitoring (Section 10\) constitute "enough" observability at this scale — resist the temptation to add a full APM/tracing platform before there's a team to operate it.

**Incident Response:** For a solo founder, "incident response" is: get an alert (Sentry/uptime monitor) → check Sentry/logs → rollback if unclear → fix forward once stable → write a one-paragraph postmortem in `docs/incidents/` so the same class of bug doesn't recur silently.

**Infrastructure as Code:** Not necessary in the traditional Terraform sense at this scale — the managed platforms' dashboards *are* the infrastructure definition, and their simplicity is a feature, not a gap. Revisit if/when infrastructure complexity genuinely grows beyond what a few managed-service dashboards can represent.

---

## 12\. Product Modules

Casino Engine ──┬── Bonus Engine ── (depends on Casino Engine)

                ├── Review Engine ── (depends on Casino Engine, Content Agent)

                └── Provider Engine ── Slot Engine ── (depends on Provider Engine)

Search Engine ── (depends on Casino, Slot, Bonus, Provider Engines — indexes their data)

Analytics Engine ── (depends on all engines — reads events, never writes business data)

Video Engine ── (depends on entity data from any engine — generates media assets)

Notification Engine ── (depends on Monitoring Agent — delivers alerts)

Dashboard Engine (admin) ── (reads/writes across all engines via the API layer)

Public API ── (Phase 8 — exposes read access across all engines, scoped by auth tier)

Enterprise Dashboard ── (Phase 7 — a specialized client of the Public API, B2B-facing)

**Casino Engine** — owns Casino entity, licensing status, `CasinoHistoryEvent`. Foundation module; nearly everything depends on it.

**Bonus Engine** — owns Bonus entity, `true_value_score` calculation, `BonusHistoryEvent`. Depends on Casino Engine (bonuses belong to casinos).

**Review Engine** — owns Review entity, methodology versioning. Depends on Casino Engine and the Content Agent.

**Provider Engine / Slot Engine** — owns Provider and Slot entities, `SlotRtpHistory`. Slot Engine depends on Provider Engine.

**Search Engine** — read-only index over the above; never a source of truth, always rebuildable from Postgres.

**Analytics Engine** — strictly read-only against business data; writes only to its own analytics-event store.

**Video Engine** — consumes structured entity data to generate media; writes only to object storage \+ a `media_asset` join table, never mutates core entities.

**Notification Engine** — consumes Monitoring Agent output; delivers alerts (Slack/email); has no write access to business data.

**Dashboard Engine (internal admin)** — the human interface for reviewing agent-flagged records, approving publishes, and manually correcting data — the "human in the loop" layer referenced throughout Section 7\.

**Public API / Enterprise Dashboard** — Phase 7–8 modules, architected from day one (Section 2, 9\) to be additive on top of the existing API rather than a rebuild.

**Dependency principle:** Data-owning engines (Casino, Bonus, Review, Provider, Slot) never depend on presentation/derivative engines (Search, Analytics, Video, Notification) — dependencies flow one direction, from derivative modules toward the canonical data modules, never the reverse. This is what keeps the core data model stable as new client surfaces (dashboard, public API) are added over time.

---

## 13\. Automation Roadmap

| Manual activity today | Automated end-state | Path to get there |
| :---- | :---- | :---- |
| Publishing a new casino/slot/bonus page | Fully automated pipeline: Research → Scraper → Parser → Schema validation → Content Agent → Publishing Agent | Build agents incrementally (Section 7); start with human-approved publishing, remove the approval gate per-entity-type only once accuracy is proven over a meaningful sample |
| SEO metadata per page | Auto-generated by SEO Agent on every entity create/update | Ship SEO Agent early (Phase 4\) — highest leverage-per-effort automation on the list |
| Schema/structured data markup | Generated programmatically from the entity's Prisma model — never hand-written | Build a single schema.org serializer per entity type once, reuse everywhere |
| Internal linking | Automatic entity-mention linking (Brain §11) | Implement as a content-rendering step, not a manual editing task |
| Media generation (images/video) | Video Agent \+ template-driven image generation triggered on entity publish | Phase 5; start with static templated images, add video once volume justifies the cost |
| Affiliate link/offer updates | Bonus Agent diffs scraped terms against current record and auto-updates non-ambiguous fields | Start with alert-only (human updates), graduate to auto-update once Bonus Agent accuracy is validated |
| Bonus monitoring for changes | Continuous Scraper \+ Bonus Agent \+ Monitoring Agent pipeline | Phase 2–3; this is core to the data-moat thesis and should be automated early, not last |
| Reporting (traffic, data freshness, revenue) | Analytics Agent generates scheduled digest reports | Phase 6; low complexity, high founder-time savings |
| Dashboard updates (admin UI reflecting new data) | Real-time via the shared API — no separate "update the dashboard" step ever exists if the dashboard is a proper API client | Architectural, not a task — solved by Section 2's design, not by a future automation project |
| AI quality checks on generated content | Publishing Agent's QA pass (Section 7\) plus periodic sampled human review | Start with 100% human review of AI content in Phase 3, reduce sampling rate as false-positive/error rate is measured and trusted |

**General principle:** Automate in the order that most directly protects data integrity and SEO velocity first (scraping, parsing, schema validation, SEO metadata), and automate judgment-heavy tasks (final publish approval, ambiguous bonus-term interpretation) last, and only after measuring the automation's error rate against human review over time.

---

## 14\. Security Model

**Authentication:** Managed (Clerk/Supabase Auth) for all human users; scoped API keys (hashed at rest, never logged in plaintext) for machine/B2B access.

**Authorization:** Role-based access control at the API layer (`admin`, `editor`, `viewer` internally; `api-consumer` tiers externally) — enforced centrally in middleware, never re-implemented per endpoint.

**Data validation:** Zod schemas validate every input at the API boundary (Section 5\) — no unvalidated data ever reaches the database layer, including data produced by AI agents (Section 7's Schema Agent is this principle applied to the ingestion pipeline specifically).

**Secrets:** Platform-native secret management only (Section 10); rotated on any suspected exposure; never embedded in client-side bundles.

**Backups:** Automated, tested restore procedure (Section 10).

**Abuse prevention:** Rate limiting (Section 9\) at both the API-key and IP level; bot/scraper detection on the public site itself (ironic but necessary — a data company's own dataset is a scraping target for competitors) via managed bot-protection (e.g., Cloudflare) in front of the public site.

**Rate limiting:** Tiered by consumer type; generous for legitimate internal/public-site traffic, strict and metered for API-key consumers (doubles as the future billing metering mechanism).

**Compliance considerations:** Regulatory requirements in gambling-adjacent content (licensing disclosures, affiliate disclosures, regional advertising restrictions, age-gating where applicable, responsible-gambling messaging) vary by jurisdiction and change over time — this system should store a `jurisdiction_rules` reference table rather than hard-coding compliance logic, so rule changes are data updates, not code deployments; treat this as a genuine engineering requirement (structured, versioned, auditable) rather than a static legal-copy afterthought, consistent with the Brain's "Data Integrity" and "Structural Transparency" values. Verify current requirements with qualified legal counsel per target market before launch — this document defines the *architecture* for compliance data, not the compliance content itself.

---

## 15\. Technical Roadmap

**Phase 1 — Foundation** *Objectives:* Monorepo scaffolded, core schema (Casino, Provider, Slot, Bonus \+ history tables) live, auth, hosting, CI/CD working end-to-end. *Milestones:* First entity created via the API and rendered on a real page in production. *Deliverables:* Repo, deployed empty-but-functional app, schema v1, CI pipeline. *Risks:* Over-engineering the schema before real data reveals its actual shape. *Dependencies:* None — this is the starting point. *Complexity:* Low–Medium.

**Phase 2 — Data Collection** *Objectives:* Research/Scraper/Parser/Schema agents operational for at least one entity type (recommend starting with Casinos \+ Bonuses, the highest-value pair). *Milestones:* First 50–100 casinos and their current bonuses live with source-verified data. *Deliverables:* Working ingestion pipeline, `DataSource`/`ScrapeJob` tracking, human-review admin UI. *Risks:* Scraping reliability/anti-bot issues; underestimate this and budget managed scraping API cost accordingly. *Dependencies:* Phase 1 schema and API. *Complexity:* Medium–High.

**Phase 3 — AI Content** *Objectives:* Content Agent \+ Publishing Agent generating review/comparison copy following Brain writing rules, with human approval gate. *Milestones:* First 100 published pages generated end-to-end with no manual copywriting. *Deliverables:* Content Agent, Publishing Agent, versioned prompt library. *Risks:* Content quality/brand-consistency drift — mitigate with the layered prompt strategy (Section 7\) and sampled review. *Dependencies:* Phase 2 data. *Complexity:* Medium.

**Phase 4 — SEO Platform** *Objectives:* SEO Agent live, programmatic page templates (comparison pages, "best X" aggregations), schema.org markup, internal linking automated. *Milestones:* Organic traffic trend line established; indexed page count scaling with entity count. *Deliverables:* SEO Agent, template system, sitemap automation. *Risks:* Thin/duplicate-content penalties if Information Gain principle (Brain §11) isn't actually enforced — treat this as a hard quality gate, not a nice-to-have. *Dependencies:* Phase 2–3. *Complexity:* Medium.

**Phase 5 — Media Automation** *Objectives:* Video Agent and templated image generation live for top-traffic entities. *Milestones:* First automated video assets published and measurably impacting engagement/rankings. *Deliverables:* Video Engine, media pipeline, object-storage integration. *Risks:* Cost-per-asset at scale — gate rollout by entity traffic value, not blanket coverage. *Dependencies:* Phase 2–4 (needs structured data and published pages to enrich). *Complexity:* Medium–High.

**Phase 6 — Competitive Intelligence** *Objectives:* Analytics \+ Monitoring \+ Decision Agents live; internal dashboards surfacing market-trend views (the first genuinely B2B-shaped internal tooling). *Milestones:* Founder can answer "what changed in the market this week" from a dashboard, not manual review. *Deliverables:* Analytics Engine, Monitoring Engine, internal trend dashboards. *Risks:* Low — this phase mostly composes existing data rather than introducing new ingestion complexity. *Dependencies:* Phases 2–5 (needs a meaningful data history to analyze). *Complexity:* Low–Medium.

**Phase 7 — B2B Dashboard** *Objectives:* External-facing Enterprise Dashboard client, org/team auth, first pilot operator customers. *Milestones:* First paying (or pilot) B2B customer actively using the dashboard. *Deliverables:* Dashboard Engine (external), billing integration, customer-facing docs. *Risks:* Product-market fit risk (business, not technical) — validate with 1–2 design-partner operators before building extensively. *Dependencies:* Phase 6 (proves the data is genuinely valuable internally first). *Complexity:* Medium–High.

**Phase 8 — Public API** *Objectives:* Rate-limited, API-key-authenticated, billed public API exposing the same data the internal system already uses. *Milestones:* First external developer/customer successfully integrates against the API. *Deliverables:* Public API docs (OpenAPI-generated), API-key management, usage-based billing. *Risks:* Support burden of external API consumers — mitigate with strong docs and clear rate-limit/error semantics (Section 9\) from day one. *Dependencies:* Phase 7 (proves demand and pricing before opening self-serve access). *Complexity:* Medium.

---

## 16\. AI Coding Constitution

### (Permanent System Instructions for Every AI Coding Assistant Working on SavvyEdge)

You are writing code for SavvyEdge — an AI-first Gambling Intelligence Platform,

not a website. Read this before generating code, and treat it as permanent context.

CODING PHILOSOPHY

\- TypeScript strict mode always. No \`any\` without a comment explaining why.

\- Business logic lives in services/, never in route handlers or React components.

\- Prefer boring, well-understood patterns over clever ones. This codebase must

  remain legible to an AI assistant with zero memory of prior sessions.

ARCHITECTURE PHILOSOPHY

\- One canonical Postgres database. Never introduce a second source of truth for

  the same entity.

\- Every mutable business-critical field must have a corresponding history table.

  If you're adding a field like \`bonus.wagering\_requirement\`, you're also adding

  \`BonusHistoryEvent\` tracking, not just the column.

\- New features are evaluated first as "does this belong in the data/API layer,

  or only in a specific client's presentation layer?" Data/API layer changes

  are permanent infrastructure; presentation layer changes are disposable.

\- Data-owning modules (Casino, Bonus, Review, Provider, Slot) never depend on

  derivative modules (Search, Analytics, Video, Notification). Dependencies

  flow one direction only.

DESIGN PHILOSOPHY

\- Follow the SavvyEdge Brain's visual and UI rules exactly (monospace for data

  figures, red/green reserved for data deltas only, sortable tables for 5+ data

  points, no casino visual clichés).

\- Every data-driven page/component must expose a "last verified" timestamp.

DOCUMENTATION PHILOSOPHY

\- Every module ships with a README written for an AI assistant with no prior

  context, not just for a human skimming it.

\- Update docs/schema.md in the same PR as any schema change. A schema change

  without a doc update is an incomplete PR.

PROMPT PHILOSOPHY (for any AI agent this code orchestrates)

\- Every content-generation prompt is composed of, in order: (1) the Brain's

  brand/writing rules, (2) structured entity data, (3) the specific task. Never

  skip layer 1 to save tokens — brand consistency depends on it being

  structurally present, not optionally remembered.

\- Agent prompts are versioned files in packages/ai-agents/prompts/, never

  inline strings.

TESTING PHILOSOPHY

\- Prioritize integration tests against a real (branched/ephemeral) database

  over exhaustive unit tests, at this stage of the company.

\- Any change to a history-table write path gets a test proving old rows are

  never mutated, only appended.

SECURITY PHILOSOPHY

\- All input validated via shared Zod schemas at the API boundary, including

  input produced by AI agents. No exceptions for "trusted" internal pipelines.

\- Least-privilege database roles. Never grant the API's database role

  destructive permissions (DROP, TRUNCATE) it doesn't need.

\- Never write secrets into code, logs, or client-side bundles.

PERFORMANCE PHILOSOPHY

\- Optimize for correctness and maintainability first at this company's current

  scale. Do not introduce caching, denormalization, or infrastructure

  complexity to solve a performance problem that hasn't been measured yet.

SCALABILITY PHILOSOPHY

\- Prefer managed services over self-hosted infrastructure by default. Only

  recommend self-hosting when a managed alternative genuinely cannot meet a

  real, current requirement — not a hypothetical future one.

\- Vertical scaling and read replicas on the managed Postgres instance are the

  correct answer to "what if we grow" for the foreseeable future. Do not

  design for a sharding/microservices future that isn't yet needed.

REFACTORING PHILOSOPHY

\- A refactor is justified when it removes duplication of a canonical concept

  (two places defining "what a valid bonus looks like") — not when it merely

  changes style.

\- Never refactor a history-table's append-only guarantee "for convenience."

  That guarantee is the company's core data asset.

DECISION FRAMEWORK (from the SavvyEdge Brain — apply when choices conflict)

1\. Automation  2\. Scalability  3\. Data ownership  4\. Speed

5\. Simplicity  6\. Long-term leverage  7\. User trust

8\. Sustainable competitive advantage

When a technical decision is ambiguous, resolve it using this order — and when

in doubt, ask: "does this decision make the historical, structured dataset more

valuable and more ownable, or does it only make today's page look better?"

The former is always the right answer at this company.  
