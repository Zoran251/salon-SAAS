import { NextResponse } from 'next/server'
import { getServerSupabaseClient } from '@/lib/server-supabase'
import { storageTerminStatus } from '@/lib/termin-status'

export const dynamic = 'force-dynamic'

/** PostgREST / supabase-js ponekad vraća skalar kao string, a ponekad ugnježđeno. */
function unwrapRpcText(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'string') return raw.length > 0 ? raw : null
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw)
  if (Array.isArray(raw)) {
    if (raw.length === 0) return null
    const first = raw[0]
    if (typeof first === 'string') return first.length > 0 ? first : null
    if (first !== null && typeof first === 'object') return unwrapRpcText(first)
  }
  if (typeof raw === 'object') {
    for (const v of Object.values(raw as Record<string, unknown>)) {
      const inner = unwrapRpcText(v)
      if (inner) return inner
    }
  }
  return null
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

    if (authUserId) {
      await supabase
        .from('salon_clients')
        .update({ auth_user_id: authUserId })
        .eq('id', clientId)
        .is('auth_user_id', null)
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
            ? 'RLS blokira javno zakazivanje. Uradi jedno od dva: (1) Vercel → Environment Variables → dodaj SUPABASE_SERVICE_ROLE_KEY (Project Settings → API → service_role) pa Redeploy; ili (2) u Supabase SQL Editor pokreni migraciju db/migrations/2026-05-03_ensure_anon_insert_termini.sql (ili 2026-04-14_client_portal.sql ako još nisi).'
            : error.message,
        },
        { status: 500 }
      )
    }
    const terminIdOut = inserted?.id != null ? String(inserted.id) : null
    return NextResponse.json({ success: true, termin_id: terminIdOut })
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
    const termin_id_raw = searchParams.get('termin_id')
    const ime = searchParams.get('ime')
    const telefon = searchParams.get('telefon')
    const datum_vrijeme = searchParams.get('datum_vrijeme')

    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    const termin_id = termin_id_raw && uuidRe.test(termin_id_raw.trim()) ? termin_id_raw.trim() : null

    if (!termin_id && (!ime || !telefon || !datum_vrijeme)) {
      return NextResponse.json({ error: 'Nedostaju podaci za provjeru statusa termina' }, { status: 400 })
    }

    const { data: rpcStatus, error: rpcErr } = await supabase.rpc('get_public_termin_status', {
      p_salon_id: salon_id,
      p_termin_id: termin_id,
      p_ime: termin_id ? null : ime,
      p_telefon: termin_id ? null : telefon,
      p_datum_vrijeme: termin_id ? null : datum_vrijeme,
    })

    if (rpcErr) {
      const missingFn =
        /get_public_termin_status|does not exist/i.test(rpcErr.message) &&
        /function|Could not find/i.test(rpcErr.message)
      return NextResponse.json(
        {
          error: missingFn
            ? 'Baza: pokreni migraciju db/migrations/2026-04-30_get_public_termin_status_rpc.sql (funkcija get_public_termin_status).'
            : rpcErr.message,
        },
        { status: missingFn ? 503 : 500 }
      )
    }

    const rawStatus = unwrapRpcText(rpcStatus)
    const status = rawStatus != null ? storageTerminStatus(rawStatus) : null
    return NextResponse.json(
      { status: status ?? null },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
          Pragma: 'no-cache',
        },
      }
    )
  }

  const { data, error } = await supabase
    .from('termini')
    .select('*, usluge(naziv, cijena)')
    .eq('salon_id', salon_id)
    .order('datum_vrijeme', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ termini: data })
}
