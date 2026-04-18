/** Sprječava open-redirect; dozvoljava samo relativne putanje na istom sajtu. */
export function getSafeNextPath(raw: string | null | undefined): string {
  if (typeof raw !== 'string' || raw.length === 0) return '/'
  const path = raw.split('?')[0].split('#')[0]
  if (!path.startsWith('/') || path.startsWith('//')) return '/'
  return path
}

/** Iz putanje tipa /salon/moj-slug izvlači slug salona. */
export function parseSalonSlugFromPath(path: string): string | null {
  const m = path.trim().match(/^\/salon\/([^/?#]+)/)
  return m ? decodeURIComponent(m[1]) : null
}
