// Firestore security-rules tests (the documented approach — @firebase/rules-unit-testing
// against the emulator). Run with the emulator up:
//
//   cd firebase
//   npm i -D @firebase/rules-unit-testing firebase
//   firebase emulators:exec --only firestore --project demo-app "npm test"
//
// Docs: https://firebase.google.com/docs/firestore/security/test-rules-emulator
//
// Multi-tenant harness: THREE orgs with one dual-membership user —
//   o_a "Org A": mgr (pm, OWNER), mgr2 (pm, non-owner), ed (contractor),
//     ed2 (contractor), cl (client of c1)
//   o_b "Org B": ed (admin, owner) — ed is contractor-in-A AND manager-in-B,
//   which must never leak in either direction.
//   o_c "Org C": mgr (pm) — finite limits WITH room, for the allowed
//   batched-create (create + paired counter increment) paths.
// Entitlements (Phase 2): o_a sits exactly AT its plan limits (usage counters
// == limits) so the at-limit create denials are testable; o_b has unlimited
// (-1) overrides so the allowed invite path is exercised there. Client/task
// creates must ALWAYS be batched with a +1 on the matching usage counter
// (getAfter gate) — plain setDoc creates are denied on every org.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing'
import {
  collectionGroup, deleteDoc, doc, getDoc, getDocs, increment, query, setDoc,
  updateDoc, serverTimestamp, where, writeBatch,
} from 'firebase/firestore'

