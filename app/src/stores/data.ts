import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  collection,
  doc,
  documentId,
  getCountFromServer,
  getDoc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  query,
  startAfter,
  where,
  orderBy,
  updateDoc,
  addDoc,
  serverTimestamp,
  writeBatch,
  Timestamp,
  type DocumentReference,
  type Query,
  type QueryConstraint,
  type QueryDocumentSnapshot,
  type QuerySnapshot,
  type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { i18n } from '../i18n'
import { useAuthStore } from './auth'
import { useToastStore } from './toast'
import { track } from '../lib/analytics'
import { mapClient, mapDeliverable, mapInvite, mapMember, mapNote, mapPackage, mapProject, mapSubGroup, mapTask, mapVersion } from '../lib/mappers'
import { DONE_STATUSES, isDoneStatus } from '../lib/status'
import { priorityRank, TASK_STATUSES, WorkflowPipelineSchema } from '../lib/types'
import type {
  Client, Deliverable, Invite, Package, Project, RecordingSession, Role, SubGroup, Task, TaskStatus, Version, Note, UserProfile, MetaField,
  WorkflowStage,
} from '../lib/types'

// Run a Firestore write; on failure surface a toast and rethrow so callers can
// keep a modal open / avoid assuming success.
async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    useToastStore().error(i18n.global.t('common.saveError'))
    throw e
  }
}

// Firestore batches cap at 500 ops — chunk conservatively below that so each
// cascade commits atomically (or in a handful of atomic chunks when huge).
// The optional usage-counter decrement rides in the FIRST chunk so the
// entitlement counters move in the same commit as the docs they count
// (rules validate the counter write matches the mutation).
const BATCH_LIMIT = 400
async function commitDeletes(
  refs: DocumentReference[],
  usage?: { ref: DocumentReference; patch: Record<string, unknown> },
): Promise<void> {
  for (let i = 0; i < refs.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db)
    if (i === 0 && usage) batch.update(usage.ref, usage.patch)
    for (const r of refs.slice(i, i + BATCH_LIMIT)) batch.delete(r)
    await batch.commit()
  }
}

// Full-collection loads page at this size (AUDIT E3): first page replaces
// state, loadMore* appends.
const PAGE_SIZE = 1000

