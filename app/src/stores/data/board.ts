// ── Board: sub-groups + tasks for a project ───────────────────
// Agencies that name a sub-group per month accumulate them forever, and the
// board used to read EVERY sub-group and EVERY task of a project on each
// visit. It now pages: the newest few sub-groups load on mount and the rest
// are pulled on demand.
//
// Paging key is `order`, not a timestamp — sub-groups have no createdAt, but
// `order` is assigned as the sub-group count at creation (see createSubGroup),
// so descending `order` IS newest-first, with no schema change or backfill.
import { ref } from 'vue'
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  updateDoc,
  where,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { mapDeliverable, mapSubGroup, mapTask } from '../../lib/mappers'
import { IN_LIMIT, chunk, guarded, upsert } from './shared'
import type { DataContext } from './context'
import type { MetaField, SubGroup } from '../../lib/types'

const RECENT_SUB_GROUP_PAGE = 2

export function createBoardSlice(ctx: DataContext) {
  const { subGroups, tasks, deliverables, isFresh, markLoaded, requireOrgId, onReset } = ctx

  // Per-project paging state for "load earlier".
  const subGroupCursors = new Map<string, QueryDocumentSnapshot | null>()
  const subGroupsMayHaveMore = ref<Record<string, boolean>>({})
  onReset(() => {
    subGroupCursors.clear()
    subGroupsMayHaveMore.value = {}
  })

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

  return {
    loadProjectBoard, loadMoreSubGroups, projectHasMoreSubGroups, loadAllSubGroupsForProject,
    subGroupsForProject, getSubGroup, loadSubGroup, loadSubGroupWithChildren,
    createSubGroup, updateSubGroup,
  }
}
