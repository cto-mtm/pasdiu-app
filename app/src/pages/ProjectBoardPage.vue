<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useDataStore } from '../stores/data'
import { useAuthStore } from '../stores/auth'
import { useBusy } from '../composables/useBusy'
import { useEntitlements } from '../composables/useEntitlements'
import type { Project, TaskStatus } from '../lib/types'
import { BOARD_COLUMNS, MANUAL_TASK_STATUSES, statusColor, statusKey, type BoardColumn } from '../lib/status'
import Breadcrumbs from '../components/Breadcrumbs.vue'
import TaskCard from '../components/TaskCard.vue'
import BriefDrawer from '../components/BriefDrawer.vue'
import BaseButton from '../components/BaseButton.vue'
import BaseInput from '../components/BaseInput.vue'
import BaseSelect from '../components/BaseSelect.vue'
import Modal from '../components/Modal.vue'
import ModalFooter from '../components/ModalFooter.vue'
import SegmentedControl from '../components/SegmentedControl.vue'
import StatusCounts from '../components/StatusCounts.vue'
import SubGroupMenu from '../components/SubGroupMenu.vue'
import PriorityBadge from '../components/PriorityBadge.vue'
import InfoTip from '../components/InfoTip.vue'
import OverflowMenu from '../components/OverflowMenu.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import MetaEditor from '../components/MetaEditor.vue'
import UpsellModal from '../components/UpsellModal.vue'
import BatchCreateWizard from '../components/BatchCreateWizard.vue'
import PackageQuota from '../components/PackageQuota.vue'
import type { MetaField, Package } from '../lib/types'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const data = useDataStore()
const auth = useAuthStore()
const { canCreateTask } = useEntitlements()

const projectId = computed(() => String(route.params.projectId))
const project = ref<Project | undefined>()
const view = ref<'kanban' | 'list' | 'deliverables'>('kanban')

// The brief covers client → project → (optionally) one sub-group. Opened from
// the toolbar it shows the project; opened from a sub-group's ⋯ menu it adds
// that sub-group's section, which is the second (and more discoverable) way to
// edit sub-group metadata.
const briefOpen = ref(false)
const briefSubGroupId = ref<string | null>(null)
function openBrief(subGroupId: string | null = null) {
  briefSubGroupId.value = subGroupId
  briefOpen.value = true
}

const { busy, run } = useBusy()

// Edit project (name + default view)
const showEditProject = ref(false)
const epName = ref('')
const epView = ref<'kanban' | 'list' | 'deliverables'>('kanban')
const epMeta = ref<MetaField[]>([])

function openEditProject() {
  if (!project.value) return
  epName.value = project.value.name
  epView.value = project.value.defaultView
  epMeta.value = project.value.meta.map((f) => ({ ...f }))
  showEditProject.value = true
}
async function saveProject() {
  if (!epName.value.trim()) return
  await run(async () => {
    await data.updateProject(projectId.value, {
      name: epName.value.trim(),
      defaultView: epView.value,
      meta: epMeta.value.filter((f) => f.label.trim() || f.value.trim()),
    })
    showEditProject.value = false
  })
}

// Deletes
const showDeleteProject = ref(false)
async function confirmDeleteProject() {
  const clientId = project.value?.clientId
  await data.deleteProject(projectId.value)
  showDeleteProject.value = false
  if (clientId) router.push({ name: 'client', params: { clientId } })
}
const subToDelete = ref<string | null>(null)
async function confirmDeleteSub() {
  if (subToDelete.value) await data.deleteSubGroup(subToDelete.value)
  subToDelete.value = null
}

// Create: sub-group + task
const showSub = ref(false)
const subName = ref('')
const showTask = ref(false)
const showTaskUpsell = ref(false)
const showBatchWizard = ref(false)
const taskTitle = ref('')
const taskDesc = ref('')
const taskSub = ref('')
const taskAssignee = ref('')
const taskStatus = ref<TaskStatus>('backlog')
const taskDue = ref('')
const taskClientVisible = ref(false)

// Edit sub-group
const showEditSub = ref(false)
const editSubId = ref('')
const editSubName = ref('')
const editSubMeta = ref<MetaField[]>([])

