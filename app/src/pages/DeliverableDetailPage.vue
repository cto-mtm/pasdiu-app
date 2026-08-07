<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useDataStore } from '../stores/data'
import { useAuthStore } from '../stores/auth'
import { useToastStore } from '../stores/toast'
import { useBusy } from '../composables/useBusy'
import { apiFetch } from '../lib/api'
import { mapTask } from '../lib/mappers'
import { currentStage } from '../lib/deliverableStage'
import { statusColor, statusKey } from '../lib/status'
import { priorityKey } from '../lib/priority'
import { DELIVERABLE_PRIORITIES } from '../lib/types'
import type { DeliverablePriority, Task, Version, Note, MetaField } from '../lib/types'
import Breadcrumbs from '../components/Breadcrumbs.vue'
import BriefDrawer from '../components/BriefDrawer.vue'
import PriorityBadge from '../components/PriorityBadge.vue'
import BaseButton from '../components/BaseButton.vue'
import BaseInput from '../components/BaseInput.vue'
import BaseSelect from '../components/BaseSelect.vue'
import Modal from '../components/Modal.vue'
import ModalFooter from '../components/ModalFooter.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import MetaEditor from '../components/MetaEditor.vue'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const data = useDataStore()
const auth = useAuthStore()
const toast = useToastStore()
const { busy, run } = useBusy()

const deliverableId = computed(() => String(route.params.deliverableId))
// Read the STORE's copy rather than keeping a local one: the brief drawer
// edits deliverable metadata through the store, and a local snapshot would
// stop tracking it after the first edit made here.
const deliverable = computed(() => data.getDeliverable(deliverableId.value))
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

const briefOpen = ref(false)

// Edit deliverable modal state.
const showEdit = ref(false)
const editName = ref('')
const editMeta = ref<MetaField[]>([])
const editPriority = ref<DeliverablePriority>('normal')

function openEdit() {
  if (!deliverable.value) return
  editName.value = deliverable.value.name
  editPriority.value = deliverable.value.priority
  editMeta.value = deliverable.value.meta.map((f) => ({ ...f }))
  showEdit.value = true
}
async function saveEdit() {
  if (!editName.value.trim() || !deliverable.value) return
  await run(async () => {
    const patch = {
      name: editName.value.trim(),
      priority: editPriority.value,
      meta: editMeta.value.filter((f) => f.label.trim() || f.value.trim()),
    }
    // updateDeliverable patches the store copy, which `deliverable` reads.
    await data.updateDeliverable(deliverableId.value, patch)
    showEdit.value = false
  })
}

// Delete deliverable (managers). The server cascades to its stage tasks; on
// success the store prunes both, so we leave for the project board rather than
// render a now-missing deliverable. Capture the projectId BEFORE deleting —
// `deliverable` reads the store copy, which is gone the moment it succeeds.
const showDelete = ref(false)
async function confirmDelete() {
  const projectId = deliverable.value?.projectId
  await run(async () => {
    const ok = await data.deleteDeliverable(deliverableId.value)
    if (!ok) {
      toast.error(t('common.saveError'))
      return
    }
    showDelete.value = false
    if (projectId) await router.replace({ name: 'project', params: { projectId } })
    else router.back()
  })
}

const project = computed(() => deliverable.value ? data.getProject(deliverable.value.projectId) : undefined)
const client = computed(() => deliverable.value ? data.getClient(deliverable.value.clientId) : undefined)

const stageProgress = computed(() => {
  if (!deliverable.value) return null
  return currentStage(deliverable.value, stageTasks.value)
})

// Managers can mark a deliverable as delivered (proxy approval) when all
// stages are done but the deliverable is still active.
const canMarkDelivered = computed(() =>
  auth.isManager
  && deliverable.value?.status === 'active'
  && stageProgress.value?.complete,
)
const showApproveModal = ref(false)
const approveNote = ref('')
const approveVia = ref<'in_person' | 'external'>('in_person')

function openApproveModal() {
  approveNote.value = ''
  approveVia.value = 'in_person'
  showApproveModal.value = true
}

