import type { DeliverablePriority } from './types'

// Presentation for a deliverable's priority. The ordering itself lives in
// @pasdiu/shared (DELIVERABLE_PRIORITIES / priorityRank) so the app and the
// API can never disagree about which way "first" points.

const COLORS: Record<DeliverablePriority, string> = {
  high: 'var(--status-blocked)',
  normal: 'var(--text-muted)',
  low: 'var(--status-backlog)',
}

export function priorityColor(p: DeliverablePriority): string {
  return COLORS[p]
}

// i18n key, e.g. priorityKey('high') → 'deliverableDetail.priorityHigh'
export function priorityKey(p: DeliverablePriority): string {
  return `deliverableDetail.priority${p.charAt(0).toUpperCase()}${p.slice(1)}`
}

// 'normal' is the default and the overwhelming majority — badging every row
// with it is noise, so list views only render the exceptions.
export function isNotablePriority(p: DeliverablePriority): boolean {
  return p !== 'normal'
}
