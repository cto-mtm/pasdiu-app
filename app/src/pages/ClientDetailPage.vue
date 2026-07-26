<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useDataStore } from '../stores/data'
import { useBusy } from '../composables/useBusy'
import { clientTitleTransitionName } from '../lib/viewTransitions'
import Breadcrumbs from '../components/Breadcrumbs.vue'
import BaseButton from '../components/BaseButton.vue'
import BaseInput from '../components/BaseInput.vue'
import BaseSelect from '../components/BaseSelect.vue'
import Modal from '../components/Modal.vue'
import ModalFooter from '../components/ModalFooter.vue'
import MetaEditor from '../components/MetaEditor.vue'
import StatusCounts from '../components/StatusCounts.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import InfoTip from '../components/InfoTip.vue'
import type { MetaField } from '../lib/types'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const data = useDataStore()

const clientId = computed(() => String(route.params.clientId))
const client = computed(() => data.getClient(clientId.value))
const projects = computed(() => data.projects.filter((p) => p.clientId === clientId.value))

const { busy, run } = useBusy()

// Create project
const showNew = ref(false)
const name = ref('')
const view = ref<'kanban' | 'list'>('kanban')

async function create() {
  if (!name.value.trim()) return
  await run(async () => {
    await data.createProject(clientId.value, name.value.trim(), view.value)
    showNew.value = false
    name.value = ''
    view.value = 'kanban'
  })
}

// Edit client (name, metadata)
const showEdit = ref(false)
const editName = ref('')
const editMeta = ref<MetaField[]>([])

function openEdit() {
  if (!client.value) return
  editName.value = client.value.name
  editMeta.value = client.value.meta.map((f) => ({ ...f }))
  showEdit.value = true
}
async function saveEdit() {
  if (!editName.value.trim()) return
  await run(async () => {
    await data.updateClient(clientId.value, {
      name: editName.value.trim(),
      meta: editMeta.value.filter((f) => f.label.trim() || f.value.trim()),
    })
    showEdit.value = false
  })
}

const showDelete = ref(false)
async function confirmDelete() {
  await data.deleteClient(clientId.value)
  showDelete.value = false
  router.push({ name: 'dashboard' })
}

// Per-project task counts
const projectTasks = (projectId: string) => data.tasks.filter((tk) => tk.projectId === projectId)

const loadError = ref(false)
const loaded = ref(false)
async function load() {
  loadError.value = false
  try {
    await Promise.all([data.loadClients(), data.loadProjectsForClient(clientId.value), data.loadAllTasksForClient(clientId.value)])
    loaded.value = true
  } catch {
    loadError.value = true
  }
}
onMounted(load)
</script>

<template>
  <section v-if="client">
    <Breadcrumbs
      class="mb-4"
      :items="[
        { label: t('dashboard.title'), to: { name: 'dashboard' } },
        { label: client.name },
      ]"
    />

    <div class="mt-1 flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-2xl font-bold tracking-tight" style="color: var(--text);" :style="{ viewTransitionName: clientTitleTransitionName(client.id) }">
        {{ client.name }}
      </h1>
      <div class="flex items-center gap-2">
        <button
          class="rounded-lg border px-3 py-2 text-sm"
          style="background: var(--surface-2); color: var(--text); border-color: var(--border);"
          @click="openEdit"
        >
          {{ t('actions.edit') }}
        </button>
        <BaseButton @click="showNew = true">+ {{ t('actions.newProject') }}</BaseButton>
      </div>
    </div>

    <!-- Client metadata -->
    <dl v-if="client.meta.length" class="mt-4 flex flex-wrap gap-x-8 gap-y-2">
      <div v-for="(f, i) in client.meta" :key="i">
        <dt class="text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ f.label }}</dt>
        <dd class="text-sm" style="color: var(--text);">{{ f.value }}</dd>
      </div>
    </dl>

    <p class="mt-6 text-sm" style="color: var(--text-muted);">{{ t('client.projects') }}</p>

    <div class="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
      <RouterLink
        v-for="p in projects"
        :key="p.id"
        :to="{ name: 'project', params: { projectId: p.id } }"
        class="block rounded-xl border p-4 transition-transform hover:-translate-y-0.5"
        style="background: var(--surface); border-color: var(--border);"
      >
        <div class="flex items-center justify-between">
          <h3 class="text-base font-semibold" style="color: var(--text);">{{ p.name }}</h3>
          <span class="rounded px-2 py-0.5 text-xs" style="background: var(--surface-2); color: var(--text-muted);">
            {{ t('board.view' + (p.defaultView === 'kanban' ? 'Kanban' : 'List')) }}
          </span>
        </div>
        <div class="mt-3">
          <StatusCounts :tasks="projectTasks(p.id)" />
        </div>
      </RouterLink>
    </div>

    <Modal :open="showNew" :title="t('actions.newProject')" @close="showNew = false">
      <form class="space-y-4" @submit.prevent="create">
        <label class="block">
          <span class="mb-1 flex items-center gap-1 text-xs uppercase tracking-wide" style="color: var(--text-muted);">
            {{ t('actions.nameLabel') }}
            <InfoTip :text="t('client.projectExplainer')" />
          </span>
          <BaseInput v-model="name" autofocus :placeholder="t('client.projectPlaceholder')" />
        </label>
        <label class="block">
          <span class="mb-1 block text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('actions.viewLabel') }}</span>
          <BaseSelect v-model="view">
            <option value="kanban">{{ t('board.viewKanban') }}</option>
            <option value="list">{{ t('board.viewList') }}</option>
          </BaseSelect>
        </label>
        <ModalFooter :label="t('actions.create')" :busy="busy" @cancel="showNew = false" @submit="create" />
      </form>
    </Modal>

    <Modal :open="showEdit" :title="t('actions.editClient')" @close="showEdit = false">
      <form class="space-y-4" @submit.prevent="saveEdit">
        <label class="block">
          <span class="mb-1 block text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('actions.nameLabel') }}</span>
          <BaseInput v-model="editName" />
        </label>
        <div>
          <span class="mb-1 block text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('actions.metadata') }}</span>
          <MetaEditor
            v-model="editMeta"
            :suggestions="[t('meta.contact'), t('meta.email'), t('meta.phone'), t('meta.billing'), t('meta.driveFolder'), t('meta.sopLink')]"
          />
        </div>
        <div class="flex items-end justify-between gap-2">
          <button type="button" class="rounded-lg px-3 py-2 text-sm" style="color: var(--accent-amber);" @click="showEdit = false; showDelete = true">
            {{ t('actions.deleteClient') }}
          </button>
          <ModalFooter :label="t('actions.save')" :busy="busy" @cancel="showEdit = false" @submit="saveEdit" />
        </div>
      </form>
    </Modal>

    <ConfirmDialog
      :open="showDelete"
      danger
      :title="t('actions.deleteClient')"
      :message="t('actions.deleteClientConfirm', { name: client.name })"
      :confirm-label="t('actions.delete')"
      @confirm="confirmDelete"
      @cancel="showDelete = false"
    />
  </section>

  <section v-else-if="loadError">
    <p class="text-sm" style="color: var(--text-muted);">{{ t('common.loadError') }}</p>
    <BaseButton class="mt-3" @click="load">{{ t('common.retry') }}</BaseButton>
  </section>

  <section v-else-if="loaded">
    <p style="color: var(--text-muted);">{{ t('common.notFound') }}</p>
  </section>

  <section v-else>
    <p style="color: var(--text-muted);">{{ t('common.loading') }}</p>
  </section>
</template>