let env

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-app',
    firestore: { rules: fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
  })
  // Seed baseline data with rules disabled.
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()

    // users/* is identity ONLY — role/clientId live on membership docs.
    await setDoc(doc(db, 'users/mgr'), { displayName: 'PM', email: 'mgr@x.test' })
    await setDoc(doc(db, 'users/mgr2'), { displayName: 'PM Two', email: 'mgr2@x.test' })
    await setDoc(doc(db, 'users/ed'), { displayName: 'Ed', email: 'ed@x.test' })
    await setDoc(doc(db, 'users/ed2'), { displayName: 'Nora', email: 'ed2@x.test' })
    await setDoc(doc(db, 'users/cl'), { displayName: 'Cl', email: 'cl@x.test' })
    await setDoc(doc(db, 'users/north'), { displayName: 'North', email: 'north@x.test' })

    // Org A — mgr (OWNER) + mgr2 manage; ed/ed2 contract; cl is the client of
    // tenant c1. Deliberately AT its limits: 2 clients (c1, c2), 2 tasks
    // (t1, tx) and 5 seats are seeded, and usage/current mirrors those counts
    // — every gated create in o_a must be denied.
    await setDoc(doc(db, 'orgs/o_a'), {
      name: 'Org A', createdAt: new Date(), ownerUid: 'mgr',
      plan: 'free', seatLimit: 5, clientLimit: 2, taskLimit: 2, subscriptionStatus: 'none',
    })
    await setDoc(doc(db, 'orgs/o_a/members/mgr'), { uid: 'mgr', orgId: 'o_a', orgName: 'Org A', displayName: 'PM', email: 'mgr@x.test', role: 'pm', joinedAt: new Date() })
    await setDoc(doc(db, 'orgs/o_a/members/mgr2'), { uid: 'mgr2', orgId: 'o_a', orgName: 'Org A', displayName: 'PM Two', email: 'mgr2@x.test', role: 'pm', joinedAt: new Date() })
    await setDoc(doc(db, 'orgs/o_a/members/ed'), { uid: 'ed', orgId: 'o_a', orgName: 'Org A', displayName: 'Ed', email: 'ed@x.test', role: 'contractor', joinedAt: new Date() })
    await setDoc(doc(db, 'orgs/o_a/members/ed2'), { uid: 'ed2', orgId: 'o_a', orgName: 'Org A', displayName: 'Nora', email: 'ed2@x.test', role: 'contractor', joinedAt: new Date() })
    await setDoc(doc(db, 'orgs/o_a/members/cl'), { uid: 'cl', orgId: 'o_a', orgName: 'Org A', displayName: 'Cl', email: 'cl@x.test', role: 'client', clientId: 'c1', joinedAt: new Date() })
    await setDoc(doc(db, 'orgs/o_a/usage/current'), { seats: 5, activeClients: 2, activeTasks: 2 })
    await setDoc(doc(db, 'orgs/o_a/invites/i1'), { email: 'newbie@x.test', role: 'contractor', status: 'pending', createdAt: new Date(), invitedBy: 'mgr' })

    // Org B — ed is the ADMIN here (dual membership with contractor-in-A).
    // Unlimited (-1) overrides: the entitlement-ALLOWED create paths live here.
    await setDoc(doc(db, 'orgs/o_b'), {
      name: 'Org B', createdAt: new Date(), ownerUid: 'ed',
      plan: 'agency', seatLimit: -1, clientLimit: -1, taskLimit: -1, subscriptionStatus: 'active',
    })
    await setDoc(doc(db, 'orgs/o_b/members/ed'), { uid: 'ed', orgId: 'o_b', orgName: 'Org B', displayName: 'Ed', email: 'ed@x.test', role: 'admin', joinedAt: new Date() })
    await setDoc(doc(db, 'orgs/o_b/usage/current'), { seats: 1, activeClients: 1, activeTasks: 1 })

    // Org C — finite limits WITH room (usage 1/1 vs limits 3/3): the
    // batched create + paired-increment ALLOWED path under a real limit.
    await setDoc(doc(db, 'orgs/o_c'), {
      name: 'Org C', createdAt: new Date(), ownerUid: 'mgr',
      plan: 'free', seatLimit: 3, clientLimit: 3, taskLimit: 3, subscriptionStatus: 'none',
    })
    await setDoc(doc(db, 'orgs/o_c/members/mgr'), { uid: 'mgr', orgId: 'o_c', orgName: 'Org C', displayName: 'PM', email: 'mgr@x.test', role: 'pm', joinedAt: new Date() })
    await setDoc(doc(db, 'orgs/o_c/usage/current'), { seats: 1, activeClients: 1, activeTasks: 1 })
    await setDoc(doc(db, 'clients/cc'), { orgId: 'o_c', name: 'Client C' })

    await setDoc(doc(db, 'clients/c1'), { orgId: 'o_a', name: 'Client One' })
    await setDoc(doc(db, 'clients/c2'), { orgId: 'o_a', name: 'Client Two' })
    await setDoc(doc(db, 'clients/cb'), { orgId: 'o_b', name: 'Client B' })

    // t1 belongs to org A / tenant c1 (cl's tenant), assigned to ed, and is
    // SHARED with the client (clientVisible) — the client-allowed paths.
    await setDoc(doc(db, 'tasks/t1'), { orgId: 'o_a', title: 'T1', clientId: 'c1', assigneeUid: 'ed', status: 'backlog', clientVisible: true })
    // th belongs to cl's tenant but is NOT shared (clientVisible absent =
    // hidden) — per-task visibility denials. Not counted in usage (the
    // at-limit denial tests only compare usage/current vs the limits).
    await setDoc(doc(db, 'tasks/th'), { orgId: 'o_a', title: 'TH', clientId: 'c1', assigneeUid: 'ed', status: 'in_progress' })
    // tx belongs to org A / tenant c2 (NOT cl's tenant), assigned to ed2 —
    // clientVisible true so its denials test TENANT scoping, not visibility.
    await setDoc(doc(db, 'tasks/tx'), { orgId: 'o_a', title: 'TX', clientId: 'c2', assigneeUid: 'ed2', status: 'in_progress', clientVisible: true })
    // tb belongs to org B — invisible to every org-A-only user.
    await setDoc(doc(db, 'tasks/tb'), { orgId: 'o_b', title: 'TB', clientId: 'cb', assigneeUid: 'ed', status: 'backlog', clientVisible: true })

    for (const t of ['t1', 'th', 'tx', 'tb']) {
      await setDoc(doc(db, `tasks/${t}/versions/v1`), { label: 'v1', note: 'Cut.', mediaUrl: '', createdAt: new Date() })
      await setDoc(doc(db, `tasks/${t}/notes/n1`), { versionId: 'v1', authorUid: t === 'tb' ? 'ed' : 'mgr', body: 'Tighten.', resolved: false, createdAt: new Date() })
    }
    // A note AUTHORED BY the client user — the author-update scope tests.
    await setDoc(doc(db, 'tasks/t1/notes/ncl'), { versionId: 'v1', authorUid: 'cl', body: 'Hold the logo.', resolved: false, createdAt: new Date() })

    // ── Deliverables ──────────────────────────────────────────────────────
    // d1: org A, tenant c1, visible to client — client-allowed reads.
    await setDoc(doc(db, 'deliverables/d1'), {
      orgId: 'o_a', clientId: 'c1', projectId: 'p1', subGroupId: 'sg1',
      subGroupName: 'Batch 1', typeId: 'dt1', name: 'Video 1',
      stages: [{ id: 's1', name: 'Edit', optional: false, clientFacing: false }],
      stageSummary: [], status: 'active', clientVisible: true,
      latestVersionUrl: '', order: 0, meta: [], createdAt: new Date(), deliveredAt: null,
    })
    // d2: org A, tenant c2, visible — tests tenant scoping for clients.
    await setDoc(doc(db, 'deliverables/d2'), {
      orgId: 'o_a', clientId: 'c2', projectId: 'p2', subGroupId: 'sg2',
      subGroupName: 'Batch 2', typeId: 'dt1', name: 'Video 2',
      stages: [], stageSummary: [], status: 'active', clientVisible: true,
      latestVersionUrl: '', order: 0, meta: [], createdAt: new Date(), deliveredAt: null,
    })
    // d3: org A, tenant c1, NOT visible — tests clientVisible gate.
    await setDoc(doc(db, 'deliverables/d3'), {
      orgId: 'o_a', clientId: 'c1', projectId: 'p1', subGroupId: 'sg1',
      subGroupName: 'Batch 1', typeId: 'dt1', name: 'Video 3',
      stages: [], stageSummary: [], status: 'active', clientVisible: false,
      latestVersionUrl: '', order: 0, meta: [], createdAt: new Date(), deliveredAt: null,
    })
    // db1: org B — invisible to org-A-only users.
    await setDoc(doc(db, 'deliverables/db1'), {
      orgId: 'o_b', clientId: 'cb', projectId: 'pb', subGroupId: 'sgb',
      subGroupName: 'Batch B', typeId: 'dt1', name: 'Video B',
      stages: [], stageSummary: [], status: 'active', clientVisible: true,
      latestVersionUrl: '', order: 0, meta: [], createdAt: new Date(), deliveredAt: null,
    })

    // Deliverable types
    await setDoc(doc(db, 'deliverableTypes/dt1'), { orgId: 'o_a', name: 'Short', weight: 3, order: 0 })
    await setDoc(doc(db, 'deliverableTypes/dtb'), { orgId: 'o_b', name: 'Clip', weight: 1, order: 0 })

    // Deliverable subcollections (versions + notes)
    await setDoc(doc(db, 'deliverables/d1/versions/dv1'), { label: 'v1', note: 'First cut.', mediaUrl: '', createdAt: new Date() })
    await setDoc(doc(db, 'deliverables/d1/notes/dn1'), { versionId: 'dv1', authorUid: 'mgr', body: 'Looks good.', resolved: false, createdAt: new Date() })
  })
})

