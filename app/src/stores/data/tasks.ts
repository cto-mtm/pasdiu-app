// ── Tasks ─────────────────────────────────────────────────────
import {
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  serverTimestamp,
  startAfter,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { track } from '../../lib/analytics'
import { mapTask } from '../../lib/mappers'
import { isDoneStatus } from '../../lib/status'
import { BATCH_LIMIT, PAGE_SIZE, createPaginator, guarded, guardedOptimistic, upsert } from './shared'
import type { DataContext } from './context'
import type { MetaField, Task, TaskStatus } from '../../lib/types'

export function createTasksSlice(ctx: DataContext) {
  const { tasks, isFresh, markLoaded, listen, applyChanges, requireOrgId, usageRef, onReset } = ctx

  const paginator = createPaginator(onReset)

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
    if (t.orgId !== requireOrgId()) return undefined
    upsert(tasks.value, t)
    return t
  }

  // ── Assigned tasks (Contractor Slate, Team member page) ───────
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
  async function loadAllTasks(): Promise<void> {
    const orgId = requireOrgId()
    return listen('tasks', query(
      collection(db, 'tasks'),
      where('orgId', '==', orgId),
      orderBy(documentId()),
      limit(PAGE_SIZE),
    ), (snap) => {
      applyChanges(tasks, snap, mapTask)
      paginator.setCursor(snap.docs[snap.docs.length - 1] ?? null)
      paginator.mayHaveMore.value = snap.docs.length === PAGE_SIZE
    })
  }

  async function loadMoreTasks(): Promise<void> {
    if (!paginator.canLoadMore()) return
    const orgId = requireOrgId()
    const snap = await getDocs(query(
      collection(db, 'tasks'),
      where('orgId', '==', orgId),
      orderBy(documentId()),
      startAfter(paginator.getCursor()),
      limit(PAGE_SIZE),
    ))
    snap.forEach((d) => upsert(tasks.value, mapTask(d.id, d.data())))
    paginator.applyCursor(snap.docs)
  }

  // Client-scoped tasks (rule-compatible for the client role).
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

  // Manager-scoped: load ALL tasks for a specific client (no clientVisible filter).
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

  async function updateTask(id: string, patch: Partial<Pick<Task, 'title' | 'description' | 'meta' | 'assigneeUid' | 'clientVisible' | 'blockedReason' | 'deliveryNote' | 'dueAt'>>): Promise<void> {
    await guarded(() => updateDoc(doc(db, 'tasks', id), patch))
    const local = getTask(id)
    if (local) Object.assign(local, patch)
  }

  // Bulk share/hide: flip clientVisible on every task of a project in one go.
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

  // ── Status mutation ───────────────────────────────────────────
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
      patch.blockedReason = ''
      patch.blockedAt = null
    }
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
      local.completedAt = done ? new Date() : null
      if ('blockedAt' in patch) local.blockedAt = status === 'blocked' ? new Date() : null
    }
    await guardedOptimistic(
      () => updateDoc(doc(db, 'tasks', taskId), patch),
      () => { if (local && prev) Object.assign(local, prev) },
    )
  }

  return {
    tasksMayHaveMore: paginator.mayHaveMore,
    tasksForProject, getTask, loadTask,
    loadAssignedTasks, tasksForAssignee,
    loadAllTasks, loadMoreTasks, loadTasksForClient, loadAllTasksForClient,
    createTask, updateTask, updateTaskStatus, setProjectTasksVisibility,
  }
}
