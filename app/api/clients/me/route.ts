import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getPublicSupabaseEnv } from '@/lib/env-supabase'
import { ensureSalonClientForCustomer } from '@/lib/ensure-customer-salon-client'
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
 * Profil kupca + obaveštenja — JWT + RLS.
 */
export async function GET(request: Request) {
  try {
    const { ok: envOk } = getPublicSupabaseEnv()
    if (!envOk) {
      return NextResponse.json({ error: SUPABASE_PUBLIC_ENV_MISSING }, { status: 500 })
    }

    const anonClient = getAnonClient()
    if (!anonClient) {
      return NextResponse.json({ error: SUPABASE_PUBLIC_ENV_MISSING }, { status: 500 })
    }

    const { searchParams } = new URL(request.url)
    const authToken = searchParams.get('auth_token')
    const salonId = searchParams.get('salon_id')
    if (!authToken || !salonId) {
      return NextResponse.json({ error: 'Nedostaju auth token ili salon_id.' }, { status: 400 })
    }

    const { data: userData, error: userError } = await anonClient.auth.getUser(authToken)
    if (userError || !userData.user) {
      return NextResponse.json({ error: 'Nevažeća sesija.' }, { status: 401 })
    }

    const userClient = getUserClient(authToken)
    if (!userClient) {
      return NextResponse.json({ error: SUPABASE_PUBLIC_ENV_MISSING }, { status: 500 })
    }

    const ensured = await ensureSalonClientForCustomer(userClient, salonId, userData.user)
    if (!ensured.ok) {
      return NextResponse.json({ error: ensured.error }, { status: ensured.status })
    }
    const clientData = ensured.client

    const { data: appointments, error: appointmentsError } = await userClient
      .from('termini')
      .select('id, datum_vrijeme, status, ime_klijenta, telefon_klijenta, usluga_id, napomena, usluge(naziv)')
      .eq('salon_id', salonId)
      .eq('client_id', clientData.id)
      .order('datum_vrijeme', { ascending: false })

    if (appointmentsError) return NextResponse.json({ error: appointmentsError.message }, { status: 500 })

    const { data: loyaltyData, error: loyaltyError } = await userClient
      .from('loyalty_accounts')
      .select('visits_count, progress_percent, reward_ready')
      .eq('salon_id', salonId)
      .eq('client_id', clientData.id)
      .maybeSingle()

    const loyaltyMissing =
      loyaltyError &&
      /loyalty_accounts|schema cache|does not exist/i.test(loyaltyError.message)
    if (loyaltyError && !loyaltyMissing) {
      return NextResponse.json({ error: loyaltyError.message }, { status: 500 })
    }

    const { data: notifRows, error: notifErr } = await userClient
      .from('notifications')
      .select('id, title, body, tip, created_at, read_at, appointment_id')
      .eq('client_id', clientData.id)
      .order('created_at', { ascending: false })
      .limit(30)

    if (notifErr) return NextResponse.json({ error: notifErr.message }, { status: 500 })

    const allAppointments = appointments || []
    const stats = {
      ukupnoTermina: allAppointments.length,
      potvrdjeni: allAppointments.filter((a) => a.status === 'potvrđen').length,
      cekaju: allAppointments.filter((a) => a.status !== 'potvrđen' && a.status !== 'otkazan').length,
    }

    const { data: bookingBlocked, error: blErr } = await userClient.rpc('je_auth_blokiran', {
      p_uid: userData.user.id,
    })
    const booking_blocked = !blErr && bookingBlocked === true

    return NextResponse.json({
      client: clientData,
      stats,
      booking_blocked,
      loyalty:
        loyaltyData && !loyaltyError
          ? loyaltyData
          : { visits_count: 0, progress_percent: 0, reward_ready: false },
      appointments: allAppointments.slice(0, 6),
      notifications: notifRows || [],
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Greška servera.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/**
 * Ažuriranje podataka kupca ili označavanje obaveštenja kao pročitanog.
 */
export async function PATCH(request: Request) {
  try {
    const { ok: envOk } = getPublicSupabaseEnv()
    if (!envOk) {
      return NextResponse.json({ error: SUPABASE_PUBLIC_ENV_MISSING }, { status: 500 })
    }

    const anonClient = getAnonClient()
    if (!anonClient) {
      return NextResponse.json({ error: SUPABASE_PUBLIC_ENV_MISSING }, { status: 500 })
    }

    const url = new URL(request.url)
    const authToken = url.searchParams.get('auth_token')
    const salonId = url.searchParams.get('salon_id')
    if (!authToken || !salonId) {
      return NextResponse.json({ error: 'Nedostaju auth token ili salon_id.' }, { status: 400 })
    }

    const { data: userData, error: userError } = await anonClient.auth.getUser(authToken)
    if (userError || !userData.user) {
      return NextResponse.json({ error: 'Nevažeća sesija.' }, { status: 401 })
    }

    const userClient = getUserClient(authToken)
    if (!userClient) {
      return NextResponse.json({ error: SUPABASE_PUBLIC_ENV_MISSING }, { status: 500 })
    }

    const ensured = await ensureSalonClientForCustomer(userClient, salonId, userData.user)
    if (!ensured.ok) {
      return NextResponse.json({ error: ensured.error }, { status: ensured.status })
    }
    const clientData = ensured.client

    const body = (await request.json()) as {
      ime?: string
      telefon?: string
      email?: string | null
      mark_notification_read?: string
    }

    if (typeof body.mark_notification_read === 'string' && body.mark_notification_read.trim()) {
      const nid = body.mark_notification_read.trim()
      const { error: upErr } = await userClient
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', nid)
        .eq('client_id', clientData.id)

      if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })
      return NextResponse.json({ success: true })
    }

    const ime = typeof body.ime === 'string' ? body.ime.trim() : undefined
    const telefon = typeof body.telefon === 'string' ? body.telefon.trim() : undefined
    const email =
      body.email === null || body.email === undefined
        ? undefined
        : typeof body.email === 'string'
          ? body.email.trim() || null
          : undefined

    if (ime === undefined && telefon === undefined && email === undefined) {
      return NextResponse.json({ error: 'Nema podataka za izmenu.' }, { status: 400 })
    }

    const patch: Record<string, string | null> = {}
    if (ime !== undefined) {
      if (!ime) return NextResponse.json({ error: 'Ime ne može biti prazno.' }, { status: 400 })
      patch.ime = ime
    }
    if (telefon !== undefined) {
      if (!telefon) return NextResponse.json({ error: 'Telefon ne može biti prazan.' }, { status: 400 })
      patch.telefon = telefon
    }
    if (email !== undefined) patch.email = email

    const { error: updErr } = await userClient.from('salon_clients').update(patch).eq('id', clientData.id)

    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })
    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Greška servera.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
