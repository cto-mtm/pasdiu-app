# Pasdiu — Freemium Subscription Business Model

**Date:** 2026-07-29 — flat-rate revision (original per-seat draft: 2026-07-09) · **Status:** adopted · **Companion docs:** `docs/archive/AUDIT.md`, `README.md`

> **Revision note (2026-07-29).** Per-seat pricing is abandoned. Pasdiu now charges **one flat price per workspace** with a seat allowance as the tier gate. §2 documents why, and §4.3/§6/§7 carry the consequences — most importantly, gross margin now *compresses* with workspace size instead of improving, which promotes the read-amplification fix from "nice to have" to load-bearing.

Pasdiu is a client-work logistics hub for media creators: agencies, post-production studios, and freelance editor collectives managing Client → Project → Sub-Group → Task pipelines with versioned review and client approval. This document proposes a freemium subscription model, grounds the unit economics in the app's **actual Firestore query patterns**, and models profitability, sustainable free:paid ratios, and break-even points.

> All infrastructure prices are current published GCP/Firebase rates as of July 2026 (sources at the end). All revenue-side numbers are assumptions — marked as such — and should be replaced with measured data as soon as the product has real usage.

---

## 1. Who pays, and for what

The product has four roles with very different value profiles:

| Role | What they do | Willingness to pay |
|---|---|---|
| Admin / PM ("managers") | Run the whole workspace: clients, boards, ledger, analytics, team | **High** — this is their operating system |
| Contractor (editors) | Work their Slate, push versions | **None directly** — the studio pays a flat plan; adding a contractor costs it nothing |
| Client users | Review and approve in the Portal | **None** — they are the *deliverable audience*, not the customer |

This asymmetry drives the central pricing decision below: **client users must be free and unlimited.** Charging for reviewer seats is the single most common way tools in this category kill their own network effect — every client user invited into a portal is a free marketing exposure and a switching cost for the agency.

## 2. Pricing axis: per seat, per client, or flat per workspace?

Three candidates were evaluated. Per-seat pricing was adopted in the July 9 draft and **reversed on July 29** — the reasoning for the reversal is the substance of this section.

**Per team seat (admin + pm + contractor).** Revenue tracks headcount, which tracks the customer's own revenue — familiar and budgetable (Linear, Asana, Monday all price this way). It failed here for one reason: **this product's seats have wildly unequal value.** An admin/PM runs their business on Pasdiu; a freelance camera op logs in three times during a shoot week to check a task list. Charging both $12 turned every marginal crew invite into a purchase decision, and the predictable result is studios keeping crew *out* of the workspace and coordinating over WhatsApp — which destroys the pipeline completeness the whole product depends on. The arithmetic was also simply out of range: a 13-person studio at $156/mo, in a category whose default alternative is a free spreadsheet.

**Per active client.** Tracks the real value unit (client relationships under management) and correlates with infrastructure cost better than seats do. Rejected on the original grounds: it punishes exactly the behavior we want (bringing every client into the tool), invites gaming via archiving/merging, and buyers can't budget for it.

**Adopted: one flat price per workspace, with the seat allowance as the tier gate.** There is no per-seat charge on any tier. A plan buys a bucket — Studio covers up to 20 people, Agency has no seat ceiling — and every seat inside the bucket is free at the margin. Client/reviewer users stay unlimited and free everywhere. Upgrades trigger on outgrowing the bucket or needing paid features, never on hiring one more freelancer.

What this buys: the crew invite stops being a decision, which protects the pipeline data the product is built on; the price fits on one line; and a studio can scale a project team up and down seasonally without a billing conversation. What it costs, deliberately:

- **Seat-based expansion revenue is gone.** Net revenue retention can no longer come from customers hiring (§6, §7.3); the only expansion path is a tier upgrade.
- **Gross margin compresses as a workspace grows** instead of improving, because revenue is now capped while reads are not (§4.3). This is why §8's read-amplification fix is load-bearing.

