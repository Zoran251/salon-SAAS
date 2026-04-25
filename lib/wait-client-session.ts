import type { Session } from '@supabase/supabase-js'
import { isInvalidRefreshTokenError } from '@/lib/auth-refresh-errors'
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
  const finish = async (): Promise<Session | null> => {
    const { data, error } = await supabase.auth.getSession()
    if (error && isInvalidRefreshTokenError(error.message)) {
      await supabase.auth.signOut({ scope: 'local' })
      return null
    }
    return data.session
  }

  for (let i = 0; i < maxAttempts; i++) {
    const { data, error } = await supabase.auth.getSession()
    if (error && isInvalidRefreshTokenError(error.message)) {
      await supabase.auth.signOut({ scope: 'local' })
      return null
    }
    if (data.session) return data.session
    await new Promise((r) => setTimeout(r, delayMs))
  }
  return finish()
}
