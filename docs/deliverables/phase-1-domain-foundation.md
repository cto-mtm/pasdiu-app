# Phase 1 — Domain foundation

**Size:** M · **Depends on:** nothing · **Blocks:** everything after it

Read [README.md](README.md) first, especially the three hard constraints.

This phase is schema, rules, and seed only. No new UI. The riskiest design
decisions live here, which is why it comes before anything that builds on it.

## Scope

1. New types: `DeliverableType`, `WorkflowStage`, `WorkflowTemplate`,
   `Deliverable`.
2. Additive changes to `Task`.
3. Move `versions` from tasks to deliverables; keep `notes` on both.
4. Entitlement model: count deliverables, not stage-tasks.
5. Firestore rules for the new collections, plus the client-`revisions` fix.
6. Seed data: a default template and a default type set.

## 1. New types

All in `shared/src/types.ts`. The app re-exports these via
`app/src/lib/types.ts` (a bare `export * from '@pasdiu/shared'`), so there is
exactly one place to edit — but the app resolves `@pasdiu/shared` from
`shared/dist`, so **the user must rebuild `shared` before app code sees them**.

```ts
export interface DeliverableType {
  id: string
  orgId: string
  name: string              // "Long-form", "Short", "Clip"
  weight: number            // capacity points; unused until phase 5
  defaultTemplateId: string
  order: number
}

export interface WorkflowStage {
  id: string                // stable within its template; never reused
  name: string              // "Discovery", "Capture", "Edit", "Review", "Approval"
  optional: boolean         // skippable per deliverable (clips may skip review)
  clientFacing: boolean     // true = the client acts on this stage (phase 2b)
}

// ONE pipeline per workspace — not a template library. See § "Scope: why one
// pipeline" below before turning this into a collection.
export interface WorkflowPipeline {
  stages: WorkflowStage[]   // ordered; stored on the org doc
}

export type DeliverableStatus = 'active' | 'delivered' | 'canceled'

export interface Deliverable {
  id: string
  orgId: string
  clientId: string
  projectId: string
  subGroupId: string
  subGroupName: string      // denormalized — see § "Why denormalize"
  typeId: string
  stages: WorkflowStage[]   // SNAPSHOT taken at creation — see § "Why snapshot"
  stageSummary: StageSummaryEntry[]  // read cache — see § 3 and data-modeling.md
  name: string              // "Video 1"
  status: DeliverableStatus
  clientVisible: boolean    // gates the whole deliverable in the client portal
  latestVersionUrl: string  // denormalized so portal rows need no extra read
  order: number
  meta: MetaField[]
  createdAt: Date | null
  deliveredAt: Date | null
}

// Server-maintained projection so list views never read task documents.
export interface StageSummaryEntry {
  stageId: string
  name: string
  status: TaskStatus
  assigneeUid: string
  assigneeName: string      // denormalized; renames fan out (rare, manager-only)
  dueAt: Date | null
}
```

**No `currentStageIndex`.** See README constraint 2. The current stage is
derived, never stored.

### Why snapshot the stages

If a deliverable only referenced `templateId` and the org later reordered or
deleted stages, every in-flight deliverable's task→stage mapping would dangle.
Copying the stage list onto the deliverable at creation costs a few hundred
bytes and makes template edits safe by construction. Cheap now, painful to
retrofit.

### Why denormalize `subGroupName`

Clients cannot read the `subGroups` collection (rules scope it to
managers/contractors), and `SubGroup` has no `clientId`, so a client-scoped
read rule for it cannot even be written without a schema change. Denormalizing
the name onto the deliverable lets the client portal group by batch without
widening sub-group access. Keep it in sync when a sub-group is renamed —
a rename is rare and manager-only, so a server-side fan-out update is fine.

## 2. Task changes

Additive, in `shared/src/types.ts`:

```ts
export interface Task {
  // …existing fields unchanged…
  deliverableId: string   // NEW — '' for standalone tasks
  stageId: string         // NEW — '' for standalone tasks
}
```

Standalone tasks stay first-class: "update the brand guidelines" has no
deliverable. All existing task docs remain valid — the mapper defaults both to
`''`.

Update `mapTask` in `app/src/lib/mappers.ts`:

```ts
deliverableId: (d.deliverableId as string) ?? '',
stageId: (d.stageId as string) ?? '',
```

Add `mapDeliverable` and `mapDeliverableType` alongside it, following the same
normalize-missing-fields pattern the file's header describes.

## 3. Stage position: derive for detail, cache for lists

Two mechanisms, deliberately. Read
[data-modeling.md](data-modeling.md) for the cost analysis behind this.

### Derivation — the authority

Not a stored field. A computed helper in `app/src/lib/` next to the existing
`status.ts` helper (or inside it if it fits), so the store and components share
one implementation:

