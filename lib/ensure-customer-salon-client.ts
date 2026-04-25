import type { SupabaseClient, User } from '@supabase/supabase-js'

export type SalonClientProfileRow = {
  id: string
  ime: string
  telefon: string
  email: string | null
}

function pickPhoneFromUser(user: User): string {
  const m = user.user_metadata as Record<string, unknown> | undefined
  const fromMeta = (key: string) => {
    const v = m?.[key]
    return typeof v === 'string' ? v.trim() : ''
  }
  const raw =
    fromMeta('phone') ||
    fromMeta('telefon') ||
    (typeof user.phone === 'string' && user.phone.trim() ? user.phone.trim() : '')
  return raw
}

function pickImeFromUser(user: User, fallbackEmail: string): string {
  const m = user.user_metadata as Record<string, unknown> | undefined
  const fromMeta = (key: string) => {
    const v = m?.[key]
    return typeof v === 'string' ? v.trim() : ''
  }
  const name =
    fromMeta('full_name') || fromMeta('name') || fromMeta('ime') || fromMeta('display_name')
  if (name) return name
  const at = fallbackEmail.indexOf('@')
  return at > 0 ? fallbackEmail.slice(0, at) : 'Klijent'
}

async function fetchSalonClientByAuth(
  userClient: SupabaseClient,
  salonId: string,
  userId: string
): Promise<{ data: SalonClientProfileRow | null; error: Error | null }> {
  const { data, error } = await userClient
    .from('salon_clients')
    .select('id, ime, telefon, email')
    .eq('salon_id', salonId)
    .eq('auth_user_id', userId)
    .maybeSingle()

  if (error) return { data: null, error: new Error(error.message) }
  return { data: data as SalonClientProfileRow | null, error: null }
}

/**
 * Osigurava red u salon_clients za ulogovanog kupca u datom salonu.
 * Ako ne postoji, pokušava link_salon_client (telefon/ime iz kupac_nalozi ili auth metapodataka).
 */
export async function ensureSalonClientForCustomer(
  userClient: SupabaseClient,
  salonId: string,
  user: User
): Promise<
  | { ok: true; client: SalonClientProfileRow }
  | { ok: false; error: string; status: number }
> {
  const first = await fetchSalonClientByAuth(userClient, salonId, user.id)
  if (first.error) return { ok: false, error: first.error.message, status: 500 }
  if (first.data) return { ok: true, client: first.data }

  const emailFallback = (user.email && user.email.trim()) || ''

  const { data: kn, error: knErr } = await userClient
    .from('kupac_nalozi')
    .select('ime, telefon, email')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  let telefon = ''
  let ime = ''
  let email = emailFallback

  if (!knErr && kn && typeof kn.telefon === 'string' && kn.telefon.trim()) {
    telefon = kn.telefon.trim()
    ime = typeof kn.ime === 'string' && kn.ime.trim() ? kn.ime.trim() : pickImeFromUser(user, emailFallback)
    if (typeof kn.email === 'string' && kn.email.trim()) email = kn.email.trim()
  } else {
    telefon = pickPhoneFromUser(user)
    ime = pickImeFromUser(user, emailFallback)
  }

  if (!telefon) {
    return {
      ok: false,
      error:
        'Na nalogu nije sačuvan broj telefona. Uredite profil kupca (ime i telefon) pa pokušajte ponovo, ili se registrujte putem forme za kupce.',
      status: 422,
    }
  }

  if (!ime) ime = 'Klijent'

  const { error: rpcErr } = await userClient.rpc('link_salon_client', {
    p_salon_id: salonId,
    p_telefon: telefon,
    p_ime: ime,
    p_email: email || '',
  })

  if (rpcErr) {
    const msg = rpcErr.message || 'Povezivanje sa salonom nije uspjelo.'
    const status = /drugim nalogom/i.test(msg) ? 409 : /does not exist/i.test(msg) ? 503 : 400
    return { ok: false, error: msg, status }
  }

  const second = await fetchSalonClientByAuth(userClient, salonId, user.id)
  if (second.error) return { ok: false, error: second.error.message, status: 500 }
  if (!second.data) {
    return { ok: false, error: 'Klijent nije pronađen posle povezivanja sa salonom.', status: 500 }
  }
  return { ok: true, client: second.data }
}
