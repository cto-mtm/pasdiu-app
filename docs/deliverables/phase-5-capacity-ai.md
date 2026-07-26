# Phase 5 — Capacity advisor & AI assistant

**Size:** L · **Depends on:** phase 2a (the endpoint it drives), phase 3
(quotas for grounding)

Read [README.md](README.md) first.

## Confirm before starting

This is the most expensive phase and the least validated. Two things to check
first, because either answer could cut most of it:

- **Is the phase 2a preview arithmetic already enough?** It shows counts and
  per-assignee splits without any weight model. If that answered the "help me
  break down 100 videos" need in practice, the weighted system is solving a
  problem that no longer exists.
- **Does anyone still want to talk to it?** The assistant was explicitly
  requested, but it was requested as a way to avoid manual task creation — a
  problem the wizard already solves. Watch whether users ask for the
  conversational path before building it.

Neither question can be answered from this document. Ask.

## Why this is last

The beta user asked for an assistant that creates tasks by conversation: *"the
user might say, for this project we need 7 videos, then the assistant will
gather details for task creation."*

The assistant is a **conversational front-end over the phase 2a batch
endpoint** plus the capacity math below. Building it before that endpoint
exists means building it twice. Built here, it is thin: gather parameters,
show a preview, call the same route the wizard calls.

A crude version of the capacity arithmetic ships in phase 2a's preview
(counts and per-assignee split). This phase adds the weighted model.

## Part 1 — Capacity model

### The cross-type quantification problem

From the session: "editor A is more seasoned and can handle 30 clips a day but
a noob can only do 10. The only issue would be how to quantify between long
video, clips, etc."

Standard solution: **weights**. `DeliverableType.weight` exists from phase 1 —
clip 1, short 3, long-form 15. Team member capacity is expressed in the same
points per day. Now any mix is one multiplication.

Weights do not need to be *accurate*, only *relatively* right. A long-form
being roughly fifteen clips of effort is enough for useful advice. Orgs tune
them later. Do not spend effort searching for correct numbers — there is no
universal constant, which is why they are org-configurable.

### Where capacity lives

Role-level defaults with an optional per-member override, so only people who
deviate need numbers set. Store the override on the member doc
(`orgs/{orgId}/members/{uid}`) and the defaults on the org.

**Check the member rules before implementing.** Manager updates to member docs
are restricted to `hasOnly(['role','clientId','displayName'])`, the org owner's
member doc is untouchable client-side, and self-role changes are blocked. A new
capacity field means widening that key list — do it deliberately and preserve
the owner and self-role protections exactly as they are.

Per-**stage** capacity (someone records fast but edits slow) is explicitly out
of scope. Per-person covers the validated cases; add it only if asked.

### The advisor

When a batch's total weight exceeds the assigned team's capacity across the due
window, warn in the wizard preview with specifics: total points, available
points, and a suggested split across sub-groups or periods.

**Warn, never block.** The user asked for "advice to break down projects into
smaller pieces", not a gate. Agencies routinely commit to more than is
comfortable and know it.

Also surface the entitlement interaction: a large batch may approach
`deliverableLimit` (phase 1 § 4). The wizard already checks this; the advisor
should mention it in the same breath as capacity rather than as a separate
surprise.

## Part 2 — AI assistant

### Architecture

A Cloud Function endpoint in the existing Express app
(`firebase/functions/src/api.ts` + a router under `routes/`, **added to
`VALID_ROUTES`**), calling the Claude API with tool use.

**The model never writes to Firestore.** It gathers parameters and produces a
plan; the user confirms; the confirmed plan goes through the *same* phase 2a
batch endpoint the wizard uses, with the same server-side authorization and
limit checks. This is not a stylistic preference — it is what keeps a
prompt-injectable surface from having write access to a multi-tenant database.

Tools exposed to the model should be **read-only**: look up projects, clients,
deliverable types, the workspace pipeline, team members, package quotas,
current capacity. Plan construction is the model's output, not a tool call with
side effects.

Grounding lookups that return counts must use `count()` aggregation queries.
An assistant that scans deliverable documents to answer "how many are planned
this month" turns every conversational turn into a large read bill.

### Secrets

Follow the existing Stripe pattern exactly:

- `defineSecret("ANTHROPIC_API_KEY")` in the function module.
- Declare it in the `secrets: [...]` array on the `onRequest` config in
  `api.ts` — **without this the deployed function never sees the value.**
- The emulator ignores Secret Manager and reads `firebase/functions/.env`.

Before writing any API integration code, **load the `claude-api` skill** for
current model ids, pricing, and tool-use patterns. Do not write model ids or
parameters from memory.

### Conversation shape

1. User: "for this project we need 7 videos."
2. Assistant gathers what the batch endpoint requires: type, template, target
   sub-group, assignees, due window.
3. Assistant grounds itself by reading package quotas ("their package is 30 a
   month and you have 12 planned") and capacity ("3 editors, 9 days, this is
   ~1.4× comfortable throughput").
4. Assistant returns a **plan preview** — reuse the phase 2a preview component,
   which is why that was built to take a plan object.
5. User confirms. The app calls the batch endpoint.

Nothing is written before step 5.

### Gating

Decide with the user whether the assistant is a paid differentiator. If so it
belongs in `PLAN_FEATURES` in `shared/src/plans.ts` alongside `ledger`,
`analytics`, `import`, `csvExport`, and the route gets `meta.feature` — the
router already enforces plan gating that way. Server-side enforcement must
match; a `meta.feature` route guard is UX, not security.

### Cost control

Per-org rate limiting and a token ceiling per conversation. An LLM endpoint
reachable by any member of any workspace is an unbounded cost surface. Log
usage per org from day one so pricing can be revisited with real numbers.

## Acceptance criteria

**Capacity**

- [ ] `DeliverableType.weight` is editable per org.
- [ ] Role-level capacity defaults with per-member overrides; member rules
      widened deliberately, with owner and self-role protections intact.
- [ ] The wizard preview warns when a batch exceeds capacity in the due window,
      with numbers and a suggested split, and never blocks.

**Assistant**

- [ ] Endpoint exists in the Express app and is listed in `VALID_ROUTES`.
- [ ] `ANTHROPIC_API_KEY` via `defineSecret` + declared in `secrets: [...]`;
      emulator reads `.env`.
- [ ] Model tools are read-only; no Firestore writes from the model.
- [ ] Confirmed plans go through the phase 2a batch endpoint, reusing its
      authorization and limit checks.
- [ ] The preview component is shared with the wizard, not duplicated.
- [ ] Per-org rate limit and token ceiling; usage logged per org.
- [ ] `claude-api` skill consulted for model ids and parameters.
- [ ] The assistant endpoint ships with the mandatory coverage matrix from
      `docs/testing.md`. The Anthropic API is not reachable offline, so mirror
      the Stripe precedent in `firebase/functions/test/`: test everything
      testable without the external call — auth and role gates, request
      validation, rate limiting, and the disabled-mode response when the key is
      absent — and cover the live call by a manual flow documented in the
      README.
- [ ] Member-doc rules change covered by rules tests, including that the owner
      doc stays untouchable and self-role changes stay blocked.
- [ ] All new strings in `en` and `es`.

## Do not

- Give the model write access to Firestore, directly or through a tool.
- Skip the confirmation step.
- Hard-block on capacity warnings.
- Hardcode model ids from memory.