after(() => env?.cleanup())

// ── clients: org- and tenant-scoped reads, manager writes ──────────────────

test('client reads only its own client', async () => {
  const cl = env.authenticatedContext('cl').firestore()
  await assertSucceeds(getDoc(doc(cl, 'clients/c1')))
  await assertFails(getDoc(doc(cl, 'clients/c2')))
})

// NOTE: o_a is AT its client limit, so the manager-create-ALLOWED path is
// covered in the entitlement tests below (org B, unlimited). Role denial
// stays independent of limits.
test('client-role member cannot create clients even with orgId', async () => {
  const cl = env.authenticatedContext('cl').firestore()
  await assertFails(setDoc(doc(cl, 'clients/c4'), { name: 'Nope', orgId: 'o_a' }))
})

test('client create without orgId is denied even for managers', async () => {
  const mgr = env.authenticatedContext('mgr').firestore()
  await assertFails(setDoc(doc(mgr, 'clients/c5'), { name: 'No org' }))
})

// ── users: identity-only, self-service, no role key ────────────────────────

test('user can update own displayName; role key is denied', async () => {
  const ed = env.authenticatedContext('ed').firestore()
  await assertSucceeds(updateDoc(doc(ed, 'users/ed'), { displayName: 'Edward' }))
  await assertFails(updateDoc(doc(ed, 'users/ed'), { role: 'admin' }))
  await assertFails(setDoc(doc(ed, 'users/ed'), { displayName: 'Edward', email: 'ed@x.test', role: 'admin' }))
})

test('user cannot read or write another user\'s doc', async () => {
  const ed = env.authenticatedContext('ed').firestore()
  await assertFails(getDoc(doc(ed, 'users/mgr')))
  await assertFails(updateDoc(doc(ed, 'users/mgr'), { displayName: 'Hax' }))
})

// ── tasks: non-managers restricted to status/completedAt ───────────────────

test('assignee can update their task; others cannot create', async () => {
  const ed = env.authenticatedContext('ed').firestore()
  await assertSucceeds(updateDoc(doc(ed, 'tasks/t1'), { status: 'in_progress' }))
  await assertFails(setDoc(doc(ed, 'tasks/t2'), { orgId: 'o_a', title: 'x', clientId: 'c1', assigneeUid: 'ed', status: 'backlog' }))
})

test('client cannot update a task title', async () => {
  const cl = env.authenticatedContext('cl').firestore()
  await assertFails(updateDoc(doc(cl, 'tasks/t1'), { title: 'Hacked' }))
})

test('client can approve a task in its own tenant', async () => {
  const cl = env.authenticatedContext('cl').firestore()
  await assertSucceeds(updateDoc(doc(cl, 'tasks/t1'), { status: 'approved', completedAt: serverTimestamp() }))
})

test('client cannot set any status other than approved', async () => {
  const cl = env.authenticatedContext('cl').firestore()
  await assertFails(updateDoc(doc(cl, 'tasks/t1'), { status: 'done', completedAt: serverTimestamp() }))
})

test('client cannot approve another tenant\'s task', async () => {
  const cl = env.authenticatedContext('cl').firestore()
  await assertFails(updateDoc(doc(cl, 'tasks/tx'), { status: 'approved', completedAt: serverTimestamp() }))
})

test('assigned contractor can set done (with completedAt)', async () => {
  const ed = env.authenticatedContext('ed').firestore()
  await assertSucceeds(updateDoc(doc(ed, 'tasks/t1'), { status: 'done', completedAt: serverTimestamp() }))
})

test('assigned contractor cannot set approved (client-only)', async () => {
  const ed = env.authenticatedContext('ed').firestore()
  await assertFails(updateDoc(doc(ed, 'tasks/t1'), { status: 'approved', completedAt: serverTimestamp() }))
})

test('assigned contractor cannot write a bogus status', async () => {
  const ed = env.authenticatedContext('ed').firestore()
  await assertFails(updateDoc(doc(ed, 'tasks/t1'), { status: 'shipped' }))
})

test('non-assigned contractor cannot update status', async () => {
  const ed2 = env.authenticatedContext('ed2').firestore()
  await assertFails(updateDoc(doc(ed2, 'tasks/t1'), { status: 'in_progress' }))
})

test('orgId is immutable on task update, even for managers', async () => {
  const mgr = env.authenticatedContext('mgr').firestore()
  await assertFails(updateDoc(doc(mgr, 'tasks/t1'), { orgId: 'o_b' }))
})

// ── per-task client visibility (clientVisible; absent = hidden) ─────────────

test('client cannot read a hidden task in its own tenant', async () => {
  const cl = env.authenticatedContext('cl').firestore()
  await assertSucceeds(getDoc(doc(cl, 'tasks/t1'))) // shared
  await assertFails(getDoc(doc(cl, 'tasks/th'))) // hidden
})

test('managers and contractors still read hidden tasks', async () => {
  const mgr = env.authenticatedContext('mgr').firestore()
  const ed2 = env.authenticatedContext('ed2').firestore()
  await assertSucceeds(getDoc(doc(mgr, 'tasks/th')))
  await assertSucceeds(getDoc(doc(ed2, 'tasks/th')))
})