**No seat overage, on purpose.** Charging, say, $4/seat above Studio's 20 was considered and rejected: a 40-seat workspace would pay $49 + $80 = $129 and sit just under Agency's $149, cannibalizing the only upgrade this model has. Studio's 20-seat ceiling is a hard gate, and seat 21 is an Agency conversation. Revisit only once Agency carries real feature differentiation of its own (SSO, audit log, API) rather than just higher limits.

**Regional pricing: deferred.** A single global USD price ships first. Latin American SMB willingness-to-pay runs materially below US levels for the same product, so a PPP-adjusted tier (roughly $29 / $89) is likely warranted later; `PRICE_LOOKUP_KEYS` in `firebase/functions/src/helpers/stripe.ts` is already the right seam for it (add `studio_monthly_latam` alongside `studio_monthly`). Two notes for when that happens: bind the region to the **payment-method country** Stripe reports, not IP, or a VPN defeats it; and local payment methods (OXXO, PIX, Boleto) will likely move LatAm conversion more than the discount does, since B2B card penetration is the actual blocker.

## 3. Proposed tiers

| | **Free** | **Studio** | **Agency** | **Enterprise** |
|---|---|---|---|---|
| Price | $0 | **$49 / mo flat** ($490 / yr) | **$149 / mo flat** ($1,490 / yr) | custom, annual |
| Team seats | 3 | up to 20 | unlimited | unlimited |
| Active clients | 3 | unlimited | unlimited | unlimited |
| Client (reviewer) users | unlimited | unlimited | unlimited | unlimited |
| Active tasks | 500 | 10,000 | unlimited | unlimited |
| Active deliverables | 50 | 2,000 | unlimited | unlimited |
| Version media | external links (Drive/Dropbox/Frame.io) on every tier — MVP | | | |
| Hosted media storage (roadmap) | 1 GB | 100 GB | 1 TB | custom |
| Version history | last 3 versions | full | full | full |
| Export Ledger (CSV) | — | ✓ | ✓ | ✓ |
| Analytics page | — | ✓ | ✓ | ✓ |
| CSV Import Wizard | — | ✓ | ✓ | ✓ |
| SSO / SAML (Identity Platform) | — | — | ✓ | ✓ |
| Audit log, custom roles | — | — | — | ✓ |
| Support | community | email | priority | dedicated + SLA |

**Annual billing** is 10 × the monthly price on every paid tier — "2 months free", a 16.7% discount, identical in percentage terms at both tiers ($98 saved on Studio, $298 on Agency). That sits inside the standard 15–20% band and is the primary churn defence (§6).

Design logic: the Free tier is a *complete* product for a freelancer with up to 3 clients — it must be genuinely useful or the funnel dies. Upgrade triggers are the natural growth moments: hiring a fourth teammate, landing a fourth client, or needing the ledger for invoicing (the ledger is deliberately paid — it's the "money moment" where the product touches the customer's revenue). Studio→Agency triggers on outgrowing 20 seats, blowing past 10,000 tasks, or SSO. Features already exist in the codebase for everything in the Free/Studio/Agency columns except storage quotas and gating itself.

**Seat definition:** a seat is a membership in an organization, not a person — a freelance contractor working for three studios occupies a seat in each (the Slack/Notion model). Seats are no longer a *price meter*; they are only a **cap**. Client/reviewer users are never seats and never count against the allowance.

**Why this works for both small and big teams:** flat pricing deliberately trades revenue at the top for adoption in the middle. A 4-person studio pays $49 (it paid $48 under per-seat — neutral); a 13-person studio pays $49 instead of $156 (−69%); a 20-person studio pays $49 instead of $240 (−80%). Break-even against the old model is ~4 seats, so the change is a price *cut* for everyone above it and roughly neutral below. The revenue spread across the paid range collapses from ~28× to ~3× (Studio→Agency), which is the cost of the simplicity — and the reason the Agency tier must eventually earn its 3× with features, not just limits.

## 4. Infrastructure cost model (COGS) — from the actual codebase

### 4.1 Current GCP/Firebase pricing (July 2026, us multi-region class rates)

