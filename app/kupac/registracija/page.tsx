'use client'

import type { CSSProperties } from 'react'
import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { authPasswordViaApi } from '@/lib/auth-via-api'
import { APP_ROLE_KEY, getAppRole } from '@/lib/user-role'
import { getSafeNextPath, parseSalonSlugFromPath } from '@/lib/safe-next-path'
import { formatAuthError } from '@/lib/format-auth-error'
import { supabase } from '@/lib/supabase'
import { waitForClientSession } from '@/lib/wait-client-session'

async function linkKupacNaSalon(params: {
  salonId: string
  ime: string
  telefon: string
  email: string
}): Promise<{ ok: boolean; error?: string }> {
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData.session?.access_token
  if (!token) return { ok: false, error: 'Nema sesije.' }

  const res = await fetch('/api/clients/link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      auth_token: token,
      salon_id: params.salonId,
      ime: params.ime,
      telefon: params.telefon,
      email: params.email,
    }),
  })
  const data = (await res.json()) as { error?: string }
  if (!res.ok || data.error) return { ok: false, error: data.error || 'Povezivanje nije uspjelo.' }
  return { ok: true }
}

function KupacRegistracijaForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const nextPath = getSafeNextPath(searchParams.get('next'))

  const [loading, setLoading] = useState(false)
  const [greska, setGreska] = useState('')
  const [forma, setForma] = useState({ ime: '', telefon: '', email: '', lozinka: '' })

  const handleSubmit = async () => {
    const email = forma.email.trim()
    const ime = forma.ime.trim()
    const telefon = forma.telefon.trim()
    if (!email || !forma.lozinka || !telefon) {
      setGreska('Email, telefon i lozinka su obavezni.')
      return
    }
    if (!ime) {
      setGreska('Unesite ime i prezime.')
      return
    }

    setLoading(true)
    setGreska('')

    const r = await authPasswordViaApi('signup', email, forma.lozinka, { app_role: 'customer' })
    if (r.error) {
      setGreska(formatAuthError(r.error))
      setLoading(false)
      return
    }

    const signInAgain = await authPasswordViaApi('signin', email, forma.lozinka, {
      auth_context: 'customer',
    })
    if (signInAgain.error) {
      setGreska(
        formatAuthError(signInAgain.error) +
          ' Ako je potrebna potvrda emaila, potvrdi pa se prijavi na „Prijava kupca”.',
      )
      setLoading(false)
      return
    }

    const session = await waitForClientSession()
    if (!session) {
      setGreska('Registracija nije završila sesiju u pregledniku. Pokušaj ponovo ili potvrdi email.')
      setLoading(false)
      return
    }

    const { data: userData } = await supabase.auth.getUser()
    const u = userData.user
    if (!u?.id) {
      setGreska('Korisnik nije dostupan nakon registracije. Pokušaj ponovo.')
      setLoading(false)
      return
    }

    // Javna tabela kupac_nalozi — svi signup podaci kupca (pored auth.users).
    const { error: kupacTabErr } = await supabase.from('kupac_nalozi').upsert(
      {
        auth_user_id: u.id,
        email,
        ime,
        telefon,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'auth_user_id' },
    )
    if (kupacTabErr) {
      setGreska(
        kupacTabErr.message.includes('relation') || kupacTabErr.message.includes('does not exist')
          ? 'U Supabase pokreni migraciju za tabelu kupac_nalozi (db/migrations/2026-04-18_kupac_nalozi.sql).'
          : kupacTabErr.message,
      )
      setLoading(false)
      return
    }

    const slug = parseSalonSlugFromPath(nextPath)
    if (slug) {
      const { data: salonRow, error: salonErr } = await supabase.from('saloni').select('id').eq('slug', slug).maybeSingle()
      if (!salonErr && salonRow?.id) {
        const link = await linkKupacNaSalon({
          salonId: salonRow.id,
          ime,
          telefon,
          email,
        })
        if (!link.ok) {
          setGreska(link.error || 'Kupac je snimljen, ali povezivanje s salonom nije uspjelo.')
          setLoading(false)
          return
        }
      }
    }

    if (u && getAppRole(u) !== 'salon_owner') {
      await supabase.auth.updateUser({ data: { [APP_ROLE_KEY]: 'customer' } })
    }

    router.replace(nextPath)
    router.refresh()
  }

  return (
    <div
      className="kupac-auth-card"
      style={{
        width: '100%',
        maxWidth: 440,
        background: '#111',
        border: '0.5px solid rgba(212,175,55,.2)',
        borderRadius: 24,
        padding: 40,
        animation: 'fadeUp .6s ease',
      }}
    >
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <div
          style={{
            width: 56,
            height: 56,
            background: 'linear-gradient(135deg,#d4af37,#b8960c)',
            borderRadius: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 24,
            margin: '0 auto 16px',
          }}
        >
          ✨
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 500, color: '#f5f0e8', marginBottom: 8 }}>Registracija kupca</h1>
        <p style={{ fontSize: 14, color: 'rgba(245,240,232,.45)' }}>Nalog za zakazivanje i praćenje termina</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 24 }}>
        <div>
          <label style={{ fontSize: 12, color: 'rgba(245,240,232,.4)', display: 'block', marginBottom: 6 }}>IME I PREZIME</label>
          <input
            placeholder="Ana Marković"
            value={forma.ime}
            onChange={(e) => setForma({ ...forma, ime: e.target.value })}
            style={inputStyle}
          />
        </div>
        <div>
          <label style={{ fontSize: 12, color: 'rgba(245,240,232,.4)', display: 'block', marginBottom: 6 }}>TELEFON</label>
          <input
            type="tel"
            placeholder="+381 60 000 000"
            value={forma.telefon}
            onChange={(e) => setForma({ ...forma, telefon: e.target.value })}
            style={inputStyle}
          />
        </div>
        <div>
          <label style={{ fontSize: 12, color: 'rgba(245,240,232,.4)', display: 'block', marginBottom: 6 }}>EMAIL</label>
          <input
            type="email"
            autoComplete="email"
            placeholder="vas@email.com"
            value={forma.email}
            onChange={(e) => setForma({ ...forma, email: e.target.value })}
            style={inputStyle}
          />
        </div>
        <div>
          <label style={{ fontSize: 12, color: 'rgba(245,240,232,.4)', display: 'block', marginBottom: 6 }}>LOZINKA</label>
          <input
            type="password"
            autoComplete="new-password"
            placeholder="min. 6 znakova"
            value={forma.lozinka}
            onChange={(e) => setForma({ ...forma, lozinka: e.target.value })}
            style={inputStyle}
          />
        </div>
      </div>

      {greska && (
        <div
          style={{
            background: 'rgba(220,50,50,.1)',
            border: '0.5px solid rgba(220,50,50,.3)',
            borderRadius: 10,
            padding: '12px 16px',
            marginBottom: 16,
            fontSize: 13,
            color: '#ff6b6b',
          }}
        >
          ⚠️ {greska}
        </div>
      )}

      <button
        type="button"
        disabled={loading}
        onClick={() => void handleSubmit()}
        style={{
          width: '100%',
          padding: 16,
          borderRadius: 16,
          background: 'linear-gradient(135deg,#d4af37,#b8960c)',
          color: '#0a0a0a',
          fontSize: 16,
          fontWeight: 600,
          border: 'none',
          cursor: loading ? 'not-allowed' : 'pointer',
          opacity: loading ? 0.65 : 1,
          fontFamily: 'sans-serif',
        }}
      >
        {loading ? 'Registracija…' : 'Kreiraj kupčki nalog'}
      </button>

      <p style={{ marginTop: 20, fontSize: 13, color: 'rgba(245,240,232,.4)', textAlign: 'center' }}>
        Već imate nalog?{' '}
        <Link href={`/kupac/prijava?next=${encodeURIComponent(nextPath)}`} style={{ color: '#d4af37' }}>
          Prijavite se
        </Link>
      </p>
    </div>
  )
}

