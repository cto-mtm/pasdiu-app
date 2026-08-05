<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useDataStore } from '../stores/data'
import { useBusy } from '../composables/useBusy'
import { useEntitlements } from '../composables/useEntitlements'
import { clientTitleTransitionName } from '../lib/viewTransitions'
import BaseButton from '../components/BaseButton.vue'
import BaseInput from '../components/BaseInput.vue'
import Modal from '../components/Modal.vue'
import ModalFooter from '../components/ModalFooter.vue'
import MetaEditor from '../components/MetaEditor.vue'
import SegmentedControl from '../components/SegmentedControl.vue'
import StatusCounts from '../components/StatusCounts.vue'
import UpsellModal from '../components/UpsellModal.vue'
import type { MetaField } from '../lib/types'

const { t, d } = useI18n()
const data = useDataStore()
const { clients } = storeToRefs(data)
const { canCreateClient } = useEntitlements()

const view = ref<'grid' | 'list'>('grid')

const showNew = ref(false)
const showUpsell = ref(false)
const name = ref('')
const newMeta = ref<MetaField[]>([])
const { busy, run } = useBusy()

// Entitlement pre-check: at the client limit, the upsell replaces the create
// modal (rules would deny the write anyway — this is the friendly layer).
function openNew() {
  if (!canCreateClient.value) {
    showUpsell.value = true
    return
  }
  showNew.value = true
}

async function create() {
  if (!name.value.trim()) return
  await run(async () => {
    await data.createClient(
      name.value.trim(),
      newMeta.value.filter((f) => f.label.trim() || f.value.trim()),
    )
    showNew.value = false
    name.value = ''
    newMeta.value = []
  })
}

const clientProjects = (id: string) => data.projects.filter((p) => p.clientId === id)
const clientTasks = (id: string) => data.tasks.filter((tk) => tk.clientId === id)

// Blocked work surfaces here so documented reasons actually get acted on —
// oldest blockage first.
const blockedTasks = computed(() =>
  data.tasks
    .filter((tk) => tk.status === 'blocked')
    .sort((a, b) => (a.blockedAt?.getTime() ?? 0) - (b.blockedAt?.getTime() ?? 0)),
)

// Revision loops get the same treatment as blockages: a client sending work
// back is the signal the agency reacts to (README finding 1 territory), and
// 'revisions' is deliberately NOT 'blocked' — it's actionable work, so it
// gets its own strip instead of polluting the impediment list. Soonest due
// first.
const revisionTasks = computed(() =>
  data.tasks
    .filter((tk) => tk.status === 'revisions')
    .sort((a, b) => (a.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER)),
)

// The client's most recent note from each affected deliverable's thread —
// the "what do they actually want changed" preview, so a manager can triage
// without opening every task. Keyed by deliverableId; fetched only for the
// deliverables actually in the strip.
const revisionNotes = ref<Record<string, string>>({})
watch(
  () => [...new Set(revisionTasks.value.map((tk) => tk.deliverableId).filter(Boolean))].sort().join(','),
  async () => {
    const ids = [...new Set(revisionTasks.value.map((tk) => tk.deliverableId).filter(Boolean))]
    const entries = await Promise.all(ids.map(async (id) => {
      try {
        const thread = await data.loadDeliverableNotes(id)
        const clientNote = [...thread].reverse().find((n) => data.usersById[n.authorUid]?.role === 'client')
        return [id, clientNote?.body ?? ''] as const
      } catch {
        return [id, ''] as const
      }
    }))
    revisionNotes.value = Object.fromEntries(entries)
  },
  { immediate: true },
)
const taskContext = (clientId: string, projectId: string) =>
  [data.getClient(clientId)?.name, data.getProject(projectId)?.name].filter(Boolean).join(' · ')

