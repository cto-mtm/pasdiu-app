// Stateless helpers and Firestore-imposed limits shared by every data-store
// slice. Nothing here touches store state, so it stays importable from any
// slice without creating a dependency between them.
import { ref } from 'vue'
import { writeBatch, type DocumentReference, type QueryDocumentSnapshot } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { i18n } from '../../i18n'
import { useToastStore } from '../toast'

// Run a Firestore write; on failure surface a toast and rethrow so callers can
// keep a modal open / avoid assuming success.
export async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    useToastStore().error(i18n.global.t('common.saveError'))
    throw e
  }
}

// Like guarded, but for optimistic updates that need a revert on failure.
export async function guardedOptimistic<T>(fn: () => Promise<T>, revert: () => void): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    revert()
    useToastStore().error(i18n.global.t('common.saveError'))
    throw e
  }
}

// Firestore batches cap at 500 ops — chunk conservatively below that so each
// cascade commits atomically (or in a handful of atomic chunks when huge).
export const BATCH_LIMIT = 400

// Firestore caps `in` at 30 values.
export const IN_LIMIT = 30

// Full-collection loads page at this size (AUDIT E3): first page replaces
// state, loadMore* appends.
export const PAGE_SIZE = 1000

// The optional usage-counter decrement rides in the FIRST chunk so the
// entitlement counters move in the same commit as the docs they count
// (rules validate the counter write matches the mutation).
export async function commitDeletes(
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

export function upsert<T extends { id: string }>(arr: T[], item: T) {
  const i = arr.findIndex((x) => x.id === item.id)
  if (i === -1) arr.push(item)
  else arr[i] = item
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

// ── Pagination helper ─────────────────────────────────────────────
// Eliminates the duplicated cursor + mayHaveMore + onReset boilerplate
// repeated in every paginated slice.
export function createPaginator(onReset: (fn: () => void) => void, pageSize = PAGE_SIZE) {
  let cursor: QueryDocumentSnapshot | null = null
  const mayHaveMore = ref(false)
  onReset(() => { cursor = null; mayHaveMore.value = false })

  /** Call after each page fetch to update cursor state. */
  function applyCursor(docs: QueryDocumentSnapshot[]): void {
    cursor = docs[docs.length - 1] ?? cursor
    mayHaveMore.value = docs.length === pageSize
  }

  /** Call at the start of loadMore — if false, there's nothing to fetch. */
  function canLoadMore(): boolean {
    return mayHaveMore.value && cursor !== null
  }

  function getCursor(): QueryDocumentSnapshot | null {
    return cursor
  }

  /** Reset cursor to a specific snapshot (for live listeners that re-anchor). */
  function setCursor(doc: QueryDocumentSnapshot | null): void {
    cursor = doc
  }

  return { mayHaveMore, applyCursor, canLoadMore, getCursor, setCursor }
}
