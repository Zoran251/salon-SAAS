import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

function getAnonClient() {
  if (!supabaseUrl || !supabaseAnonKey) return null
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function getServiceClient() {
  if (!supabaseUrl || !supabaseServiceRoleKey) return null
  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function GET(request: Request) {
  try {
    const anonClient = getAnonClient()
    const serviceClient = getServiceClient()
    if (!anonClient || !serviceClient) {
      return NextResponse.json({ error: 'Server konfiguracija nije potpuna.' }, { status: 500 })
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

    const { data: clientData, error: clientError } = await serviceClient
      .from('salon_clients')
      .select('id, ime, telefon, email')
      .eq('salon_id', salonId)
      .eq('auth_user_id', userData.user.id)
      .maybeSingle()

    if (clientError) return NextResponse.json({ error: clientError.message }, { status: 500 })
    if (!clientData) return NextResponse.json({ error: 'Klijent nije povezan sa ovim salonom.' }, { status: 404 })

    const { data: appointments, error: appointmentsError } = await serviceClient
      .from('termini')
      .select('id, datum_vrijeme, status, ime_klijenta')
      .eq('salon_id', salonId)
      .eq('client_id', clientData.id)
      .order('datum_vrijeme', { ascending: false })

    if (appointmentsError) return NextResponse.json({ error: appointmentsError.message }, { status: 500 })

    const { data: loyaltyData, error: loyaltyError } = await serviceClient
      .from('loyalty_accounts')
      .select('visits_count, progress_percent, reward_ready')
      .eq('salon_id', salonId)
      .eq('client_id', clientData.id)
      .maybeSingle()

    if (loyaltyError) return NextResponse.json({ error: loyaltyError.message }, { status: 500 })

    const allAppointments = appointments || []
    const stats = {
      ukupnoTermina: allAppointments.length,
      potvrdjeni: allAppointments.filter((a) => a.status === 'potvrđen').length,
      cekaju: allAppointments.filter((a) => a.status !== 'potvrđen').length,
    }

    return NextResponse.json({
      client: clientData,
      stats,
      loyalty: loyaltyData || { visits_count: 0, progress_percent: 0, reward_ready: false },
      appointments: allAppointments.slice(0, 6),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Greška servera.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
