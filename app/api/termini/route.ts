import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getPublicSupabaseEnv } from '@/lib/env-supabase'

const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

function getServerSupabaseClient() {
  const { url: supabaseUrl, anonKey: supabaseAnonKey, ok } = getPublicSupabaseEnv()
  if (!ok) return null

  // Preferred for public booking: bypasses RLS in a controlled server route.
  const key = supabaseServiceRoleKey || supabaseAnonKey
  if (!key) return null

  return createClient(supabaseUrl, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

export async function POST(request: Request) {
  try {
    const supabase = getServerSupabaseClient()
    if (!supabase) {
      return NextResponse.json(
        { error: 'Server nije konfigurisan: nedostaje Supabase URL ili API key.' },
        { status: 500 }
      )
    }

    const body = await request.json()
    const { salon_id, usluga_id, ime_klijenta, telefon_klijenta, datum_vrijeme, napomena, email } = body

    if (!salon_id || !ime_klijenta || !telefon_klijenta || !datum_vrijeme) {
      return NextResponse.json({ error: 'Nedostaju obavezni podaci' }, { status: 400 })
    }

    const imeKlijenta = String(ime_klijenta).trim()
    const telefonKlijenta = String(telefon_klijenta).trim()
    const clientEmail = typeof email === 'string' && email.trim() ? email.trim() : null

    const { data: existingClient, error: existingClientError } = await supabase
      .from('salon_clients')
      .select('id')
      .eq('salon_id', salon_id)
      .eq('telefon', telefonKlijenta)
      .maybeSingle()

    if (existingClientError) {
      return NextResponse.json({ error: existingClientError.message }, { status: 500 })
    }

    let clientId = existingClient?.id as string | undefined

    if (!clientId) {
      const { data: newClient, error: newClientError } = await supabase
        .from('salon_clients')
        .insert({
          salon_id,
          ime: imeKlijenta,
          telefon: telefonKlijenta,
          email: clientEmail,
        })
        .select('id')
        .single()

      if (newClientError || !newClient) {
        return NextResponse.json({ error: newClientError?.message || 'Neuspješno kreiranje klijenta.' }, { status: 500 })
      }

      clientId = newClient.id
    } else if (clientEmail) {
      // Keep customer email in sync when we receive it from booking form.
      await supabase
        .from('salon_clients')
        .update({ ime: imeKlijenta, email: clientEmail })
        .eq('id', clientId)
    }

    const { error } = await supabase.from('termini').insert({
      salon_id,
      client_id: clientId,
      usluga_id,
      ime_klijenta: imeKlijenta,
      telefon_klijenta: telefonKlijenta,
      datum_vrijeme, napomena, status: 'ceka'
    })

    if (error) {
      const rlsHint = !supabaseServiceRoleKey && /row-level security/i.test(error.message)
      return NextResponse.json(
        {
          error: rlsHint
            ? 'RLS blokira javno zakazivanje. Dodaj policy za anon INSERT na tabeli termini ili postavi SUPABASE_SERVICE_ROLE_KEY.'
            : error.message,
        },
        { status: 500 }
      )
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Greška servera'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function GET(request: Request) {
  const supabase = getServerSupabaseClient()
  if (!supabase) {
    return NextResponse.json(
      { error: 'Server nije konfigurisan: nedostaje Supabase URL ili API key.' },
      { status: 500 }
    )
  }

  const { searchParams } = new URL(request.url)
  const statusCheck = searchParams.get('status_check')
  const salon_id = searchParams.get('salon_id')

  if (!salon_id) return NextResponse.json({ error: 'Nedostaje salon_id' }, { status: 400 })

  if (statusCheck === '1') {
    const ime = searchParams.get('ime')
    const telefon = searchParams.get('telefon')

    if (!ime || !telefon) {
      return NextResponse.json({ error: 'Nedostaju podaci za provjeru statusa termina' }, { status: 400 })
    }

    const { data, error } = await supabase.from('termini')
      .select('status')
      .eq('salon_id', salon_id)
      .eq('ime_klijenta', ime)
      .eq('telefon_klijenta', telefon)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ status: data?.status || null })
  }

  const { data, error } = await supabase.from('termini')
    .select('*, usluge(naziv, cijena)')
    .eq('salon_id', salon_id)
    .order('datum_vrijeme', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ termini: data })
}