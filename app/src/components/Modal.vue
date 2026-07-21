<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

// Reusable modal: teleported to <body>, backdrop-dismiss, esc-to-close, a fade
// + scale entrance, and focus management (focus in on open, restore on close,
// Tab trapped inside). `size` widens the panel for dense content (wizards).
const props = withDefaults(
  defineProps<{ open: boolean; title?: string; size?: 'md' | 'lg' }>(),
  { size: 'md' },
)
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()

const cardEl = ref<HTMLElement | null>(null)
let lastFocused: HTMLElement | null = null

function focusables(): HTMLElement[] {
  if (!cardEl.value) return []
  return Array.from(
    cardEl.value.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  )
}

watch(
  () => props.open,
  (o) => {
    if (o) {
      lastFocused = document.activeElement as HTMLElement | null
      nextTick(() => focusables()[0]?.focus())
    } else {
      lastFocused?.focus?.()
    }
  },
)

function onTab(e: KeyboardEvent) {
  const items = focusables()
  if (!items.length) return
  const first = items[0]
  const last = items[items.length - 1]
  const active = document.activeElement
  if (e.shiftKey && active === first) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && active === last) {
    e.preventDefault()
    first.focus()
  }
}
</script>

<template>
  <!-- Recipe 6 in transitions.css: shared overlay fade + panel pop. -->
  <Teleport to="body">
    <Transition name="overlay">
      <div
        v-if="open"
        class="fixed inset-0 z-50 flex items-center justify-center p-4"
        @keydown.esc="emit('close')"
        @keydown.tab="onTab"
      >
        <div class="absolute inset-0" style="background: rgba(0,0,0,0.6);" @click="emit('close')" />
        <div
          ref="cardEl"
          class="overlay-panel relative w-full rounded-2xl border p-5"
          :class="size === 'lg' ? 'max-w-2xl' : 'max-w-md'"
          style="background: var(--surface); border-color: var(--border);"
          role="dialog"
          aria-modal="true"
        >
          <div class="mb-4 flex items-center justify-between">
            <h2 class="text-lg" style="color: var(--text);">{{ title }}</h2>
            <button class="text-sm" style="color: var(--text-muted);" :aria-label="t('common.close')" @click="emit('close')">✕</button>
          </div>
          <slot />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
