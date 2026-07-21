# Pasdiu — Freemium Subscription Business Model

**Date:** 2026-07-09 · **Status:** proposal · **Companion docs:** `docs/archive/AUDIT.md`, `README.md`

Pasdiu is a client-work logistics hub for media creators: agencies, post-production studios, and freelance editor collectives managing Client → Project → Sub-Group → Task pipelines with versioned review and client approval. This document proposes a freemium subscription model, grounds the unit economics in the app's **actual Firestore query patterns**, and models profitability, sustainable free:paid ratios, and break-even points.

> All infrastructure prices are current published GCP/Firebase rates as of July 2026 (sources at the end). All revenue-side numbers are assumptions — marked as such — and should be replaced with measured data as soon as the product has real usage.

---

## 1. Who pays, and for what

The product has four roles with very different value profiles:

| Role | What they do | Willingness to pay |
|---|---|---|
| Admin / PM ("managers") | Run the whole workspace: clients, boards, ledger, analytics, team | **High** — this is their operating system |
| Contractor (editors) | Work their Slate, push versions | Indirect — the agency pays for their seat |
| Client users | Review and approve in the Portal | **None** — they are the *deliverable audience*, not the customer |

This asymmetry drives the central pricing decision below: **client users must be free and unlimited.** Charging for reviewer seats is the single most common way tools in this category kill their own network effect — every client user invited into a portal is a free marketing exposure and a switching cost for the agency.

## 2. Pricing axis: per seat, per client, or hybrid?

The request was "per team size or per amount of clients" — here is the analysis of both, plus the recommended hybrid.

**Per team seat (admin + pm + contractor):** revenue tracks headcount, which tracks the customer's own revenue — fair and familiar (Linear, Asana, Monday all price this way). Predictable for the buyer. Weakness: a 2-person agency juggling 40 clients pays almost nothing while consuming real value and real Firestore reads (cost scales with *data*, not seats — see §4).

**Per active client:** tracks the actual value unit (client relationships under management) and correlates with our infrastructure cost better than seats do. Weakness: it punishes exactly the behavior we want (bringing every client into the tool), invites gaming (archiving/merging clients), and is unfamiliar — buyers can't budget for it.

**Recommended: per-seat pricing with client-count tier gates.** Seats are the *price meter* (familiar, budgetable); active-client count is the *tier gate* (the natural upgrade trigger, and our cost proxy). Small teams with few clients stay cheap; a small team with many clients is pushed up a tier — which is exactly the case where per-seat-only pricing undercharges. Client users and storage quotas gate alongside.

## 3. Proposed tiers

| | **Free** | **Studio** | **Agency** | **Enterprise** |
|---|---|---|---|---|
| Price | $0 | **$12 / seat / mo** ($10 annual) | **$25 / seat / mo** ($21 annual) | custom, annual |
| Team seats | 2 | 3 – 15 | up to 50 | unlimited |
| Active clients | 3 | 25 | unlimited | unlimited |
| Client (reviewer) users | unlimited | unlimited | unlimited | unlimited |
| Active tasks | 500 | 10,000 | unlimited | unlimited |
| Version media | external links (Drive/Dropbox/Frame.io) on every tier — MVP | | | |
| Hosted media storage (roadmap) | 1 GB | 100 GB | 1 TB | custom |
| Version history | last 3 versions | full | full | full |
| Export Ledger (CSV) | — | ✓ | ✓ | ✓ |
| Analytics page | — | ✓ | ✓ | ✓ |
| CSV Import Wizard | — | ✓ | ✓ | ✓ |
| SSO / SAML (Identity Platform) | — | — | ✓ | ✓ |
| Audit log, custom roles | — | — | — | ✓ |
| Support | community | email | priority | dedicated + SLA |

