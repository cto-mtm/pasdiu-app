/**
 * Sanitize a user-provided external link (version media lives on the
 * customer's own storage — Drive, Dropbox, Frame.io…). Returns a normalized
 * http(s) URL, or '' if the input is empty or uses a disallowed scheme
 * (blocks javascript:, data:, etc.). A bare domain gets https:// prepended.
 */
export function sanitizeExternalUrl(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const url = new URL(candidate)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : ''
  } catch {
    return ''
  }
}
