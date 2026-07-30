<script setup lang="ts">
// The workspace's workflow pipeline (orgs/{orgId}.pipeline) — one ordered
// stage list per workspace, edited by managers. Every deliverable created
// afterwards instantiates one task per stage; deliverables already in flight
// carry their own stage snapshot and are untouched by edits here.
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '../stores/auth'
import { useDataStore } from '../stores/data'
import { useToastStore } from '../stores/toast'
import { useBusy } from '../composables/useBusy'
import { track } from '../lib/analytics'
import {
  HOURS_PER_DAY,
  MAX_STAGES,
  MAX_STAGE_DURATION_HOURS,
  STAGE_NAME_MAX,
  WorkflowPipelineSchema,
} from '../lib/types'
import type { WorkflowStage } from '../lib/types'
import BaseButton from './BaseButton.vue'
import BaseInput from './BaseInput.vue'

const { t } = useI18n()
const auth = useAuthStore()
const data = useDataStore()
const toast = useToastStore()

type DurationUnit = 'hours' | 'days'

const live = computed<WorkflowStage[]>(() => auth.org?.pipeline?.stages ?? [])

// Draft copy: every edit is local until Save, so removals stay undoable and a
// half-finished pipeline is never written. Syncs from the live doc until the
// first keystroke, then stops — another manager's write must not clobber an
// edit in progress (same pattern as the workspace rename on SettingsPage).
const draft = ref<WorkflowStage[]>([])
const userEditing = ref(false)

// ── Stage durations ─────────────────────────────────────────────────────────
// durationHours on the draft is the stored truth; this only remembers how each
// number was phrased, since "2 days" and "48 hours" are the same stored value
// and we want the field to read back the way it was typed.
const durationInputs = ref<Record<string, { value: number; unit: DurationUnit }>>({})

function phraseDuration(hours: number): { value: number; unit: DurationUnit } {
  // Whole days read as days; anything else stays in hours. Unset defaults to
  // days — agencies quote stage lengths in days far more often than hours.
  if (hours > 0 && hours % HOURS_PER_DAY === 0) return { value: hours / HOURS_PER_DAY, unit: 'days' }
  if (hours > 0) return { value: hours, unit: 'hours' }
  return { value: 0, unit: 'days' }
}

function syncDurationInputs(): void {
  const next: Record<string, { value: number; unit: DurationUnit }> = {}
  for (const s of draft.value) next[s.id] = phraseDuration(s.durationHours)
  durationInputs.value = next
}

function durationInput(stageId: string): { value: number; unit: DurationUnit } {
  return durationInputs.value[stageId] ?? { value: 0, unit: 'days' }
}

// Declared AFTER durationInputs on purpose: this watch is `immediate`, so it
// runs during setup and would hit the temporal dead zone of any `const` it
// touches that is declared below it.
watch(live, (stages) => {
  if (userEditing.value) return
  draft.value = stages.map((s) => ({ ...s }))
  syncDurationInputs()
}, { immediate: true })

function edited(): void {
  userEditing.value = true
}

// Switching the unit re-reads the same number in the new unit ("2 days" →
// "2 hours") rather than converting it — the row is answering a question, and
// changing the unit changes the answer.
function setDuration(stage: WorkflowStage, patch: Partial<{ value: number; unit: DurationUnit }>): void {
  const next = { ...durationInput(stage.id), ...patch }
  // A number input hands back NaN when cleared, and '-' while being typed.
  next.value = Number.isFinite(next.value) ? Math.max(0, Math.floor(next.value)) : 0
  durationInputs.value = { ...durationInputs.value, [stage.id]: next }
  const hours = next.unit === 'days' ? next.value * HOURS_PER_DAY : next.value
  stage.durationHours = Math.min(hours, MAX_STAGE_DURATION_HOURS)
  edited()
}

const totalHours = computed(() => draft.value.reduce((sum, s) => sum + (s.durationHours || 0), 0))

// "6d", "4h", "6d 4h" — compact enough to sit under the list in any locale.
const totalSpan = computed(() => {
  const days = Math.floor(totalHours.value / HOURS_PER_DAY)
  const hours = totalHours.value % HOURS_PER_DAY
  if (days && hours) return t('workflow.spanDaysHours', { days, hours })
  if (days) return t('workflow.spanDays', { days })
  return t('workflow.spanHours', { hours })
})

// What actually gets saved: names are stored trimmed, so validation and the
// dirty check must both judge the trimmed form.
function trimmed(): WorkflowStage[] {
  return draft.value.map((s) => ({ ...s, name: s.name.trim() }))
}