async function confirmMarkDelivered() {
  if (!approveNote.value.trim()) return
  await run(async () => {
    const orgId = auth.activeOrgId
    const res = await apiFetch(`/orgs/${orgId}/deliverables/${deliverableId.value}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: approveNote.value.trim(), via: approveVia.value }),
    })
    if (res.ok) {
      toast.success(t('deliverableDetail.markedDelivered'))
      showApproveModal.value = false
      // Reload to reflect the status change.
      await load()
    } else {
      toast.error(t('common.saveError'))
    }
  })
}

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

    // Load the deliverable doc. Via the store so the brief drawer (and anything
    // else on the page) reads the same copy instead of fetching its own.
    const del = await data.loadDeliverable(deliverableId.value)
    if (!del) {
      loaded.value = true
      return
    }

    // Load tasks for this deliverable.
    // The orgId filter is REQUIRED — Firestore rules gate reads on
    // resource.data.orgId, so a query without it gets rejected wholesale.
    const taskSnap = await getDocs(
      query(
        collection(db, 'tasks'),
        where('orgId', '==', del.orgId),
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
    if (del.projectId) {
      await data.loadProject(del.projectId)
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
        <PriorityBadge :priority="deliverable.priority" always />
        <span class="rounded px-2 py-0.5 text-xs font-medium" style="background: var(--surface-2); color: var(--text-muted);">
          {{ deliverable.status }}
        </span>
        <button
          class="rounded-lg border px-3 py-1.5 text-sm transition-colors hover:bg-[color:var(--surface-2)]"
          style="background: var(--surface-2); color: var(--text); border-color: var(--border);"
          @click="briefOpen = true"
        >
          {{ t('brief.open') }}
        </button>
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
      <div v-else-if="stageProgress?.complete" class="flex flex-wrap items-center gap-3">
        <p class="text-sm" style="color: var(--accent-emerald);">
          {{ t('deliverableDetail.complete') }}
        </p>
        <BaseButton
          v-if="canMarkDelivered"
          :disabled="busy"
          @click="openApproveModal"
        >
          {{ t('deliverableDetail.markDelivered') }}
        </BaseButton>
      </div>
      <p v-if="deliverable.status === 'delivered'" class="mt-1 text-sm" style="color: var(--accent-emerald);">
        {{ t('deliverableDetail.deliveredLabel') }}
        <span v-if="deliverable.approvedBy" style="color: var(--text-muted);">
          — {{ data.userName(deliverable.approvedBy) }}
        </span>
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

    <BriefDrawer
      :open="briefOpen"
      :client-id="deliverable.clientId"
      :project-id="deliverable.projectId"
      :sub-group-id="deliverable.subGroupId || null"
      :deliverable-id="deliverable.id"
      @close="briefOpen = false"
    />

    <!-- Edit deliverable modal -->
    <Modal :open="showEdit" :title="t('deliverableDetail.editTitle')" @close="showEdit = false">
      <form class="space-y-4" @submit.prevent="saveEdit">
        <label class="block">
          <span class="mb-1 block text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('deliverableDetail.nameLabel') }}</span>
          <BaseInput v-model="editName" />
        </label>
        <label class="block">
          <span class="mb-1 block text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('deliverableDetail.priorityLabel') }}</span>
          <BaseSelect v-model="editPriority">
            <option v-for="p in DELIVERABLE_PRIORITIES" :key="p" :value="p">{{ t(priorityKey(p)) }}</option>
          </BaseSelect>
        </label>
        <div>
          <span class="mb-1 block text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('deliverableDetail.metaLabel') }}</span>
          <p class="mb-2 text-xs" style="color: var(--text-muted);">{{ t('deliverableDetail.metaHint') }}</p>
          <MetaEditor
            v-model="editMeta"
            :suggestions="[t('meta.aspectRatio'), t('meta.runtime'), t('meta.format'), t('meta.reference'), t('meta.driveFolder'), t('meta.links')]"
          />
        </div>
        <div class="flex items-end justify-between gap-2">
          <!-- Deletes the deliverable AND its stage tasks (server cascade) —
               for the "created the wrong deliverable" case. -->
          <button v-if="auth.isManager" type="button" class="rounded-lg px-3 py-2 text-sm" style="color: var(--accent-amber);" @click="showEdit = false; showDelete = true">
            {{ t('actions.deleteDeliverable') }}
          </button>
          <ModalFooter :label="t('actions.save')" :busy="busy" :disabled="!editName.trim()" @submit="saveEdit" @cancel="showEdit = false" />
        </div>
      </form>
    </Modal>

    <ConfirmDialog
      :open="showDelete"
      danger
      :title="t('actions.deleteDeliverable')"
      :message="t('actions.deleteDeliverableConfirm', { name: deliverable.name })"
      :confirm-label="t('actions.delete')"
      @confirm="confirmDelete"
      @cancel="showDelete = false"
    />

    <!-- Mark as Delivered modal (manager proxy approval) -->
    <Modal :open="showApproveModal" :title="t('deliverableDetail.markDeliveredTitle')" @close="showApproveModal = false">
      <form class="space-y-4" @submit.prevent="confirmMarkDelivered">
        <p class="text-sm" style="color: var(--text-muted);">{{ t('deliverableDetail.markDeliveredHint') }}</p>
        <label class="block">
          <span class="mb-1 block text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('deliverableDetail.approveViaLabel') }}</span>
          <BaseSelect v-model="approveVia">
            <option value="in_person">{{ t('deliverableDetail.viaInPerson') }}</option>
            <option value="external">{{ t('deliverableDetail.viaExternal') }}</option>
          </BaseSelect>
        </label>
        <label class="block">
          <span class="mb-1 block text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('deliverableDetail.approveNoteLabel') }}</span>
          <BaseInput v-model="approveNote" required :placeholder="t('deliverableDetail.approveNotePlaceholder')" />
        </label>
        <ModalFooter :label="t('deliverableDetail.markDelivered')" :busy="busy" :disabled="!approveNote.trim()" @submit="confirmMarkDelivered" @cancel="showApproveModal = false" />
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
