<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import BaseButton from './BaseButton.vue'

// Standard modal footer: muted cancel + primary submit. Place it inside a
// <form @submit.prevent="…"> — the primary button prevents native submission
// and emits `submit`, so implicit (Enter) submission still works via the form.
withDefaults(defineProps<{ label: string; busy?: boolean; disabled?: boolean }>(), {
  busy: false,
  disabled: false,
})
const emit = defineEmits<{ cancel: []; submit: [] }>()

const { t } = useI18n()
</script>

<template>
  <div class="flex justify-end gap-2 pt-2">
    <button type="button" class="rounded-lg px-3 py-2 text-sm" style="color: var(--text-muted);" @click="emit('cancel')">
      {{ t('actions.cancel') }}
    </button>
    <BaseButton type="submit" :disabled="busy || disabled" @click.prevent="emit('submit')">
      {{ busy ? t('common.loading') : label }}
    </BaseButton>
  </div>
</template>