// Order- and key-order-independent comparison, so a Firestore field ordering
// that differs from ours can't report a pristine pipeline as dirty.
function serialize(stages: WorkflowStage[]): string {
  return JSON.stringify(stages.map((s) => [s.id, s.name.trim(), s.optional, s.clientFacing, s.durationHours]))
}
const dirty = computed(() => serialize(draft.value) !== serialize(live.value))

// The same schema the store enforces before writing — so Save can never be
// enabled for a pipeline the write path would reject. The two predicates below
// exist only to say WHICH rule is unmet; this decides whether it saves.
const valid = computed(() => WorkflowPipelineSchema.safeParse({ stages: trimmed() }).success)
const hasEmptyName = computed(() => draft.value.some((s) => !s.name.trim()))
const tooMany = computed(() => draft.value.length > MAX_STAGES)
// Informational only — never blocks saving. An agency that approves out of
// band legitimately has no client-facing stage.
const noClientFacing = computed(() => draft.value.length > 0 && !draft.value.some((s) => s.clientFacing))

// Stages the draft drops that the saved pipeline still has. Deliverables
// already in flight keep their own stage snapshot — and therefore their tasks
// for these stages — so removal is safe, but saying so beats leaving a manager
// to wonder what happened to the work sitting in a stage they just deleted.
const removedStageNames = computed(() => {
  const draftIds = new Set(draft.value.map((s) => s.id))
  return live.value.filter((s) => !draftIds.has(s.id)).map((s) => s.name).filter(Boolean)
})

// Ids are referenced by deliverable snapshots and task.stageId, so they are
// random and permanent — never derived from the name, which renames freely.
// Math.random over crypto.randomUUID: the latter is undefined outside secure
// contexts, and the dev server is reachable over plain http on the LAN.
function newStageId(): string {
  const taken = new Set(draft.value.map((s) => s.id))
  let id = ''
  do {
    id = `s_${Math.random().toString(36).slice(2, 10)}`
  } while (taken.has(id))
  return id
}

function move(index: number, delta: number): void {
  const next = index + delta
  if (next < 0 || next >= draft.value.length) return
  const arr = draft.value
  ;[arr[index], arr[next]] = [arr[next], arr[index]]
  edited()
}

function addStage(): void {
  if (draft.value.length >= MAX_STAGES) return
  const stage: WorkflowStage = { id: newStageId(), name: '', optional: false, clientFacing: false, durationHours: 0 }
  draft.value.push(stage)
  durationInputs.value = { ...durationInputs.value, [stage.id]: phraseDuration(0) }
  edited()
}

function removeStage(index: number): void {
  if (draft.value.length <= 1) return
  draft.value.splice(index, 1)
  edited()
}

const { busy, run } = useBusy()

async function save(): Promise<void> {
  if (!dirty.value || !valid.value) return
  const stages = trimmed()
  await run(async () => {
    // Throws on failure (the store's guarded() has already toasted) — the
    // draft and userEditing survive so the edit can be retried.
    await data.updateOrgPipeline(stages)
    track('pipeline_updated', { stageCount: stages.length })
    toast.success(t('workflow.saved'))
    draft.value = stages.map((s) => ({ ...s }))
    syncDurationInputs()
    userEditing.value = false
  })
}
</script>

