# XPRIZE / Build with Gemini — Submission Form (Pasdiu)

> **Status: DRAFT.** Answers grounded in the codebase and `BUSINESS_MODEL.md` are written out in full.
> Answers that require facts only you hold (revenue, users, expenses, EIN, testimonials) are marked
> **`[NEEDS YOUR INPUT]`**. Answers blocked on work that does not exist yet are marked **`⚠️ BLOCKER`**.

---

## ⚠️ Read this before submitting — three gaps that decide the outcome

**1. There is no Gemini API call in this project. This is a Stage One pass/fail failure.**
Stage One is a pass/fail check that the project "reasonably applies the required APIs/SDKs featured in
the Hackathon," and the form states: *"If your project uses an LLM, it must use Gemini API for at least
one LLM call."* A grep across the entire repo for `gemini`, `generativeai`, `vertex`, `genkit` returns
**two** hits — this form, and `docs/deliverables/phase-5-capacity-ai.md`, which is a *plan* for an
assistant that was never built (and which specifies the Anthropic API, not Gemini). No AI SDK is a
dependency of `app/`, `firebase/functions/`, or `shared/`.

**2. "AI-Native Operations" is one of three equally-weighted Stage Two criteria, and today it scores zero.**
The criterion is "the extent to which AI is live in production and executes key decisions." The one
feature that sounds like AI — the capacity advisor shipped 2026-07-25 — is deterministic weighted
arithmetic (`weight × quantity` vs. points/day), not a model. Answering otherwise would be a
misrepresentation that the judges' verification step (live call, financial documentation) is designed
to catch.

**3. "Business Viability" requires real revenue and real users during the 90-day window.**
Stripe billing is wired end-to-end (checkout, webhooks, customer portal, plan gating), so the
*mechanism* to collect revenue exists. Whether any revenue was actually collected is a fact I don't
have. Every financial field below is left for you.

**The minimum to make this submission viable:** ship Phase 5 Part 2 (the assistant) against the
**Gemini API** rather than Anthropic, put it in production, and let it execute a real decision. The
architecture in `docs/deliverables/phase-5-capacity-ai.md` is sound and mostly provider-agnostic — the
swap is the SDK, the model id, the tool-use schema shape, and `defineSecret("GEMINI_API_KEY")` in place
of `ANTHROPIC_API_KEY`. Everything else in that doc (read-only tools, no model writes to Firestore,
confirmation before the batch endpoint, per-org rate limits) stays as written.

---

# Project overview

## General info

**Project name**

> Pasdiu

**Elevator pitch** *(200 chars max)*

> The production pipeline for media agencies: plan a month of deliverables in one pass, hand off from
> recorder to editor without losing notes, and let clients approve in their own portal.

*(179 characters.)*

---

## Project details — for public project page

### Project Story

**About the project** *(1000 words max)*

