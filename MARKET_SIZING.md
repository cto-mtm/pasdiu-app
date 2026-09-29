# Pasdiu — Market Sizing

**Date:** 2026-09-21 · **Status:** draft · **Companion:** `BUSINESS_MODEL.md` (pricing, unit economics)

> ⚠️ **Sourcing status.** Written without web access. Pasdiu is the hardest of the portfolio to size: no registry counts "creative teams doing client work." Figures below are **proxies**, tagged with confidence and the source to verify. Treat the SAM as an assumption to replace with data, not a fact.

## Bottom line (pitch version)

Pasdiu's category has already been valued: Adobe paid **$1.275B for Frame.io** (2021), a review-and-approval tool with over a million users. Pasdiu covers the part Frame.io doesn't: the business around the review (clients, projects, tasks, ledger). Our buyer is the small studio or agency of 4–20 people. We estimate **~50–100k** such teams across the US, Spain and LatAm. At **1% of them**, Pasdiu is a **~$400–830k ARR** business at ~93% gross margin.

## 1. The count (proxies)

| Proxy | Count | Confidence | Verify against |
|---|---|---|---|
| Adobe × Frame.io acquisition | $1.275B, 1M+ users (2021) | high | Adobe press release, Aug 2021 |
| US motion picture & video production establishments | ~20–30k | **low** | US Census *County Business Patterns*, NAICS 512110 |
| US post-production establishments | ~2.5–4k | **low** | CBP, NAICS 512191 |
| US advertising agencies | ~13–15k | **low** | CBP, NAICS 541810 |
| Spain + LatAm production companies & agencies | unknown | — | INE DIRCE (Spain), INEGI DENUE (Mexico, sectors 5121 / 5418) |
| Freelance editor collectives | unmeasured | — | Proxy only: Upwork/Fiverr video-editing categories, creator-economy reports |

Registries undercount this market: many studios are sole proprietors or loose collectives with no establishment record. They overcount it too, because not every agency does media production. The SAM below is **an assumption bounded by these proxies**.

## 2. TAM / SAM / SOM

Price basis: blended ARPA **$69/mo ≈ $828/yr** per paid workspace (80/20 Studio/Agency, `BUSINESS_MODEL.md` §6).

| Layer | Definition | Workspaces | Annual value |
|---|---|---|---|
| **TAM** | Media/creative teams doing client work, all sizes, EN + ES markets | ~250k+ (assumption) | **~$200M+/yr** |
| **SAM** | Teams of 4–20 (the Studio sweet spot), US + Spain + LatAm | ~50–100k (assumption) | **~$40–80M/yr** |
| **SOM** | ~1% of SAM in 3–5 years | ~500–1,000 paying | **~$415–830k ARR** |

**Sanity check against the business model:** the $25k MRR target (**362 paid workspaces**) is under 1% of the low SAM estimate. Bootstrap break-even is **23 paid workspaces**.

**Growth loop that sizing misses:** every client reviewer invited into a portal (free, unlimited) is often someone who works at another agency or brand. Instrument the invite → own-workspace rate (§7.7 of the business model). If it's meaningful, customers bring in new customers and acquisition cost falls.

## 3. Value created (the ROI line)

*(Assumptions. Measure during launch.)*

- **PM time:** chasing approvals, finding the latest version, and reconciling "who's on what" across WhatsApp, Drive and spreadsheets plausibly costs a studio PM **3–5 hours a week**. At $25–40/hr that's **~$300–800/mo** of time, against $49.
- **Revisions and late deliveries:** versioned review with explicit client approval removes the "which cut did the client approve?" dispute. One avoided revision round on a single project covers months of subscription.
- **Billing:** the ledger ties delivered work to invoicing, which is where the product touches the customer's revenue.

Pitch line: *"For less than one billable hour a month, the whole studio (and every client) works out of one pipeline instead of WhatsApp."*

## 4. To verify before quoting

1. Pull US Census CBP counts for NAICS 512110 / 512191 / 541810, filtered to 5–19 employees.
2. Pull Spain (INE DIRCE) and Mexico (INEGI DENUE) equivalents.
3. Replace the SAM assumption with a bottom-up list in one launch city: count agencies and studios there, then extrapolate.
4. Measure PM hours saved with the first 10 paying studios.
