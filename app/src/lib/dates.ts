// Due dates are CALENDAR DAYS, not instants, and are shown without a time.
//
// They are stored at DUE_HOUR_UTC (see the due-date convention in
// shared/src/workflow.ts) precisely so that formatting them in the viewer's
// own timezone still lands on the day that was picked —
// a midnight-UTC timestamp renders as the PREVIOUS day everywhere west of
// Greenwich. These helpers keep <input type="date"> on the same convention
// instead of drifting to the browser's local midnight.
//
// Display stays local: Intl (vue-i18n's `d()`) formats in the viewer's zone,
// which is what we want now that the stored instant is mid-day.

import { parseDueDate } from '@pasdiu/shared'

/** Date → "YYYY-MM-DD" for <input type="date">, read in UTC. */
export function toDateInputValue(date: Date | null): string {
  if (!date || Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

/** "YYYY-MM-DD" from <input type="date"> → that calendar day at 12:00 UTC. */
export function fromDateInputValue(value: string): Date | null {
  if (!value) return null
  // Delegate to the shared canonical noon-pinning logic.
  return parseDueDate(value)
}