test('client cannot approve a hidden task', async () => {
  const cl = env.authenticatedContext('cl').firestore()
  await assertFails(updateDoc(doc(cl, 'tasks/th'), { status: 'approved', completedAt: serverTimestamp() }))
})

test('client cannot read versions or notes of a hidden task', async () => {
  const cl = env.authenticatedContext('cl').firestore()
  await assertFails(getDoc(doc(cl, 'tasks/th/versions/v1')))
  await assertFails(getDoc(doc(cl, 'tasks/th/notes/n1')))
})

test('client cannot flip clientVisible', async () => {
  const cl = env.authenticatedContext('cl').firestore()
  await assertFails(updateDoc(doc(cl, 'tasks/th'), { clientVisible: true }))
})

// ── blocked/delivered statuses + their documentation fields ─────────────────

test('assigned contractor can block with a documented reason', async () => {
  const ed = env.authenticatedContext('ed').firestore()
  await assertSucceeds(updateDoc(doc(ed, 'tasks/th'), { status: 'blocked', completedAt: null, blockedReason: 'Waiting on VO stems.', blockedAt: serverTimestamp() }))
})

test('assigned contractor can deliver with a delivery note', async () => {
  const ed = env.authenticatedContext('ed').firestore()
  await assertSucceeds(updateDoc(doc(ed, 'tasks/th'), { status: 'delivered', completedAt: serverTimestamp(), deliveryNote: 'Drive → Finals.', blockedReason: '', blockedAt: null }))
})

test('contractor cannot write a non-string blockedReason', async () => {
  const ed = env.authenticatedContext('ed').firestore()
  await assertFails(updateDoc(doc(ed, 'tasks/th'), { status: 'blocked', blockedReason: 42 }))
})

test('client approve cannot smuggle documentation fields', async () => {
  const cl = env.authenticatedContext('cl').firestore()
  await assertFails(updateDoc(doc(cl, 'tasks/t1'), { status: 'approved', completedAt: serverTimestamp(), blockedReason: 'x' }))
})

// ── versions: assignee-gated writes, task-scoped reads ─────────────────────

test('contractor can write a version on their assigned task only', async () => {
  const ed = env.authenticatedContext('ed').firestore()
  await assertSucceeds(setDoc(doc(ed, 'tasks/t1/versions/v2'), { label: 'v2', note: '', mediaUrl: '', createdAt: serverTimestamp() }))
  await assertFails(setDoc(doc(ed, 'tasks/tx/versions/v2'), { label: 'v2', note: '', mediaUrl: '', createdAt: serverTimestamp() }))
})

test('client reads versions of own-tenant tasks only', async () => {
  const cl = env.authenticatedContext('cl').firestore()
  await assertSucceeds(getDoc(doc(cl, 'tasks/t1/versions/v1')))
  await assertFails(getDoc(doc(cl, 'tasks/tx/versions/v1')))
})

test('client cannot write versions', async () => {
  const cl = env.authenticatedContext('cl').firestore()
  await assertFails(setDoc(doc(cl, 'tasks/t1/versions/v9'), { label: 'v9', note: '', mediaUrl: '', createdAt: serverTimestamp() }))
})

// ── notes: author-locked create, author/manager-only update ────────────────

test('note create with spoofed authorUid is denied', async () => {
  const cl = env.authenticatedContext('cl').firestore()
  await assertFails(setDoc(doc(cl, 'tasks/t1/notes/spoof'), {
    versionId: 'v1', authorUid: 'mgr', body: 'not me', resolved: false, createdAt: serverTimestamp(),
  }))
})

test('note create with own authorUid + task access succeeds', async () => {
  const cl = env.authenticatedContext('cl').firestore()
  await assertSucceeds(setDoc(doc(cl, 'tasks/t1/notes/n2'), {
    versionId: 'v1', authorUid: 'cl', body: 'Logo longer.', resolved: false, createdAt: serverTimestamp(),
  }))
})

test('note create with unexpected keys is denied', async () => {
  const cl = env.authenticatedContext('cl').firestore()
  await assertFails(setDoc(doc(cl, 'tasks/t1/notes/n3'), {
    versionId: 'v1', authorUid: 'cl', body: 'x', resolved: false, createdAt: serverTimestamp(), pinned: true,
  }))
})

test('cross-tenant client cannot read or write notes', async () => {
  const cl = env.authenticatedContext('cl').firestore()
  await assertFails(getDoc(doc(cl, 'tasks/tx/notes/n1')))
  await assertFails(setDoc(doc(cl, 'tasks/tx/notes/n9'), {
    versionId: 'v1', authorUid: 'cl', body: 'x', resolved: false, createdAt: serverTimestamp(),
  }))
})

test('note update by non-author non-manager is denied; author and manager succeed', async () => {
  const ed = env.authenticatedContext('ed').firestore()
  const mgr = env.authenticatedContext('mgr').firestore()
  await assertFails(updateDoc(doc(ed, 'tasks/t1/notes/n1'), { resolved: true })) // n1 authored by mgr
  await assertSucceeds(updateDoc(doc(mgr, 'tasks/t1/notes/n1'), { resolved: true }))
})

test('non-manager author may edit only body/resolved on their note', async () => {
  const cl = env.authenticatedContext('cl').firestore()
  await assertSucceeds(updateDoc(doc(cl, 'tasks/t1/notes/ncl'), { body: 'Hold it longer.', resolved: true }))
  // …but cannot rewrite authorUid (or anything else) on it.
  await assertFails(updateDoc(doc(cl, 'tasks/t1/notes/ncl'), { authorUid: 'mgr' }))
  await assertFails(updateDoc(doc(cl, 'tasks/t1/notes/ncl'), { resolved: false, versionId: 'v9' }))
})

