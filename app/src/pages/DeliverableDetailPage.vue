<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useDataStore } from '../stores/data'
import { useAuthStore } from '../stores/auth'
import { useBusy } from '../composables/useBusy'
import { mapTask, mapDeliverable } from '../lib/mappers'
import { currentStage } from '../lib/deliverableStage'
import { statusColor, statusKey } from '../lib/status'
import type { Deliverable, Task, Version, Note, MetaField } from '../lib/types'
import Breadcrumbs from '../components/Breadcrumbs.vue'
import BaseButton from '../components/BaseButton.vue'
import BaseInput from '../components/BaseInput.vue'
import Modal from '../components/Modal.vue'
import ModalFooter from '../components/ModalFooter.vue'
import MetaEditor from '../components/MetaEditor.vue'

const { t } = useI18n()
const route = useRoute()
const data = useDataStore()
const auth = useAuthStore()
const { busy, run } = useBusy()

const deliverableId = computed(() => String(route.params.deliverableId))
const deliverable = ref<Deliverable | undefined>()
const stageTasks = ref<Task[]>([])
const versions = ref<Version[]>([])
const notes = ref<Note[]>([])
const loadError = ref(false)
const loaded = ref(false)

// Accordion: tracks which stage ids are expanded.
const expandedStages = ref<Set<string>>(new Set())
function toggleStage(stageId: string) {
  if (expandedStages.value.has(stageId)) {
    expandedStages.value.delete(stageId)
  } else {
    expandedStages.value.add(stageId)
  }
}

// Edit deliverable modal state.
const showEdit = ref(false)
const editName = ref('')
const editMeta = ref<MetaField[]>([])

function openEdit() {
  if (!deliverable.value) return
  editName.value = deliverable.value.name
  editMeta.value = deliverable.value.meta.map((f) => ({ ...f }))
  showEdit.value = true
}
async function saveEdit() {
  if (!editName.value.trim() || !deliverable.value) return
  await run(async () => {
    const patch = {
      name: editName.value.trim(),
      meta: editMeta.value.filter((f) => f.label.trim() || f.value.trim()),
    }
    await data.updateDeliverable(deliverableId.value, patch)
    deliverable.value = { ...deliverable.value!, ...patch }
    showEdit.value = false
  })
}

const project = computed(() => deliverable.value ? data.getProject(deliverable.value.projectId) : undefined)
const client = computed(() => deliverable.value ? data.getClient(deliverable.value.clientId) : undefined)

const stageProgress = computed(() => {
  if (!deliverable.value) return null
  return currentStage(deliverable.value, stageTasks.value)
})

// Map stage id → task for O(1) lookup in the template.
const stageTaskMap = computed(() => {
  const map = new Map<string, Task>()
  for (const t of stageTasks.value) {
    if (t.stageId) map.set(t.stageId, t)
  }
  return map
})

function taskForStage(stageId: string): Task | undefined {
  return stageTaskMap.value.get(stageId)
}

async function load() {
  loadError.value = false
  try {
    await data.loadUsers()
    await data.loadClients()

    // Load the deliverable doc.
    const { getDoc, doc: docRef } = await import('firebase/firestore')
    const delSnap = await getDoc(docRef(db, 'deliverables', deliverableId.value))
    if (!delSnap.exists()) {
      loaded.value = true
      return
    }
    deliverable.value = mapDeliverable(delSnap.id, delSnap.data())

    // Load tasks for this deliverable.
    // The orgId filter is REQUIRED — Firestore rules gate reads on
    // resource.data.orgId, so a query without it gets rejected wholesale.
    const taskSnap = await getDocs(
      query(
        collection(db, 'tasks'),
        where('orgId', '==', deliverable.value.orgId),
        where('deliverableId', '==', deliverableId.value),
      )
    )
    stageTasks.value = taskSnap.docs.map((d) => mapTask(d.id, d.data()))

    // Load versions and notes from deliverable subcollection.
    const vSnap = await getDocs(collection(db, 'deliverables', deliverableId.value, 'versions'))
    versions.value = vSnap.docs
      .map((d) => ({ id: d.id, ...d.data() } as Version))
      .sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0))

    const nSnap = await getDocs(collection(db, 'deliverables', deliverableId.value, 'notes'))
    notes.value = nSnap.docs
      .map((d) => ({ id: d.id, ...d.data() } as Note))
      .sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0))

    // Load project for breadcrumbs.
    if (deliverable.value.projectId) {
      await data.loadProject(deliverable.value.projectId)
    }
    loaded.value = true
  } catch {
    loadError.value = true
  }
}

onMounted(load)
</script>

