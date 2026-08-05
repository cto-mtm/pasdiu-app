<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useDataStore } from '../stores/data'
import { useBusy } from '../composables/useBusy'
import { TASK_STATUSES } from '../lib/types'
import type { TaskStatus } from '../lib/types'
import { REVIEW_STATUSES, statusKey } from '../lib/status'
import BaseButton from '../components/BaseButton.vue'
import TaskRow from '../components/TaskRow.vue'

const { t } = useI18n()
const route = useRoute()
const data = useDataStore()

// The queue: work across every client, cut by status. The cross-client
// status view is this page's whole job — per-person lives on the team member
// page and per-client on the client page, so there is no assignee filter and
// no "browse everything" default. 'review' is the board's In Review cut
// (revisions/approved/delivered): work sitting with clients, which is what a
// manager checks first — so it's the landing view.
type QueueCut = TaskStatus | 'review' | 'all'
const DEFAULT_CUT: QueueCut = 'review'

// Accept a ?status= deep link (e.g. from the Analytics donut) — and stay in
// sync when the query changes while the page is already mounted.
function cutFromQuery(q: unknown): QueueCut {
  if (q === 'review' || q === 'all') return q
  return TASK_STATUSES.includes(q as TaskStatus) ? (q as TaskStatus) : DEFAULT_CUT
}

const cut = ref<QueueCut>(cutFromQuery(route.query.status))
watch(
  () => route.query.status,
  (q) => {
    cut.value = cutFromQuery(q)
  },
)

// The statuses the current cut collects ([] = all of them).
const cutStatuses = computed<TaskStatus[]>(() => {
  if (cut.value === 'all') return []
  if (cut.value === 'review') return REVIEW_STATUSES
  return [cut.value]
})

// Two row sources. While the live window holds the WHOLE org (the common
// case), the cut is applied client-side over live data. Once the org
// outgrows the window (tasksMayHaveMore), a client-side cut would silently
// miss matches beyond it — so an active cut switches to a server-side query
// that is complete at any scale (one-shot + paged, not live; re-selecting
// the cut re-reads once its freshness lapses).
const usingServerFilter = computed(() => cutStatuses.value.length > 0 && data.tasksMayHaveMore)

const rows = computed(() =>
  (usingServerFilter.value ? data.filteredTasks : data.tasks)
    // The cut re-applies even to server results — cheap, and it keeps the
    // list right during the brief moment a cut change is still fetching.
    .filter((tk) => !cutStatuses.value.length || cutStatuses.value.includes(tk.status))
    .sort((a, b) => (a.dueAt?.getTime() ?? 0) - (b.dueAt?.getTime() ?? 0)),
)

const loadError = ref(false)
async function load(force = false) {
  loadError.value = false
  try {
    await data.loadWorkspace(force)
  } catch {
    loadError.value = true
  }
}
onMounted(load)

// Fetch the server-side view whenever it becomes the active source — on cut
// change, or when the first snapshot reveals the window is partial. A single
// watcher avoids duplicate fetches when both deps update on the same tick.
watch([usingServerFilter, cutStatuses], async ([active]) => {
  if (!active) return
  try {
    await data.loadFilteredTasks(cutStatuses.value)
  } catch {
    loadError.value = true
  }
})

// Cursor pagination past the first page — of whichever source is active.
const { busy: loadingMore, run: runLoadMore } = useBusy()
const mayHaveMore = computed(() =>
  usingServerFilter.value ? data.filteredMayHaveMore : data.tasksMayHaveMore,
)
async function loadMore() {
  await runLoadMore(() =>
    usingServerFilter.value ? data.loadMoreFilteredTasks(cutStatuses.value) : data.loadMoreTasks(),
  )
}
</script>

<template>
  <section>
    <h1 class="text-2xl font-bold tracking-tight" style="color: var(--text);">{{ t('allTasks.title') }}</h1>
    <p class="mt-1 text-sm" style="color: var(--text-muted);">{{ t('allTasks.subtitle') }}</p>

    <div v-if="loadError" class="mt-8">
      <p class="text-sm" style="color: var(--text-muted);">{{ t('common.loadError') }}</p>
      <BaseButton class="mt-3" @click="load(true)">{{ t('common.retry') }}</BaseButton>
    </div>

    <template v-else>
      <!-- The status cut -->
      <div class="mt-5 flex flex-wrap gap-3">
        <label class="flex items-center gap-2 text-sm" style="color: var(--text-muted);">
          {{ t('allTasks.filterStatus') }}
          <select v-model="cut" class="rounded-lg border px-2 py-1 text-sm outline-none" style="background: var(--surface-2); color: var(--text); border-color: var(--border);">
            <option value="review">{{ t('status.review') }}</option>
            <option v-for="s in TASK_STATUSES" :key="s" :value="s">{{ t(statusKey(s)) }}</option>
            <option value="all">{{ t('allTasks.all') }}</option>
          </select>
        </label>
      </div>

      <p v-if="!rows.length" class="mt-8 text-sm" style="color: var(--text-muted);">{{ t('allTasks.empty') }}</p>

      <div v-else class="mt-6 divide-y overflow-hidden rounded-xl border" style="border-color: var(--border);">
        <TaskRow
          v-for="tk in rows"
          :key="tk.id"
          :task="tk"
          :context="[data.getClient(tk.clientId)?.name, data.getProject(tk.projectId)?.name].filter(Boolean).join(' · ')"
          :title="tk.description || tk.title"
        >
          <template #meta>
            <span class="hidden text-xs sm:inline" style="color: var(--text-muted);">{{ data.userName(tk.assigneeUid) }}</span>
          </template>
        </TaskRow>
      </div>

      <div v-if="mayHaveMore" class="mt-4 flex justify-center">
        <BaseButton :disabled="loadingMore" @click="loadMore">
          {{ loadingMore ? t('common.loading') : t('allTasks.loadMore') }}
        </BaseButton>
      </div>
    </template>
  </section>
</template>