```markdown
## Inspiration

Pasdiu started with one July 2026 beta session with a media agency, and five findings that all pointed
at the same structural mistake.

Their work follows a consistent pipeline — discovery, capture, edit, review, approval — but the person
who *records* has no channel to the person who *edits*. Notes about which take was good get lost. They
sell **packages**: "30 videos a month," "600 clips a month." Creating the tasks for one is manual and
miserable at that scale. Nobody could reliably say what a "project" was versus a "sub-group" — is the
project "July," or "TikTok"? And recording happens per day, per set: set 1 shoots videos 1–3, set 2
shoots 4–6, same day.

Underneath all five was one wrong assumption every tool in this category makes: that the atomic unit of
agency work is a **task**. It isn't. "Record video 1" and "edit video 1" are not two tasks — they are
two *stages of one thing*, and that thing is a **deliverable**.

## What it does

Pasdiu inserts `Deliverable` between the batch and the task, so the domain model is:

    Org → Client → Project → SubGroup → Deliverable → Task

Every finding resolves structurally against that model. Notes live on the deliverable and survive stage
handoffs, so the recorder→editor channel exists by construction. Deliverables are countable, so "30
videos a month" becomes a real quota with a progress bar. Batches have something to create. Recording
sessions have something to schedule.

On top of that: a batch-creation wizard that lays out a month of work in one pass with a capacity
preview; a per-workspace configurable pipeline; a board where the current stage is *derived*, never
stored; an Iteration Room with a version timeline and threaded feedback; a client portal where clients
approve or request changes themselves, and managers can approve on their behalf for in-person sign-off;
a calendar for recording sessions with an outward ICS feed; an export ledger with contractor
attribution for invoicing; and package quota tracking. It ships to iOS and Android through Capacitor.
Every string exists in English and Spanish, enforced at compile time.

## How we built it

Vue 3 + Vite + TypeScript on the front end, Pinia for state, Tailwind for styling. Firebase Auth plus
Cloud Firestore for identity and data. An Express API on Cloud Functions (2nd gen) for everything that
can't be trusted to a client. Firebase Hosting serves the app; Cloud Scheduler drives a nightly usage
reconciliation; Secret Manager holds the Stripe keys; the Trigger Email extension delivers localized
invites without app code touching a mail API. A shared package (`@pasdiu/shared`) holds domain models,
plan constants, and Zod schemas, so client and API validate against the same definitions. Local
development runs entirely offline against the Firebase Emulator Suite.

## Challenges we ran into

Three constraints in the security rules each invalidated the obvious implementation, and finding them
changed the architecture.

**Multi-task batch creation is illegal from the client SDK.** Every task create is gated on
`usageDataAfter(orgId).activeTasks == usageData(orgId).activeTasks + 1`. In a batch, `get()` sees the
pre-batch counter and the rule runs for *every* create — so a batch of N with `increment(N)` asks the
rule to accept `X + N == X + 1`, true only when N is 1. The wizard's whole premise is batch creation.
Consequence: batch creation moved server-side to the Express API using the Admin SDK, which bypasses
rules and re-implements the limit check correctly against the pre-batch counter.

**Stage position cannot be a client-written field.** Contractors may only write `status`,
`completedAt`, `blockedReason`, `blockedAt`, and `deliveryNote`; clients may write `status` and only
the value `approved`. Neither can write a deliverable document at all. So a stored `currentStageIndex`
could never be advanced by the people who actually advance stages. Consequence: the current stage is
**derived** — the first stage in the deliverable's snapshot whose task isn't terminal. Zero writes,
zero drift, and revision loops work for free: when a client sends work back and the edit task flips to
`revisions`, the derived stage moves backwards on its own.

**Clients couldn't request changes at all.** The rule permitted `approved` and nothing else, so a
client could leave a note but had no way to signal "this needs work" — the agency's most common outcome
had no representation in the system. Widening that rule to permit `revisions`, plus a one-step
request-changes action, is what made the client flow work for anything other than approval.

We also learned the hard way that composite indexes are **not** enforced by the emulator: a compound
query can pass every test and throw `FAILED_PRECONDITION` in production.

## Accomplishments that we're proud of

The deliverable model earns its place — we can name the cheaper alternative (a `groupKey` on tasks) and
say exactly why it fails: cross-stage notes, versions, client visibility, approval attribution, and
package counting all need a document to live on, and a join key has nowhere to put them.

The pricing model is grounded in measured read patterns rather than a guess, and documents its own
reversal: per-seat pricing was adopted, then abandoned, because charging for a freelance camera op's
seat pushes crew *out* of the workspace and onto WhatsApp — destroying the pipeline completeness the
product depends on.

## What we learned

Read the security rules before designing the feature. Twice, the rules didn't constrain the
implementation — they *chose* it, and the version they chose was better than the one we'd have written.

Scope discipline is a written artifact, not a feeling. Our plan of record splits every item into
"validated — the beta user said it" and "extrapolated — do not build until someone asks."

## What's next for Pasdiu

The conversational assistant, on the Gemini API: describe a month of work in a sentence, have it ground
itself in package quotas and team capacity, and produce a plan the user confirms before a single
document is written. Then hosted media, so review stops depending on the customer's own storage
permissions.
```

**Built with** *(up to 25 tags)*

> vue, typescript, vite, pinia, vue-router, vue-i18n, tailwindcss, capacitor, firebase, firebase-auth,
> cloud-firestore, cloud-functions, firebase-hosting, cloud-scheduler, secret-manager, express, zod,
> stripe, esbuild, vitest, posthog, view-transitions-api, node.js, ios, android

*(25 tags. If Gemini ships before submission, drop `esbuild` and add `gemini-api`.)*

### "Try it out" links

- **Live app:** `[NEEDS YOUR INPUT]` — the Firebase project id is `pasdiu-app`, so the Hosting URL is
  presumably `https://pasdiu-app.web.app`. Confirm it's deployed and publicly reachable before
  submitting; judges will click it.
- **Demo workspace credentials:** consider seeding a read-only demo org. The five seeded accounts
  (`admin@pasdiu.test` etc., password `pasdiu123`) exist in the emulator seed, not in production.
- **Repo:** see the GitHub question under Additional info.

### Project Media

- **Image gallery** — `[NEEDS YOUR INPUT]` (up to 15, 3:2 ratio). Suggested shots, all of which exist
  in the app today: the batch-creation wizard with its capacity preview; a project board showing
  deliverable rows with stage summaries; the Iteration Room version timeline; the client portal
  approve / request-changes view; the calendar with recording sessions; the package quota widget; the
  export ledger; the pricing page.