// ── cross-org isolation ─────────────────────────────────────────────────────

test('org-A manager cannot read another org\'s task, client, version or note', async () => {
  const mgr = env.authenticatedContext('mgr').firestore()
  await assertFails(getDoc(doc(mgr, 'tasks/tb')))
  await assertFails(getDoc(doc(mgr, 'clients/cb')))
  await assertFails(getDoc(doc(mgr, 'tasks/tb/versions/v1')))
  await assertFails(getDoc(doc(mgr, 'tasks/tb/notes/n1')))
})

test('org-A manager cannot write into another org', async () => {
  const mgr = env.authenticatedContext('mgr').firestore()
  await assertFails(updateDoc(doc(mgr, 'tasks/tb'), { status: 'done' }))
  await assertFails(setDoc(doc(mgr, 'clients/cb2'), { name: 'Sneak', orgId: 'o_b' }))
  await assertFails(setDoc(doc(mgr, 'tasks/tb/notes/n9'), {
    versionId: 'v1', authorUid: 'mgr', body: 'x', resolved: false, createdAt: serverTimestamp(),
  }))
  await assertFails(setDoc(doc(mgr, 'tasks/tb/versions/v9'), { label: 'v9', note: '', mediaUrl: '', createdAt: serverTimestamp() }))
})

// ── dual membership: contractor-in-A, manager-in-B ─────────────────────────

test('dual-membership user manages org B but NOT org A', async () => {
  const ed = env.authenticatedContext('ed').firestore()
  // Manager powers in B (sanity — the role really is admin there). Creates
  // must carry the paired usage-counter increment in the same batch.
  const b = writeBatch(ed)
  b.set(doc(ed, 'clients/cb3'), { name: 'B Client', orgId: 'o_b' })
  b.update(doc(ed, 'orgs/o_b/usage/current'), { activeClients: increment(1) })
  await assertSucceeds(b.commit())
  await assertSucceeds(getDoc(doc(ed, 'tasks/tb')))
  // ...and none of those powers leak into A, where ed is a contractor.
  await assertFails(setDoc(doc(ed, 'clients/c9'), { name: 'A Client', orgId: 'o_a' }))
  await assertFails(deleteDoc(doc(ed, 'tasks/t1')))
  await assertFails(updateDoc(doc(ed, 'orgs/o_a'), { name: 'Owned' }))
  await assertFails(updateDoc(doc(ed, 'orgs/o_a/members/ed2'), { role: 'client' }))
})

test('manager-in-B cannot self-promote in A via own member doc', async () => {
  const ed = env.authenticatedContext('ed').firestore()
  await assertFails(updateDoc(doc(ed, 'orgs/o_a/members/ed'), { role: 'admin' }))
})

// ── members ─────────────────────────────────────────────────────────────────

test('org member reads member list; outsider cannot read another org\'s members', async () => {
  const cl = env.authenticatedContext('cl').firestore()
  const mgr = env.authenticatedContext('mgr').firestore()
  await assertSucceeds(getDoc(doc(cl, 'orgs/o_a/members/mgr')))
  await assertFails(getDoc(doc(mgr, 'orgs/o_b/members/ed')))
})

test('user cannot create their own member doc (functions only)', async () => {
  const north = env.authenticatedContext('north').firestore()
  await assertFails(setDoc(doc(north, 'orgs/o_a/members/north'), {
    uid: 'north', orgId: 'o_a', orgName: 'Org A', displayName: 'North', email: 'north@x.test', role: 'admin', joinedAt: serverTimestamp(),
  }))
})

test('manager can retarget a member role; invalid role is rejected', async () => {
  // mgr is the org OWNER — editing OTHER members stays fully allowed.
  const mgr = env.authenticatedContext('mgr').firestore()
  await assertSucceeds(updateDoc(doc(mgr, 'orgs/o_a/members/ed2'), { role: 'pm' }))
  await assertFails(updateDoc(doc(mgr, 'orgs/o_a/members/ed'), { role: 'superadmin' }))
  await assertFails(updateDoc(doc(mgr, 'orgs/o_a/members/ed'), { orgId: 'o_b' })) // only role/clientId/displayName
})

test('manager cannot touch the org owner\'s member doc', async () => {
  const mgr2 = env.authenticatedContext('mgr2').firestore() // pm, NOT the owner
  await assertFails(updateDoc(doc(mgr2, 'orgs/o_a/members/mgr'), { role: 'contractor' })) // demotion
  await assertFails(updateDoc(doc(mgr2, 'orgs/o_a/members/mgr'), { displayName: 'Renamed Owner' }))
})

test('manager cannot change their OWN role; own displayName is fine', async () => {
  const mgr2 = env.authenticatedContext('mgr2').firestore()
  await assertFails(updateDoc(doc(mgr2, 'orgs/o_a/members/mgr2'), { role: 'admin' })) // self-promotion
  await assertFails(updateDoc(doc(mgr2, 'orgs/o_a/members/mgr2'), { role: 'admin', displayName: 'Sneaky' }))
  await assertSucceeds(updateDoc(doc(mgr2, 'orgs/o_a/members/mgr2'), { displayName: 'PM II' }))
})

test('collection-group members read: own docs allowed, others denied', async () => {
  const ed = env.authenticatedContext('ed').firestore()
  await assertSucceeds(getDocs(query(collectionGroup(ed, 'members'), where('uid', '==', 'ed'))))
  await assertFails(getDocs(query(collectionGroup(ed, 'members'), where('uid', '==', 'mgr'))))
})

