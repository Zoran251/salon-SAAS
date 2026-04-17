import { NextResponse } from 'next/server'
import { getPublicSupabaseEnv } from '@/lib/env-supabase'

/** Dijagnostika: da li server vidi Supabase env (bez otkrivanja punog ključa). */
export async function GET() {
  const { url, ok } = getPublicSupabaseEnv()
  let host = ''
  try {
    if (url) host = new URL(url).hostname
  } catch {
    host = 'invalid-url'
  }
  return NextResponse.json({
    ok,
    supabaseHost: host,
    hint: ok
      ? 'Server vidi Supabase URL. Ako i dalje imaš Failed to fetch, provjeri da li je Supabase projekat aktivan i URL tačan.'
      : 'Postavi NEXT_PUBLIC_SUPABASE_URL i NEXT_PUBLIC_SUPABASE_ANON_KEY (ili SUPABASE_URL i SUPABASE_ANON_KEY) u Vercel → Environment Variables, pa Redeploy bez cache.',
  })
}
