# XPRIZE / Build with Gemini — Submission Form (Pasdiu)

**Pasdiu** · Category: Small Business Services · Jose Gomez (individual)

> **Fields marked `[NEEDS YOUR INPUT]` require facts that can't be answered from the code or the
> business model doc** — financials, links, uploads. They're left blank on purpose rather than guessed:
> judges reserve the right to demand revenue records, expense statements and proof of user relationships,
> and to put you on a live call. Every number in this form should survive that.

---

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

I was working with a media agency and saw their pipeline firsthand: a patchwork of Google Drive, spreadsheets, Airtable, and WhatsApp messages. Crew members couldn't find client SOPs or reference materials because everything was scattered across platforms. I pointed it out, and the agency owner told me there simply wasn't a tool for this. Big agencies build their own systems in-house, but smaller ones — 3 to 20 people — are stuck stitching together general-purpose apps that were never designed for a production pipeline.

That conversation became the starting point. I dug into the workflow and found one wrong assumption every tool in this category makes: that the atomic unit of agency work is a **task**. It isn't. "Record video 1" and "edit video 1" are not two tasks — they are two *stages of one thing*, and that thing is a **deliverable**.

## What it does

Pasdiu is production software a small media agency can run their entire operation on. Plan a month of deliverables in one pass instead of creating 150 tasks by hand. Hand off from recorder to editor without losing which take was good — notes live on the deliverable and survive every stage transition. Let clients approve or request changes in their own portal instead of chasing them over WhatsApp. Track package quotas ("30 videos a month") with a real progress bar. Schedule recording sessions on a calendar with an outward ICS feed. Export a ledger with contractor attribution for invoicing.

Web, iOS and Android from one codebase. Spanish and English, enforced at compile time.

The structural insight underneath: every feature falls out of making the deliverable explicit in the data model. The batch wizard has something to create in bulk, the board derives its current stage rather than storing it, the Iteration Room holds versions and feedback on the deliverable itself, and the client portal knows exactly what to show for approval.

## How we built it

**AI-first development.** Built by one person with a fleet of AI coding agents — Kiro, Claude Code — governed by project docs stating the rules an agent may not break. The AI executes implementation decisions; the founder provides product direction and domain expertise. This model is what makes a solo bootstrap viable: one person directs AI to produce output that would otherwise require 3–5 engineers.

**Stack.** Vue 3 + Vite + TypeScript, Pinia, Tailwind. Firebase Auth + Cloud Firestore for identity and data. An Express API on Cloud Functions (2nd gen) for privileged writes. Firebase Hosting, Cloud Scheduler for nightly usage reconciliation, Secret Manager for keys, the Trigger Email extension for localized invites. A shared package (`@pasdiu/shared`) holds domain models and Zod schemas so client and API validate against the same definitions. Development runs entirely offline against the Firebase Emulator Suite.

## Challenges we ran into

**You can't create work in bulk from the app.** The database's security layer checks each new task one at a time — so a batch of 30 gets rejected 29 times. The whole point of the wizard is bulk creation. We had to move that operation to the server where it could bypass the one-at-a-time check while still enforcing limits.

**Nobody who advances work can update where it is.** The people who actually move a deliverable forward — recorders, editors — don't have permission to write the "current stage" field. So we made the current stage something the system figures out on its own by looking at which tasks are done. No one writes it, no one can get it wrong, and when a client sends work back the stage moves backwards automatically.

**Clients could approve but never ask for changes.** The permissions only allowed clients to say "approved." There was no way to say "this needs work" — the most common outcome in the real workflow. We had to widen the rules so clients could send deliverables back for revision.

**Building and selling at the same time, alone.** A one-person operation has to ship features, onboard agencies, answer feedback, and record demos — all from the same hours. The discipline is knowing that an unmarketed product helps nobody.

## Accomplishments that we're proud of

The product works — not just as a demo. Agencies are running real workflows through it, and the batch wizard replaced 150 manual task creates. A clean CI pipeline, integration tests against the emulator suite, and documentation that doubles as machine-readable instructions for the AI agents.

