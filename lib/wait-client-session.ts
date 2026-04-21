import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

/** Podrazumevano ~6.4s: posle osvežavanja stranice localStorage + Supabase često kasne na sporijim uređajima. */
export const AUTH_SESSION_WAIT_ATTEMPTS = 80
export const AUTH_SESSION_WAIT_MS = 80

/**
 * Čeka dok getSession() ne vrati sesiju iz storage-a (npr. posle prijave ili F5).
 * Ne meša se sa odjavom — samo čita stanje u pregledniku.
 */
export async function waitForClientSession(
  maxAttempts = AUTH_SESSION_WAIT_ATTEMPTS,
  delayMs = AUTH_SESSION_WAIT_MS
): Promise<Session | null> {
  for (let i = 0; i < maxAttempts; i++) {
    const { data } = await supabase.auth.getSession()
    if (data.session) return data.session
    await new Promise((r) => setTimeout(r, delayMs))
  }
  return (await supabase.auth.getSession()).data.session
}