function openEditSub(sgId: string) {
  const sg = subGroups.value.find((s) => s.id === sgId)
  if (!sg) return
  editSubId.value = sg.id
  editSubName.value = sg.name
  editSubMeta.value = sg.meta.map((f) => ({ ...f }))
  showEditSub.value = true
}
async function saveSubGroup() {
  if (!editSubName.value.trim()) return
  await run(async () => {
    await data.updateSubGroup(editSubId.value, {
      name: editSubName.value.trim(),
      meta: editSubMeta.value.filter((f) => f.label.trim() || f.value.trim()),
    })
    showEditSub.value = false
  })
}

async function createSub() {
  if (!subName.value.trim()) return
  await run(async () => {
    await data.createSubGroup(projectId.value, subName.value.trim())
    showSub.value = false
    subName.value = ''
  })
}

function openTaskModal() {
  // Entitlement pre-check: at the task limit, the upsell replaces the create
  // modal (rules would deny the write anyway — this is the friendly layer).
  if (!canCreateTask.value) {
    showTaskUpsell.value = true
    return
  }
  // Default to whatever the board is focused on, else the NEWEST sub-group —
  // that's the batch being worked on. (subGroupsForProject sorts ascending by
  // order, so the newest is last.)
  taskSub.value = subGroupFilter.value || subGroups.value.at(-1)?.id || ''
  taskAssignee.value = data.teamMembers[0]?.uid ?? ''
  taskStatus.value = 'backlog'
  taskTitle.value = ''
  taskDesc.value = ''
  taskDue.value = ''
  taskClientVisible.value = false
  showTask.value = true
}

async function createTask() {
  if (!taskTitle.value.trim() || !taskSub.value || !project.value) return
  await run(async () => {
    await data.createTask({
      projectId: projectId.value,
      subGroupId: taskSub.value,
      clientId: project.value!.clientId,
      title: taskTitle.value.trim(),
      description: taskDesc.value.trim(),
      assigneeUid: taskAssignee.value,
      status: taskStatus.value,
      dueAt: taskDue.value ? new Date(taskDue.value) : null,
      clientVisible: taskClientVisible.value,
    })
    showTask.value = false
  })
}

async function onBatchCreated(_ids: string[], targetSubGroupId: string) {
  showBatchWizard.value = false
  // The batch endpoint created deliverables + stage-tasks server-side.
  // Reload the board so the new sub-group, tasks, and deliverables appear.
  await data.loadProjectBoard(projectId.value)
  // A batch aimed at an EXISTING sub-group can sit outside the newest page,
  // in which case the reload above would file the user's brand new work
  // off-screen. Pull that one batch in regardless of where paging left it.
  if (targetSubGroupId && !data.getSubGroup(targetSubGroupId)) {
    await data.loadSubGroupWithChildren(targetSubGroupId)
  }
}

const client = computed(() => (project.value ? data.getClient(project.value.clientId) : undefined))
const subGroups = computed(() => data.subGroupsForProject(projectId.value))
const tasks = computed(() => data.tasksForProject(projectId.value))

// Sub-group focus. Once a project runs a batch per month, "everything at once"
// stops being a useful default view of any of the three layouts — this narrows
// all of them to one batch. '' = every loaded sub-group.
const subGroupFilter = ref('')
const visibleSubGroups = computed(() =>
  subGroupFilter.value ? subGroups.value.filter((s) => s.id === subGroupFilter.value) : subGroups.value,
)
const visibleTasks = computed(() =>
  subGroupFilter.value ? tasks.value.filter((tk) => tk.subGroupId === subGroupFilter.value) : tasks.value,
)
// A filtered-to sub-group can fall out of the loaded window on a reload.
watch(subGroups, (list) => {
  if (subGroupFilter.value && !list.some((s) => s.id === subGroupFilter.value)) subGroupFilter.value = ''
})

// Bulk client visibility (managers): share or hide the whole project's tasks
// at once — the friendly path now that new tasks default to hidden.
const bulkAction = ref<'share' | 'hide' | null>(null)
async function confirmBulk() {
  const action = bulkAction.value
  if (!action) return
  await run(async () => {
    await data.setProjectTasksVisibility(projectId.value, action === 'share')
    bulkAction.value = null
  })
}

