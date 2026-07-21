<script setup lang="ts">
import { computed } from 'vue'

// Horizontal bar chart. Bars are {label, value, color?, id?}. Bars with an id
// are clickable and emit 'select'. Animates the fill via transform: scaleX()
// (compositor-friendly — never width).
interface Bar { id?: string; label: string; value: number; color?: string }
const props = defineProps<{ bars: Bar[] }>()
const emit = defineEmits<{ select: [id: string] }>()

const max = computed(() => Math.max(1, ...props.bars.map((b) => b.value)))

function pick(id?: string) {
  if (id) emit('select', id)
}
</script>

<template>
  <div class="space-y-2">
    <component
      :is="b.id ? 'button' : 'div'"
      v-for="b in bars"
      :key="b.label"
      class="flex w-full items-center gap-3 rounded text-left"
      :class="{ 'transition-colors hover:bg-[color:var(--surface-2)]': b.id }"
      @click="pick(b.id)"
    >
      <span class="w-28 shrink-0 truncate text-xs" style="color: var(--text-muted);" :title="b.label">{{ b.label }}</span>
      <div class="h-3 flex-1 overflow-hidden rounded-full" style="background: var(--surface-2);">
        <div
          class="bar-fill h-full w-full rounded-full"
          :style="{ transform: `scaleX(${b.value / max})`, background: b.color ?? 'var(--accent-cyan)' }"
        />
      </div>
      <span class="w-6 shrink-0 text-right text-xs" style="color: var(--text);">{{ b.value }}</span>
    </component>
  </div>
</template>

<style scoped>
.bar-fill {
  transform-origin: left;
  transition: transform 300ms cubic-bezier(0.4, 0, 0.2, 1);
}
@media (prefers-reduced-motion: reduce) {
  .bar-fill {
    transition: none;
  }
}
</style>