- **Video demo link** — `[NEEDS YOUR INPUT]`. Lead with the wizard (the "one pass instead of 150 manual
  creates" moment), then the recorder→editor handoff, then a client approving in the portal.

---

## Additional info — for judges and organizers

**Upload a File**

> `[NEEDS YOUR INPUT]` — optional supporting material.

**What date did you start this project? (MM-DD-YY)**

> **07-20-26** — first commit `feat: Initialize Pasdiu project with full application stack`,
> 2026-07-20. This is after the May 19, 2026 pre-existing-resource cutoff, so all development falls
> inside the hackathon window. Verifiable from the git history (42 commits, 2026-07-20 → present).

**Submitter type (individual, team, organization)**

> `[NEEDS YOUR INPUT]` — git commits are authored as "MTM Developers", which suggests an organization
> or team rather than an individual. Answer consistently with the next question.

**Organization name and Employer Identification Number (if applicable)**

> `[NEEDS YOUR INPUT]` — required only if you selected Organization.

**Country of residence of yourself and team members**

> `[NEEDS YOUR INPUT]` — appears in the public project gallery.

**Which Category are you submitting into?**

> **Small Business Services**

Rationale: the customer is a small business (a media agency, post-production studio, or freelance
editor collective, typically 3–20 people), and the product is the operational software that business
runs on. "Professional Services Access" is the plausible alternative, but that category reads as
widening *access* to professional services for underserved buyers; Pasdiu sells operating software to
small service businesses themselves. Pick one and keep every downstream answer consistent with it —
"Category Impact" is scored against the category you name here.

**Explain how your project uses AI to impact the world, specifically in the category you have chosen.**

> ⚠️ **BLOCKER — cannot be answered truthfully today.** No AI is in the product.
>
> The answer this becomes once the Gemini assistant ships:
>
> Small media agencies lose a measurable share of every week to production administration — laying out
> a month of deliverables one task at a time, chasing which take the recorder meant, and asking clients
> for approval over WhatsApp. That work is pure overhead: it produces nothing the client bought. The
> agencies most affected are the smallest ones, because they have no producer or coordinator role to
> absorb it — the founder does it, at the direct expense of billable work.
>
> Pasdiu's assistant turns the largest of those chores into one sentence. "For the Nike TikTok project
> we need 7 videos this month, due by the 20th" becomes a grounded plan: it reads the client's package
> quota (30/month, 12 already planned), the team's capacity (3 editors, 9 working days, this batch is
> ~1.4× comfortable throughput), and the workspace's pipeline, then returns a preview the manager
> confirms. The confirmed plan goes through the same authorized batch endpoint the manual wizard uses.
>
> The impact claim is deliberately narrow and measurable: **hours of unbillable production admin
> returned to a small business per month**, and **fewer deliverables lost between stages**. Not "AI
> transforms creative work."

**How do you measure impact?**

> **Theory of change.** A small media agency's growth ceiling is coordination overhead, not demand. Every
> additional client adds a fixed administrative cost — batch setup, handoff chasing, approval chasing —
> that scales linearly and is absorbed by the owner. If that cost per client falls, the same headcount
> serves more clients, which is the difference between a 3-person studio and a 6-person one.
>
> **Hypotheses.**
> 1. Batch creation via wizard (and later via the assistant) cuts time-to-lay-out-a-month by an order of
>    magnitude versus manual task creation — the beta case is one wizard run replacing ~150 manual creates.
> 2. Deliverable-scoped notes eliminate out-of-band "which take?" questions between recorder and editor.
> 3. An in-app approval surface shortens the time from "deliverable enters review" to "client decision
>    recorded," versus chasing over WhatsApp.
>
> **Outputs measured** (the three success metrics defined in the plan of record *before* building, so the
> next beta session measures rather than guesses):
> - **Setup time** — minutes to lay out a month of work.
> - **Handoff quality** — count of clarification questions asked outside the tool.
> - **Approval latency** — time from review-entry to recorded client decision.
>
> **Product metrics instrumented alongside** (PostHog is wired into the app today; the metrics dashboard
> is specified in `BUSINESS_MODEL.md` §7): activation rate (% of new workspaces creating ≥1 client + ≥1
> project + inviting ≥1 person in week 1), free→paid conversion and which gate triggered it, logo and
> revenue churn, per-workspace COGS, and client-user invites per workspace (the viral loop — every portal
> invite exposes a prospective customer).
>
> **Outcomes expected.** Short term: agencies keep their crew *inside* the workspace instead of
> coordinating on WhatsApp, so the pipeline data is complete. Long term: clients-per-employee rises for
> workspaces that stay active past 90 days.
>
> **How we prove it.** Approval latency and setup time are computable from Firestore timestamps we
> already write — deliverable stage transitions and approval attribution are recorded. Handoff quality
> is qualitative and comes from beta interviews. `[NEEDS YOUR INPUT: any measured values from the
> hackathon window.]`

