import type { TaskStatus } from './types'
import { TASK_STATUSES } from './types'

// Glowing accents used strictly for status (per the Pasdiu visual identity).
// All values are CSS variables — tokens live in assets/css/main.css.
const COLORS: Record<TaskStatus, string> = {
  backlog: 'var(--status-backlog)',
  in_progress: 'var(--accent-cyan)',
  blocked: 'var(--status-blocked)',
  revisions: 'var(--accent-amber)',
  approved: 'var(--accent-emerald)',
  delivered: 'var(--status-delivered)',
  done: 'var(--status-done)',
}

export function statusColor(s: TaskStatus): string {
  return COLORS[s]
}

// A task counts as finished when it's approved by the client, delivered,
// or checked done.
export function isDoneStatus(s: TaskStatus): boolean {
  return s === 'done' || s === 'approved' || s === 'delivered'
}

// i18n key for a status label, e.g. statusKey('in_progress') → 'status.in_progress'
export function statusKey(s: TaskStatus): string {
  return `status.${s}`
}

// The statuses a HUMAN picks. `revisions` and `approved` are written by the
// client review flow (approve / request-changes, and the rules permit a client
// exactly those two), `delivered` by the handoff flow. They remain real
// statuses — badges, filters and isDoneStatus all still understand them — they
// are simply never something anyone selects from a dropdown. Four states is
// what the pipeline actually needs now that deliverables carry stage progress.
export const MANUAL_TASK_STATUSES: TaskStatus[] = ['backlog', 'in_progress', 'blocked', 'done']

// Board columns. The manual set, plus one Review column folding the
// flow-written statuses so work sitting with the client stays visible on the
// board instead of disappearing into a column nobody can move a task into.
export interface BoardColumn {
  key: string
  /** Every status this column collects. */
  statuses: TaskStatus[]
  /** Colour dot for the column heading. */
  color: string
  /** i18n key for the heading. */
  labelKey: string
}

const REVIEW_STATUSES: TaskStatus[] = ['revisions', 'approved', 'delivered']

export const BOARD_COLUMNS: BoardColumn[] = [
  ...MANUAL_TASK_STATUSES.filter((s) => s !== 'done').map((s) => ({
    key: s, statuses: [s], color: statusColor(s), labelKey: statusKey(s),
  })),
  { key: 'review', statuses: REVIEW_STATUSES, color: 'var(--accent-amber)', labelKey: 'status.review' },
  { key: 'done', statuses: ['done'], color: statusColor('done'), labelKey: statusKey('done') },
]

// Guard against a status silently falling out of every column when the enum
// grows — a task that lands nowhere would vanish from the board.
if (import.meta.env.DEV) {
  const covered = new Set(BOARD_COLUMNS.flatMap((c) => c.statuses))
  const missing = TASK_STATUSES.filter((s) => !covered.has(s))
  if (missing.length) console.warn(`[status] no board column for: ${missing.join(', ')}`)
}
