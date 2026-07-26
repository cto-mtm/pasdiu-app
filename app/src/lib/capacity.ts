// Capacity advisor — computes whether a batch exceeds team capacity.
// Used by the wizard preview to warn (never block) when workload is above
// comfortable throughput. Weights come from DeliverableType.weight.
//
// See docs/deliverables/phase-5-capacity-ai.md § Part 1.

import type { DeliverableType } from './types'

export interface CapacityInput {
  /** Number of deliverables per type id. */
  deliverablesByType: Record<string, number>
  /** Available deliverable types with weights. */
  types: DeliverableType[]
  /** Assignees with their points/day capacity. */
  assignees: Array<{ uid: string; capacityPointsPerDay: number }>
  /** Number of working days in the due window. */
  workingDays: number
}

export interface CapacityResult {
  totalPoints: number
  availablePoints: number
  utilizationPercent: number
  overCapacity: boolean
  suggestedSplitDays: number | null
}

/**
 * Compute capacity utilization for a batch.
 * Returns a warning when utilization > 100% — never blocks.
 */
export function assessCapacity(input: CapacityInput): CapacityResult {
  // Total points = sum of (count × weight) per type.
  let totalPoints = 0
  for (const [typeId, count] of Object.entries(input.deliverablesByType)) {
    const typeWeight = input.types.find((t) => t.id === typeId)?.weight ?? 1
    totalPoints += count * typeWeight
  }

  // Available points = sum of (assignee capacity × days).
  const totalCapacityPerDay = input.assignees.reduce((sum, a) => sum + a.capacityPointsPerDay, 0)
  const availablePoints = totalCapacityPerDay * input.workingDays

  const utilizationPercent = availablePoints > 0
    ? Math.round((totalPoints / availablePoints) * 100)
    : totalPoints > 0 ? Infinity : 0

  const overCapacity = totalPoints > availablePoints

  // If over capacity, suggest how many days would be needed.
  const suggestedSplitDays = overCapacity && totalCapacityPerDay > 0
    ? Math.ceil(totalPoints / totalCapacityPerDay)
    : null

  return {
    totalPoints,
    availablePoints,
    utilizationPercent,
    overCapacity,
    suggestedSplitDays,
  }
}
