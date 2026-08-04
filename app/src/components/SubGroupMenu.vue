<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import OverflowMenu from './OverflowMenu.vue'

// Per-sub-group manager actions. Previously a bare ✎ next to the heading in
// one view and nothing at all in the others, which made sub-group editing
// effectively undiscoverable — this is the same ⋯ affordance the board
// toolbar already uses, so it reads as "there are actions here".
const emit = defineEmits<{ edit: []; brief: []; delete: [] }>()
const { t } = useI18n()
</script>

<template>
  <OverflowMenu>
    <button
      role="menuitem"
      class="block w-full whitespace-nowrap px-3 py-2 text-left text-sm transition-colors hover:bg-[color:var(--surface-2)]"
      style="color: var(--text);"
      @click="emit('edit')"
    >
      {{ t('board.editSubGroup') }}
    </button>
    <button
      role="menuitem"
      class="block w-full whitespace-nowrap px-3 py-2 text-left text-sm transition-colors hover:bg-[color:var(--surface-2)]"
      style="color: var(--text);"
      @click="emit('brief')"
    >
      {{ t('brief.open') }}
    </button>
    <button
      role="menuitem"
      class="block w-full whitespace-nowrap px-3 py-2 text-left text-sm transition-colors hover:bg-[color:var(--surface-2)]"
      style="color: var(--accent-amber);"
      @click="emit('delete')"
    >
      {{ t('actions.deleteSubGroup') }}
    </button>
  </OverflowMenu>
</template>
