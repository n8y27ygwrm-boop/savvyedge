# SavvyEdge UX Specification (UX Bible) v1.0

**Status:** Implementation-ready
**Audience:** Frontend engineers, AI coding assistants (Claude Code, Cursor, ChatGPT), Figma designers
**Stack assumption:** Next.js + React, mobile-first, SEO-first
**Companion docs:** SavvyEdge Brain, SavvyEdge Engineering OS, SavvyEdge PRD (all treated as immutable upstream sources)

---

## 0. How to Use This Document

This is a specification, not a mood board. Every rule here is either:
- **MUST** — a hard constraint. Violating it is a bug.
- **SHOULD** — a strong default. Deviating requires a written justification in the PR description.
- **Consider** — a judgment call left to the implementer, with guidance on how to decide.

Where two reference products disagree (e.g., Linear vs. Stripe), a recommendation is made explicitly with reasoning — this document does not leave open forks.

---

## 1. UX Principles

These are permanent. They do not change per feature, per sprint, or per stakeholder request. If a proposed design conflicts with one of these, the design is wrong, not the principle.

### 1.1 Trust is the product
SavvyEdge's entire value proposition is "reliable data about an industry that is not always reliable." Every screen must therefore visibly answer three questions within 2 seconds of landing: *Who verified this? When? How confident are we?* This is why verification timestamps and confidence indicators are treated as first-class UI elements, not footnotes (see Section 10 and 11), on par with the data itself.

### 1.2 Data before decoration
No gradient, animation, or illustration may exist unless it helps the user parse data faster. This is why the reference set is Linear/Stripe/Perplexity (data-dense, restrained) rather than consumer casino sites (visually loud, urgency-driven). Any component that does not directly aid comprehension, navigation, or trust is cut.

### 1.3 Speed is a UX feature, not an engineering afterthought
Because the audience is comparison-shopping (high intent, low patience), perceived load time directly affects bounce rate more than on a typical content site. This is why skeleton states, not spinners, are mandated everywhere content is fetched (Section 14), and why the design assumes streaming/progressive rendering by default.

### 1.4 No dark patterns, ever — structurally, not just cosmetically
This is stronger than "avoid fake urgency." It means: no pre-checked opt-ins, no countdown timers on bonuses unless the expiry is a verified real fact, no interstitials between the user and the comparison they came for, no disguised ads. Affiliate relationships are disclosed adjacent to the CTA that triggers them, not in a buried footer link (Section 10.9). This principle exists because SavvyEdge's differentiation from affiliate-spam sites is the entire business thesis — one dark pattern undermines the whole platform's credibility, not just one screen.

### 1.5 Mobile-first is a build order, not a checkbox
Layouts are designed for a 375px viewport first, then progressively enhanced. This is why every screen spec below is written mobile-first with desktop as the "additive" layer, rather than the more common (and slower to implement correctly) practice of designing desktop and cramming it down.

### 1.6 SEO and UX are the same discipline here, not competing ones
Because organic search is the primary acquisition channel (per PRD), semantic HTML, crawlable content, and fast LCP are UX requirements, not a separate technical checklist bolted on afterward. A component that requires JS to render its core text content (e.g., ratings hidden behind a client-only fetch) is a UX defect.

### 1.7 One primary action per screen
Every screen has exactly one primary CTA. Comparison tools, filters, and secondary links support that one action; they never compete with it visually (same size, same color weight). This is a direct import from Linear's approach and a direct rejection of the casino-site pattern of five simultaneous "Claim Now" buttons.

### 1.8 Content is versioned and honest about uncertainty
Because much of the content is AI-assisted, the UI must never present AI-generated or unverified content with the same visual confidence as human-verified, licensed-source data. This principle is expanded fully in Section 11.

---

## 2. Information Architecture

### 2.1 Global Navigation (Desktop)

```
[Logo] SavvyEdge     Casinos   Bonuses   Slots   Providers   Compare   [Search]        [Sign in →future]
```

- **MUST** be sticky on scroll (see 7.9), height 64px, background solid (not translucent) to avoid legibility issues over dense content.
- Search is a persistent input, not a magnifying-glass icon that expands — persistent inputs get used more (Perplexity/Stripe pattern); icon-triggered search adds a click of friction that this product cannot afford given search is a primary discovery path.
- "Compare" is a top-level nav item, not a secondary feature, because comparison is the core differentiating use case per the PRD, not an edge case.
- No mega-menu dropdowns on first release. Each top-level item is a direct link to its listing page with filters — mega-menus add engineering and maintenance cost without a proven UX benefit at this content volume (Consider revisiting only once category count exceeds ~8).

### 2.2 Global Navigation (Mobile)

- Collapses to: `[Logo]` — `[Search icon]` — `[Menu icon]`.
- Tapping menu opens a full-screen slide-in panel (not a dropdown) with the same items as desktop, stacked, plus Search at the top.
- Search icon on mobile opens a full-screen search overlay immediately (not an inline expanding bar) — inline expansion inside a 375px navbar leaves too little room to type comfortably.

### 2.3 Footer

Four columns (desktop), single accordion-stacked column (mobile):
1. **Product** — Casinos, Bonuses, Slots, Providers, Compare
2. **Company** — About, Methodology, Contact, Careers (future)
3. **Trust & Safety** — Responsible Gambling, How We Verify Data, Affiliate Disclosure, Editorial Policy
4. **Legal** — Terms, Privacy, Cookie Policy, Licensing Info by Region

- **MUST** include a persistent, non-dismissible line above the footer legal column: *"18+ / 21+ where required. Gambling involves risk. [Responsible Gambling →]"* — this is not a legal afterthought, it is load-bearing for the trust principle (1.1, 1.4).
- Responsible Gambling link in the footer is styled identically to other footer links — **not** grayed out or minimized. Minimizing it would itself be a dark pattern.

### 2.4 Search (Architecture-level)

- Single unified search across casinos, bonuses, slots, and providers, with type-ahead category grouping in results (see Section 8).
- Search is accessible from every screen via nav, and via `/` keyboard shortcut on desktop (Linear-style), documented in an on-hover tooltip on the search bar.

### 2.5 Breadcrumbs

