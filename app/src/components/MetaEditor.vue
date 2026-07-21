<script setup lang="ts">
// Editable list of label/value pairs. v-model:modelValue is MetaField[].
// Reused for client metadata, project metadata, task metadata, and brief
// fields. `suggestions` renders one-click chips that prefill a row's label
// (and focus its value input) — each chip hides once a field with that
// label exists, so the list stays honest.
import { nextTick, ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { MetaField } from '../lib/types'

const props = withDefaults(
  defineProps<{ modelValue: MetaField[]; suggestions?: string[] }>(),
  { suggestions: () => [] },
)
const emit = defineEmits<{ 'update:modelValue': [MetaField[]] }>()
const { t } = useI18n()

const valueInputs = ref<HTMLInputElement[]>([])

const availableSuggestions = computed(() => {
  const used = new Set(props.modelValue.map((f) => f.label.trim().toLowerCase()))
  return props.suggestions.filter((s) => !used.has(s.trim().toLowerCase()))
})

function update(i: number, key: keyof MetaField, val: string) {
  emit('update:modelValue', props.modelValue.map((f, idx) => (idx === i ? { ...f, [key]: val } : f)))
}
function add() {
  emit('update:modelValue', [...props.modelValue, { label: '', value: '' }])
}
async function addSuggested(label: string) {
  emit('update:modelValue', [...props.modelValue, { label, value: '' }])
  // The label is already filled in — put the cursor where the typing happens.
  await nextTick()
  valueInputs.value[valueInputs.value.length - 1]?.focus()
}
function remove(i: number) {
  emit('update:modelValue', props.modelValue.filter((_, idx) => idx !== i))
}
</script>

<template>
  <div class="space-y-2">
    <div v-for="(f, i) in modelValue" :key="i" class="flex items-center gap-2">
      <input
        :value="f.label"
        :placeholder="t('actions.fieldLabel')"
        class="w-1/3 rounded-lg border px-2 py-1.5 text-sm outline-none"
        style="background: var(--surface-2); color: var(--text); border-color: var(--border);"
        @input="update(i, 'label', ($event.target as HTMLInputElement).value)"
      />
      <input
        ref="valueInputs"
        :value="f.value"
        :placeholder="t('actions.fieldValue')"
        class="flex-1 rounded-lg border px-2 py-1.5 text-sm outline-none"
        style="background: var(--surface-2); color: var(--text); border-color: var(--border);"
        @input="update(i, 'value', ($event.target as HTMLInputElement).value)"
      />
      <button
        type="button"
        class="shrink-0 rounded px-2 py-1 text-sm"
        style="color: var(--accent-amber);"
        :aria-label="t('actions.remove')"
        @click="remove(i)"
      >
        ✕
      </button>
    </div>

    <div class="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        class="rounded-lg border border-dashed px-3 py-1.5 text-xs"
        style="color: var(--text-muted); border-color: var(--border);"
        @click="add"
      >
        + {{ t('actions.addField') }}
      </button>
      <!-- One-click field suggestions -->
      <button
        v-for="s in availableSuggestions"
        :key="s"
        type="button"
        class="rounded-full border px-2.5 py-1 text-xs transition-colors hover:border-[color:var(--accent-cyan)] hover:text-[color:var(--accent-cyan)]"
        style="color: var(--text-muted); border-color: var(--border); background: var(--surface-2);"
        @click="addSuggested(s)"
      >
        + {{ s }}
      </button>
    </div>
  </div>
</template>
