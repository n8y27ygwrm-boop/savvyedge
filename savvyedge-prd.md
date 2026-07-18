# SavvyEdge Product Requirements Document (PRD)

### The Product Blueprint of the Company

*Third document in the SavvyEdge trilogy — the Brain (company constitution) and Engineering OS (technical constitution) are treated as immutable and binding here. This PRD defines the first product: the public intelligence platform, built as one client of the shared data platform defined in the Engineering OS.*

---

## 1\. Executive Summary

**Product:** SavvyEdge — an AI-powered gambling intelligence platform. Version 1 is a public website that helps players make informed decisions about casinos, slots, and bonuses using structured, sourced, continuously-verified data instead of static marketing copy.

**Problem:** Every existing casino review site runs on the same broken model — paid placement dressed up as independent review, stale bonus data, no historical record of what actually changed, and no way for a player to verify a claim beyond "trust us." The result is systemic distrust of an entire content category.

**Solution:** Structure the data first, publish it as content second. Every casino, bonus, and slot is a database record with a source, a timestamp, and a change history — the website is a rendered view of that database, not a collection of hand-written articles. This makes the content simultaneously more trustworthy to players and more valuable as an asset than anything a traditional affiliate site produces.

**Why now:** Three converging factors make this the right moment: (1) AI tooling now lets a solo founder run a data-collection and content pipeline that previously required a content team, (2) AI answer engines (ChatGPT, Perplexity, Google AI Overviews) increasingly reward structured, sourced, entity-rich content over generic articles — which is exactly what this model produces natively, and (3) no incumbent in this space has built a genuinely structured, historically-tracked dataset; the category leaders are still running content-farm playbooks from a decade ago.

**Long-term opportunity:** The MVP's real output is not traffic — it's a proprietary, structured, historically-tracked dataset of the gambling industry that becomes the foundation of a B2B competitive-intelligence SaaS product sold to the operators the MVP reviews. Every MVP decision is evaluated against whether it strengthens that dataset, not just whether it looks good on the site.

---

## 2\. Product Vision

**Mission:** Give players the structured, sourced data they need to make an informed gambling decision — and give operators the market intelligence they can't get anywhere else, built from the same dataset.

**Vision:** Become the canonical, trusted data layer of the online gambling industry — the source both players and operators default to when they need the real numbers.

**North Star Metric:** **Verified Data Points Served** — the number of structured, sourced data points (bonus terms, RTP figures, casino status, historical changes) actually consumed by a user session (page view, comparison, or API call). This metric is chosen over raw traffic or pageviews because it directly measures the thing that matters for both the affiliate and future SaaS business: is the platform's structured data actually being used to make a decision. Traffic without data consumption is a vanity metric here; a smaller number of sessions that each consume more structured data points is a *better* outcome, not a worse one.

**Core Product Principles:**

1. Every claim is a data point with a source and a timestamp — never a bare assertion.  
2. The database is the product; the page is a view of it.  
3. Trust is measured, not just claimed — every page shows its own freshness and methodology.  
4. Simplicity beats feature breadth — a small set of genuinely trustworthy tools beats a large set of shallow ones.  
5. Every MVP feature must also serve the future B2B dataset — no feature exists solely for the affiliate site with zero data value.

**Success Criteria (MVP):** Organic search traffic growing month-over-month without paid acquisition; a measurable share of sessions engaging with comparison/data features (not just reading a single review); a data freshness rate (percentage of tracked entities verified within a defined SLA window, e.g. 30 days) above a defined threshold; the underlying database reaching a scale (entity count × historical depth) that would be credible to show a prospective B2B pilot customer.

---

## 3\. User Personas

### Primary: The Bonus-Hunter Comparison Shopper

**Goals:** Find the casino/bonus combination with the best real value, not just the highest headline number. **Motivations:** Maximize value, avoid being misled by wagering requirements that erase a bonus's apparent value. **Pain points:** Every site presents headline bonus amounts; almost none show *true* value after terms; no way to compare bonuses apples-to-apples across casinos. **Behavior:** Arrives via a specific search query, scans multiple sources within one session, applies personal filters (deposit amount, game preference) mentally since most sites don't let them do it explicitly. **Trust signals:** True-value calculations shown alongside headline figures; visible sourcing; absence of "exclusive"/urgency language. **Decision journey:** Search → scan 2–4 sources → (ideally) land on SavvyEdge's comparison view → filter/sort → click through to the casino. **JTBD:** "When I'm choosing where to deposit, I want to see the real value of a bonus after terms, so I can pick with confidence instead of guessing."

### Primary: The Cautious First-Time Researcher

**Goals:** Confirm a specific casino is legitimate and licensed before signing up. **Motivations:** Fear of scams; has heard stories of unlicensed or unreliable operators. **Pain points:** Licensing information is often buried or absent; review sites rarely show *when* they last checked. **Behavior:** Searches "\[Casino name\] legit" or "\[Casino name\] review," wants a fast, clear verdict. **Trust signals:** Explicit license status with source link, "last verified" date prominently placed, calm and non-promotional tone. **JTBD:** "When I'm considering a new casino, I want quick, sourced confirmation it's legitimate, so I don't risk my money on a scam."

