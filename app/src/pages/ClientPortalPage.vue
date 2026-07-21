<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDataStore } from '../stores/data'
import { useAuthStore } from '../stores/auth'
import TaskRow from '../components/TaskRow.vue'

const { t } = useI18n()
const data = useDataStore()
const auth = useAuthStore()

// Client Portal: a pristine review/approve surface, scoped to the signed-in
// client's own projects/tasks (data + Firestore rules both enforce the scope).
const groups = computed(() =>
  data.projects
    .map((p) => ({ project: p, tasks: data.tasks.filter((tk) => tk.projectId === p.id) }))
    .filter((g) => g.tasks.length),
)

const loadFailed = ref(false)
async function load() {
  loadFailed.value = false
  const cid = auth.profile?.clientId
  if (!cid) return
  try {
    await data.loadUsers()
    await Promise.all([data.loadClient(cid), data.loadProjectsForClient(cid), data.loadTasksForClient(cid)])
  } catch {
    loadFailed.value = true
  }
}
onMounted(load)
</script>

<template>
  <section>
    <h1 class="text-2xl font-bold tracking-tight" style="color: var(--text);">{{ t('portal.title') }}</h1>
    <p class="mt-1 text-sm" style="color: var(--text-muted);">{{ t('portal.subtitle') }}</p>

    <div v-if="loadFailed" class="mt-8">
      <p class="text-sm" style="color: var(--accent-amber);">{{ t('common.loadError') }}</p>
      <button class="mt-2 text-sm underline" style="color: var(--accent-cyan);" @click="load">
        {{ t('common.retry') }}
      </button>
    </div>

    <p v-else-if="!groups.length" class="mt-8 text-sm" style="color: var(--text-muted);">{{ t('portal.empty') }}</p>

    <div v-else class="mt-6 space-y-6">
      <div v-for="g in groups" :key="g.project.id">
        <h2 class="mb-2 text-sm font-semibold uppercase tracking-wide" style="color: var(--text-muted);">{{ g.project.name }}</h2>
        <div class="divide-y overflow-hidden rounded-xl border" style="border-color: var(--border);">
          <TaskRow v-for="tk in g.tasks" :key="tk.id" :task="tk">
            <span class="text-xs" style="color: var(--accent-cyan);">{{ t('portal.review') }} →</span>
          </TaskRow>
        </div>
      </div>
    </div>
  </section>
</template>