Design logic: the Free tier is a *complete* product for a freelancer with 2–3 clients — it must be genuinely useful or the funnel dies. The upgrade triggers are the natural growth moments: hiring a third teammate, landing a fourth client, or needing the ledger for invoicing (the ledger is deliberately paid — it's the "money moment" where the product touches the customer's revenue). Studio→Agency triggers on client count, team scale, and SSO. Features already exist in the codebase for everything in the Free/Studio/Agency columns except storage quotas and gating itself; the "billing engine" is the only net-new build (Stripe + a `plan` field on the workspace + rules/UI gates — roughly 2–4 weeks of work).

**Seat definition:** a seat is a membership in an organization, not a person — a freelance contractor working for three studios is a billed seat in each (the Slack/Notion model; each org receives full value from that seat). Client/reviewer users are never seats.

**Why this works for both small and big teams:** a 3-person studio pays ~$36/mo; a 40-person agency pays ~$1,000/mo — a 28× revenue spread on the same codebase, while infrastructure cost spreads only ~25× (§4), so margin *improves* with customer size. Seat-based expansion means revenue grows without sales involvement (net revenue retention >100% is achievable purely from customers hiring).

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

The cost profile comes straight from `stores/data.ts`: manager pages call `loadWorkspace()`, which reads the **entire** users, clients, projects, and tasks collections on page mount (users/clients are memoized per session; projects/tasks are re-read per page visit). So the dominant cost is `(tasks per workspace) × (manager page loads)`. Contractors read only their Slate (assigned tasks) plus visited boards; client users read only their tenant's projects/tasks. Writes (status changes, notes, versions) are 2–3 orders of magnitude fewer than reads. The only Cloud Function is `/health` — negligible.

Assumptions: managers do 2 sessions/workday × 22 days × ~4 workspace-loading page views per session ≈ **176 full-workspace reads/manager/month**. Contractors ~40 sessions × ~500 docs. Client users ~8 sessions × ~200 docs. Task docs ≈ 1–2 KB.

### 4.3 Cost per workspace per month (Firestore, current architecture)

| Workspace profile | Team | Clients | Tasks | Reads/mo | **Firestore cost/mo** | Revenue/mo | COGS % |
|---|---|---|---|---|---|---|---|
| Free (freelancer) | 2 | 3 | 300 | ~120k | **~$0.07** | $0 | — |
| Studio (small) | 5 (2 mgr) | 10 | 1,500 | ~700k | **~$0.45** | $60 | 0.8% |
| Studio (busy) | 10 (3 mgr) | 25 | 5,000 | ~2.9M | **~$1.80** | $120 | 1.5% |
| Agency | 25 (6 mgr) | 60 | 20,000 | ~22M | **~$13.50** | $625 | 2.2% |
| Agency (large) | 50 (10 mgr) | 120 | 50,000 | ~90M | **~$55** | $1,250 | 4.4% |

Add ~10–20% on top for writes, deletes, doc storage, hosting transfer, and Auth — the shape doesn't change. Two conclusions:

1. **Software-only gross margin is ~95–99%** at every tier. Firestore is effectively free relative to seat revenue.
2. Cost grows **super-linearly with workspace size** under the current load-everything architecture (reads = tasks × managers). The audit already flagged the fix (`docs/archive/AUDIT.md` E3 — pagination/limits, deferred): adding `limit()` + on-demand loading cuts the large-agency read bill by **~10×** (to ~$5/mo at 50k tasks). This should ship *before* the first large customer, not after.

### 4.4 Version media: link-based for the MVP — near-zero COGS

**Product decision (2026-07-09): media is NOT stored on the platform.** Versions carry an external link (`mediaUrl`) to the customer's own storage — Drive, Dropbox, Frame.io, etc. This means:

