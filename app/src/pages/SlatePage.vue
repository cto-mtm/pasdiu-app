<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDataStore } from '../stores/data'
import { useAuthStore } from '../stores/auth'
import { isDoneStatus } from '../lib/status'
import TaskCard from '../components/TaskCard.vue'

const { t } = useI18n()
const data = useDataStore()
const auth = useAuthStore()

// Contractor "Focus Slate": only their assigned deliverables, soonest first.
// Tasks without a due date sort LAST (no deadline = no urgency), not first.
const myTasks = computed(() => {
  if (!auth.profile) return []
  return [...data.tasksForAssignee(auth.profile.uid)]
    .filter((tk) => !isDoneStatus(tk.status))
    .sort(
      (a, b) =>
        (a.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER),
    )
})

// "Up next": stage tasks in backlog — the previous stage has completed so
// these are actionable. Separated visually so the contractor sees them as
// "ready to start" versus tasks already in progress.
const upNextTasks = computed(() => myTasks.value.filter((tk) => tk.deliverableId && tk.status === 'backlog'))
const activeTasks = computed(() => myTasks.value.filter((tk) => !(tk.deliverableId && tk.status === 'backlog')))

const loadFailed = ref(false)
async function load() {
  loadFailed.value = false
  try {
    await data.loadUsers()
    if (auth.profile) await data.loadAssignedTasks(auth.profile.uid)
  } catch {
    loadFailed.value = true
  }
}
onMounted(load)
</script>

<template>
  <section>
    <h1 class="text-2xl font-bold tracking-tight" style="color: var(--text);">{{ t('slate.title') }}</h1>
    <p class="mt-1 text-sm" style="color: var(--text-muted);">{{ t('slate.subtitle') }}</p>

    <div v-if="loadFailed" class="mt-8">
      <p class="text-sm" style="color: var(--accent-amber);">{{ t('common.loadError') }}</p>
      <button class="mt-2 text-sm underline" style="color: var(--accent-cyan);" @click="load">
        {{ t('common.retry') }}
      </button>
    </div>

    <p v-else-if="!myTasks.length" class="mt-8 text-sm" style="color: var(--text-muted);">{{ t('slate.empty') }}</p>

    <template v-else>
      <!-- Up next: stage tasks ready to start -->
      <div v-if="upNextTasks.length" class="mt-6">
        <h2 class="mb-2 text-sm font-semibold uppercase tracking-wide" style="color: var(--accent-cyan);">{{ t('slate.upNext') }}</h2>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TaskCard v-for="tk in upNextTasks" :key="tk.id" :task="tk" />
        </div>
      </div>

      <!-- Active work -->
      <div v-if="activeTasks.length" class="mt-6">
        <h2 v-if="upNextTasks.length" class="mb-2 text-sm font-semibold uppercase tracking-wide" style="color: var(--text-muted);">{{ t('slate.inProgress') }}</h2>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TaskCard v-for="tk in activeTasks" :key="tk.id" :task="tk" />
        </div>
      </div>
    </template>
  </section>
</template>