| Meter | Price | Free allowance |
|---|---|---|
| Firestore reads | $0.06 / 100k | 50k/day (per project, once) |
| Firestore writes | $0.18 / 100k | 20k/day |
| Firestore deletes | $0.02 / 100k | 20k/day |
| Firestore storage | $0.18 / GB / mo | 1 GB |
| Firebase Auth | free ≤ 50k MAU, then ~$0.0055/MAU (declining tiers) | 50k MAU |
| Cloud Functions (2nd gen) | $0.000024 / vCPU-s + $0.0000025 / GiB-s | 2M invocations/mo |
| Hosting transfer | ~$0.15 / GB | 10 GB/mo |
| Cloud Storage (media, future) | ~$0.026 / GB / mo storage; ~$0.12–0.15 / GB download egress | 5 GB |

Note: the daily free quotas apply **once per Firebase project**, not per customer — at scale they're a rounding error, so the model below ignores them.

### 4.2 What the app actually reads

The cost profile comes straight from `app/src/stores/data.ts`, re-verified 2026-07-29:

- **Roster, clients, and the project list are memoized per session** (`usersLoaded` / `clientsLoaded` / `projectsLoaded`) and the project list is paginated at `PAGE_SIZE = 1000`. These are bounded and cheap.
- **`loadProjectBoard` is the cost centre.** It reads every `subGroups` and `tasks` doc for a project with **no `limit()` and no memo guard**, so *every visit* to a board re-reads that project's entire task set. `loadProjectDeliverables` has the same shape. Combined with Agency's unlimited task/deliverable ceiling, the dominant term is `(tasks per project) × (board visits) × (users)` — unbounded in all three factors.
- Contractors read their Slate (`tasks where assigneeUid ==`, also unbounded) plus visited boards. Client users read only their tenant's projects/tasks.
- **Writes are a rounding error** — roughly 50:1 below reads in every profile modelled below. Firestore *storage* is likewise negligible: this is a metadata-only app (media is external links, §4.4), so 5M task/note/version docs at ~1.5 KB is ~7.5 GB ≈ $1.35/mo. Growth in stored data is not a cost risk; growth in *read amplification* is.

Assumptions (revenue-side, to be replaced with measured data): 22 workdays, ~6 fresh app loads per user per day, ~4–12 board visits per session. Task docs ≈ 1–2 KB.

### 4.3 Cost per workspace per month (Firestore, current architecture)

| Workspace profile | Team | Clients | Tasks | Reads/mo | **Firestore cost/mo** | Revenue/mo | COGS % |
|---|---|---|---|---|---|---|---|
| Free (freelancer) | 3 | 3 | 300 | ~120k | **~$0.07** | $0 | — |
| Studio (small) | 5 | 10 | 1,500 | ~700k | **~$0.45** | $49 | 0.9% |
| Studio (busy) | 10 | 25 | 5,000 | ~2.9M | **~$1.80** | $49 | 3.7% |
| Studio (at cap) | 20 | 60 | 10,000 | ~11M | **~$7** | $49 | **14%** |
| Agency | 25 | 60 | 20,000 | ~22M | **~$13.50** | $149 | 9% |
| Agency (large) | 50 | 120 | 50,000 | ~90M | **~$55** | $149 | **37%** |
| Agency (pathological) | 50 | 200 | 150,000 | ~238M | **~$143** | $149 | **96%** |

Add ~10–20% on top for writes, deletes, doc storage, hosting transfer, and Auth — the shape doesn't change. Reads needed to consume a subscription outright, for reference: **248M/mo at $149**, 82M/mo at $49 (us multi-region; a single-region Firestore location roughly halves these, so confirm which one the project uses — Functions run in `us-east5`).

Three conclusions, and note that **#2 inverts the July 9 version of this document**:

1. Gross margin is still **~95–99% for the typical workspace** — Free through busy Studio. Firestore is effectively free at the sizes most customers will ever reach.
2. **Margin now compresses with workspace size instead of improving.** Under per-seat pricing, revenue and reads both grew with the customer, so margin got *better* with scale. Under flat pricing, revenue is capped and reads are not: the same large-agency profile that was 4.4% COGS at $1,250/mo of seat revenue is **37% at $149**, and a genuinely pathological customer erases the subscription entirely. Flat pricing is only safe if read growth is bounded.
3. Therefore the fix is no longer optional. `loadProjectBoard`'s missing `limit()` + memo guard (`docs/archive/AUDIT.md` E3) is now a **prerequisite for advertising "unlimited"**, not a scaling nicety. Adding the guard plus leaning on the existing `stageSummary` aggregate for board rows collapses the pathological column back toward the normal one — roughly a 10× cut at the top end.