export const useDataStore = defineStore('data', () => {
  const usersById = ref<Record<string, UserProfile>>({})
  const clients = ref<Client[]>([])
  const projects = ref<Project[]>([])
  const subGroups = ref<SubGroup[]>([])
  const tasks = ref<Task[]>([])
  const deliverables = ref<Deliverable[]>([])
  const invites = ref<Invite[]>([])

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

  // Pagination cursors for the full-collection loads (cleared by reset()).
  let tasksCursor: QueryDocumentSnapshot | null = null
  let projectsCursor: QueryDocumentSnapshot | null = null
  const tasksMayHaveMore = ref(false)
  const projectsMayHaveMore = ref(false)

  // Ledger state: completed work, newest completion first, paged. Kept apart
  // from `tasks` so the org-wide window and the ledger never mix pagination
  // states (see loadLedger).
  const LEDGER_PAGE_SIZE = 200
  const ledgerTasks = ref<Task[]>([])
  const ledgerMayHaveMore = ref(false)
  let ledgerCursor: QueryDocumentSnapshot | null = null

  // Filtered task view (All Tasks past the live window): one filter combo's
  // server-side results at a time, paged. See loadFilteredTasks.
  const FILTERED_PAGE_SIZE = 200
  const filteredTasks = ref<Task[]>([])
  const filteredMayHaveMore = ref(false)
  let filteredCursor: QueryDocumentSnapshot | null = null
  let filteredKey = ''

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
    loadedAt.value = {}
    tasksCursor = null
    projectsCursor = null
    tasksMayHaveMore.value = false
    projectsMayHaveMore.value = false
    ledgerTasks.value = []
    ledgerMayHaveMore.value = false
    ledgerCursor = null
    filteredTasks.value = []
    filteredMayHaveMore.value = false
    filteredCursor = null
    filteredKey = ''
    subGroupCursors.clear()
    subGroupsMayHaveMore.value = {}
  }

  function upsert<T extends { id: string }>(arr: T[], item: T) {
    const i = arr.findIndex((x) => x.id === item.id)
    if (i === -1) arr.push(item)
    else arr[i] = item
  }

  // ── Members of the active org (assignee/author name lookups) ──
  // Kept as `loadUsers`/`usersById` so existing pages keep working; the data
  // comes from orgs/{orgId}/members. Live listener: invite accepts and
  // removals made by other sessions land here without a manual refresh.
  // `force` is accepted for signature compatibility — live data has nothing
  // to force.
  async function loadUsers(force = false): Promise<void> {
    void force
    const orgId = requireOrgId()
    return listen('users', collection(db, 'orgs', orgId, 'members'), (snap) => {
      for (const c of snap.docChanges()) {
        if (c.type === 'removed') {
          const next = { ...usersById.value }
          delete next[c.doc.id]
          usersById.value = next
        } else {
          usersById.value = { ...usersById.value, [c.doc.id]: mapMember(c.doc.id, c.doc.data()) }
        }
      }
    })
  }
  function userName(uid: string): string {
    return usersById.value[uid]?.displayName ?? '—'
  }
  // Assignable roster: everyone on the team (admins, PMs, contractors).
  // Client-role members are external reviewers, never assignees.
  const teamMembers = computed<UserProfile[]>(() =>
    Object.values(usersById.value).filter((u) => u.role !== 'client'),
  )

  // ── Clients ───────────────────────────────────────────────────
  // Live listener over the whole org's clients (unpaged — an agency's client
  // roster is dozens, not thousands).
  async function loadClients(force = false): Promise<void> {
    void force
    const orgId = requireOrgId()
    return listen('clients', query(collection(db, 'clients'), where('orgId', '==', orgId)), (snap) => {
      applyChanges(clients, snap, mapClient)
    })
  }
  // Single client by id (rule-compatible for the client role, which can't run
  // an unfiltered clients query).
  async function loadClient(id: string): Promise<void> {
    const snap = await getDoc(doc(db, 'clients', id))
    if (!snap.exists()) return
    const c = mapClient(snap.id, snap.data())
    // Cross-org deep link: a doc from another org must never enter this
    // org's store — treat it as not-found.
    if (c.orgId !== requireOrgId()) return
    upsert(clients.value, c)
  }
  function getClient(id: string): Client | undefined {
    return clients.value.find((c) => c.id === id)
  }

  // ── Projects ──────────────────────────────────────────────────
  // Scoped pull with a TTL memo — revisiting a client detail page within the
  // freshness window costs nothing; its refresh control passes `force`.
  async function loadProjectsForClient(clientId: string, force = false): Promise<void> {
    if (!force && isFresh(`clientProjects:${clientId}`)) return
    const orgId = requireOrgId()
    const q = query(
      collection(db, 'projects'),
      where('orgId', '==', orgId),
      where('clientId', '==', clientId),
    )
    const snap = await getDocs(q)
    snap.forEach((d) => upsert(projects.value, mapProject(d.id, d.data())))
    markLoaded(`clientProjects:${clientId}`)
  }
  // Live listener over the first PAGE_SIZE projects by document id;
  // loadMoreProjects appends past the window with one-shot reads. Each
  // snapshot re-anchors the cursor to the window's end — after a loadMore,
  // a later snapshot can rewind it, making the next loadMore re-read a page
  // it already has (upsert dedupes; the cost is a re-read, not wrong data).
  async function loadAllProjects(force = false): Promise<void> {
    void force
    const orgId = requireOrgId()
    return listen('projects', query(
      collection(db, 'projects'),
      where('orgId', '==', orgId),
      orderBy(documentId()),
      limit(PAGE_SIZE),
    ), (snap) => {
      applyChanges(projects, snap, mapProject)
      projectsCursor = snap.docs[snap.docs.length - 1] ?? null
      projectsMayHaveMore.value = snap.docs.length === PAGE_SIZE
    })
  }
  async function loadMoreProjects(): Promise<void> {
    if (!projectsMayHaveMore.value || !projectsCursor) return
    const orgId = requireOrgId()
    const snap = await getDocs(query(
      collection(db, 'projects'),
      where('orgId', '==', orgId),
      orderBy(documentId()),
      startAfter(projectsCursor),
      limit(PAGE_SIZE),
    ))
    snap.forEach((d) => upsert(projects.value, mapProject(d.id, d.data())))
    projectsCursor = snap.docs[snap.docs.length - 1] ?? projectsCursor
    projectsMayHaveMore.value = snap.docs.length === PAGE_SIZE
  }
  async function loadProject(id: string): Promise<Project | undefined> {
    const snap = await getDoc(doc(db, 'projects', id))
    if (!snap.exists()) return undefined
    const p = mapProject(snap.id, snap.data())
    // Cross-org deep link: a doc from another org must never enter this
    // org's store — treat it as not-found.
    if (p.orgId !== requireOrgId()) return undefined
    upsert(projects.value, p)
    return p
  }
  function getProject(id: string): Project | undefined {
    return projects.value.find((p) => p.id === id)
  }

  // ── Board: sub-groups + tasks for a project ───────────────────
  // Agencies that name a sub-group per month accumulate them forever, and the
  // board used to read EVERY sub-group and EVERY task of a project on each
  // visit. It now pages: the newest few sub-groups load on mount and the rest
  // are pulled on demand.
  //
  // Paging key is `order`, not a timestamp — sub-groups have no createdAt, but
  // `order` is assigned as the sub-group count at creation (see createSubGroup),
  // so descending `order` IS newest-first, with no schema change or backfill.
  const RECENT_SUB_GROUP_PAGE = 2

  // Per-project paging state for "load earlier".
  const subGroupCursors = new Map<string, QueryDocumentSnapshot | null>()
  const subGroupsMayHaveMore = ref<Record<string, boolean>>({})

  // Firestore caps `in` at 30 values.
  const IN_LIMIT = 30
  function chunk<T>(arr: T[], size: number): T[][] {
    const out: T[][] = []
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
    return out
  }

  // Tasks + deliverables for a specific set of sub-groups. Both are scoped by
  // subGroupId rather than projectId so the reads track the loaded window
  // instead of the whole project.
  async function loadChildrenOfSubGroups(subGroupIds: string[]): Promise<void> {
    if (!subGroupIds.length) return
    const orgId = requireOrgId()
    const freshTasks = new Set<string>()
    const freshDeliverables = new Set<string>()
    await Promise.all(chunk(subGroupIds, IN_LIMIT).flatMap((ids) => [
      getDocs(query(collection(db, 'tasks'), where('orgId', '==', orgId), where('subGroupId', 'in', ids)))
        .then((snap) => snap.forEach((d) => { freshTasks.add(d.id); upsert(tasks.value, mapTask(d.id, d.data())) })),
      getDocs(query(collection(db, 'deliverables'), where('orgId', '==', orgId), where('subGroupId', 'in', ids)))
        .then((snap) => snap.forEach((d) => { freshDeliverables.add(d.id); upsert(deliverables.value, mapDeliverable(d.id, d.data())) })),
    ]))
    // Reconcile the re-read window: an in-window doc the fresh read didn't
    // return was deleted remotely — drop it so it can't ghost. Docs OUTSIDE
    // the window are untouched, so this never fights the org-wide tasks
    // listener the way the old whole-project prune did.
    const windowIds = new Set(subGroupIds)
    tasks.value = tasks.value.filter((t) => !windowIds.has(t.subGroupId) || freshTasks.has(t.id))
    deliverables.value = deliverables.value.filter((d) => !windowIds.has(d.subGroupId) || freshDeliverables.has(d.id))
  }

  async function loadProjectBoard(projectId: string, force = false, pageSize = RECENT_SUB_GROUP_PAGE): Promise<void> {
    if (!force && isFresh(`board:${projectId}`)) return
    const orgId = requireOrgId()
    const snap = await getDocs(query(
      collection(db, 'subGroups'),
      where('orgId', '==', orgId),
      where('projectId', '==', projectId),
      orderBy('order', 'desc'),
      limit(pageSize),
    ))
    // First page replaces this project's sub-group window so remotely deleted
    // batches don't ghost; loadMoreSubGroups appends. Tasks/deliverables are
    // NOT pruned here: the board renders only tasks whose sub-group is in the
    // loaded window (see ProjectBoardPage), so out-of-window docs left in the
    // store are invisible there while staying valid for the flat surfaces.
    subGroups.value = subGroups.value.filter((s) => s.projectId !== projectId)
    snap.forEach((d) => upsert(subGroups.value, mapSubGroup(d.id, d.data())))

    subGroupCursors.set(projectId, snap.docs[snap.docs.length - 1] ?? null)
    subGroupsMayHaveMore.value = { ...subGroupsMayHaveMore.value, [projectId]: snap.docs.length === pageSize }

    await loadChildrenOfSubGroups(snap.docs.map((d) => d.id))
    markLoaded(`board:${projectId}`)
  }

  async function loadMoreSubGroups(projectId: string, pageSize = RECENT_SUB_GROUP_PAGE): Promise<void> {
    const cursor = subGroupCursors.get(projectId)
    if (!subGroupsMayHaveMore.value[projectId] || !cursor) return
    const orgId = requireOrgId()
    const snap = await getDocs(query(
      collection(db, 'subGroups'),
      where('orgId', '==', orgId),
      where('projectId', '==', projectId),
      orderBy('order', 'desc'),
      startAfter(cursor),
      limit(pageSize),
    ))
    snap.forEach((d) => upsert(subGroups.value, mapSubGroup(d.id, d.data())))
    subGroupCursors.set(projectId, snap.docs[snap.docs.length - 1] ?? cursor)
    subGroupsMayHaveMore.value = { ...subGroupsMayHaveMore.value, [projectId]: snap.docs.length === pageSize }
    await loadChildrenOfSubGroups(snap.docs.map((d) => d.id))
  }

  function projectHasMoreSubGroups(projectId: string): boolean {
    return subGroupsMayHaveMore.value[projectId] ?? false
  }

  // EVERY sub-group of a project, unpaged, with no pruning of the store.
  // The board must not use this — that is the read the paging exists to kill.
  // The CSV importer must: it dedupes incoming batch names against existing
  // sub-groups, so a partial view makes it create a second "May archive"
  // alongside the real one. An explicit admin import is a cold path where the
  // full read is the correct trade.
  async function loadAllSubGroupsForProject(projectId: string): Promise<void> {
    const orgId = requireOrgId()
    const snap = await getDocs(query(
      collection(db, 'subGroups'),
      where('orgId', '==', orgId),
      where('projectId', '==', projectId),
    ))
    snap.forEach((d) => upsert(subGroups.value, mapSubGroup(d.id, d.data())))
  }

  // NOTE: there is deliberately no "load every deliverable in this project"
  // helper any more. The board now pages by sub-group and pulls deliverables
  // through loadChildrenOfSubGroups; an unbounded per-project load would
  // silently refill the store and undo the paging on the next call.
  // PackageQuota's numbers come from server-side count() aggregations, so it
  // never needed the documents in the first place.

  // Batch order by default; `byPriority` puts high first and keeps batch order
  // as the tiebreak, so the list stays stable rather than reshuffling within a
  // priority band. Sorted here in memory — every caller already holds the
  // project's full deliverable set, so this needs no index and no extra read.
  function deliverablesForSubGroup(subGroupId: string, byPriority = false): Deliverable[] {
    return deliverables.value
      .filter((d) => d.subGroupId === subGroupId)
      .sort((a, b) => (byPriority ? priorityRank(a.priority) - priorityRank(b.priority) : 0) || a.order - b.order)
  }

  // Single deliverable by id, for surfaces that arrive at one directly (a task's
  // parent, a deep link) without having loaded its project's board.
  function getDeliverable(id: string): Deliverable | undefined {
    return deliverables.value.find((d) => d.id === id)
  }
  async function loadDeliverable(id: string): Promise<Deliverable | undefined> {
    const snap = await getDoc(doc(db, 'deliverables', id))
    if (!snap.exists()) return undefined
    const del = mapDeliverable(snap.id, snap.data())
    // Cross-org deep link: a doc from another org must never enter this
    // org's store — treat it as not-found.
    if (del.orgId !== requireOrgId()) return undefined
    upsert(deliverables.value, del)
    return del
  }

  async function updateDeliverable(id: string, patch: Partial<Pick<Deliverable, 'name' | 'meta' | 'order' | 'clientVisible' | 'status' | 'priority'>>): Promise<void> {
    await guarded(() => updateDoc(doc(db, 'deliverables', id), patch))
    const local = deliverables.value.find((d) => d.id === id)
    if (local) Object.assign(local, patch)
  }

  function subGroupsForProject(projectId: string): SubGroup[] {
    return subGroups.value.filter((s) => s.projectId === projectId).sort((a, b) => a.order - b.order)
  }
  function getSubGroup(id: string): SubGroup | undefined {
    return subGroups.value.find((s) => s.id === id)
  }
  async function loadSubGroup(id: string): Promise<SubGroup | undefined> {
    const snap = await getDoc(doc(db, 'subGroups', id))
    if (!snap.exists()) return undefined
    const sg = mapSubGroup(snap.id, snap.data())
    // Cross-org deep link: a doc from another org must never enter this
    // org's store — treat it as not-found.
    if (sg.orgId !== requireOrgId()) return undefined
    upsert(subGroups.value, sg)
    return sg
  }
  // Pull one sub-group into the board's window even though paging left it out —
  // used after a batch create aimed at an older batch, so the work that was
  // just created doesn't land off-screen.
  async function loadSubGroupWithChildren(id: string): Promise<void> {
    const sg = await loadSubGroup(id)
    if (sg) await loadChildrenOfSubGroups([id])
  }
  function tasksForProject(projectId: string): Task[] {
    return tasks.value.filter((t) => t.projectId === projectId).sort((a, b) => a.order - b.order)
  }
  function getTask(id: string): Task | undefined {
    return tasks.value.find((t) => t.id === id)
  }
  async function loadTask(id: string): Promise<Task | undefined> {
    const snap = await getDoc(doc(db, 'tasks', id))
    if (!snap.exists()) return undefined
    const t = mapTask(snap.id, snap.data())
    // Cross-org deep link: a doc from another org must never enter this
    // org's store — treat it as not-found.
    if (t.orgId !== requireOrgId()) return undefined
    upsert(tasks.value, t)
    return t
  }

  // ── Assigned tasks (Contractor Slate, Team member page) ───────
  // Live listener per uid — assigned work changes underneath a contractor
  // constantly, which is exactly what a push channel is for. Reassigning a
  // task AWAY from this uid emits `removed` and drops it from the store; if
  // it belongs in the org-wide window, that listener re-adds it.
  async function loadAssignedTasks(uid: string): Promise<void> {
    const orgId = requireOrgId()
    return listen(
      `assigned:${uid}`,
      query(collection(db, 'tasks'), where('orgId', '==', orgId), where('assigneeUid', '==', uid)),
      (snap) => applyChanges(tasks, snap, mapTask),
    )
  }
  function tasksForAssignee(uid: string): Task[] {
    return tasks.value.filter((t) => t.assigneeUid === uid)
  }

  // ── All tasks (All Tasks page + omni-search; managers/contractors) ────
  // Live listener over the first PAGE_SIZE tasks by document id;
  // loadMoreTasks appends past the window with one-shot reads (same cursor
  // re-anchoring caveat as loadAllProjects). Analytics/Team/Ledger numbers
  // deliberately do NOT come from this window — they use the aggregation
  // counters and the ledger query below, which stay exact past the window.
  async function loadAllTasks(force = false): Promise<void> {
    void force
    const orgId = requireOrgId()
    return listen('tasks', query(
      collection(db, 'tasks'),
      where('orgId', '==', orgId),
      orderBy(documentId()),
      limit(PAGE_SIZE),
    ), (snap) => {
      applyChanges(tasks, snap, mapTask)
      tasksCursor = snap.docs[snap.docs.length - 1] ?? null
      tasksMayHaveMore.value = snap.docs.length === PAGE_SIZE
    })
  }
  async function loadMoreTasks(): Promise<void> {
    if (!tasksMayHaveMore.value || !tasksCursor) return
    const orgId = requireOrgId()
    const snap = await getDocs(query(
      collection(db, 'tasks'),
      where('orgId', '==', orgId),
      orderBy(documentId()),
      startAfter(tasksCursor),
      limit(PAGE_SIZE),
    ))
    snap.forEach((d) => upsert(tasks.value, mapTask(d.id, d.data())))
    tasksCursor = snap.docs[snap.docs.length - 1] ?? tasksCursor
    tasksMayHaveMore.value = snap.docs.length === PAGE_SIZE
  }
  // Client-scoped tasks (rule-compatible for the client role via the filters:
  // clients may only read tasks explicitly shared with them, so the query
  // must exclude hidden tasks or Firestore rejects it wholesale).
  async function loadTasksForClient(clientId: string): Promise<void> {
    const orgId = requireOrgId()
    const snap = await getDocs(query(
      collection(db, 'tasks'),
      where('orgId', '==', orgId),
      where('clientId', '==', clientId),
      where('clientVisible', '==', true),
    ))
    snap.forEach((d) => upsert(tasks.value, mapTask(d.id, d.data())))
  }

  // Manager-scoped: load ALL tasks for a specific client (no clientVisible
  // filter). TTL-memoized per client; the detail page's refresh passes force.
  async function loadAllTasksForClient(clientId: string, force = false): Promise<void> {
    if (!force && isFresh(`clientTasks:${clientId}`)) return
    const orgId = requireOrgId()
    const snap = await getDocs(query(
      collection(db, 'tasks'),
      where('orgId', '==', orgId),
      where('clientId', '==', clientId),
    ))
    snap.forEach((d) => upsert(tasks.value, mapTask(d.id, d.data())))
    markLoaded(`clientTasks:${clientId}`)
  }

  // ── Ledger (completed work; scoped + paged) ───────────────────
  // The Ledger used to compute over the org-wide task window — the first
  // PAGE_SIZE tasks by document id — which silently under-reported once a
  // workspace outgrew the window. It now has its own query: completed tasks
  // only, newest completion first, paged. Composite index:
  // (orgId, status, completedAt DESC) in firestore.indexes.json.
  async function loadLedger(force = false): Promise<void> {
    if (!force && isFresh('ledger')) return
    const orgId = requireOrgId()
    const snap = await getDocs(query(
      collection(db, 'tasks'),
      where('orgId', '==', orgId),
      where('status', 'in', DONE_STATUSES),
      orderBy('completedAt', 'desc'),
      limit(LEDGER_PAGE_SIZE),
    ))
    ledgerTasks.value = snap.docs.map((d) => mapTask(d.id, d.data()))
    ledgerCursor = snap.docs[snap.docs.length - 1] ?? null
    ledgerMayHaveMore.value = snap.docs.length === LEDGER_PAGE_SIZE
    markLoaded('ledger')
  }
  async function loadMoreLedger(): Promise<void> {
    if (!ledgerMayHaveMore.value || !ledgerCursor) return
    const orgId = requireOrgId()
    const snap = await getDocs(query(
      collection(db, 'tasks'),
      where('orgId', '==', orgId),
      where('status', 'in', DONE_STATUSES),
      orderBy('completedAt', 'desc'),
      startAfter(ledgerCursor),
      limit(LEDGER_PAGE_SIZE),
    ))
    snap.forEach((d) => upsert(ledgerTasks.value, mapTask(d.id, d.data())))
    ledgerCursor = snap.docs[snap.docs.length - 1] ?? ledgerCursor
    ledgerMayHaveMore.value = snap.docs.length === LEDGER_PAGE_SIZE
  }

  // ── Status-filtered tasks (Task Queue past the live window) ───
  // The org-wide listener only covers the first PAGE_SIZE tasks by document
  // id, so once a workspace outgrows it, a client-side status cut over the
  // store silently misses matches. When a status filter is active AND the
  // window is incomplete, the queue switches to this: a server-side
  // `status in [...]` query (a list, so the board's aggregate "In Review"
  // cut works too), ordered by dueAt for stable pagination. One status set
  // is held at a time; changing it replaces the results.
  // Composite index: (orgId, status, dueAt) in firestore.indexes.json —
  // `in` is a disjunction of equalities, so the one index serves any set.
  async function loadFilteredTasks(statuses: TaskStatus[], force = false): Promise<void> {
    if (!statuses.length) return
    const key = [...statuses].sort().join(',')
    if (!force && key === filteredKey && isFresh(`filteredTasks:${key}`)) return
    const orgId = requireOrgId()
    const snap = await getDocs(query(
      collection(db, 'tasks'),
      where('orgId', '==', orgId),
      where('status', 'in', statuses),
      orderBy('dueAt'),
      limit(FILTERED_PAGE_SIZE),
    ))
    filteredKey = key
    filteredTasks.value = snap.docs.map((d) => mapTask(d.id, d.data()))
    filteredCursor = snap.docs[snap.docs.length - 1] ?? null
    filteredMayHaveMore.value = snap.docs.length === FILTERED_PAGE_SIZE
    markLoaded(`filteredTasks:${key}`)
  }
  async function loadMoreFilteredTasks(statuses: TaskStatus[]): Promise<void> {
    const key = [...statuses].sort().join(',')
    if (key !== filteredKey || !filteredMayHaveMore.value || !filteredCursor) return
    const orgId = requireOrgId()
    const snap = await getDocs(query(
      collection(db, 'tasks'),
      where('orgId', '==', orgId),
      where('status', 'in', statuses),
      orderBy('dueAt'),
      startAfter(filteredCursor),
      limit(FILTERED_PAGE_SIZE),
    ))
    snap.forEach((d) => upsert(filteredTasks.value, mapTask(d.id, d.data())))
    filteredCursor = snap.docs[snap.docs.length - 1] ?? filteredCursor
    filteredMayHaveMore.value = snap.docs.length === FILTERED_PAGE_SIZE
  }

  // ── Aggregation counters (Analytics, Team) ────────────────────
  // count() bills one read per 1,000 index entries matched (minimum one), so
  // these stay exact and near-free at any workspace size — unlike computing
  // over the windowed `tasks` array, which silently under-counts past the
  // first page. No counter anywhere should scan documents.
  async function countTasks(...conditions: QueryConstraint[]): Promise<number> {
    const orgId = requireOrgId()
    const snap = await getCountFromServer(query(collection(db, 'tasks'), where('orgId', '==', orgId), ...conditions))
    return snap.data().count
  }
  // The statuses that count as workload — everything isDoneStatus is not.
  const ACTIVE_STATUSES = TASK_STATUSES.filter((s) => !isDoneStatus(s))

  async function fetchTaskStatusCounts(): Promise<Record<TaskStatus, number>> {
    const counts = await Promise.all(TASK_STATUSES.map((s) => countTasks(where('status', '==', s))))
    return Object.fromEntries(TASK_STATUSES.map((s, i) => [s, counts[i]])) as Record<TaskStatus, number>
  }
  async function fetchTaskCountsForClients(clientIds: string[]): Promise<Record<string, number>> {
    const counts = await Promise.all(clientIds.map((id) => countTasks(where('clientId', '==', id))))
    return Object.fromEntries(clientIds.map((id, i) => [id, counts[i]]))
  }
  // Open (non-terminal) tasks per assignee. Composite index:
  // (orgId, assigneeUid, status) in firestore.indexes.json.
  async function fetchActiveTaskCounts(uids: string[]): Promise<Record<string, number>> {
    const counts = await Promise.all(
      uids.map((uid) => countTasks(where('assigneeUid', '==', uid), where('status', 'in', ACTIVE_STATUSES))),
    )
    return Object.fromEntries(uids.map((uid, i) => [uid, counts[i]]))
  }
  async function fetchProjectCount(): Promise<number> {
    const orgId = requireOrgId()
    const snap = await getCountFromServer(query(collection(db, 'projects'), where('orgId', '==', orgId)))
    return snap.data().count
  }

  // What a client sees in their portal: their visible deliverables. Used by
  // the manager-facing contact profile to answer "what's sitting with them".
  // Returned to the caller (not upserted) so it never mixes with the board's
  // paged deliverable window. Index: (orgId, clientId, clientVisible).
  async function fetchClientPortalDeliverables(clientId: string): Promise<Deliverable[]> {
    const orgId = requireOrgId()
    const snap = await getDocs(query(
      collection(db, 'deliverables'),
      where('orgId', '==', orgId),
      where('clientId', '==', clientId),
      where('clientVisible', '==', true),
    ))
    return snap.docs.map((d) => mapDeliverable(d.id, d.data()))
  }

  // ── Packages sold against a project (PackageQuota, board) ─────
  // One-shot pull returned to the caller rather than held in the store — a
  // cold path per board visit, and the only sanctioned way to read packages
  // (components never touch the SDK directly).
  async function loadPackagesForProject(projectId: string): Promise<Package[]> {
    const orgId = requireOrgId()
    const snap = await getDocs(query(
      collection(db, 'packages'),
      where('orgId', '==', orgId),
      where('projectId', '==', projectId),
    ))
    return snap.docs.map((d) => mapPackage(d.id, d.data()))
  }

  // Everything a manager surface needs. Attaches the four org-wide listeners
  // and resolves once each has delivered its first snapshot; afterwards the
  // data keeps itself current and repeat calls are free.
  async function loadWorkspace(force = false): Promise<void> {
    await Promise.all([loadUsers(force), loadClients(force), loadAllProjects(force), loadAllTasks(force)])
  }

  // ── Creates (managers only; rules enforce) ────────────────────
  // Client/task creates commit as a writeBatch: the new doc + a +1 on the
  // matching usage counter, atomically — rules (via getAfter on the usage
  // doc) require the same-batch increment on client/task creates and deny
  // the create at the plan limit.
  async function createClient(name: string, meta: MetaField[] = []): Promise<Client> {
    const orgId = requireOrgId()
    const ref = doc(collection(db, 'clients'))
    await guarded(() => {
      const batch = writeBatch(db)
      batch.set(ref, { orgId, name, meta })
      batch.update(usageRef(orgId), { activeClients: increment(1) })
      return batch.commit()
    })
    // Activation signal (BUSINESS_MODEL §7.2) — org id only, never the name.
    track('client_created', { orgId })
    const c: Client = { id: ref.id, orgId, name, meta }
    upsert(clients.value, c)
    return c
  }
  async function createProject(clientId: string, name: string, defaultView: 'kanban' | 'list' | 'deliverables'): Promise<Project> {
    const orgId = requireOrgId()
    const brief = { brandGuidelinesUrl: '', sopUrl: '', links: [], fields: [] as MetaField[] }
    const meta: MetaField[] = []
    const ref = await guarded(() => addDoc(collection(db, 'projects'), { orgId, clientId, name, defaultView, brief, meta }))
    const p: Project = { id: ref.id, orgId, clientId, name, defaultView, brief, meta }
    upsert(projects.value, p)
    return p
  }

  // Quick-create from the calendar: a bare shoot booking, not yet linked to a
  // client/project or capture tasks. Returned to the caller (not held in the
  // store) — Calendar/Schedule keep their own month/week windows and re-query
  // after a create. Doc shape mirrors mapRecordingSession (lib/mappers.ts).
  async function createRecordingSession(input: {
    name: string; location: string; date: Date; notes: string
  }): Promise<RecordingSession> {
    const orgId = requireOrgId()
    const ref = await guarded(() => addDoc(collection(db, 'sessions'), {
      orgId,
      clientId: '',
      projectId: '',
      name: input.name,
      location: input.location,
      date: Timestamp.fromDate(input.date),
      startsAt: null,
      endsAt: null,
      taskIds: [],
      notes: input.notes,
      createdAt: serverTimestamp(),
    }))
    return {
      id: ref.id, orgId, clientId: '', projectId: '',
      name: input.name, location: input.location, date: input.date,
      startsAt: null, endsAt: null, taskIds: [], notes: input.notes, createdAt: new Date(),
    }
  }

  // ── Updates (managers only; rules enforce) ────────────────────
  async function updateClient(id: string, patch: Partial<Pick<Client, 'name' | 'meta'>>): Promise<void> {
    await guarded(() => updateDoc(doc(db, 'clients', id), patch))
    const local = getClient(id)
    if (local) Object.assign(local, patch)
  }
  async function updateProject(id: string, patch: Partial<Pick<Project, 'name' | 'defaultView' | 'brief' | 'meta'>>): Promise<void> {
    await guarded(() => updateDoc(doc(db, 'projects', id), patch))
    const local = getProject(id)
    if (local) Object.assign(local, patch)
  }
  // Edits a member of the ACTIVE org (orgs/{orgId}/members/{uid}) — managers
  // may change role/clientId/displayName; membership create/delete goes
  // through the HTTP API.
  async function updateMember(uid: string, patch: Partial<Pick<UserProfile, 'displayName' | 'role' | 'clientId' | 'title'>>): Promise<void> {
    const orgId = requireOrgId()
    await guarded(() => updateDoc(doc(db, 'orgs', orgId, 'members', uid), patch))
    const current = usersById.value[uid]
    if (current) usersById.value = { ...usersById.value, [uid]: { ...current, ...patch } }
  }

  // The ACTIVE org's workflow pipeline (managers only; rules gate the org doc
  // to name/pipeline/defaultCapacityPointsPerDay). No local patch: the auth
  // store live-subscribes to the org doc, so `auth.org` refreshes itself.
  // Stage edits only affect FUTURE deliverables — in-flight ones carry their
  // own stage snapshot taken at creation.
  //
  // Validated against the shared schema before it goes anywhere: the rules
  // gate WHICH keys a manager may change on an org, never the pipeline's
  // contents, so this is the only thing standing between a UI bug and a
  // malformed pipeline that would break every future batch create. Writing
  // `parsed.data` also normalizes it (durationHours defaults to 0).
  async function updateOrgPipeline(stages: WorkflowStage[]): Promise<void> {
    const orgId = requireOrgId()
    const parsed = WorkflowPipelineSchema.safeParse({ stages })
    if (!parsed.success) {
      useToastStore().error(i18n.global.t('common.saveError'))
      throw new Error('invalid pipeline')
    }
    await guarded(() => updateDoc(doc(db, 'orgs', orgId), { pipeline: parsed.data }))
  }

  // ── Invites of the ACTIVE org (managers only; rules enforce) ──
  // Pending AND declined: accepted/revoked are history, but a refusal is a
  // thing the manager needs to see — otherwise "they said no" is
  // indistinguishable from "they haven't opened it yet" and the invite just
  // looks stuck. Live listener: accepts/declines happen in OTHER sessions by
  // definition, so this is a surface that could never be current via pull.
  // A status change out of the pending/declined set emits `removed`.
  async function loadInvites(): Promise<void> {
    const orgId = requireOrgId()
    return listen('invites', query(
      collection(db, 'orgs', orgId, 'invites'),
      where('status', 'in', ['pending', 'declined']),
    ), (snap) => applyChanges(invites, snap, mapInvite))
  }
  async function createInvite(input: { email: string; role: Role; clientId?: string; title?: string }): Promise<Invite> {
    const orgId = requireOrgId()
    const email = input.email.toLowerCase() // rules require a lowercased email
    const invitedBy = useAuthStore().profile?.uid ?? ''
    // Inviter's current UI locale — the onInviteCreated function renders the
    // invite email in it ('en' fallback for anything unexpected).
    const locale: Invite['locale'] = i18n.global.locale.value === 'es' ? 'es' : 'en'
    // 14-day expiry, enforced server-side (preview/accept 404 past it).
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
    const ref = await guarded(() => addDoc(collection(db, 'orgs', orgId, 'invites'), {
      email,
      role: input.role,
      ...(input.clientId ? { clientId: input.clientId } : {}),
      ...(input.title ? { title: input.title } : {}),
      status: 'pending',
      createdAt: serverTimestamp(),
      invitedBy,
      locale,
      expiresAt: Timestamp.fromDate(expiresAt),
    }))
    const inv: Invite = {
      id: ref.id, email, role: input.role, clientId: input.clientId,
      status: 'pending', createdAt: new Date(), invitedBy, locale, expiresAt,
    }
    upsert(invites.value, inv)
    return inv
  }
  async function revokeInvite(id: string): Promise<void> {
    const orgId = requireOrgId()
    await guarded(() => updateDoc(doc(db, 'orgs', orgId, 'invites', id), { status: 'revoked' }))
    invites.value = invites.value.filter((i) => i.id !== id)
  }

  async function createSubGroup(projectId: string, name: string, meta: MetaField[] = []): Promise<SubGroup> {
    const orgId = requireOrgId()
    // `order` is the board's newest-first paging key, so it must exceed every
    // existing order. max+1 over the loaded window is safe: board paging loads
    // the NEWEST (highest-order) sub-groups first, so if any exist, the max is
    // in the store. The old `length` broke exactly there — a paged window
    // undercounts, which minted duplicate orders.
    const order = Math.max(-1, ...subGroupsForProject(projectId).map((s) => s.order)) + 1
    const ref = await guarded(() => addDoc(collection(db, 'subGroups'), { orgId, projectId, name, order, meta }))
    const s: SubGroup = { id: ref.id, orgId, projectId, name, order, meta }
    upsert(subGroups.value, s)
    return s
  }
  async function updateSubGroup(id: string, fields: { name?: string; meta?: MetaField[] }): Promise<void> {
    await guarded(() => updateDoc(doc(db, 'subGroups', id), fields))
    const existing = subGroups.value.find((s) => s.id === id)
    if (existing) {
      if (fields.name !== undefined) existing.name = fields.name
      if (fields.meta !== undefined) existing.meta = fields.meta
    }
  }
  async function createTask(input: {
    projectId: string; subGroupId: string; clientId: string; title: string
    description: string; assigneeUid: string; status: TaskStatus; dueAt: Date | null
    clientVisible: boolean
  }): Promise<Task> {
    const orgId = requireOrgId()
    const order = tasksForProject(input.projectId).length
    const meta: MetaField[] = []
    const ref = doc(collection(db, 'tasks'))
    await guarded(() => {
      const batch = writeBatch(db)
      batch.set(ref, {
        orgId, title: input.title, description: input.description, subGroupId: input.subGroupId, projectId: input.projectId,
        clientId: input.clientId, status: input.status, assigneeUid: input.assigneeUid,
        clientVisible: input.clientVisible, blockedReason: '', blockedAt: null, deliveryNote: '', meta,
        order, dueAt: input.dueAt, createdAt: serverTimestamp(), completedAt: null,
      })
      batch.update(usageRef(orgId), { activeTasks: increment(1) })
      return batch.commit()
    })
    // Activation signal (BUSINESS_MODEL §7.2) — org id only, no task content.
    track('task_created', { orgId })
    const t: Task = {
      id: ref.id, orgId, title: input.title, description: input.description, subGroupId: input.subGroupId, projectId: input.projectId,
      clientId: input.clientId, status: input.status, assigneeUid: input.assigneeUid,
      clientVisible: input.clientVisible, blockedReason: '', blockedAt: null, deliveryNote: '', meta,
      order, dueAt: input.dueAt, createdAt: new Date(), completedAt: null,
      deliverableId: '', stageId: '',
    }
    upsert(tasks.value, t)
    return t
  }
  // dueAt is included so a manager can override a stage deadline the batch
  // endpoint derived from the workflow's stage durations — derived dates are a
  // starting point, not a cage. (The rules already allow managers to write any
  // task field; contractors and clients are limited to the status set.)
  async function updateTask(id: string, patch: Partial<Pick<Task, 'title' | 'description' | 'meta' | 'assigneeUid' | 'clientVisible' | 'blockedReason' | 'deliveryNote' | 'dueAt'>>): Promise<void> {
    await guarded(() => updateDoc(doc(db, 'tasks', id), patch))
    const local = getTask(id)
    if (local) Object.assign(local, patch)
  }
  // Bulk share/hide: flip clientVisible on every task of a project in one go
  // (managers; the migration path for "existing clients see an empty portal").
  async function setProjectTasksVisibility(projectId: string, visible: boolean): Promise<void> {
    await guarded(async () => {
      const orgId = requireOrgId()
      const snap = await getDocs(query(
        collection(db, 'tasks'),
        where('orgId', '==', orgId),
        where('projectId', '==', projectId),
      ))
      for (let i = 0; i < snap.docs.length; i += BATCH_LIMIT) {
        const batch = writeBatch(db)
        for (const d of snap.docs.slice(i, i + BATCH_LIMIT)) batch.update(d.ref, { clientVisible: visible })
        await batch.commit()
      }
    })
    for (const t of tasks.value) if (t.projectId === projectId) t.clientVisible = visible
  }

  // ── Mutations ─────────────────────────────────────────────────
  // `detail` documents the transition: blockedReason when parking a task
  // (cleared again when it moves on), deliveryNote when handing off final
  // files (kept as the delivery record). The extra keys are only written
  // when needed so a client's approve stays within its rules allowance
  // (status + completedAt only).
  async function updateTaskStatus(
    taskId: string,
    status: TaskStatus,
    detail?: { blockedReason?: string; deliveryNote?: string },
  ): Promise<void> {
    const done = isDoneStatus(status)
    const local = getTask(taskId)
    const patch: Record<string, unknown> = { status, completedAt: done ? serverTimestamp() : null }
    if (status === 'blocked') {
      patch.blockedReason = (detail?.blockedReason ?? '').trim()
      patch.blockedAt = serverTimestamp()
    } else if (local?.blockedReason || local?.blockedAt) {
      patch.blockedReason = '' // moved on — reason is stale
      patch.blockedAt = null
    }
    // The handoff note rides on ANY terminal status, not just 'delivered'.
    // `delivered` is no longer something anyone picks by hand, so the path that
    // actually prompts for a note is completing a stage task — which lands on
    // 'done'. Gating the write on 'delivered' meant the prompt collected a note
    // and then silently dropped it.
    //
    // Empty is not written: leaving the optional prompt blank must not wipe a
    // note the task already carries (clearing one is the edit-task modal's job).
    const note = detail?.deliveryNote?.trim()
    if (done && note) {
      patch.deliveryNote = note
    }
    // Optimistic local update for the tactile check-off feel; revert on failure.
    const prev = local
      ? {
          status: local.status, completedAt: local.completedAt,
          blockedReason: local.blockedReason, blockedAt: local.blockedAt, deliveryNote: local.deliveryNote,
        }
      : null
    if (local) {
      Object.assign(local, patch)
      // serverTimestamp() sentinels aren't Dates — mirror them locally.
      local.completedAt = done ? new Date() : null
      if ('blockedAt' in patch) local.blockedAt = status === 'blocked' ? new Date() : null
    }
    try {
      await updateDoc(doc(db, 'tasks', taskId), patch)
    } catch (e) {
      if (local && prev) Object.assign(local, prev)
      useToastStore().error(i18n.global.t('common.saveError'))
      throw e
    }
  }

  // ── Deletes (managers; cascade children) ──────────────────────
  // Firestore has no cascade: deleting a doc leaves its subcollections behind.
  // Per the docs, from the client you must delete subcollection docs manually.
  // Each cascade collects every doc ref (children first), then commits them
  // atomically via writeBatch (chunked above 400 ops).

  // All refs needed to fully remove a task: its versions + notes + the task.
  async function taskDeleteRefs(taskId: string): Promise<DocumentReference[]> {
    const [vs, ns] = await Promise.all([
      getDocs(collection(db, 'tasks', taskId, 'versions')),
      getDocs(collection(db, 'tasks', taskId, 'notes')),
    ])
    return [...vs.docs.map((d) => d.ref), ...ns.docs.map((d) => d.ref), doc(db, 'tasks', taskId)]
  }
  async function deleteTaskDeep(taskId: string): Promise<void> {
    const orgId = requireOrgId()
    await commitDeletes(await taskDeleteRefs(taskId), {
      ref: usageRef(orgId),
      patch: { activeTasks: increment(-1) },
    })
  }

  // Each delete also drops the matching ledger rows — the ledger is a
  // separate TTL-memoized list, and the memo must not vouch for docs this
  // client just removed.
  async function deleteTask(id: string): Promise<void> {
    await guarded(() => deleteTaskDeep(id))
    tasks.value = tasks.value.filter((t) => t.id !== id)
    ledgerTasks.value = ledgerTasks.value.filter((t) => t.id !== id)
  }
  async function deleteSubGroup(id: string): Promise<void> {
    await guarded(async () => {
      const orgId = requireOrgId()
      const snap = await getDocs(query(collection(db, 'tasks'), where('orgId', '==', orgId), where('subGroupId', '==', id)))
      const taskRefs = (await Promise.all(snap.docs.map((d) => taskDeleteRefs(d.id)))).flat()
      // Decrement by the number of TASK docs actually deleted (not their
      // versions/notes — only task docs are counted).
      const taskCount = snap.docs.length
      await commitDeletes(
        [...taskRefs, doc(db, 'subGroups', id)],
        taskCount ? { ref: usageRef(orgId), patch: { activeTasks: increment(-taskCount) } } : undefined,
      )
    })
    tasks.value = tasks.value.filter((t) => t.subGroupId !== id)
    ledgerTasks.value = ledgerTasks.value.filter((t) => t.subGroupId !== id)
    subGroups.value = subGroups.value.filter((s) => s.id !== id)
  }
  async function deleteProject(id: string): Promise<void> {
    await guarded(async () => {
      const orgId = requireOrgId()
      const [sgs, tks] = await Promise.all([
        getDocs(query(collection(db, 'subGroups'), where('orgId', '==', orgId), where('projectId', '==', id))),
        getDocs(query(collection(db, 'tasks'), where('orgId', '==', orgId), where('projectId', '==', id))),
      ])
      const taskRefs = (await Promise.all(tks.docs.map((d) => taskDeleteRefs(d.id)))).flat()
      const taskCount = tks.docs.length
      await commitDeletes(
        [...taskRefs, ...sgs.docs.map((d) => d.ref), doc(db, 'projects', id)],
        taskCount ? { ref: usageRef(orgId), patch: { activeTasks: increment(-taskCount) } } : undefined,
      )
    })
    subGroups.value = subGroups.value.filter((s) => s.projectId !== id)
    tasks.value = tasks.value.filter((t) => t.projectId !== id)
    ledgerTasks.value = ledgerTasks.value.filter((t) => t.projectId !== id)
    projects.value = projects.value.filter((p) => p.id !== id)
  }
  async function deleteClient(id: string): Promise<void> {
    await guarded(async () => {
      const orgId = requireOrgId()
      const projs = await getDocs(query(collection(db, 'projects'), where('orgId', '==', orgId), where('clientId', '==', id)))
      const projIds = projs.docs.map((d) => d.id)
      const [subSnaps, taskSnaps] = await Promise.all([
        Promise.all(projIds.map((pid) => getDocs(query(collection(db, 'subGroups'), where('orgId', '==', orgId), where('projectId', '==', pid))))),
        Promise.all(projIds.map((pid) => getDocs(query(collection(db, 'tasks'), where('orgId', '==', orgId), where('projectId', '==', pid))))),
      ])
      const taskDocs = taskSnaps.flatMap((s) => s.docs)
      const taskRefs = (await Promise.all(taskDocs.map((d) => taskDeleteRefs(d.id)))).flat()
      // One client + N task docs leave the org in this cascade.
      const taskCount = taskDocs.length
      await commitDeletes(
        [
          ...taskRefs,
          ...subSnaps.flatMap((s) => s.docs).map((d) => d.ref),
          ...projs.docs.map((d) => d.ref),
          doc(db, 'clients', id),
        ],
        {
          ref: usageRef(orgId),
          patch: {
            activeClients: increment(-1),
            ...(taskCount ? { activeTasks: increment(-taskCount) } : {}),
          },
        },
      )
    })
    const localProjIds = projects.value.filter((p) => p.clientId === id).map((p) => p.id)
    projects.value = projects.value.filter((p) => p.clientId !== id)
    subGroups.value = subGroups.value.filter((s) => !localProjIds.includes(s.projectId))
    tasks.value = tasks.value.filter((t) => t.clientId !== id)
    ledgerTasks.value = ledgerTasks.value.filter((t) => t.clientId !== id)
    clients.value = clients.value.filter((c) => c.id !== id)
  }

  // ── Versions + threaded notes (Iteration Room) ────────────────
  async function loadVersions(taskId: string): Promise<Version[]> {
    const snap = await getDocs(collection(db, 'tasks', taskId, 'versions'))
    return snap.docs
      .map((d) => mapVersion(d.id, d.data()))
      .sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0))
  }
  async function loadNotes(taskId: string): Promise<Note[]> {
    const snap = await getDocs(query(collection(db, 'tasks', taskId, 'notes'), orderBy('createdAt', 'asc')))
    return snap.docs.map((d) => mapNote(d.id, d.data()))
  }
  async function addNote(taskId: string, versionId: string, authorUid: string, body: string): Promise<void> {
    await guarded(() => addDoc(collection(db, 'tasks', taskId, 'notes'), {
      versionId, authorUid, body, resolved: false, createdAt: serverTimestamp(),
    }))
  }
  // ── Deliverable thread (versions + notes shared across stages) ──
  // THE defining property of the deliverable (README: finding 1): versions and
  // feedback live on the deliverable so they survive stage handoffs. Any task
  // that belongs to a deliverable reads/writes THIS thread — a per-task silo
  // would recreate exactly the recorder→editor lost-notes problem the entity
  // exists to solve. The task-level thread above remains for standalone tasks.
  async function loadDeliverableVersions(deliverableId: string): Promise<Version[]> {
    const snap = await getDocs(collection(db, 'deliverables', deliverableId, 'versions'))
    return snap.docs
      .map((d) => mapVersion(d.id, d.data()))
      .sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0))
  }
  async function loadDeliverableNotes(deliverableId: string): Promise<Note[]> {
    const snap = await getDocs(query(collection(db, 'deliverables', deliverableId, 'notes'), orderBy('createdAt', 'asc')))
    return snap.docs.map((d) => mapNote(d.id, d.data()))
  }
  async function addDeliverableVersion(deliverableId: string, note: string, mediaUrl = ''): Promise<Version> {
    const existing = await loadDeliverableVersions(deliverableId)
    const label = `v${existing.length + 1}`
    const ref = await guarded(() => addDoc(collection(db, 'deliverables', deliverableId, 'versions'), {
      label, note, createdAt: serverTimestamp(), mediaUrl,
    }))
    return { id: ref.id, label, note, createdAt: new Date(), mediaUrl }
  }
  // Deliverable-level note. Same shape and rules contract as task notes;
  // clients may write here — it's the portal's "leave feedback" channel.
  async function addDeliverableNote(deliverableId: string, versionId: string, authorUid: string, body: string): Promise<void> {
    await guarded(() => addDoc(collection(db, 'deliverables', deliverableId, 'notes'), {
      versionId, authorUid, body, resolved: false, createdAt: serverTimestamp(),
    }))
  }
  async function setDeliverableNoteResolved(deliverableId: string, noteId: string, resolved: boolean): Promise<void> {
    await guarded(() => updateDoc(doc(db, 'deliverables', deliverableId, 'notes', noteId), { resolved }))
  }
  async function setNoteResolved(taskId: string, noteId: string, resolved: boolean): Promise<void> {
    await guarded(() => updateDoc(doc(db, 'tasks', taskId, 'notes', noteId), { resolved }))
  }
  // Add the next media version (v1, v2, …) to a task.
  async function addVersion(taskId: string, note: string, mediaUrl = ''): Promise<Version> {
    const existing = await loadVersions(taskId)
    const label = `v${existing.length + 1}`
    const ref = await guarded(() => addDoc(collection(db, 'tasks', taskId, 'versions'), {
      label, note, createdAt: serverTimestamp(), mediaUrl,
    }))
    return { id: ref.id, label, note, createdAt: new Date(), mediaUrl }
  }

  return {
    usersById, clients, projects, subGroups, tasks, deliverables, invites,
    tasksMayHaveMore, projectsMayHaveMore,
    ledgerTasks, ledgerMayHaveMore, loadLedger, loadMoreLedger,
    filteredTasks, filteredMayHaveMore, loadFilteredTasks, loadMoreFilteredTasks,
    fetchTaskStatusCounts, fetchTaskCountsForClients, fetchActiveTaskCounts, fetchProjectCount,
    loadPackagesForProject, fetchClientPortalDeliverables,
    reset, loadWorkspace,
    loadUsers, userName, teamMembers,
    loadClients, loadClient, getClient,
    loadProjectsForClient, loadAllProjects, loadMoreProjects, loadProject, getProject,
    loadProjectBoard, loadMoreSubGroups, projectHasMoreSubGroups, loadAllSubGroupsForProject,
    deliverablesForSubGroup, updateDeliverable,
    getDeliverable, loadDeliverable,
    subGroupsForProject, getSubGroup, loadSubGroup, loadSubGroupWithChildren,
    tasksForProject, getTask, loadTask,
    loadAssignedTasks, tasksForAssignee,
    loadAllTasks, loadMoreTasks, loadTasksForClient, loadAllTasksForClient,
    loadInvites, createInvite, revokeInvite,
    createClient, createProject, createSubGroup, createTask, createRecordingSession,
    updateClient, updateProject, updateMember, updateOrgPipeline, updateSubGroup, updateTask,
    updateTaskStatus, setProjectTasksVisibility,
    deleteTask, deleteSubGroup, deleteProject, deleteClient,
    loadVersions, loadNotes, addNote, setNoteResolved, addVersion,
    loadDeliverableVersions, loadDeliverableNotes, addDeliverableVersion, addDeliverableNote, setDeliverableNoteResolved,
  }
})
