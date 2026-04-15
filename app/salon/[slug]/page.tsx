'use client'
import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'

interface Usluga {
  id: string
  naziv: string
  cijena: number
  trajanje: number
  opis?: string
}

interface Salon {
  id: string
  naziv: string
  slug: string
  email: string
  telefon?: string
  adresa?: string
  grad?: string
  opis?: string
  logo_url?: string
  boja_primarna?: string
  tip?: string
  radno_od?: string
  radno_do?: string
}

interface Lojalnost {
  aktivan: boolean
  tip: string
  svaki_koji: number
  vrijednost: number
}

interface BookingNotification {
  salon_id: string
  ime: string
  telefon: string
  datum_vrijeme: string
  status: string
}

type ClientAuthMode = 'login' | 'signup'
type PageView = 'booking' | 'profile'

interface ClientSummary {
  client: {
    ime: string
    telefon: string
    email?: string
  }
  stats: {
    ukupnoTermina: number
    potvrdjeni: number
    cekaju: number
  }
  loyalty: {
    visits_count: number
    progress_percent: number
    reward_ready: boolean
  }
  appointments: Array<{
    id: string
    datum_vrijeme: string
    status: string
  }>
}

export default function SalonLanding() {
  const params = useParams<{ slug: string }>()
  const slug = typeof params?.slug === 'string' ? params.slug : ''
  const [salon, setSalon] = useState<Salon | null>(null)
  const [usluge, setUsluge] = useState<Usluga[]>([])
  const [lojalnost, setLojalnost] = useState<Lojalnost | null>(null)
  const [pageLoading, setPageLoading] = useState(true)
  const [showForma, setShowForma] = useState(false)
  const [odabranaUsluga, setOdabranaUsluga] = useState<Usluga | null>(null)
  const [loading, setLoading] = useState(false)
  const [uspjeh, setUspjeh] = useState(false)
  const [greska, setGreska] = useState('')
  const [statusLoading, setStatusLoading] = useState(false)
  const [bookingNotif, setBookingNotif] = useState<BookingNotification | null>(null)
  const [clientAuthMode, setClientAuthMode] = useState<ClientAuthMode>('signup')
  const [clientAuthLoading, setClientAuthLoading] = useState(false)
  const [clientAuthError, setClientAuthError] = useState('')
  const [clientAuthSuccess, setClientAuthSuccess] = useState('')
  const [klijentUlogovan, setKlijentUlogovan] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [activeView, setActiveView] = useState<PageView>('booking')
  const [clientSummary, setClientSummary] = useState<ClientSummary | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [clientForma, setClientForma] = useState({ ime: '', telefon: '', email: '', lozinka: '' })
  const [forma, setForma] = useState({ ime: '', telefon: '', datum: '', vrijeme: '', napomena: '' })

  // Učitaj podatke pri učitavanju stranice
  useEffect(() => {
    if (!slug) {
      setPageLoading(false)
      return
    }

    const fetchSalon = async () => {
      try {
        const { data: salonData, error: salonError } = await supabase
          .from('saloni')
          .select('*')
          .eq('slug', slug)
          .single()

        if (salonError || !salonData) {
          setSalon(null)
          setPageLoading(false)
          return
        }

        setSalon(salonData)

        // Učitaj usluge
        const { data: uslugeData } = await supabase
          .from('usluge')
          .select('*')
          .eq('salon_id', salonData.id)

        setUsluge(uslugeData || [])

        // Učitaj lojalnost
        const { data: lojalnostData } = await supabase
          .from('lojalnost')
          .select('*')
          .eq('salon_id', salonData.id)
          .single()

        setLojalnost(lojalnostData || null)
      } catch (err) {
        console.error('Greška pri učitavanju:', err)
      } finally {
        setPageLoading(false)
      }
    }

    fetchSalon()
  }, [slug])

  useEffect(() => {
    const provjeriKlijentSesiju = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      setKlijentUlogovan(Boolean(user))
    }
    void provjeriKlijentSesiju()
  }, [])

  const ucitajClientSummary = useCallback(async () => {
    if (!salon?.id) return
    setSummaryLoading(true)
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      if (!token) {
        setClientSummary(null)
        return
      }

      const params = new URLSearchParams({ auth_token: token, salon_id: salon.id })
      const res = await fetch(`/api/clients/me?${params.toString()}`)
      const data = await res.json()
      if (data.error) {
        setClientSummary(null)
        return
      }
      setClientSummary(data as ClientSummary)
    } finally {
      setSummaryLoading(false)
    }
  }, [salon?.id])

  useEffect(() => {
    if (!klijentUlogovan || !salon?.id) return
    void ucitajClientSummary()
  }, [klijentUlogovan, salon?.id, ucitajClientSummary])

  useEffect(() => {
    if (!slug || typeof window === 'undefined') return
    const saved = window.localStorage.getItem(`booking:${slug}`)
    if (!saved) return

    try {
      const parsed = JSON.parse(saved) as BookingNotification
      if (parsed?.datum_vrijeme) setBookingNotif(parsed)
    } catch {
      // Ignore invalid localStorage data.
    }
  }, [slug])

  const sacuvajBookingNotif = useCallback((next: BookingNotification | null) => {
    if (!slug || typeof window === 'undefined') return
    if (!next) {
      window.localStorage.removeItem(`booking:${slug}`)
      return
    }
    window.localStorage.setItem(`booking:${slug}`, JSON.stringify(next))
  }, [slug])

  const provjeriStatusTermina = useCallback(async () => {
    if (!bookingNotif) return
    setStatusLoading(true)
    try {
      const params = new URLSearchParams({
        status_check: '1',
        salon_id: bookingNotif.salon_id,
        ime: bookingNotif.ime,
        telefon: bookingNotif.telefon,
        datum_vrijeme: bookingNotif.datum_vrijeme,
      })
      const res = await fetch(`/api/termini?${params.toString()}`)
      const data = await res.json()
      if (data.error) {
        setGreska(data.error)
        return
      }
      if (data.status) {
        const nextNotif = { ...bookingNotif, status: data.status as string }
        setBookingNotif(nextNotif)
        sacuvajBookingNotif(nextNotif)
      }
    } catch {
      setGreska('Ne možemo provjeriti status trenutno. Pokušajte ponovo.')
    } finally {
      setStatusLoading(false)
    }
  }, [bookingNotif, sacuvajBookingNotif])

  useEffect(() => {
    if (!bookingNotif || bookingNotif.status === 'potvrđen') return

    const intervalId = window.setInterval(() => {
      void provjeriStatusTermina()
    }, 15000)

    return () => window.clearInterval(intervalId)
  }, [bookingNotif, provjeriStatusTermina])

  if (pageLoading) return (
    <div style={{ background: '#0a0a0a', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'sans-serif' }}>
      <div style={{ textAlign: 'center', color: '#f5f0e8' }}>
        <div style={{ fontSize: '32px', animation: 'spin 1s linear infinite', marginBottom: '16px' }}>⏳</div>
        <p>Učitavanje...</p>
      </div>
    </div>
  )

  if (!salon) return (
    <div style={{ background: '#0a0a0a', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'sans-serif' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>✂️</div>
        <h1 style={{ color: '#f5f0e8', fontSize: '24px', fontWeight: 500, marginBottom: '8px' }}>Salon nije pronađen</h1>
        <p style={{ color: 'rgba(245,240,232,.4)', fontSize: '14px' }}>Provjerite link i pokušajte ponovo.</p>
      </div>
    </div>
  )

  const gold = salon.boja_primarna || '#d4af37'
  const goldFaint = 'rgba(212,175,55,.12)'
  const goldBorder = 'rgba(212,175,55,.25)'

  const mapsUrl = salon.adresa && salon.grad
    ? `https://www.google.com/maps/embed/v1/place?key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}&q=${encodeURIComponent(salon.adresa + ' ' + salon.grad)}`
    : ''
  const statusLabel = bookingNotif?.status === 'potvrđen' ? 'Termin je potvrđen' : 'Termin čeka potvrdu'

  const handleZakazivanje = async () => {
    if (!forma.ime || !forma.telefon || !forma.datum || !forma.vrijeme) {
      setGreska('Molimo popunite sva obavezna polja.')
      return
    }
    setLoading(true)
    setGreska('')
    try {
      const datumVrijeme = `${forma.datum}T${forma.vrijeme}:00`
      const res = await fetch('/api/termini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salon_id: salon.id,
          usluga_id: odabranaUsluga?.id || null,
          ime_klijenta: forma.ime,
          telefon_klijenta: forma.telefon,
          datum_vrijeme: datumVrijeme,
          napomena: forma.napomena
        })
      })
      const data = await res.json()
      if (data.error) { setGreska(data.error); setLoading(false); return }
      const nextNotif: BookingNotification = {
        salon_id: salon.id,
        ime: forma.ime,
        telefon: forma.telefon,
        datum_vrijeme: datumVrijeme,
        status: 'ceka',
      }
      setBookingNotif(nextNotif)
      sacuvajBookingNotif(nextNotif)
      setUspjeh(true)
      setShowForma(false)
      setForma({ ime: '', telefon: '', datum: '', vrijeme: '', napomena: '' })
    } catch {
      setGreska('Došlo je do greške. Pokušajte ponovo.')
    }
    setLoading(false)
  }

  const poveziKlijentNalog = async (ime: string, telefon: string, email: string) => {
    const { data: sessionData } = await supabase.auth.getSession()
    const token = sessionData.session?.access_token
    if (!token) throw new Error('Nije pronađena klijentska sesija.')

    const res = await fetch('/api/clients/link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_token: token,
        salon_id: salon.id,
        ime,
        telefon,
        email,
      }),
    })
    const data = await res.json()
    if (data.error) throw new Error(data.error)
  }

  const handleClientAuth = async () => {
    if (!clientForma.email || !clientForma.lozinka || !clientForma.telefon) {
      setClientAuthError('Email, lozinka i telefon su obavezni.')
      return
    }
    if (clientAuthMode === 'signup' && !clientForma.ime.trim()) {
      setClientAuthError('Unesite ime i prezime.')
      return
    }

    setClientAuthLoading(true)
    setClientAuthError('')
    setClientAuthSuccess('')

    try {
      if (clientAuthMode === 'signup') {
        const { error: signUpError } = await supabase.auth.signUp({
          email: clientForma.email.trim(),
          password: clientForma.lozinka,
        })
        if (signUpError) throw new Error(signUpError.message)

        const { error: signInAfterSignupError } = await supabase.auth.signInWithPassword({
          email: clientForma.email.trim(),
          password: clientForma.lozinka,
        })
        if (signInAfterSignupError) throw new Error(signInAfterSignupError.message)
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: clientForma.email.trim(),
          password: clientForma.lozinka,
        })
        if (signInError) throw new Error(signInError.message)
      }

      await poveziKlijentNalog(clientForma.ime.trim() || 'Klijent', clientForma.telefon.trim(), clientForma.email.trim())
      setKlijentUlogovan(true)
      setClientAuthSuccess(clientAuthMode === 'signup' ? 'Klijentski nalog je kreiran i povezan.' : 'Uspješna prijava klijenta.')
      setActiveView('profile')
      await ucitajClientSummary()
    } catch (error) {
      setClientAuthError(error instanceof Error ? error.message : 'Neuspjela autentifikacija klijenta.')
    } finally {
      setClientAuthLoading(false)
    }
  }

  const handleClientLogout = async () => {
    await supabase.auth.signOut()
    setKlijentUlogovan(false)
    setClientSummary(null)
    setClientAuthSuccess('Odjavljeni ste.')
  }

  return (
    <main style={{ background: '#0a0a0a', minHeight: '100vh', color: '#f5f0e8', fontFamily: 'sans-serif' }}>
      <style>{`
        @keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
        @keyframes spin{to{transform:rotate(360deg)}}
        *{box-sizing:border-box;margin:0;padding:0}
        input,textarea{outline:none;font-family:sans-serif;color:#f5f0e8}
        input:focus,textarea:focus{border-color:rgba(212,175,55,.6)!important}
        .usluga-card{cursor:pointer;background:#161616;border:0.5px solid rgba(212,175,55,.15);border-radius:16px;padding:20px;transition:all .3s}
        .usluga-card:hover{border-color:rgba(212,175,55,.4);transform:translateY(-2px)}
        .usluga-active{border-color:#d4af37!important;background:rgba(212,175,55,.08)!important}
        @media(max-width:768px){
          .hero-section{padding:40px 20px!important}
          .hero-title{font-size:28px!important}
          .content-pad{padding:0 20px 40px!important}
          .usluge-grid{grid-template-columns:1fr!important}
          .forma-grid{grid-template-columns:1fr!important}
        }
      `}</style>

      {/* HEADER */}
      <div className="hero-section" style={{ background: 'linear-gradient(135deg,#111,#1a1500)', borderBottom: '0.5px solid rgba(212,175,55,.2)', padding: '60px 48px', textAlign: 'center', animation: 'fadeUp .6s ease' }}>
        {salon.logo_url
          ? <img src={salon.logo_url} alt={salon.naziv} style={{ width: '80px', height: '80px', borderRadius: '20px', objectFit: 'cover', margin: '0 auto 20px', display: 'block', border: '0.5px solid rgba(212,175,55,.3)' }} />
          : <div style={{ width: '80px', height: '80px', borderRadius: '20px', background: `linear-gradient(135deg,${gold},#b8960c)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '32px', fontWeight: 600, color: '#0a0a0a', margin: '0 auto 20px' }}>
              {salon.naziv.charAt(0)}
            </div>
        }
        {salon.tip && <div style={{ fontSize: '12px', color: gold, letterSpacing: '1px', marginBottom: '12px' }}>{salon.tip.toUpperCase()}</div>}
        <h1 className="hero-title" style={{ fontSize: '42px', fontWeight: 500, color: '#f5f0e8', marginBottom: '16px' }}>{salon.naziv}</h1>
        {salon.opis && <p style={{ fontSize: '16px', color: 'rgba(245,240,232,.55)', lineHeight: 1.8, maxWidth: '600px', margin: '0 auto 24px' }}>{salon.opis}</p>}
        <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap', fontSize: '13px', color: 'rgba(245,240,232,.45)' }}>
          {salon.grad && <span>📍 {salon.adresa ? `${salon.adresa}, ` : ''}{salon.grad}</span>}
          {salon.telefon && <span>📞 {salon.telefon}</span>}
          {salon.radno_od && salon.radno_do && <span>🕐 {salon.radno_od} — {salon.radno_do}</span>}
        </div>
      </div>

      <div className="content-pad" style={{ maxWidth: '900px', margin: '0 auto', padding: '0 48px 60px' }}>
        <div style={{ marginTop: '20px', marginBottom: '14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              onClick={() => setMobileMenuOpen((prev) => !prev)}
              style={{ background: '#141414', color: '#f5f0e8', border: `0.5px solid ${goldBorder}`, borderRadius: '10px', padding: '8px 10px', fontSize: '13px', cursor: 'pointer' }}
            >
              ☰ Meni
            </button>
            <button
              onClick={() => setActiveView('booking')}
              style={{ background: activeView === 'booking' ? goldFaint : 'transparent', color: activeView === 'booking' ? gold : 'rgba(245,240,232,.6)', border: `0.5px solid ${goldBorder}`, borderRadius: '10px', padding: '8px 12px', fontSize: '12px', cursor: 'pointer' }}
            >
              Zakazivanje
            </button>
            <button
              onClick={() => setActiveView('profile')}
              style={{ background: activeView === 'profile' ? goldFaint : 'transparent', color: activeView === 'profile' ? gold : 'rgba(245,240,232,.6)', border: `0.5px solid ${goldBorder}`, borderRadius: '10px', padding: '8px 12px', fontSize: '12px', cursor: 'pointer' }}
            >
              Tvoj profil
            </button>
          </div>
          {klijentUlogovan && (
            <button onClick={() => void ucitajClientSummary()} style={{ background: 'transparent', color: 'rgba(245,240,232,.7)', border: '0.5px solid rgba(245,240,232,.2)', borderRadius: '10px', padding: '8px 12px', fontSize: '12px', cursor: 'pointer' }}>
              {summaryLoading ? 'Učitavanje...' : 'Osveži profil'}
            </button>
          )}
        </div>

        {mobileMenuOpen && (
          <div style={{ marginBottom: '12px', background: '#141414', border: `0.5px solid ${goldBorder}`, borderRadius: '12px', padding: '10px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button onClick={() => { setActiveView('booking'); setMobileMenuOpen(false) }} style={{ background: 'transparent', color: 'rgba(245,240,232,.75)', border: `0.5px solid ${goldBorder}`, borderRadius: '10px', padding: '8px 10px', fontSize: '12px', cursor: 'pointer' }}>Zakazivanje</button>
            <button onClick={() => { setActiveView('profile'); setMobileMenuOpen(false) }} style={{ background: 'transparent', color: 'rgba(245,240,232,.75)', border: `0.5px solid ${goldBorder}`, borderRadius: '10px', padding: '8px 10px', fontSize: '12px', cursor: 'pointer' }}>Tvoj profil</button>
            <button onClick={() => { setShowForma(true); setActiveView('booking'); setMobileMenuOpen(false) }} style={{ background: 'transparent', color: 'rgba(245,240,232,.75)', border: `0.5px solid ${goldBorder}`, borderRadius: '10px', padding: '8px 10px', fontSize: '12px', cursor: 'pointer' }}>Novi termin</button>
          </div>
        )}

        <div style={{ marginTop: '28px', background: '#161616', border: `0.5px solid ${goldBorder}`, borderRadius: '18px', padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginBottom: '14px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 500, color: '#f5f0e8' }}>🔔 Klijentski nalog</h3>
            {klijentUlogovan && (
              <button
                onClick={handleClientLogout}
                style={{ background: 'transparent', color: 'rgba(245,240,232,.7)', border: '0.5px solid rgba(245,240,232,.2)', padding: '8px 12px', borderRadius: '10px', fontSize: '12px', cursor: 'pointer' }}
              >
                Odjavi se
              </button>
            )}
          </div>

          {!klijentUlogovan ? (
            <>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
                <button onClick={() => setClientAuthMode('signup')} style={{ background: clientAuthMode === 'signup' ? goldFaint : 'transparent', color: clientAuthMode === 'signup' ? gold : 'rgba(245,240,232,.6)', border: `0.5px solid ${goldBorder}`, borderRadius: '10px', padding: '8px 12px', fontSize: '12px', cursor: 'pointer' }}>Kreiraj nalog</button>
                <button onClick={() => setClientAuthMode('login')} style={{ background: clientAuthMode === 'login' ? goldFaint : 'transparent', color: clientAuthMode === 'login' ? gold : 'rgba(245,240,232,.6)', border: `0.5px solid ${goldBorder}`, borderRadius: '10px', padding: '8px 12px', fontSize: '12px', cursor: 'pointer' }}>Prijava</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
                {clientAuthMode === 'signup' && (
                  <input style={{ width: '100%', background: '#1a1a1a', border: '0.5px solid rgba(212,175,55,.2)', borderRadius: '10px', padding: '12px 14px', fontSize: '14px' }} placeholder="Ime i prezime" value={clientForma.ime} onChange={e => setClientForma({ ...clientForma, ime: e.target.value })} />
                )}
                <input style={{ width: '100%', background: '#1a1a1a', border: '0.5px solid rgba(212,175,55,.2)', borderRadius: '10px', padding: '12px 14px', fontSize: '14px' }} placeholder="Telefon" value={clientForma.telefon} onChange={e => setClientForma({ ...clientForma, telefon: e.target.value })} />
                <input type="email" style={{ width: '100%', background: '#1a1a1a', border: '0.5px solid rgba(212,175,55,.2)', borderRadius: '10px', padding: '12px 14px', fontSize: '14px' }} placeholder="Email" value={clientForma.email} onChange={e => setClientForma({ ...clientForma, email: e.target.value })} />
                <input type="password" style={{ width: '100%', background: '#1a1a1a', border: '0.5px solid rgba(212,175,55,.2)', borderRadius: '10px', padding: '12px 14px', fontSize: '14px' }} placeholder="Lozinka" value={clientForma.lozinka} onChange={e => setClientForma({ ...clientForma, lozinka: e.target.value })} />
              </div>
              <button onClick={handleClientAuth} disabled={clientAuthLoading} style={{ background: `linear-gradient(135deg,${gold},#b8960c)`, color: '#0a0a0a', border: 'none', padding: '12px 18px', borderRadius: '10px', fontWeight: 600, fontSize: '13px', cursor: 'pointer' }}>
                {clientAuthLoading ? 'Molimo sačekajte...' : (clientAuthMode === 'signup' ? 'Kreiraj klijentski nalog' : 'Prijavi se')}
              </button>
            </>
          ) : (
            <p style={{ fontSize: '13px', color: 'rgba(245,240,232,.65)' }}>Prijavljeni ste kao klijent ovog salona. Uskoro: moji termini, lojalnost i inbox notifikacija.</p>
          )}

          {clientAuthError && (
            <div style={{ marginTop: '10px', background: 'rgba(220,50,50,.1)', border: '0.5px solid rgba(220,50,50,.3)', borderRadius: '10px', padding: '10px 12px', fontSize: '12px', color: '#ff6b6b' }}>
              ⚠️ {clientAuthError}
            </div>
          )}
          {clientAuthSuccess && (
            <div style={{ marginTop: '10px', background: 'rgba(50,200,100,.1)', border: '0.5px solid rgba(50,200,100,.3)', borderRadius: '10px', padding: '10px 12px', fontSize: '12px', color: '#4caf81' }}>
              ✓ {clientAuthSuccess}
            </div>
          )}
        </div>

        {activeView === 'profile' && klijentUlogovan && (
          <div style={{ marginTop: '20px', background: '#161616', border: `0.5px solid ${goldBorder}`, borderRadius: '18px', padding: '20px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 500, marginBottom: '14px' }}>📊 Tvoj profil</h3>
            {clientSummary ? (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: '10px', marginBottom: '14px' }}>
                  <div style={{ background: '#1a1a1a', border: `0.5px solid ${goldBorder}`, borderRadius: '12px', padding: '12px' }}>
                    <div style={{ fontSize: '11px', color: 'rgba(245,240,232,.45)' }}>Ukupno termina</div>
                    <div style={{ fontSize: '22px', color: gold }}>{clientSummary.stats.ukupnoTermina}</div>
                  </div>
                  <div style={{ background: '#1a1a1a', border: `0.5px solid ${goldBorder}`, borderRadius: '12px', padding: '12px' }}>
                    <div style={{ fontSize: '11px', color: 'rgba(245,240,232,.45)' }}>Potvrđeni</div>
                    <div style={{ fontSize: '22px', color: '#4caf81' }}>{clientSummary.stats.potvrdjeni}</div>
                  </div>
                  <div style={{ background: '#1a1a1a', border: `0.5px solid ${goldBorder}`, borderRadius: '12px', padding: '12px' }}>
                    <div style={{ fontSize: '11px', color: 'rgba(245,240,232,.45)' }}>Lojalnost</div>
                    <div style={{ fontSize: '22px', color: gold }}>{clientSummary.loyalty.progress_percent}%</div>
                  </div>
                </div>
                <div style={{ marginBottom: '14px', fontSize: '13px', color: 'rgba(245,240,232,.7)' }}>
                  Poseta: {clientSummary.loyalty.visits_count} · Nagrada spremna: {clientSummary.loyalty.reward_ready ? 'Da' : 'Ne'}
                </div>
                <div style={{ marginBottom: '10px', fontSize: '13px', color: 'rgba(245,240,232,.8)' }}>Prethodni termini</div>
                {clientSummary.appointments.length === 0 ? (
                  <p style={{ fontSize: '12px', color: 'rgba(245,240,232,.45)' }}>Još nema termina za ovaj nalog.</p>
                ) : (
                  clientSummary.appointments.map((termin) => (
                    <div key={termin.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '0.5px solid rgba(255,255,255,.06)' }}>
                      <span style={{ fontSize: '12px', color: 'rgba(245,240,232,.75)' }}>{new Date(termin.datum_vrijeme).toLocaleString('sr')}</span>
                      <span style={{ fontSize: '11px', color: termin.status === 'potvrđen' ? '#4caf81' : gold }}>{termin.status}</span>
                    </div>
                  ))
                )}
                <button onClick={() => { setActiveView('booking'); setShowForma(true) }} style={{ marginTop: '14px', background: `linear-gradient(135deg,${gold},#b8960c)`, color: '#0a0a0a', border: 'none', padding: '10px 14px', borderRadius: '10px', fontWeight: 600, fontSize: '13px', cursor: 'pointer' }}>
                  Zakaži novi termin
                </button>
              </>
            ) : (
              <p style={{ fontSize: '13px', color: 'rgba(245,240,232,.55)' }}>Nema podataka profila. Kliknite na dugme za osvežavanje profila.</p>
            )}
          </div>
        )}

        {activeView === 'booking' && bookingNotif && (
          <div style={{ marginTop: '24px', background: bookingNotif.status === 'potvrđen' ? 'rgba(50,200,100,.1)' : goldFaint, border: `0.5px solid ${bookingNotif.status === 'potvrđen' ? 'rgba(50,200,100,.35)' : goldBorder}`, borderRadius: '14px', padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '20px' }}>🔔</span>
              <div>
                <div style={{ fontSize: '14px', fontWeight: 600, color: bookingNotif.status === 'potvrđen' ? '#4caf81' : gold }}>{statusLabel}</div>
                <div style={{ fontSize: '12px', color: 'rgba(245,240,232,.45)' }}>Za broj {bookingNotif.telefon}</div>
              </div>
            </div>
            <button
              onClick={provjeriStatusTermina}
              disabled={statusLoading}
              style={{ background: 'transparent', color: 'rgba(245,240,232,.75)', border: '0.5px solid rgba(245,240,232,.2)', padding: '10px 14px', borderRadius: '10px', fontSize: '12px', cursor: 'pointer' }}
            >
              {statusLoading ? 'Provjera...' : 'Provjeri status'}
            </button>
          </div>
        )}

        {activeView === 'booking' && uspjeh && (
          <div style={{ background: 'rgba(50,200,100,.1)', border: '0.5px solid rgba(50,200,100,.3)', borderRadius: '16px', padding: '20px', margin: '32px 0', textAlign: 'center', animation: 'fadeUp .4s ease' }}>
            <div style={{ fontSize: '32px', marginBottom: '8px' }}>🎉</div>
            <div style={{ fontSize: '16px', fontWeight: 500, color: '#4caf81', marginBottom: '4px' }}>Termin je zakazan!</div>
            <div style={{ fontSize: '13px', color: 'rgba(245,240,232,.5)' }}>Salon će vas kontaktirati za potvrdu.</div>
          </div>
        )}

        {/* USLUGE */}
        {activeView === 'booking' && usluge.length > 0 && (
          <div style={{ marginTop: '48px' }}>
            <h2 style={{ fontSize: '22px', fontWeight: 500, color: '#f5f0e8', marginBottom: '8px' }}>Naše usluge</h2>
            <p style={{ fontSize: '13px', color: 'rgba(245,240,232,.4)', marginBottom: '24px' }}>Odaberite uslugu za zakazivanje</p>
            <div className="usluge-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              {usluge.map(u => (
                <div key={u.id} className={`usluga-card${odabranaUsluga?.id === u.id ? ' usluga-active' : ''}`}
                  onClick={() => { setOdabranaUsluga(odabranaUsluga?.id === u.id ? null : u); setShowForma(true) }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                    <div style={{ fontSize: '15px', fontWeight: 500, color: '#f5f0e8' }}>{u.naziv}</div>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: gold }}>{Number(u.cijena).toLocaleString()} RSD</div>
                  </div>
                  <div style={{ fontSize: '12px', color: 'rgba(245,240,232,.4)' }}>{u.trajanje} min</div>
                  {u.opis && <div style={{ fontSize: '12px', color: 'rgba(245,240,232,.35)', marginTop: '6px' }}>{u.opis}</div>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* FORMA */}
        {activeView === 'booking' && showForma && (
          <div style={{ marginTop: '32px', background: '#161616', border: `0.5px solid ${goldBorder}`, borderRadius: '20px', padding: '28px', animation: 'fadeUp .4s ease' }}>
            <h3 style={{ fontSize: '18px', fontWeight: 500, color: '#f5f0e8', marginBottom: '6px' }}>
              Zakaži termin {odabranaUsluga ? `— ${odabranaUsluga.naziv}` : ''}
            </h3>
            <p style={{ fontSize: '13px', color: 'rgba(245,240,232,.4)', marginBottom: '24px' }}>Popunite podatke i salon će vas kontaktirati za potvrdu.</p>
            <div className="forma-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
              {[
                { label: 'IME I PREZIME *', key: 'ime', placeholder: 'Ana Marković', type: 'text' },
                { label: 'TELEFON *', key: 'telefon', placeholder: '+381 60 000 000', type: 'tel' },
                { label: 'DATUM *', key: 'datum', placeholder: '', type: 'date' },
                { label: 'VRIJEME *', key: 'vrijeme', placeholder: '', type: 'time' },
              ].map(f => (
                <div key={f.key}>
                  <label style={{ fontSize: '11px', color: 'rgba(245,240,232,.4)', display: 'block', marginBottom: '5px', letterSpacing: '.3px' }}>{f.label}</label>
                  <input type={f.type} style={{ width: '100%', background: '#1a1a1a', border: '0.5px solid rgba(212,175,55,.2)', borderRadius: '10px', padding: '12px 14px', fontSize: '14px' }}
                    placeholder={f.placeholder} value={(forma as any)[f.key]}
                    onChange={e => setForma({ ...forma, [f.key]: e.target.value })}
                    min={f.type === 'date' ? new Date().toISOString().split('T')[0] : undefined} />
                </div>
              ))}
              <div style={{ gridColumn: '1/-1' }}>
                <label style={{ fontSize: '11px', color: 'rgba(245,240,232,.4)', display: 'block', marginBottom: '5px', letterSpacing: '.3px' }}>NAPOMENA</label>
                <textarea style={{ width: '100%', background: '#1a1a1a', border: '0.5px solid rgba(212,175,55,.2)', borderRadius: '10px', padding: '12px 14px', fontSize: '14px', resize: 'none', height: '80px' }}
                  placeholder="Posebni zahtjevi..." value={forma.napomena}
                  onChange={e => setForma({ ...forma, napomena: e.target.value })} />
              </div>
            </div>

            {greska && (
              <div style={{ background: 'rgba(220,50,50,.1)', border: '0.5px solid rgba(220,50,50,.3)', borderRadius: '10px', padding: '12px 16px', marginBottom: '14px', fontSize: '13px', color: '#ff6b6b' }}>
                ⚠️ {greska}
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <button style={{ background: `linear-gradient(135deg,${gold},#b8960c)`, color: '#0a0a0a', border: 'none', padding: '14px 28px', borderRadius: '12px', fontWeight: 600, fontSize: '14px', cursor: 'pointer', fontFamily: 'sans-serif', opacity: loading ? .6 : 1 }}
                disabled={loading} onClick={handleZakazivanje}>
                {loading
                  ? <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ width: '14px', height: '14px', border: '2px solid rgba(10,10,10,.3)', borderTop: '2px solid #0a0a0a', borderRadius: '50%', display: 'inline-block', animation: 'spin .8s linear infinite' }} />
                    Zakazivanje...
                  </span>
                  : 'Zakaži termin →'}
              </button>
              <button style={{ background: 'transparent', color: 'rgba(245,240,232,.5)', border: '0.5px solid rgba(245,240,232,.15)', padding: '14px 20px', borderRadius: '12px', fontSize: '14px', cursor: 'pointer', fontFamily: 'sans-serif' }}
                onClick={() => { setShowForma(false); setGreska('') }}>
                Odustani
              </button>
            </div>
          </div>
        )}

        {activeView === 'booking' && !showForma && !uspjeh && (
          <div style={{ marginTop: '32px', textAlign: 'center' }}>
            <button style={{ background: `linear-gradient(135deg,${gold},#b8960c)`, color: '#0a0a0a', border: 'none', padding: '16px 36px', borderRadius: '28px', fontWeight: 600, fontSize: '16px', cursor: 'pointer', fontFamily: 'sans-serif' }}
              onClick={() => setShowForma(true)}>
              Zakaži termin →
            </button>
          </div>
        )}

        {/* LOJALNOST */}
        {activeView === 'booking' && lojalnost?.aktivan && (
          <div style={{ marginTop: '48px', background: 'linear-gradient(135deg,#1a1500,#0f0e00)', border: '0.5px solid rgba(212,175,55,.35)', borderRadius: '20px', padding: '28px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '16px' }}>
              <div style={{ width: '48px', height: '48px', background: goldFaint, borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px' }}>🎁</div>
              <div>
                <h3 style={{ fontSize: '18px', fontWeight: 500, color: '#f5f0e8', marginBottom: '4px' }}>Program lojalnosti</h3>
                <p style={{ fontSize: '13px', color: 'rgba(245,240,232,.45)' }}>Nagrađujemo naše vjerne klijente</p>
              </div>
            </div>
            <div style={{ background: goldFaint, borderRadius: '12px', padding: '16px' }}>
              <div style={{ fontSize: '16px', color: gold, fontWeight: 500 }}>
                🏆 Svaki {lojalnost.svaki_koji}. dolazak →{' '}
                {lojalnost.tip === 'popust' ? `${lojalnost.vrijednost}% popusta` :
                  lojalnost.tip === 'vaučer' ? `vaučer ${lojalnost.vrijednost} RSD` : 'besplatna usluga'}
              </div>
            </div>
          </div>
        )}

        {/* GOOGLE MAPA */}
        {activeView === 'booking' && mapsUrl && (
          <div style={{ marginTop: '48px' }}>
            <h2 style={{ fontSize: '22px', fontWeight: 500, color: '#f5f0e8', marginBottom: '8px' }}>Gdje se nalazimo</h2>
            <p style={{ fontSize: '13px', color: 'rgba(245,240,232,.4)', marginBottom: '20px' }}>
              📍 {salon.adresa}, {salon.grad}
            </p>
            <div style={{ borderRadius: '16px', overflow: 'hidden', border: '0.5px solid rgba(212,175,55,.2)', height: '300px' }}>
              <iframe width="100%" height="300" style={{ border: 0, display: 'block' }} loading="lazy" allowFullScreen src={mapsUrl} />
            </div>
          </div>
        )}

        <div style={{ marginTop: '48px', paddingTop: '24px', borderTop: '0.5px solid rgba(212,175,55,.1)', textAlign: 'center' }}>
          <p style={{ fontSize: '12px', color: 'rgba(245,240,232,.2)' }}>
            Powered by <span style={{ color: 'rgba(212,175,55,.5)' }}>SalonPro</span>
          </p>
        </div>
      </div>
    </main>
  )
}