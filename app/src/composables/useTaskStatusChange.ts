import { computed, ref } from 'vue'
import type { Task, TaskStatus } from '../lib/types'
import { useAuthStore } from '../stores/auth'
import { useDataStore } from '../stores/data'
import { isDoneStatus, MANUAL_TASK_STATUSES } from '../lib/status'

/**
 * The one implementation of "who may move a task, to what, and what has to be
 * documented on the way". Shared by the board's TaskCard and the task page so
 * the two surfaces can never drift apart on permissions or on the confirm step.
 *
 * Callers own the UI; this owns the rules. The task comes in as a getter (not
 * a ref) so both a prop and a store-backed computed can be passed without the
 * variance problem `Ref<Task>` vs `Ref<Task | undefined>` would create.
 */
export function useTaskStatusChange(getTask: () => Task | undefined) {
  const auth = useAuthStore()
  const data = useDataStore()

  const task = computed(getTask)

  const isDone = computed(() => (task.value ? isDoneStatus(task.value.status) : false))

  // Mirrors the Firestore rules: contractors may only change the status of
  // tasks assigned to them. Managers get the same four choices — 'approved'
  // and 'revisions' were already client-only in practice, and now nobody
  // picks them by hand.
  const canChangeStatus = computed(
    () => !!task.value
      && (auth.isManager || (auth.role === 'contractor' && task.value.assigneeUid === auth.profile?.uid)),
  )
  const statusOptions = computed<TaskStatus[]>(() => {
    const current = task.value?.status
    // A task parked in a flow-written status (approved, in revisions, delivered)
    // keeps that value listed so the select shows the truth rather than
    // silently displaying a status the task isn't in.
    return current && !MANUAL_TASK_STATUSES.includes(current)
      ? [current, ...MANUAL_TASK_STATUSES]
      : MANUAL_TASK_STATUSES
  })

  // Status changes go through a confirmation step. Moving to 'blocked'
  // requires documenting why; moving to 'delivered' takes an optional
  // delivery note (link, method, recipient…).
  const confirmOpen = ref(false)
  const pendingStatus = ref<TaskStatus | null>(null)
  const pendingDetail = ref('')
  const needsBlockedReason = computed(() => pendingStatus.value === 'blocked')
  const asksDeliveryNote = computed(() =>
    pendingStatus.value === 'delivered'
    || (!!task.value?.deliverableId && pendingStatus.value !== null && isDoneStatus(pendingStatus.value))
  )
  const confirmDisabled = computed(() => needsBlockedReason.value && !pendingDetail.value.trim())

  /** Open the confirm step for an explicitly chosen status. */
  function requestStatus(next: TaskStatus): void {
    if (!task.value || next === task.value.status) return
    pendingStatus.value = next
    pendingDetail.value = ''
    confirmOpen.value = true
  }

  /** The check-off affordance: done ↔ in_progress. */
  function requestToggle(): void {
    requestStatus(isDone.value ? 'in_progress' : 'done')
  }

  /**
   * Select-element handler: reverts the visible value immediately so the
   * control never shows a status the task doesn't have until the write lands.
   */
  function onSelect(e: Event): void {
    const el = e.target as HTMLSelectElement
    const next = el.value as TaskStatus
    if (task.value) el.value = task.value.status
    requestStatus(next)
  }

  function cancelChange(): void {
    confirmOpen.value = false
    pendingStatus.value = null
    pendingDetail.value = ''
  }

  async function confirmChange(): Promise<void> {
    if (task.value && pendingStatus.value) {
      await data.updateTaskStatus(task.value.id, pendingStatus.value, {
        ...(needsBlockedReason.value ? { blockedReason: pendingDetail.value } : {}),
        ...(asksDeliveryNote.value ? { deliveryNote: pendingDetail.value } : {}),
      })
    }
    cancelChange()
  }

  return {
    isDone,
    canChangeStatus,
    statusOptions,
    confirmOpen,
    pendingStatus,
    pendingDetail,
    needsBlockedReason,
    asksDeliveryNote,
    confirmDisabled,
    requestStatus,
    requestToggle,
    onSelect,
    confirmChange,
    cancelChange,
  }
}
