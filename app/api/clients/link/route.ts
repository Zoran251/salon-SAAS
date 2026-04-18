import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getPublicSupabaseEnv } from '@/lib/env-supabase'
import { SUPABASE_PUBLIC_ENV_MISSING } from '@/lib/supabase-service-role-hint'

function getAnonClient() {
  const { url: supabaseUrl, anonKey: supabaseAnonKey, ok } = getPublicSupabaseEnv()
  if (!ok) return null
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function getUserClient(authToken: string) {
  const { url: supabaseUrl, anonKey: supabaseAnonKey, ok } = getPublicSupabaseEnv()
  if (!ok) return null
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: { Authorization: `Bearer ${authToken}` },
    },
  })
}

/**
 * Povezivanje kupca sa salonom preko RPC `link_salon_client` (bez service role).
 * Zahteva migraciju: db/migrations/2026-04-20_link_salon_client_rpc.sql
 */
export async function POST(request: Request) {
  try {
    const { ok: envOk } = getPublicSupabaseEnv()
    if (!envOk) {
      return NextResponse.json({ error: SUPABASE_PUBLIC_ENV_MISSING }, { status: 500 })
    }

    const anonClient = getAnonClient()
    if (!anonClient) {
      return NextResponse.json({ error: SUPABASE_PUBLIC_ENV_MISSING }, { status: 500 })
    }

    const body = await request.json()
    const { auth_token, salon_id, ime, telefon, email } = body

    if (!auth_token || !salon_id || !telefon) {
      return NextResponse.json({ error: 'Nedostaju obavezni podaci.' }, { status: 400 })
    }

    const { data: authData, error: authError } = await anonClient.auth.getUser(auth_token)
    if (authError || !authData.user) {
      return NextResponse.json({ error: 'Nevažeća sesija klijenta.' }, { status: 401 })
    }

    const imeValue = typeof ime === 'string' && ime.trim() ? ime.trim() : 'Klijent'
    const telefonValue = String(telefon).trim()
    const emailValue = typeof email === 'string' && email.trim() ? email.trim() : authData.user.email || ''

    const userClient = getUserClient(auth_token)
    if (!userClient) {
      return NextResponse.json({ error: SUPABASE_PUBLIC_ENV_MISSING }, { status: 500 })
    }

    const { data: clientId, error: rpcError } = await userClient.rpc('link_salon_client', {
      p_salon_id: salon_id,
      p_telefon: telefonValue,
      p_ime: imeValue,
      p_email: emailValue,
    })

    if (rpcError) {
      const msg = rpcError.message || 'Povezivanje nije uspjelo.'
      const isMissingFn = /function public\.link_salon_client|link_salon_client/i.test(msg) && /does not exist/i.test(msg)
      return NextResponse.json(
        {
          error: isMissingFn
            ? 'U Supabase SQL Editor pokreni migraciju db/migrations/2026-04-20_link_salon_client_rpc.sql (funkcija link_salon_client).'
            : msg,
        },
        { status: 400 },
      )
    }

    if (!clientId || typeof clientId !== 'string') {
      return NextResponse.json({ error: 'Neočekivan odgovor iz baze.' }, { status: 500 })
    }

    return NextResponse.json({ success: true, client_id: clientId })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Greška servera.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
