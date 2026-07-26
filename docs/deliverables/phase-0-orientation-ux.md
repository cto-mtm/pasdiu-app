# Phase 0 — Orientation UX & sub-group metadata

**Size:** S (days) · **Depends on:** nothing · **Ships first**

Read [README.md](README.md) first.

## Why this ships before the foundation

The beta user's most-repeated confusion was "if my project is July, is my
sub-group TikTok? or the other way around?". The fix is copy, not schema — it
takes days and it is visible. Phase 1 is several days of invisible schema work,
so shipping this first keeps the beta relationship warm while the foundation is
built behind it.

## Scope

1. An explainer affordance on project and sub-group creation/edit that says
   what each one is.
2. Placeholder examples in the name inputs doing the same job passively.
3. `meta` + `links` on `SubGroup`, so batches can carry their own info (set
   address, campaign hashtag, deadline notes) instead of overloading the
   project brief.

## The guidance to communicate

**Project = the ongoing engagement or goal.** Examples: "TikTok", "YouTube
Channel", "Course Launch Q3".

**Sub-group = a batch within it.** Examples: "July", "August", "Teasers".

Recommend, do not enforce. Agencies doing per-goal work legitimately invert the
time axis. The copy should read as a helpful default, not a rule. See
README.md § "Project vs. sub-group" for the reasoning if you need to write
longer-form copy.

## Implementation

### 1. `SubGroup` gains metadata

`shared/src/types.ts` — extend the existing interface:

```ts
export interface SubGroup {
  id: string
  orgId: string
  projectId: string
  name: string
  order: number
  meta: MetaField[]   // NEW — batch-specific info (set address, hashtag, links…)
}
```

Additive and defaults to empty, so existing docs stay valid.

`meta` is a `{label, value}` list, so it already covers reference URLs — do
**not** add a separate `links: string[]`. `Project.brief` has both only because
its links are a distinct, structured part of a brief; a batch has no such
distinction.

**Normalizer.** `SubGroup` is currently mapped inline in
`app/src/stores/data.ts` (`loadBoard` spreads `d.data()` directly rather than
going through a mapper). Add a `mapSubGroup(id, data)` to
`app/src/lib/mappers.ts` following the existing pattern — default `meta` to
`[]` and `links` to `[]` for older docs — and use it in `loadBoard`. This
matches how every other entity is handled and is required by the
mappers-own-normalization convention in that file's header comment.

**Rules.** `subGroups` create/update is manager-only and does not constrain
keys, so additive fields need **no rules change**. Verify this is still true
before assuming it.

**Store.** Extend the sub-group create/update functions in
`app/src/stores/data.ts` to accept and write the new fields.

### 2. Explainer UI

Add an info affordance (an `(i)` button opening a small modal or popover) next
to the name field on:

- project create/edit
- sub-group create/edit

Find the current create/edit surfaces before writing code — project creation
lives around `ClientDetailPage.vue` and sub-group creation around
`ProjectBoardPage.vue`, but confirm rather than assume, and check whether an
existing modal/popover component can be reused instead of adding one.

Requirements:

- Reachable by keyboard, dismissible with Escape.
- Content is short: one line defining the concept, two examples, one line on
  the relationship between them.
- If a shared explainer component makes sense (same shape used twice), build
  one and pass it the copy keys — don't duplicate markup.

### 3. Placeholders

Set placeholder text on the name inputs:

- project: something in the shape of "e.g. TikTok — ongoing"
- sub-group: something in the shape of "e.g. July batch"

Placeholders are user-facing strings and need locale keys like everything else.

### 4. i18n

All copy goes in **both** `en` and `es`. Existing project/sub-group copy lives
in `app/src/i18n/locales/pages/board.ts` and
`app/src/i18n/locales/pages/client.ts` — put new keys in whichever module owns
the surface you're editing rather than inventing a new module for a handful of
strings.

Pattern (from `app/src/i18n/locales/pages/portal.ts`):

```ts
const en = { /* … */ }
const es: typeof en = { /* … */ }
export default { en, es }
```

`es` being typed `typeof en` means a missing translation is a compile error.
Write real Spanish, not English placeholders.

## Acceptance criteria

- [ ] A manager creating a project sees an `(i)` explaining project vs.
      sub-group, with examples.
- [ ] Same on sub-group creation.
- [ ] Both name inputs show example placeholders.
- [ ] All new strings exist in `en` and `es`; no hardcoded strings in
      templates.
- [ ] `SubGroup` carries `meta` (and **not** a separate `links` array); a
      manager can edit it; existing sub-groups created before this change still
      load with it defaulting to empty.
- [ ] Sub-group docs are mapped through `mapSubGroup` in `mappers.ts`, not
      spread inline.
- [ ] Type changes require a `shared` rebuild — tell the user, don't run it.

## Out of scope

- Auto-detecting that an org named its projects after months and suggesting the
  inversion. Nice idea, later.
- Any deliverable/stage concept — that's phase 1.
