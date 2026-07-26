# Phase 2b — Client portal: review, approval, attribution

**Size:** L · **Depends on:** phase 2a (needs deliverables to exist)

Read [README.md](README.md) first, especially constraint 3.

## Why this is a full phase

The beta user confirmed the portal will be heavily used. The real-world flow:
the agency messages the client on WhatsApp — *"check Pasdiu and approve the
vids, leave feedback there if you want changes"* — because it beats sending
each video by message. The portal is where the client actually decides, and it
becomes the contractual record of what was approved.

They also need **manual approval on the admin side**: sometimes a review
happens in person, the client says "yes, approved" on the spot, and asking them
to open the app afterwards is annoying.

## Scope

1. Rebuild the portal around deliverables instead of tasks.
2. Approve and request-changes actions, including bulk approve.
3. Server-side approval with tamper-resistant attribution.
4. Manager proxy approval for in-person sign-off.
5. Share links for the WhatsApp nudge.
6. Notifications in both directions.

## 1. Rebuild the portal around deliverables

`app/src/pages/ClientPortalPage.vue` today renders a flat list of **tasks**
grouped by project, each row linking to the iteration room.

Once the wizard exists, a 30-clip month becomes 150 task rows, roughly 120 of
which are noise to the client — they do not care that "record clip 22" is in
progress. The portal must show **deliverables**, which is both the correct
model and a large simplification: 30 rows, not 150.

Changes:

- `clientVisible` moves to the deliverable level. The existing bulk-visibility
  helper `setProjectTasksVisibility` in `app/src/stores/data.ts` moves with it
  (deliverable-level bulk share/hide).
- Group by **batch**, using the denormalized `subGroupName` on the deliverable
  — clients cannot read the `subGroups` collection and a client-scoped rule for
  it cannot be written (see phase 1 § "Why denormalize").
- Client queries must filter `where('clientVisible','==',true)` and
  `where('clientId','==', myClientId)`. Firestore rejects a query that *could*
  return an unreadable doc — see the header comment in `firestore.rules`.
- The portal locale module already exists at
  `app/src/i18n/locales/pages/portal.ts` and its title is already "Your
  Deliverables" / "Tus entregables". The vocabulary fits; extend the module.

The portal becomes a **review queue**, not a list: "July — 30 clips, 12
awaiting your review", each item showing the video, an approve action, and a
request-changes action.

## 2. Approve and request changes

### Request changes is currently impossible

README constraint 3: the client branch of the task update rule permits
`status == 'approved'` and nothing else. A client can leave a note but cannot
move an item into a needs-changes state, so the agency has no signal — someone
has to notice a comment appeared. Phase 1 widens the rule to allow `revisions`.

Ship "request changes" as **one action** that sets the status and attaches the
note together. Two separate steps means half the clients will do one of them.

### Bulk approve

"Approve the vids" is plural. One-by-one across 30 clips is punishing.

Bulk approval is legal from the client SDK today — updates are not
counter-gated the way creates are, so the batch-create blocker does not apply
here. But since approval routes through the API for attribution (§ 3), bulk
approve goes through the endpoint too, with the same per-item authorization
checks applied server-side.

## 3. Approval attribution (server-side)

An approval record that cannot distinguish "the client clicked approve" from "a
PM clicked approve" is worthless in exactly the dispute it exists to prevent.

Store on the deliverable:

- `approvedBy: string` — uid of whoever performed it
- `approvedVia: 'portal' | 'in_person' | 'external'`
- `approvedAt: Date | null`
- `approvalNote: string` — required for proxy approvals

**These must be written server-side.** The client's own update is key-locked to
`status` and `completedAt`, and widening that to include attribution fields
would let a client set `approvedVia` freely — a field the actor controls is not
an audit record. The API stamps identity and method from the authenticated
caller.

Add to the same Express app as phase 2a's batch endpoint
(`firebase/functions/src/api.ts`, a router under
`firebase/functions/src/routes/`, and **add the route to `VALID_ROUTES`**).

Suggested: `POST /orgs/:orgId/deliverables/:deliverableId/approve` plus a bulk
variant, and a matching request-changes route.

