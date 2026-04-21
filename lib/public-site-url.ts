/**
 * Javni osnovni URL (bez završnog /) za linkove salona i QR kod.
 *
 * Postavi `NEXT_PUBLIC_SITE_URL` u Vercel → Project → Settings → Environment Variables
 * (npr. `https://tvoj-projekat.vercel.app` ili custom domen), ili u `.env.local` za lokalni rad.
 * Tada QR i „Kopiraj link“ u dashboardu vode na produkciju i kada otvoriš app na localhostu.
 */
export function getPublicSiteBase(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  if (raw) {
    const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    try {
      return new URL(withProto).origin
    } catch {
      return raw.replace(/\/$/, '')
    }
  }
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin
  }
  return ''
}
