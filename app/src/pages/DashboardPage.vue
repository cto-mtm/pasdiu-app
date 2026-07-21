<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
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
const taskContext = (clientId: string, projectId: string) =>
  [data.getClient(clientId)?.name, data.getProject(projectId)?.name].filter(Boolean).join(' · ')

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
