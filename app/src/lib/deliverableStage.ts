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
 *
 * Skipped stages: if a stage is optional and has no task, it is treated as
 * skipped (not current). If a required stage has no task, it IS current
 * (awaiting instantiation). This matches phase 2a's decision to not create
 * tasks for skipped optional stages.
 */
export function currentStage(deliverable: Deliverable, tasks: Task[]): CurrentStageResult {
  for (let i = 0; i < deliverable.stages.length; i++) {
    const stage = deliverable.stages[i]
    const task = tasks.find((t) => t.stageId === stage.id)
    // No task for this stage:
    //   - optional stage → skipped, continue to next
    //   - required stage → this is the current one (not yet instantiated)
    if (!task) {
      if (stage.optional) continue
      return { stage, index: i, complete: false }
    }
    // Task exists but is not terminal → this stage is active
    if (!isDoneStatus(task.status)) {
      return { stage, index: i, complete: false }
    }
  }
  // All stages have terminal tasks (or were optional-skipped) → complete
  return { stage: undefined, index: -1, complete: true }
}
