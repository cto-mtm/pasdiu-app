// Minimal, dependency-free CSV parser. Handles quoted fields, escaped quotes
// (""), embedded commas/newlines, and CRLF. Returns headers + row objects keyed
// by header.
export interface ParsedCsv {
  headers: string[]
  rows: Record<string, string>[]
}

export function parseCsv(text: string): ParsedCsv {
  const s = text.replace(/\r\n?/g, '\n')
  const grid: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false

  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else field += ch
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(field); field = ''
    } else if (ch === '\n') {
      row.push(field); grid.push(row); row = []; field = ''
    } else {
      field += ch
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); grid.push(row) }

  const headers = (grid.shift() ?? []).map((h) => h.trim())
  const rows = grid
    .filter((r) => r.some((c) => c.trim() !== ''))
    .map((r) => {
      const o: Record<string, string> = {}
      headers.forEach((h, i) => { o[h] = (r[i] ?? '').trim() })
      return o
    })
  return { headers, rows }
}

// Serialize headers + rows to CSV. Quotes are escaped per RFC 4180, and values
// that would be interpreted as formulas by spreadsheet apps (= + - @) get a
// leading apostrophe to neutralize CSV injection.
export function toCsv(headers: string[], rows: string[][]): string {
  const cell = (raw: string): string => {
    let v = raw
    if (/^[=+\-@]/.test(v)) v = `'${v}`
    if (/[",\n\r]/.test(v)) v = `"${v.replace(/"/g, '""')}"`
    return v
  }
  return [headers, ...rows].map((r) => r.map(cell).join(',')).join('\n')
}

// Trigger a client-side download of a CSV string.
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
