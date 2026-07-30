# Workflow Settings Editor — Implementation Plan

Follow-on slice to the deliverables initiative (not a numbered phase). Read
[README.md](README.md) first for vocabulary; this doc is self-contained
otherwise.

## Goal

Managers (admin/pm) can edit their workspace's workflow pipeline — rename
stages, reorder them, add/remove stages, and toggle each stage's `optional` and
`clientFacing` flags — from a new "Workflow" card on the Settings page.

Today the pipeline is seeded at org creation (Discovery → Capture → Edit →
Review → Approval in `firebase/functions/src/routes/orgs.ts`) and no UI can
ever change it, so every org is stuck on the default. Everything downstream is
already built for a per-org pipeline; this slice is the missing editing
surface.

## Verified facts — do not re-derive, do not "fix"

These were checked against the codebase on 2026-07-28. Build on them as-is.

1. **The data model needed no changes for the editor itself.** `WorkflowStage`
   and `WorkflowPipeline { stages }` live in `shared/src/types.ts`. (The
   durations follow-on below *did* add `WorkflowStage.durationHours` and a
   `scheduleMode` on the batch input — both app and functions resolve
   `@pasdiu/shared` from `shared/dist`, so **any shared edit needs a shared
   rebuild, which the user runs**, before anything type-checks.)
