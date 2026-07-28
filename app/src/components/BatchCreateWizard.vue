<script setup lang="ts">
// BatchCreateWizard — multi-step flow for creating deliverables in bulk.
// Steps: count/names → sub-group → assignees → due → preview → confirm.
// The preview step takes a plan object so phase 5's AI assistant can reuse it.
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDataStore } from '../stores/data'
import { useAuthStore } from '../stores/auth'
import { useToastStore } from '../stores/toast'
import { useBusy } from '../composables/useBusy'
import { apiFetch } from '../lib/api'
import type { WorkflowStage } from '../lib/types'
import BaseButton from './BaseButton.vue'
import BaseInput from './BaseInput.vue'
import BaseSelect from './BaseSelect.vue'
import Modal from './Modal.vue'

const props = defineProps<{
  open: boolean
  projectId: string
}>()
const emit = defineEmits<{ close: []; created: [ids: string[]] }>()

const { t } = useI18n()
const data = useDataStore()
const auth = useAuthStore()
const toast = useToastStore()
const { busy, run } = useBusy()

// ── Wizard state ────────────────────────────────────────────────────────────
const step = ref(1)
const TOTAL_STEPS = 5

// Step 1: Type + count
const typeId = ref('')
const count = ref(5)
const namePattern = ref('')

// Step 2: Sub-group
const subGroupMode = ref<'existing' | 'new'>('existing')
const subGroupId = ref('')
const subGroupName = ref('')

// Step 3: Per-stage assignees
const stageAssignees = ref<Record<string, string[]>>({})

// Step 4: Due window
const dueStartAt = ref('')
const dueEndAt = ref('')

// Step 5: Preview + confirm (computed)

// ── Derived data ────────────────────────────────────────────────────────────
const subGroups = computed(() => data.subGroupsForProject(props.projectId))
const teamMembers = computed(() => data.teamMembers)

// Pipeline stages from org (loaded via the org doc in the store).
const pipeline = computed<WorkflowStage[]>(() => {
  const orgDoc = auth.org
  return orgDoc?.pipeline?.stages ?? []
})

// Generated names from count + pattern.
const generatedNames = computed(() => {
  const base = namePattern.value.trim() || 'Video'
  return Array.from({ length: count.value }, (_, i) => `${base} ${i + 1}`)
})

// Preview plan object (reusable by AI assistant in phase 5).
const plan = computed(() => ({
  projectId: props.projectId,
  subGroupId: subGroupMode.value === 'existing' ? subGroupId.value : undefined,
  subGroupName: subGroupMode.value === 'new' ? subGroupName.value : undefined,
  typeId: typeId.value,
  names: generatedNames.value,
  stageAssignees: stageAssignees.value,
  clientVisible: false,
  dueStartAt: dueStartAt.value || undefined,
  dueEndAt: dueEndAt.value || undefined,
  // Computed preview info:
  deliverableCount: count.value,
  taskCount: count.value * pipeline.value.length,
  stagesPerDeliverable: pipeline.value.length,
  assigneeSummary: computeAssigneeSummary(),
}))

function computeAssigneeSummary(): Record<string, number> {
  const summary: Record<string, number> = {}
  for (const stage of pipeline.value) {
    const assignees = stageAssignees.value[stage.id] ?? []
    if (assignees.length === 0) continue
    for (let i = 0; i < count.value; i++) {
      const uid = assignees[i % assignees.length]
      summary[uid] = (summary[uid] ?? 0) + 1
    }
  }
  return summary
}

// Limit check: warn in preview if the batch would exceed deliverableLimit.
const limitWarning = computed(() => {
  const orgDoc = auth.org
  const usage = auth.usage
  if (!orgDoc || !usage) return null
  const limit = orgDoc.deliverableLimit
  if (limit === -1) return null // unlimited
  const current = usage.activeDeliverables
  if (current + count.value > limit) {
    return { current, limit, wouldExceed: true }
  }
  return null
})

// ── Navigation ──────────────────────────────────────────────────────────────
function next() { if (step.value < TOTAL_STEPS) step.value++ }
function prev() { if (step.value > 1) step.value-- }

