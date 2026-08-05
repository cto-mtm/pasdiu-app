<script setup lang="ts">
// CalendarPage — month grid with day view showing recording sessions and tasks.
// Read-only in v1: click through to task, deliverable, or session. No drag.
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { collection, getDocs, query, where, Timestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuthStore } from '../stores/auth'
import { useDataStore } from '../stores/data'
import { useBusy } from '../composables/useBusy'
import { mapRecordingSession, mapTask } from '../lib/mappers'
import type { RecordingSession, Task } from '../lib/types'
import BaseButton from '../components/BaseButton.vue'
import BaseInput from '../components/BaseInput.vue'
import Modal from '../components/Modal.vue'
import ModalFooter from '../components/ModalFooter.vue'

const { t } = useI18n()
const auth = useAuthStore()
const data = useDataStore()
const { busy, run } = useBusy()

const currentMonth = ref(new Date())
const sessions = ref<RecordingSession[]>([])
const monthTasks = ref<Task[]>([])
const selectedDate = ref<string | null>(null)

const monthStart = computed(() => {
  const d = new Date(currentMonth.value)
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  return d
})
const monthEnd = computed(() => {
  const d = new Date(monthStart.value)
  d.setMonth(d.getMonth() + 1)
  return d
})

// Generate calendar grid days.
const calendarDays = computed(() => {
  const start = new Date(monthStart.value)
  // Back up to the start of the week.
  start.setDate(start.getDate() - start.getDay())
  const days: Date[] = []
  for (let i = 0; i < 42; i++) {
    days.push(new Date(start.getTime() + i * 86400000))
  }
  return days
})

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function sessionsForDate(date: Date): RecordingSession[] {
  const key = dateKey(date)
  return sessions.value.filter((s) => s.date && dateKey(s.date) === key)
}

function tasksForDate(date: Date): Task[] {
  const key = dateKey(date)
  return monthTasks.value.filter((t) => t.dueAt && dateKey(t.dueAt) === key)
}

const selectedSessions = computed(() => selectedDate.value ? sessionsForDate(new Date(selectedDate.value)) : [])
const selectedTasks = computed(() => selectedDate.value ? tasksForDate(new Date(selectedDate.value)) : [])

function prevMonth() {
  const d = new Date(currentMonth.value)
  d.setMonth(d.getMonth() - 1)
  currentMonth.value = d
  loadMonth()
}
function nextMonth() {
  const d = new Date(currentMonth.value)
  d.setMonth(d.getMonth() + 1)
  currentMonth.value = d
  loadMonth()
}

// Create session modal.
const showNewSession = ref(false)
const sessName = ref('')
const sessLocation = ref('')
const sessDate = ref('')
const sessNotes = ref('')

async function createSession() {
  if (!sessName.value.trim() || !sessDate.value) return
  await run(async () => {
    await data.createRecordingSession({
      name: sessName.value.trim(),
      location: sessLocation.value.trim(),
      date: new Date(sessDate.value),
      notes: sessNotes.value.trim(),
    })
    showNewSession.value = false
    sessName.value = ''
    sessLocation.value = ''
    sessDate.value = ''
    sessNotes.value = ''
    await loadMonth()
  })
}

async function loadMonth() {
  const orgId = auth.activeOrgId
  if (!orgId) return
  const startTs = Timestamp.fromDate(monthStart.value)
  const endTs = Timestamp.fromDate(monthEnd.value)

  const [sessSnap, taskSnap] = await Promise.all([
    getDocs(query(
      collection(db, 'sessions'),
      where('orgId', '==', orgId),
      where('date', '>=', startTs),
      where('date', '<', endTs),
    )),
    getDocs(query(
      collection(db, 'tasks'),
      where('orgId', '==', orgId),
      where('dueAt', '>=', startTs),
      where('dueAt', '<', endTs),
    )),
  ])

  sessions.value = sessSnap.docs.map((d) => mapRecordingSession(d.id, d.data()))
  monthTasks.value = taskSnap.docs.map((d) => mapTask(d.id, d.data()))
}

onMounted(loadMonth)
</script>

