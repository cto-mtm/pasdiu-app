<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import type { Task, TaskStatus } from '../lib/types'
import { TASK_STATUSES } from '../lib/types'
import { useAuthStore } from '../stores/auth'
import { useDataStore } from '../stores/data'
import { isDoneStatus, statusKey } from '../lib/status'
import StatusBadge from './StatusBadge.vue'
import ConfirmDialog from './ConfirmDialog.vue'

const props = defineProps<{ task: Task; showSubGroup?: boolean }>()

const { t, d } = useI18n()
const router = useRouter()
const auth = useAuthStore()
const data = useDataStore()

const isDone = computed(() => isDoneStatus(props.task.status))
const subGroupName = computed(() => data.subGroups.find((s) => s.id === props.task.subGroupId)?.name ?? '')

// Mirrors the Firestore rules: contractors may only change the status of
// tasks assigned to them, and may never set 'approved' (that's client-only,
// via the review surface). Managers keep the full select.
const canChangeStatus = computed(
  () => auth.isManager || (auth.role === 'contractor' && props.task.assigneeUid === auth.profile?.uid),
)
const statusOptions = computed<TaskStatus[]>(() =>
  // Non-managers never get 'approved' as a target — but if it's the task's
  // current status, keep it listed so the select still shows the truth.
  auth.isManager
    ? TASK_STATUSES
    : TASK_STATUSES.filter((s) => s !== 'approved' || s === props.task.status),
)

// Status changes go through a confirmation step. Moving to 'blocked'
// requires documenting why; moving to 'delivered' takes an optional
// delivery note (link, method, recipient…).
const confirmOpen = ref(false)
const pendingStatus = ref<TaskStatus | null>(null)
const pendingDetail = ref('')
const needsBlockedReason = computed(() => pendingStatus.value === 'blocked')
const asksDeliveryNote = computed(() =>
  pendingStatus.value === 'delivered'
  || (!!props.task.deliverableId && pendingStatus.value !== null && isDoneStatus(pendingStatus.value))
)
const confirmDisabled = computed(() => needsBlockedReason.value && !pendingDetail.value.trim())

function open() {
  router.push({ name: 'task', params: { taskId: props.task.id } })
}

// One-click client-visibility toggle (managers only — rules deny everyone
// else). Reversible and low-stakes, so no confirmation step.
const togglingVisibility = ref(false)
async function toggleVisibility() {
  if (togglingVisibility.value) return
  togglingVisibility.value = true
  try {
    await data.updateTask(props.task.id, { clientVisible: !props.task.clientVisible })
  } finally {
    togglingVisibility.value = false
  }
}
function requestToggle() {
  pendingStatus.value = isDone.value ? 'in_progress' : 'done'
  confirmOpen.value = true
}
function onSelect(e: Event) {
  const el = e.target as HTMLSelectElement
  const v = el.value as TaskStatus
  el.value = props.task.status // revert the visible value until confirmed
  if (v !== props.task.status) {
    pendingStatus.value = v
    pendingDetail.value = ''
    confirmOpen.value = true
  }
}
async function confirmChange() {
  if (pendingStatus.value) {
    await data.updateTaskStatus(props.task.id, pendingStatus.value, {
      ...(needsBlockedReason.value ? { blockedReason: pendingDetail.value } : {}),
      ...(asksDeliveryNote.value ? { deliveryNote: pendingDetail.value } : {}),
    })
  }
  cancelChange()
}
function cancelChange() {
  confirmOpen.value = false
  pendingStatus.value = null
  pendingDetail.value = ''
}
</script>

