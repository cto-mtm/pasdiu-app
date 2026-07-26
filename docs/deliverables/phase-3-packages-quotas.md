# Phase 3 — Packages & quota tracking

**Size:** M · **Depends on:** phase 2a (needs deliverables to count)

Read [README.md](README.md) first.

## What agencies actually sell

From the beta session: "an agency sells 30 videos a month or 600 clips, 4
long-format YouTube videos or 12 shorts. Per month or some other period of
time. There might be agencies that offer per goal instead."

So a package is a set of line items, each a quantity of a deliverable type over
a period. Per-goal work is the same shape with no recurrence — **one field
apart, not a separate model.**

## 1. The `Package` type

In `shared/src/types.ts`:

```ts
export type PackagePeriod = 'month' | 'quarter' | 'once'

export interface PackageLine {
  typeId: string        // → DeliverableType
  quantity: number
  period: PackagePeriod // 'once' = per-goal, no recurrence
}

export interface Package {
  id: string
  orgId: string
  clientId: string
  projectId: string       // attached to the engagement, not the batch
  name: string
  lines: PackageLine[]
  includedRevisions: number  // ONLY IF § 3 is confirmed — omit otherwise
  startsOn: Date | null      // anchors period boundaries
  active: boolean
}
```

Attach to the **project**, not the sub-group. This is the payoff of the
project-is-the-engagement convention in README § "Project vs. sub-group": if
the project were "July", the package would have no durable home.

Add a mapper in `app/src/lib/mappers.ts` normalizing missing fields, and a Zod
schema in `shared/src/schemas/index.ts`.

Rules: mirror the `subGroups` block — managers write, managers and contractors
read. Clients should probably read their own package (it is what they bought),
but **confirm with the user first**; if yes, scope it by `clientId` the same
way projects are scoped, and note that it exposes quantities to the client.

## 2. Quota tracking

A widget on the project page: for each line, planned / in progress / delivered
against quota for the current period.

Period boundaries derive from `startsOn` and `period`. Calendar months are the
obvious default but confirm — some agencies bill on signing anniversaries, not
calendar months.

Counting rules:

- **Delivered** = deliverables of that type with `status === 'delivered'` and
  `deliveredAt` inside the current period.
- **In progress** = `status === 'active'` and created inside the period.
- **Planned** = every non-canceled deliverable of that type in the period.

Count **deliverables, not tasks**. Phase 1 § 4 flagged this: task counts now
mix stage-tasks with standalone tasks, so "350 open tasks" reads as chaos when
it is 70 deliverables progressing normally. Every number surfaced here counts
deliverables.

**Use `count()` aggregation queries — never document scans.** Aggregations bill
one read per 1,000 index entries matched (minimum one), so a package line's
quota costs 1 read instead of 600. A three-line package renders its whole quota
widget in ~3 reads. Reading the deliverable documents to count them would be
roughly 600× more expensive for identical output. See
[data-modeling.md](data-modeling.md).

Soft nudge when a new period starts with nothing planned: "August — 0 of 30
planned." Do not auto-create anything yet.

## 3. Revision limits — UNVALIDATED, confirm before building

**Nobody asked for this.** It came from my assumption that agencies sell
revision rounds as a billing lever. That may well be true, but it is
extrapolation, not something the beta user said. Ask before building it — and
if the answer is no, drop `includedRevisions` from `Package` and skip this
section entirely.

If confirmed: add `revisionCount: number` to `Deliverable` (it was deliberately
left out of phase 1 for this reason) and increment it **server-side** in the
request-changes endpoint — never client-side, for the same tamper-resistance
reason approval attribution is server-side.

`Package.includedRevisions` is the allowance. When a deliverable exceeds it:

- Surface it to the agency (this is a billable event for them).
- Do **not** block the client from requesting changes. Blocking a paying
  client mid-project is a business decision the agency makes in conversation,
  not something the tool should enforce.

Whether the client sees their own remaining revisions is a product decision —
ask the user. It can read as either helpful transparency or pressure.

## 4. Auto-generating the next batch (optional, confirm first)

A recurring package can generate next period's sub-group with planned
deliverable slots — "August 2026" appears with 30 clips ready to schedule.

This only works because months are sub-groups, and it is the strongest
mechanical argument for the project/sub-group convention.

Treat as a fast-follow, not core scope. It needs a scheduled function, and
auto-creating billable work without a human confirming is the kind of thing
that surprises people. Prefer a "generate next batch" button over a cron for
v1.

## Acceptance criteria

- [ ] `Package` exists with lines of type × quantity × period; `'once'`
      expresses per-goal work with no separate code path.
- [ ] Packages attach to projects.
- [ ] Quota widget shows planned / in progress / delivered vs. quota per line
      for the current period, counting deliverables.
- [ ] Every count is a `count()` aggregation query; no code path reads
      deliverable documents to produce a number.
- [ ] Period boundaries derive from `startsOn` + `period`, and the convention
      was confirmed with the user.
- [ ] Revision limits were **confirmed with the user before being built**, or
      skipped entirely. If built: `revisionCount` increments server-side only,
      and exceeding `includedRevisions` is surfaced to the agency without
      blocking the client.
- [ ] Rules mirror `subGroups`; client read access confirmed with the user
      before shipping; rules tests cover both allow and deny cases.
- [ ] `firebase/firestore.indexes.json` reviewed for the period-window
      deliverable queries (org + project + type + `deliveredAt` range).
- [ ] All new strings in `en` and `es`.

## Do not

- Model per-goal work as a separate entity. It is `period: 'once'`.
- Count tasks anywhere a user-facing number is shown. Count deliverables.
- Hard-block clients on revision limits.