<template>
  <section>
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-bold tracking-tight" style="color: var(--text);">{{ t('calendar.title') }}</h1>
      <div class="flex items-center gap-2">
        <BaseButton class="text-xs" @click="showNewSession = true">+ {{ t('calendar.newSession') }}</BaseButton>
        <button class="rounded px-2 py-1 text-sm" style="color: var(--text-muted);" @click="prevMonth">←</button>
        <span class="text-sm font-medium" style="color: var(--text);">
          {{ currentMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) }}
        </span>
        <button class="rounded px-2 py-1 text-sm" style="color: var(--text-muted);" @click="nextMonth">→</button>
      </div>
    </div>

    <!-- Month grid -->
    <div class="mt-4 grid grid-cols-7 gap-px overflow-hidden rounded-xl border" style="background: var(--border); border-color: var(--border);">
      <!-- Weekday headers -->
      <div v-for="wd in ['Su','Mo','Tu','We','Th','Fr','Sa']" :key="wd"
        class="py-1 text-center text-xs font-medium" style="background: var(--surface-2); color: var(--text-muted);">
        {{ wd }}
      </div>
      <!-- Day cells -->
      <button
        v-for="day in calendarDays"
        :key="day.toISOString()"
        class="min-h-[3.5rem] p-1 text-left text-xs transition-colors"
        :style="{
          background: dateKey(day) === selectedDate ? 'var(--accent-cyan)' : 'var(--surface)',
          color: day.getMonth() === monthStart.getMonth() ? (dateKey(day) === selectedDate ? '#000' : 'var(--text)') : 'var(--text-muted)',
          opacity: day.getMonth() === monthStart.getMonth() ? 1 : 0.5,
        }"
        @click="selectedDate = dateKey(day)"
      >
        <span class="block font-medium">{{ day.getDate() }}</span>
        <!-- Dots for events -->
        <div class="mt-0.5 flex gap-0.5">
          <span v-for="s in sessionsForDate(day).slice(0, 3)" :key="s.id" class="h-1.5 w-1.5 rounded-full" style="background: var(--accent-amber);" />
          <span v-if="tasksForDate(day).length" class="h-1.5 w-1.5 rounded-full" style="background: var(--accent-cyan);" />
        </div>
      </button>
    </div>

    <!-- Day view -->
    <div v-if="selectedDate" class="mt-4">
      <h2 class="text-sm font-semibold" style="color: var(--text);">
        {{ new Date(selectedDate).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) }}
      </h2>

      <!-- Sessions grouped by set -->
      <div v-if="selectedSessions.length" class="mt-3 space-y-3">
        <div v-for="sess in selectedSessions" :key="sess.id" class="rounded-lg border p-3" style="background: var(--surface-2); border-color: var(--border);">
          <div class="flex items-center justify-between">
            <span class="text-sm font-medium" style="color: var(--text);">{{ sess.name }}</span>
            <span v-if="sess.location" class="text-xs" style="color: var(--text-muted);">📍 {{ sess.location }}</span>
          </div>
          <p v-if="sess.notes" class="mt-1 text-xs" style="color: var(--text-muted);">{{ sess.notes }}</p>
          <div v-if="sess.taskIds.length" class="mt-2 text-xs" style="color: var(--text-muted);">
            {{ sess.taskIds.length }} {{ t('calendar.captureTasks') }}
          </div>
        </div>
      </div>

      <!-- Tasks due this day -->
      <div v-if="selectedTasks.length" class="mt-3">
        <p class="mb-1 text-xs font-medium" style="color: var(--text-muted);">{{ t('calendar.tasksDue') }}</p>
        <div class="space-y-1">
          <RouterLink
            v-for="tk in selectedTasks"
            :key="tk.id"
            :to="{ name: 'task', params: { taskId: tk.id } }"
            class="block rounded-lg border px-3 py-2 text-sm transition-colors hover:bg-[color:var(--surface-2)]"
            style="border-color: var(--border); color: var(--text);"
          >
            {{ tk.title }}
          </RouterLink>
        </div>
      </div>

      <p v-if="!selectedSessions.length && !selectedTasks.length" class="mt-3 text-xs" style="color: var(--text-muted);">
        {{ t('calendar.nothingScheduled') }}
      </p>
    </div>
    <!-- New Session Modal -->
    <Modal :open="showNewSession" :title="t('calendar.newSession')" @close="showNewSession = false">
      <form class="space-y-4" @submit.prevent="createSession">
        <label class="block">
          <span class="mb-1 block text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('calendar.sessionName') }}</span>
          <BaseInput v-model="sessName" autofocus placeholder="e.g. Set 1" />
        </label>
        <label class="block">
          <span class="mb-1 block text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('calendar.sessionLocation') }}</span>
          <BaseInput v-model="sessLocation" placeholder="Studio / address" />
        </label>
        <label class="block">
          <span class="mb-1 block text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('calendar.sessionDate') }}</span>
          <BaseInput v-model="sessDate" type="date" />
        </label>
        <label class="block">
          <span class="mb-1 block text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('calendar.sessionNotes') }}</span>
          <textarea
            v-model="sessNotes"
            rows="2"
            class="w-full rounded-lg border px-3 py-2 text-sm outline-none"
            style="background: var(--surface-2); color: var(--text); border-color: var(--border);"
          />
        </label>
        <ModalFooter :label="t('actions.create')" :busy="busy" @cancel="showNewSession = false" @submit="createSession" />
      </form>
    </Modal>
  </section>
</template>