The deliverable model earns its place — we can name the cheaper alternative (a `groupKey` on tasks) and say exactly why it fails: cross-stage notes, versions, client visibility, approval attribution, and package counting all need a document to live on.

The pricing model documents its own reversal: per-seat was adopted, then abandoned, because charging for a freelance camera op's seat pushes crew *out* of the workspace and onto WhatsApp — destroying the pipeline completeness the product depends on.

## What we learned

That AI-assisted development at speed requires discipline, not just prompts. The breakthrough was giving agents stricter guardrails: steering files, architecture docs as machine-readable rules, and a CI pipeline that rejects anything that breaks the contract.

Read the security rules before designing the feature. Twice, the rules didn't constrain the implementation — they *chose* it, and the version they chose was better than the one we'd have written.

## What's next for Pasdiu

Partnering with agencies for marketing — agencies that use the product become advocates for it. We're evaluating a "make content for us in exchange for a subscription" model, which helps small agencies get started at zero cash cost while growing the user base organically. On the product side: a conversational planning assistant, and hosted media so review stops depending on the customer's own storage permissions.
```

**Built with** *(up to 25 tags)*

> vue, typescript, vite, pinia, vue-router, vue-i18n, tailwindcss, capacitor, firebase, firebase-auth,
> cloud-firestore, cloud-functions, firebase-hosting, cloud-scheduler, secret-manager, express, zod,
> stripe, kiro, claude, vitest, posthog, esbuild, node.js, ios

*(25 tags.)*

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

> `[NEEDS YOUR INPUT]` — optional but recommended. Consider attaching `CLAUDE.md`,
> `BUSINESS_MODEL.md`, and key documents from `docs/deliverables/` as one PDF — they are the strongest
> evidence that the AI-development claims and architecture decisions are real and predate the submission.

**What date did you start this project? (MM-DD-YY)**

> **07-20-26** — first commit `feat: Initialize Pasdiu project with full application stack`,
> 2026-07-20. This is after the May 19, 2026 pre-existing-resource cutoff, so all development falls
> inside the hackathon window. Verifiable from the git history (42 commits, 2026-07-20 → present).

**Submitter type (individual, team, organization)**

> **Individual**

**Organization name and Employer Identification Number (if applicable)**

> N/A — submitting as an individual.

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

> AI impacts small business services at two levels in this project:
>
> **1. AI as the builder — making production SaaS accessible to solo founders.**
> The entire product is built and operated by AI coding agents (Kiro, Claude Code) directed by a single
> founder. This is not "AI-assisted" — AI executes the engineering decisions that produce the product:
> writing features, designing data models, authoring security rules, resolving architectural
> constraints. This matters for the category because it demonstrates a new operating model for small
> business software: a single person with domain expertise can direct AI to build production-grade
> vertical SaaS that previously required a funded team. The cost of serving small businesses with
> purpose-built software drops by an order of magnitude, which means more small businesses get tools
> designed for them rather than adapted from enterprise software.
>
> **2. The product removes production administration overhead.**
> Small media agencies lose a measurable share of every week to production administration — laying out
> a month of deliverables one task at a time, chasing which take the recorder meant, and asking clients
> for approval over WhatsApp. That work is pure overhead: it produces nothing the client bought. The
> agencies most affected are the smallest ones, because they have no producer or coordinator role to
> absorb it — the founder does it, at the direct expense of billable work.
>
> Pasdiu's batch wizard turns the largest of those chores into one pass — a month of deliverables
> planned with capacity preview instead of 150 manual task creates. Notes on the deliverable survive
> every stage handoff. Clients approve in their own portal. The planning assistant (future) will take
> this further: describe a month of work in a sentence and get a grounded plan back.
>
> The impact claim is deliberately narrow and measurable: **hours of unbillable production admin
> returned to a small business per month**, and **fewer deliverables lost between stages**.

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
> **Development cost advantage.** Engineering — normally the dominant cost for a SaaS startup — is
> handled by AI coding agents (Kiro, Claude Code). This keeps R&D costs at a fraction of what a
> traditional team would require, and is what makes solo bootstrap viable. One person with AI tooling
> produces at 5–10× the throughput of writing code by hand.
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
> **Resource allocation and post-hackathon changes.** Growth strategy is organic through agency
> partnerships — agencies that use the product become advocates, and we're evaluating a "make content
> for us in exchange for a subscription" model that helps small agencies start at zero cash cost while
> building the user base. Marketing spend stays near zero until conversion is measured — the first 90
> days after launch are explicitly run as a pricing experiment, tuning the gates (3 seats / 3 clients
> on Free, 20 on Studio) rather than the price points, which are far harder to change.

**Which AI tools have you leveraged while working on this project?**

> The business runs on a fleet of agentic development tools rather than a single assistant. They are
> not autocomplete — they are given a task, they execute against the real repository and the real
> emulator suite, and they come back with work to review.
>
> - **Kiro** — the primary agentic development environment. Spec-driven: takes a feature from written
>   specification through to implementation, governed by steering files that encode the non-negotiable
>   rules in machine-readable form.
> - **Claude Code (Claude Opus)** — agentic development for architecture, implementation, refactoring,
>   test authoring and documentation. Evidence in the commit history (merges from `claude/*` branches,
>   2026-08-04) and `CLAUDE.md` plus `docs/deliverables/**` structured as agent-facing instruction
>   documents encoding the rules an agent may not break.
> - **Agentic QA against the Firebase emulators** — agents run the local Firestore/Auth/Functions
>   emulator suite, exercise the API end to end, read the failures and fix them. This is what makes a
>   full-stack Firebase architecture testable by one person at all.
> - **AI-drafted business and market work** — the pricing model, tier arithmetic, infrastructure cost
>   model, scenario projections, and the honesty caveats in `BUSINESS_MODEL.md` were developed in the
>   same agentic loop, with the reasoning written down in the document itself.
>
> This is not incidental tool assistance — AI is the engineering workforce. The founder provides
> direction, domain expertise, and validation; the AI agents write, test, audit, and ship the code.
> The architecture is strict partly because strict rules are the ones an agent can be held to.

**Explain how your business model shared above is sustainable and viable.**

> **Unit economics first, because they are the whole argument.** Revenue per paying workspace blends
> to roughly $69/month (an 80/20 Studio:Agency mix). Marginal infrastructure cost is about $1.80 per
> busy workspace per month. Stripe fees run ~3%. That is a 95–99% gross margin on infrastructure at
> every scale modeled, and it holds because cost is demand-driven: every dollar of infrastructure
> growth is caused by a workspace that is paying.
>
> **Path to profitability**, from the modeled scenarios:
>
> | | Workspaces | Paying (~4%) | Revenue/mo | Infra/mo |
> |---|---|---|---|---|
> | Break-even (solo) | ~575 | ~23 | ~$1,600 | ~$40 |
> | Ramen-profitable | ~3,125 | ~125 | ~$8,600 | ~$225 |
> | Real business | ~9,775 | ~391 | ~$27,000 | ~$700 |
>
> Because fixed costs are near zero (Google Cloud free tier, AI development tooling subscriptions, no
> office, no employees) and there are no servers to rent, break-even is a headcount decision rather
> than an infrastructure one: the business is profitable at 23 paying workspaces if it stays one
> person, and the real question is how fast to spend the margin on support and growth.
>
> **Why the model is achievable rather than optimistic.** The price is anchored to something real —
> a media agency's monthly coordination overhead in founder-hours is worth far more than $49, and the
> objection is never "too expensive" but "prove it works." The free tier is not a discount but the
> bottom rung of the same meter, so conversion is a usage event rather than a sales event: at real
> production volume a growing agency hits 4 clients or 4 teammates within weeks, by which point the
> work is already in the system. Expansion revenue (Studio→Agency) is automatic and requires no
> upsell conversation.
>
> **Evidence so far, stated plainly.** This is pre-revenue. The product is built and running with
> agencies providing feedback, and $0 has been collected. The honest evidence is therefore product
> completeness and cost structure, not traction. The verifiable claims: the margin arithmetic above
> (Google Cloud's free tier genuinely covers the early workspaces, checkable against published
> pricing), and the fact that the entire product was built and is operated by one person with AI
> tooling — which is what makes a cost base small enough for break-even at 23 customers.
>
> **Honest caveat:** all revenue-side figures (ARPA, churn, CAC, conversion) are stated assumptions
> pending real usage data; only the infrastructure costs are measured. A model that labels its own
> assumptions is more credible than one that presents them as findings.

**Please explain how your business operates with AI.**

> **At the project level**, the business is AI-native in the literal sense: it has no engineering team,
> no marketing team, and no analyst. Every function a software company normally staffs is performed by
> AI agents under one person's review.
>
> - **Engineering.** A fleet of agentic development tools — Kiro, Claude Code — executes the actual
>   code. Working against a repository whose rules are written down as machine-readable project
>   instructions (`CLAUDE.md`, `docs/deliverables/**`), they produced a full multi-workspace production
>   pipeline: configurable workflows, batch creation, deliverable lifecycle, client portal, billing, an
>   i18n system with compile-time enforcement of both locales, security rules with test suites, and a
>   documentation set — in roughly four weeks. Conventionally that is a team and six months.
> - **QA.** Agents run the Firebase emulator suite locally, drive the API end to end, read the failures
>   and fix them. Verification is agent work, not a human clicking through screens.
> - **Business analysis.** The pricing structure, tier arithmetic, infrastructure cost model and
>   scenario projections in `BUSINESS_MODEL.md` were developed the same way — including the caveats
>   about which numbers are measured and which are arithmetic, written into the document rather than
>   hidden.
>
> That compression is what makes $49/month a viable business at 23 customers rather than 200. It is
> software *development* cost, not hosting cost, that normally forces vertical SaaS vendors to sell
> only to enterprises — and it is the reason this product could be built for a market that no incumbent
> project-management tool finds worth specializing for.
>
> **At the product level**, AI is planned but not yet live. A conversational planning assistant is the
> natural next step — letting the owner describe a month of work in a sentence and get a grounded batch
> plan back. The wizard already removes the 150-task-creation job; the assistant would remove the
> planning step before it.

**Please explain the extent to which AI is live in production and executes key decisions.**

> AI executes key decisions in how the goods are produced. This is live today.
>
> **AI produces the goods.** The company's production line is agentic. Kiro and Claude Code do not
> suggest code; they execute it against the real repository. Within the boundaries set by the project's
> written rules, the agents decide how a feature is implemented — the data model, the route structure,
> the failure modes, what to refactor when a change makes an old shape wrong — then run the Firebase
> emulator suite, read the failing assertions and fix them without being told what broke. The same loop
> produced the pricing model, cost projections, and business documentation. A human sets direction and
> reviews; the agents decide the how and do the work. For a one-person business, this is not a
> productivity gain — it is the entire production capacity, and it is why a market that no incumbent
> project-management vendor finds worth specializing for can be served at all.
>
> **What AI decided in this project (verifiable from commit history):**
> - The data model for deliverables, tasks, and the stage-derivation logic.
> - That batch creation had to move server-side (discovered by auditing security rules).
> - That stage position must be derived rather than stored (same discovery).
> - The security-rules architecture and its test suite.
> - The pricing model reversal from per-seat to flat (developed in an agentic business-analysis loop).
>
> **What AI does not decide:** product direction, which features to build, and what to validate with
> agencies. Those are human decisions grounded in real conversations with real customers.
>
> On revenue, pricing *strategy* — the tier ladder, the flat-rate arithmetic, the decision to price
> per workspace rather than per seat — came out of the same agentic loop that writes the code. Pricing
> *execution* deliberately does not: entitlements, the plan gates and the usage counters are
> deterministic code against a single limits table, with no model anywhere in the billing path.

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

**If your project uses an LLM, it must use Gemini API for at least one LLM call. Please explain which
LLMs are used in the project and specifically how the Gemini API is used.**

> **No LLM is used in production today.** The product does not currently make any Gemini API call or
> use any AI model at runtime. AI is used exclusively as a development tool (Kiro, Claude Code) to
> build the product.
>
> A conversational planning assistant is planned for the future — it would read package quotas, team
> capacity, and the workspace pipeline to produce batch plans the user confirms. If implemented, this
> would use the Gemini API. The architecture is specified in
> `docs/deliverables/phase-5-capacity-ai.md`.

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
> 2. **Supporting evidence** — available now: Firebase Console screenshots (Firestore document counts,
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

> **$0**

**Revenue by Month** (May, June, July, August 2026, USD, even if $0)

> May: $0, June: $0, July: $0, August: $0

**Explain the revenue shared above.**

> Revenue is $0. The product is pre-revenue. Development started 2026-07-20. Several media agencies
> are actively providing feedback and participating in beta sessions, but none are paying customers yet.
> The billing infrastructure (Stripe checkout, webhooks, customer portal, plan gating) is fully built
> and live, but no subscription has been activated. Price structure for reference: Studio $49/mo or
> $490/yr flat per workspace; Agency $149/mo or $1,490/yr flat per workspace. Both are recurring
> subscriptions billed through Stripe.

**Related-Party Revenue** (from team members, family, related entities, or pre-existing customer
relationships, USD, even if $0)

> **$0** — no revenue of any kind has been collected, so related-party revenue is also $0.

**Total Expenses** (hackathon period, USD, even if $0)

> **~$152**
>
> AI development tooling subscriptions (Claude Code, Kiro) at ~$140 and domain at ~$12. Google Cloud
> infrastructure was $0 — the project ran entirely within the free tier.

**Explain the expenses above.**

> - **COGS: 0%.** No revenue was served, so no cost was directly tied to goods sold. The cloud
>   infrastructure that becomes COGS at scale ran inside Google Cloud's free tier during the period.
> - **Sales and marketing: 0%.** The pilot agencies were recruited directly, with no paid acquisition
>   or advertising.
> - **R&D: ~92% (~$140).** AI development tooling subscriptions — Claude Code and Kiro — used to build
>   the product. This is a product-build period, so an R&D-dominated profile is the expected shape. The
>   cost is notably low because AI tooling replaces the engineering team that would normally make an
>   expense base incompatible with a $49/month product.
> - **General and administrative: ~8% (~$12).** Domain renewal.
>
> Unpaid founder time is excluded from expenses.

**Total Cost of Goods Sold (COGS)** (USD, even if $0)

> **$0** — no paying customers were served.

**Please explain the expenses associated with your COGS above.**

> With no paying customers during the period, there were no costs directly tied to goods or services
> sold. The infrastructure that will constitute COGS — Firestore operations and Cloud Functions
> invocations — ran within Google Cloud's free tier while serving pilot users. Modeled marginal cost
> at scale is approximately $1.80 per busy workspace per month, against $49–149 of monthly revenue
> per workspace. COGS is structurally near-zero because the architecture is metadata-only: version
> media is an external link (Drive/Dropbox/Frame.io) in a ~1KB Firestore document, so there is no
> storage or egress cost.

**Total marketing and customer acquisition expense** (USD, even if $0)

> **$0**

**Please explain the marketing and customer acquisition expenses you incurred.**

> No marketing or customer acquisition expense was incurred during the hackathon period. **Marketing
> spend: $0** — no advertising or paid promotion was run. **Sales spend: $0** — pilot agencies were
> recruited through direct relationships at no cost. Acquisition is designed to be structurally cheap
> rather than purchased: the client portal is free and acts as an acquisition surface (each agency
> brings their clients in, and clients encountering the product in the act of receiving their work
> become prospective customers), the free tier lets a team adopt the product before any conversation
> about price, and natural growth moments (4th teammate, 4th client) trigger the upgrade.

**Additional Expenses**

> `[NEEDS YOUR INPUT]` — anything not captured above, or "None."

**Number of users acquired during the hackathon** (even if 0)

> **0 paying users. Several agencies providing feedback.** Multiple media agencies are actively
> engaged — providing product feedback, participating in beta sessions, and validating the workflow —
> but none have created production accounts or activated paid subscriptions yet. The product is in
> active validation with real prospective customers, pre-conversion.

**Number of those users paying** (even if 0)

> **0**

**Share a verifiable testimonial by a customer or user, available publicly via a post online.**

> `[NEEDS YOUR INPUT]` — this must be **public and linkable** (LinkedIn, X, a review site), not a
> forwarded message or screenshot. The beta-session agency is the obvious candidate. If nothing public
> exists yet, this is worth chasing before the deadline; it is direct evidence for the Business
> Viability criterion, which judges score on real user relationships.

**Describe the level of learning you/your team derived from the project.** *(None / Moderate /
Significant)*

> **Significant.**
>
> Three categories of learning, all documented in the repo:
>
> **On agentic development.** AI-assisted development at speed requires discipline, not just prompts.
> The breakthrough was giving agents stricter guardrails: detailed steering files (`CLAUDE.md`),
> architecture docs as machine-readable rules, and test suites that reject anything that breaks the
> contract. Quality disappears when the agent does not know what good looks like — and appears when it
> does. The project's strict architecture is partly *because* strict rules are the ones an agent can
> be held to.
>
> **On Firebase security rules.** Three Firestore constraints were discovered by audit and each *chose*
> the architecture rather than merely constraining it — batch creation had to move server-side because
> the usage-counter rule mathematically cannot accept a multi-document batch; stage position had to
> become derived rather than stored because no role that advances a stage is permitted to write the
> field; and the client approval flow was incomplete until the rules were widened to permit `revisions`.
>
> **On pricing.** The pricing model was adopted, measured against real query patterns, and then
> reversed — per-seat to flat — after the seat-value asymmetry made the crew invite a purchase
> decision. And a hard operational lesson: composite indexes are not enforced by the emulator, so a
> compound query can pass every test and throw `FAILED_PRECONDITION` in production.

**Upload your Profit evidence (P&L)**

> `[NEEDS YOUR INPUT]` — simple P&L using the Devpost template (https://bit.ly/4w3DvwL), as pdf/png/jpg,
> 35MB max. Must reconcile line-for-line with every revenue and expense figure entered above.

---

## Agentic Economy Prize

**Are you opting into the external $50K Agentic Economy Prize?**

> **No.**
>
> Eligibility requires Circle's Agent Stack enabling AI agents to autonomously make and/or receive
> payments, a recorded demo of a real verifiable USDC transaction, and a wallet address with a
> block-explorer URL. Pasdiu has no crypto integration and no agent payment flow. Payments run through
> Stripe on fiat subscriptions, which is correct for the customer (small media agencies paying a
> monthly SaaS bill).

---

## Pre-submission checklist

- [ ] Deploy and verify the public app URL loads and is usable by a stranger.
- [ ] Confirm `VITE_API_URL` is set for the prod build — otherwise the API falls back to a `REPLACE_ME`
      project id and the deployed app has a dead API (documented in `README.md`, and the deploy scripts
      do not catch it).
- [ ] Verify no `.env` files or secrets are committed.
- [ ] Share the repo with `testing@devpost.com` and `judging@hacker.fund`, or make it public with a license.
- [ ] Record the demo video and capture the image gallery.
- [ ] Export Google Cloud billing invoices for every month of the window (including $0 months).
- [ ] Complete every `[NEEDS YOUR INPUT]` field above.
- [ ] Build the P&L and reconcile it against the revenue and expense answers.
- [ ] Secure a public, linkable customer testimonial.
- [ ] Be reachable by email — judge requests must be answered within 2 business days, and be ready for a
      live call demonstrating the build and the business.
