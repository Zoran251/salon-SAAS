import { isInvalidRefreshTokenError } from '@/lib/auth-refresh-errors'

export type AuthErrorNetworkHint = 'customer' | 'salon-login' | 'salon-register'

const NETWORK_MESSAGES: Record<AuthErrorNetworkHint, string> = {
  customer: 'Ne možemo se povezati. Provjeri internet ili env na serveru.',
  'salon-login':
    'Ne možemo se povezati s bazom. U Vercel dodaj NEXT_PUBLIC_SUPABASE_URL i NEXT_PUBLIC_SUPABASE_ANON_KEY, pa Redeploy.',
  'salon-register':
    'Ne možemo se povezati s bazom (mrežna greška). Na production sajtu u Vercel → Settings → Environment Variables moraju biti NEXT_PUBLIC_SUPABASE_URL i NEXT_PUBLIC_SUPABASE_ANON_KEY (iste vrijednosti kao u .env.local), zatim Redeploy. Bez toga sajt šalje zahtjeve na pogrešan adresu.',
}

/**
 * Čitljive poruke za korisnika; refresh-token greške nisu kvar PostgreSQL veze.
 */
export function formatAuthError(message: string, networkHint: AuthErrorNetworkHint = 'customer'): string {
  if (isInvalidRefreshTokenError(message)) {
    return 'Sesija u pregledniku je nevažeća (istekao ili oštećen token). Odjavi se ili obriši podatke sajta za ovu domenu (skladište / kolačići), zatim ponovo prijavi.'
  }
  const m = message.toLowerCase()
  if (m.includes('failed to fetch') || m.includes('networkerror')) {
    return NETWORK_MESSAGES[networkHint]
  }
  if (m.includes('email not confirmed') || m.includes('not confirmed')) {
    return 'Potvrdi email (link iz pisma) prije prijave.'
  }
  if (m.includes('invalid login') || m.includes('invalid credentials')) {
    return 'Pogrešan email ili lozinka.'
  }
  return message
}
