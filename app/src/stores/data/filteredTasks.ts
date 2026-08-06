// ── Status-filtered tasks (Task Queue past the live window) ───
import { ref } from 'vue'
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
} from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { mapTask } from '../../lib/mappers'
import { createPaginator, upsert } from './shared'
import type { DataContext } from './context'
import type { Task, TaskStatus } from '../../lib/types'

const FILTERED_PAGE_SIZE = 200

export function createFilteredTasksSlice(ctx: DataContext) {
  const { isFresh, markLoaded, requireOrgId, onReset } = ctx

  const filteredTasks = ref<Task[]>([])
  const paginator = createPaginator(onReset, FILTERED_PAGE_SIZE)
  let filteredKey = ''
  onReset(() => {
    filteredTasks.value = []
    filteredKey = ''
  })

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
    paginator.applyCursor(snap.docs)
    markLoaded(`filteredTasks:${key}`)
  }

  async function loadMoreFilteredTasks(statuses: TaskStatus[]): Promise<void> {
    const key = [...statuses].sort().join(',')
    if (key !== filteredKey || !paginator.canLoadMore()) return
    const orgId = requireOrgId()
    const snap = await getDocs(query(
      collection(db, 'tasks'),
      where('orgId', '==', orgId),
      where('status', 'in', statuses),
      orderBy('dueAt'),
      startAfter(paginator.getCursor()),
      limit(FILTERED_PAGE_SIZE),
    ))
    snap.forEach((d) => upsert(filteredTasks.value, mapTask(d.id, d.data())))
    paginator.applyCursor(snap.docs)
  }

  return { filteredTasks, filteredMayHaveMore: paginator.mayHaveMore, loadFilteredTasks, loadMoreFilteredTasks }
}
