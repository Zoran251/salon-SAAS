'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { getAppRole } from '@/lib/user-role'

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

type PageView = 'booking' | 'profile'

interface ClientNotification {
  id: string
  title: string
  body: string
  tip: string
  created_at: string
  read_at: string | null
  appointment_id?: string | null
}

interface ClientSummary {
  client: {
    ime: string
    telefon: string
    email?: string | null
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
  notifications?: ClientNotification[]
}

declare global {
  interface Window {
    __GOOGLE_MAPS_EMBED_KEY__?: string
  }
}

/** Adresa + grad (dovoljan je bar jedan da se mapa prikaže). */
function buildLocationQuery(salon: Salon): string {
  return [salon.adresa, salon.grad]
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter(Boolean)
    .join(', ')
}

/** Službeni Embed API ako postoji ključ (layout injektuje ga s Vercela); inače iframe bez ključa. */
function buildMapsEmbedSrc(locationQuery: string): string {
  const key =
    (typeof window !== 'undefined' && window.__GOOGLE_MAPS_EMBED_KEY__) ||
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
    ''
  if (key) {
    return `https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(key)}&q=${encodeURIComponent(locationQuery)}`
  }
  return `https://maps.google.com/maps?q=${encodeURIComponent(locationQuery)}&hl=sr&z=16&output=embed`
}

function mapsSearchUrl(locationQuery: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(locationQuery)}`
}

function skratiTekst(s: string, n: number): string {
  const t = s.trim()
  if (t.length <= n) return t
  return `${t.slice(0, n - 1)}…`
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
  const [clientAuthSuccess, setClientAuthSuccess] = useState('')
  const [klijentUlogovan, setKlijentUlogovan] = useState(false)
  const [guestAuthCollapsed, setGuestAuthCollapsed] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [activeView, setActiveView] = useState<PageView>('booking')
  const [clientSummary, setClientSummary] = useState<ClientSummary | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [forma, setForma] = useState({ ime: '', telefon: '', datum: '', vrijeme: '', napomena: '' })
  const [profilUredi, setProfilUredi] = useState(false)
  const [profilEdit, setProfilEdit] = useState({ ime: '', telefon: '', email: '' })
  const [profilSnimiLoading, setProfilSnimiLoading] = useState(false)
  const [profilPoruka, setProfilPoruka] = useState('')
  const [profilGreska, setProfilGreska] = useState('')
  const prevShowFormaRef = useRef(false)
  const [notifPanelOpen, setNotifPanelOpen] = useState(false)
  const [inAppToast, setInAppToast] = useState<{ title: string; body: string } | null>(null)
  const notifBellRef = useRef<HTMLDivElement | null>(null)
  const knownNotifIdsRef = useRef<Set<string>>(new Set())
  const notifPrimedRef = useRef(false)

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

        setSalon({ ...salonData, slug: salonData.slug ?? slug } as Salon)

        // Učitaj usluge
        const { data: uslugeData } = await supabase
          .from('usluge')
          .select('*')
          .eq('salon_id', salonData.id)

        setUsluge((uslugeData || []) as Usluga[])

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
    if (!salon?.id) return

    const applyUser = (user: { id: string; user_metadata?: Record<string, unknown> } | null) => {
      if (!user) {
        setKlijentUlogovan(false)
        return
      }
      if (user.id === salon.id) {
        setKlijentUlogovan(false)
        return
      }
      const role = getAppRole(user)
      if (role === 'salon_owner') {
        setKlijentUlogovan(false)
        return
      }
      if (role === 'customer') {
        setKlijentUlogovan(true)
        return
      }
      // Stari nalozi bez app_role: kupac ako nije vlasnik ovog salona
      setKlijentUlogovan(user.id !== salon.id)
    }

    void supabase.auth.getUser().then(({ data: { user } }) => applyUser(user))

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      applyUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [salon?.id])

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
    if (!showForma) {
      prevShowFormaRef.current = false
      return
    }
    if (prevShowFormaRef.current) return
    prevShowFormaRef.current = true
    if (klijentUlogovan && clientSummary?.client) {
      setForma((f) => ({
        ...f,
        ime: clientSummary.client.ime,
        telefon: clientSummary.client.telefon,
      }))
    }
  }, [showForma, klijentUlogovan, clientSummary])

  /** In-app obaveštenja: osvežavanje na celoj stranici dok je kupac ulogovan. */
  useEffect(() => {
    if (!klijentUlogovan || !salon?.id) return
    const id = window.setInterval(() => void ucitajClientSummary(), 30000)
    return () => window.clearInterval(id)
  }, [klijentUlogovan, salon?.id, ucitajClientSummary])

  useEffect(() => {
    if (!klijentUlogovan) {
      knownNotifIdsRef.current.clear()
      notifPrimedRef.current = false
    }
  }, [klijentUlogovan])

  useEffect(() => {
    knownNotifIdsRef.current.clear()
    notifPrimedRef.current = false
    setClientSummary(null)
  }, [salon?.id])

  useEffect(() => {
    if (!klijentUlogovan || !clientSummary) return
    const list = clientSummary.notifications ?? []
    if (!notifPrimedRef.current) {
      list.forEach((n) => knownNotifIdsRef.current.add(n.id))
      notifPrimedRef.current = true
      return
    }
    const newlyArrived = list.filter((n) => !knownNotifIdsRef.current.has(n.id))
    newlyArrived.forEach((n) => knownNotifIdsRef.current.add(n.id))
    if (newlyArrived.length === 0) return
    const toastCandidate = newlyArrived
      .filter((n) => !n.read_at)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
    if (toastCandidate) {
      setInAppToast({ title: toastCandidate.title, body: toastCandidate.body })
    }
  }, [klijentUlogovan, clientSummary])

  useEffect(() => {
    if (!notifPanelOpen) return
    const close = (e: MouseEvent) => {
      if (notifBellRef.current && !notifBellRef.current.contains(e.target as Node)) {
        setNotifPanelOpen(false)
      }
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [notifPanelOpen])

  useEffect(() => {
    if (!inAppToast) return
    const t = window.setTimeout(() => setInAppToast(null), 8000)
    return () => window.clearTimeout(t)
  }, [inAppToast])

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
  const kupacReturnEnc = encodeURIComponent(`/salon/${slug}`)
  const neprocitaneObavestenja =
    clientSummary?.notifications?.filter((n) => !n.read_at).length ?? 0

  const locationQuery = salon ? buildLocationQuery(salon) : ''
  const mapsUrl = locationQuery ? buildMapsEmbedSrc(locationQuery) : ''
  const openInMapsUrl = locationQuery ? mapsSearchUrl(locationQuery) : ''
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
      const emailZaTermin =
        klijentUlogovan && clientSummary?.client?.email ? String(clientSummary.client.email).trim() : undefined

      const res = await fetch('/api/termini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salon_id: salon.id,
          usluga_id: odabranaUsluga?.id || null,
          ime_klijenta: forma.ime,
          telefon_klijenta: forma.telefon,
          datum_vrijeme: datumVrijeme,
          napomena: forma.napomena,
          ...(emailZaTermin ? { email: emailZaTermin } : {}),
        }),
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
      if (klijentUlogovan) void ucitajClientSummary()
    } catch {
      setGreska('Došlo je do greške. Pokušajte ponovo.')
    }
    setLoading(false)
  }

  const handleClientLogout = async () => {
    await supabase.auth.signOut()
    setKlijentUlogovan(false)
    setGuestAuthCollapsed(false)
    setClientSummary(null)
    setProfilUredi(false)
    setClientAuthSuccess('Odjavljeni ste.')
  }

  const otvoriUredjivanjeProfila = () => {
    if (!clientSummary?.client) return
    setProfilEdit({
      ime: clientSummary.client.ime,
      telefon: clientSummary.client.telefon,
      email: clientSummary.client.email || '',
    })
    setProfilUredi(true)
    setProfilGreska('')
    setProfilPoruka('')
  }

  const snimiProfilKupca = async () => {
    if (!salon?.id) return
    setProfilSnimiLoading(true)
    setProfilGreska('')
    setProfilPoruka('')
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      if (!token) throw new Error('Nema sesije.')
      const params = new URLSearchParams({ auth_token: token, salon_id: salon.id })
      const res = await fetch(`/api/clients/me?${params.toString()}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ime: profilEdit.ime.trim(),
          telefon: profilEdit.telefon.trim(),
          email: profilEdit.email.trim() || null,
        }),
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(data.error || 'Snimanje nije uspjelo.')
      setProfilUredi(false)
      setProfilPoruka('Podaci su sačuvani.')
      await ucitajClientSummary()
    } catch (e) {
      setProfilGreska(e instanceof Error ? e.message : 'Greška.')
    } finally {
      setProfilSnimiLoading(false)
    }
  }

  const oznaciObavestenjeProcitano = async (notificationId: string) => {
    if (!salon?.id) return
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      if (!token) return
      const params = new URLSearchParams({ auth_token: token, salon_id: salon.id })
      const res = await fetch(`/api/clients/me?${params.toString()}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mark_notification_read: notificationId }),
      })
      if (res.ok) await ucitajClientSummary()
    } catch {
      // Ignoriši — korisnik može ponovo osvežiti
    }
  }

  return (
    <main style={{ background: '#0a0a0a', minHeight: '100vh', color: '#f5f0e8', fontFamily: 'sans-serif' }}>
      <style>{`
        @keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
        @keyframes salonToastIn{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
        @keyframes spin{to{transform:rotate(360deg)}}
        *{box-sizing:border-box;margin:0;padding:0}
        input,textarea{outline:none;font-family:sans-serif;color:#f5f0e8}
        input:focus,textarea:focus{border-color:rgba(212,175,55,.6)!important}
        .usluga-card{cursor:pointer;background:#161616;border:0.5px solid rgba(212,175,55,.15);border-radius:16px;padding:20px;transition:all .3s}
        .usluga-card:hover{border-color:rgba(212,175,55,.4);transform:translateY(-2px)}
        .usluga-active{border-color:#d4af37!important;background:rgba(212,175,55,.08)!important}
        .salon-sticky-nav{
          position:sticky;top:0;z-index:50;
          background:rgba(8,8,8,.88);
          backdrop-filter:saturate(140%) blur(14px);
          -webkit-backdrop-filter:saturate(140%) blur(14px);
          border-bottom:0.5px solid rgba(212,175,55,.22);
          box-shadow:0 12px 40px rgba(0,0,0,.35);
        }
        .salon-nav-inner{
          max-width:900px;margin:0 auto;
          padding:12px 48px;
          display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;
        }
        .salon-nav-brand{display:flex;align-items:center;gap:10px;min-width:0;flex:1}
        .salon-nav-brand-mark{
          width:36px;height:36px;border-radius:12px;flex-shrink:0;
          display:flex;align-items:center;justify-content:center;
          font-size:15px;font-weight:700;color:#0a0a0a;
          border:0.5px solid rgba(212,175,55,.35);
        }
        .salon-nav-brand-text{font-size:14px;font-weight:600;color:#f5f0e8;letter-spacing:.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .salon-nav-pills{display:none;align-items:center;gap:8px;flex-wrap:wrap}
        .salon-nav-burger-only{display:inline-flex;align-items:center;justify-content:center}
        .salon-nav-actions{display:flex;align-items:center;gap:8px;flex-shrink:0}
        @media(min-width:769px){
          .salon-nav-pills{display:flex}
          .salon-nav-burger-only{display:none!important}
          .salon-mobile-sheet{display:none!important}
        }
        @media(max-width:768px){
          .salon-nav-inner{padding:10px 20px}
          .salon-mobile-sheet{padding:0 20px 12px!important}
          .hero-section{padding:36px 20px 44px!important}
          .hero-title{font-size:28px!important}
          .content-pad{padding:0 20px 40px!important}
          .usluge-grid{grid-template-columns:1fr!important}
          .forma-grid{grid-template-columns:1fr!important}
        }
      `}</style>

      {/* Sticky navigacija — iznad hero-a; na mobilnom samo burger */}
      <header className="salon-sticky-nav">
        <div className="salon-nav-inner">
          <div className="salon-nav-brand">
            {salon.logo_url ? (
              <img
                src={salon.logo_url}
                alt=""
                width={36}
                height={36}
                style={{ borderRadius: 12, objectFit: 'cover', border: '0.5px solid rgba(212,175,55,.35)' }}
              />
            ) : (
              <div
                className="salon-nav-brand-mark"
                style={{ background: `linear-gradient(135deg,${gold},#b8960c)` }}
              >
                {salon.naziv.charAt(0)}
              </div>
            )}
            <span className="salon-nav-brand-text">{salon.naziv}</span>
          </div>

          <div className="salon-nav-pills">
            <button
              type="button"
              onClick={() => setActiveView('booking')}
              style={{
                background: activeView === 'booking' ? 'rgba(212,175,55,.12)' : 'transparent',
                color: activeView === 'booking' ? gold : 'rgba(245,240,232,.65)',
                border: `0.5px solid ${goldBorder}`,
                borderRadius: 10,
                padding: '8px 14px',
                fontSize: 12,
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'background .2s,color .2s',
              }}
            >
              Zakazivanje
            </button>
            <button
              type="button"
              onClick={() => setActiveView('profile')}
              style={{
                position: 'relative',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                background: activeView === 'profile' ? 'rgba(212,175,55,.12)' : 'transparent',
                color: activeView === 'profile' ? gold : 'rgba(245,240,232,.65)',
                border: `0.5px solid ${goldBorder}`,
                borderRadius: 10,
                padding: '8px 14px',
                fontSize: 12,
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'background .2s,color .2s',
              }}
            >
              Tvoj profil
              {neprocitaneObavestenja > 0 ? (
                <span
                  style={{
                    minWidth: 18,
                    height: 18,
                    padding: '0 5px',
                    borderRadius: 9,
                    background: '#c45c5c',
                    color: '#fff',
                    fontSize: 10,
                    fontWeight: 700,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {neprocitaneObavestenja > 9 ? '9+' : neprocitaneObavestenja}
                </span>
              ) : null}
            </button>
          </div>

          <div className="salon-nav-actions">
            {klijentUlogovan && (
              <div ref={notifBellRef} style={{ position: 'relative' }}>
                <button
                  type="button"
                  aria-haspopup="dialog"
                  aria-expanded={notifPanelOpen}
                  aria-label="Obaveštenja u aplikaciji"
                  onClick={() => setNotifPanelOpen((o) => !o)}
                  style={{
                    position: 'relative',
                    background: notifPanelOpen ? 'rgba(212,175,55,.12)' : '#141414',
                    color: '#f5f0e8',
                    border: `0.5px solid ${goldBorder}`,
                    borderRadius: 10,
                    padding: '8px 11px',
                    fontSize: 15,
                    lineHeight: 1,
                    cursor: 'pointer',
                  }}
                >
                  🔔
                  {neprocitaneObavestenja > 0 ? (
                    <span
                      style={{
                        position: 'absolute',
                        top: -4,
                        right: -4,
                        minWidth: 16,
                        height: 16,
                        padding: '0 4px',
                        borderRadius: 8,
                        background: '#c45c5c',
                        color: '#fff',
                        fontSize: 9,
                        fontWeight: 700,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        border: '2px solid #0a0a0a',
                      }}
                    >
                      {neprocitaneObavestenja > 9 ? '9+' : neprocitaneObavestenja}
                    </span>
                  ) : null}
                </button>
                {notifPanelOpen && (
                  <div
                    role="dialog"
                    aria-label="Obaveštenja"
                    style={{
                      position: 'absolute',
                      right: 0,
                      top: 'calc(100% + 8px)',
                      width: 'min(340px, calc(100vw - 32px))',
                      maxHeight: 360,
                      overflowY: 'auto',
                      background: '#121212',
                      border: `0.5px solid ${goldBorder}`,
                      borderRadius: 14,
                      boxShadow: '0 20px 50px rgba(0,0,0,.55)',
                      zIndex: 60,
                      padding: '12px 0',
                    }}
                  >
                    <div style={{ padding: '0 14px 10px', borderBottom: `0.5px solid ${goldBorder}` }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#f5f0e8' }}>Obaveštenja</div>
                      <div style={{ fontSize: 11, color: 'rgba(245,240,232,.45)', marginTop: 4 }}>
                        Sve unutar aplikacije — osvežava se automatski.
                      </div>
                    </div>
                    {(clientSummary?.notifications?.length ?? 0) === 0 ? (
                      <p style={{ padding: '14px 16px', fontSize: 12, color: 'rgba(245,240,232,.45)' }}>
                        Još nema obaveštenja o terminima.
                      </p>
                    ) : (
                      <ul style={{ listStyle: 'none', margin: 0, padding: '8px 0' }}>
                        {(clientSummary?.notifications ?? [])
                          .slice()
                          .sort((a, b) => b.created_at.localeCompare(a.created_at))
                          .slice(0, 6)
                          .map((n) => (
                            <li
                              key={n.id}
                              style={{
                                padding: '10px 14px',
                                borderBottom: '0.5px solid rgba(245,240,232,.06)',
                              }}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                                <div style={{ minWidth: 0 }}>
                                  <div style={{ fontSize: 13, fontWeight: 600, color: n.read_at ? 'rgba(245,240,232,.55)' : '#f5f0e8' }}>
                                    {n.title}
                                  </div>
                                  <div style={{ fontSize: 11, color: 'rgba(245,240,232,.42)', marginTop: 4, lineHeight: 1.45 }}>
                                    {skratiTekst(n.body, 120)}
                                  </div>
                                </div>
                                {!n.read_at ? (
                                  <button
                                    type="button"
                                    onClick={() => void oznaciObavestenjeProcitano(n.id)}
                                    style={{
                                      flexShrink: 0,
                                      fontSize: 10,
                                      fontWeight: 600,
                                      color: gold,
                                      background: 'transparent',
                                      border: `0.5px solid ${goldBorder}`,
                                      borderRadius: 8,
                                      padding: '4px 8px',
                                      cursor: 'pointer',
                                    }}
                                  >
                                    OK
                                  </button>
                                ) : null}
                              </div>
                            </li>
                          ))}
                      </ul>
                    )}
                    <div style={{ padding: '8px 14px 4px' }}>
                      <button
                        type="button"
                        onClick={() => {
                          setNotifPanelOpen(false)
                          setActiveView('profile')
                        }}
                        style={{
                          width: '100%',
                          textAlign: 'center',
                          background: 'rgba(212,175,55,.1)',
                          color: gold,
                          border: `0.5px solid ${goldBorder}`,
                          borderRadius: 10,
                          padding: '10px 12px',
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        Sva obaveštenja i profil →
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
            {klijentUlogovan && (
              <button
                type="button"
                onClick={() => void ucitajClientSummary()}
                style={{
                  background: 'transparent',
                  color: 'rgba(245,240,232,.75)',
                  border: '0.5px solid rgba(245,240,232,.18)',
                  borderRadius: 10,
                  padding: '8px 12px',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                {summaryLoading ? '…' : 'Osveži'}
              </button>
            )}
            <button
              type="button"
              className="salon-nav-burger-only"
              onClick={() => setMobileMenuOpen((prev) => !prev)}
              aria-expanded={mobileMenuOpen}
              aria-label="Meni"
              style={{
                background: '#141414',
                color: '#f5f0e8',
                border: `0.5px solid ${goldBorder}`,
                borderRadius: 10,
                padding: '10px 12px',
                fontSize: 16,
                lineHeight: 1,
                cursor: 'pointer',
              }}
            >
              ☰
            </button>
          </div>
        </div>

        {mobileMenuOpen && (
          <div
            style={{
              maxWidth: 900,
              margin: '0 auto',
              padding: '0 48px 12px',
              display: 'flex',
              gap: 8,
              flexWrap: 'wrap',
              borderTop: '0.5px solid rgba(212,175,55,.12)',
              paddingTop: 12,
            }}
            className="salon-mobile-sheet"
          >
            <button
              type="button"
              onClick={() => {
                setActiveView('booking')
                setMobileMenuOpen(false)
              }}
              style={{
                background: 'transparent',
                color: 'rgba(245,240,232,.85)',
                border: `0.5px solid ${goldBorder}`,
                borderRadius: 10,
                padding: '10px 14px',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              Zakazivanje
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveView('profile')
                setMobileMenuOpen(false)
              }}
              style={{
                position: 'relative',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                background: 'transparent',
                color: 'rgba(245,240,232,.85)',
                border: `0.5px solid ${goldBorder}`,
                borderRadius: 10,
                padding: '10px 14px',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              Tvoj profil
              {neprocitaneObavestenja > 0 ? (
                <span
                  style={{
                    minWidth: 18,
                    height: 18,
                    padding: '0 5px',
                    borderRadius: 9,
                    background: '#c45c5c',
                    color: '#fff',
                    fontSize: 10,
                    fontWeight: 700,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {neprocitaneObavestenja > 9 ? '9+' : neprocitaneObavestenja}
                </span>
              ) : null}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowForma(true)
                setActiveView('booking')
                setMobileMenuOpen(false)
              }}
              style={{
                background: 'rgba(212,175,55,.1)',
                color: gold,
                border: `0.5px solid ${goldBorder}`,
                borderRadius: 10,
                padding: '10px 14px',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Novi termin
            </button>
          </div>
        )}
      </header>

      {/* Hero — podaci o salonu */}
      <div className="hero-section" style={{ background: 'linear-gradient(180deg,#0f0d08 0%,#111 32%,#1a1500 100%)', borderBottom: '0.5px solid rgba(212,175,55,.18)', padding: '52px 48px 56px', textAlign: 'center', animation: 'fadeUp .6s ease' }}>
        {salon.logo_url
          ? <img src={salon.logo_url} alt={salon.naziv} style={{ width: '80px', height: '80px', borderRadius: '20px', objectFit: 'cover', margin: '0 auto 20px', display: 'block', border: '0.5px solid rgba(212,175,55,.3)' }} />
          : <div style={{ width: '80px', height: '80px', borderRadius: '20px', background: `linear-gradient(135deg,${gold},#b8960c)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '32px', fontWeight: 600, color: '#0a0a0a', margin: '0 auto 20px' }}>
              {salon.naziv.charAt(0)}
            </div>
        }
        {salon.tip && <div style={{ fontSize: '11px', color: gold, letterSpacing: '2px', marginBottom: '14px', fontWeight: 600 }}>{salon.tip.toUpperCase()}</div>}
        <h1 className="hero-title" style={{ fontSize: '42px', fontWeight: 600, color: '#f5f0e8', marginBottom: '12px', letterSpacing: '-0.02em', lineHeight: 1.15 }}>{salon.naziv}</h1>
        <div style={{ width: 56, height: 3, borderRadius: 2, margin: '0 auto 20px', background: `linear-gradient(90deg,transparent,${gold},transparent)` }} aria-hidden />
        {salon.opis && <p style={{ fontSize: '16px', color: 'rgba(245,240,232,.58)', lineHeight: 1.75, maxWidth: '560px', margin: '0 auto 28px' }}>{salon.opis}</p>}
        <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap', fontSize: '13px', color: 'rgba(245,240,232,.45)' }}>
          {salon.grad && <span>📍 {salon.adresa ? `${salon.adresa}, ` : ''}{salon.grad}</span>}
          {salon.telefon && <span>📞 {salon.telefon}</span>}
          {salon.radno_od && salon.radno_do && <span>🕐 {salon.radno_od} — {salon.radno_do}</span>}
        </div>
      </div>

      <div className="content-pad" style={{ maxWidth: '900px', margin: '0 auto', padding: '0 48px 60px' }}>
        <div style={{ marginTop: '28px', background: '#161616', border: `0.5px solid ${goldBorder}`, borderRadius: '18px', padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginBottom: '12px' }}>
            <div>
              <h3 style={{ fontSize: '16px', fontWeight: 500, color: '#f5f0e8' }}>Kupac — nalog</h3>
              <p style={{ fontSize: '12px', color: 'rgba(245,240,232,.45)', marginTop: '6px', lineHeight: 1.5 }}>
                Registrujte se ili prijavite kao kupac da pratite termine i lojalnost kod ovog salona.
              </p>
            </div>
            {klijentUlogovan && (
              <button
                type="button"
                onClick={handleClientLogout}
                style={{ background: 'transparent', color: 'rgba(245,240,232,.7)', border: '0.5px solid rgba(245,240,232,.2)', padding: '8px 12px', borderRadius: '10px', fontSize: '12px', cursor: 'pointer' }}
              >
                Odjavi se
              </button>
            )}
          </div>

          {!klijentUlogovan ? (
            <>
              {!guestAuthCollapsed ? (
                <>
                  <div style={{ display: 'flex', gap: '10px', marginBottom: '14px', flexWrap: 'wrap', alignItems: 'center' }}>
                    <button
                      type="button"
                      onClick={() => {
                        setGuestAuthCollapsed(true)
                        setActiveView('booking')
                      }}
                      style={{ background: 'transparent', color: 'rgba(245,240,232,.75)', border: `0.5px solid ${goldBorder}`, borderRadius: '10px', padding: '10px 14px', fontSize: '13px', cursor: 'pointer' }}
                    >
                      Nastavi kao gost
                    </button>
                  </div>
                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'stretch' }}>
                    <Link
                      href={`/kupac/registracija?next=${kupacReturnEnc}`}
                      style={{
                        flex: '1 1 140px',
                        textAlign: 'center',
                        background: `linear-gradient(135deg,${gold},#b8960c)`,
                        color: '#0a0a0a',
                        border: 'none',
                        padding: '12px 16px',
                        borderRadius: '10px',
                        fontWeight: 600,
                        fontSize: '13px',
                        textDecoration: 'none',
                      }}
                    >
                      Registracija kupca
                    </Link>
                    <Link
                      href={`/kupac/prijava?next=${kupacReturnEnc}`}
                      style={{
                        flex: '1 1 140px',
                        textAlign: 'center',
                        background: 'transparent',
                        color: gold,
                        border: `0.5px solid ${goldBorder}`,
                        padding: '12px 16px',
                        borderRadius: '10px',
                        fontWeight: 600,
                        fontSize: '13px',
                        textDecoration: 'none',
                      }}
                    >
                      Prijava kupca
                    </Link>
                  </div>
                </>
              ) : (
                <div style={{ fontSize: '13px', color: 'rgba(245,240,232,.7)', lineHeight: 1.6 }}>
                  <p style={{ marginBottom: '10px' }}>Zakazujete kao gost — nije potreban nalog. Kasnije se možete registrovati kao kupac da pratite termine i lojalnost.</p>
                  <button
                    type="button"
                    onClick={() => setGuestAuthCollapsed(false)}
                    style={{ background: 'transparent', color: gold, border: `0.5px solid ${goldBorder}`, borderRadius: '10px', padding: '8px 12px', fontSize: '12px', cursor: 'pointer' }}
                  >
                    Nazad na kupovinski nalog
                  </button>
                </div>
              )}
            </>
          ) : (
            <p style={{ fontSize: '13px', color: 'rgba(245,240,232,.65)' }}>Prijavljeni ste kao kupac ovog salona. Uskoro: moji termini, lojalnost i inbox notifikacija.</p>
          )}

          {clientAuthSuccess && (
            <div style={{ marginTop: '10px', background: 'rgba(50,200,100,.1)', border: '0.5px solid rgba(50,200,100,.3)', borderRadius: '10px', padding: '10px 12px', fontSize: '12px', color: '#4caf81' }}>
              ✓ {clientAuthSuccess}
            </div>
          )}
        </div>

        {activeView === 'booking' && klijentUlogovan && neprocitaneObavestenja > 0 && (
          <button
            type="button"
            onClick={() => setActiveView('profile')}
            style={{
              marginTop: '16px',
              width: '100%',
              textAlign: 'left',
              padding: '14px 16px',
              borderRadius: '14px',
              border: `0.5px solid ${goldBorder}`,
              background: 'rgba(212,175,55,.1)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
            }}
          >
            <span style={{ fontSize: '14px', color: '#f5f0e8' }}>
              <strong style={{ color: gold }}>{neprocitaneObavestenja}</strong> nova obaveštenja o terminima
            </span>
            <span style={{ fontSize: '12px', color: gold }}>Pogledaj →</span>
          </button>
        )}

        {activeView === 'profile' && klijentUlogovan && (
          <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ background: '#161616', border: `0.5px solid ${goldBorder}`, borderRadius: '18px', padding: '22px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' }}>
                <h3 style={{ fontSize: '17px', fontWeight: 600, color: '#f5f0e8' }}>Tvoji podaci</h3>
                {!profilUredi ? (
                  <button
                    type="button"
                    onClick={otvoriUredjivanjeProfila}
                    disabled={!clientSummary}
                    style={{
                      background: 'transparent',
                      color: gold,
                      border: `0.5px solid ${goldBorder}`,
                      padding: '8px 14px',
                      borderRadius: '10px',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: clientSummary ? 'pointer' : 'not-allowed',
                      opacity: clientSummary ? 1 : 0.5,
                    }}
                  >
                    Izmeni podatke
                  </button>
                ) : (
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={() => void snimiProfilKupca()}
                      disabled={profilSnimiLoading}
                      style={{
                        background: `linear-gradient(135deg,${gold},#b8960c)`,
                        color: '#0a0a0a',
                        border: 'none',
                        padding: '8px 16px',
                        borderRadius: '10px',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: profilSnimiLoading ? 'wait' : 'pointer',
                        opacity: profilSnimiLoading ? 0.7 : 1,
                      }}
                    >
                      {profilSnimiLoading ? 'Čuvanje…' : 'Sačuvaj'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setProfilUredi(false)}
                      disabled={profilSnimiLoading}
                      style={{
                        background: 'transparent',
                        color: 'rgba(245,240,232,.65)',
                        border: '0.5px solid rgba(245,240,232,.2)',
                        padding: '8px 14px',
                        borderRadius: '10px',
                        fontSize: '12px',
                        cursor: 'pointer',
                      }}
                    >
                      Otkaži
                    </button>
                  </div>
                )}
              </div>
              {clientSummary ? (
                profilUredi ? (
                  <div style={{ display: 'grid', gap: '14px' }}>
                    <div>
                      <label style={{ fontSize: '11px', color: 'rgba(245,240,232,.45)', display: 'block', marginBottom: '6px' }}>IME I PREZIME</label>
                      <input
                        value={profilEdit.ime}
                        onChange={(e) => setProfilEdit({ ...profilEdit, ime: e.target.value })}
                        style={{ width: '100%', background: '#1a1a1a', border: '0.5px solid rgba(212,175,55,.25)', borderRadius: '12px', padding: '12px 14px', fontSize: '14px' }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '11px', color: 'rgba(245,240,232,.45)', display: 'block', marginBottom: '6px' }}>TELEFON</label>
                      <input
                        value={profilEdit.telefon}
                        onChange={(e) => setProfilEdit({ ...profilEdit, telefon: e.target.value })}
                        style={{ width: '100%', background: '#1a1a1a', border: '0.5px solid rgba(212,175,55,.25)', borderRadius: '12px', padding: '12px 14px', fontSize: '14px' }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '11px', color: 'rgba(245,240,232,.45)', display: 'block', marginBottom: '6px' }}>EMAIL</label>
                      <input
                        type="email"
                        value={profilEdit.email}
                        onChange={(e) => setProfilEdit({ ...profilEdit, email: e.target.value })}
                        style={{ width: '100%', background: '#1a1a1a', border: '0.5px solid rgba(212,175,55,.25)', borderRadius: '12px', padding: '12px 14px', fontSize: '14px' }}
                      />
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'grid', gap: '12px' }}>
                    {[
                      { label: 'Ime', v: clientSummary.client.ime },
                      { label: 'Telefon', v: clientSummary.client.telefon },
                      { label: 'Email', v: clientSummary.client.email || '—' },
                    ].map((row) => (
                      <div
                        key={row.label}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '12px 14px',
                          background: '#141414',
                          borderRadius: '12px',
                          border: '0.5px solid rgba(255,255,255,.06)',
                        }}
                      >
                        <span style={{ fontSize: '12px', color: 'rgba(245,240,232,.45)' }}>{row.label}</span>
                        <span style={{ fontSize: '14px', color: '#f5f0e8', fontWeight: 500, textAlign: 'right', maxWidth: '62%', wordBreak: 'break-word' }}>{row.v}</span>
                      </div>
                    ))}
                  </div>
                )
              ) : (
                <p style={{ fontSize: '13px', color: 'rgba(245,240,232,.55)' }}>Učitavanje profila…</p>
              )}
              {profilGreska && (
                <div style={{ marginTop: '12px', padding: '10px 12px', borderRadius: '10px', background: 'rgba(220,50,50,.1)', border: '0.5px solid rgba(220,50,50,.3)', color: '#ff8a8a', fontSize: '12px' }}>
                  {profilGreska}
                </div>
              )}
              {profilPoruka && !profilUredi && (
                <div style={{ marginTop: '12px', padding: '10px 12px', borderRadius: '10px', background: 'rgba(50,200,100,.1)', border: '0.5px solid rgba(50,200,100,.25)', color: '#7ddf9a', fontSize: '12px' }}>
                  {profilPoruka}
                </div>
              )}
            </div>

            {clientSummary && (clientSummary.notifications?.length ?? 0) > 0 && (
              <div style={{ background: '#161616', border: `0.5px solid ${goldBorder}`, borderRadius: '18px', padding: '22px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
                  <h3 style={{ fontSize: '17px', fontWeight: 600, color: '#f5f0e8' }}>🔔 Obaveštenja</h3>
                  {neprocitaneObavestenja > 0 ? (
                    <span style={{ fontSize: '11px', color: gold, border: `0.5px solid ${goldBorder}`, padding: '4px 10px', borderRadius: '20px' }}>
                      {neprocitaneObavestenja} nepročitanih
                    </span>
                  ) : null}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {clientSummary.notifications!.map((n) => (
                    <div
                      key={n.id}
                      style={{
                        padding: '14px',
                        borderRadius: '14px',
                        background: n.read_at ? '#121212' : 'rgba(212,175,55,.08)',
                        border: `0.5px solid ${n.read_at ? 'rgba(255,255,255,.06)' : goldBorder}`,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', flexWrap: 'wrap' }}>
                        <div style={{ flex: '1 1 200px' }}>
                          <div style={{ fontSize: '14px', fontWeight: 600, color: '#f5f0e8', marginBottom: '4px' }}>{n.title}</div>
                          <div style={{ fontSize: '13px', color: 'rgba(245,240,232,.65)', lineHeight: 1.5 }}>{n.body}</div>
                          <div style={{ fontSize: '11px', color: 'rgba(245,240,232,.35)', marginTop: '8px' }}>
                            {new Date(n.created_at).toLocaleString('sr')}
                          </div>
                        </div>
                        {!n.read_at ? (
                          <button
                            type="button"
                            onClick={() => void oznaciObavestenjeProcitano(n.id)}
                            style={{
                              flexShrink: 0,
                              background: 'transparent',
                              color: gold,
                              border: `0.5px solid ${goldBorder}`,
                              padding: '6px 10px',
                              borderRadius: '8px',
                              fontSize: '11px',
                              cursor: 'pointer',
                            }}
                          >
                            Označi kao pročitano
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ background: '#161616', border: `0.5px solid ${goldBorder}`, borderRadius: '18px', padding: '22px' }}>
              <h3 style={{ fontSize: '17px', fontWeight: 600, marginBottom: '14px', color: '#f5f0e8' }}>Pregled</h3>
              {clientSummary ? (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: '10px', marginBottom: '14px' }}>
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
                    Posete: {clientSummary.loyalty.visits_count} · Nagrada: {clientSummary.loyalty.reward_ready ? 'spremna' : 'nije spremna'}
                  </div>
                  <div style={{ marginBottom: '10px', fontSize: '13px', fontWeight: 500, color: 'rgba(245,240,232,.85)' }}>Moji termini</div>
                  {clientSummary.appointments.length === 0 ? (
                    <p style={{ fontSize: '12px', color: 'rgba(245,240,232,.45)' }}>Još nema zakazanih termina.</p>
                  ) : (
                    clientSummary.appointments.map((termin) => (
                      <div
                        key={termin.id}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '10px 0',
                          borderBottom: '0.5px solid rgba(255,255,255,.06)',
                        }}
                      >
                        <span style={{ fontSize: '12px', color: 'rgba(245,240,232,.8)' }}>{new Date(termin.datum_vrijeme).toLocaleString('sr')}</span>
                        <span style={{ fontSize: '11px', color: termin.status === 'potvrđen' ? '#4caf81' : gold }}>{termin.status}</span>
                      </div>
                    ))
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setActiveView('booking')
                      setShowForma(true)
                    }}
                    style={{
                      marginTop: '16px',
                      width: '100%',
                      background: `linear-gradient(135deg,${gold},#b8960c)`,
                      color: '#0a0a0a',
                      border: 'none',
                      padding: '12px 16px',
                      borderRadius: '12px',
                      fontWeight: 600,
                      fontSize: '14px',
                      cursor: 'pointer',
                    }}
                  >
                    Zakaži novi termin
                  </button>
                </>
              ) : (
                <p style={{ fontSize: '13px', color: 'rgba(245,240,232,.55)' }}>Učitavanje…</p>
              )}
            </div>
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
            <p style={{ fontSize: '13px', color: 'rgba(245,240,232,.4)', marginBottom: '24px' }}>
              {klijentUlogovan && clientSummary?.client
                ? 'Ime i telefon su preuzeti iz vašeg profila (možete ih izmeniti za ovaj termin).'
                : 'Popunite podatke i salon će vas kontaktirati za potvrdu.'}
            </p>
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
        {activeView === 'booking' && mapsUrl && locationQuery && (
          <div style={{ marginTop: '48px' }}>
            <h2 style={{ fontSize: '22px', fontWeight: 500, color: '#f5f0e8', marginBottom: '8px' }}>Gdje se nalazimo</h2>
            <p style={{ fontSize: '13px', color: 'rgba(245,240,232,.4)', marginBottom: '20px' }}>
              📍 {locationQuery}
            </p>
            <div style={{ borderRadius: '16px', overflow: 'hidden', border: '0.5px solid rgba(212,175,55,.2)', height: '300px' }}>
              <iframe
                title="Lokacija salona na mapi"
                width="100%"
                height="300"
                style={{ border: 0, display: 'block' }}
                loading="lazy"
                allowFullScreen
                referrerPolicy="no-referrer-when-downgrade"
                src={mapsUrl}
              />
            </div>
            <a
              href={openInMapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: 'inline-block', marginTop: '12px', fontSize: '13px', color: gold }}
            >
              Otvori u Google Maps →
            </a>
          </div>
        )}

        <div style={{ marginTop: '48px', paddingTop: '24px', borderTop: '0.5px solid rgba(212,175,55,.1)', textAlign: 'center' }}>
          <p style={{ fontSize: '12px', color: 'rgba(245,240,232,.2)' }}>
            Powered by <span style={{ color: 'rgba(212,175,55,.5)' }}>SalonPro</span>
          </p>
        </div>
      </div>

      {inAppToast && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed',
            zIndex: 70,
            left: 16,
            right: 16,
            bottom: `max(20px, env(safe-area-inset-bottom, 0px))`,
            display: 'flex',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              pointerEvents: 'auto',
              maxWidth: 440,
              width: '100%',
              animation: 'salonToastIn .35s ease-out',
              background: 'linear-gradient(145deg, #1a1814 0%, #141210 100%)',
              border: `0.5px solid ${goldBorder}`,
              borderRadius: 16,
              padding: '14px 16px',
              boxShadow: '0 16px 48px rgba(0,0,0,.55)',
              display: 'flex',
              gap: 12,
              alignItems: 'flex-start',
            }}
          >
            <span style={{ fontSize: 20, lineHeight: 1 }} aria-hidden>
              🔔
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#f5f0e8', marginBottom: 4 }}>{inAppToast.title}</div>
              <div style={{ fontSize: 12, color: 'rgba(245,240,232,.55)', lineHeight: 1.5 }}>{skratiTekst(inAppToast.body, 200)}</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => {
                    setInAppToast(null)
                    setActiveView('profile')
                  }}
                  style={{
                    background: `linear-gradient(135deg,${gold},#b8960c)`,
                    color: '#0a0a0a',
                    border: 'none',
                    borderRadius: 10,
                    padding: '8px 14px',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Otvori profil
                </button>
                <button
                  type="button"
                  onClick={() => setInAppToast(null)}
                  style={{
                    background: 'transparent',
                    color: 'rgba(245,240,232,.65)',
                    border: '0.5px solid rgba(245,240,232,.2)',
                    borderRadius: 10,
                    padding: '8px 14px',
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  Zatvori
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}