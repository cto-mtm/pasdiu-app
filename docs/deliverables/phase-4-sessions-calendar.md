# Phase 4 — Recording sessions & calendar

**Size:** M · **Depends on:** phase 2a (needs capture tasks to schedule)

Read [README.md](README.md) first.

## The workflow being modeled

From the beta session: "recording tends to happen per day, a set is booked and
many videos are recorded on a certain set. Maybe set 1 has video 1, 2, 3 then
set 2 is 4, 5, 6, both on the same day."

And the stated end goal, which is the thing to work backwards from: **"show an
individual task 'record video 1' on day one of recording."**

So a session is a booked shoot — a date, a set, and the deliverables being
captured there. Two sets on one day are two sessions that a day view groups
together. This is scheduling, not hierarchy: it does **not** add a level to the
Org → Client → Project → SubGroup → Deliverable → Task tree.

## 1. The `RecordingSession` type

In `shared/src/types.ts`:

```ts
export interface RecordingSession {
  id: string
  orgId: string
  clientId: string
  projectId: string
  name: string          // "Set 1"
  location: string      // set / studio / address
  date: Date | null
  startsAt: Date | null // optional time-of-day
  endsAt: Date | null
  taskIds: string[]     // the capture-stage tasks being shot here
  notes: string
  createdAt: Date | null
}
```

Referencing **tasks** rather than deliverables is deliberate: what gets
scheduled is the capture stage specifically, and a deliverable might in
principle be re-shot in a later session.

Mapper in `app/src/lib/mappers.ts` (normalize `taskIds` to `[]`), Zod schema in
`shared/src/schemas/index.ts`, rules mirroring `subGroups` (managers write,
managers and contractors read — a contractor needs to see the shoot they are
working).

Whether clients see the shoot schedule is a product question — ask the user.
Default to no.

## 2. Booking

Booking tasks into a session sets `dueAt` on those capture tasks to the session
date. That is what makes them appear correctly on the calendar and in
contractor queues.

This is why phase 2a creates all stage tasks upfront rather than lazily: future
capture tasks must exist to be scheduled.

Managers can write `dueAt` directly under the existing task rules, so this is
straightforward client-side work through `app/src/stores/data.ts` — **unless**
you are updating many tasks at once, in which case chunk below the 500-op batch
cap the way `commitDeletes` already does (`BATCH_LIMIT = 400`).

Note that task **updates** are not usage-counter-gated, so the batch-create
blocker (README constraint 1) does not apply here. Bulk booking from the client
SDK is legal.

## 3. Calendar page

A month/week grid rendering two things:

- recording sessions on their date
- tasks by `dueAt`

**Read-only in v1.** Click through to the task, deliverable, or session. No
drag-to-reschedule — that is where calendar scope explodes, and the value is in
seeing the plan, not editing it in place.

The day view is the payoff and should be built deliberately: selecting a day
shows its sessions grouped by set, each listing its capture tasks — "Day 1 —
Set A: videos 1–3, Set B: videos 4–6". That is the exact end state the beta
user described.

Implementation notes:

- New route in `app/src/router/index.ts` with
  `meta: { roles: ['admin','pm','contractor'] }` (adjust if the user wants
  clients included).
- Page-to-page animation goes through the View Transitions wrapper already in
  the router. Never call `document.startViewTransition` anywhere else. If a
  hero transition into a session detail is wanted, use matching
  `view-transition-name` derived from the session id, unique per page, with the
  CSS added as a numbered recipe in `app/src/assets/css/transitions.css`. Read
  `docs/animations.md` first.
- Date formatting must use the i18n datetime formats registered in
  `app/src/i18n/index.ts` (`datetimeFormats`, `short` is defined for both
  locales) rather than raw `toLocaleDateString` calls. Month and weekday names
  are user-facing strings — they need locale keys or an approved
  `Intl.DateTimeFormat` usage driven by the active locale.
- Query scoping: load sessions and tasks for the visible date range only. Do
  not repeat the unbounded-query mistake phase 2a fixed in `loadBoard`.

## 4. Session detail

Name, date, location, notes, and the list of capture tasks with their
deliverables. Add and remove tasks from the session. A "shoot list" view a
recorder can actually work from on the day.

Worth checking with the user: should completing a session mark all its capture
tasks complete in one action? It matches how a shoot day ends, but it bypasses
the per-task handoff prompt from phase 2a — which is the mechanism that fixes
the recorder→editor gap. If it ships, it needs its own handoff step covering
the whole session.

## Acceptance criteria

- [ ] `RecordingSession` exists with mapper, schema, and rules.
- [ ] Sessions reference capture tasks; booking sets those tasks' `dueAt`.
- [ ] Two sessions on one date group correctly in the day view.
- [ ] Calendar renders sessions and tasks by `dueAt`, read-only, with
      click-through.
- [ ] Day view shows sessions grouped by set with their tasks — the "record
      video 1 on day one" end state.
- [ ] Calendar queries are bounded to the visible range.
- [ ] Dates and month/weekday names respect the active locale; all new strings
      in `en` and `es`.
- [ ] Any transitions follow `docs/animations.md` and live in
      `transitions.css`.
- [ ] Rules tests cover session read/write per role.
- [ ] `firebase/firestore.indexes.json` reviewed — the calendar's date-range
      queries (org + project + `date`, tasks by org + `dueAt`) are compound and
      the emulator will not catch a missing index.

## Do not

- Add drag-to-reschedule in v1.
- Model sessions as a hierarchy level. They are a scheduling overlay that
  references tasks.
- Build a full calendar library integration before checking whether a simple
  grid suffices. It probably does.
