/**
 * Jedinstveno čitanje Supabase URL/anon ključa na serveru.
 * Podržava i NEXT_PUBLIC_* (ugrađuje se u klijent) i obične varijable (samo server),
 * koje layout injektuje u window.__SALON_SUPABASE__ pri svakom zahtjevu.
 */
export function getPublicSupabaseEnv(): { url: string; anonKey: string; ok: boolean } {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
  const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').trim()
  return { url, anonKey, ok: Boolean(url && anonKey) }
}