const canNext = computed(() => {
  switch (step.value) {
    case 1: return count.value > 0 && count.value <= 200
    case 2: return subGroupMode.value === 'new' ? !!subGroupName.value.trim() : !!subGroupId.value
    case 3: return true // assignees are optional
    case 4: return true // due is optional
    default: return false
  }
})

// ── Submit ──────────────────────────────────────────────────────────────────
async function submit() {
  await run(async () => {
    const orgId = auth.activeOrgId
    if (!orgId) return

    const body: Record<string, unknown> = {
      projectId: props.projectId,
      typeId: typeId.value || undefined,
      names: generatedNames.value,
      clientVisible: false,
    }
    if (subGroupMode.value === 'existing') body.subGroupId = subGroupId.value
    else body.subGroupName = subGroupName.value

    // Only include non-empty assignee lists.
    const filtered: Record<string, string[]> = {}
    for (const [stageId, uids] of Object.entries(stageAssignees.value)) {
      if (uids.length > 0) filtered[stageId] = uids
    }
    if (Object.keys(filtered).length) body.stageAssignees = filtered
    if (dueStartAt.value) body.dueStartAt = dueStartAt.value
    if (dueEndAt.value) body.dueEndAt = dueEndAt.value

    const result = await apiFetch<{ deliverableIds: string[]; deliverableCount: number; taskCount: number }>(
      `/orgs/${orgId}/deliverables/batch`,
      { method: 'POST', body: JSON.stringify(body) }
    )

    if (!result.ok) {
      toast.error(t(result.error.key, result.error.params ?? {}))
      return
    }

    toast.success(t('batchCreate.success', { count: result.data.deliverableCount, tasks: result.data.taskCount }))
    emit('created', result.data.deliverableIds)
    resetAndClose()
  })
}

function resetAndClose() {
  step.value = 1
  count.value = 5
  namePattern.value = ''
  subGroupMode.value = 'existing'
  subGroupId.value = ''
  subGroupName.value = ''
  stageAssignees.value = {}
  dueStartAt.value = ''
  dueEndAt.value = ''
  emit('close')
}

// Initialize subGroupId when opening.
watch(() => props.open, (open) => {
  if (open && subGroups.value.length) {
    subGroupId.value = subGroups.value[0].id
  }
})
</script>

