'use client'

import { supabase } from '@/lib/supabase'

export type AuthPasswordAction = 'signin' | 'signup'

/**
 * Auth preko /api/auth/password (server → Supabase), zatim setSession u pregledniku.
 */
export async function authPasswordViaApi(
  action: AuthPasswordAction,
  email: string,
  password: string,
): Promise<{ error: string | null; userId: string | null; serverReturnedSession: boolean }> {
  let res: Response
  try {
    res = await fetch('/api/auth/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, email, password }),
    })
  } catch {
    return {
      error: 'Mrežna greška (Failed to fetch). Provjeri internet ili probaj kasnije.',
      userId: null,
      serverReturnedSession: false,
    }
  }

  const json = (await res.json()) as {
    error?: string
    session?: {
      access_token: string
      refresh_token: string
    } | null
    user?: { id: string } | null
  }

  if (!res.ok) {
    return { error: json.error || `Greška ${res.status}`, userId: null, serverReturnedSession: false }
  }

  const serverReturnedSession = Boolean(json.session)

  if (json.session) {
    const { error } = await supabase.auth.setSession({
      access_token: json.session.access_token,
      refresh_token: json.session.refresh_token,
    })
    if (error) {
      return { error: error.message, userId: json.user?.id ?? null, serverReturnedSession: true }
    }
  }

  return { error: null, userId: json.user?.id ?? null, serverReturnedSession }
}
