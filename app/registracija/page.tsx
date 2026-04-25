'use client'
import { useState } from 'react'
import Link from 'next/link'
import { authPasswordViaApi } from '@/lib/auth-via-api'
import { isSupabaseConfigured, supabase } from '@/lib/supabase'
import { formatAuthError } from '@/lib/format-auth-error'
import { buildSalonSlug, fallbackSalonSlug } from '@/lib/slug'

const tipovi = ['Frizerski salon', 'Kozmetički salon', 'Salon za nokte', 'Spa / Wellness', 'Barbershop', 'Drugo']

export default function Registracija() {
  const [korak, setKorak] = useState(1)
  const [loading, setLoading] = useState(false)
  const [greska, setGreska] = useState('')
  const [forma, setForma] = useState({ naziv: '', email: '', lozinka: '', telefon: '', grad: '', tip: '' })

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForma({ ...forma, [e.target.name]: e.target.value })
    setGreska('')
  }

  const handleSubmit = async () => {
    setLoading(true)
    setGreska('')
    try {
      const email = forma.email.trim()
      const r = await authPasswordViaApi('signup', email, forma.lozinka, { app_role: 'salon_owner' })
      if (r.error) {
        setGreska(formatAuthError(r.error, 'salon-register'))
        setLoading(false)
        return
      }
      if (!r.userId) {
        setGreska('Registracija nije vratila korisnika. Pokušaj ponovo.')
        setLoading(false)
        return
      }

      // Ne oslanjati se na getSession() odmah poslije setSession — često je null iako server ima sesiju.
      if (!r.serverReturnedSession) {
        const res2 = await fetch('/api/salon/register-initial', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: r.userId,
            naziv: forma.naziv,
            email,
            telefon: forma.telefon,
            grad: forma.grad,
            tip: forma.tip,
          }),
        })
        const j2 = (await res2.json()) as { error?: string }
        if (!res2.ok) {
          setGreska(
            formatAuthError(
              j2.error ||
                'Kreiranje salona nije uspjelo. Isključi obaveznu potvrdu emaila u Supabase (Authentication) ili dodaj SUPABASE_SERVICE_ROLE_KEY na Vercel.',
              'salon-register',
            ),
          )
          setLoading(false)
          return
        }
        setKorak(3)
        setLoading(false)
        return
      }

      // Server je vratio tokene — kratko čekaj da lokalna sesija bude spremna.
      let sessionReady = false
      for (let i = 0; i < 8; i++) {
        const { data: s } = await supabase.auth.getSession()
        if (s.session) {
          sessionReady = true
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 80))
      }
      if (!sessionReady) {
        setGreska(
          'Sesija nije sačuvana u pregledniku (kolačići / privatni mod). Dozvoli storage za ovaj sajt ili probaj drugi preglednik.',
        )
        setLoading(false)
        return
      }

      const baseSlug = fallbackSalonSlug(buildSalonSlug(forma.naziv))
      let slug = baseSlug
      let suffix = 2

      while (true) {
        const { data: existingSlug, error: slugCheckError } = await supabase
          .from('saloni')
          .select('id')
          .eq('slug', slug)
          .maybeSingle()

        if (slugCheckError) {
          setGreska(formatAuthError(slugCheckError.message, 'salon-register'))
          setLoading(false)
          return
        }
        if (!existingSlug) break

        slug = `${baseSlug}-${suffix}`
        suffix += 1
      }

      const { error: salonError } = await supabase.from('saloni').insert({
        id: r.userId,
        naziv: forma.naziv,
        slug: slug,
        email,
        telefon: forma.telefon,
        grad: forma.grad,
        tip: forma.tip,
        aktivan: true,
      })
      if (salonError) {
        let msg = formatAuthError(salonError.message, 'salon-register')
        if (/row-level security|rls|permission denied|policy|42501/i.test(salonError.message)) {
          msg =
            'Baza je odbila kreiranje salona (prava pristupa). U Supabase Authentication isključi "Confirm email" za test ili prilagodi RLS za tabelu saloni.'
        }
        setGreska(msg)
        setLoading(false)
        return
      }

      setKorak(3)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Nepoznata greška'
      setGreska(formatAuthError(msg, 'salon-register'))
    }
    setLoading(false)
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
        .tip-btn{cursor:pointer;padding:12px 16px;border-radius:12px;border:0.5px solid rgba(212,175,55,.2);background:#1a1a1a;color:rgba(245,240,232,.6);font-size:13px;transition:all .3s;text-align:center}
        .tip-btn:hover{border-color:rgba(212,175,55,.5);color:#f5f0e8}
        .tip-active{border-color:#d4af37!important;background:rgba(212,175,55,.1)!important;color:#d4af37!important}
        .submit-btn{width:100%;padding:16px;border-radius:16px;background:linear-gradient(135deg,#d4af37,#b8960c);color:#0a0a0a;font-size:16px;font-weight:600;cursor:pointer;border:none;font-family:sans-serif;transition:opacity .3s}
        .submit-btn:disabled{opacity:.6;cursor:not-allowed}
        .back-btn{background:none;border:0.5px solid rgba(245,240,232,.15);color:rgba(245,240,232,.5);padding:14px;border-radius:16px;cursor:pointer;font-size:14px;font-family:sans-serif;width:100%}
        @media(max-width:768px){.reg-card{padding:28px 20px!important;margin:16px!important}}
      `}</style>

      <nav style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 48px', borderBottom: '0.5px solid rgba(212,175,55,.2)', background: 'rgba(10,10,10,.97)', position: 'sticky', top: 0, zIndex: 100 }}>
        <Link href="/" style={{ fontSize: '22px', fontWeight: 500, background: 'linear-gradient(90deg,#d4af37,#f5e17a,#d4af37)', backgroundSize: '200% auto', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', animation: 'shimmer 3s linear infinite', textDecoration: 'none' }}>SalonPro</Link>
        <Link href="/login" style={{ fontSize: '14px', color: 'rgba(245,240,232,.5)', textDecoration: 'none' }}>Već imam nalog <span style={{ color: '#d4af37' }}>→</span></Link>
      </nav>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px' }}>
        <div className="reg-card" style={{ width: '100%', maxWidth: '480px', background: '#111', border: '0.5px solid rgba(212,175,55,.2)', borderRadius: '24px', padding: '40px', animation: 'fadeUp .6s ease' }}>

          {korak < 3 && (
            <div style={{ marginBottom: '32px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {[1, 2].map(k => (
                  <div key={k} style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                    <div style={{ width: '28px', height: '28px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 600, flexShrink: 0, background: korak >= k ? 'linear-gradient(135deg,#d4af37,#b8960c)' : 'rgba(212,175,55,.1)', color: korak >= k ? '#0a0a0a' : 'rgba(212,175,55,.4)', transition: 'all .3s' }}>
                      {korak > k ? '✓' : k}
                    </div>
                    <span style={{ fontSize: '12px', color: korak >= k ? 'rgba(245,240,232,.6)' : 'rgba(245,240,232,.25)' }}>{k === 1 ? 'Tip salona' : 'Detalji'}</span>
                    {k < 2 && <div style={{ flex: 1, height: '1px', background: korak > k ? 'rgba(212,175,55,.4)' : 'rgba(255,255,255,.08)' }} />}
                  </div>
                ))}
              </div>
            </div>
          )}

          {korak === 1 && (
            <div style={{ animation: 'fadeUp .4s ease' }}>
              <div style={{ marginBottom: '28px' }}>
                <div style={{ fontSize: '12px', color: '#d4af37', letterSpacing: '.5px', marginBottom: '8px' }}>KORAK 1 OD 2</div>
                <h1 style={{ fontSize: '26px', fontWeight: 500, color: '#f5f0e8', marginBottom: '8px' }}>Koji tip salona vodiš?</h1>
                <p style={{ fontSize: '14px', color: 'rgba(245,240,232,.4)', lineHeight: 1.6 }}>Odaberi kategoriju koja najbolje opisuje tvoj salon.</p>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '28px' }}>
                {tipovi.map(t => (
                  <div key={t} className={`tip-btn${forma.tip === t ? ' tip-active' : ''}`} onClick={() => setForma({ ...forma, tip: t })}>{t}</div>
                ))}
              </div>
              <button className="submit-btn" disabled={!forma.tip} onClick={() => setKorak(2)}>Nastavi →</button>
            </div>
          )}

          {korak === 2 && (
            <div style={{ animation: 'fadeUp .4s ease' }}>
              <div style={{ marginBottom: '28px' }}>
                <div style={{ fontSize: '12px', color: '#d4af37', letterSpacing: '.5px', marginBottom: '8px' }}>KORAK 2 OD 2</div>
                <h1 style={{ fontSize: '26px', fontWeight: 500, color: '#f5f0e8', marginBottom: '8px' }}>Kreiraj tvoj salon</h1>
                <p style={{ fontSize: '14px', color: 'rgba(245,240,232,.4)', lineHeight: 1.6 }}>Ovi podaci će biti prikazani na tvojoj landing page.</p>
              </div>
              {!isSupabaseConfigured() && (
                <div style={{ background: 'rgba(212,175,55,.08)', border: '0.5px solid rgba(212,175,55,.35)', borderRadius: '12px', padding: '14px 16px', marginBottom: '20px', fontSize: '13px', color: 'rgba(245,240,232,.85)', lineHeight: 1.6 }}>
                  Aplikacija na ovom okruženju nema Supabase adresu u buildu. U Vercel dodaj <code style={{ color: '#d4af37' }}>NEXT_PUBLIC_SUPABASE_URL</code> i <code style={{ color: '#d4af37' }}>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>, pa ponovo deploy.
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '28px' }}>
                {[
                  { label: 'NAZIV SALONA', name: 'naziv', type: 'text', placeholder: 'npr. Salon Elegance' },
                  { label: 'EMAIL ADRESA', name: 'email', type: 'email', placeholder: 'salon@email.com' },
                  { label: 'LOZINKA', name: 'lozinka', type: 'password', placeholder: 'Minimalno 6 karaktera' },
                ].map(f => (
                  <div key={f.name}>
                    <label style={{ fontSize: '12px', color: 'rgba(245,240,232,.4)', display: 'block', marginBottom: '6px', letterSpacing: '.3px' }}>{f.label}</label>
                    <input name={f.name} type={f.type} placeholder={f.placeholder} value={(forma as any)[f.name]} onChange={handleChange} />
                  </div>
                ))}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div>
                    <label style={{ fontSize: '12px', color: 'rgba(245,240,232,.4)', display: 'block', marginBottom: '6px', letterSpacing: '.3px' }}>TELEFON</label>
                    <input name="telefon" placeholder="+381 60 000 000" value={forma.telefon} onChange={handleChange} />
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', color: 'rgba(245,240,232,.4)', display: 'block', marginBottom: '6px', letterSpacing: '.3px' }}>GRAD</label>
                    <input name="grad" placeholder="Beograd" value={forma.grad} onChange={handleChange} />
                  </div>
                </div>
              </div>

              {greska && (
                <div style={{ background: 'rgba(220,50,50,.1)', border: '0.5px solid rgba(220,50,50,.3)', borderRadius: '10px', padding: '12px 16px', marginBottom: '16px', fontSize: '13px', color: '#ff6b6b' }}>
                  ⚠️ {greska}
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <button className="submit-btn" disabled={!forma.naziv || !forma.email || !forma.lozinka || loading} onClick={handleSubmit}>
                  {loading
                    ? <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
                      <span style={{ width: '16px', height: '16px', border: '2px solid rgba(10,10,10,.3)', borderTop: '2px solid #0a0a0a', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.8s linear infinite' }} />
                      Kreiramo tvoj salon...
                    </span>
                    : 'Kreiraj salon besplatno →'}
                </button>
                <button className="back-btn" onClick={() => setKorak(1)}>← Nazad</button>
              </div>
            </div>
          )}

          {korak === 3 && (
            <div style={{ animation: 'fadeUp .4s ease', textAlign: 'center' }}>
              <div style={{ width: '72px', height: '72px', background: 'linear-gradient(135deg,#d4af37,#b8960c)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '32px', margin: '0 auto 24px' }}>✓</div>
              <h1 style={{ fontSize: '26px', fontWeight: 500, color: '#f5f0e8', marginBottom: '12px' }}>Salon je kreiran!</h1>
              <p style={{ fontSize: '14px', color: 'rgba(245,240,232,.45)', lineHeight: 1.7, marginBottom: '8px' }}>
                Dobrodošao, <span style={{ color: '#d4af37', fontWeight: 500 }}>{forma.naziv}</span>!
              </p>
              <p style={{ fontSize: '14px', color: 'rgba(245,240,232,.45)', lineHeight: 1.7, marginBottom: '32px' }}>
                Provjeri email i potvrdi registraciju, zatim se prijavi.
              </p>
              <div style={{ background: 'rgba(212,175,55,.08)', border: '0.5px solid rgba(212,175,55,.2)', borderRadius: '12px', padding: '16px', marginBottom: '28px' }}>
                <div style={{ fontSize: '12px', color: 'rgba(245,240,232,.4)', marginBottom: '6px' }}>TVOJA LANDING PAGE</div>
                <div style={{ fontSize: '15px', color: '#d4af37', fontWeight: 500 }}>
                  salonpro.com/salon/{fallbackSalonSlug(buildSalonSlug(forma.naziv))}
                </div>
              </div>
              <Link href="/login" style={{ display: 'block', width: '100%', padding: '16px', borderRadius: '16px', background: 'linear-gradient(135deg,#d4af37,#b8960c)', color: '#0a0a0a', fontSize: '16px', fontWeight: 600, textDecoration: 'none', textAlign: 'center' }}>
                Prijavi se →
              </Link>
            </div>
          )}
        </div>
      </div>

      <footer style={{ textAlign: 'center', padding: '20px', borderTop: '0.5px solid rgba(212,175,55,.1)', color: 'rgba(245,240,232,.25)', fontSize: '12px' }}>
        © 2025 SalonPro
      </footer>
    </main>
  )
}