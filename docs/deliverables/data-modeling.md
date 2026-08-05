# Data modeling & read-cost analysis

Firestore bills per document read, so the schema is a cost model, not just a
correctness model. This document records the analysis behind the plan's query
design, the numbers that motivated it, and one architecture that was considered
and rejected — so it does not get re-proposed later.

Read alongside [README.md](README.md).

## Verified pricing (July 2026, standard edition)

| Operation | Per 100,000 |
|---|---|
| Document reads | $0.03 – $0.06 |
| Document writes | $0.09 – $0.18 |
| Document deletes | $0.01 – $0.02 |

Low end is single-region (us-central1), roughly double for US multi-region.
Free tier is **50,000 reads/day for the whole Firebase project** — not per
user, not per workspace. A write costs about 3× a read.

Sources: [Firestore pricing](https://cloud.google.com/firestore/pricing) ·
[Firestore billing](https://firebase.google.com/docs/firestore/pricing)

## The governing principle

**Embed what you read. Keep documents for what you write and query.**

List views should never read the documents behind the rows they summarize.
Detail views read the real documents, one entity at a time. Counters never read
documents at all — they use aggregation queries.

## Current-state analysis (before this plan)

Two patterns dominate cost, and both are problems today independent of
deliverables.

### `loadProjectBoard` is unbounded

`app/src/stores/data.ts` queries every task in a project with no `limit()`.
Pagination (`PAGE_SIZE = 1000`) exists only for the flat task list, not the
board.

For a 600-clip/month agency six months in — 3,600 deliverables × 5 stages =
**18,000 task documents per board open**:

- one open ≈ 18,000 reads ≈ $0.005–0.011
- one manager at 20 opens/day = **360,000 reads/day**, 7× the entire project's
  daily free tier from a single user
- ten managers ≈ 108M reads/month ≈ **$32–65/month for one agency**

Cost is the second problem. 18,000 documents in browser memory makes the board
unusable well before the bill matters.

### `loadWorkspace` is unmemoized and over-broad

It loads up to 1,000 projects + 1,000 tasks and is mounted by Dashboard,
AllTasks, Analytics, Ledger, TeamMember, and OmniSearch. `loadUsers` and
`loadClients` memoize; `loadAllProjects` and `loadAllTasks` do not — they
replace state on every call. So every navigation between manager surfaces
re-pays ~2,000 reads.

`ClientDetailPage` and `TeamPage` each pull all 1,000 tasks to display one
client's or one member's subset.

### A correctness bug, not just a cost one

Analytics and Ledger compute over whatever `loadAllTasks` returned — the first
1,000 documents by document id. At 18,000 tasks those pages are **silently
wrong**, not merely slow. Deliverables will trigger this in month two.

### Writes are not the problem

The batch endpoint creating 600 deliverables + 3,000 tasks per month is 3,600
writes ≈ **half a cent**. Reads dominate by roughly 1000×. Design for reads.

## Rejected architecture: embedding stage tasks in the deliverable

**Proposal considered:** store stages as an array of objects inside the
deliverable document, so reading one deliverable returns all its stage state in
a single read, and the `tasks` collection shrinks 5×.

The read math is real — 6 reads collapse to 1. It was rejected for three
reasons.

### 1. Security rules cannot express per-element authorization

Today a contractor updates a task and the rule checks
`assigneeUid == request.auth.uid` with a restricted key set. With embedded
stages, the rule would have to verify the caller modified **only their own
element** of a variable-length array. The rules language has no loops and no
element-wise array diffing — whole-array equality, `.size()`, and fixed-index
access are the available primitives.

Consequence: every stage status change routes through the API with the Admin
SDK. That puts a function invocation and cold-start latency on the most
frequent interaction in the product, and gives up optimistic writes.

### 2. It breaks scheduling

You cannot range-query a field inside an array of maps. "My stages due this
week" is not expressible. The standard workaround — denormalizing a flat
`activeAssigneeUid` + `activeDueAt` — covers only the *current* stage.

Phase 4 schedules **future** capture stages onto shoot days weeks ahead, and
the calendar queries by `dueAt` range. Embedded, those dates live in array
elements and the calendar would have to load every deliverable and filter
client-side. The feature does not survive.

(`array-contains` on a denormalized `assigneeUids` does solve the basic "show
me my work" case. It is the date-range and future-stage queries that fail.)

### 3. The read win is confined to detail views

| View | Today | Embedded | Documents + `stageSummary` |
|---|---|---|---|
| Board, 50 deliverables | 3,600+ | 50 | **50** |
| Deliverable detail | 6 | 1 | 6 |
| Contractor queue, 40 items | 40 | ~40 + client filtering | **40** |

Embedding and `stageSummary` are identical on the expensive path. Embedding
wins five reads on a detail view opened one at a time — paid for with the
permission model, the scheduling queries, and a rewrite spanning ~20 app files,
8 function sources, the rules, the indexes, `seedTask` in the test helpers, the
reconciliation logic, and the seed script.

**Do not re-propose this.** If it ever becomes tempting, the blocker to
re-check first is rules expressiveness for array elements.

## The design

### 1. `stageSummary` on the deliverable

A compact, server-maintained projection so list views never read task
documents:

```ts
export interface StageSummaryEntry {
  stageId: string
  name: string
  status: TaskStatus
  assigneeUid: string
  assigneeName: string   // denormalized; renames fan out (rare, manager-only)
  dueAt: Date | null
}
```

Maintained by an `onWrite` trigger on tasks. Carry **enough that a board row
never needs a second read** — including assignee display names, which saves a
member lookup per row.

**This revises the phase 1 "derive, never store" decision.** The original
constraint stands: contractors and clients cannot write stage position. A
*trigger* can. So:

- **Derivation stays the authority** in detail views, where the tasks are
  already loaded and it costs nothing.
- **The summary is a read cache** for list views.
- If they disagree, the tasks win and the trigger heals the summary.

Trigger cost: one extra write per stage transition, ~3,000/month for the
600-clip agency ≈ half a cent, to avoid millions of reads.

### 2. Aggregation queries for every counter

`count()` bills **one read per 1,000 index entries matched**, with a one-read
minimum. Counting 600 deliverables costs 1 read instead of 600; counting
100,000 costs ~100.

Applies to quota tracking (phase 3), analytics, and the capacity advisor
(phase 5). No counter anywhere should scan documents.

Source:
[Aggregation queries](https://firebase.google.com/docs/firestore/query-data/aggregation-queries)

### 3. Paginate the board, scope it by batch

Boards read deliverables, not tasks, one sub-group (batch) at a time, ~50 per
page. 18,000 reads → ~50. Task documents are read only when a deliverable is
opened.

**Shipped, with one deviation.** `loadProjectBoard` now pages sub-groups —
newest 2 by `order` descending, with "load earlier" for the rest — and reads
tasks and deliverables scoped to that window via `subGroupId in [...]`
(chunked at Firestore's 30-value `in` cap). The deviation: it still reads
**task** documents, not deliverables alone, because the kanban and list layouts
are task-based and remain the default. The unbounded-per-project read is gone
either way — reads now scale with the size of a batch, not with a project's
history. Dropping tasks from the board entirely would mean making the
deliverables layout the only one, which is a product decision, not a data one.

**Paging key is `order`, not a timestamp.** `SubGroup` has no `createdAt`, but
`order` is assigned as the project's sub-group count at creation, so descending
`order` is newest-first — no schema change and no backfill. Ties (two
sub-groups created concurrently landing on the same `order`) are safe:
`startAfter(snapshot)` disambiguates on `__name__`.

### 4. Denormalize `latestVersion` onto the deliverable

Otherwise the portal pays a subcollection read per row to show the current cut.

### 5. Fix the existing load patterns

- ~~Memoize `loadAllProjects` / `loadAllTasks`~~ **Superseded by live
  listeners.** The org-wide flat collections (members, clients, projects and
  tasks first-window, invites, per-uid assigned tasks) are now `onSnapshot`
  listeners in `app/src/stores/data.ts`: the first attach bills the same reads
  as the old full fetch, after which only server-side *changes* are billed and
  pushed. Paired with the persistent IndexedDB cache
  (`app/src/lib/firebase.ts`), a reload resumes from the last sync token and
  re-pays only the delta — so both the TTL staleness problem and the
  reload-repays-everything problem are gone for these collections, and their
  refresh buttons with them. The 5-minute TTL memo **remains for the scoped
  pull loads** — board window (`board:{projectId}`), client-detail subset
  (`clientProjects:`/`clientTasks:{clientId}`), ledger — whose refresh
  controls pass `force`.
- ~~`ClientDetailPage` and `TeamPage` should query their subset~~ **Done.**
  ClientDetail pulls its client's projects/tasks (TTL + refresh); Team gets
  per-member active counts from `count()` aggregations instead of loading
  every org task to display ten numbers.
- ~~Analytics and Ledger must stop computing over a 1,000-document page~~
  **Done.** Every number on Analytics comes from `count()` aggregations
  (status, per-client, per-assignee-active, project total). The Ledger has its
  own query — `orgId` + `status in DONE_STATUSES` + `completedAt desc`, paged
  at 200 with load-more — instead of filtering the org window.

**Removal discipline, post-listeners.** A live listener must never have its
window pruned behind its back — it only pushes *changes*, so locally deleted
docs it still vouches for would stay gone until they next change. That is why
`loadProjectBoard` no longer prunes a project's out-of-window tasks from the
store: `loadChildrenOfSubGroups` reconciles exactly the sub-group windows it
re-reads (dropping in-window docs the fresh read didn't return), the org-wide
listener owns removals for its own window, and the board *renders* only tasks
whose sub-group is loaded (`ProjectBoardPage`'s `windowTasks`). For the same
reason, components must not keep **private** load flags: `OmniSearch` and
`SlatePage` both had one, both outlived the pages that pruned the store, and
both are gone in favour of the store's listeners/memos.

### 6. Index exemptions

Per the official best practices, "the main contributor to write latency is
index fanout," and single-field indexes are created automatically for every
field. Exempt fields that are never queried: `description`, `deliveryNote`,
`blockedReason`, `meta`, note bodies. Cuts storage and batch-write latency.

### 7. Keep collections top-level

The rules are written against `resource.data.orgId` throughout, and
subcollections force parent lookups (the existing `taskData()` helper for
`versions`/`notes` shows the cost). With `stageSummary`, a deliverable's tasks
are rarely needed in bulk anyway, so the scoping benefit largely evaporates.

### 8. Two operational rules from the docs

- **Auto-generated document IDs only.** Monotonically increasing ids hotspot.
  The plan auto-numbers deliverables "Video 1, Video 2" — that is the `name`
  field. Doc ids stay auto-generated, as the existing code does.
- **500/50/5 ramp-up.** Start at 500 ops/sec on a new collection, +50% every
  5 minutes. Relevant to a batch endpoint writing thousands of documents into a
  brand-new collection.

Source: [Best practices](https://firebase.google.com/docs/firestore/best-practices)

## Expected outcome

| | Before | After |
|---|---|---|
| Board open | 18,000 reads | ~50 |
| Dashboard | ~2,000 reads | a handful of aggregation reads |
| Per-agency monthly | $32–65 | $1–3 |

The important property is not the absolute number — it is that reads stay flat
as a workspace's history grows. The current design scales reads with total data
volume, which is the shape that produces a surprise bill.

## Compound queries needing index review

The emulator does **not** enforce composite indexes; a missing one throws
`FAILED_PRECONDITION` only in production. Review
`firebase/firestore.indexes.json` for each of these as it is introduced:

- deliverables by `orgId` + `projectId` + `subGroupId` (+ `order`)
- deliverables by `orgId` + `clientId` + `clientVisible` (portal)
- deliverables by `orgId` + `projectId` + `typeId` + `deliveredAt` range (quotas)
- tasks by `orgId` + `deliverableId`
- tasks by `orgId` + `assigneeUid` (+ `dueAt` range)
- recording sessions by `orgId` + `projectId` + `date` range

Added by board paging (all three are in `firestore.indexes.json`):

- sub-groups by `orgId` + `projectId` + `order` **descending** — the paging
  query itself. The pre-existing `projectId` + `order` ascending index does
  not serve it: different field set, opposite direction.
- tasks by `orgId` + `subGroupId` — the `in` chunk. `in` is a disjunction of
  equality filters, so this is an ordinary two-equality composite.
- deliverables by `orgId` + `subGroupId` — same query for the deliverables side.

Added by the load-pattern fixes (all in `firestore.indexes.json`):

- tasks by `orgId` + `status` + `completedAt` **descending** — the ledger's
  completed-work query (`status in` + `orderBy` needs the composite).
- tasks by `orgId` + `assigneeUid` + `status` — the per-member active-count
  aggregation. `count()` has the same index requirements as the query it
  counts.
- tasks by `orgId` + `status` + `dueAt` — the Task Queue's server-side
  fallback. When the org outgrows the live window and a status cut is active,
  the page queries `status in [...]` directly (paged by `dueAt`) instead of
  filtering an incomplete window client-side. `in` is a disjunction of
  equalities, so this one index also serves the aggregate "In Review" cut.
  (The queue is status-only by design: per-person lives on the team member
  page via the assigned-tasks listener, per-client on the client page — so
  no assignee-flavored composites exist.)

Added by the Schedule page + ICS calendar feed (`routes/calendar.ts`):

- tasks by `orgId` + `dueAt` — manager schedule/feed range queries. This one
  was ALREADY needed: CalendarPage's month query has used it since phase 4
  with no index entry, passing in the emulator (which doesn't enforce
  indexes) and destined to throw `FAILED_PRECONDITION` in production.
- tasks by `orgId` + `assigneeUid` + `dueAt` — contractor schedule/feed.
- sessions by `orgId` + `date` — schedule + CalendarPage month queries (the
  existing `orgId`+`projectId`+`date` composite cannot serve them: `projectId`
  sits between the two fields, so the prefix doesn't match). Same latent
  phase-4 production bug, same fix.

**Priority needs no index.** Deliverable priority is sorted in memory on the
board and in the portal, both of which already hold the full set they render.
Making it a Firestore `orderBy` would add an index to every deliverable query
for no benefit.
