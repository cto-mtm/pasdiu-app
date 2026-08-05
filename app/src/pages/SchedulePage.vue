<script setup lang="ts">
// SchedulePage — a week-strip calendar: seven day chips (dot + item count on
// days with something scheduled), the selected day's sessions and due tasks
// listed underneath, ‹ › to move between weeks. Also hosts the outward
// calendar sync (an ICS subscription link for Google/Apple/Outlook — one-way,
// out of the app).
//
// Read-only view: queries Firestore directly with mappers (the CalendarPage
// pattern). Managers see the whole org's schedule; crews see their own tasks
// — sessions stay visible to everyone, shoot days are team events.
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { collection, getDocs, orderBy, query, Timestamp, where } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuthStore } from '../stores/auth'
import { useToastStore } from '../stores/toast'
import { useBusy } from '../composables/useBusy'
import { calendarFeedUrl, createCalendarFeedApi } from '../lib/api'
import { mapRecordingSession, mapTask } from '../lib/mappers'
import { statusColor, statusKey } from '../lib/status'
import type { RecordingSession, Task } from '../lib/types'
import BaseButton from '../components/BaseButton.vue'
import BaseInput from '../components/BaseInput.vue'

const { t, d, locale } = useI18n()
const auth = useAuthStore()
const toast = useToastStore()

// ── Week navigation ─────────────────────────────────────────────
function startOfDay(day: Date): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate())
}
// Sunday-first weeks, matching the calendar apps this view mirrors.
function startOfWeek(day: Date): Date {
  const s = startOfDay(day)
  s.setDate(s.getDate() - s.getDay())
  return s
}
function dayKey(day: Date): string {
  return `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`
}

const today = startOfDay(new Date())
const weekStart = ref(startOfWeek(today))
const selectedKey = ref(dayKey(today))

function shiftWeek(delta: number) {
  const next = new Date(weekStart.value)
  next.setDate(next.getDate() + delta * 7)
  weekStart.value = next
}
function goToday() {
  weekStart.value = startOfWeek(today)
  selectedKey.value = dayKey(today)
}

// When the visible week changes, keep a sensible selection: today when it's
// in view, otherwise the week's first day.
watch(weekStart, (ws) => {
  const days = weekDates(ws)
  if (!days.some((day) => dayKey(day) === selectedKey.value)) {
    selectedKey.value = days.some((day) => dayKey(day) === dayKey(today)) ? dayKey(today) : dayKey(days[0])
  }
})

function weekDates(ws: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(ws)
    day.setDate(day.getDate() + i)
    return day
  })
}

// Weekday initials come from Intl for the ACTIVE locale — never hardcoded.
const weekdayFmt = computed(() => new Intl.DateTimeFormat(locale.value, { weekday: 'short' }))
// The header names the month most of the visible week sits in (its middle day).
const monthAnchor = computed(() => {
  const mid = new Date(weekStart.value)
  mid.setDate(mid.getDate() + 3)
  return mid
})

// ── Data: one fetch per visible week, cached per week ───────────
const weekCache = ref(new Map<string, { tasks: Task[]; sessions: RecordingSession[] }>())
const loadError = ref(false)

async function loadWeek() {
  loadError.value = false
  const ws = weekStart.value
  const wk = dayKey(ws)
  if (weekCache.value.has(wk)) return
  try {
    const orgId = auth.activeOrgId
    const uid = auth.profile?.uid
    if (!orgId || !uid) return
    const from = Timestamp.fromDate(ws)
    const end = new Date(ws)
    end.setDate(end.getDate() + 7)
    const to = Timestamp.fromDate(end)
    const [taskSnap, sessSnap] = await Promise.all([
      getDocs(query(
        collection(db, 'tasks'),
        where('orgId', '==', orgId),
        ...(auth.isManager ? [] : [where('assigneeUid', '==', uid)]),
        where('dueAt', '>=', from),
        where('dueAt', '<', to),
        orderBy('dueAt'),
      )),
      getDocs(query(
        collection(db, 'sessions'),
        where('orgId', '==', orgId),
        where('date', '>=', from),
        where('date', '<', to),
        orderBy('date'),
      )),
    ])
    weekCache.value.set(wk, {
      tasks: taskSnap.docs.map((x) => mapTask(x.id, x.data())),
      sessions: sessSnap.docs.map((x) => mapRecordingSession(x.id, x.data())),
    })
    // Map mutation isn't deeply tracked — replace the ref so computeds re-run.
    weekCache.value = new Map(weekCache.value)
  } catch {
    loadError.value = true
  }
}
onMounted(loadWeek)
watch(weekStart, loadWeek)