// ── orgs / usage / invites ──────────────────────────────────────────────────

test('member reads org doc; non-member cannot; billing fields locked', async () => {
  const cl = env.authenticatedContext('cl').firestore()
  const mgr = env.authenticatedContext('mgr').firestore()
  await assertSucceeds(getDoc(doc(cl, 'orgs/o_a')))
  await assertFails(getDoc(doc(mgr, 'orgs/o_b')))
  await assertSucceeds(updateDoc(doc(mgr, 'orgs/o_a'), { name: 'Org A+' }))
  await assertFails(updateDoc(doc(mgr, 'orgs/o_a'), { plan: 'agency', taskLimit: 999999 }))
  await assertFails(updateDoc(doc(cl, 'orgs/o_a'), { name: 'Client-renamed' }))
})

test('org rename must be a string of at most 60 chars', async () => {
  const mgr = env.authenticatedContext('mgr').firestore()
  await assertFails(updateDoc(doc(mgr, 'orgs/o_a'), { name: 'x'.repeat(61) }))
  await assertFails(updateDoc(doc(mgr, 'orgs/o_a'), { name: 42 }))
})

test('client can read usage but cannot write it', async () => {
  const cl = env.authenticatedContext('cl').firestore()
  await assertSucceeds(getDoc(doc(cl, 'orgs/o_a/usage/current')))
  await assertFails(setDoc(doc(cl, 'orgs/o_a/usage/current'), { seats: 999 }))
})

// o_a is AT its seat limit, so the manager-create-ALLOWED invite path (and
// the pending/lowercase shape checks, which need an org with seat room) run
// against org B, where ed is the admin and seats are unlimited.
test('non-manager cannot create invites; manager can (pending + lowercase email)', async () => {
  const ed = env.authenticatedContext('ed').firestore()
  const cl = env.authenticatedContext('cl').firestore()
  const inviteA = { email: 'friend@x.test', role: 'contractor', status: 'pending', createdAt: serverTimestamp() }
  await assertFails(setDoc(doc(ed, 'orgs/o_a/invites/i2'), { ...inviteA, invitedBy: 'ed' }))
  await assertFails(setDoc(doc(cl, 'orgs/o_a/invites/i3'), { ...inviteA, invitedBy: 'cl' }))
  const inviteB = { ...inviteA, invitedBy: 'ed' }
  await assertSucceeds(setDoc(doc(ed, 'orgs/o_b/invites/ib1'), inviteB))
  await assertFails(setDoc(doc(ed, 'orgs/o_b/invites/ib2'), { ...inviteB, email: 'Friend@X.test' }))
  await assertFails(setDoc(doc(ed, 'orgs/o_b/invites/ib3'), { ...inviteB, status: 'accepted' }))
})

test('manager can revoke an invite but not accept it client-side', async () => {
  const mgr = env.authenticatedContext('mgr').firestore()
  await assertFails(updateDoc(doc(mgr, 'orgs/o_a/invites/i1'), { status: 'accepted' }))
  await assertSucceeds(updateDoc(doc(mgr, 'orgs/o_a/invites/i1'), { status: 'revoked' }))
})

// ── entitlements: usage counters + at-limit create gates (Phase 2) ─────────
// o_a fixtures sit exactly AT their limits (usage == limits); o_b is -1
// (unlimited) everywhere; o_c has finite limits WITH room. NOTE: writes here
// only ever push o_a's counters UP, so the at-limit denials hold regardless
// of test order.

test('manager can batch-increment activeClients/activeTasks on usage', async () => {
  const mgr = env.authenticatedContext('mgr').firestore()
  // The app's write shape: FieldValue.increment alongside the domain write.
  // Written values must be non-negative ints; beyond that a manager can still
  // decrement (bounded at 0) — reconciliation heals drift (accepted trade-off).
  await assertSucceeds(updateDoc(doc(mgr, 'orgs/o_a/usage/current'), {
    activeClients: increment(1), activeTasks: increment(1),
  }))
})

test('usage counters must be non-negative integers', async () => {
  const mgr = env.authenticatedContext('mgr').firestore()
  await assertFails(updateDoc(doc(mgr, 'orgs/o_a/usage/current'), { activeClients: -1 }))
  await assertFails(updateDoc(doc(mgr, 'orgs/o_a/usage/current'), { activeTasks: 1.5 }))
  await assertFails(updateDoc(doc(mgr, 'orgs/o_a/usage/current'), { activeTasks: 'many' }))
})

test('contractor cannot update usage counters', async () => {
  const ed = env.authenticatedContext('ed').firestore() // contractor in o_a
  await assertFails(updateDoc(doc(ed, 'orgs/o_a/usage/current'), { activeClients: increment(1) }))
})

test('nobody can touch usage.seats client-side, not even managers', async () => {
  const mgr = env.authenticatedContext('mgr').firestore()
  await assertFails(updateDoc(doc(mgr, 'orgs/o_a/usage/current'), { seats: increment(1) }))
  // …and not smuggled in next to an allowed key either.
  await assertFails(updateDoc(doc(mgr, 'orgs/o_a/usage/current'), { activeClients: increment(1), seats: 99 }))
})

test('usage docs cannot be created client-side (functions initialize them)', async () => {
  const ed = env.authenticatedContext('ed').firestore() // admin of o_b
  await assertFails(setDoc(doc(ed, 'orgs/o_b/usage/other'), { activeClients: 0, activeTasks: 0 }))
})

