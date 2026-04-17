import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getPublicSupabaseEnv } from '@/lib/env-supabase'

const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

function getAnonClient() {
  const { url: supabaseUrl, anonKey: supabaseAnonKey, ok } = getPublicSupabaseEnv()
  if (!ok) return null
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function getServiceClient() {
  const { url: supabaseUrl, ok } = getPublicSupabaseEnv()
  if (!ok || !supabaseServiceRoleKey) return null
  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function POST(request: Request) {
  try {
    const anonClient = getAnonClient()
    const serviceClient = getServiceClient()

    if (!anonClient || !serviceClient) {
      return NextResponse.json(
        { error: 'Server konfiguracija nije potpuna za povezivanje klijentskog naloga.' },
        { status: 500 }
      )
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
    const emailValue = typeof email === 'string' && email.trim() ? email.trim() : authData.user.email || null

    const { data: existingClient, error: existingError } = await serviceClient
      .from('salon_clients')
      .select('id')
      .eq('salon_id', salon_id)
      .eq('telefon', telefonValue)
      .maybeSingle()

    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 500 })
    }

    if (existingClient?.id) {
      const { error: updateError } = await serviceClient
        .from('salon_clients')
        .update({
          auth_user_id: authData.user.id,
          ime: imeValue,
          email: emailValue,
        })
        .eq('id', existingClient.id)

      if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })
      return NextResponse.json({ success: true, client_id: existingClient.id })
    }

    const { data: createdClient, error: createError } = await serviceClient
      .from('salon_clients')
      .insert({
        salon_id,
        auth_user_id: authData.user.id,
        ime: imeValue,
        telefon: telefonValue,
        email: emailValue,
      })
      .select('id')
      .single()

    if (createError || !createdClient) {
      return NextResponse.json({ error: createError?.message || 'Neuspješno kreiranje klijenta.' }, { status: 500 })
    }

    return NextResponse.json({ success: true, client_id: createdClient.id })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Greška servera.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