### Primary: The Slot Enthusiast

**Goals:** Find slots matching specific criteria (RTP threshold, volatility, provider, theme) and see where to play them. **Motivations:** Optimize expected value; follows favorite providers/game mechanics. **Pain points:** RTP figures are inconsistent across sources and rarely show historical change (RTP can vary by operator/version). **Behavior:** Browses/filters rather than single-query searches; likely to return repeatedly. **Trust signals:** RTP history charts, provider-sourced figures, clear distinction between theoretical and tracked RTP. **JTBD:** "When I'm picking a slot to play, I want to see its real, current RTP and how it's trended, so I can choose games with better odds."

### Secondary: The Affiliate/Marketing Manager (Operator Side)

**Goals:** Understand how their offers compare to competitors; spot market shifts fast. **Pain points:** No efficient way to monitor competitor bonus/positioning changes at scale. **Trust signals (future dashboard):** Data freshness metrics, transparent methodology, ability to verify a data point against its source. **JTBD:** "When I'm setting our bonus strategy, I want to see how competitors are positioned right now, so I can react faster than a manual check allows." *(Full detail on this persona and its dashboard experience lives in Section 15 — Future B2B Platform.)*

---

## 4\. User Journeys

**Landing on homepage:** User arrives (organic search or direct) → sees the North Star value proposition stated plainly (data over hype) → is offered clear entry points: "Compare Bonuses," "Browse Casinos," "Browse Slots," "How We Verify Data" — no popups, no fake urgency banners.

**Searching:** User types a query into a persistent search bar (entity- and intent-aware — see Section 9\) → gets typed results (casino / slot / bonus / guide) with the entity type visibly labeled, not a flat blended list.

**Finding a casino:** User lands on or navigates to a Casino Page → sees license status \+ last-verified date above the fold → sees current bonuses, historical event timeline, and a review — every claim traceable to a source.

**Comparing bonuses:** User opens the Bonus Comparison tool → filters by casino type, deposit amount, wagering-requirement ceiling → sees a sortable table with headline value *and* calculated true value side by side (Section 10\) → clicks through to a specific casino or bonus detail.

**Reading reviews:** User opens a Review → sees AI-authorship disclosure and methodology version clearly labeled (Section 12\) → reads a structured, data-grounded verdict, not a narrative sales pitch.

**Finding slots:** User opens Slot Browse/Filter → filters by RTP range, volatility, provider → opens a Slot Page → sees current RTP, historical RTP chart, and provider/casino links.

**Returning users:** A returning user's highest-value path is checking whether a previously-viewed bonus/casino's terms have changed — this is explicitly supported via visible "changed since you last viewed" indicators where feasible, reinforcing the freshness value proposition on every return visit.

**Sharing content:** Comparison tables and data charts are the most shareable asset type (not review prose) — built to be embeddable/screenshot-friendly with visible sourcing baked into the image, so shares carry the brand's credibility signal even off-platform.

**Future dashboard users (operator-side):** Log in → see a market overview (their offers vs. tracked competitors) → drill into alerts (a competitor changed a bonus this week) → export or query via API. *(Detailed in Section 15.)*

---

## 5\. Information Architecture

Homepage

├── Casinos

│   ├── /casinos                        (browse/filter index)

│   └── /casinos/\[slug\]                 (casino detail page)

├── Bonuses

│   ├── /bonuses                        (comparison tool — primary conversion surface)

│   ├── /bonuses/\[type\]                 (e.g., /bonuses/no-deposit)

│   └── /bonuses/\[casino-slug\]/\[slug\]   (bonus detail page)

├── Slots

│   ├── /slots                          (browse/filter index)

│   ├── /slots/\[slug\]                   (slot detail page, incl. RTP history)

│   └── /providers/\[slug\]               (provider page, listing their slots)

├── Compare

│   └── /compare/\[entity-a\]-vs-\[entity-b\]   (programmatic head-to-head pages)

├── Guides

│   └── /guides/\[slug\]                  (educational, non-templated long-form content)

├── News

│   └── /news/\[slug\]                    (market/industry updates — feeds the "freshness" narrative)

├── Tools

│   ├── /tools/true-bonus-value-calculator

│   └── /tools/rtp-lookup

├── Search

│   └── /search?q=…                     (unified entity-aware search)

├── Methodology

│   └── /methodology                    (how data is sourced/verified — critical trust page)

├── Account (future)

│   └── /account                        (saved comparisons, alerts — post-MVP)

├── Dashboard (future — separate app per Engineering OS §4)

│   └── dashboard.savvyedge.com

└── API (future)

    └── developers.savvyedge.com

**Design rationale:** The IA is entity-first (Casinos/Bonuses/Slots/Providers as top-level sections, each with a consistent detail-page pattern), not content-type-first (no generic "Blog" or "Articles" catch-all) — this mirrors the underlying database schema directly (Engineering OS §6), which is what makes the site scale programmatically as the dataset grows, and what keeps every page's URL/structure predictable for both users and search engines.