```
currentStage(deliverable, tasksForThatDeliverable):
  for each stage in deliverable.stages (in order):
    find the task whose stageId === stage.id
    if no task exists            → this stage is current
    if task is not terminal      → this stage is current
  all stages terminal            → the deliverable is complete
```

"Terminal" should reuse the existing `isDoneStatus` helper in
`app/src/lib/status.ts` — **read it first and confirm its exact semantics**
(whether it treats `approved`/`delivered`/`done` as terminal) before relying on
it. If it doesn't match what stage progression needs, add a separate predicate
rather than changing the existing one, which other surfaces depend on.

Consequences worth understanding:

- Revision loops need no special handling. A client sending work back flips the
  edit task to `revisions`, which is non-terminal, so the derived stage moves
  backwards on its own.
- Optional stages that were skipped need their task marked terminal (or not
  created at all — decide in phase 2a and keep it consistent with this helper).

Derivation costs nothing in a detail view, where the deliverable's tasks are
already loaded.

### `stageSummary` — the read cache

A list view cannot afford derivation: 50 deliverables × 5 stages would be 250
extra task reads per board page. So the deliverable carries a
`stageSummary` array, maintained by an **`onWrite` trigger on tasks** in
`firebase/functions/src/triggers/`.

This does not contradict the "clients cannot write stage position" constraint
(README constraint 2). Contractors and clients still never write it — a
trigger does, with the Admin SDK. The constraint was about *who can write*, and
that is unchanged.

Precedence: **the tasks are the source of truth.** If the summary disagrees,
the derived value wins and the trigger heals the summary. Never make a
correctness decision (rules, entitlement, approval) from the summary — it is a
display cache.

Trigger cost: one extra write per stage transition, roughly 3,000/month for a
600-clip agency, about half a cent, avoiding millions of reads.

Carry enough in the summary that a board row needs **no second read** —
including `assigneeName`, which saves a member lookup per row. Display-name
renames must fan out to the summaries; renames are rare and manager-only, so a
server-side update is fine.

## 4. Entitlement model

**Decision: count deliverables, not stage-tasks.**

Today `taskLimit` is 500 on free and 10,000 on studio
(`shared/src/plans.ts`). A single "600 clips/month" package at five stages is
3,000 tasks — free is unusable and studio is exhausted in about three months of
accumulated history. Multiplying every deliverable by its stage count is what
causes this, so raising the numbers treats the symptom. Counting the unit
agencies think they're buying fixes it.

Changes:

- `PLAN_LIMITS` in `shared/src/plans.ts` gains `deliverableLimit` per tier.
  Pick numbers with the user — they are a pricing decision, not a technical
  one. `-1` means unlimited, matching the existing convention.
- `Org` gains `deliverableLimit: number`; `mapOrg` defaults it from
  `FREE_LIMITS` exactly as the other limits do.
- `OrgUsage` gains `activeDeliverables: number`; `mapUsage` defaults it to `0`.
- `PLAN_DISPLAY_LIMITS` gains the matching display number for pricing cards.
- `firebase/functions/src/plans.ts` mirrors `PLAN_LIMITS` — keep them in sync.
- `firebase/functions/src/helpers/reconcile.ts` must learn to recount
  deliverables alongside clients and tasks, or the nightly reconciliation will
  heal the new counter to a wrong value. **Read it before editing.**

**Stage-tasks do not increment `activeTasks`.** They are created by the
server-side batch endpoint (phase 2a) using the Admin SDK, which bypasses
rules, so nothing forces a counter pairing. Manual standalone task creation
keeps its existing behavior — one task, one `increment(1)`, unchanged.

This has a reporting consequence to carry into phase 3 and any future
analytics: task counts now mix stage-tasks with standalone tasks. "350 open
tasks" reads as chaos when it is 70 deliverables progressing normally. Wherever
a number is surfaced, decide explicitly which unit it counts. The number
agencies care about is delivered deliverables per period.

## 5. Firestore rules

In `firebase/firestore.rules`. Follow the existing house style: a comment block
above each match explaining the intent and any accepted trade-off.

### New collections

**`deliverables`** — creation is functions-only. This is deliberate: it
sidesteps the counter-pairing problem in README constraint 1 entirely, because
the Admin SDK bypasses rules and does the limit check and counter write
server-side.

```
match /deliverables/{deliverableId} {
  allow read: if isManagerOf(resource.data.orgId)
    || isContractorOf(resource.data.orgId)
    || (isClientOf(resource.data.orgId)
      && resource.data.clientId == myClientIdIn(resource.data.orgId)
      && resource.data.get('clientVisible', false) == true);
  allow create, delete: if false;   // functions only (batch endpoint)
  allow update: if isManagerOf(resource.data.orgId) && orgIdUnchanged()
    && <restrict to a safe key set — name, meta, order, clientVisible>;
}
```

