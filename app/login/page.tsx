'use client'
import { useState } from 'react'
import Link from 'next/link'
import { authPasswordViaApi } from '@/lib/auth-via-api'
import { formatAuthError } from '@/lib/format-auth-error'
import { waitForClientSession } from '@/lib/wait-client-session'

export default function Login() {
  const [loading, setLoading] = useState(false)
  const [greska, setGreska] = useState('')
  const [forma, setForma] = useState({ email: '', lozinka: '' })

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForma({ ...forma, [e.target.name]: e.target.value })
    setGreska('')
  }

  const handleLogin = async () => {
    if (!forma.email || !forma.lozinka) { setGreska('Molimo unesite email i lozinku.'); return }
    setLoading(true)
    const r = await authPasswordViaApi('signin', forma.email.trim(), forma.lozinka)
    if (r.error) {
      setGreska(formatAuthError(r.error, 'salon-login'))
      setLoading(false)
      return
    }
    const session = await waitForClientSession()
    if (!session) {
      setGreska('Prijava nije završila sesiju. Pokušaj ponovo ili potvrdi email u Supabase podešavanjima.')
      setLoading(false)
      return
    }
    window.location.href = '/dashboard'
  }

  return (
    <main style={{ background: '#0a0a0a', minHeight: '100vh', color: '#f5f0e8', fontFamily: 'sans-serif', display: 'flex', flexDirection: 'column' }}>
      <style>{`
        @keyframes shimmer{0%{background-position:-200% center}100%{background-position:200% center}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes pulse{0%,100%{box-shadow:0 0 0 0 rgba(212,175,55,.4)}50%{box-shadow:0 0 0 8px rgba(212,175,55,0)}}
        *{box-sizing:border-box;margin:0;padding:0}
        input{outline:none;width:100%;font-size:15px;background:#1a1a1a;border:0.5px solid rgba(212,175,55,.2);color:#f5f0e8;padding:14px 16px;border-radius:12px;transition:border-color .3s;font-family:sans-serif}
        input::placeholder{color:rgba(245,240,232,.3)}
        input:focus{border-color:rgba(212,175,55,.6)}
        .login-btn{width:100%;padding:16px;border-radius:16px;background:linear-gradient(135deg,#d4af37,#b8960c);color:#0a0a0a;font-size:16px;font-weight:600;cursor:pointer;border:none;font-family:sans-serif;animation:pulse 2.5s ease infinite;transition:opacity .3s}
        .login-btn:disabled{opacity:.6;cursor:not-allowed;animation:none}
        @media(max-width:768px){.login-card{padding:28px 20px!important}}
      `}</style>

      <nav style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 48px', borderBottom: '0.5px solid rgba(212,175,55,.2)', background: 'rgba(10,10,10,.97)', position: 'sticky', top: 0, zIndex: 100 }}>
        <Link href="/" style={{ fontSize: '22px', fontWeight: 500, background: 'linear-gradient(90deg,#d4af37,#f5e17a,#d4af37)', backgroundSize: '200% auto', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', animation: 'shimmer 3s linear infinite', textDecoration: 'none' }}>SalonPro</Link>
        <Link href="/registracija" style={{ fontSize: '14px', color: 'rgba(245,240,232,.5)', textDecoration: 'none' }}>Nemate nalog? <span style={{ color: '#d4af37' }}>Registrujte se →</span></Link>
      </nav>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px' }}>
        <div className="login-card" style={{ width: '100%', maxWidth: '440px', background: '#111', border: '0.5px solid rgba(212,175,55,.2)', borderRadius: '24px', padding: '40px', animation: 'fadeUp .6s ease' }}>
          <div style={{ textAlign: 'center', marginBottom: '32px' }}>
            <div style={{ width: '56px', height: '56px', background: 'linear-gradient(135deg,#d4af37,#b8960c)', borderRadius: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', margin: '0 auto 16px' }}>✂️</div>
            <h1 style={{ fontSize: '26px', fontWeight: 500, color: '#f5f0e8', marginBottom: '8px' }}>Dobrodošli nazad</h1>
            <p style={{ fontSize: '14px', color: 'rgba(245,240,232,.4)' }}>Prijavite se u vaš salon</p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '24px' }}>
            <div>
              <label style={{ fontSize: '12px', color: 'rgba(245,240,232,.4)', display: 'block', marginBottom: '6px', letterSpacing: '.3px' }}>EMAIL ADRESA</label>
              <input name="email" type="email" placeholder="salon@email.com" value={forma.email} onChange={handleChange} />
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <label style={{ fontSize: '12px', color: 'rgba(245,240,232,.4)', letterSpacing: '.3px' }}>LOZINKA</label>
                <Link href="/zaboravljena-lozinka" style={{ fontSize: '12px', color: 'rgba(212,175,55,.6)', textDecoration: 'none' }}>Zaboravili ste?</Link>
              </div>
              <input name="lozinka" type="password" placeholder="Vaša lozinka" value={forma.lozinka} onChange={handleChange}
                onKeyDown={e => e.key === 'Enter' && handleLogin()} />
            </div>
          </div>

          {greska && (
            <div style={{ background: 'rgba(220,50,50,.1)', border: '0.5px solid rgba(220,50,50,.3)', borderRadius: '10px', padding: '12px 16px', marginBottom: '16px', fontSize: '13px', color: '#ff6b6b' }}>
              ⚠️ {greska}
            </div>
          )}

          <button className="login-btn" disabled={loading} onClick={handleLogin}>
            {loading
              ? <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
                <span style={{ width: '16px', height: '16px', border: '2px solid rgba(10,10,10,.3)', borderTop: '2px solid #0a0a0a', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.8s linear infinite' }} />
                Prijava u toku...
              </span>
              : 'Prijavi se →'}
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: '24px 0' }}>
            <div style={{ flex: 1, height: '0.5px', background: 'rgba(255,255,255,.08)' }} />
            <span style={{ fontSize: '12px', color: 'rgba(245,240,232,.25)' }}>ili</span>
            <div style={{ flex: 1, height: '0.5px', background: 'rgba(255,255,255,.08)' }} />
          </div>

          <Link href="/registracija" style={{ display: 'block', width: '100%', padding: '14px', borderRadius: '16px', border: '0.5px solid rgba(212,175,55,.2)', color: 'rgba(245,240,232,.6)', fontSize: '14px', textDecoration: 'none', textAlign: 'center' }}>
            Kreiraj novi salon →
          </Link>
        </div>
      </div>

      <footer style={{ textAlign: 'center', padding: '20px', borderTop: '0.5px solid rgba(212,175,55,.1)', color: 'rgba(245,240,232,.25)', fontSize: '12px' }}>
        © 2025 SalonPro
      </footer>
    </main>
  )
}