<script setup lang="ts">
// PackageQuota — displays planned / in progress / delivered against quota
// for each line in a project's package. Uses count() aggregation queries
// (never reads deliverable docs) so the whole widget costs ~3 reads.
import { onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { collection, doc, getCountFromServer, getDoc, query, where, Timestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuthStore } from '../stores/auth'
import type { Package, PackageLine } from '../lib/types'

const props = defineProps<{ pkg: Package }>()

const { t } = useI18n()
const auth = useAuthStore()

interface LineStat {
  typeId: string
  typeName: string
  quantity: number
  delivered: number
  inProgress: number
  total: number
}

const stats = ref<LineStat[]>([])
const loading = ref(true)

// Resolve deliverable type id → human name. Cached per session so repeat
// renders (e.g. switching views) don't re-read the same docs.
const typeNameCache = new Map<string, string>()
async function resolveTypeName(typeId: string): Promise<string> {
  if (typeNameCache.has(typeId)) return typeNameCache.get(typeId)!
  try {
    const snap = await getDoc(doc(db, 'deliverableTypes', typeId))
    const name = snap.exists() ? (snap.data().name as string) || typeId : typeId
    typeNameCache.set(typeId, name)
    return name
  } catch {
    typeNameCache.set(typeId, typeId)
    return typeId
  }
}

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

    const [deliveredSnap, activeSnap, typeName] = await Promise.all([
      // Delivered in this period (count() aggregation — 1 read per 1000 docs).
      getCountFromServer(query(
        collection(db, 'deliverables'),
        where('orgId', '==', orgId),
        where('projectId', '==', props.pkg.projectId),
        where('typeId', '==', line.typeId),
        where('status', '==', 'delivered'),
        where('deliveredAt', '>=', startTs),
        where('deliveredAt', '<=', endTs),
      )),
      // In progress (active).
      getCountFromServer(query(
        collection(db, 'deliverables'),
        where('orgId', '==', orgId),
        where('projectId', '==', props.pkg.projectId),
        where('typeId', '==', line.typeId),
        where('status', '==', 'active'),
      )),
      resolveTypeName(line.typeId),
    ])

    const delivered = deliveredSnap.data().count
    const inProgress = activeSnap.data().count

    results.push({
      typeId: line.typeId,
      typeName,
      quantity: line.quantity,
      delivered,
      inProgress,
      total: delivered + inProgress,
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
    <div class="space-y-3">
      <div v-for="s in stats" :key="s.typeId">
        <div class="flex items-center justify-between text-sm">
          <span class="font-medium" style="color: var(--text);">{{ s.typeName }}</span>
          <span style="color: var(--text-muted);">{{ s.total }} / {{ s.quantity }}</span>
        </div>
        <!-- Progress bar -->
        <div class="mt-1.5 flex h-2 w-full overflow-hidden rounded-full" style="background: var(--surface-2);">
          <div
            class="h-full rounded-l-full"
            style="background: var(--accent-emerald);"
            :style="{ width: `${Math.min(100, (s.delivered / s.quantity) * 100)}%` }"
          />
          <div
            class="h-full"
            style="background: var(--accent-cyan);"
            :style="{ width: `${Math.min(100 - (s.delivered / s.quantity) * 100, (s.inProgress / s.quantity) * 100)}%` }"
          />
        </div>
        <div class="mt-1 flex items-center gap-4 text-xs" style="color: var(--text-muted);">
          <span class="flex items-center gap-1">
            <span class="inline-block h-2 w-2 rounded-full" style="background: var(--accent-emerald);" />
            {{ s.delivered }} {{ t('packages.delivered') }}
          </span>
          <span class="flex items-center gap-1">
            <span class="inline-block h-2 w-2 rounded-full" style="background: var(--accent-cyan);" />
            {{ s.inProgress }} {{ t('packages.inProgress') }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