<template>
  <div
    class="cursor-pointer rounded-xl border p-3 transition-transform hover:-translate-y-0.5"
    style="background: var(--surface); border-color: var(--border);"
    role="button"
    tabindex="0"
    :title="task.description || task.title"
    @click="open"
    @keydown.enter="open"
  >
    <div class="flex items-start gap-2">
      <!-- Check-off: tactile complete toggle (confirms first). -->
      <button
        class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors disabled:opacity-50"
        :class="{ 'task-complete-glow': isDone }"
        :style="{
          borderColor: isDone ? 'var(--accent-emerald)' : 'var(--border)',
          background: isDone ? 'var(--accent-emerald)' : 'transparent',
        }"
        :disabled="!canChangeStatus"
        :aria-pressed="isDone"
        :aria-label="t('board.toggleComplete')"
        @click.stop="requestToggle"
      >
        <svg v-if="isDone" viewBox="0 0 12 12" class="h-3 w-3" style="color: var(--bg);">
          <path d="M2 6l2.5 2.5L10 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>

      <div class="min-w-0 flex-1">
        <p class="text-sm font-medium transition-opacity" :class="{ 'line-through opacity-60': isDone }" style="color: var(--text);">
          {{ task.title }}
        </p>
        <p v-if="showSubGroup && subGroupName" class="mt-0.5 text-xs" style="color: var(--text-muted);">
          {{ subGroupName }}
        </p>
      </div>
    </div>

    <!-- Meta on its own full-width line so it truncates instead of wrapping
         around the controls. -->
    <p class="mt-2 truncate text-xs" style="color: var(--text-muted);">
      {{ data.userName(task.assigneeUid) }}<template v-if="task.dueAt"> · {{ d(task.dueAt, 'short') }}</template>
    </p>

    <div class="mt-3 flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
      <StatusBadge :status="task.status" />
      <div class="flex items-center gap-1.5">
        <!-- Eye = what the client sees. Cyan when shared, muted + slashed when hidden. -->
        <button
          v-if="auth.isManager"
          class="flex h-6 w-6 items-center justify-center rounded border transition-colors disabled:opacity-50"
          :style="{
            background: 'var(--surface-2)',
            borderColor: 'var(--border)',
            color: task.clientVisible ? 'var(--accent-cyan)' : 'var(--text-muted)',
          }"
          :disabled="togglingVisibility"
          :aria-pressed="task.clientVisible"
          :aria-label="t('actions.clientVisibleLabel')"
          :title="t('actions.clientVisibleLabel')"
          @click.stop="toggleVisibility"
        >
          <svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
            <circle cx="12" cy="12" r="3" />
            <line v-if="!task.clientVisible" x1="3" y1="3" x2="21" y2="21" />
          </svg>
        </button>
        <select
          class="rounded border px-1.5 py-0.5 text-xs outline-none disabled:opacity-50"
          style="background: var(--surface-2); color: var(--text); border-color: var(--border);"
          :value="task.status"
          :disabled="!canChangeStatus"
          :aria-label="t('board.changeStatus')"
          @click.stop
          @change="onSelect"
        >
          <option v-for="s in statusOptions" :key="s" :value="s">{{ t(statusKey(s)) }}</option>
        </select>
      </div>
    </div>

    <p v-if="task.status === 'blocked' && task.blockedReason" class="mt-2 text-xs" style="color: var(--status-blocked);">
      {{ task.blockedReason }}
    </p>
    <p v-else-if="task.status === 'delivered' && task.deliveryNote" class="mt-2 text-xs" style="color: var(--text-muted);">
      {{ task.deliveryNote }}
    </p>

    <!-- Status change confirmation. Blocked demands a documented reason;
         delivered offers a delivery note. -->
    <ConfirmDialog
      :open="confirmOpen"
      :title="t('board.confirmTitle')"
      :message="t('board.confirmBody', { title: task.title, status: pendingStatus ? t(statusKey(pendingStatus)) : '' })"
      :confirm-disabled="confirmDisabled"
      @confirm="confirmChange"
      @cancel="cancelChange"
    >
      <label v-if="needsBlockedReason || asksDeliveryNote" class="mt-3 block" @click.stop>
        <span class="mb-1 block text-xs uppercase tracking-wide" style="color: var(--text-muted);">
          {{ needsBlockedReason ? t('board.blockedReasonLabel') : t('board.deliveryNoteLabel') }}
        </span>
        <textarea
          v-model="pendingDetail"
          rows="2"
          :placeholder="needsBlockedReason ? t('board.blockedReasonPlaceholder') : t('board.deliveryNotePlaceholder')"
          class="w-full rounded-lg border px-3 py-2 text-sm outline-none"
          style="background: var(--surface-2); color: var(--text); border-color: var(--border);"
        />
      </label>
    </ConfirmDialog>
  </div>
</template>