---

## 6\. Product Modules

| Module | Purpose | Business Value | Dependencies | Future Expansion | Priority |
| :---- | :---- | :---- | :---- | :---- | :---- |
| **Casino Directory** | Structured, browsable, filterable casino database with license/status tracking | Core trust surface; primary affiliate conversion driver | None (foundational) | Operator self-service claim/verify listings | P0 |
| **Bonus Comparison Engine** | True-value-adjusted bonus comparison across casinos | Highest-intent conversion surface; core differentiator vs. competitors | Casino Directory | Personalized filtering (saved preferences), alerts on bonus changes | P0 |
| **Slot & Provider Database** | RTP-tracked slot catalog with historical charts | Secondary but high-volume SEO/traffic driver; strong data-moat asset (RTP history is hard to replicate) | Provider Engine | Volatility/theme-based recommendation engine | P0 |
| **Review Engine** | AI-generated, methodology-labeled casino/slot reviews | SEO content depth; trust-building | Casino/Slot Directory, Content Agent | User-submitted review signals (future, heavily moderated) | P1 |
| **Comparison Pages (programmatic)** | Head-to-head entity comparison pages | High-intent SEO capture (long-tail "X vs Y" queries) | Casino/Bonus/Slot modules | Auto-expand to Provider vs Provider, Bonus-type vs Bonus-type | P1 |
| **Search** | Entity-aware unified search | Reduces bounce, improves discovery | All entity modules | Semantic/AI-assisted search (Section 9\) | P1 |
| **Methodology/Trust Center** | Public explanation of sourcing, verification, disclosure | Foundational trust infrastructure — not optional | None | Public data-freshness dashboard (transparency flex) | P0 |
| **Guides/Educational Content** | Non-templated long-form content (how wagering requirements work, etc.) | Builds topical authority, supports EEAT | None | Interactive calculators/tools embedded in guides | P2 |
| **Tools (calculators)** | True Bonus Value calculator, RTP lookup | Differentiated, linkable, shareable utility | Bonus/Slot modules | Personalized "which bonus is best for me" recommender | P1 |
| **Account/Alerts (future)** | Saved comparisons, change alerts | Retention driver; sets up the notification infrastructure future B2B users will also need | Notification Engine (Engineering OS §12) | Full user profile, preference-driven recommendations | P2 (post-MVP) |
| **Enterprise Dashboard (future)** | B2B competitive-intelligence interface | The actual long-term business | Requires Phase 6+ maturity of all modules above | Full SaaS product suite | P3 (post-MVP, Phase 6-7) |

---

## 7\. Functional Requirements

*(Representative detail for the P0 modules; full spec for every module follows the same pattern and should be expanded in module-specific tickets as build begins.)*

### Casino Directory

- **Features:** Browse/filter (license jurisdiction, status, launch year), detail page (license info, current bonuses, history timeline, review).  
- **Inputs:** Structured Casino records from the ingestion pipeline (Engineering OS §7).  
- **Outputs:** Rendered index and detail pages; structured data (schema.org `Organization`/`Review`) for search engines.  
- **Validation rules:** A casino cannot be published without a verified license status and at least one sourced data point beyond its name/URL.  
- **Business rules:** Casinos with expired/revoked licenses are flagged prominently, never silently delisted (a delisted-without-explanation casino looks like a data gap, not a finding — the flag itself is the value).  
- **Success conditions:** Page renders with current data, correct "last verified" timestamp, no broken affiliate links.  
- **Edge cases:** Casino with no current bonuses (show empty state, not an error); casino under active regulatory investigation (a specific, prominent flag state — this is exactly the kind of event `CasinoHistoryEvent` exists to capture).

### Bonus Comparison Engine

- **Features:** Filterable/sortable table (deposit amount, wagering requirement ceiling, bonus type), true-value calculation shown per row, click-through to casino/bonus detail.  
- **Inputs:** Structured Bonus records \+ calculated `true_value_score` (Engineering OS §6).  
- **Outputs:** Sortable comparison table (default sort: true value, not headline value — this default is itself a trust statement).  
- **Validation rules:** A bonus with `needs_review = true` (Engineering OS §7, Bonus Agent) is excluded from default comparison views until reviewed, never shown with a guessed value.  
- **Business rules:** Expired bonuses are removed from active comparison but remain queryable in history.  
- **Success conditions:** Every visible bonus has a current true-value score and a "last verified" date.  
- **Edge cases:** Two casinos with mathematically identical true value (tie-break by data freshness, most-recently-verified first); a bonus with contradictory terms across sources (flagged, excluded from ranking, shown with an explicit "terms unclear — verify directly" notice rather than silently picking one interpretation).

### Slot & Provider Database