const inputStyle: CSSProperties = {
  width: '100%',
  fontSize: 15,
  background: '#1a1a1a',
  border: '0.5px solid rgba(212,175,55,.2)',
  color: '#f5f0e8',
  padding: '14px 16px',
  borderRadius: 12,
  outline: 'none',
  fontFamily: 'sans-serif',
}

export default function KupacRegistracijaPage() {
  return (
    <main
      style={{
        background: '#0a0a0a',
        minHeight: '100vh',
        color: '#f5f0e8',
        fontFamily: 'sans-serif',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <style>{`
        @keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
        @media(max-width:768px){.kupac-auth-card{padding:28px 20px!important}}
      `}</style>

      <nav
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '18px 48px',
          borderBottom: '0.5px solid rgba(212,175,55,.2)',
          background: 'rgba(10,10,10,.97)',
        }}
      >
        <Link href="/" style={{ fontSize: 20, fontWeight: 600, color: '#d4af37', textDecoration: 'none' }}>
          SalonPro
        </Link>
        <span style={{ fontSize: 12, color: 'rgba(245,240,232,.35)' }}>Kupac</span>
      </nav>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px' }}>
        <Suspense fallback={<div style={{ color: 'rgba(245,240,232,.5)', fontSize: 14 }}>Učitavanje…</div>}>
          <KupacRegistracijaForm />
        </Suspense>
      </div>
    </main>
  )
}
