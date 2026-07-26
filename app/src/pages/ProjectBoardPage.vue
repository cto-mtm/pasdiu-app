<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useDataStore } from '../stores/data'
import { useAuthStore } from '../stores/auth'
import { useBusy } from '../composables/useBusy'
import { useEntitlements } from '../composables/useEntitlements'
import { TASK_STATUSES } from '../lib/types'
import type { Project, TaskStatus } from '../lib/types'
import { statusColor, statusKey } from '../lib/status'
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
import InfoTip from '../components/InfoTip.vue'
import OverflowMenu from '../components/OverflowMenu.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import MetaEditor from '../components/MetaEditor.vue'
import UpsellModal from '../components/UpsellModal.vue'
import BatchCreateWizard from '../components/BatchCreateWizard.vue'
import type { MetaField } from '../lib/types'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const data = useDataStore()
const auth = useAuthStore()
const { canCreateTask } = useEntitlements()

const projectId = computed(() => String(route.params.projectId))
const project = ref<Project | undefined>()
const view = ref<'kanban' | 'list'>('kanban')
const briefOpen = ref(false)

const { busy, run } = useBusy()

// Edit project (name + default view)
const showEditProject = ref(false)
const epName = ref('')
const epView = ref<'kanban' | 'list'>('kanban')
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
  taskSub.value = subGroups.value[0]?.id ?? ''
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

const client = computed(() => (project.value ? data.getClient(project.value.clientId) : undefined))
const subGroups = computed(() => data.subGroupsForProject(projectId.value))
const tasks = computed(() => data.tasksForProject(projectId.value))
// Standalone tasks (no deliverable) for the legacy board views.
const standaloneTasks = computed(() => tasks.value.filter((t) => !t.deliverableId))

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

function tasksByStatus(status: string) {
  return tasks.value.filter((tk) => tk.status === status)
}
function tasksBySubGroup(sgId: string) {
  return tasks.value.filter((tk) => tk.subGroupId === sgId)
}

