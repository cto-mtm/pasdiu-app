# Workspace rename for managers

Adds the ability for workspace managers to rename their organization. The rename flows from a new PATCH endpoint through a Firestore batch that updates both the org doc and every denormalized member doc (powering the org switcher). On the frontend, the settings page exposes an inline form gated behind `isManager`, backed by a new Pinia action that calls the API and refreshes memberships on success.

Watch for: the batch fan-out has no size guard — Firestore batches cap at 500 operations, so an org with ~499+ members will fail silently or throw (confirmed). The endpoint has no rate limiting, making rapid renames possible without throttle (confirmed). No `updatedAt` or audit trail is written on rename (confirmed).

## High-level view

The API adds a single PATCH route that validates the name (non-empty, max 60 chars), checks manager role, then writes the new name to the org doc and every member doc in one batch. This hits Firestore's 500-operation ceiling for large orgs — any workspace with roughly 499 members would exceed the limit once the org doc update is included.

The watcher that re-syncs the input from the Firestore subscription means a concurrent rename by another manager overwrites whatever the local user is typing — a minor UX friction, not a bug. The dirty check recalculates against the new baseline so no stale patch is sent.

The `.env.example` change documents a shift to dynamic Stripe price discovery. It's unrelated to the rename feature and should ideally be a separate commit.

<details>
<summary>Issues (5)</summary>

1. **Batch size ceiling** — Firestore batches are limited to 500 operations. The fan-out writes one op per member plus one for the org doc, so orgs approaching 499 members will hit a hard failure. Chunk the writes or use a chunked batched-write utility.
2. **No rate limiting on rename** — The PATCH endpoint has no throttle or cooldown. A malicious or misbehaving client can rename the org in a tight loop, generating N writes per call across all member docs. Add a rate limit or at minimum a per-org cooldown.
3. **No audit trail** — The rename doesn't write an `updatedAt` timestamp or any log entry. For a change visible to every member, having no record of who renamed when makes debugging workspace confusion harder. Consider writing a timestamp and actor UID.
4. **Watcher overwrites in-progress edits** — The `watch(currentOrgName, ...)` resets `orgName` whenever the Firestore subscription fires a new value. If another manager renames concurrently, the local user's partially-typed name is silently replaced. A `userHasEdited` flag that suppresses the watcher after first keypress would prevent this.
5. **Validation error not i18n-keyed** (possible) — The 400 response for invalid name is a raw English string, not a translation key. If the frontend's `res.error.key` path receives this string and passes it to `t()`, the user sees a missing-key fallback or the raw English. Confirm how `ApiError` maps to the response shape consumed by `apiFetch`.

</details>

<details>
<summary>Details</summary>

## Batch fan-out ceiling

The rename endpoint collects all member docs and writes them in a single Firestore batch alongside the org doc update:

```typescript
const members = await orgRef.collection("members").get();
const batch = db.batch();
batch.update(orgRef, { name });
for (const m of members.docs) batch.update(m.ref, { orgName: name });
await batch.commit();
```

Firestore enforces a hard 500-operation limit per batch. The loop adds one write per member, plus one for the org doc itself. An org with 499 members hits the wall. This isn't a theoretical edge case for a SaaS product — the Agency tier presumably allows large teams. The fix is to chunk the member writes into groups of 499 (reserving one slot for the org doc in the first chunk, or handling the org doc separately). Without chunking, the endpoint returns a 500 error from Firestore with no user-facing explanation.

## Concurrent-rename UX

If manager A starts typing a new name and manager B completes a rename first, manager A's input is overwritten mid-keystroke by the immediate watcher on the Firestore subscription. Correctness is maintained (the dirty check recalculates against the new baseline), but the UX surprise is real for multi-manager workspaces. A lightweight fix: track whether the user has focused or modified the input, and suppress the watcher sync while the field is dirty.

## Validation error contract mismatch

The endpoint throws `ApiError(400, "name must be a non-empty string of at most 60 characters")` — a raw English string. The frontend error path in `renameOrg` does `t(res.error.key, res.error.params ?? {})`, which expects a translation key. If `ApiError` serializes that string as the `key` field, the i18n lookup will miss and the user either sees the raw English or falls through to `common.saveError` (which is the fallback in the UI). The fallback happens to be acceptable behavior, but only by accident — worth confirming the contract so future validation errors don't surface raw strings.

</details>

<details>
<summary>File map</summary>

| File | Change |
|------|--------|
| `app/src/i18n/locales/pages/settings.ts` | EN/ES strings for rename hint, CTA, and success toast |
| `app/src/lib/api.ts` | New `renameOrgApi` function (PATCH `/orgs/:orgId`) |
| `app/src/pages/SettingsPage.vue` | Rename form UI gated behind `isManager` |
| `app/src/stores/auth.ts` | `renameOrg` action calling API + membership refresh |
| `firebase/functions/.env.example` | Unrelated: documents dynamic Stripe price discovery |
| `firebase/functions/src/api.ts` | Registers `PATCH /orgs/:orgId` in valid routes |
| `firebase/functions/src/routes/orgs.ts` | Rename endpoint: validation, auth, batch fan-out |

</details>
