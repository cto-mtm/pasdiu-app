<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuthStore } from '../stores/auth'
import { useToastStore } from '../stores/toast'
import { useBusy } from '../composables/useBusy'
import { mapDeliverable } from '../lib/mappers'
import { apiFetch } from '../lib/api'
import { priorityRank } from '../lib/types'
import type { Deliverable } from '../lib/types'
import BaseButton from '../components/BaseButton.vue'
import PriorityBadge from '../components/PriorityBadge.vue'
import Modal from '../components/Modal.vue'
import ModalFooter from '../components/ModalFooter.vue'

const { t } = useI18n()
const auth = useAuthStore()
const toast = useToastStore()
const { busy, run } = useBusy()

const deliverables = ref<Deliverable[]>([])

// Group deliverables by batch (subGroupName). Within a batch, high priority
// comes first — the client's attention should land where the agency needs a
// decision — with batch order as the tiebreak so the list stays stable.
const batches = computed(() => {
  const map = new Map<string, { name: string; items: Deliverable[] }>()
  for (const d of deliverables.value) {
    const key = d.subGroupName || t('portal.ungrouped')
    if (!map.has(key)) map.set(key, { name: key, items: [] })
    map.get(key)!.items.push(d)
  }
  for (const batch of map.values()) {
    batch.items.sort((a, b) => (priorityRank(a.priority) - priorityRank(b.priority)) || a.order - b.order)
  }
  return Array.from(map.values())
})

// Pending review: deliverables not yet approved.
const pendingCount = computed(() => deliverables.value.filter((d) => d.status === 'active').length)

// Request changes modal state.
const showChanges = ref(false)
const changesDeliverableId = ref('')
const changesNote = ref('')

function openRequestChanges(delId: string) {
  changesDeliverableId.value = delId
  changesNote.value = ''
  showChanges.value = true
}

async function submitRequestChanges() {
  if (!changesNote.value.trim()) return
  await run(async () => {
    const orgId = auth.activeOrgId
    const res = await apiFetch(`/orgs/${orgId}/deliverables/${changesDeliverableId.value}/request-changes`, {
      method: 'POST',
      body: JSON.stringify({ note: changesNote.value.trim() }),
    })
    if (!res.ok) { toast.error(t(res.error.key, res.error.params ?? {})); return }
    toast.success(t('portal.changesRequested'))
    // Reload to reflect status change.
    await load()
    showChanges.value = false
  })
}

async function approve(delId: string) {
  await run(async () => {
    const orgId = auth.activeOrgId
    const res = await apiFetch(`/orgs/${orgId}/deliverables/${delId}/approve`, {
      method: 'POST',
    })
    if (!res.ok) { toast.error(t(res.error.key, res.error.params ?? {})); return }
    toast.success(t('portal.approved'))
    await load()
  })
}

async function bulkApprove(batch: Deliverable[]) {
  const activeIds = batch.filter((d) => d.status === 'active').map((d) => d.id)
  if (!activeIds.length) return
  await run(async () => {
    const orgId = auth.activeOrgId
    const res = await apiFetch(`/orgs/${orgId}/deliverables/bulk-approve`, {
      method: 'POST',
      body: JSON.stringify({ deliverableIds: activeIds }),
    })
    if (!res.ok) { toast.error(t(res.error.key, res.error.params ?? {})); return }
    toast.success(t('portal.bulkApproved', { count: activeIds.length }))
    await load()
  })
}

const loadFailed = ref(false)
async function load() {
  loadFailed.value = false
  const cid = auth.clientId
  const orgId = auth.activeOrgId
  if (!cid || !orgId) {
    auth.transitioning = false
    return
  }
  try {
    // Client-scoped deliverable query (must filter clientId + clientVisible per rules).
    const snap = await getDocs(query(
      collection(db, 'deliverables'),
      where('orgId', '==', orgId),
      where('clientId', '==', cid),
      where('clientVisible', '==', true),
    ))
    deliverables.value = snap.docs.map((d) => mapDeliverable(d.id, d.data()))
  } catch {
    loadFailed.value = true
  }
  auth.transitioning = false
}
onMounted(load)
</script>

