import { NextResponse } from 'next/server'
import { getServerSupabaseClient } from '@/lib/server-supabase'

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

    const authHeader = request.headers.get('authorization')
    let authUserId: string | null = null
    if (authHeader?.toLowerCase().startsWith('bearer ')) {
      const jwt = authHeader.slice(7).trim()
      if (jwt) {
        const { data: userRes } = await supabase.auth.getUser(jwt)
        authUserId = userRes.user?.id ?? null
      }
    }

    const { data: blockedPhone, error: rpcPhoneErr } = await supabase.rpc('je_telefon_blokiran', {
      p_telefon: telefonKlijenta,
    })
    if (!rpcPhoneErr && blockedPhone === true) {
      return NextResponse.json(
        { error: 'Zakazivanje nije moguće: ovaj broj telefona je na crnoj listi.' },
        { status: 403 }
      )
    }

    if (authUserId) {
      const { data: blockedAuth, error: rpcAuthErr } = await supabase.rpc('je_auth_blokiran', {
        p_uid: authUserId,
      })
      if (!rpcAuthErr && blockedAuth === true) {
        return NextResponse.json(
          { error: 'Zakazivanje nije moguće: vaš nalog je na crnoj listi.' },
          { status: 403 }
        )
      }
    }

    // Direktan INSERT u salon_clients sa anon ključem krši RLS (samo vlasnik salona sme).
    // RPC ensure_salon_client_for_booking (security definer) — migracija 2026-04-24.
    const { data: clientIdRaw, error: clientRpcError } = await supabase.rpc('ensure_salon_client_for_booking', {
      p_salon_id: salon_id,
      p_ime: imeKlijenta,
      p_telefon: telefonKlijenta,
      p_email: clientEmail,
    })

    if (clientRpcError) {
      const missingFn = /function .* does not exist|Could not find the function/i.test(clientRpcError.message)
      return NextResponse.json(
        {
          error: missingFn
            ? 'Baza nije ažurirana: pokreni migraciju 2026-04-24_ensure_salon_client_booking_rpc.sql u Supabase SQL Editor-u, ili postavi SUPABASE_SERVICE_ROLE_KEY na serveru.'
            : clientRpcError.message,
        },
        { status: 500 }
      )
    }

    const clientId = typeof clientIdRaw === 'string' ? clientIdRaw : null
    if (!clientId) {
      return NextResponse.json({ error: 'Neuspješno povezivanje klijenta sa salonom.' }, { status: 500 })
    }

    const { data: inserted, error } = await supabase
      .from('termini')
      .insert({
        salon_id,
        client_id: clientId,
        usluga_id,
        ime_klijenta: imeKlijenta,
        telefon_klijenta: telefonKlijenta,
        datum_vrijeme,
        napomena,
        status: 'ceka',
      })
      .select('id')
      .single()

    if (error) {
      const rlsHint = !process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() && /row-level security/i.test(error.message)
      return NextResponse.json(
        {
          error: rlsHint
            ? 'RLS blokira javno zakazivanje. Dodaj policy za anon INSERT na tabeli termini ili postavi SUPABASE_SERVICE_ROLE_KEY.'
            : error.message,
        },
        { status: 500 }
      )
    }
    return NextResponse.json({ success: true, termin_id: inserted?.id ?? null })
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
    const termin_id = searchParams.get('termin_id')
    const ime = searchParams.get('ime')
    const telefon = searchParams.get('telefon')
    const datum_vrijeme = searchParams.get('datum_vrijeme')

    if (termin_id) {
      const { data, error } = await supabase
        .from('termini')
        .select('status')
        .eq('salon_id', salon_id)
        .eq('id', termin_id)
        .maybeSingle()

      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ status: data?.status || null })
    }

    if (!ime || !telefon || !datum_vrijeme) {
      return NextResponse.json({ error: 'Nedostaju podaci za provjeru statusa termina' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('termini')
      .select('status')
      .eq('salon_id', salon_id)
      .eq('ime_klijenta', ime)
      .eq('telefon_klijenta', telefon)
      .eq('datum_vrijeme', datum_vrijeme)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ status: data?.status || null })
  }

  const { data, error } = await supabase
    .from('termini')
    .select('*, usluge(naziv, cijena)')
    .eq('salon_id', salon_id)
    .order('datum_vrijeme', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ termini: data })
}