### 4.4 Version media: link-based for the MVP — near-zero COGS

**Product decision (2026-07-09): media is NOT stored on the platform.** Versions carry an external link (`mediaUrl`) to the customer's own storage — Drive, Dropbox, Frame.io, etc. This means:

- **Media COGS for the MVP is ~$0.** A URL string in a version doc costs nothing beyond the ~1 KB Firestore doc it already lives in. Firestore (§4.3) is the *entire* infrastructure bill, and gross margin holds at **~95–99% on every tier**.
- The storage quotas in the tier table become a **roadmap gate**, not an MVP one. If/when hosted media ships (upload + preview in the Iteration Room is a genuine competitive feature), the economics look like: storage ~$0.026/GB/mo, download egress ~$0.12–0.15/GB — egress dominates, and preview transcodes (720p proxies, a 10–50× size cut) plus CDN caching keep it at 5–10% of revenue. That analysis is preserved here so the roadmap decision is pre-costed: worst case ~$0.35/mo per Free workspace (1 GB cap), ~$20–35/mo per Studio (100 GB), ~$200–330/mo per large Agency (1 TB) — all bounded by the quotas.
- MVP trade-off to watch: link-based media means the review experience depends on the customer's storage permissions (a client clicking a Drive link they can't open is a support ticket we can't fix). Track "media link click failures" qualitatively in early support and revisit hosted media when it becomes the top churn-adjacent complaint.

## 5. Free-tier economics: what ratio can we sustain?

Marginal cost of a free workspace, all-in:

| Component | Cost/mo |
|---|---|
| Firestore (300 tasks, 3 seats + client users) | ~$0.07 |
| Media (external links — MVP) | $0 |
| Auth | $0 below 50k total MAU, then ~$0.006/user |
| Hosting/Functions share | ~$0.01 |
| **Infra total** | **~$0.10** |
| Support/success amortized (self-serve, community support) | ~$0.10–0.30 |
| **All-in** | **~$0.20–0.40** |

A Studio workspace yields **~$47/mo gross margin** ($49 less ~$1.72 Stripe and ~$0.45 Firestore). That margin funds **120–235 free workspaces** at all-in cost (65–135 even under the future hosted-media scenario). Healthy freemium businesses run **10–50 free workspaces per paid** — we have 3–10× headroom beyond that. The binding constraint is therefore **conversion rate, not infrastructure**: even at a weak 1% conversion (100:1 ratio), infra roughly breaks even on the free pool; anything above ~1.5% conversion and the free tier is comfortably self-funding. The practical watch-item is the 50k MAU Auth cliff (at 100k total MAU, Auth adds ~$275/mo — trivial if even 2% converted). With link-based media there's no "free cloud storage" abuse surface in the MVP; the task/client limits are the only quotas to enforce.

**Benchmark context:** B2B freemium converts at 3–5% typically; tightly-targeted vertical tools (which Pasdiu is) reach 5–15%; the cross-product median is ~8% with a wide spread. The model below uses 2% / 4% / 8% as pessimistic / base / optimistic.

## 6. Revenue model and break-even

Blended ARPA assumption: an 80/20 Studio:Agency mix ≈ **$69/mo ARPA** (0.8 × $49 + 0.2 × $149), net of Stripe and Firestore → **~$64 contribution per paid workspace**. Note this barely moves from the per-seat model's $75: flat pricing loses revenue on large workspaces but gains it on the small ones that dominate the mix. The change is a *distribution* change, not an ARPA collapse — what it really costs is the expansion curve (§7.3), not the starting point.

### Break-even by cost structure

