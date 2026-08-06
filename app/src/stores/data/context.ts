// The data store's shared spine: the reactive document cache every slice reads
// and writes, plus the plumbing (freshness memo, live-listener registry,
// org scoping, reset) that all of them need.
//
// A collection lives HERE rather than inside a slice when more than one slice
// touches it — e.g. `tasks` is written by the tasks slice, the board window,
// and the cascade deletes; `ledgerTasks` is filled by the ledger slice and
// pruned by the deletes slice. Single-owner state (paging cursors, the filtered
// task view) stays inside its own slice and registers an `onReset` hook.
import { ref } from 'vue'
import {
  doc,
  onSnapshot,
  type DocumentReference,
  type Query,
  type QuerySnapshot,
  type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { useAuthStore } from '../auth'
import { upsert } from './shared'
import type { Client, Deliverable, Invite, Project, SubGroup, Task, UserProfile } from '../../lib/types'

export function createDataContext() {
  const usersById = ref<Record<string, UserProfile>>({})
  const clients = ref<Client[]>([])
  const projects = ref<Project[]>([])
  const subGroups = ref<SubGroup[]>([])
  const tasks = ref<Task[]>([])
  const deliverables = ref<Deliverable[]>([])
  const invites = ref<Invite[]>([])

  // Ledger state: completed work, newest completion first, paged. Kept apart
  // from `tasks` so the org-wide window and the ledger never mix pagination
  // states (see loadLedger). Lives here because the cascade deletes prune it.
  const ledgerTasks = ref<Task[]>([])

  // Freshness policy for the SCOPED pull loads (board window, client-detail
  // subset, ledger): each records WHEN it ran and re-fetches once it ages out;
  // `force` skips the check entirely, which is what the explicit refresh
  // controls call. The org-wide flat collections no longer use this — they are
  // live listeners (below) and have no notion of staleness.
  const FRESH_TTL_MS = 5 * 60 * 1000
  const loadedAt = ref<Record<string, number>>({})
  function isFresh(key: string): boolean {
    return Date.now() - (loadedAt.value[key] ?? 0) < FRESH_TTL_MS
  }
  function markLoaded(key: string): void {
    loadedAt.value = { ...loadedAt.value, [key]: Date.now() }
  }

  // ── Live listeners (org-wide collections) ─────────────────────
  // Members, clients, projects, tasks (first window), invites, and per-uid
  // assigned tasks are onSnapshot listeners rather than getDocs + TTL. The
  // first attach bills the same reads as the old full fetch; after that only
  // server-side CHANGES are billed and pushed, so these collections are always
  // current and never need a manual refresh. With the persistent cache
  // (lib/firebase.ts) a reload resumes from the last sync token and re-pays
  // only the delta since the previous session.
  const listeners = new Map<string, Unsubscribe>()
  const listenerReady = new Map<string, Promise<void>>()

  // Attach (once) a keyed listener. Resolves after the first snapshot so
  // callers can await "data is on screen"; later snapshots stream in silently.
  // On error the listener is detached and forgotten so a page-level retry
  // attaches a fresh one instead of returning the same rejected promise.
  function listen(key: string, q: Query, onSnap: (snap: QuerySnapshot) => void): Promise<void> {
    const existing = listenerReady.get(key)
    if (existing) return existing
    const ready = new Promise<void>((resolve, reject) => {
      let first = true
      const unsub = onSnapshot(q, (snap) => {
        onSnap(snap)
        if (first) { first = false; resolve() }
      }, (err) => {
        listeners.get(key)?.()
        listeners.delete(key)
        listenerReady.delete(key)
        if (first) { first = false; reject(err) }
      })
      listeners.set(key, unsub)
    })
    listenerReady.set(key, ready)
    return ready
  }

  // Fold a snapshot's changes into an array ref. `removed` really removes —
  // for windowed queries that includes docs pushed out of the window by new
  // arrivals, which matches the old first-page-replaces semantics.
  //
  // Reactivity note: `removed` reassigns arr.value (new array identity),
  // while `added`/`modified` mutate in place via upsert. Both trigger Vue 3
  // reactivity correctly because ref<T[]> wraps the inner array in a Proxy
  // that tracks index assignment and .push(). The loop processes docChanges
  // sequentially; after a `removed` reassignment, subsequent iterations read
  // the NEW arr.value reference, so upserts land in the right array.
  function applyChanges<T extends { id: string }>(
    arr: { value: T[] },
    snap: QuerySnapshot,
    map: (id: string, d: Record<string, unknown>) => T,
  ): void {
    for (const c of snap.docChanges()) {
      if (c.type === 'removed') arr.value = arr.value.filter((x) => x.id !== c.doc.id)
      else upsert(arr.value, map(c.doc.id, c.doc.data()))
    }
  }

  // Every query/create is scoped to the active org — reading or writing
  // without one is a programming error, not a state to limp through.
  function requireOrgId(): string {
    const orgId = useAuthStore().activeOrgId
    if (!orgId) throw new Error('data store used with no active org')
    return orgId
  }

  // orgs/{orgId}/usage/current — the entitlement counter doc. Client/task
  // creates and cascade deletes adjust it via increment() IN THE SAME
  // writeBatch as the docs themselves (rules validate the pairing).
  function usageRef(orgId: string): DocumentReference {
    return doc(db, 'orgs', orgId, 'usage', 'current')
  }

  // Slices register their own state teardown here so `reset()` stays a single
  // entry point without this module knowing what any slice holds.
  const resetHooks: Array<() => void> = []
  function onReset(fn: () => void): void {
    resetHooks.push(fn)
  }

  // Clear ALL state back to initial — called on sign-out and org switch so
  // nothing bleeds across accounts or workspaces. Detaching the listeners is
  // part of that: a live listener left running would keep writing the OLD
  // org's docs into the store after the switch.
  function reset(): void {
    for (const unsub of listeners.values()) unsub()
    listeners.clear()
    listenerReady.clear()
    usersById.value = {}
    clients.value = []
    projects.value = []
    subGroups.value = []
    tasks.value = []
    deliverables.value = []
    invites.value = []
    ledgerTasks.value = []
    loadedAt.value = {}
    for (const fn of resetHooks) fn()
  }

  return {
    usersById, clients, projects, subGroups, tasks, deliverables, invites, ledgerTasks,
    isFresh, markLoaded,
    listen, applyChanges,
    requireOrgId, usageRef,
    onReset, reset,
  }
}

export type DataContext = ReturnType<typeof createDataContext>