- **Media COGS for the MVP is ~$0.** A URL string in a version doc costs nothing beyond the ~1 KB Firestore doc it already lives in. Firestore (§4.3) is the *entire* infrastructure bill, and gross margin holds at **~95–99% on every tier**.
- The storage quotas in the tier table become a **roadmap gate**, not an MVP one. If/when hosted media ships (upload + preview in the Iteration Room is a genuine competitive feature), the economics look like: storage ~$0.026/GB/mo, download egress ~$0.12–0.15/GB — egress dominates, and preview transcodes (720p proxies, a 10–50× size cut) plus CDN caching keep it at 5–10% of revenue. That analysis is preserved here so the roadmap decision is pre-costed: worst case ~$0.35/mo per Free workspace (1 GB cap), ~$20–35/mo per Studio (100 GB), ~$200–330/mo per large Agency (1 TB) — all bounded by the quotas.
- MVP trade-off to watch: link-based media means the review experience depends on the customer's storage permissions (a client clicking a Drive link they can't open is a support ticket we can't fix). Track "media link click failures" qualitatively in early support and revisit hosted media when it becomes the top churn-adjacent complaint.

## 5. Free-tier economics: what ratio can we sustain?

Marginal cost of a free workspace, all-in:

| Component | Cost/mo |
|---|---|
| Firestore (300 tasks, 2 seats + client users) | ~$0.07 |
| Media (external links — MVP) | $0 |
| Auth | $0 below 50k total MAU, then ~$0.006/user |
| Hosting/Functions share | ~$0.01 |
| **Infra total** | **~$0.10** |
| Support/success amortized (self-serve, community support) | ~$0.10–0.30 |
| **All-in** | **~$0.20–0.40** |

A Studio workspace at 5 seats yields **~$57/mo gross margin**. That margin funds **140–280 free workspaces** at all-in cost (75–160 even under the future hosted-media scenario). Healthy freemium businesses run **10–50 free workspaces per paid** — we have 3–10× headroom beyond that. The binding constraint is therefore **conversion rate, not infrastructure**: even at a weak 1% conversion (100:1 ratio), infra roughly breaks even on the free pool; anything above ~1.5% conversion and the free tier is comfortably self-funding. The practical watch-item is the 50k MAU Auth cliff (at 100k total MAU, Auth adds ~$275/mo — trivial if even 2% converted). With link-based media there's no "free cloud storage" abuse surface in the MVP; the task/client limits are the only quotas to enforce.

**Benchmark context:** B2B freemium converts at 3–5% typically; tightly-targeted vertical tools (which Pasdiu is) reach 5–15%; the cross-product median is ~8% with a wide spread. The model below uses 2% / 4% / 8% as pessimistic / base / optimistic.

## 6. Revenue model and break-even

Blended ARPA assumption (mix of Studio and Agency): average paid workspace = 5.5 seats at a blended $13.6/seat ≈ **$75/mo ARPA**, ~95% gross margin → **~$71 contribution per paid workspace**.

### Break-even by cost structure

| Scenario | Fixed costs/mo | Paid workspaces to break even | Free workspaces implied (at 4%) | Total signups needed |
|---|---|---|---|---|
| Solo founder, bootstrap (tools, $500 ads, no salary) | ~$1,500 | **~21** | ~500 | ~530 |
| Ramen-profitable (1 founder salary $6k + costs) | ~$8,000 | **~113** | ~2,700 | ~2,800 |
| Small team (2 founders + 1 eng, $22k + $3k costs) | ~$25,000 | **~350** | ~8,500 | ~8,900 |

At 350 paid workspaces the MVP infra bill is roughly $600–1,200/mo (including the free pool; no media costs with link-based media) — 2–5% of the ~$26k MRR, consistent with the margin model.

### Conversion sensitivity (signups needed for $25k MRR ≈ 333 paid workspaces)

| Freemium conversion | Total workspace signups required |
|---|---|
| 2% (pessimistic) | ~16,700 |
| 4% (base) | ~8,300 |
| 8% (optimistic — achievable for vertical B2B) | ~4,200 |

### LTV / CAC sanity check (assumptions, to validate with data)

SMB monthly churn 3.5% → ~29-month average lifetime → **LTV ≈ $2,050** gross-margin dollars per paid workspace. Self-serve CAC for a niche vertical at $200–400 gives **LTV:CAC of 5–10×** and CAC payback of 3–6 months — healthy. If churn measures worse than ~5%/mo the model degrades quickly; churn is the number to defend (annual plans at ~17% discount, client-user lock-in, and the ledger/history as switching costs).

