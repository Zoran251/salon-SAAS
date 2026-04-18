import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

/** Nakon setSession() prvi getSession() često bude null — kratko ponavljanje. */
export async function waitForClientSession(maxAttempts = 40, delayMs = 80): Promise<Session | null> {
  for (let i = 0; i < maxAttempts; i++) {
    const { data } = await supabase.auth.getSession()
    if (data.session) return data.session
    await new Promise((r) => setTimeout(r, delayMs))
  }
  return (await supabase.auth.getSession()).data.session
}
