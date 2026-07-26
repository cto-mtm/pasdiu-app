# Phase 2a — Internal pipeline: batch creation, handoff, notifications

**Size:** L · **Depends on:** phase 1 · **Validation gate — stop here and show
the beta user before building 2b**

Read [README.md](README.md) first, especially constraints 1 and 2.

This is where the agency-side value lands: creating a month of work in one
action instead of dozens, and closing the recorder→editor handoff gap that
motivated the whole initiative.

## Scope

1. Server-side batch-create endpoint (required — client SDK cannot do this).
2. Batch-create wizard UI.
3. Deliverable detail view + task-level stage context.
4. Stage handoff prompt.
5. "Up next" notification when a stage becomes current.
6. Board query scoping (existing performance cliff, made worse by this phase).

## 1. Batch-create endpoint

### Why server-side

README constraint 1: the task-create rule requires the post-batch usage counter
to equal pre-batch + 1, evaluated per create, so any multi-task batch is
rejected. Committing one at a time means N sequential round-trips with no
atomicity — a failure halfway leaves a half-built batch and a drifted counter.
The Admin SDK bypasses rules, so the endpoint does the limit check once and
writes everything atomically.

This also gives phase 5's AI assistant a target: the assistant and the wizard
call the identical endpoint, which is what keeps the AI layer thin.

### Where

The existing Express app: `firebase/functions/src/api.ts` mounts routers from
`firebase/functions/src/routes/`. Add a router following the shape of
`routes/orgs.ts`.

Suggested route: `POST /orgs/:orgId/deliverables/batch`

**Also add it to the `VALID_ROUTES` array in `api.ts`** — that list is
maintained by hand and feeds the 404 response.

Auth: `requireAuth` middleware from `helpers/auth.ts` verifies the bearer ID
token and email verification, attaching `req.user`. Authorization is separate —
**the endpoint must verify the caller is a manager (`admin`/`pm`) of
`:orgId`** by reading `orgs/{orgId}/members/{uid}`. `requireAuth` proves
identity, not role. Check how `routes/orgs.ts` does this and reuse the pattern.

### Behavior

Input (validate with a Zod schema from `shared/src/schemas/index.ts`):

- target project, sub-group (existing id or a new name to create)
- deliverable type id
- count
- optional per-stage assignee lists
- optional due window
- naming pattern for auto-numbering

Steps:

1. Verify caller is a manager of the org.
2. Load the workspace pipeline from the org doc; **snapshot** its stages onto
   each deliverable.
3. Check `usage.activeDeliverables + count` against
   `org.deliverableLimit` (`-1` = unlimited). Reject with a clear error before
   writing anything — this is the check the rules cannot do correctly.
4. Create the sub-group if a new name was passed.
5. For each deliverable: create the deliverable doc with the stage snapshot,
   then one task per stage.
6. Increment `activeDeliverables` by `count` in the same commit.
7. Return the created ids plus a summary.

Firestore batches cap at 500 operations. `app/src/stores/data.ts` chunks at 400
(`BATCH_LIMIT`) for exactly this reason. 100 deliverables × 5 stages is 600
docs, so **chunking is mandatory**. Chunked writes are not atomic across
chunks — either use a transaction where it fits, or make the endpoint
idempotent and clean up on partial failure. Do not silently leave a half-built
batch.

Pace the chunks per the official **500/50/5 rule** — start around 500
operations/second against a new collection and ramp by 50% every 5 minutes.
`deliverables` will be brand new, and the first large batch is exactly the
traffic shape that rule exists for.

### Assignee distribution

"Edit" across 30 clips is not one editor — it is three editors, roughly ten
each. The per-stage assignee input accepts **multiple** uids and distributes
round-robin across the batch. A single-assignee input is the degenerate case.
Without this, agencies with more than one person per craft cannot use the
wizard for the large batches it exists to serve.

### Capacity arithmetic in the response

Phase 5 owns the full weights-and-points advisor, but the beta user explicitly
asked for advice on breaking down large batches and will be creating large
batches the moment this ships. Return simple arithmetic the wizard can preview
without any weight machinery: deliverable count, total task count, per-assignee
task counts, and the due window. "35 tasks across 3 editors, roughly 12 each,
due in 9 days" is most of the value.

## 2. Wizard UI

A guided flow on the project board. Steps: type → count → template → target
sub-group → per-stage assignees → due window → **preview** → confirm.