// Deliverables list order: batch order, or priority-first with batch order as
// the tiebreak. Persisted per project so a manager who works by priority isn't
// re-picking it on every visit.
const deliverableSort = ref<'order' | 'priority'>(
  (localStorage.getItem(`pasdiu:delSort:${route.params.projectId}`) as 'order' | 'priority') ?? 'order',
)
watch(deliverableSort, (v) => localStorage.setItem(`pasdiu:delSort:${projectId.value}`, v))
function sortedDeliverables(sgId: string) {
  return data.deliverablesForSubGroup(sgId, deliverableSort.value === 'priority')
}

// Pull the next page of (older) sub-groups and their tasks/deliverables.
const loadingMore = ref(false)
async function loadEarlier() {
  if (loadingMore.value) return
  loadingMore.value = true
  try {
    await data.loadMoreSubGroups(projectId.value)
  } finally {
    loadingMore.value = false
  }
}

function tasksInColumn(col: BoardColumn) {
  return visibleTasks.value.filter((tk) => col.statuses.includes(tk.status))
}
function tasksBySubGroup(sgId: string) {
  return tasks.value.filter((tk) => tk.subGroupId === sgId)
}

const loadError = ref(false)
const loaded = ref(false)
const projectPackages = ref<Package[]>([])
// `force` comes from the refresh control: re-read even if the store's copy is
// still inside its freshness window.
async function load(force = false) {
  loadError.value = false
  try {
    await Promise.all([data.loadUsers(force), data.loadClients(force)])
    const p = await data.loadProject(projectId.value)
    project.value = p
    if (p) {
      view.value = p.defaultView
      const { collection: col, getDocs: gd, query: q, where: w } = await import('firebase/firestore')
      const { db: fireDb } = await import('../lib/firebase')
      const { mapPackage } = await import('../lib/mappers')
      // The board load is paged: it pulls the newest sub-groups plus their
      // tasks and deliverables. Earlier batches arrive via "load earlier".
      await data.loadProjectBoard(projectId.value)
      // Load packages for this project.
      const pkgSnap = await gd(q(col(fireDb, 'packages'), w('orgId', '==', data.clients[0]?.orgId || ''), w('projectId', '==', projectId.value)))
      projectPackages.value = pkgSnap.docs.map((d) => mapPackage(d.id, d.data()))
    }
    loaded.value = true
  } catch {
    loadError.value = true
  }
}
onMounted(load)
</script>