test('client create denied at clientLimit even for a manager', async () => {
  const mgr = env.authenticatedContext('mgr').firestore()
  await assertFails(setDoc(doc(mgr, 'clients/c_over'), { name: 'Over the limit', orgId: 'o_a' }))
  // …and batching the paired increment does NOT get past the limit either.
  const b = writeBatch(mgr)
  b.set(doc(mgr, 'clients/c_over'), { name: 'Over the limit', orgId: 'o_a' })
  b.update(doc(mgr, 'orgs/o_a/usage/current'), { activeClients: increment(1) })
  await assertFails(b.commit())
})

test('task create denied at taskLimit even for a manager', async () => {
  const mgr = env.authenticatedContext('mgr').firestore()
  await assertFails(setDoc(doc(mgr, 'tasks/t_over'), { orgId: 'o_a', title: 'Over', clientId: 'c1', assigneeUid: 'ed', status: 'backlog' }))
  const b = writeBatch(mgr)
  b.set(doc(mgr, 'tasks/t_over'), { orgId: 'o_a', title: 'Over', clientId: 'c1', assigneeUid: 'ed', status: 'backlog' })
  b.update(doc(mgr, 'orgs/o_a/usage/current'), { activeTasks: increment(1) })
  await assertFails(b.commit())
})

// H1: the create gates require the SAME batch to bump the matching usage
// counter by exactly +1 (getAfter) — a raw-SDK create that skips the counter
// is denied even on an unlimited org.
test('client/task create WITHOUT the paired counter increment is denied', async () => {
  const ed = env.authenticatedContext('ed').firestore() // admin of o_b (unlimited)
  await assertFails(setDoc(doc(ed, 'clients/cb_nocount'), { name: 'No count', orgId: 'o_b' }))
  await assertFails(setDoc(doc(ed, 'tasks/tb_nocount'), { orgId: 'o_b', title: 'No count', clientId: 'cb', assigneeUid: 'ed', status: 'backlog' }))
})

test('create WITH the paired increment is allowed under a finite limit', async () => {
  const mgr = env.authenticatedContext('mgr').firestore() // pm of o_c (room under limits)
  const bc = writeBatch(mgr)
  bc.set(doc(mgr, 'clients/cc2'), { name: 'Client C2', orgId: 'o_c' })
  bc.update(doc(mgr, 'orgs/o_c/usage/current'), { activeClients: increment(1) })
  await assertSucceeds(bc.commit())
  const bt = writeBatch(mgr)
  bt.set(doc(mgr, 'tasks/tc2'), { orgId: 'o_c', title: 'Task C2', clientId: 'cc', assigneeUid: 'mgr', status: 'backlog' })
  bt.update(doc(mgr, 'orgs/o_c/usage/current'), { activeTasks: increment(1) })
  await assertSucceeds(bt.commit())
})

test('invite create denied at seat limit', async () => {
  const mgr = env.authenticatedContext('mgr').firestore()
  await assertFails(setDoc(doc(mgr, 'orgs/o_a/invites/i_over'), {
    email: 'over@x.test', role: 'contractor', status: 'pending', createdAt: serverTimestamp(), invitedBy: 'mgr',
  }))
})

test('creates allowed when limits are -1 (unlimited org)', async () => {
  const ed = env.authenticatedContext('ed').firestore() // admin of o_b
  // Unlimited waives the LIMIT check, not the paired-increment requirement.
  const bc = writeBatch(ed)
  bc.set(doc(ed, 'clients/cb_unl'), { name: 'Unlimited', orgId: 'o_b' })
  bc.update(doc(ed, 'orgs/o_b/usage/current'), { activeClients: increment(1) })
  await assertSucceeds(bc.commit())
  const bt = writeBatch(ed)
  bt.set(doc(ed, 'tasks/tb_unl'), { orgId: 'o_b', title: 'Unl', clientId: 'cb', assigneeUid: 'ed', status: 'backlog' })
  bt.update(doc(ed, 'orgs/o_b/usage/current'), { activeTasks: increment(1) })
  await assertSucceeds(bt.commit())
  await assertSucceeds(setDoc(doc(ed, 'orgs/o_b/invites/ib_unl'), {
    email: 'unl@x.test', role: 'contractor', status: 'pending', createdAt: serverTimestamp(), invitedBy: 'ed',
  }))
})

// ── unauthenticated ─────────────────────────────────────────────────────────

test('unauthenticated users cannot read tasks, users, orgs or members', async () => {
  const anon = env.unauthenticatedContext().firestore()
  await assertFails(getDoc(doc(anon, 'tasks/t1')))
  await assertFails(getDoc(doc(anon, 'users/mgr')))
  await assertFails(getDoc(doc(anon, 'orgs/o_a')))
  await assertFails(getDoc(doc(anon, 'orgs/o_a/members/mgr')))
})

// ── deliverables: functions-only create/delete, client-scoped reads ─────────

test('deliverable create is denied for every role (functions-only)', async () => {
  const mgr = env.authenticatedContext('mgr').firestore()
  const ed = env.authenticatedContext('ed').firestore()
  const cl = env.authenticatedContext('cl').firestore()
  const del = { orgId: 'o_a', clientId: 'c1', projectId: 'p1', subGroupId: 'sg1', subGroupName: 'X', typeId: 'dt1', name: 'New', stages: [], stageSummary: [], status: 'active', clientVisible: true, latestVersionUrl: '', order: 0, meta: [], createdAt: new Date(), deliveredAt: null }
  await assertFails(setDoc(doc(mgr, 'deliverables/d_new'), del))
  await assertFails(setDoc(doc(ed, 'deliverables/d_new'), del))
  await assertFails(setDoc(doc(cl, 'deliverables/d_new'), del))
})

