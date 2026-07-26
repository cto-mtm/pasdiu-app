<script setup lang="ts">
// PackageQuota — displays planned / in progress / delivered against quota
// for each line in a project's package. Uses count() aggregation queries
// (never reads deliverable docs) so the whole widget costs ~3 reads.
import { onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { collection, getCountFromServer, query, where, Timestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuthStore } from '../stores/auth'
import type { Package, PackageLine } from '../lib/types'

const props = defineProps<{ pkg: Package }>()

const { t } = useI18n()
const auth = useAuthStore()

interface LineStat {
  typeId: string
  quantity: number
  delivered: number
  inProgress: number
  planned: number
}

const stats = ref<LineStat[]>([])
const loading = ref(true)

// Period boundaries from startsOn + period.
function currentPeriodBounds(line: PackageLine, startsOn: Date | null): { start: Date; end: Date } {
  const now = new Date()
  if (line.period === 'once') {
    // Per-goal: no period window — count all time.
    return { start: new Date(0), end: new Date(now.getTime() + 365 * 86400000) }
  }
  const anchor = startsOn ?? new Date(now.getFullYear(), now.getMonth(), 1)
  const months = line.period === 'month' ? 1 : 3

  // Find the period window containing "now".
  let start = new Date(anchor)
  while (start.getTime() + months * 30 * 86400000 < now.getTime()) {
    start = new Date(start.getTime() + months * 30 * 86400000)
  }
  const end = new Date(start.getTime() + months * 30 * 86400000)
  return { start, end }
}

async function loadStats() {
  loading.value = true
  const orgId = auth.activeOrgId
  if (!orgId) return

  const results: LineStat[] = []

  for (const line of props.pkg.lines) {
    const { start, end } = currentPeriodBounds(line, props.pkg.startsOn)
    const startTs = Timestamp.fromDate(start)
    const endTs = Timestamp.fromDate(end)

    // Delivered in this period (count() aggregation — 1 read per 1000 docs).
    const deliveredSnap = await getCountFromServer(query(
      collection(db, 'deliverables'),
      where('orgId', '==', orgId),
      where('projectId', '==', props.pkg.projectId),
      where('typeId', '==', line.typeId),
      where('status', '==', 'delivered'),
      where('deliveredAt', '>=', startTs),
      where('deliveredAt', '<=', endTs),
    ))

    // In progress (active, created in period).
    const activeSnap = await getCountFromServer(query(
      collection(db, 'deliverables'),
      where('orgId', '==', orgId),
      where('projectId', '==', props.pkg.projectId),
      where('typeId', '==', line.typeId),
      where('status', '==', 'active'),
    ))

    results.push({
      typeId: line.typeId,
      quantity: line.quantity,
      delivered: deliveredSnap.data().count,
      inProgress: activeSnap.data().count,
      planned: deliveredSnap.data().count + activeSnap.data().count,
    })
  }

  stats.value = results
  loading.value = false
}

onMounted(loadStats)
watch(() => props.pkg, loadStats)
</script>

<template>
  <div v-if="!loading && stats.length" class="rounded-xl border p-4" style="background: var(--surface); border-color: var(--border);">
    <h3 class="mb-3 text-sm font-semibold" style="color: var(--text);">{{ pkg.name }}</h3>
    <div class="space-y-2">
      <div v-for="s in stats" :key="s.typeId" class="flex items-center justify-between text-sm">
        <span style="color: var(--text-muted);">{{ s.typeId }}</span>
        <div class="flex items-center gap-3">
          <span style="color: var(--accent-emerald);">{{ s.delivered }} {{ t('packages.delivered') }}</span>
          <span style="color: var(--accent-cyan);">{{ s.inProgress }} {{ t('packages.inProgress') }}</span>
          <span style="color: var(--text);">{{ s.planned }} / {{ s.quantity }}</span>
        </div>
        <!-- Progress bar -->
        <div class="ml-3 h-1.5 w-20 overflow-hidden rounded-full" style="background: var(--surface-2);">
          <div class="h-full rounded-full" style="background: var(--accent-emerald);"
            :style="{ width: `${Math.min(100, (s.delivered / s.quantity) * 100)}%` }" />
        </div>
      </div>
    </div>
  </div>
</template>
