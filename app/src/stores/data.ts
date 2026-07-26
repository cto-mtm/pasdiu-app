import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  increment,
  limit,
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
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { i18n } from '../i18n'
import { useAuthStore } from './auth'
import { useToastStore } from './toast'
import { track } from '../lib/analytics'
import { mapClient, mapDeliverable, mapInvite, mapMember, mapNote, mapProject, mapSubGroup, mapTask, mapVersion } from '../lib/mappers'
import { isDoneStatus } from '../lib/status'
import type {
  Client, Deliverable, Invite, Project, Role, SubGroup, Task, TaskStatus, Version, Note, UserProfile, MetaField,
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

  // Memo guards for the full-collection loads (cleared by reset()).
  let usersLoaded = false
  let clientsLoaded = false
  let projectsLoaded = false
  let tasksLoaded = false

  // Pagination cursors for the full-collection loads (cleared by reset()).
  let tasksCursor: QueryDocumentSnapshot | null = null
  let projectsCursor: QueryDocumentSnapshot | null = null
  const tasksMayHaveMore = ref(false)
  const projectsMayHaveMore = ref(false)

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
  // nothing bleeds across accounts or workspaces.
  function reset(): void {
    usersById.value = {}
    clients.value = []
    projects.value = []
    subGroups.value = []
    tasks.value = []
    deliverables.value = []
    invites.value = []
    usersLoaded = false
    clientsLoaded = false
    projectsLoaded = false
    tasksLoaded = false
    tasksCursor = null
    projectsCursor = null
    tasksMayHaveMore.value = false
    projectsMayHaveMore.value = false
  }

  function upsert<T extends { id: string }>(arr: T[], item: T) {
    const i = arr.findIndex((x) => x.id === item.id)
    if (i === -1) arr.push(item)
    else arr[i] = item
  }

  // ── Members of the active org (assignee/author name lookups) ──
  // Kept as `loadUsers`/`usersById` so existing pages keep working; the data
  // now comes from orgs/{orgId}/members instead of the global users collection.
  // `force` bypasses (and refreshes) the memo — the roster changes outside
  // this client (invite accepts), so roster surfaces pass true on mount.
  async function loadUsers(force = false): Promise<void> {
    if (usersLoaded && !force) return
    const orgId = requireOrgId()
    const snap = await getDocs(collection(db, 'orgs', orgId, 'members'))
    const map: Record<string, UserProfile> = {}
    snap.forEach((d) => { map[d.id] = mapMember(d.id, d.data()) })
    usersById.value = map
    usersLoaded = true
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
  async function loadClients(): Promise<void> {
    if (clientsLoaded) return
    const orgId = requireOrgId()
    const snap = await getDocs(query(collection(db, 'clients'), where('orgId', '==', orgId)))
    clients.value = snap.docs.map((d) => mapClient(d.id, d.data()))
    clientsLoaded = true
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
  async function loadProjectsForClient(clientId: string): Promise<void> {
    const orgId = requireOrgId()
    const q = query(
      collection(db, 'projects'),
      where('orgId', '==', orgId),
      where('clientId', '==', clientId),
    )
    const snap = await getDocs(q)
    snap.forEach((d) => upsert(projects.value, mapProject(d.id, d.data())))
  }
  // First page REPLACES state so remotely deleted docs don't ghost;
  // loadMoreProjects appends from the cursor.
  async function loadAllProjects(): Promise<void> {
    if (projectsLoaded) return
    const orgId = requireOrgId()
    const snap = await getDocs(query(
      collection(db, 'projects'),
      where('orgId', '==', orgId),
      orderBy(documentId()),
      limit(PAGE_SIZE),
    ))
    projects.value = snap.docs.map((d) => mapProject(d.id, d.data()))
    projectsCursor = snap.docs[snap.docs.length - 1] ?? null
    projectsMayHaveMore.value = snap.docs.length === PAGE_SIZE
    projectsLoaded = true
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
  async function loadProjectBoard(projectId: string): Promise<void> {
    const orgId = requireOrgId()
    const [sgSnap, tSnap] = await Promise.all([
      getDocs(query(collection(db, 'subGroups'), where('orgId', '==', orgId), where('projectId', '==', projectId))),
      getDocs(query(collection(db, 'tasks'), where('orgId', '==', orgId), where('projectId', '==', projectId))),
    ])
    sgSnap.forEach((d) => upsert(subGroups.value, mapSubGroup(d.id, d.data())))
    tSnap.forEach((d) => upsert(tasks.value, mapTask(d.id, d.data())))
  }

  // ── Deliverables for a project (board rows — reads stageSummary, no task docs)
  async function loadProjectDeliverables(projectId: string): Promise<void> {
    const orgId = requireOrgId()
    const snap = await getDocs(query(
      collection(db, 'deliverables'),
      where('orgId', '==', orgId),
      where('projectId', '==', projectId),
    ))
    // Replace deliverables for this project (don't mix with another project's).
    deliverables.value = deliverables.value.filter((d) => d.projectId !== projectId)
    snap.forEach((d) => upsert(deliverables.value, mapDeliverable(d.id, d.data())))
  }

  function deliverablesForSubGroup(subGroupId: string): Deliverable[] {
    return deliverables.value.filter((d) => d.subGroupId === subGroupId).sort((a, b) => a.order - b.order)
  }

  function subGroupsForProject(projectId: string): SubGroup[] {
    return subGroups.value.filter((s) => s.projectId === projectId).sort((a, b) => a.order - b.order)
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

  // ── Assigned tasks (Contractor Slate) ─────────────────────────
  async function loadAssignedTasks(uid: string): Promise<void> {
    const orgId = requireOrgId()
    const q = query(collection(db, 'tasks'), where('orgId', '==', orgId), where('assigneeUid', '==', uid))
    const snap = await getDocs(q)
    snap.forEach((d) => upsert(tasks.value, mapTask(d.id, d.data())))
  }
  function tasksForAssignee(uid: string): Task[] {
    return tasks.value.filter((t) => t.assigneeUid === uid)
  }

  // ── All tasks (Ledger + omni-search; managers/contractors) ────
  // First page REPLACES state so remotely deleted docs don't ghost;
  // loadMoreTasks appends from the cursor.
  async function loadAllTasks(): Promise<void> {
    if (tasksLoaded) return
    const orgId = requireOrgId()
    const snap = await getDocs(query(
      collection(db, 'tasks'),
      where('orgId', '==', orgId),
      orderBy(documentId()),
      limit(PAGE_SIZE),
    ))
    tasks.value = snap.docs.map((d) => mapTask(d.id, d.data()))
    tasksCursor = snap.docs[snap.docs.length - 1] ?? null
    tasksMayHaveMore.value = snap.docs.length === PAGE_SIZE
    tasksLoaded = true
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

  // Everything a manager surface needs, in one parallel round-trip.
  async function loadWorkspace(): Promise<void> {
    await Promise.all([loadUsers(), loadClients(), loadAllProjects(), loadAllTasks()])
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
  async function createProject(clientId: string, name: string, defaultView: 'kanban' | 'list'): Promise<Project> {
    const orgId = requireOrgId()
    const brief = { brandGuidelinesUrl: '', sopUrl: '', links: [], fields: [] as MetaField[] }
    const meta: MetaField[] = []
    const ref = await guarded(() => addDoc(collection(db, 'projects'), { orgId, clientId, name, defaultView, brief, meta }))
    const p: Project = { id: ref.id, orgId, clientId, name, defaultView, brief, meta }
    upsert(projects.value, p)
    return p
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
  async function updateProjectBrief(id: string, brief: Project['brief']): Promise<void> {
    await updateProject(id, { brief })
  }
  // Edits a member of the ACTIVE org (orgs/{orgId}/members/{uid}) — managers
  // may change role/clientId/displayName; membership create/delete goes
  // through the HTTP API.
  async function updateMember(uid: string, patch: Partial<Pick<UserProfile, 'displayName' | 'role' | 'clientId'>>): Promise<void> {
    const orgId = requireOrgId()
    await guarded(() => updateDoc(doc(db, 'orgs', orgId, 'members', uid), patch))
    const current = usersById.value[uid]
    if (current) usersById.value = { ...usersById.value, [uid]: { ...current, ...patch } }
  }

  // ── Invites of the ACTIVE org (managers only; rules enforce) ──
  // Pending only — accepted/revoked invites are history, not UI state.
  async function loadInvites(): Promise<void> {
    const orgId = requireOrgId()
    const snap = await getDocs(query(
      collection(db, 'orgs', orgId, 'invites'),
      where('status', '==', 'pending'),
    ))
    invites.value = snap.docs.map((d) => mapInvite(d.id, d.data()))
  }
  async function createInvite(input: { email: string; role: Role; clientId?: string }): Promise<Invite> {
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
    const order = subGroupsForProject(projectId).length
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
    }
    upsert(tasks.value, t)
    return t
  }
  async function updateTask(id: string, patch: Partial<Pick<Task, 'title' | 'description' | 'meta' | 'assigneeUid' | 'clientVisible' | 'blockedReason' | 'deliveryNote'>>): Promise<void> {
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
    if (status === 'delivered' && detail?.deliveryNote !== undefined) {
      patch.deliveryNote = detail.deliveryNote.trim()
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

  async function deleteTask(id: string): Promise<void> {
    await guarded(() => deleteTaskDeep(id))
    tasks.value = tasks.value.filter((t) => t.id !== id)
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
    reset, loadWorkspace,
    loadUsers, userName, teamMembers,
    loadClients, loadClient, getClient,
    loadProjectsForClient, loadAllProjects, loadMoreProjects, loadProject, getProject,
    loadProjectBoard, loadProjectDeliverables, deliverablesForSubGroup,
    subGroupsForProject, tasksForProject, getTask, loadTask,
    loadAssignedTasks, tasksForAssignee,
    loadAllTasks, loadMoreTasks, loadTasksForClient,
    loadInvites, createInvite, revokeInvite,
    createClient, createProject, createSubGroup, createTask,
    updateClient, updateProject, updateProjectBrief, updateMember, updateSubGroup, updateTask,
    updateTaskStatus, setProjectTasksVisibility,
    deleteTask, deleteSubGroup, deleteProject, deleteClient,
    loadVersions, loadNotes, addNote, setNoteResolved, addVersion,
  }
})