The preview step is not optional. It shows what will be created (N deliverables
× M stages = X tasks), the per-assignee split, and any limit warning, before
anything is written. It is also the exact surface phase 5's assistant will
reuse, so build it as a component that takes a plan object rather than
inlining it.

Limit handling: if the batch would exceed `deliverableLimit`, say so in the
preview with the actual numbers and a path to upgrade — never let it fail at
commit time.

`ImportWizard.vue` already exists in `app/src/components/` and is a multi-step
flow. **Read it first** — reuse its structure, and reuse the plan-gated
component patterns rather than inventing new ones.

## 3. Deliverable views

### Deliverable detail

Stage progress (derived — see phase 1 § 3), the cross-stage notes thread,
version history, and links to each stage's task.

Route it under the existing patterns in `app/src/router/index.ts` with
`meta.roles` of `['admin','pm','contractor']` (the client's view is phase 2b
and lives in the portal). Navigation from the board should use a hero
transition: matching `view-transition-name` derived from the deliverable id,
unique per page, CSS as a numbered recipe in
`app/src/assets/css/transitions.css`. **Read `docs/animations.md` first.**

### Task-level stage context

When a task has a non-empty `deliverableId`, `IterationRoomPage.vue` shows:
which stage it is (`stage 3 of 5`), the previous stage's handoff note, and a
link up to the deliverable. When `deliverableId` is empty the page renders
exactly as it does today.

**Contractor and board UX otherwise does not change.** Contractors still work a
task queue. That is the point of putting the deliverable above the task rather
than replacing it.

### The board reads deliverables, not tasks

Creating all stage tasks upfront means 30 clips × 5 stages = 150 tasks the
moment the wizard runs, most unactionable ("edit clip 22" before clip 22 is
shot).

**Decision: create all tasks upfront in `backlog`, and never list them.** The
alternative (lazily creating each task on stage advance) breaks phase 4, which
needs future capture tasks to exist so they can be scheduled onto shoot days,
and breaks pre-assignment.

The board renders **deliverable rows**, each showing its stage state from the
`stageSummary` field (phase 1 § 3) — no task reads at all. Task documents load
only when a deliverable is opened. Paginate at ~50 deliverables per page,
scoped to one sub-group.

This is both the UX fix and the cost fix: 18,000 reads per board open becomes
~50. See [data-modeling.md](data-modeling.md) for the arithmetic. Contractor
queues still query tasks by `assigneeUid` directly, which is exact and cheap.

## 4. Stage handoff prompt

**This is the highest-value-per-hour item in the plan.** Moving notes onto the
deliverable means the recorder's notes *live* somewhere findable. It does not
mean the recorder ever writes them. Without a prompt, the field stays empty and
the editor is exactly as blind as before — the original complaint, relocated.

The mechanism already exists and works. `Task.deliveryNote` is prompted at
status change today: `TaskCard.vue` and `IterationRoomPage.vue` ask "how/where
was it delivered?" when a task moves to `delivered`, with copy already keyed in
both locales in `app/src/i18n/locales/pages/board.ts`, and the rules already
permit the assigned contractor to write that field alongside `status`.

Generalize it: **completing any stage task prompts for a handoff note** aimed
at the next stage's owner ("which takes are good, what should the editor
know"). Reuse the existing prompt component and the existing permitted key
set — no rules change needed, because `deliveryNote` is already in the
contractor's allowed keys.

The note must surface on the deliverable thread and on the next stage's task,
not just on the task that produced it.

Make it required-ish, not required: a skip is allowed but the prompt is the
default path. Blocking completion on a text field will just get empty strings
typed into it.

## 5. "Up next" notification

Notes travelling is half the loop; the editor learning they can start is the
other half. Without this the handoff still depends on someone remembering to
send a WhatsApp message.

**Ship one channel, not two.** Start with the **in-app "up next" queue** —
tasks whose stage just became current. Contractors live in the app, the
surface already exists (`SlatePage.vue` — check whether it should host this
rather than adding a page), and it costs no email templates in two locales.

The `stageSummary` trigger from phase 1 already runs on task writes and knows
when a stage becomes current, so this is a query against existing data, not new
infrastructure.

