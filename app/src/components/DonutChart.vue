<script setup lang="ts">
import { computed } from 'vue'

// Dependency-free SVG donut. Segments are {label, value, color}. Renders the
// ring + a centered total + a legend. Arcs update instantly — animating
// stroke-dasharray would break the transform/opacity-only rule.
interface Segment { id?: string; label: string; value: number; color: string }
const props = defineProps<{
  segments: Segment[]
  centerLabel?: string
}>()
const emit = defineEmits<{ select: [id: string] }>()

const R = 54
const C = 2 * Math.PI * R

const total = computed(() => props.segments.reduce((sum, s) => sum + s.value, 0))

const arcs = computed(() => {
  let acc = 0
  return props.segments
    .filter((s) => s.value > 0)
    .map((s) => {
      const len = (s.value / total.value) * C
      const arc = { id: s.id, color: s.color, dash: `${len} ${C - len}`, offset: -acc }
      acc += len
      return arc
    })
})

function pick(id?: string) {
  if (id) emit('select', id)
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-6">
    <svg viewBox="0 0 140 140" class="h-40 w-40 shrink-0">
      <g transform="rotate(-90 70 70)">
        <!-- Track -->
        <circle cx="70" cy="70" :r="R" fill="none" stroke="var(--surface-2)" stroke-width="16" />
        <!-- Segments -->
        <circle
          v-for="(a, i) in arcs"
          :key="i"
          :class="{ 'cursor-pointer': a.id }"
          cx="70"
          cy="70"
          :r="R"
          fill="none"
          :stroke="a.color"
          stroke-width="16"
          :stroke-dasharray="a.dash"
          :stroke-dashoffset="a.offset"
          @click="pick(a.id)"
        />
      </g>
      <text x="70" y="66" text-anchor="middle" style="fill: var(--text); font-size: 22px; font-weight: 700;">{{ total }}</text>
      <text x="70" y="84" text-anchor="middle" style="fill: var(--text-muted); font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em;">
        {{ centerLabel }}
      </text>
    </svg>

    <ul class="space-y-1.5 text-sm">
      <li v-for="s in segments" :key="s.label">
        <button
          class="flex items-center gap-2 rounded px-1 py-0.5 text-left transition-colors"
          :class="{ 'hover:bg-[color:var(--surface-2)]': s.id }"
          :disabled="!s.id"
          @click="pick(s.id)"
        >
          <span class="h-2.5 w-2.5 rounded-full" :style="{ background: s.color }" />
          <span style="color: var(--text-muted);">{{ s.label }}</span>
          <span class="font-medium" style="color: var(--text);">{{ s.value }}</span>
        </button>
      </li>
    </ul>
  </div>
</template>