// loadWorkspace attaches live listeners — after the first snapshot the page
// stays current on its own, so there is no refresh control here any more.
// On error the listeners are cleaned up, so calling load() again re-attaches.
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
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold tracking-tight" style="color: var(--text);">{{ t('dashboard.title') }}</h1>
        <p class="mt-1 text-sm" style="color: var(--text-muted);">{{ t('dashboard.subtitle') }}</p>
      </div>
      <div class="flex items-center gap-2">
        <SegmentedControl
          v-model="view"
          :options="[
            { value: 'grid', label: t('dashboard.grid'), icon: 'grid' },
            { value: 'list', label: t('dashboard.list'), icon: 'list' },
          ]"
        />
        <BaseButton @click="openNew">+ {{ t('actions.newClient') }}</BaseButton>
      </div>
    </div>

    <div v-if="loadError" class="mt-8">
      <p class="text-sm" style="color: var(--text-muted);">{{ t('common.loadError') }}</p>
      <BaseButton class="mt-3" @click="load">{{ t('common.retry') }}</BaseButton>
    </div>

    <template v-else>
      <!-- Blocked tasks — only rendered when something is actually stuck,
           oldest blockage first, so documented reasons get acted on. -->
      <div v-if="blockedTasks.length" class="mt-6">
        <h2 class="text-sm font-semibold uppercase tracking-wide" style="color: var(--status-blocked);">
          {{ t('dashboard.blockedTitle') }}
        </h2>
        <div class="mt-2 divide-y overflow-hidden rounded-xl border" style="border-color: var(--border);">
          <RouterLink
            v-for="tk in blockedTasks"
            :key="tk.id"
            :to="{ name: 'task', params: { taskId: tk.id } }"
            class="flex flex-wrap items-center justify-between gap-2 px-4 py-3 transition-colors hover:bg-[color:var(--surface-2)]"
            style="background: var(--surface);"
          >
            <div class="min-w-0">
              <p class="text-sm font-medium" style="color: var(--text);">{{ tk.title }}</p>
              <p class="text-xs" style="color: var(--text-muted);">{{ taskContext(tk.clientId, tk.projectId) }}</p>
              <p v-if="tk.blockedReason" class="mt-1 text-xs" style="color: var(--status-blocked);">{{ tk.blockedReason }}</p>
            </div>
            <span v-if="tk.blockedAt" class="shrink-0 text-xs" style="color: var(--text-muted);">
              {{ t('dashboard.blockedSince', { date: d(tk.blockedAt, 'short') }) }}
            </span>
          </RouterLink>
        </div>
      </div>

      <!-- Revision loops — work clients sent back, with their reason inline -->
      <div v-if="revisionTasks.length" class="mt-6">
        <h2 class="text-sm font-semibold uppercase tracking-wide" style="color: var(--accent-amber);">
          {{ t('dashboard.revisionsTitle') }}
        </h2>
        <div class="mt-2 divide-y overflow-hidden rounded-xl border" style="border-color: var(--border);">
          <RouterLink
            v-for="tk in revisionTasks"
            :key="tk.id"
            :to="{ name: 'task', params: { taskId: tk.id } }"
            class="flex flex-wrap items-center justify-between gap-2 px-4 py-3 transition-colors hover:bg-[color:var(--surface-2)]"
            style="background: var(--surface);"
          >
            <div class="min-w-0">
              <p class="text-sm font-medium" style="color: var(--text);">{{ tk.title }}</p>
              <p class="text-xs" style="color: var(--text-muted);">{{ taskContext(tk.clientId, tk.projectId) }}</p>
              <p v-if="revisionNotes[tk.deliverableId]" class="mt-1 truncate text-xs" style="color: var(--accent-amber);">
                “{{ revisionNotes[tk.deliverableId] }}”
              </p>
            </div>
            <span v-if="tk.dueAt" class="shrink-0 text-xs" style="color: var(--text-muted);">
              {{ d(tk.dueAt, 'short') }}
            </span>
          </RouterLink>
        </div>
      </div>

      <p v-if="!clients.length" class="mt-8 text-sm" style="color: var(--text-muted);">{{ t('dashboard.empty') }}</p>

    <!-- GRID -->
    <div v-else-if="view === 'grid'" class="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <RouterLink
        v-for="c in clients"
        :key="c.id"
        :to="{ name: 'client', params: { clientId: c.id } }"
        class="block rounded-xl border p-4 transition-transform hover:-translate-y-0.5"
        style="background: var(--surface); border-color: var(--border);"
      >
        <h3 class="text-base font-semibold" style="color: var(--text);" :style="{ viewTransitionName: clientTitleTransitionName(c.id) }">
          {{ c.name }}
        </h3>
        <p class="mt-1 text-xs" style="color: var(--text-muted);">
          {{ clientProjects(c.id).length }} {{ t('dashboard.projectsLabel') }}
        </p>
        <div class="mt-3">
          <StatusCounts :tasks="clientTasks(c.id)" />
        </div>
      </RouterLink>
    </div>

    <!-- LIST -->
    <div v-else class="mt-6 divide-y overflow-hidden rounded-xl border" style="border-color: var(--border);">
      <RouterLink
        v-for="c in clients"
        :key="c.id"
        :to="{ name: 'client', params: { clientId: c.id } }"
        class="flex flex-wrap items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-[color:var(--surface-2)]"
        style="background: var(--surface);"
      >
        <div>
          <p class="text-sm font-medium" style="color: var(--text);" :style="{ viewTransitionName: clientTitleTransitionName(c.id) }">{{ c.name }}</p>
          <p class="text-xs" style="color: var(--text-muted);">{{ clientProjects(c.id).length }} {{ t('dashboard.projectsLabel') }}</p>
        </div>
        <StatusCounts :tasks="clientTasks(c.id)" />
      </RouterLink>
    </div>
    </template>

    <Modal :open="showNew" :title="t('actions.newClient')" @close="showNew = false">
      <form class="space-y-4" @submit.prevent="create">
        <label class="block">
          <span class="mb-1 block text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('actions.nameLabel') }}</span>
          <BaseInput v-model="name" autofocus />
        </label>
        <div>
          <span class="mb-1 block text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('actions.metadata') }}</span>
          <MetaEditor
            v-model="newMeta"
            :suggestions="[t('meta.contact'), t('meta.email'), t('meta.phone'), t('meta.billing'), t('meta.driveFolder'), t('meta.sopLink')]"
          />
        </div>
        <ModalFooter :label="t('actions.create')" :busy="busy" @cancel="showNew = false" @submit="create" />
      </form>
    </Modal>

    <UpsellModal :open="showUpsell" reason="clients" @close="showUpsell = false" />
  </section>
</template>