- **Features:** Browse/filter (RTP range, volatility, provider, theme), detail page with RTP history chart.  
- **Inputs:** Structured Slot \+ `SlotRtpHistory` records.  
- **Outputs:** Rendered pages \+ chart visualizations (Brain §8 chart standards).  
- **Validation rules:** RTP figures must cite a source (provider certification, regulatory filing, or named third-party testing lab) — never published as an unsourced number.  
- **Business rules:** When multiple sources disagree on a slot's RTP, show the range and each source, not a single averaged/guessed figure.  
- **Success conditions:** Chart renders correctly with at least one historical data point beyond the current value once tracking has run for one cycle.  
- **Edge cases:** Newly-released slot with no historical RTP yet (show "tracking started \[date\]" rather than an empty chart).

---

## 8\. Non-Functional Requirements

- **Performance:** Core Web Vitals green across all templated page types (LCP \< 2.5s, CLS \< 0.1) — directly affects both SEO ranking and the "fast/trustworthy" brand promise.  
- **Scalability:** Architecture (Engineering OS §2, §6) supports growth from hundreds to tens of thousands of entities without redesign.  
- **Security:** Per Engineering OS §14 — validated input, least-privilege access, no client-exposed secrets.  
- **Accessibility:** WCAG AA minimum (Brain §8) — also improves machine/AI-search readability, a genuine dual-purpose requirement here.  
- **SEO:** Every templated page ships with correct schema.org markup, canonical tags, and meta descriptions generated by the SEO Agent (Engineering OS §7) — no page ships without these.  
- **Reliability:** Ingestion pipeline failures must never silently stop publishing stale-but-unlabeled data — a failed refresh should extend the "last verified" gap visibly, not hide it.  
- **Availability:** Public site targets standard high availability via managed hosting (Engineering OS §10) — no custom uptime engineering needed at this scale.  
- **Latency:** API responses (internal and future public) target sub-300ms for standard entity lookups (achievable on the recommended stack without special optimization at MVP scale).  
- **Internationalization:** Not required for MVP (English-first, single primary market) — but entity/schema design (Engineering OS §6) should not structurally prevent future localization (avoid hardcoding English strings into data fields that should be locale-independent, like `slug` and enum-type fields).  
- **Maintainability:** Every requirement above is satisfiable by the Engineering OS's managed-service, monorepo, agent-gated-publishing architecture without additional custom infrastructure — this PRD introduces no non-functional requirement the Engineering OS can't already meet.

---

## 9\. Search Experience

**Supported searches:** Entity name (casino, slot, provider, bonus type), natural-language intent queries ("best no deposit bonuses," "high RTP slots"), and direct navigation queries.

**Filters:** Per entity type — Casinos (license jurisdiction, status), Bonuses (type, deposit range, wagering ceiling), Slots (RTP range, volatility, provider, theme).

**Sorting:** Default sort is always the trust-forward option (true value for bonuses, most-recently-verified for casinos, current RTP for slots) — never "most popular" or "featured" as a default, since that reintroduces exactly the incentive-bias the brand exists to avoid.

**Autocomplete:** Entity-aware type-ahead (distinguishes "shows a Casino" vs "shows a Slot" in the suggestion list) — reduces zero-result searches and reinforces the structured, entity-based mental model of the product.

**AI-assisted search:** MVP ships with strong structured/faceted search (above) rather than a chat-style AI search interface — an AI-answer box is high engineering cost for uncertain MVP value; structured filtering already solves the primary user need (Bonus-Hunter and Slot Enthusiast personas both want filters, not conversation).

**Future semantic search:** Post-MVP, once entity volume and query-log data justify it, layer a semantic/AI search mode on top of the same structured index (Engineering OS §2 Search layer) — architected as an additive interface, not a search-engine replacement, consistent with "buy leverage, don't rebuild what works."

---

## 10\. Comparison Experience

**Casino comparison:** Side-by-side license status, current top bonus (true value), review verdict, and last-verified date — never a raw "editor's rating" without a visible basis.

**Bonus comparison:** The flagship experience (Section 6, 7\) — headline value and true value shown together always, so the gap itself becomes an educational, trust-building element rather than something hidden.

**Slot comparison:** RTP, volatility, provider, and max win shown side-by-side; RTP always shown with its history trend, not just a point-in-time figure.

**Provider comparison:** Aggregate stats (average RTP across catalog, slot count, notable titles) — lower priority than the above three, useful primarily for programmatic SEO breadth (Section 13).

**Ranking methodology:** Published openly on the Methodology page (Section 12\) and linked from every comparison view — rankings are formula-driven (true value, freshness, verified status) and the formula itself is public, which is a structural trust advantage no competitor running opaque "editor's choice" rankings can easily match.

**Transparency principles:** No ranking factor is ever "we just think this one is better" — every ranking input must be a named, defined, and (where practical) publicly documented field from the schema.

---

## 11\. Content Experience

**Review structure:** Verdict-first (matches Brain §10 answer-first writing rule), followed by the data supporting it (licensing, bonus true-value, player-relevant facts), followed by any narrative context — structure, not just tone, reinforces the brand's data-first identity.