<template>
  <div>
    <p class="mt-1 text-sm" style="color: var(--text-muted);">{{ t('workflow.hint') }}</p>

    <ul class="mt-3 space-y-2">
      <li
        v-for="(stage, i) in draft"
        :key="stage.id"
        class="rounded-lg border p-3"
        style="background: var(--surface-2); border-color: var(--border);"
      >
        <div class="flex items-center gap-2">
          <span class="w-4 shrink-0 text-xs tabular-nums" style="color: var(--text-muted);">{{ i + 1 }}</span>
          <BaseInput
            v-model="stage.name"
            class="flex-1"
            :maxlength="STAGE_NAME_MAX"
            :aria-label="t('workflow.stageName')"
            :placeholder="t('workflow.stageNamePlaceholder')"
            @update:model-value="edited"
          />
          <!-- Reorder/remove: plain icon buttons with accessible labels. -->
          <button
            type="button"
            class="rounded-lg border px-2 py-1 text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style="background: var(--surface); color: var(--text); border-color: var(--border);"
            :disabled="i === 0"
            :aria-label="t('workflow.moveUp')"
            :title="t('workflow.moveUp')"
            @click="move(i, -1)"
          >↑</button>
          <button
            type="button"
            class="rounded-lg border px-2 py-1 text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style="background: var(--surface); color: var(--text); border-color: var(--border);"
            :disabled="i === draft.length - 1"
            :aria-label="t('workflow.moveDown')"
            :title="t('workflow.moveDown')"
            @click="move(i, 1)"
          >↓</button>
          <button
            type="button"
            class="rounded-lg border px-2 py-1 text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style="background: var(--surface); color: var(--accent-amber); border-color: var(--border);"
            :disabled="draft.length <= 1"
            :aria-label="t('workflow.remove')"
            :title="t('workflow.remove')"
            @click="removeStage(i)"
          >✕</button>
        </div>

        <!-- Duration: drives the stage's derived deadline when a deliverable
             is scheduled. 0 leaves the stage taking no time. -->
        <div class="mt-2 flex flex-wrap items-center gap-2 pl-6 text-xs">
          <span style="color: var(--text-muted);">{{ t('workflow.durationQuestion') }}</span>
          <input
            type="number"
            min="0"
            :max="MAX_STAGE_DURATION_HOURS"
            class="w-16 rounded-lg border px-2 py-1 text-sm outline-none"
            style="background: var(--surface); color: var(--text); border-color: var(--border);"
            :value="durationInput(stage.id).value"
            :aria-label="t('workflow.durationQuestion')"
            @input="setDuration(stage, { value: Number(($event.target as HTMLInputElement).value) })"
          />
          <select
            class="rounded-lg border px-2 py-1 text-sm outline-none"
            style="background: var(--surface); color: var(--text); border-color: var(--border);"
            :value="durationInput(stage.id).unit"
            :aria-label="t('workflow.durationUnit')"
            @change="setDuration(stage, { unit: ($event.target as HTMLSelectElement).value as DurationUnit })"
          >
            <option value="days">{{ t('workflow.unitDays') }}</option>
            <option value="hours">{{ t('workflow.unitHours') }}</option>
          </select>
          <span v-if="durationInput(stage.id).value === 0" style="color: var(--text-muted);">
            {{ t('workflow.durationUnsetHint') }}
          </span>
        </div>

        <div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 pl-6 text-xs">
          <label class="inline-flex items-center gap-1.5" :title="t('workflow.optionalHint')">
            <input v-model="stage.optional" type="checkbox" @change="edited" />
            <span style="color: var(--text-muted);">{{ t('workflow.optionalLabel') }}</span>
          </label>
          <label class="inline-flex items-center gap-1.5" :title="t('workflow.clientFacingHint')">
            <input v-model="stage.clientFacing" type="checkbox" @change="edited" />
            <span style="color: var(--text-muted);">{{ t('workflow.clientFacingLabel') }}</span>
          </label>
        </div>
      </li>
    </ul>

    <p v-if="totalHours > 0" class="mt-2 text-xs" style="color: var(--text-muted);">
      {{ t('workflow.totalHint', { span: totalSpan }) }}
    </p>

    <!-- Spells out the snapshot behaviour at the moment it starts to matter.
         Deliverables carry their own copy of the stages, so none of this
         reaches work that already exists — including the redo caveat. -->
    <div
      v-if="dirty"
      class="mt-3 rounded-lg border p-3"
      style="background: var(--surface-2); border-color: var(--border);"
    >
      <p class="text-xs font-medium" style="color: var(--text);">{{ t('workflow.changesTitle') }}</p>
      <ul class="mt-1 list-disc space-y-1 pl-4 text-xs" style="color: var(--text-muted);">
        <li>{{ t('workflow.changesExisting') }}</li>
        <li>{{ t('workflow.changesRenames') }}</li>
        <li>{{ t('workflow.changesDurations') }}</li>
        <li>{{ t('workflow.changesRedo') }}</li>
      </ul>
    </div>

    <div class="mt-3 flex flex-wrap items-center gap-3">
      <BaseButton :disabled="draft.length >= MAX_STAGES || busy" @click="addStage">
        {{ t('workflow.addStage') }}
      </BaseButton>
      <BaseButton :disabled="busy || !dirty || !valid" @click="save">
        {{ busy ? t('common.loading') : t('workflow.saveCta') }}
      </BaseButton>
    </div>

    <p v-if="hasEmptyName" class="mt-2 text-xs" style="color: var(--text-muted);">{{ t('workflow.emptyName') }}</p>
    <p v-if="tooMany" class="mt-2 text-xs" style="color: var(--accent-amber);">
      {{ t('workflow.maxStages', { max: MAX_STAGES }) }}
    </p>
    <p v-if="noClientFacing" class="mt-2 text-xs" style="color: var(--accent-amber);">
      {{ t('workflow.noClientFacing') }}
    </p>
    <p v-if="removedStageNames.length" class="mt-2 text-xs" style="color: var(--accent-amber);">
      {{ t('workflow.removedWarning', { stages: removedStageNames.join(', ') }) }}
    </p>
  </div>
</template>
