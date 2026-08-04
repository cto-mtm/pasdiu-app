<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDataStore } from '../stores/data'
import { useBusy } from '../composables/useBusy'
import { useEntitlements } from '../composables/useEntitlements'
import { statusKey } from '../lib/status'
import { toCsv, downloadCsv } from '../lib/csv'
import type { TaskStatus } from '../lib/types'
import BaseButton from '../components/BaseButton.vue'
import RefreshButton from '../components/RefreshButton.vue'

const { t, d } = useI18n()
const data = useDataStore()
// The route is already plan-gated; the export button gets its own check as
// belt-and-braces (csvExport could diverge from ledger access by plan).
const { has } = useEntitlements()

// Filters
const clientFilter = ref('all')
const contractorFilter = ref('all')
const statusFilter = ref<'all' | 'approved' | 'delivered' | 'done'>('all')
const fromDate = ref('')
const toDate = ref('')

interface Row {
  task: string
  client: string
  project: string
  contractor: string
  status: TaskStatus
  completedAt: Date | null
}

// Rows come from the ledger's OWN query (completed tasks, newest completion
// first, paged) — not from the org-wide task window, which only holds the
// first page of tasks by document id and silently under-reported here.
// The filters below narrow the loaded pages client-side.
const rows = computed<Row[]>(() =>
  data.ledgerTasks
    .filter((tk) => clientFilter.value === 'all' || tk.clientId === clientFilter.value)
    .filter((tk) => contractorFilter.value === 'all' || tk.assigneeUid === contractorFilter.value)
    .filter((tk) => statusFilter.value === 'all' || tk.status === statusFilter.value)
    .filter((tk) => {
      if (!fromDate.value && !toDate.value) return true
      const ts = tk.completedAt?.getTime() ?? 0
      if (fromDate.value && ts < new Date(fromDate.value + 'T00:00:00').getTime()) return false
      if (toDate.value && ts > new Date(toDate.value + 'T23:59:59').getTime()) return false
      return true
    })
    .map((tk) => ({
      task: tk.title,
      client: data.getClient(tk.clientId)?.name ?? '',
      project: data.getProject(tk.projectId)?.name ?? '',
      contractor: data.userName(tk.assigneeUid),
      status: tk.status,
      completedAt: tk.completedAt,
    }))
    .sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0)),
)

const { busy: exporting, run: runExport } = useBusy()
async function exportCsv() {
  await runExport(async () => {
    // An export is a completeness contract (payroll/accounting) — pull every
    // remaining page first so the CSV covers ALL matching work, not just the
    // pages that happen to be on screen.
    while (data.ledgerMayHaveMore) await data.loadMoreLedger()
    const headers = [
      t('ledger.colTask'),
      t('ledger.colClient'),
      t('ledger.colProject'),
      t('ledger.colContractor'),
      t('ledger.colStatus'),
      t('ledger.colCompleted'),
    ]
    const csv = toCsv(
      headers,
      rows.value.map((r) => [r.task, r.client, r.project, r.contractor, t(statusKey(r.status)), r.completedAt?.toISOString() ?? '']),
    )
    downloadCsv(`pasdiu-ledger-${new Date().toISOString().slice(0, 10)}.csv`, csv)
  })
}

const loadError = ref(false)
async function load(force = false) {
  loadError.value = false
  try {
    // Listeners for the name lookups (client/project/contractor columns);
    // the ledger query itself is a TTL-memoized pull that `force` re-reads.
    await Promise.all([data.loadUsers(), data.loadClients(), data.loadAllProjects(), data.loadLedger(force)])
  } catch {
    loadError.value = true
  }
}
onMounted(load)

const { busy: loadingMore, run: runLoadMore } = useBusy()
async function loadMore() {
  await runLoadMore(() => data.loadMoreLedger())
}
</script>