Authorization, checked server-side per item:

- A **client** may approve only deliverables of their own `clientId` with
  `clientVisible === true` → `approvedVia: 'portal'`.
- A **manager** (`admin`/`pm`) of the org may approve any of its deliverables
  → `approvedVia: 'in_person'` (or `'external'`), and `approvalNote` is
  required.
- Nobody else.

The endpoint also advances the underlying stage task's status, so the derived
stage moves. Managers already have rules permission to set any valid status, so
proxy approval needs **no rules change** — only the attribution fields and the
endpoint.

## 4. Manager proxy approval UX

The in-person scenario is: manager is on set or in a review call, client says
"approved". The whole point is that it is faster than asking the client to open
the app.

- One tap from the deliverable, plus a short note ("approved on set, July 25").
  Not a form.
- The client's own portal shows it honestly: "Approved on your behalf by
  {name}" with the date and note.
- **Email the client when it happens.** Silent proxy approval is precisely how
  disputes start; visible proxy approval protects the agency.

## 5. Share links for the WhatsApp nudge

The agency's actual motion is pasting a message into WhatsApp. Give the PM a
**copy review link** button on a batch that yields a deep link to that batch's
review queue.

Clients already have real accounts (the invite flow and `client` role exist),
so this is an ordinary authenticated deep link, not a magic link — the router
guard sends them through login and back. Add the route with
`meta: { roles: ['client'] }` following the existing patterns in
`app/src/router/index.ts`.

Do not put client or project ids in anything that gets logged as a page name —
`router.afterEach` deliberately tracks route **name** only, never path or
params, to avoid leaking ids to analytics. Keep that property.

## 6. Notifications both directions

Reuse `queueMail` from `firebase/functions/src/helpers/mail.ts` with
deterministic ids (see phase 2a § 5).

- Client approves or requests changes → notify the agency (the deliverable's
  relevant assignee and/or the project's manager). Without this the agency
  polls the portal.
- Manager proxy-approves → notify the client (§ 4).
- Optional, confirm with the user first: a digest to the client when a batch
  becomes ready for review, since the agency currently does this by hand over
  WhatsApp.

Every email is user-facing copy and needs both locales. `Invite` already
carries a `locale` field driving invite-email language — follow that pattern
rather than inventing a new one, and check `email/inviteEmail.ts` for the
template shape.

## Acceptance criteria

- [ ] Portal lists deliverables, not tasks, grouped by batch via
      `subGroupName`.
- [ ] Client queries filter on both `clientId` and `clientVisible`.
- [ ] `clientVisible` is deliverable-level, with a bulk share/hide for
      managers.
- [ ] A client can approve, and can request changes in one action that sets
      `revisions` and attaches a note.
- [ ] Bulk approve works across a batch.
- [ ] Approval writes `approvedBy` / `approvedVia` / `approvedAt` /
      `approvalNote` **server-side only**; these fields are not in any
      client-writable key set.
- [ ] A manager can proxy-approve in one tap plus a note; the client sees it
      attributed and is emailed.
- [ ] "Copy review link" produces a working deep link to a batch review queue.
- [ ] Agency is notified when a client acts.
- [ ] Route names still carry no ids into analytics.
- [ ] All new strings and emails in `en` and `es`.
- [ ] The approve and request-changes endpoints ship with the mandatory
      coverage matrix from `docs/testing.md`, plus the authorization cases that
      matter here: a client approving another tenant's deliverable → 403; a
      client approving one with `clientVisible === false` → 403; a contractor
      approving → 403; a manager proxy-approving without `approvalNote` →
      rejected. Assert the attribution fields on raw Firestore state, including
      that `approvedVia` is `'portal'` for client callers and cannot be set by
      the caller.
- [ ] `firebase/firestore.indexes.json` reviewed for the portal's
      client-scoped deliverable queries (org + client + `clientVisible`, plus
      any ordering).

## Do not

- Widen the client task-update key restriction to include attribution fields.
  That is the whole reason approval is server-side.
- Show clients stage tasks. They see deliverables; the pipeline is internal.
- Build magic-link auth. Clients have accounts.