- Present on every page except Homepage, Search Results, 404, 500.
- Pattern: `Home / Category / Subcategory / Current Page` — truncates the middle segment on mobile to `Home / … / Current Page` if it would wrap to a second line.
- **MUST** be marked up with `BreadcrumbList` structured data (SEO requirement, Section 5).

### 2.6 Internal (in-page) Navigation

- Detail pages (Casino Detail, Bonus Detail, Slot Detail) use a sticky in-page sub-nav ("Overview / Bonuses / Games / Payments / Reviews / FAQ") once the user scrolls past the hero — this replaces a long scroll with directed jump-links, which matters because these are the longest-content pages in the product.

### 2.7 Future Dashboard (B2B / logged-in)

- Architecturally reserved as `/dashboard/*`, sibling to public routes, not nested under them — keeps auth boundary clean.
- Nav pattern switches to a left sidebar (Linear/Vercel pattern) once inside `/dashboard`, distinct from the public top-nav — this is intentional: dashboards are tool-like (vertical information density, persistent context), public pages are content-like (horizontal, scannable). Reusing the public top-nav inside a dashboard is a common mistake that this spec explicitly avoids.

---

## 3. User Flows

Each flow lists: Entry point → Actions → Decision points → Exit points → Success criteria.

### 3.1 Landing Visitor (cold, from organic search)
- **Entry:** Google search result to a Casino/Bonus/Slot Detail page (not homepage — **MUST** design detail pages as valid landing pages, fully self-contained, not assuming homepage context).
- **Actions:** Scans hero verdict → checks trust indicators → scrolls to specific section (bonus terms, RTP) → possibly clicks internal link to related entity.
- **Decision points:** "Is this trustworthy enough to act on?" (resolved by Section 1.1 elements) → "Do I need to compare against alternatives?"
- **Exit points:** Affiliate CTA click (conversion), internal navigation to Compare or related entity (retention), or bounce.
- **Success criteria:** Time-to-first-trust-signal < 2s perceived; internal navigation rate from detail pages > bounce rate.

### 3.2 Casino Discovery
- **Entry:** Nav → Casinos, or Homepage featured section.
- **Actions:** Apply filters (license, country, payment method, game provider) → sort (rating, bonus value, newest) → open detail page.
- **Decision points:** Filter vs. browse (both **MUST** be equally supported, not filter-gated); list view density (compact vs. card) — **recommend** card view as default on mobile, table-with-expand on desktop for scanability (Section 5.2).
- **Exit points:** Casino Detail page, or Compare (multi-select from listing).
- **Success criteria:** Filter usage rate, median casinos-viewed-per-session.

### 3.3 Bonus Comparison
- **Entry:** Nav → Bonuses, or from a Casino Detail page's bonus section.
- **Actions:** Filter by bonus type (deposit match, free spins, no-deposit) → sort by value/wagering requirement → select multiple → Compare.
- **Decision points:** Headline bonus value vs. real value after wagering requirements — **MUST** surface effective value prominently, not just headline (this is a core trust differentiator vs. affiliate-spam sites that only show headline numbers).
- **Exit points:** Affiliate CTA, or Compare Page.
- **Success criteria:** Compare-tool engagement rate from Bonus Listing.

### 3.4 Slot Research
- **Entry:** Nav → Slots, or Provider Detail page's slot list.
- **Actions:** Filter by RTP range, volatility, theme, provider → view Slot Detail → check which casinos offer it.
- **Decision points:** RTP/volatility literacy — users may not know what these mean; **MUST** provide inline definitions (tooltip/info icon) rather than assuming knowledge (Section 10).
- **Exit points:** Casino Detail (via "where to play"), Provider Detail.
- **Success criteria:** Tooltip engagement rate as proxy for education success; cross-navigation to casino pages.

### 3.5 Provider Exploration
- **Entry:** Nav → Providers, or from a Slot Detail page.
- **Actions:** Browse provider list → view portfolio, reputation signals (license history, years active) → view slot catalog.
- **Decision points:** Provider trust is a secondary trust signal that reinforces casino trust — **MUST** cross-link bidirectionally (provider → casinos that carry them, casino → providers it carries).
- **Exit points:** Slot Detail, Casino Detail.
- **Success criteria:** Cross-link click-through rate.

### 3.6 Search Journey
- **Entry:** Any screen, via persistent search bar.
- **Actions:** Type query → see grouped type-ahead results (casinos/bonuses/slots/providers) → select, or press Enter for full results page.
- **Decision points:** Ambiguous query (e.g., "starburst" matches a slot and possibly a bonus name) — **MUST** show grouped results with clear category labels rather than a flat merged list (Section 8).
- **Exit points:** Any detail page, or full Search Results page.
- **Success criteria:** Zero-result rate (target minimized via suggestions, Section 8.6), search-to-detail-page CTR.

### 3.7 Returning Visitor
- **Entry:** Direct navigation or bookmark, likely to a specific listing or the homepage.
- **Actions:** Faster, more direct — skips exploration, goes straight to known category or search.
- **Decision points:** "Has anything changed since I last checked?" — **MUST** surface "last updated" and, where feasible, a visible changelog/badge for recently updated entities (Section 10.8) to reward return visits.
- **Exit points:** Same as first-time flows, but faster.
- **Success criteria:** Return visit rate, time-to-first-action on return visits (should be lower than first visit).

### 3.8 Future B2B User
- **Entry:** `/dashboard` after auth (out of scope for MVP build, but IA must not preclude it).
- **Actions:** View API usage, data exports, white-label widget config (speculative, per PRD roadmap).
- **Decision points:** N/A for MVP — documented here only so the public IA (Section 2.7) doesn't require rework later.
- **Exit points:** N/A for MVP.
- **Success criteria:** N/A for MVP.

---

## 4. Screen Inventory (MVP)

