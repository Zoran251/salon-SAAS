const DIACRITIC_MAP: Record<string, string> = {
  č: 'c',
  ć: 'c',
  đ: 'dj',
  š: 's',
  ž: 'z',
  Č: 'c',
  Ć: 'c',
  Đ: 'dj',
  Š: 's',
  Ž: 'z',
}

export function buildSalonSlug(input: string): string {
  const transliterated = Array.from(input || '')
    .map((char) => DIACRITIC_MAP[char] ?? char)
    .join('')

  return transliterated
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export function fallbackSalonSlug(seed: string): string {
  const cleanedSeed = buildSalonSlug(seed)
  if (cleanedSeed) return cleanedSeed

  const random = Math.random().toString(36).slice(2, 8)
  return `salon-${random}`
}
