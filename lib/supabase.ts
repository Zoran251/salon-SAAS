import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/** JSON vrednost kao u generisanim Supabase tipovima (Json iz novijih verzija paketa nije uvek izvezen). */
type DbJson = string | number | boolean | null | { [key: string]: DbJson | undefined } | DbJson[]
import { getPublicSupabaseEnv } from '@/lib/env-supabase'

export type Database = {
  public: {
    Tables: {
      saloni: {
        Row: {
          id: string
          naziv: string
          slug: string | null
          email: string
          telefon: string | null
          grad: string | null
          tip: string | null
          aktivan: boolean | null
          opis: string | null
          adresa: string | null
          radno_od: string | null
          radno_do: string | null
          logo_url: string | null
          boja_primarna: string | null
          landing_page: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          naziv: string
          slug?: string | null
          email: string
          telefon?: string | null
          grad?: string | null
          tip?: string | null
          aktivan?: boolean | null
          opis?: string | null
          adresa?: string | null
          radno_od?: string | null
          radno_do?: string | null
          logo_url?: string | null
          boja_primarna?: string | null
          landing_page?: string | null
          created_at?: string | null
        }
        Update: Partial<Database['public']['Tables']['saloni']['Insert']>
        Relationships: []
      }
      usluge: {
        Row: {
          id: string
          salon_id: string
          naziv: string
          cijena: number
          trajanje: number | null
          opis: string | null
          kategorija: string | null
          aktivan: boolean | null
          created_at: string | null
        }
        Insert: {
          id?: string
          salon_id: string
          naziv: string
          cijena: number
          trajanje?: number | null
          opis?: string | null
          kategorija?: string | null
          aktivan?: boolean | null
          created_at?: string | null
        }
        Update: Partial<Database['public']['Tables']['usluge']['Insert']>
        Relationships: []
      }
      lager: {
        Row: {
          id: string
          salon_id: string
          naziv: string
          kategorija: string | null
          kolicina: number
          minimum: number
          jedinica: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          salon_id: string
          naziv: string
          kategorija?: string | null
          kolicina: number
          minimum?: number
          jedinica?: string | null
          created_at?: string | null
        }
        Update: Partial<Database['public']['Tables']['lager']['Insert']>
        Relationships: []
      }
      termini: {
        Row: {
          id: string
          salon_id: string
          client_id: string | null
          usluga_id: string | null
          ime_klijenta: string
          telefon_klijenta: string
          datum_vrijeme: string
          napomena: string | null
          status: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          salon_id: string
          client_id?: string | null
          usluga_id?: string | null
          ime_klijenta: string
          telefon_klijenta: string
          datum_vrijeme: string
          napomena?: string | null
          status?: string | null
          created_at?: string | null
        }
        Update: Partial<Database['public']['Tables']['termini']['Insert']>
        Relationships: []
      }
      lojalnost: {
        Row: {
          id: string
          salon_id: string
          aktivan: boolean
          tip: string
          svaki_koji: number
          vrijednost: number
          created_at: string | null
        }
        Insert: {
          id?: string
          salon_id: string
          aktivan?: boolean
          tip?: string
          svaki_koji?: number
          vrijednost?: number
          created_at?: string | null
        }
        Update: Partial<Database['public']['Tables']['lojalnost']['Insert']>
        Relationships: []
      }
      kupci_crna_lista: {
        Row: {
          id: string
          auth_user_id: string | null
          telefon: string
          ime: string | null
          razlog: string
          minuta_pre_otkazivanja: number | null
          salon_id: string | null
          termin_id: string | null
          created_at: string
          /** Iz .select('*, saloni(naziv)') — samo za čitanje u dashboardu. */
          saloni?: { naziv: string | null } | null
        }
        Insert: {
          id?: string
          auth_user_id?: string | null
          telefon: string
          ime?: string | null
          razlog?: string
          minuta_pre_otkazivanja?: number | null
          salon_id?: string | null
          termin_id?: string | null
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['kupci_crna_lista']['Insert']>
        Relationships: []
      }
      kupac_nalozi: {
        Row: {
          id: string
          auth_user_id: string
          email: string
          ime: string
          telefon: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          auth_user_id: string
          email: string
          ime: string
          telefon: string
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['kupac_nalozi']['Insert']>
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: {
      salon_dodaj_kupca_u_crnu_listu: {
        Args: { p_telefon: string; p_ime?: string | null }
        Returns: DbJson
      }
      je_telefon_blokiran: {
        Args: { p_telefon: string }
        Returns: boolean
      }
      je_auth_blokiran: {
        Args: { p_uid: string }
        Returns: boolean
      }
      ensure_salon_client_for_booking: {
        Args: {
          p_salon_id: string
          p_ime: string
          p_telefon: string
          p_email: string | null
        }
        Returns: string
      }
      link_salon_client: {
        Args: {
          p_salon_id: string
          p_telefon: string
          p_ime: string
          p_email: string
        }
        Returns: string
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

declare global {
  interface Window {
    __SALON_SUPABASE__?: { url: string; anonKey: string }
  }
}

const PLACEHOLDER_URL = 'https://placeholder.supabase.co'
const PLACEHOLDER_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.build-without-env-placeholder'

const clientOptions = {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce' as const,
    // Eksplicitno localStorage — sesija ostaje posle osvežavanja dok korisnik ne klikne „Odjavi se”.
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
  },
  global: {
    headers: {
      'X-Client-Info': 'salon-saas-web',
    },
  },
} as const

function resolveBrowserConfig(): { url: string; key: string } {
  if (typeof window !== 'undefined') {
    const inj = window.__SALON_SUPABASE__
    if (inj?.url && inj?.anonKey) {
      return { url: inj.url, key: inj.anonKey }
    }
  }
  const { url, anonKey, ok } = getPublicSupabaseEnv()
  if (ok) return { url, key: anonKey }
  const u = process.env.NEXT_PUBLIC_SUPABASE_URL
  const k = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (u && k) return { url: u, key: k }
  return { url: PLACEHOLDER_URL, key: PLACEHOLDER_KEY }
}

let browserClient: SupabaseClient<Database> | null = null

function getSupabaseInternal(): SupabaseClient<Database> {
  if (typeof window === 'undefined') {
    const { url, anonKey, ok } = getPublicSupabaseEnv()
    if (!ok) {
      return createClient<Database>(PLACEHOLDER_URL, PLACEHOLDER_KEY, {
        auth: { persistSession: false },
      })
    }
    return createClient<Database>(url, anonKey, {
      auth: { persistSession: false },
      global: clientOptions.global,
    })
  }
  if (!browserClient) {
    const cfg = resolveBrowserConfig()
    browserClient = createClient<Database>(cfg.url, cfg.key, clientOptions)
  }
  return browserClient
}

if (process.env.NODE_ENV === 'development' && !getPublicSupabaseEnv().ok) {
  throw new Error(
    'Nedostaju Supabase env varijable: NEXT_PUBLIC_SUPABASE_URL i NEXT_PUBLIC_SUPABASE_ANON_KEY (ili SUPABASE_URL i SUPABASE_ANON_KEY u .env.local)',
  )
}

/** True nakon što layout injektuje window.__SALON_SUPABASE__ ili ako su NEXT_PUBLIC varijable u bundleu. */
export function isSupabaseConfigured(): boolean {
  if (typeof window !== 'undefined') {
    const inj = window.__SALON_SUPABASE__
    if (inj?.url && inj?.anonKey) return true
  }
  return getPublicSupabaseEnv().ok
}

/**
 * Lazy klijent preko Proxy-a: svaki pristup ide na jedan browser singleton (session u localStorage).
 * Funkcije na root nivou moraju imati `this` = client (.from, .rpc).
 */
export const supabase: SupabaseClient<Database> = new Proxy({} as SupabaseClient<Database>, {
  get(_target, prop) {
    const client = getSupabaseInternal()
    const value = Reflect.get(client, prop, client) as unknown
    if (typeof value === 'function') {
      const fn = value as (...args: unknown[]) => unknown
      return (...args: unknown[]) => fn.apply(client, args)
    }
    return value
  },
}) as SupabaseClient<Database>
