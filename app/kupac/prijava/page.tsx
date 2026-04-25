'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { authPasswordViaApi } from '@/lib/auth-via-api'
import { getSafeNextPath } from '@/lib/safe-next-path'
import { formatAuthError } from '@/lib/format-auth-error'
import { waitForClientSession } from '@/lib/wait-client-session'

function KupacPrijavaForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const nextPath = getSafeNextPath(searchParams.get('next'))

  const [loading, setLoading] = useState(false)
  const [greska, setGreska] = useState('')
  const [forma, setForma] = useState({ email: '', lozinka: '' })

  const handleLogin = async () => {
    if (!forma.email.trim() || !forma.lozinka) {
      setGreska('Unesite email i lozinku.')
      return
    }
    setLoading(true)
    setGreska('')
    const r = await authPasswordViaApi('signin', forma.email.trim(), forma.lozinka, {
      auth_context: 'customer',
    })
    if (r.error) {
      setGreska(formatAuthError(r.error))
      setLoading(false)
      return
    }
    const session = await waitForClientSession()
    if (!session) {
      setGreska('Prijava nije završila sesiju. Pokušaj ponovo ili potvrdi email.')
      setLoading(false)
      return
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
          👤
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 500, color: '#f5f0e8', marginBottom: 8 }}>Prijava kao kupac</h1>
        <p style={{ fontSize: 14, color: 'rgba(245,240,232,.45)' }}>Za zakazivanje i profil kod salona</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 24 }}>
        <div>
          <label style={{ fontSize: 12, color: 'rgba(245,240,232,.4)', display: 'block', marginBottom: 6 }}>EMAIL</label>
          <input
            name="email"
            type="email"
            autoComplete="email"
            placeholder="vas@email.com"
            value={forma.email}
            onChange={(e) => setForma({ ...forma, email: e.target.value })}
            style={{
              width: '100%',
              fontSize: 15,
              background: '#1a1a1a',
              border: '0.5px solid rgba(212,175,55,.2)',
              color: '#f5f0e8',
              padding: '14px 16px',
              borderRadius: 12,
              outline: 'none',
              fontFamily: 'sans-serif',
            }}
          />
        </div>
        <div>
          <label style={{ fontSize: 12, color: 'rgba(245,240,232,.4)', display: 'block', marginBottom: 6 }}>LOZINKA</label>
          <input
            name="lozinka"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            value={forma.lozinka}
            onChange={(e) => setForma({ ...forma, lozinka: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && void handleLogin()}
            style={{
              width: '100%',
              fontSize: 15,
              background: '#1a1a1a',
              border: '0.5px solid rgba(212,175,55,.2)',
              color: '#f5f0e8',
              padding: '14px 16px',
              borderRadius: 12,
              outline: 'none',
              fontFamily: 'sans-serif',
            }}
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
        onClick={() => void handleLogin()}
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
        {loading ? 'Prijava…' : 'Prijavi se'}
      </button>

      <p style={{ marginTop: 20, fontSize: 13, color: 'rgba(245,240,232,.4)', textAlign: 'center' }}>
        Nemate nalog?{' '}
        <Link href={`/kupac/registracija?next=${encodeURIComponent(nextPath)}`} style={{ color: '#d4af37' }}>
          Registrujte se kao kupac
        </Link>
      </p>
    </div>
  )
}

export default function KupacPrijavaPage() {
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
        <Suspense
          fallback={
            <div style={{ color: 'rgba(245,240,232,.5)', fontSize: 14 }}>Učitavanje…</div>
          }
        >
          <KupacPrijavaForm />
        </Suspense>
      </div>
    </main>
  )
}