| Scenario | Fixed costs/mo | Paid workspaces to break even | Free workspaces implied (at 4%) | Total signups needed |
|---|---|---|---|---|
| Solo founder, bootstrap (tools, $500 ads, no salary) | ~$1,500 | **~23** | ~550 | ~575 |
| Ramen-profitable (1 founder salary $6k + costs) | ~$8,000 | **~125** | ~3,000 | ~3,125 |
| Small team (2 founders + 1 eng, $22k + $3k costs) | ~$25,000 | **~391** | ~9,400 | ~9,800 |

At ~390 paid workspaces the MVP infra bill is roughly $700–1,400/mo (including the free pool; no media costs with link-based media) — 3–5% of the ~$27k MRR, consistent with the margin model.

### Conversion sensitivity (signups needed for $25k MRR ≈ 362 paid workspaces)

| Freemium conversion | Total workspace signups required |
|---|---|
| 2% (pessimistic) | ~18,100 |
| 4% (base) | ~9,050 |
| 8% (optimistic — achievable for vertical B2B) | ~4,530 |

### LTV / CAC sanity check (assumptions, to validate with data)

SMB monthly churn 3.5% → ~29-month average lifetime → **LTV ≈ $1,830** gross-margin dollars per paid workspace. Self-serve CAC for a niche vertical at $200–400 gives **LTV:CAC of 4.6–9×** and CAC payback of 3–6 months — still healthy, with less headroom than the per-seat model's 5–10×. If churn measures worse than ~5%/mo the model degrades quickly; churn is the number to defend (annual plans at 16.7% discount, client-user lock-in, and the ledger/history as switching costs).

For contrast, this is the arithmetic that killed the $12/$25 flat idea considered on the way here: at $12/mo, LTV is ~$360 against a $200–400 CAC — customers churn before payback — and a single 20-minute support email per month consumes ~83% of the annual revenue. Flat pricing only works at a price point that can absorb a support conversation.

## 7. Key metrics dashboard

Track from day one, in order of importance:

1. **Free → paid conversion** (target ≥4%; alarm <2%) and **time-to-convert** (expect a 30–60 day median; instrument which gate triggered the upgrade — that tells you which limits are priced right).
2. **Activation rate** — % of new workspaces that create ≥1 client + ≥1 project + invite ≥1 other person in week 1. Freemium lives or dies here; unactivated signups convert at ~0%.
3. **MRR, ARPA, and tier-upgrade rate.** Flat pricing removes seat expansion entirely, so the old ">105% NRR from hiring alone" target is void — **expect NRR below 100% at first** and treat the Free→Studio→Agency upgrade rate as the only expansion lever there is. Instrument seat-cap proximity (workspaces at ≥80% of their seat allowance) as the Agency pipeline, the way client-count was meant to work under per-seat.
4. **Logo churn** (target ≤3.5%/mo SMB blend) and **revenue churn**.
5. **Gross margin / COGS per workspace** — instrument Firestore reads per workspace (export billing to BigQuery, label by workspace); alarm if any workspace exceeds ~$5/mo pre-media or COGS exceeds 10% of its revenue.
6. **CAC and payback** once there's paid acquisition.
7. **Client-user invites per workspace** — the viral loop (each portal invite exposes a prospective customer); measure invite→signup rate of client users who later create their own workspace.

## 8. Risks and levers

