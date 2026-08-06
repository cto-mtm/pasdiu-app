// ── Deletes (managers; cascade children) ──────────────────────
// Firestore has no cascade: deleting a doc leaves its subcollections behind.
// Per the docs, from the client you must delete subcollection docs manually.
// Each cascade collects every doc ref (children first), then commits them
// atomically via writeBatch (chunked above 400 ops — see commitDeletes).
//
// These live together rather than with each entity's slice because every one
// of them reaches across collections: deleting a client walks its projects,
// their sub-groups, their tasks, and each task's versions/notes.
import { collection, doc, getDocs, increment, query, where, type DocumentReference } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { commitDeletes, guarded } from './shared'
import type { DataContext } from './context'

export function createDeletesSlice(ctx: DataContext) {
  const { clients, projects, subGroups, tasks, ledgerTasks, requireOrgId, usageRef } = ctx

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

  return { deleteTask, deleteSubGroup, deleteProject, deleteClient }
}
