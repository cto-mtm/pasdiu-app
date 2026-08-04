<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useDataStore } from '../stores/data'
import { TASK_STATUSES } from '../lib/types'
import type { TaskStatus } from '../lib/types'
import { statusColor, statusKey } from '../lib/status'
import BaseButton from '../components/BaseButton.vue'
import DonutChart from '../components/DonutChart.vue'
import BarChart from '../components/BarChart.vue'
import InfoTip from '../components/InfoTip.vue'
import RefreshButton from '../components/RefreshButton.vue'

const { t } = useI18n()
const router = useRouter()
const data = useDataStore()

// Clicking a status segment drills into the filtered All Tasks queue.
function drillStatus(status: string) {
  router.push({ name: 'all-tasks', query: { status } })
}

// Every NUMBER on this page comes from server-side count() aggregations, not
// from the windowed `tasks` array — the window holds only the first page of
// the org's tasks, so computing over it silently under-reported once a
// workspace outgrew it. Names/labels come from the live listeners.
const statusCounts = ref<Record<TaskStatus, number> | null>(null)
const clientCounts = ref<Record<string, number>>({})
const activeCounts = ref<Record<string, number>>({})
const projectCount = ref(0)

const totals = computed(() => ({
  clients: data.clients.length,
  projects: projectCount.value,
  tasks: statusCounts.value ? Object.values(statusCounts.value).reduce((a, b) => a + b, 0) : 0,
}))

const statusSegments = computed(() =>
  TASK_STATUSES.map((s) => ({
    id: s,
    label: t(statusKey(s)),
    value: statusCounts.value?.[s] ?? 0,
    color: statusColor(s),
  })),
)

const perClient = computed(() =>
  data.clients.map((c) => ({
    id: c.id,
    label: c.name,
    value: clientCounts.value[c.id] ?? 0,
  })),
)

// Clicking a per-client bar drills into that client.
function drillClient(id: string) {
  router.push({ name: 'client', params: { clientId: id } })
}

const workload = computed(() =>
  data.teamMembers
    .map((u) => ({
      label: u.displayName,
      value: activeCounts.value[u.uid] ?? 0,
    }))
    .sort((a, b) => b.value - a.value),
)

const loadError = ref(false)
async function load() {
  loadError.value = false
  try {
    // Listeners first — the count fetches below iterate the loaded rosters.
    await Promise.all([data.loadUsers(), data.loadClients()])
    const [byStatus, byClient, active, projects] = await Promise.all([
      data.fetchTaskStatusCounts(),
      data.fetchTaskCountsForClients(data.clients.map((c) => c.id)),
      data.fetchActiveTaskCounts(data.teamMembers.map((u) => u.uid)),
      data.fetchProjectCount(),
    ])
    statusCounts.value = byStatus
    clientCounts.value = byClient
    activeCounts.value = active
    projectCount.value = projects
  } catch {
    loadError.value = true
  }
}
onMounted(load)
</script>

<template>
  <section>
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold tracking-tight" style="color: var(--text);">{{ t('analytics.title') }}</h1>
        <p class="mt-1 text-sm" style="color: var(--text-muted);">{{ t('analytics.subtitle') }}</p>
      </div>
      <!-- The counts are one-shot aggregations, not live — this re-fetches them. -->
      <RefreshButton :on-refresh="load" />
    </div>

    <div v-if="loadError" class="mt-8">
      <p class="text-sm" style="color: var(--text-muted);">{{ t('common.loadError') }}</p>
      <BaseButton class="mt-3" @click="load">{{ t('common.retry') }}</BaseButton>
    </div>

    <template v-else>
      <!-- Stat cards -->
      <div class="mt-6 grid grid-cols-3 gap-3">
        <div class="rounded-xl border p-4" style="background: var(--surface); border-color: var(--border);">
          <p class="text-3xl font-bold" style="color: var(--text);">{{ totals.clients }}</p>
          <p class="mt-1 text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('analytics.clients') }}</p>
        </div>
        <div class="rounded-xl border p-4" style="background: var(--surface); border-color: var(--border);">
          <p class="text-3xl font-bold" style="color: var(--text);">{{ totals.projects }}</p>
          <p class="mt-1 text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('analytics.projects') }}</p>
        </div>
        <div class="rounded-xl border p-4" style="background: var(--surface); border-color: var(--border);">
          <p class="text-3xl font-bold" style="color: var(--text);">{{ totals.tasks }}</p>
          <p class="mt-1 text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('analytics.tasks') }}</p>
        </div>
      </div>

      <div class="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <!-- Donut: tasks by status -->
        <div class="rounded-xl border p-5" style="background: var(--surface); border-color: var(--border);">
          <h2 class="mb-4 text-sm font-semibold uppercase tracking-wide" style="color: var(--text-muted);">{{ t('analytics.byStatus') }}</h2>
          <DonutChart :segments="statusSegments" :center-label="t('analytics.tasks')" @select="drillStatus" />
          <p class="mt-3 text-xs" style="color: var(--text-muted);">{{ t('analytics.drillHint') }}</p>
        </div>

        <!-- Bar: tasks per client -->
        <div class="rounded-xl border p-5" style="background: var(--surface); border-color: var(--border);">
          <h2 class="mb-4 text-sm font-semibold uppercase tracking-wide" style="color: var(--text-muted);">{{ t('analytics.perClient') }}</h2>
          <BarChart v-if="perClient.length" :bars="perClient" @select="drillClient" />
          <p v-else class="text-sm" style="color: var(--text-muted);">{{ t('analytics.noData') }}</p>
        </div>
      </div>

      <!-- Contractor workload -->
      <div class="mt-4 rounded-xl border p-5" style="background: var(--surface); border-color: var(--border);">
        <h2 class="mb-4 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide" style="color: var(--text-muted);">
          {{ t('analytics.workload') }}
          <InfoTip :text="t('analytics.workloadInfo')" />
        </h2>
        <BarChart v-if="workload.length" :bars="workload" />
        <p v-else class="text-sm" style="color: var(--text-muted);">{{ t('analytics.noData') }}</p>
      </div>
    </template>
  </section>
</template>
