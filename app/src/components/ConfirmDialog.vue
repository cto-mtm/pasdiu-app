<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import Modal from './Modal.vue'

// Reusable confirm dialog. `danger` styles the confirm button for destructive
// actions (deletes). The default slot renders extra content (e.g. an input)
// between the message and the buttons; `confirmDisabled` gates the confirm
// button while that content is incomplete.
withDefaults(
  defineProps<{
    open: boolean; title: string; message: string
    danger?: boolean; confirmLabel?: string; confirmDisabled?: boolean
  }>(),
  { danger: false, confirmDisabled: false },
)
const emit = defineEmits<{ confirm: []; cancel: [] }>()
const { t } = useI18n()
</script>

<template>
  <Modal :open="open" :title="title" @close="emit('cancel')">
    <p class="text-sm" style="color: var(--text);">{{ message }}</p>
    <slot />
    <div class="mt-4 flex justify-end gap-2">
      <button type="button" class="rounded-lg px-3 py-2 text-sm" style="color: var(--text-muted);" @click="emit('cancel')">
        {{ t('actions.cancel') }}
      </button>
      <button
        type="button"
        class="rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50"
        :style="{ background: danger ? 'var(--accent-amber)' : 'var(--accent-cyan)', color: 'var(--bg)' }"
        :disabled="confirmDisabled"
        @click="emit('confirm')"
      >
        {{ confirmLabel ?? t('actions.confirm') }}
      </button>
    </div>
  </Modal>
</template>