**Explain the underlying business model of your submission.**

> **B2B SaaS, self-serve, freemium, flat rate per workspace.** The buyer is a media agency,
> post-production studio, or freelance editor collective. Full detail in `BUSINESS_MODEL.md`.
>
> **Tiers.** Free ($0 — 3 seats, 3 active clients, 500 tasks, 50 deliverables, last 3 versions).
> Studio ($49/mo flat, $490/yr — up to 20 seats, unlimited clients, 10,000 tasks, ledger, analytics, CSV
> import). Agency ($149/mo flat, $1,490/yr — unlimited seats, SSO). Enterprise (custom, annual).
> Annual is 10× monthly on every paid tier — "2 months free," a 16.7% discount, which is the primary
> churn defence.
>
> **Why flat, not per-seat.** Per-seat pricing was adopted in an earlier draft and deliberately
> reversed. This product's seats have wildly unequal value: an admin runs their business on Pasdiu, a
> freelance camera op logs in three times a shoot week. Charging both turned every crew invite into a
> purchase decision, and the predictable outcome is studios keeping crew *out* of the workspace and
> coordinating over WhatsApp — which destroys the pipeline completeness the product depends on. A
> 13-person studio at $156/mo is also simply out of range in a category whose default alternative is a
> free spreadsheet. Flat pricing makes the crew invite a non-decision.
>
> **Client/reviewer users are free and unlimited on every tier, forever.** They are the deliverable
> audience, not the customer. Charging for reviewer seats is the most common way tools in this category
> kill their own network effect: every client invited into a portal is both a free marketing exposure
> and a switching cost for the agency.
>
> **Acquisition.** Self-serve signup with a genuinely complete free tier (a freelancer with 3 clients
> never has to pay), plus the portal viral loop — each client user invited is a prospective customer
> who sees the product in the context of receiving work. **Value creation:** the deliverable model
> removes coordination overhead that no task tool addresses. **Retention:** the export ledger and
> version history become the agency's system of record, and the client relationships living in the
> portal are the switching cost.
>
> **Upgrade triggers** are natural growth moments: a fourth teammate, a fourth client, or needing the
> ledger for invoicing. The ledger is deliberately paid — it is the "money moment" where the product
> touches the customer's own revenue.

**How will you sustain business operations in the future?**

> **Cost structure.** Gross margin is ~95–99% for the typical workspace. Modelled against the app's
> actual Firestore query patterns: a busy Studio workspace (10 team, 25 clients, 5,000 tasks) costs
> ~$1.80/mo in Firestore against $49 revenue — 3.7% COGS. Version media is external links (Drive,
> Dropbox, Frame.io), not hosted, so media COGS in the MVP is ~$0 and Firestore is the *entire*
> infrastructure bill. A Studio workspace yields ~$47/mo gross margin, which funds 120–235 free
> workspaces at their ~$0.20–0.40 all-in cost. Healthy freemium runs 10–50 free per paid, so there is
> 3–10× headroom. **The binding constraint is conversion rate, not infrastructure.**
>
> **Break-even.** Solo bootstrap (~$1,500/mo fixed): ~23 paid workspaces. Ramen-profitable with one
> founder salary (~$8,000/mo): ~125. Small team of three (~$25,000/mo): ~391, at which point the infra
> bill including the free pool is $700–1,400/mo — 3–5% of ~$27k MRR.
>
> **Threats, and what we do about them.**
> - *Read amplification* — the largest technical and now pricing risk. `loadProjectBoard` re-reads a
>   project's whole task set on every board visit with no `limit()`, so one pathological 150k-task
>   customer on "unlimited" Agency can consume its entire $149. Under per-seat pricing this was a margin
>   nuisance; under flat pricing it is the failure mode. Mitigation is identified and specified: a
>   `limit()` plus memo guard, and leaning on the existing `stageSummary` aggregate for board rows —
>   roughly a 10× cut at the top end. This ships before the first large customer.
> - *Flat-rate margin compression* — revenue per workspace is capped while usage is not, so the largest
>   customers are the least profitable. Levers in order: bound the reads; replace Agency's `-1` ceilings
>   with large-but-finite numbers so "unlimited" stays honest; price Enterprise custom.
> - *No seat expansion revenue* — a customer growing 3→19 people pays $49 forever. Expect NRR below 100%
>   initially; all growth comes from new logos plus Studio→Agency upgrades. If the upgrade rate measures
>   near zero, Agency needs feature differentiation (SSO, audit log, API), and that is the first lever
>   pulled — ahead of touching headline prices.
> - *Churn* — SMB monthly churn of 3.5% gives ~29-month lifetime and LTV ≈ $1,830; at 5%/mo the model
>   degrades fast. Defended with annual plans, client-user lock-in, and the ledger as switching cost.
>
> **Resource allocation and post-hackathon changes.** Engineering is the dominant cost and is
> concentrated on the read-bounding work and completing the flat-rate migration (client members must
> stop consuming seats; Stripe checkout must send `quantity: 1`). Marketing spend stays near zero until
> conversion is measured — the first 90 days after launch are explicitly run as a pricing experiment,
> tuning the gates (3 seats / 3 clients on Free, 20 on Studio) rather than the price points, which are
> far harder to change.