<template>
  <section>
    <h1 class="text-2xl font-bold tracking-tight" style="color: var(--text);">{{ t('portal.title') }}</h1>
    <p class="mt-1 text-sm" style="color: var(--text-muted);">
      {{ t('portal.subtitle') }}
      <span v-if="pendingCount" class="ml-2 rounded-full bg-[color:var(--accent-cyan)] px-2 py-0.5 text-xs font-medium" style="color: #000;">
        {{ pendingCount }} {{ t('portal.awaitingReview') }}
      </span>
    </p>

    <div v-if="loadFailed" class="mt-8">
      <p class="text-sm" style="color: var(--accent-amber);">{{ t('common.loadError') }}</p>
      <button class="mt-2 text-sm underline" style="color: var(--accent-cyan);" @click="load">
        {{ t('common.retry') }}
      </button>
    </div>

    <p v-else-if="!batches.length" class="mt-8 text-sm" style="color: var(--text-muted);">{{ t('portal.empty') }}</p>

    <div v-else class="mt-6 space-y-6">
      <div v-for="batch in batches" :key="batch.name">
        <div class="mb-2 flex items-center justify-between">
          <h2 class="text-sm font-semibold uppercase tracking-wide" style="color: var(--text-muted);">{{ batch.name }}</h2>
          <BaseButton
            v-if="batch.items.some(d => d.status === 'active')"
            class="text-xs"
            :disabled="busy"
            @click="bulkApprove(batch.items)"
          >
            {{ t('portal.approveAll') }}
          </BaseButton>
        </div>
        <div class="divide-y overflow-hidden rounded-xl border" style="border-color: var(--border);">
          <div
            v-for="del in batch.items"
            :key="del.id"
            class="flex items-center justify-between px-4 py-3"
            style="background: var(--surface);"
          >
            <!-- The row's identity is a link into the deliverable's detail
                 (stages, cuts, feedback); the approval buttons stay siblings
                 so approving never requires leaving the list. -->
            <RouterLink
              :to="{ name: 'portal-deliverable', params: { deliverableId: del.id } }"
              class="group flex min-w-0 flex-wrap items-center gap-2"
            >
              <span class="text-sm font-medium transition-colors group-hover:underline" style="color: var(--text);">{{ del.name }}</span>
              <PriorityBadge :priority="del.priority" />
              <span v-if="del.approvedVia" class="text-xs" style="color: var(--accent-emerald);">
                ✓ {{ t('portal.approvedLabel') }}
                <template v-if="del.approvedVia === 'in_person'"> ({{ t('portal.onBehalf') }})</template>
              </span>
              <span class="text-xs opacity-0 transition-opacity group-hover:opacity-100" style="color: var(--accent-cyan);">
                {{ t('portal.review') }} →
              </span>
            </RouterLink>
            <div v-if="del.status === 'active'" class="flex items-center gap-2">
              <button
                class="rounded-lg border px-3 py-1.5 text-xs"
                style="background: var(--surface-2); color: var(--text); border-color: var(--border);"
                :disabled="busy"
                @click="openRequestChanges(del.id)"
              >
                {{ t('portal.requestChanges') }}
              </button>
              <BaseButton class="text-xs" :disabled="busy" @click="approve(del.id)">
                {{ t('portal.approve') }}
              </BaseButton>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Request Changes Modal -->
    <Modal :open="showChanges" :title="t('portal.requestChangesTitle')" @close="showChanges = false">
      <form class="space-y-4" @submit.prevent="submitRequestChanges">
        <label class="block">
          <span class="mb-1 block text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('portal.changesNoteLabel') }}</span>
          <textarea
            v-model="changesNote"
            rows="3"
            class="w-full rounded-lg border px-3 py-2 text-sm outline-none"
            style="background: var(--surface-2); color: var(--text); border-color: var(--border);"
            :placeholder="t('portal.changesNotePlaceholder')"
            autofocus
          />
        </label>
        <ModalFooter :label="t('portal.submitChanges')" :busy="busy" @cancel="showChanges = false" @submit="submitRequestChanges" />
      </form>
    </Modal>
  </section>
</template>
