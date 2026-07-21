<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useDataStore } from '../stores/data'
import { TASK_STATUSES } from '../lib/types'
import { isDoneStatus, statusColor, statusKey } from '../lib/status'
import BaseButton from '../components/BaseButton.vue'
import DonutChart from '../components/DonutChart.vue'
import BarChart from '../components/BarChart.vue'
import InfoTip from '../components/InfoTip.vue'

const { t } = useI18n()
const router = useRouter()
const data = useDataStore()

// Clicking a status segment drills into the filtered All Tasks queue.
function drillStatus(status: string) {
  router.push({ name: 'all-tasks', query: { status } })
}

const totals = computed(() => ({
  clients: data.clients.length,
  projects: data.projects.length,
  tasks: data.tasks.length,
}))

const statusSegments = computed(() =>
  TASK_STATUSES.map((s) => ({
    id: s,
    label: t(statusKey(s)),
    value: data.tasks.filter((tk) => tk.status === s).length,
    color: statusColor(s),
  })),
)

const perClient = computed(() =>
  data.clients.map((c) => ({
    id: c.id,
    label: c.name,
    value: data.tasks.filter((tk) => tk.clientId === c.id).length,
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
      value: data.tasks.filter((tk) => tk.assigneeUid === u.uid && !isDoneStatus(tk.status)).length,
    }))
    .sort((a, b) => b.value - a.value),
)

const loadError = ref(false)
async function load() {
  loadError.value = false
  try {
    await data.loadWorkspace()
  } catch {
    loadError.value = true
  }
}
onMounted(load)
</script>

<template>
  <section>
    <h1 class="text-2xl font-bold tracking-tight" style="color: var(--text);">{{ t('analytics.title') }}</h1>
    <p class="mt-1 text-sm" style="color: var(--text-muted);">{{ t('analytics.subtitle') }}</p>

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
