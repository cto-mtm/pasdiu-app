<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useDataStore } from '../stores/data'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const router = useRouter()
const data = useDataStore()

const term = ref('')
const activeIndex = ref(0)
const inputEl = ref<HTMLInputElement | null>(null)

// No private "already loaded" flag: this component outlives every page (it
// lives in AppShell), so a permanent one would pin the palette to whatever the
// store held the first time it opened — including a set the board's sub-group
// paging has since pruned. loadWorkspace() is memoized with a TTL and is a
// no-op while fresh, so asking on every open is both cheap and correct.
async function ensureLoaded() {
  await data.loadWorkspace()
}

// Focus the field and preload data whenever the palette opens.
watch(
  () => props.open,
  (o) => {
    if (o) {
      term.value = ''
      activeIndex.value = 0
      ensureLoaded()
      nextTick(() => inputEl.value?.focus())
    }
  },
)
// Keep the highlight in range as the query changes.
watch(term, () => { activeIndex.value = 0 })

interface Hit { label: string; sub: string; to: { name: string; params: Record<string, string> } }

const results = computed<Hit[]>(() => {
  const q = term.value.trim().toLowerCase()
  if (!q) return []
  const hits: Hit[] = []
  for (const c of data.clients)
    if (c.name.toLowerCase().includes(q))
      hits.push({ label: c.name, sub: t('search.client'), to: { name: 'client', params: { clientId: c.id } } })
  for (const p of data.projects)
    if (p.name.toLowerCase().includes(q))
      hits.push({ label: p.name, sub: t('search.project'), to: { name: 'project', params: { projectId: p.id } } })
  for (const u of Object.values(data.usersById))
    if (u.displayName.toLowerCase().includes(q))
      hits.push({ label: u.displayName, sub: t('search.employee'), to: { name: 'team-member', params: { uid: u.uid } } })
  for (const tk of data.tasks)
    if (tk.title.toLowerCase().includes(q))
      hits.push({ label: tk.title, sub: t('search.task'), to: { name: 'task', params: { taskId: tk.id } } })
  return hits.slice(0, 10)
})

function go(hit: Hit) {
  emit('close')
  router.push(hit.to)
}
function move(delta: number) {
  const n = results.value.length
  if (!n) return
  activeIndex.value = (activeIndex.value + delta + n) % n
}
function onEnter() {
  const hit = results.value[activeIndex.value]
  if (hit) go(hit)
}
</script>

<template>
  <!-- Recipe 6 in transitions.css: shared overlay fade + panel pop. -->
  <Teleport to="body">
    <Transition name="overlay">
      <div v-if="open" class="fixed inset-0 z-50 flex items-start justify-center p-4 pt-24" @keydown.esc="emit('close')">
        <div class="absolute inset-0" style="background: rgba(0,0,0,0.6);" @click="emit('close')" />
        <div
          class="overlay-panel relative w-full max-w-lg overflow-hidden rounded-2xl border"
          style="background: var(--surface); border-color: var(--border);"
          role="dialog"
          aria-modal="true"
        >
          <div class="flex items-center gap-2 border-b px-4" style="border-color: var(--border);">
            <svg viewBox="0 0 24 24" class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text-muted);">
              <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
            </svg>
            <!-- The global :focus-visible ring is suppressed here: the input is
                 auto-focused on open, so the ring would always be lit — and the
                 dialog itself already communicates focus. -->
            <input
              ref="inputEl"
              v-model="term"
              type="search"
              :placeholder="t('search.placeholder')"
              class="w-full bg-transparent py-3 text-sm outline-none"
              style="color: var(--text); outline: none;"
              @keydown.down.prevent="move(1)"
              @keydown.up.prevent="move(-1)"
              @keydown.enter.prevent="onEnter"
            />
            <kbd class="hidden rounded px-1.5 py-0.5 text-xs sm:inline" style="background: var(--surface-2); color: var(--text-muted);">{{ t('search.escHint') }}</kbd>
          </div>

          <ul v-if="results.length" class="max-h-80 overflow-y-auto py-1">
            <li v-for="(hit, i) in results" :key="i">
              <button
                class="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm transition-colors"
                :style="{ background: i === activeIndex ? 'var(--surface-2)' : 'transparent' }"
                @click="go(hit)"
                @mouseenter="activeIndex = i"
              >
                <span style="color: var(--text);">{{ hit.label }}</span>
                <span class="text-xs" style="color: var(--text-muted);">{{ hit.sub }}</span>
              </button>
            </li>
          </ul>
          <p v-else-if="term.trim()" class="px-4 py-6 text-center text-sm" style="color: var(--text-muted);">
            {{ t('search.noResults') }}
          </p>
          <p v-else class="px-4 py-6 text-center text-sm" style="color: var(--text-muted);">
            {{ t('search.hint') }}
          </p>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
