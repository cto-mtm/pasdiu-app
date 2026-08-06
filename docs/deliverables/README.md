# Deliverables & Production Pipeline — Implementation Plan

Plan of record for the deliverables initiative. Derived from a beta-user session
(July 2026) plus a code audit of the current data layer, Firestore rules, and
client portal.

Each phase has its own file and is independently shippable. Read this file
first — it holds the model, the vocabulary, and three hard constraints that the
phase docs assume you already know.

## The problem

Five findings came out of the beta session:

1. Work follows a consistent pipeline (discovery → capture → edit → review →
   approval), but the person who records has no channel to the person who
   edits. Notes get lost. The pipeline must be configurable per agency, not
   hardcoded.
2. Agencies sell **packages** — "30 videos/month", "600 clips/month", "4
   long-form + 12 shorts". Some may sell per-goal instead of per-period.
3. Task creation is manual and painful at package scale. It should be
   automated, eventually driven by an AI assistant, with advice to break large
   batches into manageable pieces.
4. Users can't tell what a "project" is versus a "sub-group". Is the project
   "July" or "TikTok"?
5. Recording happens per day, per set — set 1 records videos 1–3, set 2 records
   videos 4–6, both on the same day.

## The core insight

The atomic unit is wrong. The thing that flows through an agency is not a task,
it is a **deliverable** — a video, a clip, a short. "Record video 1" and "edit
video 1" are today two disconnected tasks; they are really two *stages* of one
deliverable.

Inserting a `Deliverable` between `SubGroup` and `Task` resolves finding 1
structurally (notes live on the deliverable and survive stage handoffs), makes
finding 2 countable, gives finding 3 something to batch-create, and gives
finding 5 something to schedule.

## Domain model (target)

```
Org
└── Client
    └── Project          the ongoing engagement or goal ("TikTok", "Course Launch Q3")
        └── SubGroup     a batch within it ("July", "Teasers")   [aka campaign]
            └── Deliverable   one video/clip/short ("Video 1")
                └── Task       one stage of it ("Record video 1")
```

`Task` keeps its existing status enum and its existing board/portal UX. The
deliverable is an organizing layer above it, not a replacement. Contractors
still work a task queue exactly as they do today.

Tasks with no deliverable stay legal (`deliverableId: ''`) — "update the brand
guidelines" is a standalone task. All existing data remains valid without
migration.

### Project vs. sub-group (finding 4)

**Project = the engagement. Sub-group = the batch.** So: project "TikTok",
sub-group "July". Not the reverse.

This is a *recommendation enforced by copy, not by schema* — agencies doing
per-goal work legitimately invert it (project "Course Launch Q3", sub-groups
"Teasers"/"Webinar"/"Ads"). But the mechanics push toward the default because:

- Packages are "30/month" attached to an engagement. If the project were
  "July", the engagement would have no durable home and quota tracking would
  have nothing stable to attach to.
- Briefs are stable per engagement; batches churn. Stable things belong on the
  project, churning things on the sub-group.
- A recurring package can later auto-generate the monthly sub-group — which
  only works if months are sub-groups.

Phase 0 ships the explainer UI for this.

## Three hard constraints (verified against the codebase — do not re-litigate)

These were discovered by reading the rules and store. Each one invalidates an
obvious-looking approach. Do not "simplify" a phase doc back into one of them.

### 1. Multi-task batch creation is illegal from the client SDK

`firebase/firestore.rules` gates every task create on:

```
usageDataAfter(orgId).activeTasks == usageData(orgId).activeTasks + 1
```

`get()` sees the pre-batch counter, `getAfter()` sees the post-batch counter,
and the rule runs for *every* create in the batch. A batch creating N tasks
with `increment(N)` asks the rule to accept `X + N == X + 1` — true only when
N is 1. `createTask` in `app/src/stores/data.ts` is built to exactly that
constraint: one task, one `increment(1)`, one commit.

`underTaskLimit` compounds it: it reads the pre-batch counter, so every create
in a batch sees the same "room available" and a batch can overshoot the plan
limit.

**Consequence:** all batch creation runs server-side through the Express API in
`firebase/functions`, using the Admin SDK (which bypasses rules). See phase 2a.

### 2. Stage position cannot be a client-written field

Contractors may only write `status`, `completedAt`, `blockedReason`,
`blockedAt`, `deliveryNote` on a task. Clients may only write `status`
(and only the value `approved`) plus `completedAt`. Neither role can write a
deliverable document at all. So a stored `currentStageIndex` could never be
advanced by the people who actually advance stages.

**Consequence:** the current stage is **derived**, never stored. It is the
first stage in the deliverable's snapshot whose task is not in a terminal
state. Zero writes, zero drift — and revision loops work for free (when a
client sends work back and its edit task flips to `revisions`, the derived
stage moves backwards automatically).

### 3. Clients cannot request changes today

The client update rule permits `status == 'approved'` and nothing else. A
client can leave a note but cannot move an item into a "needs changes" state,
so the agency has no signal to react to.