<template>
  <section v-if="deliverable">
    <Breadcrumbs
      class="mb-4"
      :items="[
        { label: t('dashboard.title'), to: { name: 'dashboard' } },
        { label: client?.name ?? '…', to: client ? { name: 'client', params: { clientId: client.id } } : undefined },
        { label: project?.name ?? '…', to: project ? { name: 'project', params: { projectId: project.id } } : undefined },
        { label: deliverable.name },
      ]"
    />

    <div class="flex flex-wrap items-center justify-between gap-3">
      <h1
        class="text-2xl font-bold tracking-tight"
        style="color: var(--text);"
        :style="{ viewTransitionName: `deliverable-title-${deliverable.id}` }"
      >
        {{ deliverable.name }}
      </h1>
      <div class="flex items-center gap-2">
        <span class="rounded px-2 py-0.5 text-xs font-medium" style="background: var(--surface-2); color: var(--text-muted);">
          {{ deliverable.status }}
        </span>
        <button
          v-if="auth.isManager"
          class="rounded-lg border px-3 py-1.5 text-sm transition-colors hover:bg-[color:var(--surface-2)]"
          style="background: var(--surface-2); color: var(--text); border-color: var(--border);"
          @click="openEdit"
        >
          {{ t('deliverableDetail.edit') }}
        </button>
      </div>
    </div>

    <!-- Stage progress -->
    <div class="mt-4">
      <p v-if="stageProgress && !stageProgress.complete" class="text-sm" style="color: var(--text-muted);">
        {{ t('deliverableDetail.currentStage', { name: stageProgress.stage?.name, n: stageProgress.index + 1, total: deliverable.stages.length }) }}
      </p>
      <p v-else-if="stageProgress?.complete" class="text-sm" style="color: var(--accent-emerald);">
        {{ t('deliverableDetail.complete') }}
      </p>

      <!-- Stage pipeline visualization -->
      <div class="mt-3 flex flex-wrap gap-2">
        <component
          :is="taskForStage(stage.id) ? 'RouterLink' : 'span'"
          v-for="(stage, i) in deliverable.stages"
          :key="stage.id"
          v-bind="taskForStage(stage.id) ? { to: { name: 'task', params: { taskId: taskForStage(stage.id)!.id } } } : {}"
          class="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors"
          :class="{ 'cursor-pointer': taskForStage(stage.id) }"
          :style="{
            background: stageProgress && stageProgress.index === i ? 'var(--accent-cyan)' : 'var(--surface-2)',
            color: stageProgress && stageProgress.index === i ? '#000' : 'var(--text)',
            borderColor: 'var(--border)',
          }"
        >
          <span class="h-2 w-2 rounded-full" :style="{ background: taskForStage(stage.id) ? statusColor(taskForStage(stage.id)!.status) : 'var(--text-muted)' }" />
          {{ stage.name }}
        </component>
      </div>
    </div>

    <!-- Metadata -->
    <dl v-if="deliverable.meta.length" class="mt-4 flex flex-wrap gap-x-8 gap-y-2">
      <div v-for="(f, i) in deliverable.meta" :key="i">
        <dt class="text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ f.label }}</dt>
        <dd class="text-sm" style="color: var(--text);">{{ f.value }}</dd>
      </div>
    </dl>
    <button
      v-else-if="auth.isManager"
      class="mt-4 text-sm transition-colors hover:underline"
      style="color: var(--text-muted);"
      @click="openEdit"
    >
      + {{ t('deliverableDetail.addMeta') }}
    </button>

    <!-- Versions timeline -->
    <div v-if="versions.length" class="mt-6">
      <h2 class="text-sm font-semibold uppercase tracking-wide" style="color: var(--text-muted);">{{ t('deliverableDetail.versions') }}</h2>
      <div class="mt-2 space-y-2">
        <div v-for="v in versions" :key="v.id" class="rounded-lg border p-3" style="background: var(--surface-2); border-color: var(--border);">
          <div class="flex items-center justify-between">
            <span class="text-sm font-medium" style="color: var(--text);">{{ v.label }}</span>
            <span class="text-xs" style="color: var(--text-muted);">{{ v.createdAt?.toLocaleDateString() }}</span>
          </div>
          <p v-if="v.note" class="mt-1 text-xs" style="color: var(--text-muted);">{{ v.note }}</p>
        </div>
      </div>
    </div>

    <!-- Notes thread -->
    <div v-if="notes.length" class="mt-6">
      <h2 class="text-sm font-semibold uppercase tracking-wide" style="color: var(--text-muted);">{{ t('deliverableDetail.notes') }}</h2>
      <div class="mt-2 space-y-2">
        <div v-for="n in notes" :key="n.id" class="rounded-lg border p-3" style="background: var(--surface); border-color: var(--border);">
          <div class="flex items-center justify-between">
            <span class="text-sm font-medium" style="color: var(--text);">{{ data.userName(n.authorUid) }}</span>
            <span class="text-xs" style="color: var(--text-muted);">{{ n.createdAt?.toLocaleDateString() }}</span>
          </div>
          <p class="mt-1 text-sm" style="color: var(--text);">{{ n.body }}</p>
        </div>
      </div>
    </div>

    <!-- Stage tasks accordion -->
    <div class="mt-6">
      <h2 class="text-sm font-semibold uppercase tracking-wide" style="color: var(--text-muted);">{{ t('deliverableDetail.stageTasks') }}</h2>
      <div class="mt-2 divide-y" style="border-color: var(--border);">
        <div v-for="stage in deliverable.stages" :key="stage.id" class="border rounded-lg mb-1" style="border-color: var(--border);">
          <!-- Accordion header -->
          <button
            class="flex w-full items-center justify-between px-3 py-3 text-sm transition-colors hover:bg-[color:var(--surface-2)]"
            :class="{ 'rounded-lg': !expandedStages.has(stage.id), 'rounded-t-lg': expandedStages.has(stage.id) }"
            @click="toggleStage(stage.id)"
          >
            <div class="flex items-center gap-2">
              <span
                class="inline-flex h-5 w-5 items-center justify-center text-xs transition-transform"
                :class="{ 'rotate-90': expandedStages.has(stage.id) }"
                style="color: var(--text-muted);"
              >&#9654;</span>
              <span class="h-2 w-2 rounded-full" :style="{ background: taskForStage(stage.id) ? statusColor(taskForStage(stage.id)!.status) : 'var(--text-muted)' }" />
              <span style="color: var(--text);" class="font-medium">{{ stage.name }}</span>
            </div>
            <div class="flex items-center gap-2">
              <span v-if="taskForStage(stage.id)" class="rounded px-1.5 py-0.5 text-xs"
                :style="{ background: statusColor(taskForStage(stage.id)!.status), color: '#000' }">
                {{ t(statusKey(taskForStage(stage.id)!.status)) }}
              </span>
              <span v-else class="text-xs" style="color: var(--text-muted);">
                {{ t('deliverableDetail.noTask') }}
              </span>
            </div>
          </button>

          <!-- Accordion panel (expanded) -->
          <div
            v-if="expandedStages.has(stage.id) && taskForStage(stage.id)"
            class="rounded-b-lg border-t px-4 py-3"
            style="background: var(--surface-2); border-color: var(--border);"
          >
            <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
              <div>
                <dt class="text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('deliverableDetail.assignee') }}</dt>
                <dd style="color: var(--text);">{{ data.userName(taskForStage(stage.id)!.assigneeUid) || '—' }}</dd>
              </div>
              <div>
                <dt class="text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('deliverableDetail.status') }}</dt>
                <dd>
                  <span class="inline-block rounded px-1.5 py-0.5 text-xs"
                    :style="{ background: statusColor(taskForStage(stage.id)!.status), color: '#000' }">
                    {{ t(statusKey(taskForStage(stage.id)!.status)) }}
                  </span>
                </dd>
              </div>
              <div>
                <dt class="text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('deliverableDetail.dueDate') }}</dt>
                <dd style="color: var(--text);">{{ taskForStage(stage.id)!.dueAt?.toLocaleDateString() || '—' }}</dd>
              </div>
            </dl>
            <p v-if="taskForStage(stage.id)!.description" class="mt-2 text-sm" style="color: var(--text-muted);">
              {{ taskForStage(stage.id)!.description }}
            </p>
            <RouterLink
              :to="{ name: 'task', params: { taskId: taskForStage(stage.id)!.id } }"
              class="mt-3 inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors hover:bg-[color:var(--surface)]"
              style="color: var(--accent-cyan);"
            >
              {{ t('deliverableDetail.viewTask') }} →
            </RouterLink>
          </div>

          <!-- No task panel -->
          <div
            v-else-if="expandedStages.has(stage.id) && !taskForStage(stage.id)"
            class="rounded-b-lg border-t px-4 py-3"
            style="background: var(--surface-2); border-color: var(--border);"
          >
            <p class="text-sm" style="color: var(--text-muted);">{{ t('deliverableDetail.noTaskYet') }}</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Edit deliverable modal -->
    <Modal :open="showEdit" :title="t('deliverableDetail.editTitle')" @close="showEdit = false">
      <form class="space-y-4" @submit.prevent="saveEdit">
        <label class="block">
          <span class="mb-1 block text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('deliverableDetail.nameLabel') }}</span>
          <BaseInput v-model="editName" />
        </label>
        <div>
          <span class="mb-1 block text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('deliverableDetail.metaLabel') }}</span>
          <p class="mb-2 text-xs" style="color: var(--text-muted);">{{ t('deliverableDetail.metaHint') }}</p>
          <MetaEditor
            v-model="editMeta"
            :suggestions="[t('meta.aspectRatio'), t('meta.runtime'), t('meta.format'), t('meta.reference'), t('meta.driveFolder'), t('meta.links')]"
          />
        </div>
        <ModalFooter :label="t('actions.save')" :busy="busy" :disabled="!editName.trim()" @submit="saveEdit" @cancel="showEdit = false" />
      </form>
    </Modal>
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
