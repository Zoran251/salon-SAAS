import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getPublicSupabaseEnv } from '@/lib/env-supabase'
import { APP_ROLE_KEY } from '@/lib/user-role'

/**
 * Prijava / registracija preko servera → preglednik ne mora direktno zvati *.supabase.co
 * (pomaže kod "Failed to fetch", blokatora, pogrešnog NEXT_PUBLIC u bundleu).
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const action = body.action as string
    const email = typeof body.email === 'string' ? body.email.trim() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    const authContext = body.auth_context === 'customer' ? 'customer' : body.auth_context === 'salon' ? 'salon' : null

    if (!email || !password) {
      return NextResponse.json({ error: 'Email i lozinka su obavezni.' }, { status: 400 })
    }

    const { url, anonKey, ok } = getPublicSupabaseEnv()
    if (!ok) {
      return NextResponse.json(
        { error: 'Server nema Supabase URL i anon ključ (Vercel env: SUPABASE_URL + SUPABASE_ANON_KEY ili NEXT_PUBLIC_*).' },
        { status: 500 },
      )
    }

    const supabase = createClient(url, anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })

    if (action === 'signin') {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 401 })
      }

      if (authContext === 'customer' && data.user?.id) {
        const { data: blocked, error: rpcErr } = await supabase.rpc('je_auth_blokiran', {
          p_uid: data.user.id,
        })
        if (!rpcErr && blocked === true) {
          return NextResponse.json(
            {
              error:
                'Pristup je blokiran: vaš nalog je na crnoj listi. Ne možete se prijaviti kao kupac. Za pitanja kontaktirajte salon.',
            },
            { status: 403 },
          )
        }
      }

      return NextResponse.json({
        session: data.session
          ? {
              access_token: data.session.access_token,
              refresh_token: data.session.refresh_token,
              expires_in: data.session.expires_in,
              expires_at: data.session.expires_at,
              token_type: data.session.token_type,
            }
          : null,
        user: data.user,
      })
    }

    if (action === 'signup') {
      const appRole = body.app_role as string | undefined
      const roleOk = appRole === 'salon_owner' || appRole === 'customer'

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        ...(roleOk ? { options: { data: { [APP_ROLE_KEY]: appRole } } } : {}),
      })
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({
        session: data.session
          ? {
              access_token: data.session.access_token,
              refresh_token: data.session.refresh_token,
              expires_in: data.session.expires_in,
              expires_at: data.session.expires_at,
              token_type: data.session.token_type,
            }
          : null,
        user: data.user,
      })
    }

    return NextResponse.json({ error: 'Nepoznata akcija (očekuje se signin ili signup).' }, { status: 400 })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Greška na serveru.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
