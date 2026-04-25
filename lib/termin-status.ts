/**
 * Jedinstveni statusi termina u UI i triggerima (ćirilica/latinica, NFC, varijante).
 */
export type TerminStatusKind = 'ceka' | 'potvrđen' | 'otkazan' | 'unknown'

export function canonicalTerminStatus(raw: string | null | undefined): TerminStatusKind {
  if (raw == null) return 'unknown'
  const s = String(raw).trim().normalize('NFC')
  if (!s) return 'unknown'
  const lower = s.toLowerCase()

  if (lower === 'otkazan' || lower.startsWith('otkaz')) return 'otkazan'

  // „potvrđen” u bazi koristi đ — /^potvrd/ ne poklapa se sa slovom đ (nije ASCII d).
  const latinish = lower
    .replace(/đ/g, 'd')
    .replace(/ć/g, 'c')
    .replace(/č/g, 'c')
    .replace(/ž/g, 'z')
    .replace(/š/g, 's')
  if (latinish === 'potvrden' || latinish.startsWith('potvrden')) return 'potvrđen'

  if (
    lower === 'ceka' ||
    lower === 'čeka' ||
    lower.includes('cekaju') ||
    lower.includes('čekaju') ||
    lower === 'pending' ||
    lower === 'waiting' ||
    lower === 'na cekanju' ||
    lower === 'na čekanju'
  ) {
    return 'ceka'
  }

  return 'unknown'
}

export function isTerminPotvrdjen(raw: string | null | undefined): boolean {
  return canonicalTerminStatus(raw) === 'potvrđen'
}

export function isTerminOtkazan(raw: string | null | undefined): boolean {
  return canonicalTerminStatus(raw) === 'otkazan'
}

/** Vrednost za state / localStorage — uvek ista za prikaz i poređenje. */
export function storageTerminStatus(raw: string | null | undefined): string {
  const c = canonicalTerminStatus(raw)
  if (c === 'unknown') return String(raw ?? '').trim() || 'ceka'
  return c === 'potvrđen' ? 'potvrđen' : c === 'otkazan' ? 'otkazan' : 'ceka'
}