| # | Screen | Route pattern | Primary goal |
|---|--------|---------------|--------------|
| 1 | Homepage | `/` | Orient + route to category or search |
| 2 | Casino Listing | `/casinos` | Filter/compare casinos |
| 3 | Casino Detail | `/casinos/[slug]` | Convert or inform, self-contained |
| 4 | Bonus Listing | `/bonuses` | Filter/compare bonuses |
| 5 | Bonus Detail | `/bonuses/[slug]` | Explain real value, convert |
| 6 | Slot Listing | `/slots` | Filter/research slots |
| 7 | Slot Detail | `/slots/[slug]` | Educate + route to casinos |
| 8 | Provider Detail | `/providers/[slug]` | Trust signal + catalog |
| 9 | Search Results | `/search?q=` | Resolve ambiguous/broad queries |
| 10 | Compare Page | `/compare?ids=` | Side-by-side decision support |
| 11 | About | `/about` | Establish company trust |
| 12 | Responsible Gambling | `/responsible-gambling` | Safety resource, always reachable |
| 13 | 404 | any unmatched route | Recover navigation |
| 14 | 500 | server error boundary | Recover + reassure |
| 15 | Future Dashboard | `/dashboard/*` | Reserved, out of MVP scope |

---

## 5. Screen Specifications

Format per screen: Purpose, Primary user goal, Page hierarchy, Layout, Sections, Components, Interactions, Desktop/Tablet/Mobile behavior, Accessibility, SEO, Performance.

### 5.1 Homepage (`/`)

**Purpose:** Convert a cold visitor's intent ("I want to find/compare gambling options") into a first navigational action within seconds, while establishing trust immediately.
**Primary user goal:** Get to the right category or search result fast.

**Page hierarchy:**
1. Hero (headline + search bar, no filler image)
2. Trust strip (verification count, licenses tracked, last data refresh — quantified, not vague "trusted by thousands")
3. Category entry cards (Casinos / Bonuses / Slots / Providers) — 4-up grid
4. Featured/Top-rated Casinos (3–6 cards, real data, "Top Rated" badge with methodology link)
5. Featured Bonuses (similar pattern)
6. "How We Verify Data" summary block (short, links to full methodology)
7. Responsible Gambling callout (non-dismissible, brand-consistent, not a scary red banner — calm, factual tone)
8. Footer

**Layout:** Single column, max-width 1280px content container, generous vertical rhythm (see Section 15 spacing tokens). No full-bleed hero image — **recommend** against it: a decorative hero image adds load weight and contradicts the data-first principle (1.2) without adding comprehension value. Use typography + search bar as the hero instead, Perplexity-style.

**Components used:** Navbar, SearchBar (large variant), Card (category + entity variants), Badge, TrustStrip (custom), Footer.

**Interactions:** Search bar autofocus is **NOT** used on load (autofocus on a page load is an accessibility anti-pattern — it disorients screen reader users and hijacks scroll position). Category cards have a subtle elevation-on-hover (desktop only; no hover state simulated on touch).

**Desktop:** 4-column category grid, 3-column featured cards.
**Tablet:** 2-column category grid, 2-column featured cards.
**Mobile:** Single column, horizontally-scrollable carousel for featured cards (with visible partial-next-card to signal scrollability — never a full-bleed single card with no affordance that more exist).

**Accessibility:** Hero `h1` is the literal page purpose ("Compare casinos, bonuses, and slots with verified data"), not a marketing tagline — screen reader users' first heard content should be functional. Trust strip numbers **MUST** have accessible text equivalents, not icon-only.

**SEO:** `h1` unique, meta description states the comparison-platform value prop explicitly. Featured content **MUST** be server-rendered (not client-fetched), since homepage is the highest-authority page for internal linking.

**Performance:** LCP target < 2.0s. No hero image = no LCP risk from unoptimized imagery. Featured cards use `next/image` with explicit dimensions to prevent CLS.

### 5.2 Casino Listing (`/casinos`)

**Purpose:** Let a user filter a large set down to a shortlist.
**Primary user goal:** Narrow options using criteria that matter to them (license, country, payment methods, bonus type).

**Page hierarchy:** Breadcrumb → Page title + result count → Filter bar (sticky on desktop, drawer on mobile) → Sort control → Result list → Pagination.

