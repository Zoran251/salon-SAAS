import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getPublicSupabaseEnv } from '@/lib/env-supabase'
import { buildSalonSlug, fallbackSalonSlug } from '@/lib/slug'

/**
 * Kreiranje reda u `saloni` kada nakon signUp nema sesije (obavezna potvrda emaila).
 * Zahtijeva SUPABASE_SERVICE_ROLE_KEY na serveru.
 */
export async function POST(request: Request) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!serviceKey) {
    return NextResponse.json(
      { error: 'SUPABASE_SERVICE_ROLE_KEY nije postavljen na serveru.' },
      { status: 503 },
    )
  }

  const { url, ok } = getPublicSupabaseEnv()
  if (!ok) {
    return NextResponse.json({ error: 'Supabase env nedostaje.' }, { status: 500 })
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  try {
    const body = await request.json()
    const userId = typeof body.userId === 'string' ? body.userId : ''
    const naziv = typeof body.naziv === 'string' ? body.naziv : ''
    const email = typeof body.email === 'string' ? body.email.trim() : ''
    const telefon = typeof body.telefon === 'string' ? body.telefon : ''
    const grad = typeof body.grad === 'string' ? body.grad : ''
    const tip = typeof body.tip === 'string' ? body.tip : ''

    const uid = typeof userId === 'string' ? userId.trim() : ''
    if (!uid || !naziv || !email) {
      return NextResponse.json({ error: 'Nedostaju obavezni podaci.' }, { status: 400 })
    }

    // Nakon signUp korisnik ponekad nije odmah vidljiv u Admin API — nekoliko pokušaja.
    let lastAuthErr: { message: string } | null = null
    let found = false
    for (let attempt = 0; attempt < 6; attempt++) {
      const { data, error: authErr } = await admin.auth.admin.getUserById(uid)
      lastAuthErr = authErr
      if (!authErr && data?.user) {
        found = true
        break
      }
      await new Promise((r) => setTimeout(r, 180 * (attempt + 1)))
    }
    if (!found && lastAuthErr) {
      // I dalje nastavi s insertom — ako postoji FK ka auth.users, baza će vratiti jasnu grešku.
      console.warn('[register-initial] getUserById nakon retry:', lastAuthErr.message)
    }

    const baseSlug = fallbackSalonSlug(buildSalonSlug(naziv))
    let slug = baseSlug
    let suffix = 2
    while (true) {
      const { data: existing } = await admin.from('saloni').select('id').eq('slug', slug).maybeSingle()
      if (!existing) break
      slug = `${baseSlug}-${suffix}`
      suffix += 1
    }

    const { error: insErr } = await admin.from('saloni').insert({
      id: uid,
      naziv,
      slug,
      email,
      telefon,
      grad,
      tip,
      aktivan: true,
    })

    if (insErr) {
      return NextResponse.json({ error: insErr.message }, { status: 400 })
    }

    return NextResponse.json({ ok: true, slug })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Greška na serveru.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