<template>
  <Modal :open="open" :title="t('batchCreate.title')" @close="resetAndClose">
    <div class="space-y-4">
      <!-- Step indicator -->
      <div class="flex items-center gap-1 text-xs" style="color: var(--text-muted);">
        <span v-for="s in TOTAL_STEPS" :key="s" class="flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium"
          :style="{ background: s === step ? 'var(--accent-cyan)' : 'var(--surface-2)', color: s === step ? '#000' : 'var(--text-muted)' }">
          {{ s }}
        </span>
      </div>

      <!-- Step 1: Type + count -->
      <div v-if="step === 1" class="space-y-3">
        <label class="block">
          <span class="mb-1 block text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('batchCreate.countLabel') }}</span>
          <input v-model.number="count" type="number" min="1" max="200" class="w-full rounded-lg border px-3 py-2 text-sm outline-none" style="background: var(--surface-2); color: var(--text); border-color: var(--border);" />
        </label>
        <label class="block">
          <span class="mb-1 block text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('batchCreate.namePatternLabel') }}</span>
          <BaseInput v-model="namePattern" :placeholder="t('batchCreate.namePatternPlaceholder')" />
        </label>
        <p class="text-xs" style="color: var(--text-muted);">
          {{ t('batchCreate.namePreview', { first: generatedNames[0], last: generatedNames[generatedNames.length - 1] }) }}
        </p>
      </div>

      <!-- Step 2: Sub-group -->
      <div v-if="step === 2" class="space-y-3">
        <div class="flex gap-3">
          <label class="flex items-center gap-1">
            <input v-model="subGroupMode" type="radio" value="existing" />
            <span class="text-sm" style="color: var(--text);">{{ t('batchCreate.existingSubGroup') }}</span>
          </label>
          <label class="flex items-center gap-1">
            <input v-model="subGroupMode" type="radio" value="new" />
            <span class="text-sm" style="color: var(--text);">{{ t('batchCreate.newSubGroup') }}</span>
          </label>
        </div>
        <BaseSelect v-if="subGroupMode === 'existing'" v-model="subGroupId">
          <option v-for="sg in subGroups" :key="sg.id" :value="sg.id">{{ sg.name }}</option>
        </BaseSelect>
        <BaseInput v-else v-model="subGroupName" :placeholder="t('board.subGroupPlaceholder')" autofocus />
      </div>

      <!-- Step 3: Per-stage assignees -->
      <div v-if="step === 3" class="space-y-3">
        <p class="text-xs" style="color: var(--text-muted);">{{ t('batchCreate.assigneeHint') }}</p>
        <div v-for="stage in pipeline" :key="stage.id" class="flex items-center gap-2">
          <span class="w-24 truncate text-xs font-medium" style="color: var(--text);">{{ stage.name }}</span>
          <BaseSelect
            :model-value="(stageAssignees[stage.id] ?? [])[0] ?? ''"
            @update:model-value="(v: string) => { stageAssignees[stage.id] = v ? [v] : [] }"
          >
            <option value="">{{ t('batchCreate.unassigned') }}</option>
            <option v-for="m in teamMembers" :key="m.uid" :value="m.uid">{{ m.displayName }}</option>
          </BaseSelect>
        </div>
      </div>

      <!-- Step 4: Due window -->
      <div v-if="step === 4" class="space-y-3">
        <label class="block">
          <span class="mb-1 block text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('batchCreate.dueStart') }}</span>
          <BaseInput v-model="dueStartAt" type="date" />
        </label>
        <label class="block">
          <span class="mb-1 block text-xs uppercase tracking-wide" style="color: var(--text-muted);">{{ t('batchCreate.dueEnd') }}</span>
          <BaseInput v-model="dueEndAt" type="date" />
        </label>
      </div>

      <!-- Step 5: Preview -->
      <div v-if="step === 5" class="space-y-3">
        <!-- Limit warning -->
        <div v-if="limitWarning" class="rounded-lg border p-3" style="background: var(--accent-amber); border-color: var(--accent-amber); color: #000;">
          <p class="text-sm font-medium">{{ t('batchCreate.limitWarning', { current: limitWarning.current, limit: limitWarning.limit }) }}</p>
        </div>
        <div class="rounded-lg border p-3" style="background: var(--surface-2); border-color: var(--border);">
          <dl class="space-y-1 text-sm">
            <div class="flex justify-between">
              <dt style="color: var(--text-muted);">{{ t('batchCreate.previewDeliverables') }}</dt>
              <dd style="color: var(--text);">{{ plan.deliverableCount }}</dd>
            </div>
            <div class="flex justify-between">
              <dt style="color: var(--text-muted);">{{ t('batchCreate.previewTasks') }}</dt>
              <dd style="color: var(--text);">{{ plan.taskCount }}</dd>
            </div>
            <div class="flex justify-between">
              <dt style="color: var(--text-muted);">{{ t('batchCreate.previewStages') }}</dt>
              <dd style="color: var(--text);">{{ plan.stagesPerDeliverable }}</dd>
            </div>
          </dl>
          <div v-if="Object.keys(plan.assigneeSummary).length" class="mt-2 border-t pt-2" style="border-color: var(--border);">
            <p class="mb-1 text-xs font-medium" style="color: var(--text-muted);">{{ t('batchCreate.perAssignee') }}</p>
            <div v-for="(cnt, uid) in plan.assigneeSummary" :key="uid" class="flex justify-between text-sm">
              <span style="color: var(--text);">{{ data.userName(uid as string) }}</span>
              <span style="color: var(--text-muted);">{{ cnt }} {{ t('board.tasksLabel') }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Footer: nav + submit -->
    <div class="mt-4 flex items-center justify-between">
      <button v-if="step > 1" class="rounded-lg px-3 py-2 text-sm" style="color: var(--text-muted);" @click="prev">
        ← {{ t('actions.cancel') }}
      </button>
      <span v-else />
      <BaseButton v-if="step < TOTAL_STEPS" :disabled="!canNext" @click="next">
        {{ t('batchCreate.next') }}
      </BaseButton>
      <BaseButton v-else :disabled="busy" @click="submit">
        {{ t('batchCreate.confirm') }}
      </BaseButton>
    </div>
  </Modal>
</template>
