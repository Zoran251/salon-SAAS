import { createClient } from '@supabase/supabase-js'

type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

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
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const hasConfig = Boolean(supabaseUrl && supabaseKey)

// Lokalni dev: jasna greška ako .env.local nije postavljen.
// Production build (npr. Vercel prije dodavanja env varijabli): ne bacamo — inače padne prerender /dashboard.
if (process.env.NODE_ENV === 'development' && !hasConfig) {
  throw new Error('Nedostaju Supabase env varijable: NEXT_PUBLIC_SUPABASE_URL i NEXT_PUBLIC_SUPABASE_ANON_KEY')
}

const url = hasConfig ? supabaseUrl! : 'https://placeholder.supabase.co'
const key = hasConfig
  ? supabaseKey!
  : 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.build-without-env-placeholder'

/** True kada su NEXT_PUBLIC_SUPABASE_* postavljene u trenutnom bundleu (npr. nakon Vercel deploya s env varijablama). */
export const isSupabaseConfigured = hasConfig

export const supabase = createClient<Database>(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  global: {
    headers: {
      'X-Client-Info': 'salon-saas-web',
    },
  },
})
