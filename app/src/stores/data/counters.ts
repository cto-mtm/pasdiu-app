// ── Aggregation counters (Analytics, Team) ────────────────────
// count() bills one read per 1,000 index entries matched (minimum one), so
// these stay exact and near-free at any workspace size — unlike computing
// over the windowed `tasks` array, which silently under-counts past the
// first page. No counter anywhere should scan documents.
import { collection, getCountFromServer, query, where, type QueryConstraint } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { isDoneStatus } from '../../lib/status'
import { TASK_STATUSES } from '../../lib/types'
import type { DataContext } from './context'
import type { TaskStatus } from '../../lib/types'

export function createCountersSlice(ctx: DataContext) {
  const { requireOrgId } = ctx

  // The statuses that count as workload — everything isDoneStatus is not.
  // Derived at store-creation time (not module load) so this module stays free
  // of top-level work: stores/auth ↔ stores/data is a legal import cycle, and
  // nothing in a slice should depend on evaluation order to be correct.
  const ACTIVE_STATUSES = TASK_STATUSES.filter((s) => !isDoneStatus(s))

  async function countTasks(...conditions: QueryConstraint[]): Promise<number> {
    const orgId = requireOrgId()
    const snap = await getCountFromServer(query(collection(db, 'tasks'), where('orgId', '==', orgId), ...conditions))
    return snap.data().count
  }

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

  return { fetchTaskStatusCounts, fetchTaskCountsForClients, fetchActiveTaskCounts, fetchProjectCount }
}