**Which AI tools have you leveraged while working on this project?**

> `[NEEDS YOUR INPUT — verify and complete this list before submitting.]` Evidence in the repo: the
> commit history contains merges from `claude/*` branches (2026-08-04), and `CLAUDE.md` plus
> `docs/deliverables/**` are structured as agent-facing instruction documents, indicating **Claude Code**
> was used extensively as the development agent — for implementation, code audits, architecture
> documents, and the security-rules analysis that produced the three hard constraints. Add any other
> tools you used (design, copy, research). Note this question asks about tools used to *build* the
> project, which is distinct from AI running *in* the product.

**Explain how your business model shared above is sustainable and viable.**

> **Five-year goal and market.** `[NEEDS YOUR INPUT: your target revenue and market-share figure.]` The
> modelled blended ARPA is **$69/mo** (an 80/20 Studio:Agency mix), netting ~$64 contribution per paid
> workspace after Stripe and Firestore. $25k MRR is ~362 paid workspaces.
>
> **Path to profitability.** Profitability is a function of one number — freemium conversion. At the
> base 4% assumption, $25k MRR needs ~9,050 workspace signups; at a pessimistic 2%, ~18,100; at 8%
> (achievable for a tightly-targeted vertical tool, where the benchmark range is 5–15% against a 3–5%
> general B2B baseline), ~4,530. A solo bootstrapped operation breaks even at ~23 paid workspaces —
> reachable well before any of those signup totals.
>
> **Why the model is achievable.** Gross margin is 95–99% and verified against real query patterns
> rather than assumed. LTV:CAC is 4.6–9× at a $200–400 self-serve CAC, with 3–6 month payback. For
> contrast, this is exactly the arithmetic that ruled out a cheaper $12/mo flat tier considered on the
> way here: at $12, LTV is ~$360 against that same CAC — customers churn before payback — and a single
> 20-minute support email per month consumes ~83% of the annual revenue. $49 is the floor at which a
> flat price can absorb a support conversation.
>
> **Evidence of product-market fit.** `[NEEDS YOUR INPUT.]` What the repo substantiates: the product is
> built from a documented beta session with a working agency, not from imagination, and the plan of
> record splits every feature into "validated — they said it" and "extrapolated — do not build until
> someone asks." Phases 0–2b are entirely responsive to verified pain. Real PMF evidence for judges
> needs paying customers, retention, or a testimonial — see the revenue and user-count questions below.
>
> **Honest caveat to keep in the answer:** all revenue-side figures (ARPA, churn, CAC, conversion) are
> stated assumptions pending real usage data; only the infrastructure costs are measured. Judges score
> the sustainability of the model, and a model that labels its own assumptions is more credible than
> one that presents them as findings.

**Please explain how your business operates with AI.**

