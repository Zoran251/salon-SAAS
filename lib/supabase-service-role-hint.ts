/** Poruka za developere kada /api/* treba service role, a env nedostaje. */
export const SUPABASE_SERVICE_ROLE_MISSING =
  'Nedostaje SUPABASE_SERVICE_ROLE_KEY na serveru (npr. Vercel → Settings → Environment Variables). ' +
  'U Supabase: Project Settings → API → tajni „service_role“ ključ. Dodaj kao SUPABASE_SERVICE_ROLE_KEY, pa Redeploy. ' +
  'Bez njega kupčki nalog ne može da se poveže sa salonom (tabela salon_clients).'

export const SUPABASE_PUBLIC_ENV_MISSING =
  'Nedostaju SUPABASE_URL i anon ključ (ili NEXT_PUBLIC_SUPABASE_*). Proveri env na hostingu.'