The client read mirrors the task rule exactly: own tenant plus an explicit
`clientVisible` flag, absent meaning hidden. Client queries must therefore
filter `where('clientVisible','==',true)` — Firestore rejects a query that
*could* return an unreadable doc. The file's header comment explains this;
re-read it before writing any query.

Approval fields (`approvedBy`, `approvedVia`, `approvedAt`) are written only
by the API in phase 2b — keep them out of the manager-updatable key set so the
audit record can't be forged client-side. `stageSummary` is trigger-written and
must be excluded for the same reason.

**`deliverableTypes`** — org configuration. Mirror the `subGroups` block:
managers write, managers and contractors read. Clients have no reason to read
it.

The workflow pipeline lives on the **org doc**, not its own collection (see
§ "Scope: why one pipeline"). The org update rule currently restricts writes to
`['name']` — widen it to permit the pipeline field, keeping every other field
(ownerUid and the whole billing block) Admin-SDK-only. Do not relax that
restriction further; it is what keeps plan and limits unforgeable.

### Change the client update rule on tasks

README constraint 3. The client branch of the `tasks` update rule currently
requires `request.resource.data.status == 'approved'`. Widen it to permit
`revisions` as well:

```
&& request.resource.data.status in ['approved', 'revisions']
```

Keep every other condition (own tenant, `clientVisible`, and the
`hasOnly(['status','completedAt'])` key restriction) exactly as-is. Update the
explanatory comment above the block — it currently states approval is
client-only, which will no longer be the whole story.

### Versions and notes

See § 6 below for the reparenting. The rules changes are:

- `hasTaskAccess(taskId)` gets a sibling `hasDeliverableAccess(deliverableId)`
  with the same three-way shape, checking membership against the parent
  deliverable's `orgId` and the client's `clientVisible`.
- The `versions` match block moves under `deliverables/{deliverableId}`.
- `notes` exists under **both** parents (see § 6).
- The notes create rule uses a strict `keys().hasOnly([...])`. Any new field on
  a note requires editing that list — unlike `invites`, where keys were
  deliberately left unconstrained. If notes gain a `stageId`, add it there or
  creates will fail.

### Usage counters

The `usage/{usageId}` update rule restricts writes to
`hasOnly(['activeClients','activeTasks'])`. `activeDeliverables` is
functions-written only, so **do not add it to that list** — leaving it out is
what makes the counter trustworthy.

## 6. Versions and notes reparenting

**Versions move to deliverables.** A version is a version *of the video*, not
of a single stage. They currently live at `tasks/{taskId}/versions/{versionId}`
and move to `deliverables/{deliverableId}/versions/{versionId}`.

**Notes exist on both.** Notes are generic threaded comments. Standalone tasks
must keep the ability to comment, and the cross-stage handoff thread needs to
live on the deliverable. So: `deliverables/{id}/notes/{id}` for the handoff
thread and version feedback, `tasks/{id}/notes/{id}` retained for task-local
discussion.

`Note.versionId` already exists and stays — it ties a note to the version it
critiques.

**Migration.** Beta data is small, which is why this happens now rather than
later. Write a one-shot script (`firebase/functions/` alongside `seed.mjs`,
Admin SDK, idempotent, safe to re-run) that:

1. For each existing task with versions, creates a deliverable wrapping that
   task if one doesn't exist, or attaches to the right one if it does.
2. Copies version docs to the new parent.
3. Copies version-linked notes to the deliverable; leaves other notes on the
   task.
4. Sets `deliverableId`/`stageId` on the affected tasks.
5. Recounts `activeDeliverables`.

Confirm the migration strategy with the user before running anything against
data they care about. Do not delete source docs in the same run — copy first,
verify, delete in a separate pass.

## 7. Seed data

`firebase/functions/seed.mjs`. Every org needs a working default so that
nobody has to configure anything before using the wizard in phase 2a. This is
a hard UX constraint, not a convenience: the plan adds seven new concepts to a
product whose users were already confused by two, and seeded defaults are what
keep that vocabulary invisible.

Seed per org:

- The default pipeline on the org doc: Discovery → Capture → Edit → Review →
  Approval. Mark Discovery `optional`. Mark Review and Approval `clientFacing`.
- Three `DeliverableType`s: Long-form (weight 15), Short (weight 3), Clip
  (weight 1). Weights are placeholders — they only need to be *relatively*
  right and orgs tune them later.
- Enough demo deliverables with stage-tasks that the board and portal have
  something to show.

Org creation (`firebase/functions/src/routes/orgs.ts`) must seed the same
defaults for real new workspaces, not just demo ones. **Read that route before
editing** — it also initializes the usage doc, which now needs
`activeDeliverables: 0`.

## 8. Scope: why one pipeline, not a template library