const currentWeek = computed(() => weekCache.value.get(dayKey(weekStart.value)) ?? { tasks: [], sessions: [] })

interface DayCell { date: Date; key: string; count: number; isToday: boolean }
const days = computed<DayCell[]>(() =>
  weekDates(weekStart.value).map((date) => {
    const key = dayKey(date)
    const count =
      currentWeek.value.sessions.filter((s) => s.date && dayKey(s.date) === key).length +
      currentWeek.value.tasks.filter((tk) => tk.dueAt && dayKey(tk.dueAt) === key).length
    return { date, key, count, isToday: key === dayKey(today) }
  }),
)

const selectedDay = computed(() => days.value.find((day) => day.key === selectedKey.value))
const selectedSessions = computed(() =>
  currentWeek.value.sessions.filter((s) => s.date && dayKey(s.date) === selectedKey.value),
)
const selectedTasks = computed(() =>
  currentWeek.value.tasks.filter((tk) => tk.dueAt && dayKey(tk.dueAt) === selectedKey.value),
)

// ── Outward calendar sync ───────────────────────────────────────
// The token is idempotent server-side, so re-clicking is safe. The URL shows
// in a field as well — clipboard access can fail (native webviews), and the
// user may want to paste it into a different device anyway.
const feedUrl = ref('')
const { busy: linking, run: runLink } = useBusy()
async function getLink() {
  await runLink(async () => {
    const orgId = auth.activeOrgId
    if (!orgId) return
    const res = await createCalendarFeedApi(orgId)
    if (!res.ok) {
      toast.error(t(res.error.key, res.error.params ?? {}))
      return
    }
    feedUrl.value = calendarFeedUrl(res.data.token)
    await copyLink()
  })
}
async function copyLink() {
  try {
    await navigator.clipboard.writeText(feedUrl.value)
    toast.success(t('schedule.syncCopied'))
  } catch {
    // Clipboard denied — the field below stays selectable for manual copy.
  }
}
</script>