**Bonus display:** Headline value, true value, full terms (deposit range, wagering requirement, game weighting, expiry), and "last verified" date — every field individually sourced where feasible.

**AI-generation labeling:** Every AI-authored piece of content carries a visible, non-buried disclosure (e.g., "AI-analyzed from verified data · methodology v\[x\]") — this is a trust asset, not a liability, when the surrounding data rigor is genuinely strong; hiding it would contradict the entire "Structural Transparency" brand value.

**Trust maintenance:** Achieved structurally (source links, timestamps, methodology versioning) rather than through one-off trust badges or testimonials — trust signals are data fields, not decoration.

**Data freshness display:** A consistent, prominent "Last verified: \[date\]" element on every data-driven page (Brain §9, §10) — this single UI element is repeated everywhere deliberately, because it is the platform's most important recurring trust signal.

---

## 12\. Trust System

**Verification timestamps:** Every entity record carries `verified_at`; every displayed page surfaces it near the top, not buried in a footer.

**Data sources:** Every `HistoryEvent` and current-state field links to its `DataSource` record (Engineering OS §6) — visible via an inline "source" link or icon, not just stored internally.

**Review methodology:** Published, versioned (`methodology_version` on the Review entity), and linked from every review — when the methodology changes, historical reviews retain the version they were written under rather than silently inheriting new rules.

**Transparency:** Affiliate relationships disclosed clearly and consistently (a persistent, honestly-worded disclosure — not a legally-minimal footnote) — consistent with Brand Value \#2 (Structural Transparency, Brain §6).

**Responsible gambling messaging:** Present consistently across casino/bonus pages (age verification reminders, links to self-exclusion/support resources appropriate to the target jurisdiction) — this is both a compliance necessity and a genuine trust-building signal distinguishing SavvyEdge from hype-driven competitors; implemented via the `jurisdiction_rules` data table defined in Engineering OS §14 so it stays current and auditable rather than hardcoded.

**Affiliate disclosures:** Clear, plain-language, present on every page with affiliate links — never a dark-pattern-minimized disclosure.

**Quality standards:** No entity is published without passing the Schema Agent \+ Publishing Agent gates (Engineering OS §7); no review ships without a minimum data-completeness threshold (license status \+ at least one current bonus or explicit "no active bonus" state \+ a review verdict).

---

## 13\. SEO Experience

**Programmatic SEO strategy:** Entity pages generated from the schema (Casino, Slot, Bonus, Provider, Comparison) at scale, per Brain §11 and Engineering OS §13 — this PRD's IA (Section 5\) is designed specifically to make this scale predictably.

**Entity pages:** Each entity type has one canonical, consistent template — variation comes from data completeness, not from ad hoc page design.

**Internal linking:** Automatic entity-mention linking (Brain §11) — every casino/slot/bonus name mentioned anywhere on the site links to its canonical page.

**Structured data:** schema.org markup (Organization, Review, Product, FAQPage as applicable) generated by the SEO Agent for every page — never manually maintained.

**Canonical strategy:** One canonical URL per entity; comparison pages (`/compare/x-vs-y`) are canonical to themselves (not to either entity page), since they represent genuinely distinct search intent.

**Content freshness:** The "last verified" date doubles as a freshness signal to search engines (via visible on-page date \+ `dateModified` schema field) — freshness is not just a user trust signal, it's an SEO mechanism.

**Information Gain:** Enforced as a hard publishing-quality gate (Brain §11, Engineering OS §15 Phase 4 risk note) — every entity page must carry at least the True Value calculation, a historical data point, or another data field not trivially available on a top-3 ranking competitor page, or it does not ship.

---

## 14\. AI Features

| Feature | Purpose | Inputs | Outputs | User Value | Business Value | Future Expansion |
| :---- | :---- | :---- | :---- | :---- | :---- | :---- |
| **True Bonus Value Calculator** | Convert headline bonus figures into realistic expected value | Bonus terms, deposit amount, game weighting | A single comparable "true value" figure \+ explanation | Removes guesswork from bonus comparison | Core differentiator; also a structured field with standalone B2B value (operators want to know how their true value compares) | Personalized to a user's actual play style/game preference |
| **AI Review Generation** | Produce structured, data-grounded reviews at scale | Structured entity data \+ Brain writing rules | Published review draft (human-gated at MVP) | Consistent, fast-to-market coverage of every tracked casino | Enables one founder to cover a catalog a content team would otherwise be needed for | Multi-language generation once i18n is prioritized |
| **RTP History Tracking & Charting** | Show how a slot's RTP has actually moved over time | Scraped/sourced RTP figures over time | Historical chart \+ current value | Genuinely differentiated insight vs. static "RTP: 96%" competitors | High-defensibility data asset — hard for a competitor to backfill history they didn't start collecting early | Predictive/trend flags ("RTP dropped recently — investigate before playing") |
| **Bonus Change Detection** | Detect and surface when a tracked bonus's terms change | Scraper \+ Parser \+ Bonus Agent diff (Engineering OS §7) | `BonusHistoryEvent` \+ user-facing change indicator | Users get "what changed" instead of re-reading full terms | Direct feed into future B2B "competitor bonus alert" product | User-facing alerts/subscriptions (Section 6, Account module) |
| **SEO Metadata Generation** | Auto-generate titles/descriptions/schema markup per entity | Entity data | SEO metadata object | Indirect (faster, more consistent search visibility) | Removes a manual bottleneck entirely; scales with catalog size for free | N/A — this is infrastructure, not a growth feature by itself |
| **Data Verification Assistant** | Flag ambiguous/contradictory scraped data for human review | Parsed candidate records | `needs_review` flag \+ reason | Indirect (protects data accuracy users rely on) | Protects the core data-integrity brand value at scale without requiring the founder to manually check everything | Confidence scoring to progressively reduce required human review |