> ⚠️ **BLOCKER.** Truthful answer today: **AI does not currently operate any part of the business or the
> product.** The only AI in the story is Claude Code as a development tool, which is a project-level
> answer, not a product-level one — and the question explicitly asks for both.
>
> Do not describe the capacity advisor as AI. It shipped 2026-07-25 as deterministic weighted arithmetic
> (deliverable `weight` × quantity against a team's points-per-day), with no model involved. Judges
> verify submissions with a live call.
>
> To answer this, ship the Gemini assistant and then describe: at the **project** level, what AI let a
> small team build and operate; at the **product** level, what the assistant does for customers that no
> deterministic feature could.

**Please explain the extent to which AI is live in production and executes key decisions.**

> ⚠️ **BLOCKER.** Truthful answer today: **none.** No model is live in production and no decision in the
> product is model-executed. This criterion is one of three equally weighted, so this is the single
> highest-leverage gap in the submission.
>
> Note the tension you must design around: the phase-5 architecture deliberately says **the model never
> writes to Firestore** and **nothing is written before the user confirms** — a prompt-injectable surface
> must not have write access to a multi-tenant database. That is the correct security posture and should
> not be abandoned to score this criterion. What it does mean is that "executes key decisions" has to be
> earned somewhere the blast radius is bounded. Candidates worth considering, each of which is a genuine
> decision rather than a suggestion:
> - The assistant *deciding the batch structure* — how to split 7 videos across sub-groups and a due
>   window, given quota and capacity — with the human confirming the plan rather than authoring it.
> - Autonomous *triage*: classifying incoming client feedback notes into revision-scope vs. new-work, and
>   routing the deliverable accordingly.
> - Deterministic-guardrailed *auto-assignment* of stage tasks to team members based on capacity.
>
> Whatever you choose, be precise in the answer about where the model decides and where a human confirms.
> Overstating autonomy is more damaging under verification than a narrow, true claim.

**Please explain which product from Google Cloud you used during the hackathon and how.**

> The entire backend is Google Cloud, via Firebase. All of the following are live in the `pasdiu-app`
> project:
>
> - **Cloud Firestore** — the system of record for the whole domain (orgs, members, clients, projects,
>   sub-groups, deliverables, tasks, versions, notes, packages, recording sessions, usage counters).
>   Multi-tenancy is enforced by security rules in `firebase/firestore.rules` — role-based
>   (admin/pm/contractor/client) with client-scoped filtered queries, because Firestore rejects any query
>   that *could* return unreadable docs. Rules are covered by `@firebase/rules-unit-testing` suites with
>   both allow and deny cases.
> - **Firebase Authentication** — email/password with enforced verification, password reset, and Google
>   sign-in. Roles live on member documents, not on the user identity document.
> - **Cloud Functions (2nd gen / Cloud Run functions)** — an Express API bundled by esbuild. Hosts all
>   privileged writes: the deliverable batch-creation endpoint (which exists *because* Firestore rules
>   make multi-doc batch creation impossible from the client SDK), approval, calendar/ICS, resource
>   management with cascade delete, org administration and usage reconciliation, and Stripe billing with
>   idempotent webhook handling.
> - **Firestore triggers** — `onInviteCreated` renders localized (en/es) invite email and queues it;
>   stage-summary projections are trigger-maintained so list views never read task documents.
> - **Cloud Scheduler** (via `onSchedule`) — the nightly `reconcileUsage` job recounts every org's seats,
>   active clients, and active tasks using aggregate `count()` queries (no document reads) and heals
>   drift in the client-written usage counters that the entitlement gates depend on.
> - **Secret Manager** — holds `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`, declared via
>   `defineSecret` and bound in the function's `secrets: [...]` config.
> - **Firebase Hosting** — serves the SPA; CORS on the API already allow-lists the Capacitor origins for
>   the iOS/Android builds.
> - **Firebase Extensions** — the `firestore-send-email` extension delivers queued mail over SMTP, so
>   application code never calls a mail API. The `mail` collection has no rules match block, so default
>   deny means clients can never queue email.
> - **Firebase Emulator Suite** — the entire stack runs offline under a `demo-` project id, which is what
>   makes the rules and API test suites possible.
>
> `[NEEDS YOUR INPUT: add Gemini API here once it ships — this question and the next are the ones Stage
> One reads.]`

**If your project uses an LLM, it must use Gemini API for at least one LLM call. Please explain which
LLMs are used in the project and specifically how the Gemini API is used.**

> ⚠️ **BLOCKER — this is the pass/fail question.** As of 2026-08-07 the project uses **no LLM in
> production** and makes **no Gemini API call**. There is no AI SDK in any of the three workspaces.
>
> The plan to satisfy it, per `docs/deliverables/phase-5-capacity-ai.md` with the provider swapped to
> Gemini:
> - A route in the existing Express app on Cloud Functions, registered in `VALID_ROUTES`.
> - `defineSecret("GEMINI_API_KEY")`, declared in the `secrets: [...]` array on the `onRequest` config —
>   without that declaration the deployed function never sees the value. The emulator reads
>   `firebase/functions/.env` instead.
> - Gemini function calling with **read-only** tools: look up projects, clients, deliverable types, the
>   workspace pipeline, team members, package quotas, current capacity. Grounding lookups that return
>   counts use `count()` aggregation queries, so a conversational turn never becomes a large read bill.
> - The model produces a *plan*, never a write. The confirmed plan goes through the same phase-2a batch
>   endpoint the manual wizard uses, with the same server-side authorization and limit checks.
> - Per-org rate limiting and a per-conversation token ceiling, with usage logged per org from day one.
>
> Once shipped, this answer names the exact model id and describes the call. Do not write a model id
> from memory — pull it from current Gemini API documentation.

**URL to your GitHub repo, shared with testing@devpost.com and judging@hacker.fund**

> `[NEEDS YOUR INPUT]` — the repo URL, plus confirmation you have either made it public with a license
> or added both `testing@devpost.com` and `judging@hacker.fund` as collaborators. The repo must contain
> all source. Two things to check first: `app/.env` and `firebase/functions/.env` must not be committed
> (`.gitignore` should cover them — verify), and the `README.md` documents that a prod build shipped
> without `VITE_API_URL` falls back to a `REPLACE_ME` project id, which is worth resolving before judges
> read the code.

**Upload evidence of the project running.**

> `[NEEDS YOUR INPUT]` — required uploads (pdf/png/jpg, 35MB max each):
> 1. **Monthly Google Cloud billing invoices** for the competition duration — Cloud Console → Billing →
>    Invoice. If you were on free tier or credits, export the **zero-dollar** monthly invoice or cost
>    table statement; a $0 bill still needs the document.
> 2. **Observability dashboard screenshots for any Gemini models used.** ⚠️ Not producible today —
>    there is no Gemini usage to show. This is a second, independent confirmation that the Gemini
>    integration is required for a complete submission.
> 3. **Supporting evidence** — available now: Firebase Console screenshots (Firestore document counts,
>    Auth user list, Functions invocation graphs), Cloud Scheduler run history for `reconcileUsage`,
>    Stripe dashboard showing live-mode subscriptions, PostHog dashboards, and Cloud Logging exports for
>    the API.

**Are you using any pre-existing business resources (anything that existed before May 19, 2026)?**

> `[NEEDS YOUR INPUT]` — answer honestly and specifically; this feeds the related-party revenue check.
>
> What I can establish from the repo: **the code is not pre-existing** — first commit 2026-07-20, two
> months after the cutoff. What I cannot establish, and you must answer:
> - The **beta user** — the July 2026 session is inside the window, but was that agency an existing
>   client, employer, or personal relationship before May 19, 2026? If yes, list it and say how it's
>   applied (product discovery and validation).
> - Any pre-existing **audience, mailing list, or social following** used for distribution.
> - Any pre-existing **entity, employees, contractors, or partnerships**.
> - The **Firebase/GCP project** and any domain, if either predates May 19, 2026.
> - Note that the README describes the app as built on a reusable scaffold. If that scaffold existed
>   before May 19, 2026, list it.

**Total Revenue** (hackathon period, USD, even if $0)

> `[NEEDS YOUR INPUT]`

**Revenue by Month** (May, June, July, August 2026, USD, even if $0)

> `[NEEDS YOUR INPUT]` — format: `May: $0, June: $0, July: $__, August: $__`. Development started
> 2026-07-20, so May and June are $0 by construction.

**Explain the revenue shared above.**

> `[NEEDS YOUR INPUT]` — the form wants three things: (1) price per customer, (2) what period each
> payment covers, (3) number of paying users or transactions. The price structure to reference:
> Studio $49/mo or $490/yr flat per workspace; Agency $149/mo or $1,490/yr flat per workspace. Both are
> recurring subscriptions billed through Stripe, so Stripe's dashboard is your documentation when judges
> request financial records.

**Related-Party Revenue** (from team members, family, related entities, or pre-existing customer
relationships, USD, even if $0)

> `[NEEDS YOUR INPUT]` — report this accurately even if it's uncomfortable. The form states plainly that
> it exists so judges can assess whether the business serves arms-length third-party customers.
> Specifically: if the beta-session agency is a paying customer *and* was a pre-existing relationship,
> that revenue is related-party and must be disclosed here.

**Total Expenses** (hackathon period, USD, even if $0)

> `[NEEDS YOUR INPUT]` — likely components, from what the repo shows: Google Cloud (probably $0 or near
> it on Spark/free tier given the metadata-only architecture), Stripe processing fees (2.9% + $0.30 per
> transaction — ~$1.72 on a $49 charge), PostHog (free tier at low volume), a domain, any SMTP provider
> for the mail extension, and any paid AI development tooling.

**Explain the expenses above.**

> `[NEEDS YOUR INPUT]` — the form requires a percentage split across four buckets plus the driver for
> each: (1) COGS, (2) sales and marketing, (3) R&D, (4) G&A. Guidance on how to classify, based on the
> cost model in `BUSINESS_MODEL.md`:
> - **COGS** = Google Cloud infrastructure serving customers + Stripe processing fees. Structurally tiny
>   here: a busy Studio workspace costs ~$1.80/mo in Firestore against $49 revenue, and media is external
>   links so there is no storage or egress cost at all.
> - **Sales & marketing** = likely $0 (see next question) — acquisition is self-serve and the free tier
>   is the funnel.
> - **R&D** = development tooling and any AI coding subscription; this is almost certainly the dominant
>   share of a bootstrapped hackathon expense line.
> - **G&A** = domain, any entity or accounting costs.
> If unpaid founder time is excluded from expenses, say so explicitly rather than leaving judges to infer
> it.

**Total Cost of Goods Sold (COGS)** (USD, even if $0)

> `[NEEDS YOUR INPUT]`

**Please explain the expenses associated with your COGS above.**

> `[NEEDS YOUR INPUT]` — see the COGS classification above. The substantive point worth making to
> judges: COGS is structurally near-zero because the architecture is metadata-only. Version media is an
> external link (Drive/Dropbox/Frame.io) in a ~1KB Firestore document, so there is no storage or egress
> cost — which is why gross margin holds at 95–99% on every tier, and why the free tier is self-funding
> above roughly 1.5% conversion.

**Total marketing and customer acquisition expense** (USD, even if $0)

> `[NEEDS YOUR INPUT]`

**Please explain the marketing and customer acquisition expenses you incurred.**

> `[NEEDS YOUR INPUT]` — split into (1) marketing and (2) sales. If it was $0, say so and explain the
> strategy rather than leaving it blank: acquisition is self-serve, the free tier is the funnel, and the
> client portal is the viral loop — every client user an agency invites is a prospective customer
> encountering the product in the act of receiving their work.

**Additional Expenses**

> `[NEEDS YOUR INPUT]` — anything not captured above, with a one-sentence description.

**Number of users acquired during the hackathon** (even if 0)

> `[NEEDS YOUR INPUT]` — define what you're counting and be consistent. Suggested: workspaces created
> (the unit the business model uses) with total individual accounts as a secondary figure. Note that
> client/reviewer users are real users of the product but never paying customers by design — worth
> reporting separately rather than folding into one number.

**Number of those users paying** (even if 0)

> `[NEEDS YOUR INPUT]`

**Share a verifiable testimonial by a customer or user, available publicly via a post online.**

> `[NEEDS YOUR INPUT]` — this must be **public and linkable** (LinkedIn, X, a review site), not a
> forwarded message or screenshot. The beta-session agency is the obvious candidate. If nothing public
> exists yet, this is worth chasing before the deadline; it is direct evidence for the Business
> Viability criterion, which judges score on real user relationships.

**Describe the level of learning you/your team derived from the project.** *(None / Moderate /
Significant)*

> **Significant.**
>
> Supporting detail, all documented in the repo: three Firestore security-rules constraints were
> discovered by audit and each *chose* the architecture rather than merely constraining it — batch
> creation had to move server-side because the usage-counter rule mathematically cannot accept a
> multi-document batch; stage position had to become derived rather than stored because no role that
> advances a stage is permitted to write the field; and the client approval flow was incomplete until
> the rules were widened to permit `revisions`. Separately, the pricing model was adopted, measured
> against real query patterns, and then reversed — per-seat to flat — after the seat-value asymmetry
> made the crew invite a purchase decision. And a hard operational lesson: composite indexes are not
> enforced by the emulator, so a compound query can pass every test and throw `FAILED_PRECONDITION` in
> production.

**Upload your Profit evidence (P&L)**

> `[NEEDS YOUR INPUT]` — simple P&L using the Devpost template (https://bit.ly/4w3DvwL), as pdf/png/jpg,
> 35MB max. Must reconcile line-for-line with every revenue and expense figure entered above.

---

## Agentic Economy Prize

**Are you opting into the external $50K Agentic Economy Prize?**

> **Recommended: No.**
>
> Eligibility requires Circle's Agent Stack enabling AI agents to autonomously make and/or receive
> payments, a recorded demo of a real verifiable USDC transaction, and a wallet address with a
> block-explorer URL. Pasdiu has no crypto integration, no agent payment flow, and — as of today — no
> agent. Payments run through Stripe on fiat subscriptions, which is correct for the customer (small
> media agencies paying a monthly SaaS bill) and would be actively wrong to replace with USDC.
>
> This prize is independently judged by Circle and is not a category of the main XPRIZE, so opting out
> costs nothing in the main competition. Given that the Gemini integration is itself unbuilt, engineering
> effort belongs there rather than here.

---

## Pre-submission checklist

- [ ] **Ship a Gemini API call in production.** Stage One pass/fail. Nothing below matters without it.
- [ ] Deploy and verify the public app URL loads and is usable by a stranger.
- [ ] Confirm `VITE_API_URL` is set for the prod build — otherwise the API falls back to a `REPLACE_ME`
      project id and the deployed app has a dead API (documented in `README.md`, and the deploy scripts
      do not catch it).
- [ ] Verify no `.env` files or secrets are committed.
- [ ] Share the repo with `testing@devpost.com` and `judging@hacker.fund`, or make it public with a license.
- [ ] Record the demo video and capture the image gallery.
- [ ] Export Google Cloud billing invoices for every month of the window (including $0 months).
- [ ] Screenshot the Gemini observability dashboard (requires the integration to be live and used).
- [ ] Complete every `[NEEDS YOUR INPUT]` field above.
- [ ] Build the P&L and reconcile it against the revenue and expense answers.
- [ ] Secure a public, linkable customer testimonial.
- [ ] Be reachable by email — judge requests must be answered within 2 business days, and be ready for a
      live call demonstrating the build and the business.