## 7. Key metrics dashboard

Track from day one, in order of importance:

1. **Free → paid conversion** (target ≥4%; alarm <2%) and **time-to-convert** (expect a 30–60 day median; instrument which gate triggered the upgrade — that tells you which limits are priced right).
2. **Activation rate** — % of new workspaces that create ≥1 client + ≥1 project + invite ≥1 other person in week 1. Freemium lives or dies here; unactivated signups convert at ~0%.
3. **MRR, ARPA, and seat expansion** (net revenue retention target >105% from hiring alone).
4. **Logo churn** (target ≤3.5%/mo SMB blend) and **revenue churn**.
5. **Gross margin / COGS per workspace** — instrument Firestore reads per workspace (export billing to BigQuery, label by workspace); alarm if any workspace exceeds ~$5/mo pre-media or COGS exceeds 10% of its revenue.
6. **CAC and payback** once there's paid acquisition.
7. **Client-user invites per workspace** — the viral loop (each portal invite exposes a prospective customer); measure invite→signup rate of client users who later create their own workspace.

## 8. Risks and levers

- **Read amplification** (biggest technical risk): the load-everything pattern makes one 100k-task customer cost real money. Lever: ship pagination (AUDIT E3) before enterprise deals; consider Firestore committed-use discounts once spend passes ~$1k/mo.
- **Media egress** (biggest *roadmap* COGS risk — not in the MVP, which uses external links): if hosted media ships, mitigate with preview transcodes, CDN caching, per-file caps; price Enterprise media custom.
- **Link-based media UX** (MVP risk): review experience depends on customers' own storage permissions; monitor as a churn signal and the trigger for the hosted-media roadmap item.
- **Free-tier abuse**: quota enforcement server-side (security rules + a usage doc per workspace), not just UI.
- **Under-pricing small-team/many-client cases**: covered by the client-count gate — monitor workspaces hitting the 25-client Studio gate as the Agency-tier pipeline.
- **Multi-tenancy**: today all customers share one Firebase project with tenant scoping via security rules (audited and locked down); Enterprise buyers may demand project-level isolation — price it into the custom tier.

## 9. Recommended next steps

1. Ship pagination/limits (pre-requisite for the cost model at scale).
2. Build the billing layer: workspace `plan` doc, Stripe Checkout + customer portal, gates in rules + UI (reuse the existing role-gating pattern in `router/index.ts` and `firestore.rules`).
3. Instrument metrics §7 (PostHog/Amplitude + BigQuery billing export) before launch, so the 2%/4%/8% assumption gets replaced by data within one quarter.
4. Launch pricing as proposed, but treat the first 90 days as a pricing experiment: the tier *gates* (3 clients, 2 seats) are easier to tune than the price points.

---

### Sources

- [Firestore pricing — Google Cloud](https://cloud.google.com/firestore/pricing) · [Understand Cloud Firestore billing — Firebase](https://firebase.google.com/docs/firestore/pricing)
- [Firebase pricing (plans, Auth MAU tiers, Hosting, Storage)](https://firebase.google.com/pricing) · [Firebase Hosting usage & quotas](https://firebase.google.com/docs/hosting/usage-quotas-pricing)
- [Identity Platform pricing — Google Cloud](https://cloud.google.com/identity-platform/pricing)
- [Cloud Run functions pricing guide — Modal](https://modal.com/blog/google-cloud-function-pricing-guide)
- [SaaS Freemium Conversion Rates 2026 — First Page Sage](https://firstpagesage.com/seo-blog/saas-freemium-conversion-rates/) · [Freemium Conversion Benchmarks — daydream](https://www.withdaydream.com/library/insights/freemium-conversion-rate) · [SaaS Conversion Report — ChartMogul](https://chartmogul.com/reports/saas-conversion-report/)

*Infrastructure prices verified July 2026. Revenue-side figures (ARPA, churn, CAC, session frequency) are stated assumptions pending real usage data.*