<template>
  <section v-if="project">
    <Breadcrumbs
      class="mb-4"
      :items="[
        { label: t('dashboard.title'), to: { name: 'dashboard' } },
        { label: client?.name ?? '…', to: client ? { name: 'client', params: { clientId: client.id } } : undefined },
        { label: project.name },
      ]"
    />

    <div class="flex flex-col gap-3">
      <div class="flex items-center gap-2">
        <h1 class="text-2xl font-bold tracking-tight" style="color: var(--text);">{{ project.name }}</h1>
        <InfoTip :text="t('board.viewInfo')" />
      </div>
      <StatusCounts :tasks="visibleTasks" />
      <!-- Package quota widget -->
      <PackageQuota v-for="pkg in projectPackages" :key="pkg.id" :pkg="pkg" />
      <dl v-if="project.meta.length" class="flex flex-wrap gap-x-8 gap-y-2">
        <div v-for="(f, i) in project.meta" :key="i">
          <dt class="text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ f.label }}</dt>
          <dd class="text-sm" style="color: var(--text);">{{ f.value }}</dd>
        </div>
      </dl>
      <div class="flex flex-wrap items-center gap-2">
        <!-- Fluid Kanban ↔ List ↔ Deliverables toggle. Labelled, not icon-only:
             three glyphs gave no clue that the third one is a different unit of
             work rather than a third layout. -->
        <SegmentedControl
          v-model="view"
          show-labels
          :options="[
            { value: 'kanban', label: t('board.viewKanban'), icon: 'kanban' },
            { value: 'list', label: t('board.viewList'), icon: 'list' },
            { value: 'deliverables', label: t('board.viewDeliverables'), icon: 'grid', badge: data.deliverables.filter((d) => d.projectId === projectId).length },
          ]"
        />

        <!-- Focus one batch across whichever layout is active. -->
        <select
          v-if="subGroups.length > 1"
          v-model="subGroupFilter"
          class="rounded-lg border px-2 py-1.5 text-sm outline-none"
          style="background: var(--surface-2); color: var(--text); border-color: var(--border);"
          :aria-label="t('board.filterSubGroup')"
        >
          <option value="">{{ t('board.allSubGroups') }}</option>
          <option v-for="sg in subGroups" :key="sg.id" :value="sg.id">{{ sg.name }}</option>
        </select>

        <!-- Primary action: new task. Disabled until a sub-group exists (a task
             has nowhere to live otherwise) — with the reason spelled out, since
             a dead button with no explanation is the thing people get stuck on. -->
        <BaseButton
          v-if="auth.isManager"
          class="ml-auto whitespace-nowrap"
          :disabled="!subGroups.length"
          :title="!subGroups.length ? t('board.needSubGroupFirst') : undefined"
          :aria-describedby="!subGroups.length ? 'need-subgroup-hint' : undefined"
          @click="openTaskModal"
        >
          + {{ t('actions.newTask') }}
        </BaseButton>

        <!-- All other actions live in the ⋯ overflow menu -->
        <OverflowMenu>
          <button
            role="menuitem"
            class="block w-full whitespace-nowrap px-3 py-2 text-left text-sm transition-colors hover:bg-[color:var(--surface-2)]"
            style="color: var(--text);"
            @click="openBrief()"
          >
            {{ t('brief.open') }}
          </button>
          <!-- Store data ages out on a timer; this is the "I know something
               changed, show me now" escape hatch. -->
          <button
            role="menuitem"
            class="block w-full whitespace-nowrap px-3 py-2 text-left text-sm transition-colors hover:bg-[color:var(--surface-2)]"
            style="color: var(--text);"
            @click="load(true)"
          >
            {{ t('common.refresh') }}
          </button>
          <template v-if="auth.isManager">
            <button
              role="menuitem"
              class="block w-full whitespace-nowrap px-3 py-2 text-left text-sm transition-colors hover:bg-[color:var(--surface-2)]"
              style="color: var(--text);"
              @click="openEditProject"
            >
              {{ t('actions.editProject') }}
            </button>
            <button
              role="menuitem"
              class="block w-full whitespace-nowrap px-3 py-2 text-left text-sm transition-colors hover:bg-[color:var(--surface-2)]"
              style="color: var(--text);"
              @click="showSub = true"
            >
              + {{ t('actions.newSubGroup') }}
            </button>
            <button
              role="menuitem"
              class="block w-full whitespace-nowrap px-3 py-2 text-left text-sm transition-colors hover:bg-[color:var(--surface-2)]"
              style="color: var(--text);"
              @click="showBatchWizard = true"
            >
              + {{ t('batchCreate.title') }}
            </button>
            <hr style="border-color: var(--border);" />
            <button
              role="menuitem"
              class="block w-full whitespace-nowrap px-3 py-2 text-left text-sm transition-colors hover:bg-[color:var(--surface-2)] disabled:opacity-50"
              style="color: var(--text);"
              :disabled="!tasks.length || busy"
              @click="bulkAction = 'share'"
            >
              {{ t('board.shareAll') }}
            </button>
            <button
              role="menuitem"
              class="block w-full whitespace-nowrap px-3 py-2 text-left text-sm transition-colors hover:bg-[color:var(--surface-2)] disabled:opacity-50"
              style="color: var(--text);"
              :disabled="!tasks.length || busy"
              @click="bulkAction = 'hide'"
            >
              {{ t('board.hideAll') }}
            </button>
          </template>
        </OverflowMenu>
      </div>

      <!-- Empty project: the blocked action explains itself and offers the fix. -->
      <p v-if="auth.isManager && !subGroups.length" id="need-subgroup-hint" class="text-sm" style="color: var(--text-muted);">
        {{ t('board.needSubGroupFirst') }}
        <button class="underline underline-offset-2" style="color: var(--accent-cyan);" @click="showSub = true">
          {{ t('actions.newSubGroup') }}
        </button>
      </p>
    </div>

    <!-- KANBAN: columns by status (review folds the client-flow statuses) -->
    <div v-if="view === 'kanban'" class="mt-6 flex gap-4 overflow-x-auto pb-2">
      <div v-for="col in BOARD_COLUMNS" :key="col.key" class="w-72 shrink-0">
        <div class="mb-2 flex items-center gap-2">
          <span class="h-2 w-2 rounded-full" :style="{ background: col.color }" />
          <h2 class="text-sm font-semibold" style="color: var(--text);">{{ t(col.labelKey) }}</h2>
          <span class="text-xs" style="color: var(--text-muted);">{{ tasksInColumn(col).length }}</span>
        </div>
        <TransitionGroup name="list" tag="div" class="space-y-2">
          <TaskCard v-for="tk in tasksInColumn(col)" :key="tk.id" :task="tk" show-sub-group />
        </TransitionGroup>
      </div>
    </div>

    <!-- LIST: grouped by sub-group, sequential -->
    <div v-else-if="view === 'list'" class="mt-6 space-y-6">
      <div v-for="sg in visibleSubGroups" :key="sg.id">
        <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <h2 class="text-sm font-semibold uppercase tracking-wide" style="color: var(--text);">{{ sg.name }}</h2>
            <SubGroupMenu
              v-if="auth.isManager"
              @edit="openEditSub(sg.id)"
              @brief="openBrief(sg.id)"
              @delete="subToDelete = sg.id"
            />
          </div>
          <StatusCounts :tasks="tasksBySubGroup(sg.id)" />
        </div>
        <dl v-if="sg.meta.length" class="mb-2 flex flex-wrap gap-x-6 gap-y-1">
          <div v-for="(f, i) in sg.meta" :key="i">
            <dt class="text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ f.label }}</dt>
            <dd class="text-sm" style="color: var(--text);">{{ f.value }}</dd>
          </div>
        </dl>

        <!-- All tasks in this sub-group -->
        <TransitionGroup name="list" tag="div" class="space-y-2">
          <TaskCard v-for="tk in tasksBySubGroup(sg.id)" :key="tk.id" :task="tk" />
        </TransitionGroup>
      </div>
    </div>

    <!-- DELIVERABLES: grouped by sub-group -->
    <div v-else class="mt-6 space-y-6">
      <div v-if="subGroups.length" class="flex justify-end">
        <SegmentedControl
          v-model="deliverableSort"
          :options="[
            { value: 'order', label: t('deliverableDetail.sortByOrder') },
            { value: 'priority', label: t('deliverableDetail.sortByPriority') },
          ]"
        />
      </div>
      <div v-for="sg in visibleSubGroups" :key="sg.id">
        <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <h2 class="text-sm font-semibold uppercase tracking-wide" style="color: var(--text);">{{ sg.name }}</h2>
            <span class="text-xs" style="color: var(--text-muted);">{{ data.deliverablesForSubGroup(sg.id).length }}</span>
            <SubGroupMenu
              v-if="auth.isManager"
              @edit="openEditSub(sg.id)"
              @brief="openBrief(sg.id)"
              @delete="subToDelete = sg.id"
            />
          </div>
        </div>
        <div v-if="sortedDeliverables(sg.id).length" class="space-y-2">
          <RouterLink
            v-for="del in sortedDeliverables(sg.id)"
            :key="del.id"
            :to="{ name: 'deliverable', params: { deliverableId: del.id } }"
            class="flex items-center justify-between rounded-xl border p-3 transition-transform hover:-translate-y-0.5"
            style="background: var(--surface); border-color: var(--border);"
          >
            <div class="flex items-center gap-3">
              <span class="text-sm font-medium" style="color: var(--text);">{{ del.name }}</span>
              <PriorityBadge :priority="del.priority" />
              <span class="rounded px-1.5 py-0.5 text-xs" style="background: var(--surface-2); color: var(--text-muted);">
                {{ del.status }}
              </span>
            </div>
            <div class="flex items-center gap-1">
              <span
                v-for="ss in del.stageSummary"
                :key="ss.stageId"
                class="h-2 w-2 rounded-full"
                :title="`${ss.name}: ${ss.status}`"
                :style="{ background: statusColor(ss.status) }"
              />
              <span v-if="!del.stageSummary.length" class="text-xs" style="color: var(--text-muted);">—</span>
            </div>
          </RouterLink>
        </div>
        <p v-else class="text-sm" style="color: var(--text-muted);">{{ t('board.noDeliverables') }}</p>
      </div>
      <p v-if="!subGroups.length" class="text-sm" style="color: var(--text-muted);">{{ t('board.noDeliverables') }}</p>
    </div>

    <!-- Paging: the board holds only the newest sub-groups. Say so, rather than
         letting the earlier ones look deleted. -->
    <div v-if="data.projectHasMoreSubGroups(projectId)" class="mt-6 flex items-center justify-center gap-3">
      <button
        class="rounded-lg border px-3 py-2 text-sm disabled:opacity-50"
        style="background: var(--surface-2); color: var(--text); border-color: var(--border);"
        :disabled="loadingMore"
        @click="loadEarlier"
      >
        {{ loadingMore ? t('common.loading') : t('board.loadEarlier') }}
      </button>
      <span class="text-xs" style="color: var(--text-muted);">{{ t('board.pagedHint') }}</span>
    </div>

    <BriefDrawer
      :open="briefOpen"
      :client-id="project.clientId"
      :project-id="project.id"
      :sub-group-id="briefSubGroupId"
      @close="briefOpen = false"
    />

    <!-- Edit project -->
    <Modal :open="showEditProject" :title="t('actions.editProject')" @close="showEditProject = false">
      <form class="space-y-4" @submit.prevent="saveProject">
        <label class="block">
          <span class="mb-1 flex items-center gap-1 text-xs uppercase tracking-wide" style="color: var(--text-muted);">
            {{ t('actions.nameLabel') }}
            <InfoTip :text="t('client.projectExplainer')" />
          </span>
          <BaseInput v-model="epName" :placeholder="t('client.projectPlaceholder')" />
        </label>
        <label class="block">
          <span class="mb-1 block text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('actions.viewLabel') }}</span>
          <BaseSelect v-model="epView">
            <option value="kanban">{{ t('board.viewKanban') }}</option>
            <option value="list">{{ t('board.viewList') }}</option>
            <option value="deliverables">{{ t('board.viewDeliverables') }}</option>
          </BaseSelect>
        </label>
        <div>
          <span class="mb-1 block text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('actions.metadata') }}</span>
          <MetaEditor
            v-model="epMeta"
            :suggestions="[t('meta.budget'), t('meta.kickoff'), t('meta.deadline'), t('meta.driveFolder'), t('meta.links')]"
          />
        </div>
        <div class="flex items-end justify-between gap-2">
          <button
            type="button"
            class="rounded-lg px-3 py-2 text-sm"
            style="color: var(--accent-amber);"
            @click="showEditProject = false; showDeleteProject = true"
          >
            {{ t('actions.deleteProject') }}
          </button>
          <ModalFooter :label="t('actions.save')" :busy="busy" @cancel="showEditProject = false" @submit="saveProject" />
        </div>
      </form>
    </Modal>

    <ConfirmDialog
      :open="showDeleteProject"
      danger
      :title="t('actions.deleteProject')"
      :message="t('actions.deleteProjectConfirm', { name: project.name })"
      :confirm-label="t('actions.delete')"
      @confirm="confirmDeleteProject"
      @cancel="showDeleteProject = false"
    />
    <ConfirmDialog
      :open="!!subToDelete"
      danger
      :title="t('actions.deleteSubGroup')"
      :message="t('actions.deleteSubGroupConfirm')"
      :confirm-label="t('actions.delete')"
      @confirm="confirmDeleteSub"
      @cancel="subToDelete = null"
    />

    <!-- New sub-group -->
    <Modal :open="showSub" :title="t('actions.newSubGroup')" @close="showSub = false">
      <form class="space-y-4" @submit.prevent="createSub">
        <label class="block">
          <span class="mb-1 flex items-center gap-1 text-xs uppercase tracking-wide" style="color: var(--text-muted);">
            {{ t('actions.nameLabel') }}
            <InfoTip :text="t('board.subGroupExplainer')" />
          </span>
          <BaseInput v-model="subName" autofocus :placeholder="t('board.subGroupPlaceholder')" />
        </label>
        <ModalFooter :label="t('actions.create')" :busy="busy" @cancel="showSub = false" @submit="createSub" />
      </form>
    </Modal>

    <!-- Edit sub-group -->
    <Modal :open="showEditSub" :title="t('board.editSubGroup')" @close="showEditSub = false">
      <form class="space-y-4" @submit.prevent="saveSubGroup">
        <label class="block">
          <span class="mb-1 flex items-center gap-1 text-xs uppercase tracking-wide" style="color: var(--text-muted);">
            {{ t('actions.nameLabel') }}
            <InfoTip :text="t('board.subGroupExplainer')" />
          </span>
          <BaseInput v-model="editSubName" autofocus :placeholder="t('board.subGroupPlaceholder')" />
        </label>
        <div>
          <span class="mb-1 block text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('actions.metadata') }}</span>
          <MetaEditor
            v-model="editSubMeta"
            :suggestions="[t('meta.deadline'), t('meta.links'), t('meta.driveFolder')]"
          />
        </div>
        <ModalFooter :label="t('actions.save')" :busy="busy" @cancel="showEditSub = false" @submit="saveSubGroup" />
      </form>
    </Modal>

    <!-- New task -->
    <Modal :open="showTask" :title="t('actions.newTask')" @close="showTask = false">
      <form class="space-y-4" @submit.prevent="createTask">
        <label class="block">
          <span class="mb-1 block text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('actions.titleLabel') }}</span>
          <BaseInput v-model="taskTitle" autofocus />
        </label>
        <label class="block">
          <span class="mb-1 block text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('actions.descriptionLabel') }}</span>
          <textarea
            v-model="taskDesc"
            rows="2"
            class="w-full rounded-lg border px-3 py-2 text-sm outline-none"
            style="background: var(--surface-2); color: var(--text); border-color: var(--border);"
          />
        </label>
        <div class="grid grid-cols-2 gap-3">
          <label class="block">
            <span class="mb-1 block text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('actions.subGroupLabel') }}</span>
            <BaseSelect v-model="taskSub">
              <option v-for="sg in subGroups" :key="sg.id" :value="sg.id">{{ sg.name }}</option>
            </BaseSelect>
          </label>
          <label class="block">
            <span class="mb-1 block text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('actions.assigneeLabel') }}</span>
            <BaseSelect v-model="taskAssignee">
              <option v-for="u in data.teamMembers" :key="u.uid" :value="u.uid">{{ u.displayName }}</option>
            </BaseSelect>
          </label>
          <label class="block">
            <span class="mb-1 block text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('board.changeStatus') }}</span>
            <BaseSelect v-model="taskStatus">
              <option v-for="s in MANUAL_TASK_STATUSES" :key="s" :value="s">{{ t(statusKey(s)) }}</option>
            </BaseSelect>
          </label>
          <label class="block">
            <span class="mb-1 block text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('actions.dueLabel') }}</span>
            <BaseInput v-model="taskDue" type="date" />
          </label>
        </div>
        <label class="flex items-start gap-2">
          <input v-model="taskClientVisible" type="checkbox" class="mt-0.5" />
          <span>
            <span class="block text-sm" style="color: var(--text);">{{ t('actions.clientVisibleLabel') }}</span>
            <span class="block text-xs" style="color: var(--text-muted);">{{ t('actions.clientVisibleHint') }}</span>
          </span>
        </label>
        <ModalFooter :label="t('actions.create')" :busy="busy" @cancel="showTask = false" @submit="createTask" />
      </form>
    </Modal>

    <!-- Bulk client-visibility confirmation -->
    <ConfirmDialog
      :open="bulkAction !== null"
      :title="bulkAction === 'hide' ? t('board.hideAll') : t('board.shareAll')"
      :message="bulkAction === 'hide' ? t('board.hideAllConfirm') : t('board.shareAllConfirm')"
      @confirm="confirmBulk"
      @cancel="bulkAction = null"
    />

    <UpsellModal :open="showTaskUpsell" reason="tasks" @close="showTaskUpsell = false" />

    <BatchCreateWizard
      :open="showBatchWizard"
      :project-id="projectId"
      @close="showBatchWizard = false"
      @created="onBatchCreated"
    />
  </section>

  <section v-else-if="loadError">
    <p class="text-sm" style="color: var(--text-muted);">{{ t('common.loadError') }}</p>
    <BaseButton class="mt-3" @click="load(true)">{{ t('common.retry') }}</BaseButton>
  </section>

  <section v-else-if="loaded">
    <p style="color: var(--text-muted);">{{ t('common.notFound') }}</p>
  </section>

  <section v-else>
    <p style="color: var(--text-muted);">{{ t('common.loading') }}</p>
  </section>
</template>