---

## 15\. Future B2B Platform

**How today's MVP evolves into tomorrow's SaaS:** Every module in Section 6 is designed to be queryable, not just viewable — the Enterprise Dashboard (Engineering OS §12) is architecturally a second client of the same API the public site already uses, not a rebuild.

**Enterprise users:** Affiliate managers, marketing managers, and competitive-intelligence leads at casino operators (Section 3, secondary persona) — the same data players use to choose a casino, reframed as the data an operator uses to benchmark against competitors.

**Dashboard:** A market-overview interface showing the operator's own tracked offers against competitors' — built on the existing Bonus/Casino/Slot data with an added "my organization" filter layer.

**Competitive intelligence:** Real-time (or near-real-time) visibility into competitor bonus changes, RTP shifts, and market positioning — powered directly by the `BonusHistoryEvent`/`CasinoHistoryEvent`/`SlotRtpHistory` tables that the MVP is already populating from day one.

**Historical trends:** The dashboard's single biggest differentiator versus an operator's own manual tracking — SavvyEdge will have a longer, more consistent historical record than any operator's internal ad hoc monitoring, precisely because data collection started with the MVP, not with the B2B product.

**Alerts:** The same Monitoring/Notification Engine (Engineering OS §12) built for internal data-freshness monitoring is repurposed, with operator-scoped filters, into the B2B alerting feature — again, no separate system to build.

**Market analytics:** Aggregate views (average bonus true-value by casino tier, RTP trends by provider) — composed entirely from existing entity data, no new data collection required, only new aggregation/presentation logic.

**API access:** The Public API (Engineering OS §9, Phase 8\) is the same internal API used by the public site, with auth/quota/billing layered on — sold as a standalone product to operators/developers who want raw data access rather than a dashboard.

**Product sequencing logic:** The MVP is not "the thing before the real product" — it is the data-collection instrument for the real product. Every phase in Section 18 below reflects that a feature isn't "done" when it ships to players; it's done when it also produces data of a shape and history depth that a future B2B customer would find credible.

---

## 16\. Product Analytics

**North Star Metric:** Verified Data Points Served (Section 2).

**Activation metrics:** % of new sessions that engage with a filter, comparison, or calculator tool (not just a single pageview) — measures whether a visitor actually experiences the structured-data value proposition, not just the content wrapper around it.

**Retention metrics:** Return-visit rate within 30 days; % of returning sessions that check a previously-viewed entity (a strong signal the freshness/change-tracking value proposition is working).

**SEO metrics:** Indexed page count vs. entity count (should track closely — a gap signals thin/duplicate content issues), organic sessions by entity type, average ranking position for target entity/comparison queries.

**Affiliate metrics:** Click-through rate from comparison/bonus pages to casino sites, conversion rate where trackable, revenue per session by entity type (identifies which modules are actually funding the business).

**Content metrics:** Time-to-publish per entity (measures pipeline automation health, Engineering OS §13), AI-content review-override rate (measures Content/Publishing Agent accuracy over time — a declining override rate is the signal to progressively reduce human review).

**AI metrics:** Agent success/failure rates per pipeline stage (Research → Scraper → Parser → Bonus/Schema → Content → Publishing), `needs_review` flag rate over time, data-freshness SLA compliance rate (% of entities verified within target window).

**Business metrics:** Revenue (affiliate, and later subscription/API), cost per verified data point (a genuinely novel and important unit-economics metric for this business — it measures the actual cost of building the long-term data asset, not just the cost of running the site), dataset scale (entity count × average historical depth) as a leading indicator of B2B readiness.

---

## 17\. MVP Scope

**Included:**

- Casino Directory (browse, filter, detail pages) — P0  
- Bonus Comparison Engine with True Value Calculator — P0  
- Slot & Provider Database with RTP history — P0  
- Methodology/Trust Center page — P0  
- AI-generated Reviews (human-gated publishing) — P1  
- Programmatic Comparison Pages — P1  
- Entity-aware Search — P1  
- Guides (a small, curated initial set, not a full content library) — P2, minimal viable version only  
- Structured data / SEO infrastructure (schema.org, sitemaps, metadata automation) — P0, foundational

**Excluded from MVP (explicitly deferred):**