2. **The security rules need no changes.** `firebase/firestore.rules` (~line
   147) already allows managers to update the `pipeline` key on the org doc
   client-side (`affectedKeys().hasOnly(['name', 'pipeline',
   'defaultCapacityPointsPerDay'])`). A rules test covering the allow case
   already exists (`firebase/rules-test/firestore.rules.test.mjs`, "manager can
   update org pipeline field").
3. **The org doc is live-subscribed.** `useAuthStore` subscribes to
   `orgs/{orgId}` and maps it via `mapOrg` (`app/src/lib/mappers.ts` ~line 111,
   which already maps `pipeline`). After a successful write, `auth.org` updates
   by itself — do not patch local state manually.
4. **Validation already exists.** `WorkflowPipelineSchema` /
   `WorkflowStageSchema` are exported from `@pasdiu/shared`
   (`shared/src/schemas/index.ts`): stage name 1–60 chars, 1–20 stages. Use
   them for client-side validation before the write.
5. **Consumers pick up edits automatically.** `BatchCreateWizard.vue` reads
   `auth.org.pipeline.stages`; the batch endpoint snapshots
   `pipeline.stages` onto each new deliverable. In-flight deliverables carry
   their own snapshot, so pipeline edits can never corrupt existing work — this
   is by design (README, "Stage snapshot").
6. **Stage ids are referenced by snapshots and tasks** (`task.stageId`,
   `deliverable.stages[].id`). Ids must therefore be stable: renaming a stage
   must NOT change its id, and new ids must never collide with old ones.

## Non-goals (out of scope — do not build)

- Multiple pipelines or a template library per org (explicitly deferred in the
  plan of record — one pipeline per workspace).
- Drag-and-drop reordering or list animations. Use up/down buttons and no
  animation (keeps us out of `docs/animations.md` scope entirely).
- Any API endpoint, rules change, trigger change, or shared-package change.

## Implementation steps

### 1. Store action — `app/src/stores/data.ts`

Add an action following the existing `updateMember` pattern (same file, uses
`requireOrgId()` + `guarded()` + `updateDoc`):

```ts
async function updateOrgPipeline(stages: WorkflowStage[]): Promise<void> {
  const orgId = requireOrgId()
  await guarded(() => updateDoc(doc(db, 'orgs', orgId), { pipeline: { stages } }))
  // No local patch: auth.org updates via its live org-doc subscription.
}
```

Export it from the store's return object. Import the `WorkflowStage` type from
`../lib/types` (the app's re-export of `@pasdiu/shared`).

Per CLAUDE.md, components never call the Firestore SDK directly — the write
must live here, not in the component.

### 2. New component — `app/src/components/WorkflowEditor.vue`

A self-contained card body rendered inside SettingsPage (the card chrome —
`rounded-xl border p-5` etc. — can live in SettingsPage to match its sibling
cards; the editor itself is the component).

**Editing model** (mirror the SettingsPage workspace-rename pattern):

- Local draft: a deep copy of `auth.org?.pipeline?.stages ?? []`.
- Keep syncing the draft from the live org doc until the user makes their
  first edit (a `userEditing` flag, exactly like `onNameInput` in
  SettingsPage); after that, stop syncing so a background update can't clobber
  in-progress edits.
- `dirty` computed: draft differs from live (JSON.stringify comparison is
  fine at ≤20 stages).
- Save button disabled unless `dirty && valid && !busy` (use the existing
  `useBusy` composable).
- All mutations (rename, reorder, add, remove, toggles) only touch the draft;
  nothing persists until Save. This also means stage removal needs no confirm
  dialog — it's undoable until saved.

**Per-stage row**, in draft order:

- Name: `BaseInput`, `maxlength="60"`.
- `optional` and `clientFacing`: native `<input type="checkbox">` with
  translated labels (existing pattern — see `taskClientVisible` in
  `ProjectBoardPage.vue` ~line 561; there is no BaseCheckbox component).
- Move up / move down buttons (disabled at the ends).
- Remove button (disabled when it's the last remaining stage).

**Add stage**: appends a draft stage `{ id: newStageId(), name: '',
optional: false, clientFacing: false }`. Generate ids as
`` `s_${crypto.randomUUID().slice(0, 8)}` `` — random, never derived from the
name (renames must not change ids; see verified fact 6), and collision-checked
against the draft's existing ids (regenerate on the unlikely hit).

**Validation** before save: run the draft through `WorkflowPipelineSchema` from
`@pasdiu/shared` (`safeParse`). Additionally disable Save while any stage name
is empty/whitespace. Show nothing fancy for errors — the disabled Save plus a
muted hint line is enough.

**Warning states** (informational, never blocking):

- If no draft stage has `clientFacing: true`, show a muted amber hint that the
  client portal will have no stage to act on (use `var(--accent-amber)` like
  the billing past-due copy in SettingsPage).
- A permanent muted hint under the title: edits apply to future deliverables
  only; work already in progress keeps the stages it was created with.

**On save**: call `data.updateOrgPipeline(draft)`, then
`track('pipeline_updated', { stageCount })`, toast success
(`useToastStore().success(...)`), reset `userEditing` so the draft re-syncs
from the live doc. On failure, toast `t('common.saveError')` (existing key).

### 3. Wire into SettingsPage — `app/src/pages/SettingsPage.vue`

Add the Workflow card directly after the Workspace (rename) card, gated with
`v-if="auth.isManager"` like its neighbors. While `auth.org` is null (doc still
loading) the editor should render nothing or the card can be skipped — simplest
is `v-if="auth.isManager && auth.org"`.

### 4. i18n — new module `app/src/i18n/locales/components/workflow.ts`

Follow the existing module shape (`const en = {...}; const es: typeof en =
{...}; export default { en, es }` — copy the structure of
`components/batchCreate.ts`). Register it in `app/src/i18n/index.ts` under the
key `workflow` in **both** the `en` and `es` blocks (miss one and it's a
compile error — that's intentional).

Keys needed (English copy; write real Spanish for `es`, matching the tone of
the existing `settings` module — "tú" form, as used in
`locales/pages/settings.ts`):

| key | en |
|---|---|
| `title` | Workflow |
| `hint` | The stages every deliverable moves through. Changes apply to new deliverables only — work in progress keeps its current stages. |
| `stageName` | Stage name |
| `optionalLabel` | Optional |
| `optionalHint` | Optional stages can be skipped when creating a batch. |
| `clientFacingLabel` | Client-facing |
| `clientFacingHint` | Client-facing stages appear in the client portal. |
| `moveUp` | Move up |
| `moveDown` | Move down |
| `remove` | Remove stage |
| `addStage` | Add stage |
| `noClientFacing` | No stage is client-facing — clients won't have anything to review or approve in the portal. |
| `saveCta` | Save workflow |
| `saved` | Workflow updated. |

(Adjust/extend as the implementation needs; every user-facing string goes
through `t('workflow.…')` — zero hardcoded strings, per CLAUDE.md.)

Buttons that are icon-only (up/down/remove) still need accessible labels — use
the keys above via `:aria-label`/`:title`.

### 5. Analytics — `app/src/lib/analytics.ts`

Add `'pipeline_updated'` to the `AnalyticsEvent` union (events are typed;
call sites won't compile otherwise). Fire it on successful save with
`{ stageCount: draft.length }`.

### 6. Optional hardening — rules test deny case

`firebase/rules-test/firestore.rules.test.mjs` already asserts the manager
allow case. If quick, add the deny sibling: a contractor-role context fails to
update `pipeline` on the org doc. No rules are changing, so this is
nice-to-have, not required.

## Follow-on: stage durations & derived deadlines (shipped)

Each stage carries `durationHours` (`WorkflowStage`, edited in the same card
under "How long does this stage take?" with a days/hours unit picker). The
batch endpoint chains those durations to give every stage task its own
deadline instead of stamping one date on all of them.

**The model.** Each deliverable gets an *anchor* date — interpolated across the
`dueStartAt`/`dueEndAt` window so a batch still spreads out (30 videos across
July), or the lone `dueEndAt` when only that is given. Stage due dates come off
that anchor, with skipped stages consuming no time:

```
cumulative[i] = hours from the first stage's start to stage i's end
scheduleMode 'start' → due = anchor + cumulative[i]            (first stage begins at the anchor)
scheduleMode 'end'   → due = anchor − (total − cumulative[i])  (last stage ends on the anchor)
```

`scheduleMode` defaults to `'end'`, which preserves what "Due by" has always
meant. **With every duration at 0 both modes collapse to `due = anchor` for
every task — precisely the behaviour that predates durations.** That is what
makes this backwards-compatible for pipelines written before the field
existed, and it is asserted by a test; don't "simplify" it away.

Durations are calendar hours, not business hours — weekends and holidays are
not skipped, by decision. If working-day arithmetic is ever wanted it belongs
in `stageDueDate` in the batch route and nowhere else.

### The due-date convention: 12:00 UTC

A due date is a **calendar day**, not an instant, and the app renders it
without a time. All arithmetic is UTC, and dates are pinned to **12:00 UTC**
(`parseDueDate` / `atDueHour` in the batch route; `app/src/lib/dates.ts` on the
client). Interpolated anchors snap back onto that noon.

Midnight UTC would have been the obvious choice and is wrong: formatted in the
viewer's own timezone it reads as the *previous day* everywhere west of
Greenwich. Noon keeps the rendered day correct from UTC−11 to UTC+11, which is
what lets display stay local (`d(date, 'short')`) without a per-user date fix.
Whole-day durations keep every derived date on that noon; sub-day durations can
drift off it, which only bites at extreme offsets and is deliberately ignored.

Dates written before this convention sit at midnight UTC and are not migrated.

### Other rules this route enforces

- **Only optional stages may be skipped** (`stage_not_optional`, 400).
  `currentStage` treats a required stage with no task as the deliverable's
  current stage, so skipping one would wedge it there permanently.
- **Stage durations are coerced, not trusted.** The Firestore rules gate *which
  keys* change on an org doc, never the pipeline's contents, so a string or a
  negative can legitimately arrive; `stageDurationHours` degrades it to 0
  rather than letting an Invalid Date fail the whole batch.

**Derived, not fixed.** A manager can override any stage deadline afterwards —
`dueAt` is editable on the task edit form (the rules already allowed managers
to write it; only the store's patch type had to widen).

**Not built:** `Deliverable.dueAt`. The deliverable's effective deadline is its
last stage's due date, derived rather than stored. A stored field would want
list/detail UI to justify it — worth doing when something actually displays it.

## Acceptance checklist

- [ ] Manager sees a Workflow card on Settings; contractor/client does not.
- [ ] Rename, reorder, toggle, add, remove all work against the draft; Save
      persists in one write; the card reflects the live doc afterwards.
- [ ] Renaming a stage preserves its id; new stages get fresh `s_…` ids.
- [ ] Save is disabled when: nothing changed, any name is empty, zero stages,
      or more than 20 stages.
- [ ] The "no client-facing stage" warning shows/hides correctly and never
      blocks saving.
- [ ] After saving, opening the Batch Create wizard shows the new stages
      (no code change needed there — verify only).
- [ ] Existing deliverable detail pages still render their original snapshot
      stages (verify only).
- [ ] Both locales compile (`es` is `typeof en`); no hardcoded strings.
- [ ] `pipeline_updated` added to the typed event union and fired on save.

## Verification

- Type-check from `app/`: `npx vue-tsc -b`. Lint: `npm run lint`.
  **Do not run `npm run build`, `vite build`, or `cap sync`** (CLAUDE.md).
- Manual check happens against the user's running dev server + emulators
  (`npm run seed` data has a manager account); don't start servers yourself.
- If you add the optional rules deny test, it runs under the emulator suite in
  `firebase/rules-test/` — follow the existing test file's setup.