Add email only if the in-app queue proves insufficient in practice. When that
happens, the infrastructure is ready: `firebase/functions/src/helpers/mail.ts`
exposes `queueMail(db, id, {to, subject, html, text})`, writing to `mail/{id}`
for the firestore-send-email extension, with **deterministic ids so a
retriggered function overwrites instead of double-sending**. `onInviteCreated`
is a working example of the trigger→queueMail pattern and
`email/inviteEmail.ts` shows the template shape including locale handling. Use
an id like `stage-{deliverableId}-{stageId}` so retries are safe.

Note that `mail/` has no rules match block, so it is functions-only by default
deny. That is deliberate anti-spam. Do not add a match block.

## 6. Fix the existing read patterns

Two problems exist in the code **today**, independent of this plan. Deliverables
turn both from "slow someday" into "broken in month two", so they get fixed
here. Full analysis and numbers in [data-modeling.md](data-modeling.md).

**`loadProjectBoard` is unbounded.** It fetches every task in a project with no
`limit()` — the `PAGE_SIZE` pagination applies only to the flat task list. At
six months of a 600-clip package that is 18,000 documents per board open, which
is 7× the project's entire daily free read quota from one manager's day of
work. Section 3 above replaces it with paginated deliverable rows.

**`loadWorkspace` is unmemoized and over-broad.** `loadUsers` and `loadClients`
memoize; `loadAllProjects` and `loadAllTasks` do not, so every navigation
between Dashboard, AllTasks, Analytics, Ledger, TeamMember, and OmniSearch
re-pays ~2,000 reads. `ClientDetailPage` and `TeamPage` each pull all 1,000
tasks to display one client's or one member's subset — replace those with
filtered queries.

**Analytics and Ledger are silently wrong at scale.** They compute over
whatever `loadAllTasks` returned — the first 1,000 documents by document id.
At 18,000 tasks the numbers are incorrect, not merely stale. Move them to
aggregation queries (`count()` bills one read per 1,000 index entries) or
precomputed rollups. This is a correctness fix, so do not defer it as an
optimization.

## Acceptance criteria

- [ ] `POST /orgs/:orgId/deliverables/batch` exists, is listed in
      `VALID_ROUTES`, validates its body with a shared Zod schema, verifies the
      caller is a manager of the org, and rejects over-limit batches before
      writing.
- [ ] Batch writes chunk below 500 ops and do not leave partial state on
      failure.
- [ ] Stage assignees distribute round-robin across multiple people.
- [ ] The wizard previews the plan (counts, per-assignee split, limit warnings)
      before writing, as a component that takes a plan object.
- [ ] Deliverable detail shows derived stage progress, the notes thread, and
      versions; navigation uses a hero transition per `docs/animations.md`.
- [ ] Tasks with a deliverable show stage context; standalone tasks are
      unchanged.
- [ ] The board renders deliverable rows from `stageSummary`, paginated (~50)
      and scoped to one sub-group, reading **zero** task documents.
- [ ] Completing a stage task prompts for a handoff note, reusing the existing
      `deliveryNote` mechanism; the note surfaces on the deliverable thread and
      the next stage's task.
- [ ] The next assignee sees an in-app "up next" entry. Email is **not** built
      in this phase.
- [ ] `loadWorkspace`'s expensive loads are memoized or replaced;
      `ClientDetailPage` and `TeamPage` query their subset instead of all
      tasks.
- [ ] Analytics and Ledger no longer compute over a 1,000-document page.
- [ ] All new strings in `en` and `es`.
- [ ] The batch endpoint ships with the mandatory coverage matrix from
      `docs/testing.md`: 401 unauthenticated, 403 unverified email, 403 wrong
      org, 403 contractor/client role, happy path with response-shape
      assertions, and side-effect assertions on raw Firestore state
      (deliverable count, task count, `activeDeliverables`, stage snapshot
      contents). Add an over-limit case asserting nothing was written, and a
      chunking case above 500 ops.
- [ ] New seed factories added to `firebase/functions/test/helpers.ts` rather
      than hand-written docs in test files.
- [ ] `firebase/firestore.indexes.json` reviewed for the new board and
      deliverable queries.

## Validation gate

Before starting 2b, put this in front of the beta user with real data. Confirm:

- Does the stage model match how their work actually flows?
- Do stages ever run in parallel or get skipped in ways the ordered model
  can't express?
- Is the handoff prompt actually being filled in, or skipped every time?

If the model is wrong, redirecting costs one phase here and four phases later.