**Consequence:** phase 1 widens that rule to permit `revisions` as well, and
phase 2b ships a "request changes" action that sets the status and attaches
the note in one step. Without this, the intended client flow only works when
everything is approved.

## Scope discipline — validated vs. extrapolated

This plan comes from **one** beta user. Several pieces are responses to what
they actually said; others are extrapolation from "agencies will probably want
this." Keeping the two separate is what stops this from becoming a product
built for imagined customers.

**Validated — they said it, build it:**

- A consistent pipeline whose stages vary per agency
- The recorder→editor handoff losing notes
- Packages as quantity × period, possibly per-goal instead
- Automated batch creation, with advice for large batches
- Project vs. sub-group confusion
- Recording happening per day, per set
- The client portal being the approval surface, nudged over WhatsApp
- Manager approval on the client's behalf for in-person sign-off

**Extrapolated — do not build until someone asks:**

- **Multiple workflow templates per org.** They need *their* pipeline
  configurable, which is one pipeline per workspace with skippable stages —
  not a template library. Deferred in phase 1.
- **Revision-round limits** (`includedRevisions`). Nobody mentioned selling
  revision rounds. Phase 3 flags it as unvalidated.
- **Weighted capacity points.** Responsive to a real question ("how do I
  compare a long-form to a clip?") but the simple arithmetic in phase 2a may
  answer it well enough. Phase 5 is validation-gated.
- **The AI assistant.** Explicitly requested, but the wizard may make it
  unnecessary. Ship 2a, then check whether anyone still wants to talk to it.

**Where the line sits.** Phases 0 through 2b are responsive to verified pain
and form a coherent product on their own — you could stop after 2b and have
shipped the thing your beta user described. Phases 3, 4, and 5 each address a
real stated need but are additive, and each should be re-confirmed before it
starts rather than executed because it appears in this document.

**Why the Deliverable entity is not over-engineering.** The cheaper-looking
alternative is a `groupKey` on tasks so "record video 1" and "edit video 1"
share an id, with no new entity. It fails because cross-stage notes, versions,
client visibility, approval attribution, and package counting all need a
document to live on — a join key has nowhere to put them, so every field would
be denormalized onto every task in the group. The client portal also needs to
show 30 things rather than 150, and without a deliverable document there is
nothing to render. The entity earns its place.

## Sizing and order

| Phase | Scope | Size | Depends on |
|---|---|---|---|
| [0](phase-0-orientation-ux.md) | Project/sub-group explainers, sub-group metadata | S | — |
| [1](phase-1-domain-foundation.md) | Types, schemas, rules, seed, entitlement model | M | — |
| [2a](phase-2a-internal-pipeline.md) | Batch endpoint, wizard, deliverable views, handoff, notifications | L | 1 |
| [2b](phase-2b-client-portal.md) | Portal rebuild, approve/request-changes, attribution, proxy approval | L | 2a |
| [3](phase-3-packages-quotas.md) | Packages, quota tracking, revision limits | M | 2a |
| [4](phase-4-sessions-calendar.md) | Recording sessions, calendar page | M | 2a |
| [5](phase-5-capacity-ai.md) | Capacity weights, advisor, AI assistant | L | 2a, 3 |

[data-modeling.md](data-modeling.md) is cross-cutting rather than a phase: read
it before writing any query. It holds the read-cost analysis, the rejected
"embed stage tasks in the deliverable" architecture, and the index-review list.

Phase 0 ships first even though phase 1 is the foundation: it is pure copy, it
takes days not weeks, and it answers the beta user's most-repeated confusion
while the foundation is being built. Everything else follows the dependency
order.

**Validation gate after 2a.** Put phases 0–2a in front of the beta user before
building 2b onward. If the deliverable/stage model is wrong, redirecting is
cheap there and expensive later.

## Cross-cutting rules for every phase

From `CLAUDE.md`, non-negotiable:

- **i18n.** No hardcoded user-facing strings. Every string is a key in a
  per-feature module under `app/src/i18n/locales/**`, resolved via `useI18n()`'s
  `t()`. `en` is the source of truth and `es` is typed `typeof en`, so both
  locales change in the same commit or it is a compile error. New modules
  register in `app/src/i18n/index.ts` in **both** the `en` and `es` blocks.
- **Animation.** Page transitions go through the View Transitions wrapper in
  `app/src/router/index.ts` — never call `document.startViewTransition`
  elsewhere. Hero transitions use matching `view-transition-name` derived from
  the item id, unique per page. Animate only `transform`/`opacity`, 200–350ms.
  All transition CSS lives in `app/src/assets/css/transitions.css` as numbered
  recipes. Read `docs/animations.md` first.
- **Data access.** All Firestore access goes through the `data` store at
  `app/src/stores/data/` (one slice per collection, composed in `index.ts`).
  Components never call the SDK directly. Doc→model conversion lives in
  `app/src/lib/mappers.ts`, which deliberately has no firebase imports.
- **Builds.** Do not run `vite build`, `npm run build`, `cap sync`, or any
  build command unless explicitly asked, and do not offer to. The dev server
  and emulators are run by the user.
- **Shared package.** The app consumes `@pasdiu/shared` from `shared/dist`
  (`app/src/lib/types.ts` is a bare `export * from '@pasdiu/shared'`). Type
  edits require a shared rebuild, which **the user runs** — flag it, don't run
  it.

### Testing — read `docs/testing.md` before writing any route or rule

Two layers, both emulator-backed. Three things in there bind this plan
directly:

1. **Every new protected route ships with the mandatory coverage matrix**:
   unauthenticated → 401, unverified email → 403, wrong org → 403, insufficient
   role → 403, happy path with response-shape assertions, and side-effect
   assertions on raw Firestore state (counters, denormalized fields). Deny
   paths get tests, not just happy paths. `firebase/functions/test/orgs.test.ts`
   is the reference implementation. This applies to every endpoint in phases
   2a, 2b, and 5.

2. **Rules changes get rules tests** in `firebase/rules-test/`. This plan
   changes tenancy-critical rules — a new functions-only collection, a widened
   client status permission, reparented subcollections. Each needs both allow
   and deny cases.

3. **Composite indexes are NOT enforced by the emulator.** A compound query can
   pass every test and throw `FAILED_PRECONDITION` in production. This plan
   adds many compound queries — deliverables by org + project, by org + client
   + `clientVisible`, tasks by deliverable, sessions by date range. **Review
   `firebase/firestore.indexes.json` whenever you add one.** This is the most
   likely way for this work to look finished and then break in production.

Test helpers live in `firebase/functions/test/helpers.ts` and are the only
sanctioned way to build docs and requests — new seed factories go there rather
than being hand-written per test.

## Glossary

- **Deliverable** — one sellable output (a video, clip, short). The unit
  agencies count and clients approve.
- **Deliverable type** — "Long-form", "Short", "Clip". Carries a capacity
  weight and a default workflow template.
- **Pipeline** — the workspace's ordered list of stages, editable per org and
  stored on the org doc. One per workspace, not a template library.
- **Stage** — one step of the pipeline ("Capture"). Instantiated as one task
  per deliverable.
- **Stage snapshot** — the copy of the pipeline's stages stored on a
  deliverable at creation, so later pipeline edits can't corrupt in-flight
  work.
- **Stage summary** — a trigger-maintained projection of stage states on the
  deliverable, so list views never read task documents. A display cache; the
  tasks are the authority.
- **Package** — what the agency sold: line items of type × quantity × period.
- **Recording session** — a booked shoot: a date, a set/location, and the
  capture tasks being shot there.
- **Priority** — `high | normal | low` on the deliverable, defaulting to
  `normal`. Sets what gets worked and reviewed first; sorted in memory (see
  data-modeling.md), never a Firestore `orderBy`. Set for a whole batch in the
  create wizard, then per deliverable from the board or its detail page.

## Task status: seven in the model, four in the picker

`TaskStatus` still has all seven values, but only **backlog / in_progress /
blocked / done** are offered anywhere a human picks one
(`MANUAL_TASK_STATUSES` in `app/src/lib/status.ts`). The other three are
written by flows, not people:

- `approved` and `revisions` — by the client portal's approve / request-changes
  actions. Constraint 3 above is what makes this load-bearing: the rules permit
  a client to write **exactly** those two values, so they cannot be removed
  from the enum without dismantling client approval.
- `delivered` — by the handoff flow.

The kanban board folds all three into one **In Review** column so work sitting
with the client stays visible without being something anyone can drag into. A
task already parked in one of those statuses keeps that value listed in its own
select, so the control never displays a status the task isn't in.

This is why "simplify the statuses" landed as a picker change rather than an
enum change: four states is what the pipeline needs now that deliverables carry
stage progress, but the other three are still the vocabulary the client flow
speaks in.

## Open questions to validate with the beta user

Answered so far:

- *Do clients approve in-app?* **Yes** — heavily. The agency nudges over
  WhatsApp ("check Pasdiu and approve the vids, leave feedback there") because
  it beats sending each video by message. Managers also need to approve on the
  client's behalf for in-person reviews. This is why 2b is a full phase.

Still open:

- Do stages ever run in parallel, or get skipped? (Assumed: strictly ordered
  with optional/skippable stages covers it. Branching is explicitly out of
  scope.)
- Can a campaign span more than one project? (Assumed: no. If yes, the
  sub-group mapping breaks and needs rework.)
- Does per-stage capacity matter, or is per-person enough? (Assumed: per-person
  is enough for v1.)

## Success metrics

Define these before building so the next beta session measures rather than
guesses:

- **Setup time** — time to lay out a month of work, from dozens of manual task
  creates to one wizard run.
- **Handoff quality** — whether editors stop asking "which take?" out of band.
- **Approval latency** — time from a deliverable entering review to a client
  decision recorded in-app.