- User accounts, saved comparisons, personalized alerts — deferred because retention features are premature before the core comparison/trust experience has proven pull; building account infrastructure before proving core value is a classic premature-complexity trap.  
- Semantic/conversational AI search — deferred because structured filtering already serves the primary JTBDs identified in Section 3; conversational search is high cost for unproven incremental value at MVP stage.  
- Video content generation — deferred (Engineering OS Phase 5); valuable but not required to prove the core data-trust thesis, and costly to build well.  
- Enterprise Dashboard / Public API — deferred by design (Engineering OS Phases 6-8); the MVP's job is to *produce* the data these depend on, not to build their interface prematurely.  
- Internationalization/localization — deferred; single-market English-first launch, schema kept locale-agnostic (Section 8\) to avoid future rework.  
- User-generated reviews/ratings — deferred; introduces moderation and trust-integrity complexity that would dilute the "every claim is sourced" positioning before the AI-generated review pipeline itself is proven.

**Why this scope:** Every included item either (a) directly drives the primary Bonus-Hunter/Researcher/Slot-Enthusiast JTBDs, or (b) is foundational data/SEO infrastructure with no viable "later" path (retrofitting structured data and schema-driven pages after launch is far more expensive than building it in from the start). Every excluded item either depends on the MVP proving its core thesis first, or serves a persona/use-case (B2B, international, social/UGC) whose needs are better addressed once the core dataset already exists and has demonstrated value.

---

## 18\. Product Roadmap

**Phase 1 — Foundation** *(maps to Engineering OS Phase 1\)* *Goals:* Ship the Casino Directory and Methodology page with a small, high-quality initial catalog. *Deliverables:* \~50-100 fully-verified casino records live, Methodology page published, core IA in place. *Dependencies:* Engineering OS Phase 1 (schema, hosting, CI/CD). *Risks:* Launching with too-thin a catalog to feel credible — mitigate by holding launch until the initial batch meets the data-completeness bar (Section 12), not a calendar date. *Success metrics:* First indexed pages, first organic impressions.

**Phase 2 — Data Collection** *Goals:* Scale the Casino Directory and ship the Bonus Comparison Engine. *Deliverables:* Bonus Comparison Engine live with True Value Calculator; catalog expands to several hundred casinos/bonuses. *Dependencies:* Engineering OS Phase 2 (ingestion pipeline). *Risks:* True-value calculation accuracy — validate the formula against a manually-checked sample before trusting it at scale. *Success metrics:* Comparison-tool engagement rate, initial affiliate click-throughs.

**Phase 3 — AI Content** *Goals:* Ship AI-generated Reviews (human-gated) and the Slot & Provider Database. *Deliverables:* Review Engine live; Slot database with initial RTP tracking live. *Dependencies:* Engineering OS Phase 3\. *Risks:* Review quality/brand-voice consistency — mitigate with 100% human review initially (Engineering OS §13), tightening over time. *Success metrics:* Review-page organic traffic, AI-content override rate trending down.

**Phase 4 — SEO Engine** *Goals:* Ship programmatic Comparison Pages and full structured-data/internal-linking automation. *Deliverables:* `/compare/x-vs-y` pages live at scale; automated internal linking across the whole site. *Dependencies:* Engineering OS Phase 4\. *Risks:* Thin-content SEO risk — Information Gain gate (Section 13\) is non-negotiable here. *Success metrics:* Organic traffic growth rate, ranking positions for target comparison queries.

**Phase 5 — Growth** *Goals:* Entity-aware Search ships; Guides content expands selectively based on observed query gaps (not a blanket content push); RTP history depth becomes a visible differentiator. *Deliverables:* Search live; a data-freshness/transparency showcase (e.g., a public "how current is our data" stat) launched to reinforce trust positioning. *Dependencies:* Sufficient traffic/query-log data from Phases 1-4 to inform what to build next. *Risks:* Scope creep — every new feature must still pass the Section 17 inclusion logic. *Success metrics:* North Star Metric growth, retention metrics improving.

**Phase 6 — B2B Dashboard** *(maps to Engineering OS Phase 6-7)* *Goals:* Internal competitive-intelligence tooling proves out; first pilot operator relationships begin. *Deliverables:* Internal trend dashboards; 1-2 design-partner operator conversations validated with real data exports. *Dependencies:* Phases 1-5 have produced sufficient data depth/history to be genuinely compelling to an operator. *Risks:* Business risk (product-market fit for B2B), not technical risk at this stage. *Success metrics:* Qualitative pilot feedback, first non-trivial willingness-to-pay signal.

**Phase 7 — Enterprise Platform** *(maps to Engineering OS Phase 7-8)* *Goals:* Full Enterprise Dashboard and Public API ship as billed products. *Deliverables:* Paying B2B customers on the dashboard and/or API. *Dependencies:* Phase 6 validation. *Risks:* Support/onboarding burden as a solo founder — plan pricing/tier structure to keep initial customer count small and high-touch. *Success metrics:* B2B MRR, API usage volume.

---

## 19\. Product Decision Framework

