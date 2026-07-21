<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

// Three-dot overflow menu for secondary actions that would crowd a toolbar.
// The default slot renders the menu items (buttons with role="menuitem");
// any click inside the menu closes it. Outside clicks hit the transparent
// backdrop; Escape closes from the trigger.
const open = ref(false)
const { t } = useI18n()
function close() {
  open.value = false
}
</script>

<template>
  <div class="relative">
    <button
      type="button"
      class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border"
      style="background: var(--surface-2); color: var(--text); border-color: var(--border);"
      aria-haspopup="menu"
      :aria-expanded="open"
      :aria-label="t('common.moreActions')"
      :title="t('common.moreActions')"
      @click="open = !open"
      @keydown.escape="close"
    >
      <svg viewBox="0 0 24 24" class="h-4 w-4" fill="currentColor" aria-hidden="true">
        <circle cx="5" cy="12" r="1.8" />
        <circle cx="12" cy="12" r="1.8" />
        <circle cx="19" cy="12" r="1.8" />
      </svg>
    </button>

    <!-- Transparent backdrop: any outside click closes the menu. -->
    <div v-if="open" class="fixed inset-0 z-10" @click="close" />

    <div
      v-if="open"
      role="menu"
      class="absolute right-0 z-20 mt-1 min-w-48 overflow-hidden rounded-lg border py-1 shadow-lg"
      style="background: var(--surface); border-color: var(--border);"
      @click="close"
      @keydown.escape="close"
    >
      <slot />
    </div>
  </div>
</template>