const loadError = ref(false)
const loaded = ref(false)
async function load() {
  loadError.value = false
  try {
    await Promise.all([data.loadUsers(), data.loadClients()])
    const p = await data.loadProject(projectId.value)
    project.value = p
    if (p) {
      view.value = p.defaultView
      await Promise.all([
        data.loadProjectBoard(projectId.value),
        data.loadProjectDeliverables(projectId.value),
      ])
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
      <StatusCounts :tasks="tasks" />
      <dl v-if="project.meta.length" class="flex flex-wrap gap-x-8 gap-y-2">
        <div v-for="(f, i) in project.meta" :key="i">
          <dt class="text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ f.label }}</dt>
          <dd class="text-sm" style="color: var(--text);">{{ f.value }}</dd>
        </div>
      </dl>
      <div class="flex flex-wrap items-center gap-2">
        <!-- Fluid Kanban ↔ List toggle -->
        <SegmentedControl
          v-model="view"
          :options="[
            { value: 'kanban', label: t('board.viewKanban'), icon: 'kanban' },
            { value: 'list', label: t('board.viewList'), icon: 'list' },
          ]"
        />
        <button
          class="shrink-0 whitespace-nowrap rounded-lg border px-3 py-1.5 text-sm"
          style="background: var(--surface-2); color: var(--text); border-color: var(--border);"
          @click="briefOpen = true"
        >
          {{ t('brief.open') }}
        </button>
        <button
          v-if="auth.isManager"
          class="shrink-0 whitespace-nowrap rounded-lg border px-3 py-1.5 text-sm"
          style="background: var(--surface-2); color: var(--text); border-color: var(--border);"
          @click="openEditProject"
        >
          {{ t('actions.editProject') }}
        </button>
        <!-- Secondary/bulk actions live behind the ⋯ menu to keep the toolbar lean. -->
        <OverflowMenu v-if="auth.isManager">
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
        </OverflowMenu>
        <!-- Push create actions to the right on wide screens, wrap under on narrow. -->
        <div v-if="auth.isManager" class="flex flex-wrap items-center gap-2 sm:ml-auto">
          <button
            class="shrink-0 whitespace-nowrap rounded-lg border px-3 py-1.5 text-sm"
            style="background: var(--surface-2); color: var(--text); border-color: var(--border);"
            @click="showSub = true"
          >
            + {{ t('actions.newSubGroup') }}
          </button>
          <BaseButton class="shrink-0 whitespace-nowrap" @click="showBatchWizard = true">
            + {{ t('batchCreate.title') }}
          </BaseButton>
          <BaseButton class="shrink-0 whitespace-nowrap" :disabled="!subGroups.length" @click="openTaskModal">
            + {{ t('actions.newTask') }}
          </BaseButton>
        </div>
      </div>
    </div>

    <!-- KANBAN: columns by status -->
    <div v-if="view === 'kanban'" class="mt-6 flex gap-4 overflow-x-auto pb-2">
      <div v-for="s in TASK_STATUSES" :key="s" class="w-72 shrink-0">
        <div class="mb-2 flex items-center gap-2">
          <span class="h-2 w-2 rounded-full" :style="{ background: statusColor(s) }" />
          <h2 class="text-sm font-semibold" style="color: var(--text);">{{ t(statusKey(s)) }}</h2>
          <span class="text-xs" style="color: var(--text-muted);">{{ tasksByStatus(s).length }}</span>
        </div>
        <TransitionGroup name="list" tag="div" class="space-y-2">
          <TaskCard v-for="tk in tasksByStatus(s)" :key="tk.id" :task="tk" show-sub-group />
        </TransitionGroup>
      </div>
    </div>

    <!-- LIST: grouped by sub-group, sequential -->
    <div v-else class="mt-6 space-y-6">
      <div v-for="sg in subGroups" :key="sg.id">
        <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <h2 class="text-sm font-semibold uppercase tracking-wide" style="color: var(--text-muted);">{{ sg.name }}</h2>
            <button
              v-if="auth.isManager"
              class="text-xs"
              style="color: var(--text-muted);"
              :aria-label="t('board.editSubGroup')"
              :title="t('board.editSubGroup')"
              @click="openEditSub(sg.id)"
            >
              ✎
            </button>
            <button
              v-if="auth.isManager"
              class="text-xs"
              style="color: var(--accent-amber);"
              :aria-label="t('actions.delete')"
              :title="t('actions.delete')"
              @click="subToDelete = sg.id"
            >
              ✕
            </button>
          </div>
          <StatusCounts :tasks="tasksBySubGroup(sg.id)" />
        </div>
        <dl v-if="sg.meta.length" class="mb-2 flex flex-wrap gap-x-6 gap-y-1">
          <div v-for="(f, i) in sg.meta" :key="i">
            <dt class="text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ f.label }}</dt>
            <dd class="text-sm" style="color: var(--text);">{{ f.value }}</dd>
          </div>
        </dl>

        <!-- Deliverable rows (read from stageSummary — zero task reads) -->
        <div v-if="data.deliverablesForSubGroup(sg.id).length" class="space-y-2 mb-3">
          <RouterLink
            v-for="del in data.deliverablesForSubGroup(sg.id)"
            :key="del.id"
            :to="{ name: 'deliverable', params: { deliverableId: del.id } }"
            class="flex items-center justify-between rounded-xl border p-3 transition-transform hover:-translate-y-0.5"
            style="background: var(--surface); border-color: var(--border);"
            :style="{ viewTransitionName: `deliverable-title-${del.id}` }"
          >
            <div>
              <span class="text-sm font-medium" style="color: var(--text);">{{ del.name }}</span>
              <span class="ml-2 text-xs" style="color: var(--text-muted);">{{ del.status }}</span>
            </div>
            <div class="flex items-center gap-1">
              <span
                v-for="ss in del.stageSummary"
                :key="ss.stageId"
                class="h-2 w-2 rounded-full"
                :title="`${ss.name}: ${ss.status}`"
                :style="{ background: statusColor(ss.status) }"
              />
            </div>
          </RouterLink>
        </div>

        <!-- Standalone tasks (not linked to a deliverable) -->
        <TransitionGroup name="list" tag="div" class="space-y-2">
          <TaskCard v-for="tk in tasksBySubGroup(sg.id).filter(t => !t.deliverableId)" :key="tk.id" :task="tk" />
        </TransitionGroup>
      </div>
    </div>

    <BriefDrawer :open="briefOpen" :project-id="project.id" :brief="project.brief" @close="briefOpen = false" />

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
              <option v-for="s in TASK_STATUSES" :key="s" :value="s">{{ t(statusKey(s)) }}</option>
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
      @created="showBatchWizard = false"
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
