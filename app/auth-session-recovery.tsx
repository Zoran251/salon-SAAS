'use client'

import { useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { isInvalidRefreshTokenError } from '@/lib/auth-refresh-errors'

/**
 * Čisti oštećenu / isteklu sesiju u localStorage (npr. „Invalid Refresh Token: Refresh Token Not Found”).
 * Nije greška PostgreSQL veza — Auth token u pregledniku ne odgovara projektu na Supabase-u.
 */
export function AuthSessionRecovery() {
  useEffect(() => {
    const clearLocalAuth = () => void supabase.auth.signOut({ scope: 'local' })

    void supabase.auth.getSession().then(({ error }) => {
      if (error && isInvalidRefreshTokenError(error.message)) clearLocalAuth()
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') return
      if ((event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') && !session) {
        clearLocalAuth()
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  return null
}