The beta user said the flow "can't be hardcoded rigid but needs to be dynamic
enough because it might change per agency." That is **one configurable pipeline
per workspace** — each org edits its own stages. It is not a library of
templates that an org picks between per deliverable.

The case that looks like it needs multiple templates — "clips skip review" —
is already covered by `optional` stages plus per-deliverable skipping. So a
template collection would add a collection, its rules, its CRUD UI, its seed
data, and its tests to serve a requirement nobody has stated.

**Deferring is nearly free.** Deliverables snapshot their stages at creation
(§ "Why snapshot"), so introducing a template collection later does not migrate
any in-flight work — it only changes where new deliverables read their stages
from. Add it when a second agency actually needs a second pipeline.

`DeliverableType` therefore has **no** `defaultTemplateId`. Every type uses the
workspace pipeline.

## 9. Index exemptions

Per Firestore best practices, "the main contributor to write latency is index
fanout", and single-field indexes are created automatically for every field.
The batch endpoint writes thousands of documents at once, so exemptions
directly affect its throughput.

Exempt fields that are never queried: `description`, `deliveryNote`,
`blockedReason`, `meta`, `stageSummary`, note bodies. See
[data-modeling.md](data-modeling.md) for the full read/write cost analysis.

Also: **document ids stay auto-generated.** The plan auto-numbers deliverables
"Video 1, Video 2" — that is the `name` field. Sequential document ids hotspot
and are explicitly warned against in the official guidance.

## 10. Validation schemas

`shared/src/schemas/index.ts` — follow the existing flat pattern (`z.object`,
exported schema plus an inferred input type). Add schemas for the phase 2a
endpoint payloads so the API can validate before trusting a request body:
batch-create input, and the deliverable/type shapes.

## Acceptance criteria

- [ ] All new types exist in `shared/src/types.ts` and are exported.
- [ ] `Task` has `deliverableId` and `stageId`; existing task docs load with
      both defaulting to `''`.
- [ ] `Deliverable` stores a stage **snapshot** and has **no**
      `currentStageIndex`.
- [ ] A `currentStage` helper derives position from tasks, and revision
      loops move it backwards without special-casing.
- [ ] `stageSummary` is maintained by a task `onWrite` trigger, excluded from
      every client-writable key set, and documented as a display cache whose
      authority is the tasks.
- [ ] The workflow pipeline lives on the org doc; there is **no**
      `workflowTemplates` collection and `DeliverableType` has no
      `defaultTemplateId`.
- [ ] The org update rule permits the pipeline field and still blocks
      ownerUid and every billing field.
- [ ] Mappers exist for every new entity and normalize missing fields.
- [ ] `deliverableLimit` / `activeDeliverables` exist in plans, `Org`,
      `OrgUsage`, both `plans.ts` copies, and the reconciliation function.
- [ ] Rules: `deliverables` is functions-only for create/delete, read-gated for
      clients by `clientVisible`; `deliverableTypes` mirrors `subGroups`;
      clients may now set `revisions`.
- [ ] `activeDeliverables` is **not** in the client-writable usage key list.
- [ ] Versions live under deliverables; notes exist under both parents;
      migration script written and reviewed with the user before running.
- [ ] Seeded orgs get the default pipeline and three types; new orgs created
      via the API get the same.
- [ ] Index exemptions applied for never-queried fields; document ids remain
      auto-generated.
- [ ] Rules tests in `firebase/rules-test/` cover, with both allow and deny
      cases: `deliverables` create rejected from the client SDK for every role;
      a client reading only their own tenant's `clientVisible` deliverables; a
      client setting `revisions` and `approved` but nothing else; a client
      still blocked from writing approval-attribution fields;
      `activeDeliverables` rejected from any client-SDK usage write.
- [ ] `firebase/firestore.indexes.json` reviewed for every new compound query
      (deliverables by org + project, by org + client + `clientVisible`, tasks
      by `deliverableId`). The emulator does not enforce indexes — a missing
      one throws `FAILED_PRECONDITION` only in production.
- [ ] User told to rebuild `shared` — not run for them.

## Do not

- Let any client write the current stage or `stageSummary`. (Constraint 2 —
  a trigger maintains the cache; nobody else touches it.)
- Make a correctness decision from `stageSummary`. It is a display cache.
- Add client-SDK creation of deliverables. (Constraint 1.)
- Add a `workflowTemplates` collection. One pipeline per workspace, deferred
  by design — see § 8.
- Embed stage tasks as an array inside the deliverable. This was analysed and
  rejected; see [data-modeling.md](data-modeling.md) § "Rejected architecture".
- Add branching or parallel stages. Ordered-with-optional covers the validated
  cases; branching is a much larger design and no user has asked for it.
- Add a fourth hierarchy level above sub-group. The structural change is
  inserting a level *below* it.
