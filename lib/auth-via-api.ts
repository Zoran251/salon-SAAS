'use client'

import { supabase } from '@/lib/supabase'
import type { AppRole } from '@/lib/user-role'

export type AuthPasswordAction = 'signin' | 'signup'

export type AuthPasswordSignupOptions = {
  /** Samo za signup — sprema se u user_metadata (npr. salon_owner za /registracija). */
  app_role?: AppRole
  /**
   * Za signin: `customer` = server proverava crnu listu (je_auth_blokiran) i ne vraća sesiju ako je blokada.
   * Za prijavu salona ne šalji ili koristi `salon`.
   */
  auth_context?: 'customer' | 'salon'
}

/**
 * Auth preko /api/auth/password (server → Supabase), zatim setSession u pregledniku.
 */
export async function authPasswordViaApi(
  action: AuthPasswordAction,
  email: string,
  password: string,
  signupOptions?: AuthPasswordSignupOptions,
): Promise<{ error: string | null; userId: string | null; serverReturnedSession: boolean }> {
  let res: Response
  try {
    const body: Record<string, unknown> = { action, email, password }
    if (action === 'signup' && signupOptions?.app_role) {
      body.app_role = signupOptions.app_role
    }
    if (signupOptions?.auth_context) {
      body.auth_context = signupOptions.auth_context
    }
    res = await fetch('/api/auth/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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