<template>
  <section>
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold tracking-tight" style="color: var(--text);">{{ t('ledger.title') }}</h1>
        <p class="mt-1 text-sm" style="color: var(--text-muted);">{{ t('ledger.subtitle') }}</p>
      </div>
      <div class="flex items-center gap-2">
        <RefreshButton :on-refresh="() => load(true)" />
        <button
          v-if="has('csvExport')"
          class="rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50"
          style="background: var(--accent-emerald); color: var(--bg);"
          :disabled="!rows.length || exporting"
          @click="exportCsv"
        >
          {{ t('ledger.export') }}
        </button>
        <p v-else class="text-xs" style="color: var(--text-muted);">{{ t('billing.csvExportLocked') }}</p>
      </div>
    </div>

    <div v-if="loadError" class="mt-8">
      <p class="text-sm" style="color: var(--text-muted);">{{ t('common.loadError') }}</p>
      <BaseButton class="mt-3" @click="load(true)">{{ t('common.retry') }}</BaseButton>
    </div>

    <template v-else>
      <!-- Filters -->
      <div class="mt-5 flex flex-wrap gap-3">
        <label class="flex items-center gap-2 text-sm" style="color: var(--text-muted);">
          {{ t('ledger.filterClient') }}
          <select v-model="clientFilter" class="rounded-lg border px-2 py-1 text-sm outline-none" style="background: var(--surface-2); color: var(--text); border-color: var(--border);">
            <option value="all">{{ t('ledger.all') }}</option>
            <option v-for="c in data.clients" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </label>
        <label class="flex items-center gap-2 text-sm" style="color: var(--text-muted);">
          {{ t('ledger.filterContractor') }}
          <select v-model="contractorFilter" class="rounded-lg border px-2 py-1 text-sm outline-none" style="background: var(--surface-2); color: var(--text); border-color: var(--border);">
            <option value="all">{{ t('ledger.all') }}</option>
            <option v-for="u in data.teamMembers" :key="u.uid" :value="u.uid">{{ u.displayName }}</option>
          </select>
        </label>
        <label class="flex items-center gap-2 text-sm" style="color: var(--text-muted);">
          {{ t('ledger.filterStatus') }}
          <select v-model="statusFilter" class="rounded-lg border px-2 py-1 text-sm outline-none" style="background: var(--surface-2); color: var(--text); border-color: var(--border);">
            <option value="all">{{ t('ledger.all') }}</option>
            <option value="approved">{{ t('status.approved') }}</option>
            <option value="delivered">{{ t('status.delivered') }}</option>
            <option value="done">{{ t('status.done') }}</option>
          </select>
        </label>
        <label class="flex items-center gap-2 text-sm" style="color: var(--text-muted);">
          {{ t('ledger.from') }}
          <input v-model="fromDate" type="date" class="rounded-lg border px-2 py-1 text-sm outline-none" style="background: var(--surface-2); color: var(--text); border-color: var(--border);" />
        </label>
        <label class="flex items-center gap-2 text-sm" style="color: var(--text-muted);">
          {{ t('ledger.to') }}
          <input v-model="toDate" type="date" class="rounded-lg border px-2 py-1 text-sm outline-none" style="background: var(--surface-2); color: var(--text); border-color: var(--border);" />
        </label>
      </div>

      <p v-if="!rows.length" class="mt-8 text-sm" style="color: var(--text-muted);">{{ t('ledger.empty') }}</p>

      <div v-else class="mt-6 overflow-x-auto rounded-xl border" style="border-color: var(--border);">
        <table class="w-full text-left text-sm">
          <thead>
            <tr style="background: var(--surface-2); color: var(--text-muted);">
              <th class="px-4 py-2 font-medium">{{ t('ledger.colTask') }}</th>
              <th class="px-4 py-2 font-medium">{{ t('ledger.colClient') }}</th>
              <th class="px-4 py-2 font-medium">{{ t('ledger.colProject') }}</th>
              <th class="px-4 py-2 font-medium">{{ t('ledger.colContractor') }}</th>
              <th class="px-4 py-2 font-medium">{{ t('ledger.colCompleted') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in rows" :key="i" class="border-t" style="border-color: var(--border);">
              <td class="px-4 py-2" style="color: var(--text);">{{ r.task }}</td>
              <td class="px-4 py-2" style="color: var(--text-muted);">{{ r.client }}</td>
              <td class="px-4 py-2" style="color: var(--text-muted);">{{ r.project }}</td>
              <td class="px-4 py-2" style="color: var(--text-muted);">{{ r.contractor }}</td>
              <td class="px-4 py-2" style="color: var(--text-muted);">{{ r.completedAt ? d(r.completedAt, 'short') : '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Older completions beyond the loaded pages. Filters apply only to
           what's loaded, so pulling more can grow the filtered view too. -->
      <div v-if="data.ledgerMayHaveMore" class="mt-4 flex justify-center">
        <BaseButton :disabled="loadingMore" @click="loadMore">
          {{ loadingMore ? t('common.loading') : t('ledger.loadMore') }}
        </BaseButton>
      </div>
    </template>
  </section>
</template>