- **Read amplification** (biggest technical risk, and now a *pricing* risk): `loadProjectBoard` re-reads a project's whole task set on every board visit with no `limit()`, so one 150k-task customer on unlimited Agency can consume its entire $149 (§4.3). Under per-seat this was a margin nuisance; under flat pricing it is the failure mode. Lever: ship the `limit()` + memo guard (AUDIT E3) **before** the first large customer; consider Firestore committed-use discounts once spend passes ~$1k/mo.
- **Flat-rate margin compression** (new, structural): revenue per workspace is now capped while usage is not, so the largest customers are the least profitable — the inverse of the per-seat model. Levers, in order of preference: bound the reads (above); replace Agency's `-1` task/deliverable ceilings with large-but-finite numbers so "unlimited" stays honest without being unbounded; and price Enterprise custom for anyone genuinely off the chart.
- **No expansion revenue** (new, commercial): with seats no longer metered, a customer who grows 3 → 19 people pays the same $49 forever. All growth must come from new logos plus Studio→Agency upgrades. If the upgrade rate measures near zero, the 3× Studio→Agency gap is too wide or Agency isn't differentiated enough — that is the first pricing lever to pull, ahead of touching the headline numbers.
- **Media egress** (biggest *roadmap* COGS risk — not in the MVP, which uses external links): if hosted media ships, mitigate with preview transcodes, CDN caching, per-file caps; price Enterprise media custom.
- **Link-based media UX** (MVP risk): review experience depends on customers' own storage permissions; monitor as a churn signal and the trigger for the hosted-media roadmap item.
- **Free-tier abuse**: quota enforcement server-side (security rules + a usage doc per workspace), not just UI.
- **Under-pricing small-team/many-client cases** (worse under flat pricing): the client-count gate that used to catch this is gone — paid tiers now have unlimited clients. A 3-person studio managing 80 clients pays $49 while consuming Agency-scale reads. Accepted deliberately (client count is the behaviour we most want to encourage), but monitor COGS-per-workspace (§7.5) rather than client count as the detector.
- **Multi-tenancy**: today all customers share one Firebase project with tenant scoping via security rules (audited and locked down); Enterprise buyers may demand project-level isolation — price it into the custom tier.

## 9. Recommended next steps

1. **Bound the reads** — `limit()` + memo guard on `loadProjectBoard` / `loadProjectDeliverables`, and use the existing `stageSummary` aggregate for board rows. Now a prerequisite for the flat-rate model, not just for scale (§4.3, §8).
2. **Finish the flat-rate migration.** Constants, pricing UI, and copy are done. Outstanding:
   - **Client members must stop consuming seats.** `orgs.ts` increments `usage.seats` for every accepted invite regardless of role, and `reconcile.ts` recounts seats as the full member count — so reviewers eat the seat allowance today, contradicting both the tier table above and the shipped pricing-page copy ("they never count as seats").
   - **Stripe becomes flat.** Checkout should send `quantity: 1` instead of the seat count, and `syncSeatQuantity` can be deleted outright — there is no per-seat quantity to keep in sync any more. Create the four new prices (`studio_monthly` $49, `studio_annual` $490, `agency_monthly` $149, `agency_annual` $1490) with `transfer_lookup_key: true` so the existing lookup-key resolution picks them up with no code change.
   - Seat-cap enforcement stays (it's the tier gate) but counts team members only.
3. **Instrument metrics §7** (PostHog/Amplitude + BigQuery billing export) before launch, so the 2%/4%/8% assumption gets replaced by data within one quarter. Add per-workspace COGS and seat-cap proximity — both are new load-bearing signals under flat pricing.
4. **Launch, then treat the first 90 days as a pricing experiment.** The gates (3 seats / 3 clients on Free, 20 seats on Studio) are far easier to tune than the price points. Revisit in this order: Studio→Agency upgrade rate → Agency feature differentiation → regional pricing (§2) → the headline numbers last.

---

### Sources

- [Firestore pricing — Google Cloud](https://cloud.google.com/firestore/pricing) · [Understand Cloud Firestore billing — Firebase](https://firebase.google.com/docs/firestore/pricing)
- [Firebase pricing (plans, Auth MAU tiers, Hosting, Storage)](https://firebase.google.com/pricing) · [Firebase Hosting usage & quotas](https://firebase.google.com/docs/hosting/usage-quotas-pricing)
- [Identity Platform pricing — Google Cloud](https://cloud.google.com/identity-platform/pricing)
- [Cloud Run functions pricing guide — Modal](https://modal.com/blog/google-cloud-function-pricing-guide)
- [SaaS Freemium Conversion Rates 2026 — First Page Sage](https://firstpagesage.com/seo-blog/saas-freemium-conversion-rates/) · [Freemium Conversion Benchmarks — daydream](https://www.withdaydream.com/library/insights/freemium-conversion-rate) · [SaaS Conversion Report — ChartMogul](https://chartmogul.com/reports/saas-conversion-report/)

*Infrastructure prices verified July 2026. Revenue-side figures (ARPA, churn, CAC, session frequency) are stated assumptions pending real usage data.*
