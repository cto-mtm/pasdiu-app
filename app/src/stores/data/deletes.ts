// ── Deletes (managers) ─────────────────────────────────────────
// Two shapes live here, together because both reach across collections:
//
//  - Standalone task delete stays CLIENT-SIDE: a task with no deliverable is
//    just a doc + its versions/notes, which a manager may delete directly, and
//    it decrements activeTasks in the same batch (the rule pairs the two).
//
//  - Sub-group / project / client cascades go SERVER-SIDE. Deliverables are
//    `create, delete: if false` in the rules (functions-only) and the usage
//    rule won't let a client touch activeDeliverables, so a client cascade
//    could never remove a subtree's deliverables or fix that counter — it would
//    orphan them. The Admin-SDK endpoints in functions/routes/resources.ts do
//    the whole subtree atomically; here we just call them and prune local
//    state so the UI updates without a refetch.
import { collection, doc, getDocs, increment, type DocumentReference } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { apiFetch } from '../../lib/api'
import { i18n } from '../../i18n'
import { useToastStore } from '../toast'
import { commitDeletes, guarded } from './shared'
import type { DataContext } from './context'

export function createDeletesSlice(ctx: DataContext) {
  const { clients, projects, subGroups, tasks, deliverables, ledgerTasks, requireOrgId, usageRef } = ctx

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
  //
  // A deliverable's stage tasks are never individually deletable: the
  // deliverable's stageSummary/derived-stage model references them by id, so
  // dropping one wedges the pipeline. Removing them is the deliverable-delete
  // endpoint's job (cascade, Admin SDK). The UI hides the control for these;
  // this guard is the backstop. Standalone tasks (deliverableId === '') pass.
  async function deleteTask(id: string): Promise<void> {
    const task = tasks.value.find((t) => t.id === id)
    if (task?.deliverableId) {
      throw new Error('Cannot delete a stage task; delete its deliverable instead')
    }
    await guarded(() => deleteTaskDeep(id))
    tasks.value = tasks.value.filter((t) => t.id !== id)
    ledgerTasks.value = ledgerTasks.value.filter((t) => t.id !== id)
  }

  // Fire a cascade endpoint. On failure it toasts and THROWS — the calling
  // page (ProjectBoardPage, ClientDetailPage) awaits this before closing its
  // dialog / navigating away, so a throw keeps the dialog open and the user on
  // the page, matching the old client-side cascades' behaviour.
  async function cascade(path: string): Promise<void> {
    const res = await apiFetch<{ taskCount: number; deliverableCount: number }>(path, { method: 'DELETE' })
    if (!res.ok) {
      useToastStore().error(i18n.global.t('common.saveError'))
      throw new Error('cascade_failed')
    }
  }

  async function deleteSubGroup(id: string): Promise<void> {
    const orgId = requireOrgId()
    await cascade(`/orgs/${orgId}/subgroups/${id}`)
    // The endpoint removed the sub-group, its deliverables, and every task
    // under it (stage + standalone) — prune the same rows locally.
    tasks.value = tasks.value.filter((t) => t.subGroupId !== id)
    ledgerTasks.value = ledgerTasks.value.filter((t) => t.subGroupId !== id)
    deliverables.value = deliverables.value.filter((d) => d.subGroupId !== id)
    subGroups.value = subGroups.value.filter((s) => s.id !== id)
  }

  async function deleteProject(id: string): Promise<void> {
    const orgId = requireOrgId()
    await cascade(`/orgs/${orgId}/projects/${id}`)
    subGroups.value = subGroups.value.filter((s) => s.projectId !== id)
    tasks.value = tasks.value.filter((t) => t.projectId !== id)
    ledgerTasks.value = ledgerTasks.value.filter((t) => t.projectId !== id)
    deliverables.value = deliverables.value.filter((d) => d.projectId !== id)
    projects.value = projects.value.filter((p) => p.id !== id)
  }

  async function deleteClient(id: string): Promise<void> {
    const orgId = requireOrgId()
    await cascade(`/orgs/${orgId}/clients/${id}`)
    const localProjIds = projects.value.filter((p) => p.clientId === id).map((p) => p.id)
    projects.value = projects.value.filter((p) => p.clientId !== id)
    subGroups.value = subGroups.value.filter((s) => !localProjIds.includes(s.projectId))
    tasks.value = tasks.value.filter((t) => t.clientId !== id)
    ledgerTasks.value = ledgerTasks.value.filter((t) => t.clientId !== id)
    deliverables.value = deliverables.value.filter((d) => d.clientId !== id)
    clients.value = clients.value.filter((c) => c.id !== id)
  }

  // A single wrongly-created deliverable (no parent going away with it). Same
  // Admin-SDK path as the cascades — deliverables are functions-only for
  // delete — but it returns false instead of throwing, because its caller
  // (DeliverableDetailPage) keeps its dialog open and toasts on failure.
  async function deleteDeliverable(id: string): Promise<boolean> {
    const orgId = requireOrgId()
    const res = await apiFetch<{ taskCount: number }>(`/orgs/${orgId}/deliverables/${id}`, { method: 'DELETE' })
    if (!res.ok) return false
    deliverables.value = deliverables.value.filter((d) => d.id !== id)
    tasks.value = tasks.value.filter((t) => t.deliverableId !== id)
    ledgerTasks.value = ledgerTasks.value.filter((t) => t.deliverableId !== id)
    return true
  }

  return { deleteTask, deleteSubGroup, deleteProject, deleteClient, deleteDeliverable }
}
