// Workflow stage limits and the scheduling math that turns a deliverable's
// anchor date into one deadline per stage.
//
// Deliberately zod-free so it can be the single definition three consumers
// build on: the schemas take their bounds from these constants, the batch
// endpoint schedules with these functions, and the wizard previews with the
// same ones — a preview that disagreed with the server would be worse than no
// preview at all.

import type { WorkflowStage } from './types.js'

export const MAX_STAGES = 20
export const STAGE_NAME_MAX = 60
export const MAX_STAGE_DURATION_HOURS = 8760
export const HOURS_PER_DAY = 24

/**
 * The stage list every new workspace starts with.
 *
 * This is a SEED VALUE, not a fallback. Org creation copies it onto the org
 * doc, and from that moment the org owns its pipeline outright — editing it in
 * Settings overwrites the same field, and a "default" pipeline is
 * indistinguishable from a customized one. Nothing reads this at run time to
 * fill a gap, which is deliberate: if it were a fallback, changing it in a
 * deploy would retroactively redefine the workflow of every org that had never
 * customized theirs.
 *
 * Durations add up to one working week per deliverable. Placeholders — orgs
 * tune them in Settings → Workflow.
 */
export const DEFAULT_PIPELINE_STAGES: readonly WorkflowStage[] = [
  { id: 's_discovery', name: 'Discovery', optional: true, clientFacing: false, durationHours: 24 },
  { id: 's_capture', name: 'Capture', optional: false, clientFacing: false, durationHours: 24 },
  { id: 's_edit', name: 'Edit', optional: false, clientFacing: false, durationHours: 48 },
  { id: 's_review', name: 'Review', optional: false, clientFacing: true, durationHours: 24 },
  { id: 's_approval', name: 'Approval', optional: false, clientFacing: true, durationHours: 24 },
]

const MS_PER_HOUR = 3_600_000

// A due date is a CALENDAR DAY, not an instant, and is shown without a time.
// All arithmetic is UTC; dates are pinned to 12:00 UTC so that rendering them
// in the viewer's own timezone still lands on the day that was picked —
// midnight UTC reads as the PREVIOUS day everywhere west of Greenwich. Whole-
// day durations keep every derived date on that noon; sub-day durations can
// drift off it, which only bites at extreme offsets and is left uncorrected.
export const DUE_HOUR_UTC = 12

/** How a deliverable's anchor date is read — see `stageDueDates`. */
export type ScheduleMode = 'start' | 'end'

/** Collapse an instant onto DUE_HOUR_UTC of the UTC day it falls in. */
export function atDueHour(date: Date): Date {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    DUE_HOUR_UTC,
  ))
}

/** Any parseable date string → that same calendar day at DUE_HOUR_UTC. */
export function parseDueDate(value: string): Date | null {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return atDueHour(parsed)
}

/**
 * One stage's duration in hours, defended against whatever is actually stored.
 * The Firestore rules gate WHICH keys change on an org doc, never the
 * pipeline's contents, so a stray string, a negative or a NaN can legitimately
 * arrive — and must not propagate into an Invalid Date that fails a whole
 * batch write. Anything unusable degrades to 0.
 */
export function stageDurationHours(value: unknown): number {
  const raw = typeof value === 'number' ? value : Number(value ?? 0)
  if (!Number.isFinite(raw) || raw <= 0) return 0
  return Math.min(Math.floor(raw), MAX_STAGE_DURATION_HOURS)
}

/**
 * Chain stage durations into one due date per stage, in the order given.
 * Skipped stages are expected to be filtered out by the caller — they consume
 * no time by simply not being here.
 *
 *   cumulative[i] = hours from the first stage's start to stage i's end
 *   'start' → due = anchor + cumulative[i]            (first stage begins at the anchor)
 *   'end'   → due = anchor − (total − cumulative[i])  (last stage ends on the anchor)
 *
 * With every duration at 0 both modes collapse to `due = anchor` for every
 * stage — the behaviour that predates stage durations, which is what keeps
 * pipelines written before the field existed working unchanged.
 *
 * A null anchor (no due window given) yields a null date for every stage.
 */
export function stageDueDates(
  stages: ReadonlyArray<{ durationHours?: unknown }>,
  anchor: Date | null,
  mode: ScheduleMode,
): (Date | null)[] {
  const cumulative: number[] = []
  let running = 0
  for (const stage of stages) {
    running += stageDurationHours(stage.durationHours)
    cumulative.push(running)
  }
  const total = running

  return stages.map((_, i) => {
    if (!anchor) return null
    const offsetHours = mode === 'start' ? cumulative[i] : cumulative[i] - total
    return new Date(anchor.getTime() + offsetHours * MS_PER_HOUR)
  })
}
