// Same local matching as Hilbana's web app: by title (accent-insensitive) and by identifier
// ignoring separators, so "2139", "drapps2139" and "DRAPPS-2139" find the same issue. The
// server's full-text search does not index the identifier.

export function normalizeText(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

const normalizeIdent = (s: string): string => normalizeText(s).replace(/[^a-z0-9]/g, '')

export function matchesLocally(issue: { title: string; identifier: string }, query: string): boolean {
  const q = normalizeText(query)
  if (!q) return false
  if (normalizeText(issue.title).includes(q)) return true
  const qi = normalizeIdent(query)
  return qi !== '' && normalizeIdent(issue.identifier).includes(qi)
}

/** Does the identifier match the typed text exactly? (DRAPPS-2139 or a bare 2139) */
export function exactIdentifier(identifier: string, query: string): boolean {
  const qi = normalizeIdent(query)
  if (!qi) return false
  const ii = normalizeIdent(identifier)
  return ii === qi || ii.replace(/^[a-z]+/, '') === qi
}

/** Identifiers a text mentions: `DRAPPS-102`, plus the bare numbers that follow it in a
 *  list ("DRAPPS-102 and 103", "DRAPPS-1, 2 and 3"; the Spanish connectors y/e/o work too).
 *  They are only candidates: the caller validates them against real issues, so `UTF-8` or
 *  `ISO-8601` never become links. */
export function extractRefs(text: string, exclude = ''): string[] {
  const found: string[] = []
  const head = /\b([A-Za-z][A-Za-z0-9]*)-(\d+)\b((?:\s*(?:,|;|\/|&|\by\b|\be\b|\bo\b|\band\b|\bor\b)\s*\d+\b)*)/g
  for (const m of text.matchAll(head)) {
    const key = m[1]!.toUpperCase()
    found.push(`${key}-${Number(m[2])}`)
    for (const n of (m[3] ?? '').match(/\d+/g) ?? []) found.push(`${key}-${Number(n)}`)
  }
  const skip = exclude.toUpperCase()
  return [...new Set(found)].filter((id) => id !== skip)
}

const TLD = /\.(com|es|net|org|io|app|dev|eu|cat|info)$/i
/** "shop.Acme-Store.com" -> "shopacmestore": comparable across naming styles. */
export const nameKey = (s: string): string => normalizeText(s.replace(TLD, '')).replace(/[^a-z0-9]/g, '')

/** The one project whose name fits any candidate (an Orca workspace/folder name): an exact match
 *  beats one name containing the other (both at least 5 characters). Ties give null: guessing
 *  wrong would silently show another project's issues. */
export function bestProjectByName(candidates: string[], projects: { id: string; name: string }[]): string | null {
  let best = 0
  let winners: string[] = []
  for (const project of projects) {
    const pk = nameKey(project.name)
    let score = 0
    for (const candidate of candidates) {
      const ck = nameKey(candidate)
      if (!ck || !pk) continue
      if (ck === pk) score = Math.max(score, 3)
      else if (Math.min(ck.length, pk.length) >= 5 && (ck.includes(pk) || pk.includes(ck))) score = Math.max(score, 2)
    }
    if (score === 0 || score < best) continue
    if (score > best) { best = score; winners = [] }
    winners.push(project.id)
  }
  return winners.length === 1 ? winners[0]! : null
}
