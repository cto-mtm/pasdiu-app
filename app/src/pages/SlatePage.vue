<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDataStore } from '../stores/data'
import { useAuthStore } from '../stores/auth'
import { isDoneStatus } from '../lib/status'
import TaskCard from '../components/TaskCard.vue'
import SegmentedControl from '../components/SegmentedControl.vue'

const { t } = useI18n()
const data = useDataStore()
const auth = useAuthStore()

type GroupBy = 'deadline' | 'client' | 'project'
const groupBy = ref<GroupBy>('deadline')

// All my non-done tasks, sorted by due date (no-date tasks last).
const myTasks = computed(() => {
  if (!auth.profile) return []
  return [...data.tasksForAssignee(auth.profile.uid)]
    .filter((tk) => !isDoneStatus(tk.status))
    .sort(
      (a, b) =>
        (a.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER),
    )
})

// ── Deadline grouping (original behavior) ───────────────────────
// "Up next": deliverable-linked backlog tasks (previous stage completed → ready to start).
const upNextTasks = computed(() => myTasks.value.filter((tk) => tk.deliverableId && tk.status === 'backlog'))
// "Active": everything else — in_progress, revisions, blocked, standalone backlog, etc.
const activeTasks = computed(() => myTasks.value.filter((tk) => !(tk.deliverableId && tk.status === 'backlog')))

// ── Generic grouping helper ─────────────────────────────────────
interface TaskGroup { key: string; label: string; tasks: typeof myTasks.value }

function groupTasksBy(keyFn: (tk: typeof myTasks.value[0]) => string, labelFn: (key: string) => string): TaskGroup[] {
  const map = new Map<string, typeof myTasks.value>()
  for (const tk of myTasks.value) {
    const key = keyFn(tk) || '_none'
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(tk)
  }
  return [...map.entries()].map(([key, tasks]) => ({ key, label: labelFn(key), tasks }))
}

const groupedByClient = computed<TaskGroup[]>(() =>
  groupTasksBy((tk) => tk.clientId, (key) => key === '_none' ? t('slate.noClient') : (data.getClient(key)?.name ?? key))
)

const groupedByProject = computed<TaskGroup[]>(() =>
  groupTasksBy((tk) => tk.projectId, (key) => key === '_none' ? t('slate.noProject') : (data.getProject(key)?.name ?? key))
)

const loadFailed = ref(false)
async function load() {
  loadFailed.value = false
  try {
    await Promise.all([data.loadUsers(), data.loadClients()])
    if (auth.profile) await data.loadAssignedTasks(auth.profile.uid)
  } catch {
    loadFailed.value = true
  }
}
onMounted(load)

// Lazy-load projects only when the user first switches to project grouping.
const projectsLoaded = ref(false)
watch(groupBy, async (v) => {
  if (v === 'project' && !projectsLoaded.value) {
    await data.loadAllProjects()
    projectsLoaded.value = true
  }
})
</script>

<template>
  <section>
    <h1 class="text-2xl font-bold tracking-tight" style="color: var(--text);">{{ t('slate.title') }}</h1>
    <p class="mt-1 text-sm" style="color: var(--text-muted);">{{ t('slate.subtitle') }}</p>

    <!-- Grouping toggle -->
    <div class="mt-4">
      <SegmentedControl
        v-model="groupBy"
        :options="[
          { value: 'deadline', label: t('slate.byDeadline') },
          { value: 'client', label: t('slate.byClient') },
          { value: 'project', label: t('slate.byProject') },
        ]"
      />
    </div>

    <div v-if="loadFailed" class="mt-8">
      <p class="text-sm" style="color: var(--accent-amber);">{{ t('common.loadError') }}</p>
      <button class="mt-2 text-sm underline" style="color: var(--accent-cyan);" @click="load">
        {{ t('common.retry') }}
      </button>
    </div>

    <p v-else-if="!myTasks.length" class="mt-8 text-sm" style="color: var(--text-muted);">{{ t('slate.empty') }}</p>

    <template v-else>
      <!-- ── Deadline view (original) ──────────────────────────────── -->
      <template v-if="groupBy === 'deadline'">
        <div v-if="upNextTasks.length" class="mt-6">
          <h2 class="mb-2 text-sm font-semibold uppercase tracking-wide" style="color: var(--accent-cyan);">{{ t('slate.upNext') }}</h2>
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TaskCard v-for="tk in upNextTasks" :key="tk.id" :task="tk" />
          </div>
        </div>

        <div v-if="activeTasks.length" class="mt-6">
          <h2 v-if="upNextTasks.length" class="mb-2 text-sm font-semibold uppercase tracking-wide" style="color: var(--text-muted);">{{ t('slate.inProgress') }}</h2>
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TaskCard v-for="tk in activeTasks" :key="tk.id" :task="tk" />
          </div>
        </div>
      </template>

      <!-- ── Client view ───────────────────────────────────────────── -->
      <template v-else-if="groupBy === 'client'">
        <div v-for="group in groupedByClient" :key="group.key" class="mt-6">
          <h2 class="mb-2 text-sm font-semibold uppercase tracking-wide" style="color: var(--text-muted);">
            {{ group.label }}
            <span class="ml-1 text-xs font-normal">{{ group.tasks.length }}</span>
          </h2>
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TaskCard v-for="tk in group.tasks" :key="tk.id" :task="tk" />
          </div>
        </div>
      </template>

      <!-- ── Project view ──────────────────────────────────────────── -->
      <template v-else>
        <div v-for="group in groupedByProject" :key="group.key" class="mt-6">
          <h2 class="mb-2 text-sm font-semibold uppercase tracking-wide" style="color: var(--text-muted);">
            {{ group.label }}
            <span class="ml-1 text-xs font-normal">{{ group.tasks.length }}</span>
          </h2>
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TaskCard v-for="tk in group.tasks" :key="tk.id" :task="tk" />
          </div>
        </div>
      </template>
    </template>
  </section>
</template>