**Layout:**
- **Desktop:** Left sidebar filters (240px fixed) + right content area (card grid, 2–3 columns) OR a dense table view — **recommendation:** default to a **row/table-like card** (not a bare `<table>`, but a card styled as a data row: logo, name, rating, key bonus, license badges, CTA, all in one horizontal band). Reasoning: pure card grids underperform for comparison-shopping because they hide comparable attributes behind clicks; a bare HTML table is bad for responsive collapse and visual warmth. The hybrid "table-row card" gets both scanability and responsiveness.
- **Tablet:** Filters collapse into a horizontal filter bar with a "Filters" button opening a drawer; content becomes 2-column cards.
- **Mobile:** Filters behind a "Filters" button (bottom sheet, not full-page navigation, so context isn't lost) with an active-filter-count badge; content is single-column stacked row-cards.

**Sections:** Filter bar, Sort dropdown, Result count + active filter chips (removable individually), Result list, Empty state, Pagination.

**Components:** FilterPanel, Chip, Card (row variant), Pagination, SortDropdown, EmptyState.

**Interactions:** Applying a filter **MUST** update the URL query string (shareable/bookmarkable state, and required for SEO-friendly faceted navigation — see 5.2 SEO note). Filter changes update results without full page reload (client-side fetch) but the initial load is server-rendered with default/URL-driven filters applied — this hybrid avoids both a slow reload-per-filter experience and an SEO-blind client-only listing.

**Pagination vs. infinite scroll:** **Recommend pagination** (numbered, not "load more") for listing pages, not infinite scroll. Reasoning: infinite scroll breaks the browser back button and footer reachability, and hurts crawlability of deep pages — both matter more here than the marginal engagement lift infinite scroll gives on feed-like content. This product's content is decision-oriented, not feed-oriented, so pagination's discreteness is a feature, not a limitation. Bonus/Slot listings follow the same rule for consistency.

**Accessibility:** Filter drawer traps focus while open and returns focus to the trigger button on close. Active filter chips are removable via keyboard (Enter/Space) and announce the update via an `aria-live` region on the result count ("Showing 24 casinos").

**SEO:** Key filter combinations that map to real search intent (e.g., `/casinos?license=uk`) **should** have crawlable, canonical, indexable URLs with unique titles — this is faceted-navigation SEO done correctly (index the ones with real search demand, `noindex` the long tail combinations to avoid thin-content penalties).

**Performance:** Result list uses skeleton rows (Section 14) during filter transitions, not a full-page spinner — this preserves layout stability and perceived speed.

### 5.3 Casino Detail (`/casinos/[slug]`)

**Purpose:** Self-contained page a user might land on directly from search; must answer "is this casino trustworthy and what does it offer" without requiring prior context.
**Primary user goal:** Decide whether to click through (convert) or keep researching.

**Page hierarchy:**
1. Breadcrumb
2. Hero: logo, name, overall rating (with methodology link), key trust badges (license, years active, verification date), primary CTA
3. Sticky in-page sub-nav (Overview / Bonuses / Games / Payments / Reviews / FAQ) — appears after hero scrolls past
4. Overview: pros/cons block, quick facts table
5. Bonuses section: cards linking to full Bonus Detail pages
6. Games/Providers section: logos + link to filtered Slot Listing
7. Payment methods: icon grid with processing time/limits table
8. License & Safety: license numbers, regulator links, verification timestamp
9. Reviews (editorial + aggregated, clearly separated — Section 10)
10. FAQ (accordion, also **MUST** use FAQPage structured data if content is genuinely Q&A, not just for the SEO benefit — only mark up as FAQ what actually reads as FAQ)
11. Related casinos ("Similar casinos")
12. Footer

**Components:** Hero, Badge, ProsConsBlock, QuickFactsTable, BonusCard, PaymentMethodGrid, LicenseBlock, ReviewBlock, Accordion (FAQ), AffiliateCTA, RelatedEntityCarousel.

**Interactions:** Primary CTA (affiliate) is repeated at top (hero) and bottom (after reviews) — **not** as a sticky floating button on desktop (visually noisy, competes with sub-nav), but **is** a sticky bottom bar on mobile (thumb-reachable CTA matters more on mobile where scroll distance to the original CTA is greater).

**Desktop:** Two-column below hero — main content ~70%, right rail ~30% with a condensed "quick facts + CTA" sticky card. **Tablet:** single column, quick-facts card moves inline after hero, not sticky. **Mobile:** fully linear single column; sub-nav becomes a horizontally scrollable pill bar.

**Accessibility:** Sub-nav links **MUST** use real in-page anchors (`href="#bonuses"`) so they work without JS and are keyboard/screen-reader navigable, not JS-only scroll-to handlers.

**SEO:** This is the highest-value page type for organic search. **MUST** be fully server-rendered, unique title/meta per casino, `Review`/`AggregateRating` structured data (only if ratings are genuinely aggregated per schema.org guidelines — do not fabricate structured data to appear reputable, that itself violates the trust principle and risks search-engine penalty). Canonical URL enforced even if the casino is reachable via multiple filter paths.

**Performance:** Below-the-fold sections (Reviews, FAQ, Related) lazy-load their images but **not** their text content — text must be present in initial HTML for both SEO and no-JS resilience; only heavy media defers.

### 5.4 Bonus Listing (`/bonuses`)

Structurally identical pattern to Casino Listing (5.2): filter bar (bonus type, min value, wagering requirement range, casino), sortable row-cards, pagination, URL-driven filter state. Key difference: **MUST** show both headline value and effective value (post-wagering) side-by-side in the row card, since this is the core trust differentiator called out in flow 3.3.

### 5.5 Bonus Detail (`/bonuses/[slug]`)

**Purpose:** Fully explain one bonus offer's real value and terms so the user can act without confusion or later surprise.
**Page hierarchy:** Breadcrumb → Hero (bonus headline, effective value, associated casino logo/link, CTA) → "What you actually get" plain-language explainer → Full terms table (wagering requirement, max cashout, eligible games, expiry, min deposit) → How to claim (numbered steps) → Related bonuses → Footer.

**Distinct component:** **TermsTable** — a structured, always-visible (not hidden in an accordion) table of the terms that matter for real value calculation. Hiding this in a collapsed section would work against principle 1.4 (no dark patterns) since burying unfavorable terms is a known industry dark pattern this product explicitly exists to counter.

**SEO/Performance:** Same server-rendering and structured-data rules as 5.3, using `Offer` schema where accurate.

### 5.6 Slot Listing (`/slots`)

Same listing pattern as 5.2/5.4. Filter dimensions: RTP range (slider), volatility (low/med/high, with inline definition tooltip), provider, theme. Row-card shows RTP and volatility as visually distinct badges (Section 10.2) since these are the two facts slot researchers scan for first.

### 5.7 Slot Detail (`/slots/[slug]`)

**Page hierarchy:** Breadcrumb → Hero (slot art thumbnail, name, provider link, RTP/volatility badges) → "How to read RTP and volatility" inline educational block (collapsible after first read via a dismissible "got it," remembered client-side) → Full stats table → "Where to play" — list of casinos offering this slot, linking to Casino Detail → Related slots → Footer.

The educational block exists because flow 3.4 identified RTP/volatility literacy as a decision point; this is a direct structural answer to that flow finding, not a generic FAQ bolt-on.

### 5.8 Provider Detail (`/providers/[slug]`)

**Page hierarchy:** Breadcrumb → Hero (provider logo, years active, license history summary) → Reputation signals block → Slot catalog (filterable mini-listing, links to Slot Listing pre-filtered) → Casinos carrying this provider (links to Casino Listing pre-filtered) → Footer.

### 5.9 Search Results (`/search?q=`)

**Purpose:** Resolve a query that didn't have an obvious single-category answer, or that the user typed and pressed Enter on rather than picking a type-ahead suggestion.
**Layout:** Grouped by entity type (Casinos / Bonuses / Slots / Providers), each group showing top 3 with a "See all N results in Casinos →" link if more exist — **not** a flat infinite mixed list, for the same reason given in flow 3.6.
**Empty state:** See Section 8.6 — never a dead end.
**SEO:** `noindex` this route (internal search results pages are classic thin/duplicate content; the canonical crawlable content lives on the listing pages with filters, per 5.2).

### 5.10 Compare Page (`/compare?ids=`)

**Purpose:** Side-by-side decision support for 2–4 entities of the same type.
**Layout:** Horizontally scrollable column-per-entity table on all breakpoints (this is the one screen where horizontal scroll is preferred over full reflow — comparison inherently requires side-by-side alignment, and reflowing to stacked cards defeats the page's purpose). First column (attribute labels) is sticky/frozen while scrolling horizontally, both mobile and desktop.
**Interactions:** User can swap/remove an entity from the comparison inline (dropdown per column) without leaving the page or losing the others.
**SEO:** `noindex` — this is a stateful utility view, not canonical content; the underlying detail pages are the indexable source of truth.
Full detail in Section 9.

### 5.11 About (`/about`)

Standard content page: mission, team (if public), methodology summary linking to a fuller "How We Verify Data" page. Exists primarily to satisfy E-E-A-T (Experience, Expertise, Authoritativeness, Trust) signals that matter both for SEO in YMYL-adjacent verticals and for the trust principle — **MUST** include real, named editorial/verification process details, not generic "we're trustworthy" copy.

### 5.12 Responsible Gambling (`/responsible-gambling`)

**Purpose:** Always-reachable safety resource; not a legal-compliance afterthought.
**Content:** Self-assessment guidance, links to regional helplines (accurate per region — geolocate or let user select region, don't assume one country's helpline is universal), self-exclusion tool links, and a factual (non-alarmist) description of risk. Tone: calm and respectful, matching principle 1.1 — fear-based design here would be its own kind of manipulation.
**MUST** be linked from footer on every page (2.3) and from the Homepage (5.1).

### 5.13 404

Friendly, on-brand, includes: search bar (re-entry point), links to the four main category pages, no generic "Oops!" filler illustration — a large, clear "Page not found" heading plus the recovery actions is sufficient (principle 1.2: no decoration without function).

### 5.14 500

Same recovery pattern as 404 but message is honest about a server issue, includes a "try again" action and a status-page link if one exists (future). **MUST NOT** expose stack traces or internal error detail to the user in production.

### 5.15 Future Dashboard

Out of MVP scope; IA reserved per Section 2.7. No screen spec written yet — do not build placeholder UI for this in the MVP; an unbuilt route is better than a half-built one that implies a broken feature.

---

## 6. Component Library

For each: Purpose, Props (key ones), Variants, States, Behavior, Accessibility.

### 6.1 Navbar
- **Purpose:** Global wayfinding + search entry.
- **Props:** `sticky`, `transparentAtTop` (false, always solid per 2.1).
- **Variants:** desktop, mobile.
- **States:** default, scrolled (adds shadow/border for separation from content).
- **Accessibility:** `<nav>` landmark, skip-to-content link as the first focusable element on every page.

### 6.2 Footer
- **Props:** none dynamic; static content per region if legal text varies.
- **Accessibility:** `<footer>` landmark, link list under proper heading structure.

### 6.3 Cards
- **Variants:** `category` (homepage), `entity-grid` (image-forward), `entity-row` (comparison-listing default, per 5.2), `featured` (homepage carousel).
- **Props:** `title`, `image`, `badges[]`, `rating`, `ctaLabel`, `href`.
- **States:** default, hover (desktop only), focus-visible (keyboard), loading (skeleton).
- **Accessibility:** entire card is a single tab stop wrapping an `<a>`, not multiple nested interactive elements, to avoid confusing tab order.

### 6.4 Tables
- **Variants:** `quick-facts` (key-value, detail pages), `terms` (bonus terms, always expanded per 5.5), `compare` (Section 9).
- **Behavior:** `compare` variant supports frozen first column + horizontal scroll; others reflow to stacked key-value pairs on mobile rather than scrolling, since only `compare` genuinely requires column alignment.

### 6.5 Buttons
- **Variants:** `primary` (one per screen, per principle 1.7), `secondary`, `ghost`, `destructive` (future dashboard only).
- **States:** default, hover, focus-visible, active, disabled, loading (inline spinner replaces label, button retains width to prevent layout shift).
- **Accessibility:** disabled buttons **MUST** still be reachable by screen readers with an explanation of why (`aria-describedby`), not silently unclickable.

### 6.6 Badges
- **Purpose:** Compact trust/status signals — license type, "Verified," "Top Rated," RTP tier.
- **Variants:** `trust` (green/neutral, never red — red is reserved for warnings only), `informational`, `new`.
- **MUST NOT** use badges for fabricated urgency ("Only 2 spots left!") — this component exists to reinforce trust, and using it for manufactured scarcity would directly violate principle 1.4.

### 6.7 Tags
- Used for filterable attributes (payment methods, themes). Non-interactive display variant vs. interactive filter-chip variant (see 6.11 note) are visually distinguished (chips have a remove-x, tags don't).

### 6.8 Search Bar
- **Variants:** `nav` (compact, persistent), `hero` (large, homepage), `overlay` (mobile full-screen).
- **Behavior:** debounced type-ahead (250ms), grouped results, keyboard arrow navigation between suggestions, Enter navigates to full Search Results.
- **Accessibility:** `role="combobox"` pattern with proper `aria-activedescendant` management — this is a common accessibility failure point industry-wide and **MUST** be tested with a real screen reader, not just automated axe checks.

### 6.9 Filters
- **Variants:** checkbox group (license, payment method), range slider (RTP, bonus value), radio group (sort-adjacent single-select filters).
- **Behavior:** all filter changes are additive to URL query params (5.2); a "Clear all" is always visible once any filter is active.

### 6.10 Pagination
- Numbered pattern, `Previous`/`Next` plus a bounded set of page numbers with ellipsis for long ranges. **MUST** use real `<a href>` links (server-renderable page 2, 3, etc.), not JS-only click handlers, for crawlability (ties to 5.2 SEO note).

### 6.11 Breadcrumbs
- See Section 2.5. Component-level: uses `<nav aria-label="Breadcrumb">` with an ordered list.

### 6.12 Accordion
- Used for FAQ (5.3) and mobile filter groups. **MUST NOT** be used to hide bonus terms (5.5) — accordions are for optional-depth content, not for information required to make a safe decision.

### 6.13 Charts
- Used sparingly: RTP comparison bar, bonus value comparison. **Recommend** simple bar/column charts over radial/pie for this data — comparison of magnitudes (RTP %, bonus $) is what bars communicate best; pie charts are avoided entirely since none of this data is meaningfully "parts of a whole."
- **Accessibility:** every chart **MUST** have an accessible data table equivalent (visually hidden or in a toggle), not rely on color/shape alone.

### 6.14 Review Blocks
- Two visually distinct sub-variants that **MUST NOT** be allowed to blur together: `editorial-review` (SavvyEdge's own, byline + verification date) and `aggregated-rating` (computed from multiple sources, methodology-linked). See Section 10/11 for the trust reasoning.

### 6.15 Pros & Cons
- Two-column (desktop) / stacked (mobile) list, green check / neutral dash icons (not red X for cons — cons are trade-offs, not failures, and red here would overstate negativity for what are often neutral facts like "higher wagering requirement").

### 6.16 Affiliate CTA
- **MUST** carry an adjacent, same-size-or-larger-than-decorative-elements disclosure label ("Affiliate link" or "We may earn a commission") directly next to or below the button — not in a tooltip, not in the footer only. This is the single highest-stakes trust component in the system per principle 1.4.

### 6.17 Alerts
- **Variants:** `info`, `success`, `warning` (used only for genuine warnings, e.g., "This casino is not licensed in your region" — a real, useful warning, distinct from fake urgency), `error`.

### 6.18 Forms
- Standard pattern: label above input (never placeholder-as-label — a well-known accessibility and usability failure), inline validation on blur, error text below field in text (not color-only).

### 6.19 Empty States
- **MUST** always include a next action (adjust filters, browse category, search again) — never a bare "No results" with nothing else, per flow 3.6 and Section 8.6.

### 6.20 Loading States
- Skeletons matching final content's layout shape (Section 14) — never a generic centered spinner for content areas; spinners are reserved for button-level/inline loading only.

### 6.21 Error States
- Same recovery-first pattern as Empty States; distinguishes "no results" (not an error) from "failed to load" (an actual error, with retry action) — these **MUST NOT** share the same visual treatment since they mean different things to the user.

### 6.22 Skeletons
- See 6.20/14. Shape-matched to the row-card, detail hero, etc.

### 6.23 Modals
- Used sparingly (this is a content platform, not an app) — mainly for the Compare "add entity" picker and future auth flows. **MUST** trap focus, close on Escape, return focus to trigger on close.

### 6.24 Tooltips
- Used for inline education (RTP/volatility definitions, 5.7) and info icons next to jargon. **MUST** be reachable via keyboard focus (not hover-only), since hover-only tooltips are entirely inaccessible on touch devices and to keyboard users — this is non-negotiable given how load-bearing tooltips are for the education use case in flow 3.4.

---

## 7. Interaction Rules

- **7.1 Hover:** Desktop only; **never** the sole means of revealing information (must have a focus/tap equivalent). Subtle elevation or background shift, no scale-transform on cards (scale transforms near text cause distracting reflow blur at some zoom levels).
- **7.2 Focus:** Visible focus ring on every interactive element, **MUST NOT** be suppressed with `outline: none` without a replacement — this is a common and unacceptable regression.
- **7.3 Click:** Immediate visual feedback (active state) within one frame; no click without visible response, even while an async action is pending (use button loading state, 6.5).
- **7.4 Loading:** Skeleton for content, inline spinner for actions (button/form submit), never a full-page blocking spinner for anything less than a full navigation.
- **7.5 Disabled:** Visually distinct (reduced opacity + not just color change, since color-only fails colorblind users) and explained via `aria-describedby` (6.5).
- **7.6 Success:** Inline confirmation near the action (e.g., a filter chip appearing), not a modal or toast for low-stakes actions; toasts reserved for actions with consequence away from the current view (future account actions).
- **7.7 Failure:** Specific, actionable error copy ("Couldn't load casinos — retry" with a retry button), never a bare "Something went wrong."
- **7.8 Transitions:** 150–200ms ease-out for micro-interactions (hover, focus), 250–300ms for larger layout shifts (drawer open). Nothing above 300ms — this is a data tool, not a marketing site; slow transitions read as sluggish, not premium, in this context.
- **7.9 Scrolling/Sticky:** Navbar sticky (2.1); in-page sub-nav sticky on detail pages only after hero clears viewport (5.3); filter sidebar sticky on desktop listing pages (5.2) but **MUST** stop before the footer, not overlap it.
- **7.10 Infinite scroll vs. pagination:** Pagination wins for all listing pages (5.2 reasoning). Infinite scroll is not used anywhere in MVP.
- **7.11 Keyboard navigation:** Full tab-order support required on every screen; logical order matches visual order; `/` opens search (desktop, 2.4); Escape closes any open modal/drawer/overlay.

---

## 8. Search UX

- **8.1 Autocomplete:** Debounced 250ms, minimum 2 characters before firing, grouped by entity type with a max of 3 shown per group in the dropdown.
- **8.2 Filters:** Search Results page does not duplicate full filter UI (that lives on listing pages) — search is for resolving ambiguous intent quickly, filtering is for deep exploration; conflating them would bloat the search overlay.
- **8.3 Sorting:** Search Results are ranked by relevance only (no user-facing sort control) — if a user wants sorted browsing they're routed to a listing page.
- **8.4 Saved searches (future):** Reserve a "Save this search" affordance slot in the filter bar UI (disabled/hidden until backed by auth) rather than retrofitting the layout later.
- **8.5 Semantic search (future):** Architecturally, the search bar copy should say "Search casinos, bonuses, slots..." rather than implying strict keyword matching, so upgrading the backend to semantic search later requires no UI copy change.
- **8.6 No-results state:** **MUST** show: the query that was searched, a suggestion to check spelling, 3–4 popular/fallback links (top casinos, top bonuses), and the search bar re-focused — never a dead end (ties to 6.19).

---

## 9. Comparison UX

- **9.1 Casino/Bonus/Slot/Provider comparison:** All follow the Compare Page pattern (5.10) — frozen label column, horizontal scroll for entities, 2–4 entity limit (beyond 4, the table becomes unreadable on any screen size; **MUST** show a message rather than silently truncate if a user tries to add a 5th).
- **9.2 Visual hierarchy:** The single most decision-relevant row (overall rating for casinos, effective value for bonuses, RTP for slots) is visually emphasized (bolder, top-positioned) — comparison tables that treat every row with equal visual weight force the user to do the prioritization themselves, which is a UX failure for a "trust and clarity" product.
- **9.3 Comparison tables:** Differences between columns **should** be subtly highlighted (e.g., the higher rating/value in a row gets a small accent, not a jarring color block) — assistive without being a false "winner" declaration, since "best" is context-dependent on user needs (a point the copy should also make near the table).
- **9.4 Trust indicators:** Verification date and license badges are included as rows in the compare table itself, not left only on the detail pages — a user comparing should not have to leave the compare view to check trust basics.

---

## 10. Data Presentation

- **10.1 Ratings:** Numeric (e.g., 4.3/5) plus a short methodology link inline — never a bare star graphic with no numeric backing, since stars alone invite the "is this real or decorative" doubt the whole product exists to eliminate.
- **10.2 RTP:** Displayed as a percentage with an inline tooltip definition (6.24) on first mention per page; color-neutral (RTP is a fact, not good/bad without context of volatility).
- **10.3 Volatility:** Three-tier badge (Low/Medium/High) with tooltip; never numeric-only, since volatility is inherently categorical/qualitative even when derived from a numeric model.
- **10.4 Licenses:** Regulator name + license number + a link to the regulator's public register where one exists — this is a concrete, checkable trust signal, stronger than a generic "licensed" badge.
- **10.5 Countries:** Explicit include/exclude list (not just "available in most countries") — ambiguity here directly causes user harm (attempting to sign up somewhere they're excluded), so precision is a safety requirement, not just a UX nicety.
- **10.6 Payment methods:** Icon grid + a table with processing time and limits per method — icons alone don't convey the operationally relevant facts.
- **10.7 Bonuses:** Headline value + effective value side by side always (5.4/5.5) — never headline-only.
- **10.8 Historical changes:** A visible "Last changed: [date] — [what changed]" line on entities with a volatile attribute (e.g., a casino's license status) —**recommend** a simple changelog list rather than a diff view for MVP; diff views add engineering cost disproportionate to the benefit at this stage.
- **10.9 Verification timestamps:** Present on every detail page, near the trust badges in the hero, not buried at the page bottom — ties directly to principle 1.1.
- **10.10 Affiliate disclosures:** Adjacent to every affiliate CTA (6.16), plus a full policy page linked from the footer (2.3).
- **10.11 Confidence scores:** For any AI-assisted or inferred data point, show a simple confidence indicator (e.g., "High confidence" / "Estimated") rather than a raw numeric score, which most users can't calibrate against — expanded fully in Section 11.

---

## 11. AI UX

This section exists because SavvyEdge's content pipeline is AI-assisted, and principle 1.8 requires the UI to never let AI-generated content borrow the visual authority of verified data.

- **11.1 Disclosure rules:** Any content block that is AI-generated or AI-assisted (e.g., a summary paragraph, a pros/cons synthesis) **MUST** carry a small, persistent label — "AI-assisted summary" — not a one-time tooltip that disappears, since the disclosure needs to be visible every time the content is read, not just discoverable once.
- **11.2 Confidence indicators:** Use a three-tier plain-language scale (Verified / High confidence / Needs review) rather than a numeric percentage — percentages imply false precision for what are often qualitative editorial judgments.
- **11.3 Update timestamps:** Every AI-assisted block shows when it was last generated/reviewed, distinct from the entity's overall "last updated" timestamp (10.9) if they differ — e.g., the license data might be freshly verified while the AI summary paragraph is older.
- **11.4 Human verification indicators:** A distinct badge ("Human-reviewed") for content that has passed editorial review, visually separate from "AI-assisted" — these are not mutually exclusive states (content can be AI-drafted *and* human-reviewed) and the UI **MUST** be able to show both simultaneously without visual clutter (recommend two small adjacent badges, not a merged/ambiguous one).
- **11.5 Future AI assistant:** Reserve a persistent, non-intrusive entry point (a corner chat-launcher, Perplexity/Intercom-style) in the IA now, even though it's unbuilt for MVP, so its later addition doesn't require a layout-disrupting retrofit. It **MUST NOT** be built as a blocking modal-on-load when it does ship — that pattern is a well-documented engagement anti-pattern users actively resent.

---

## 12. Responsive Design Rules

### 12.1 Breakpoints
```
mobile:  0–639px    (base/default styles)
tablet:  640–1023px
desktop: 1024–1439px
wide:    1440px+
```
Mobile-first CSS: base styles target mobile, `min-width` media queries layer up — never `max-width`-down overrides, which invert the mobile-first build order this document mandates (principle 1.5).

### 12.2 Grid
12-column grid, max content width 1280px on `wide`, with side gutters that scale (16px mobile → 24px tablet → 32px desktop).

### 12.3 Spacing
4px base unit; scale: 4, 8, 12, 16, 24, 32, 48, 64, 96 (see Section 15 tokens).

### 12.4 Typography scaling
Fluid type using `clamp()` for headings (e.g., `clamp(1.5rem, 4vw, 2.25rem)` for h1) so headings don't require discrete per-breakpoint overrides; body text stays fixed at 16px minimum across all breakpoints (never scale body text down on mobile — 16px is also the threshold that prevents iOS Safari's auto-zoom-on-input-focus behavior, a small but real mobile UX bug this avoids).

### 12.5 Touch targets
Minimum 44×44px per Apple/WCAG guidance, applied to all buttons, filter chips, and nav items on mobile/tablet — checked explicitly since dense data-table-like row-cards (5.2) are the component most likely to accidentally violate this.

### 12.6 Tables
Compare table: horizontal scroll (5.10/9). Quick-facts/terms tables: reflow to stacked key-value rows below tablet breakpoint (6.4).

### 12.7 Cards
Row-cards (6.3) collapse their horizontal band into a stacked vertical layout below tablet, preserving the same information order (rating and CTA stay near the top, not pushed to the bottom, since those are the two highest-intent elements).

### 12.8 Navigation
Full pattern in Section 2.1/2.2.

---

## 13. Accessibility

- **13.1 WCAG target:** WCAG 2.1 AA minimum across the whole product — this is treated as a baseline requirement, not a stretch goal, because principle 1.1 (trust) is undermined by an inaccessible product for a meaningful share of users.
- **13.2 Keyboard navigation:** Full support required (7.11); every interactive component spec above states its keyboard behavior explicitly rather than leaving it implied.
- **13.3 ARIA:** Used to supplement semantic HTML, never to replace it — e.g., prefer a real `<button>` over a `<div role="button">` everywhere possible; ARIA roles are reserved for genuinely custom widgets (combobox search, 6.8).
- **13.4 Color contrast:** Minimum 4.5:1 for body text, 3:1 for large text/UI components, checked against the actual design tokens in Section 15, not assumed from a palette that looks fine at a glance.
- **13.5 Focus management:** Modals/drawers trap and restore focus (6.23); route changes (e.g., pagination, 6.10) move focus to the new content's heading so screen reader users aren't stranded on a now-stale element.
- **13.6 Screen readers:** Tested explicitly with VoiceOver and NVDA before ship on the core flows (Casino Listing filter+browse, Casino Detail, Search) — automated linting (axe, Lighthouse) is necessary but insufficient and **MUST NOT** be treated as a substitute for manual testing on these flows.

---

## 14. Performance UX

- **14.1 Skeleton loading:** Default loading treatment everywhere content is fetched client-side (filter changes, search type-ahead) — shape-matched to final content (6.20/6.22).
- **14.2 Lazy loading:** Below-the-fold images (`next/image` with native lazy loading); text content is never lazy-loaded (5.3 performance note) to preserve SEO and no-JS resilience.
- **14.3 Progressive rendering:** Server-render the shell + above-the-fold content first; stream/hydrate below-the-fold sections — appropriate given Next.js's streaming SSR capabilities, and consistent with principle 1.3.
- **14.4 Image strategy:** All entity logos/images served via `next/image`, WebP/AVIF with fallback, explicit width/height to prevent CLS, and a blur placeholder (not a gray box) for a calmer loading feel consistent with the restrained aesthetic (1.2).
- **14.5 Caching indicators:** Where data has a meaningful "freshness" story (10.8/10.9), surface it directly in UI rather than relying on users to intuit caching behavior — this is a UX expression of a technical concern, which is exactly the kind of translation this document is meant to force (see Section 0).
- **14.6 Perceived performance:** Optimistic UI for reversible, low-stakes actions (e.g., adding an entity to Compare) — update the UI immediately, reconcile with the server in the background, and only show an error state if reconciliation actually fails.

---

## 15. Design Tokens

```
SPACING SCALE (px):      4, 8, 12, 16, 24, 32, 48, 64, 96
RADIUS SCALE (px):       4 (inputs/chips), 8 (cards, buttons), 16 (modals), 999 (pills/badges)
ELEVATION (shadow tiers): 
  e0: none (flat, default state — the product is mostly flat per principle 1.2)
  e1: subtle card hover / sticky navbar-on-scroll
  e2: dropdowns, tooltips
  e3: modals, drawers
TYPOGRAPHY SCALE (rem, mobile → desktop via clamp where noted):
  display:  clamp(1.75, 5vw, 2.75)   — homepage hero only
  h1:       clamp(1.5, 4vw, 2.25)
  h2:       clamp(1.25, 3vw, 1.75)
  h3:       1.25 (fixed)
  body:     1.0 (fixed, never scaled down — see 12.4)
  small:    0.875 (fixed)
  caption:  0.75 (fixed) — used sparingly (verification timestamps, disclosures) and never below AA contrast
GRID:                     12 columns, gutters 16/24/32 by breakpoint (12.2)
ICON SIZING (px):        16 (inline/tooltip triggers), 20 (buttons/nav), 24 (standalone/empty-state)
COMPONENT SPACING:       Section vertical rhythm = 64px mobile / 96px desktop between major page sections
ANIMATION DURATION (ms): 150 (micro: hover/focus), 250 (standard: drawer/dropdown open), 
                         300 (max ceiling — see 7.8, nothing in this product animates longer)
```

Color tokens are intentionally not hard-coded numerically in this document — they belong in the brand/design-token source of truth referenced by the Brain document — but the **usage rules** are binding here: neutral/trust badges default to a calm palette (blues/greens/grays); red is reserved exclusively for genuine warnings and errors, never for decorative emphasis or manufactured urgency (ties directly to 1.4 and 6.6).

---

## 16. UX Decision Rules (The UX Constitution)

These are the rules a future designer, engineer, or AI assistant should check against *before* proposing any new interface, screen, or component. If a proposal fails any of these, it should be revised before being built.

1. **Does this add a trust signal, or does it just look trustworthy?** Decorative trust cues without a real, checkable fact behind them are not permitted (1.1, 10.4).
2. **Does this help the user compare or decide faster, or does it just look impressive?** If a design choice doesn't reduce time-to-decision, cut it (1.2, 1.3).
3. **Would this pattern be considered a dark pattern if a regulator or journalist scrutinized it?** If there's any doubt, don't ship it (1.4).
4. **Was this designed mobile-first, or squeezed down from desktop?** If the mobile layout feels like an afterthought, it wasn't built correctly (1.5, 12.1).
5. **Can this content be crawled and read without JavaScript?** If not, and it's not a genuinely interactive widget, it's built wrong (1.6, 5.3).
6. **Is there exactly one primary action on this screen?** If there are two competing CTAs of equal visual weight, resolve the ambiguity before shipping (1.7).
7. **Does this distinguish verified fact from AI-assisted or estimated content, at the point of reading — not just in a methodology page?** (1.8, Section 11).
8. **Is every interactive element reachable and operable by keyboard alone?** No exceptions carved out for "just this one component" (7.11, 13.2).
9. **If this component fails to load, does the user see a specific, actionable message — not a dead end?** (6.19, 6.21, 8.6).
10. **Does this new pattern already have a precedent in this document?** If yes, follow it for consistency rather than introducing a stylistic variant; if no, add the new pattern back into this document once decided, so the constitution stays current rather than drifting out of sync with the built product.

---

*End of SavvyEdge UX Specification v1.0.*
