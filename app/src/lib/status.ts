import type { TaskStatus } from './types'

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
