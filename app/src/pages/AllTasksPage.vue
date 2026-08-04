<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useDataStore } from '../stores/data'
import { useBusy } from '../composables/useBusy'
import { TASK_STATUSES } from '../lib/types'
import type { TaskStatus } from '../lib/types'
import { statusKey } from '../lib/status'
import BaseButton from '../components/BaseButton.vue'
import TaskRow from '../components/TaskRow.vue'

const { t } = useI18n()
const route = useRoute()
const data = useDataStore()

// Accept a ?status= deep link (e.g. from the Analytics donut) — and stay in
// sync when the query changes while the page is already mounted.
function statusFromQuery(q: unknown): TaskStatus | 'all' {
  return TASK_STATUSES.includes(q as TaskStatus) ? (q as TaskStatus) : 'all'
}

const statusFilter = ref<TaskStatus | 'all'>(statusFromQuery(route.query.status))
watch(
  () => route.query.status,
  (q) => {
    statusFilter.value = statusFromQuery(q)
  },
)

const assigneeFilter = ref<string>('all')

// Two row sources. While the live window holds the WHOLE org (the common
// case), filters are applied client-side over live data. Once the org
// outgrows the window (tasksMayHaveMore), a client-side filter would
// silently miss matches beyond it — so active filters switch to a
// server-side query that is complete at any scale (one-shot + paged, not
// live; re-selecting the filter re-reads once its freshness lapses).
const serverFilters = computed(() => ({
  ...(statusFilter.value !== 'all' ? { status: statusFilter.value } : {}),
  ...(assigneeFilter.value !== 'all' ? { assigneeUid: assigneeFilter.value } : {}),
}))
const filterActive = computed(() => statusFilter.value !== 'all' || assigneeFilter.value !== 'all')
const usingServerFilter = computed(() => filterActive.value && data.tasksMayHaveMore)

const rows = computed(() =>
  (usingServerFilter.value ? data.filteredTasks : data.tasks)
    // Both filters re-apply even to server results — cheap, and it keeps the
    // list right during the brief moment a filter change is still fetching.
    .filter((tk) => statusFilter.value === 'all' || tk.status === statusFilter.value)
    .filter((tk) => assigneeFilter.value === 'all' || tk.assigneeUid === assigneeFilter.value)
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

// Fetch the server-side view whenever it becomes the active source — on
// filter change, or when the first snapshot reveals the window is partial.
// A single watcher avoids duplicate fetches when both deps update on the
// same tick (e.g. filter changes while tasksMayHaveMore is already true).
watch([usingServerFilter, serverFilters], async ([active]) => {
  if (!active) return
  try {
    await data.loadFilteredTasks(serverFilters.value)
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
    usingServerFilter.value ? data.loadMoreFilteredTasks(serverFilters.value) : data.loadMoreTasks(),
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
      <!-- Filters -->
      <div class="mt-5 flex flex-wrap gap-3">
        <label class="flex items-center gap-2 text-sm" style="color: var(--text-muted);">
          {{ t('allTasks.filterStatus') }}
          <select v-model="statusFilter" class="rounded-lg border px-2 py-1 text-sm outline-none" style="background: var(--surface-2); color: var(--text); border-color: var(--border);">
            <option value="all">{{ t('allTasks.all') }}</option>
            <option v-for="s in TASK_STATUSES" :key="s" :value="s">{{ t(statusKey(s)) }}</option>
          </select>
        </label>
        <label class="flex items-center gap-2 text-sm" style="color: var(--text-muted);">
          {{ t('allTasks.filterAssignee') }}
          <select v-model="assigneeFilter" class="rounded-lg border px-2 py-1 text-sm outline-none" style="background: var(--surface-2); color: var(--text); border-color: var(--border);">
            <option value="all">{{ t('allTasks.all') }}</option>
            <option v-for="u in data.teamMembers" :key="u.uid" :value="u.uid">{{ u.displayName }}</option>
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