When making future product decisions, always prioritize in this order:

1. **User Trust** — This is the entire competitive advantage in a category defined by distrust; a feature that grows a metric at the cost of trust is a net loss, always, no matter how it scores elsewhere.  
2. **Data Ownership** — A feature that produces or strengthens structured, owned data is worth more long-term than one that only improves a page's appearance, because the dataset — not any single page — is the asset that survives algorithm changes and funds the B2B business.  
3. **Automation** — A feature a solo founder must maintain manually will not survive contact with catalog growth; automatable features compound, manual ones become debt.  
4. **Simplicity** — Every added surface (a new page type, a new filter, a new tool) is a permanent maintenance and design-consistency cost; the simplest version that fully serves the JTBD wins.  
5. **Scalability** — A feature must work as well at 10,000 entities as it does at 100, without redesign — evaluated before building, not discovered after.  
6. **Speed** — In an uncontested "Gambling Intelligence Platform" category (Brain §2), being first to build genuine topical/data authority matters more than polish.  
7. **AI Leverage** — Prefer features where AI agents (Engineering OS §7) can do the ongoing work over features that require standing human process, because the former scales with the founder's time budget and the latter doesn't.  
8. **Long-Term SaaS Value** — Given two otherwise-equal features, prefer the one that also produces something a future B2B customer would pay to see.

**Why this order:** Trust is ranked first because it is both the moat and the fragile resource — it can be spent quickly and rebuilt slowly, so it overrides every other consideration. Data ownership is ranked second because it's the mechanism that converts today's traffic into tomorrow's business — a beautiful feature that produces no structured data is optimizing the wrong layer. Automation and simplicity follow because they determine whether a solo founder can actually sustain the roadmap at all; a great feature that can't be maintained isn't actually great. Scalability, speed, and AI leverage are tie-breakers among features that already pass the trust/data/sustainability bar. Long-term SaaS value is last only because it should rarely be the deciding factor between two otherwise-close options — in practice, features that win on trust, data ownership, and automation are almost always the same features that serve the B2B future, which is exactly the alignment this framework is designed to surface.

---

## 20\. Product Constitution

### (Permanent Principles for Every Future Product Manager, Designer, Engineer, and AI Assistant)

Before proposing, designing, or building any feature for SavvyEdge, apply these

principles. They are not guidelines to weigh against convenience — they are the

operating conditions of the product.

1\. THE DATABASE IS THE PRODUCT. Every page, tool, and feature is a view onto

   structured data, not a standalone content asset. If a proposed feature

   doesn't strengthen or expose the underlying dataset, question why it exists.

2\. EVERY CLAIM NEEDS A SOURCE AND A TIMESTAMP. No feature ships a number,

   rating, or claim without a visible source and a "last verified" indicator.

   This is not a UI nice-to-have; it is the trust mechanism the entire

   business depends on.

3\. DEFAULT SORT ORDER IS ALWAYS THE TRUST-FORWARD OPTION. Never default to

   "featured," "popular," or "recommended" rankings that could be perceived as

   pay-to-win. Default sorting is always the most objectively defensible field

   (true value, freshness, verified status).

4\. AI-GENERATED CONTENT IS ALWAYS DISCLOSED. Never present AI-authored

   analysis as if it were unambiguously human-authored. Disclosure paired with

   visible data rigor is a trust asset, not a liability — treat it as one.

5\. NO FEATURE SHIPS WITHOUT AN INFORMATION GAIN CHECK. If a page or feature

   only restates information trivially available elsewhere, it does not meet

   the bar for publishing, regardless of how polished it looks.

6\. SIMPLICITY IS A FEATURE, NOT A CONSTRAINT TO WORK AROUND. A solo-founder,

   AI-assisted operation cannot sustain unbounded feature surface area. When in

   doubt, ship the smaller, more maintainable version.

7\. EVERY MVP-STAGE FEATURE IS ALSO B2B INFRASTRUCTURE. Ask, before building:

   "if an operator saw this data six months from now, would it be valuable to

   them?" A feature that only ever serves the public site in isolation should

   be treated with more scrutiny than one that also strengthens the future

   platform.

8\. RESPONSIBLE-GAMBLING AND COMPLIANCE CONTENT IS PRODUCT INFRASTRUCTURE, NOT

   LEGAL BOILERPLATE. It is designed, tested, and maintained with the same

   rigor as any other trust-critical feature, sourced from the jurisdiction

   rules data layer (Engineering OS §14), not hardcoded copy.

9\. WHEN A DECISION IS AMBIGUOUS, APPLY THE PRODUCT DECISION FRAMEWORK

   (Section 19\) IN ORDER: User Trust → Data Ownership → Automation →

   Simplicity → Scalability → Speed → AI Leverage → Long-Term SaaS Value.

10\. THE WEBSITE IS ONE CLIENT. Nothing about this product's architecture,

    data model, or feature design should assume the public website is the only

    or final interface to the platform. Every decision should remain valid

    when a second client (dashboard, API) is added later — because it will be.  
