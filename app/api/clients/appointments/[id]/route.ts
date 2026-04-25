import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { ensureSalonClientForCustomer } from '@/lib/ensure-customer-salon-client'
import { getPublicSupabaseEnv } from '@/lib/env-supabase'
import { SUPABASE_PUBLIC_ENV_MISSING } from '@/lib/supabase-service-role-hint'
import { getServerSupabaseClient, hasServiceRoleKey } from '@/lib/server-supabase'

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
    global: { headers: { Authorization: `Bearer ${authToken}` } },
  })
}

const MINUTES_WARN = 60
const MINUTES_BLACKLIST = 30

function minutesUntilStart(iso: string): number {
  const start = new Date(iso).getTime()
  return (start - Date.now()) / 60_000
}

type RouteCtx = { params: Promise<{ id: string }> }

/** Otkazivanje termina od strane kupca (pragovi: ≥60 min upozorenje, ≤30 min crna lista). */
export async function DELETE(request: Request, context: RouteCtx) {
  try {
    const { ok: envOk } = getPublicSupabaseEnv()
    if (!envOk) {
      return NextResponse.json({ error: SUPABASE_PUBLIC_ENV_MISSING }, { status: 500 })
    }

    const terminId = (await context.params).id
    if (!terminId) {
      return NextResponse.json({ error: 'Nedostaje id termina.' }, { status: 400 })
    }

    const url = new URL(request.url)
    const authToken = url.searchParams.get('auth_token')
    const salonId = url.searchParams.get('salon_id')
    if (!authToken || !salonId) {
      return NextResponse.json({ error: 'Nedostaju auth_token ili salon_id.' }, { status: 400 })
    }

    const anonClient = getAnonClient()
    if (!anonClient) {
      return NextResponse.json({ error: SUPABASE_PUBLIC_ENV_MISSING }, { status: 500 })
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

    const service = getServerSupabaseClient()
    if (!service) {
      return NextResponse.json({ error: 'Server nije konfigurisan.' }, { status: 500 })
    }

    const { data: termin, error: terminError } = await service
      .from('termini')
      .select('id, salon_id, client_id, datum_vrijeme, status')
      .eq('id', terminId)
      .maybeSingle()

    if (terminError) return NextResponse.json({ error: terminError.message }, { status: 500 })
    if (!termin || termin.salon_id !== salonId || termin.client_id !== clientData.id) {
      return NextResponse.json({ error: 'Termin nije pronađen.' }, { status: 404 })
    }

    if (termin.status === 'otkazan') {
      return NextResponse.json({ success: true, tier: 'already_cancelled', message: 'Termin je već otkazan.' })
    }

    const minutesBefore = minutesUntilStart(termin.datum_vrijeme as string)

    let tier: 'early_warning' | 'late_warning' | 'blacklist' = 'early_warning'
    if (minutesBefore <= MINUTES_BLACKLIST) {
      tier = 'blacklist'
    } else if (minutesBefore < MINUTES_WARN) {
      tier = 'late_warning'
    }

    if (tier === 'blacklist' && !hasServiceRoleKey()) {
      return NextResponse.json(
        {
          error:
            'Kasno otkazivanje zahteva administratorski ključ na serveru (SUPABASE_SERVICE_ROLE_KEY). Kontaktirajte podršku.',
        },
        { status: 503 }
      )
    }

    const { error: updErr } = await service
      .from('termini')
      .update({ status: 'otkazan' })
      .eq('id', terminId)

    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

    if (tier === 'blacklist') {
      const { error: blErr } = await service.from('kupci_crna_lista').upsert(
        {
          auth_user_id: userData.user.id,
          telefon: clientData.telefon,
          ime: clientData.ime,
          razlog: 'kasno_otkazivanje',
          minuta_pre_otkazivanja: Math.round(minutesBefore * 10) / 10,
          salon_id: salonId,
          termin_id: terminId,
        },
        { onConflict: 'auth_user_id' }
      )

      if (blErr) {
        return NextResponse.json(
          { error: `Termin je otkazan, ali zapis u crnoj listi nije uspeo: ${blErr.message}` },
          { status: 500 }
        )
      }
    }

    const messages: Record<string, string> = {
      early_warning:
        'Termin je otkazan. Hvala što ste nas obavestili bar sat vremena unapred — ipak, česta otkazivanja otežavaju rad salona.',
      late_warning:
        'Termin je otkazan. Otkazivanje u roku kraćem od jednog sata pre termina nije poželjno; molimo vas da ubuduće javite ranije.',
      blacklist:
        'Termin je otkazan vrlo kasno. Vaš nalog je zabeležen na globalnoj crnoj listi i nećete moći zakazivati termine u salonima na ovoj platformi dok administrator ne ukloni zapis.',
    }

    return NextResponse.json({
      success: true,
      tier,
      message: messages[tier] ?? 'Termin je otkazan.',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Greška servera.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/** Izmena datuma/vremena, usluge ili napomene (samo ako je preostalo više od 30 min do termina). */
export async function PATCH(request: Request, context: RouteCtx) {
  try {
    const { ok: envOk } = getPublicSupabaseEnv()
    if (!envOk) {
      return NextResponse.json({ error: SUPABASE_PUBLIC_ENV_MISSING }, { status: 500 })
    }

    const terminId = (await context.params).id
    if (!terminId) {
      return NextResponse.json({ error: 'Nedostaje id termina.' }, { status: 400 })
    }

    const url = new URL(request.url)
    const authToken = url.searchParams.get('auth_token')
    const salonId = url.searchParams.get('salon_id')
    if (!authToken || !salonId) {
      return NextResponse.json({ error: 'Nedostaju auth_token ili salon_id.' }, { status: 400 })
    }

    const anonClient = getAnonClient()
    if (!anonClient) {
      return NextResponse.json({ error: SUPABASE_PUBLIC_ENV_MISSING }, { status: 500 })
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
      datum_vrijeme?: string
      usluga_id?: string | null
      napomena?: string | null
    }

    const service = getServerSupabaseClient()
    if (!service) {
      return NextResponse.json({ error: 'Server nije konfigurisan.' }, { status: 500 })
    }

    const { data: termin, error: terminError } = await service
      .from('termini')
      .select('id, salon_id, client_id, datum_vrijeme, status')
      .eq('id', terminId)
      .maybeSingle()

    if (terminError) return NextResponse.json({ error: terminError.message }, { status: 500 })
    if (!termin || termin.salon_id !== salonId || termin.client_id !== clientData.id) {
      return NextResponse.json({ error: 'Termin nije pronađen.' }, { status: 404 })
    }

    if (termin.status === 'otkazan') {
      return NextResponse.json({ error: 'Otkazan termin se ne može menjati.' }, { status: 400 })
    }

    if (minutesUntilStart(termin.datum_vrijeme as string) <= MINUTES_BLACKLIST) {
      return NextResponse.json(
        { error: 'Izmena nije moguća: do termina je ostalo 30 minuta ili manje.' },
        { status: 400 }
      )
    }

    const patch: Record<string, string | null> = {}
    if (typeof body.datum_vrijeme === 'string' && body.datum_vrijeme.trim()) {
      patch.datum_vrijeme = body.datum_vrijeme.trim()
    }
    if (body.usluga_id !== undefined) {
      patch.usluga_id = body.usluga_id === null || body.usluga_id === '' ? null : String(body.usluga_id)
    }
    if (body.napomena !== undefined) {
      patch.napomena = body.napomena === null ? null : String(body.napomena).trim() || null
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'Nema podataka za izmenu.' }, { status: 400 })
    }

    const { error: updErr } = await service.from('termini').update(patch).eq('id', terminId)

    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })
    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Greška servera.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