<template>
  <section>
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold tracking-tight" style="color: var(--text);">{{ t('schedule.title') }}</h1>
        <p class="mt-1 text-sm" style="color: var(--text-muted);">{{ t('schedule.subtitle') }}</p>
      </div>
      <!-- Week controls: Today · ‹ › · "August 2026" -->
      <div class="flex items-center gap-2">
        <button
          class="rounded-full border px-3 py-1 text-sm"
          style="background: var(--surface-2); color: var(--text); border-color: var(--border);"
          @click="goToday"
        >
          {{ t('schedule.today') }}
        </button>
        <button class="rounded px-2 py-1 text-sm" style="color: var(--text-muted);" :aria-label="t('schedule.prevWeek')" @click="shiftWeek(-1)">‹</button>
        <button class="rounded px-2 py-1 text-sm" style="color: var(--text-muted);" :aria-label="t('schedule.nextWeek')" @click="shiftWeek(1)">›</button>
        <span class="text-sm font-semibold capitalize" style="color: var(--text);">{{ d(monthAnchor, 'monthYear') }}</span>
      </div>
    </div>

    <div v-if="loadError" class="mt-8">
      <p class="text-sm" style="color: var(--text-muted);">{{ t('common.loadError') }}</p>
      <BaseButton class="mt-3" @click="loadWeek">{{ t('common.retry') }}</BaseButton>
    </div>

    <template v-else>
      <!-- Week strip -->
      <div class="mt-5 grid grid-cols-7 overflow-hidden rounded-xl border" style="background: var(--surface); border-color: var(--border);">
        <button
          v-for="day in days"
          :key="day.key"
          class="flex flex-col items-center gap-1 py-3 transition-colors hover:bg-[color:var(--surface-2)]"
          @click="selectedKey = day.key"
        >
          <span class="text-xs font-medium uppercase" style="color: var(--text-muted);">{{ weekdayFmt.format(day.date) }}</span>
          <span
            class="flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold"
            :style="{
              background: day.key === selectedKey ? 'var(--accent-cyan)' : 'transparent',
              color: day.key === selectedKey ? 'var(--bg)' : 'var(--text)',
              boxShadow: day.isToday && day.key !== selectedKey ? 'inset 0 0 0 1.5px var(--accent-cyan)' : 'none',
            }"
          >{{ day.date.getDate() }}</span>
          <!-- Dot + count on days with items; invisible placeholder keeps rows aligned -->
          <span
            class="flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold"
            :style="day.count
              ? { background: 'var(--surface-2)', color: 'var(--accent-cyan)' }
              : { visibility: 'hidden' }"
          >{{ day.count || 0 }}</span>
        </button>
      </div>

      <!-- Selected day -->
      <div v-if="selectedDay" class="mt-5">
        <h2 class="text-sm font-semibold uppercase tracking-wide" style="color: var(--text-muted);">
          {{ d(selectedDay.date, 'weekday') }}
        </h2>

        <p v-if="!selectedSessions.length && !selectedTasks.length" class="mt-2 text-sm" style="color: var(--text-muted);">
          {{ t('schedule.emptyDay') }}
        </p>

        <div v-else class="mt-2 space-y-1">
          <!-- Recording sessions first: a shoot day shapes the whole day -->
          <div
            v-for="sess in selectedSessions"
            :key="sess.id"
            class="rounded-lg border px-3 py-2"
            style="background: var(--surface-2); border-color: var(--border);"
          >
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="text-sm font-medium" style="color: var(--text);">
                <span class="mr-2 text-xs font-semibold uppercase" style="color: var(--accent-amber);">{{ t('schedule.sessionsLabel') }}</span>
                {{ sess.name }}
              </span>
              <span v-if="sess.location" class="text-xs" style="color: var(--text-muted);">📍 {{ sess.location }}</span>
            </div>
            <p v-if="sess.notes" class="mt-1 text-xs" style="color: var(--text-muted);">{{ sess.notes }}</p>
          </div>

          <!-- Tasks due -->
          <RouterLink
            v-for="tk in selectedTasks"
            :key="tk.id"
            :to="{ name: 'task', params: { taskId: tk.id } }"
            class="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 transition-colors hover:bg-[color:var(--surface-2)]"
            style="background: var(--surface); border-color: var(--border);"
          >
            <span class="text-sm" style="color: var(--text);">{{ tk.title }}</span>
            <span class="flex items-center gap-1.5 text-xs" style="color: var(--text-muted);">
              <span class="h-1.5 w-1.5 rounded-full" :style="{ background: statusColor(tk.status) }" />
              {{ t(statusKey(tk.status)) }}
            </span>
          </RouterLink>
        </div>
      </div>

      <!-- Sync outward to a personal calendar -->
      <div class="mt-8 rounded-xl border p-4" style="background: var(--surface); border-color: var(--border);">
        <h2 class="text-sm font-semibold" style="color: var(--text);">{{ t('schedule.syncTitle') }}</h2>
        <p class="mt-1 text-xs" style="color: var(--text-muted);">{{ t('schedule.syncBody') }}</p>
        <div v-if="feedUrl" class="mt-3 flex flex-wrap items-center gap-2">
          <BaseInput :model-value="feedUrl" readonly class="min-w-0 flex-1 text-xs" @focus="($event.target as HTMLInputElement).select()" />
          <BaseButton class="text-xs" @click="copyLink">{{ t('schedule.syncCopy') }}</BaseButton>
        </div>
        <BaseButton v-else class="mt-3 text-xs" :disabled="linking" @click="getLink">
          {{ linking ? t('common.loading') : t('schedule.syncButton') }}
        </BaseButton>
        <p v-if="feedUrl" class="mt-2 text-xs" style="color: var(--accent-amber);">{{ t('schedule.syncPrivacy') }}</p>
      </div>
    </template>
  </section>
</template>