test('deliverable delete is denied for every role (functions-only)', async () => {
  const mgr = env.authenticatedContext('mgr').firestore()
  await assertFails(deleteDoc(doc(mgr, 'deliverables/d1')))
})

test('client reads only their own tenant deliverables with clientVisible', async () => {
  const cl = env.authenticatedContext('cl').firestore()
  // d1: own tenant + visible → allowed
  await assertSucceeds(getDoc(doc(cl, 'deliverables/d1')))
  // d2: wrong tenant → denied
  await assertFails(getDoc(doc(cl, 'deliverables/d2')))
  // d3: own tenant but not visible → denied
  await assertFails(getDoc(doc(cl, 'deliverables/d3')))
})

test('manager can read all org deliverables; cross-org denied', async () => {
  const mgr = env.authenticatedContext('mgr').firestore()
  await assertSucceeds(getDoc(doc(mgr, 'deliverables/d1')))
  await assertSucceeds(getDoc(doc(mgr, 'deliverables/d3'))) // not visible but manager can read
  await assertFails(getDoc(doc(mgr, 'deliverables/db1')))   // wrong org
})

test('manager can update safe fields on deliverable', async () => {
  const mgr = env.authenticatedContext('mgr').firestore()
  await assertSucceeds(updateDoc(doc(mgr, 'deliverables/d1'), { name: 'Renamed', clientVisible: false }))
})

test('manager cannot update approval or stageSummary fields on deliverable', async () => {
  const mgr = env.authenticatedContext('mgr').firestore()
  await assertFails(updateDoc(doc(mgr, 'deliverables/d1'), { stageSummary: [{ stageId: 's1', name: 'Edit', status: 'done', assigneeUid: '', assigneeName: '', dueAt: null }] }))
  await assertFails(updateDoc(doc(mgr, 'deliverables/d1'), { approvedBy: 'hacker' }))
  await assertFails(updateDoc(doc(mgr, 'deliverables/d1'), { approvedVia: 'portal' }))
  await assertFails(updateDoc(doc(mgr, 'deliverables/d1'), { approvedAt: new Date() }))
  await assertFails(updateDoc(doc(mgr, 'deliverables/d1'), { approvalNote: 'forged' }))
})

test('contractor cannot update deliverables', async () => {
  const ed = env.authenticatedContext('ed').firestore()
  await assertFails(updateDoc(doc(ed, 'deliverables/d1'), { name: 'Hax' }))
})

test('activeDeliverables is rejected from client-SDK usage writes', async () => {
  const mgr = env.authenticatedContext('mgr').firestore()
  await assertFails(updateDoc(doc(mgr, 'orgs/o_a/usage/current'), { activeDeliverables: 99 }))
})

// ── deliverableTypes: mirrors subGroups access ──────────────────────────────

test('manager can CRUD deliverable types', async () => {
  const mgr = env.authenticatedContext('mgr').firestore()
  await assertSucceeds(getDoc(doc(mgr, 'deliverableTypes/dt1')))
  await assertSucceeds(setDoc(doc(mgr, 'deliverableTypes/dt_new'), { orgId: 'o_a', name: 'Long-form', weight: 15, order: 1 }))
  await assertSucceeds(updateDoc(doc(mgr, 'deliverableTypes/dt1'), { name: 'Reel' }))
  await assertSucceeds(deleteDoc(doc(mgr, 'deliverableTypes/dt_new')))
})

test('contractor can read but not write deliverable types', async () => {
  const ed = env.authenticatedContext('ed').firestore()
  await assertSucceeds(getDoc(doc(ed, 'deliverableTypes/dt1')))
  await assertFails(setDoc(doc(ed, 'deliverableTypes/dt_nope'), { orgId: 'o_a', name: 'Nope', weight: 1, order: 0 }))
})

test('client cannot read deliverable types', async () => {
  const cl = env.authenticatedContext('cl').firestore()
  await assertFails(getDoc(doc(cl, 'deliverableTypes/dt1')))
})

// ── client status: revisions now allowed alongside approved ─────────────────

test('client can set revisions on a visible task in their tenant', async () => {
  const cl = env.authenticatedContext('cl').firestore()
  await assertSucceeds(updateDoc(doc(cl, 'tasks/t1'), { status: 'revisions', completedAt: null }))
})

test('client cannot set statuses other than approved/revisions', async () => {
  const cl = env.authenticatedContext('cl').firestore()
  await assertFails(updateDoc(doc(cl, 'tasks/t1'), { status: 'in_progress' }))
  await assertFails(updateDoc(doc(cl, 'tasks/t1'), { status: 'done' }))
})

// ── org pipeline: managers can update it ────────────────────────────────────

test('manager can update org pipeline field', async () => {
  const mgr = env.authenticatedContext('mgr').firestore()
  await assertSucceeds(updateDoc(doc(mgr, 'orgs/o_a'), {
    pipeline: { stages: [{ id: 's1', name: 'Capture', optional: false, clientFacing: false }] },
  }))
})

test('manager cannot update billing fields on org', async () => {
  const mgr = env.authenticatedContext('mgr').firestore()
  await assertFails(updateDoc(doc(mgr, 'orgs/o_a'), { plan: 'agency' }))
  await assertFails(updateDoc(doc(mgr, 'orgs/o_a'), { seatLimit: 999 }))
  await assertFails(updateDoc(doc(mgr, 'orgs/o_a'), { deliverableLimit: 999 }))
})
