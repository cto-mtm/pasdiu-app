// Derivation helper for the current stage of a deliverable.
// See docs/deliverables/phase-1-domain-foundation.md § 3 — the current stage
// is DERIVED, never stored. It is the first stage in the deliverable's snapshot
// whose task is not in a terminal state. Zero writes, zero drift.
//
// Revision loops work automatically: when a client sends work back and its
// task flips to `revisions`, the derived stage moves backwards without any
// special-casing.

import type { Deliverable, Task, WorkflowStage } from './types'
import { isDoneStatus } from './status'

export interface CurrentStageResult {
  /** The active stage, or undefined if all stages are complete. */
  stage: WorkflowStage | undefined
  /** Index into deliverable.stages, or -1 if complete. */
  index: number
  /** True when every stage's task is in a terminal state. */
  complete: boolean
}

/**
 * Derive the current stage of a deliverable from its tasks.
 * Call this in detail views where the deliverable's tasks are already loaded.
 * List views should use `stageSummary` instead (the trigger-maintained cache).
 */
export function currentStage(deliverable: Deliverable, tasks: Task[]): CurrentStageResult {
  for (let i = 0; i < deliverable.stages.length; i++) {
    const stage = deliverable.stages[i]
    const task = tasks.find((t) => t.stageId === stage.id)
    // No task for this stage → it's the current one (not yet instantiated or skipped)
    if (!task) {
      return { stage, index: i, complete: false }
    }
    // Task exists but is not terminal → this stage is active
    if (!isDoneStatus(task.status)) {
      return { stage, index: i, complete: false }
    }
  }
  // All stages have terminal tasks → deliverable is complete
  return { stage: undefined, index: -1, complete: true }
}
