'use client'
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { waitForClientSession } from '@/lib/wait-client-session'
import { getAppRole } from '@/lib/user-role'
import { isTerminOtkazan, isTerminPotvrdjen, storageTerminStatus } from '@/lib/termin-status'

interface Usluga {
  id: string
  naziv: string
  cijena: number
  trajanje: number
  opis?: string
  kategorija?: string | null
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
  termin_id?: string
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
  booking_blocked?: boolean
  loyalty: {
    visits_count: number
    progress_percent: number
    reward_ready: boolean
  }
  appointments: Array<{
    id: string
    datum_vrijeme: string
    status: string
    ime_klijenta?: string
    telefon_klijenta?: string | null
    usluga_id?: string | null
    napomena?: string | null
    usluge?: { naziv?: string } | null
  }>
  notifications?: ClientNotification[]
}

type TerminPregled = ClientSummary['appointments'][number]

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
  const bookingNotifRef = useRef<BookingNotification | null>(null)
  const [clientAuthSuccess, setClientAuthSuccess] = useState('')
  const [klijentUlogovan, setKlijentUlogovan] = useState(false)
  const [guestAuthCollapsed, setGuestAuthCollapsed] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [activeView, setActiveView] = useState<PageView>('booking')
  const [clientSummary, setClientSummary] = useState<ClientSummary | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  /** Poslednja greška GET /api/clients/me (npr. nalog nije povezan sa salonom). */
  const [clientMeError, setClientMeError] = useState('')
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
  const uslugeAnchorRef = useRef<HTMLDivElement | null>(null)
  const podaciAnchorRef = useRef<HTMLDivElement | null>(null)
  const kupacMenuRef = useRef<HTMLDivElement | null>(null)
  const [kupacMenuOpen, setKupacMenuOpen] = useState(false)
  const [bookingPickerOpen, setBookingPickerOpen] = useState(false)
  const [bookingPickerKategorija, setBookingPickerKategorija] = useState('Ostalo')
  const [terminAkcijaPoruka, setTerminAkcijaPoruka] = useState('')
  const [terminAkcijaGreska, setTerminAkcijaGreska] = useState('')
  const [terminEdit, setTerminEdit] = useState<{
    id: string
    datum: string
    vrijeme: string
    usluga_id: string
    napomena: string
  } | null>(null)
  const [terminEditLoading, setTerminEditLoading] = useState(false)
  const [terminCancelLoading, setTerminCancelLoading] = useState<string | null>(null)

  const uslugeKategorije = useMemo(() => {
    const s = new Set(usluge.map((u) => (u.kategorija?.trim() ? u.kategorija.trim() : 'Ostalo')))
    return [...s].sort((a, b) => a.localeCompare(b, 'sr'))
  }, [usluge])

  const uslugeUFokusu = useMemo(
    () => usluge.filter((u) => (u.kategorija?.trim() ? u.kategorija.trim() : 'Ostalo') === bookingPickerKategorija),
    [usluge, bookingPickerKategorija]
  )

  const otvoriZakazivanjePicker = useCallback(() => {
    if (klijentUlogovan && clientSummary?.booking_blocked) {
      setInAppToast({
        title: 'Zakazivanje nije dostupno',
        body: 'Vaš nalog je na crnoj listi.',
      })
      return
    }
    setActiveView('booking')
    setMobileMenuOpen(false)
    setKupacMenuOpen(false)
    setNotifPanelOpen(false)
    setTerminAkcijaPoruka('')
    setTerminAkcijaGreska('')
    if (usluge.length === 0) {
      setShowForma(true)
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          uslugeAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        })
      })
      return
    }
    setBookingPickerKategorija(uslugeKategorije[0] ?? 'Ostalo')
    setBookingPickerOpen(true)
  }, [usluge.length, uslugeKategorije, klijentUlogovan, clientSummary?.booking_blocked])

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

    let cancelled = false

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

    // Posle F5 sesija iz localStorage često nije odmah dostupna — čekamo, bez lažne odjave.
    const hydrateSession = async () => {
      const session = await waitForClientSession()
      if (cancelled) return
      applyUser(session?.user ?? null)
    }

    void hydrateSession()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return
      if (event === 'SIGNED_OUT') {
        applyUser(null)
        return
      }
      // Ne postavljati „nije ulogovan” na session === null osim pri SIGNED_OUT.
      // Supabase ponekad prosledi prazan session u toku osvežavanja tokena — to je skidalo kupcu profil, termine i izmene.
      if (session?.user) {
        applyUser(session.user)
      }
    })
    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [salon?.id])

  const ucitajClientSummary = useCallback(async (opts?: { silent?: boolean }) => {
    if (!salon?.id) return
    const silent = Boolean(opts?.silent)
    if (!silent) setSummaryLoading(true)
    setClientMeError('')
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      if (!token) {
        setClientSummary(null)
        setClientMeError('')
        return
      }

      const params = new URLSearchParams({ auth_token: token, salon_id: salon.id })
      const res = await fetch(`/api/clients/me?${params.toString()}`, { cache: 'no-store' })
      const data = (await res.json()) as { error?: string } & Partial<ClientSummary>
      if (!res.ok || data.error) {
        setClientSummary(null)
        setClientMeError(data.error || `Greška servera (${res.status}).`)
        return
      }
      setClientMeError('')
      setClientSummary(data as ClientSummary)
    } finally {
      if (!silent) setSummaryLoading(false)
    }
  }, [salon?.id])

  useEffect(() => {
    if (!klijentUlogovan || !salon?.id) return
    void ucitajClientSummary()
  }, [klijentUlogovan, salon?.id, ucitajClientSummary])

  // Ako je nalog naknadno stavljen na crnu listu, prekini sesiju (npr. stara kolačić-sesija).
  useEffect(() => {
    if (!klijentUlogovan || !clientSummary?.booking_blocked) return
    let cancelled = false
    void (async () => {
      await supabase.auth.signOut()
      if (cancelled) return
      setClientSummary(null)
      setInAppToast({
        title: 'Pristup ograničen',
        body: 'Vaš nalog je na crnoj listi. Sesija je zatvorena; prijava kao kupac nije moguća.',
      })
    })()
    return () => {
      cancelled = true
    }
  }, [klijentUlogovan, clientSummary?.booking_blocked])

  // Automatsko ime/telefon iz profila kada je kupac ulogovan.
  // Ne sme se osloniti samo na prvi render: clientSummary često stigne posle otvaranja forme.
  useEffect(() => {
    if (!showForma) {
      prevShowFormaRef.current = false
      return
    }
    if (!klijentUlogovan || !clientSummary?.client) return

    const { ime: cIme, telefon: cTel } = clientSummary.client

    if (!prevShowFormaRef.current) {
      prevShowFormaRef.current = true
      setForma((f) => ({
        ...f,
        ime: cIme,
        telefon: cTel,
      }))
      return
    }

    // Forma je već otvorena; profil se upravo učitao ili osvežio — popuni samo ako korisnik još nije uneo svoje vrednosti
    setForma((f) => ({
      ...f,
      ime: f.ime.trim() ? f.ime : cIme,
      telefon: f.telefon.trim() ? f.telefon : cTel,
    }))
  }, [showForma, klijentUlogovan, clientSummary])

  /** In-app obaveštenja: osvežavanje na celoj stranici dok je kupac ulogovan. */
  useEffect(() => {
    if (!klijentUlogovan || !salon?.id) return
    const id = window.setInterval(() => void ucitajClientSummary({ silent: true }), 30000)
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
    if (!kupacMenuOpen) return
    const close = (e: MouseEvent) => {
      if (kupacMenuRef.current && !kupacMenuRef.current.contains(e.target as Node)) {
        setKupacMenuOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setKupacMenuOpen(false)
    }
    document.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [kupacMenuOpen])

  useEffect(() => {
    if (!inAppToast) return
    const t = window.setTimeout(() => setInAppToast(null), 8000)
    return () => window.clearTimeout(t)
  }, [inAppToast])

  useEffect(() => {
    setClientMeError('')
  }, [slug])

  useEffect(() => {
    bookingNotifRef.current = bookingNotif
  }, [bookingNotif])

  useEffect(() => {
    if (!slug || typeof window === 'undefined') return
    const saved = window.localStorage.getItem(`booking:${slug}`)
    if (!saved) return

    try {
      const parsed = JSON.parse(saved) as BookingNotification
      if (parsed?.datum_vrijeme) {
        setBookingNotif(parsed)
        bookingNotifRef.current = parsed
      }
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
    const n = bookingNotifRef.current
    if (!n) return
    setStatusLoading(true)
    try {
      const params = new URLSearchParams({
        status_check: '1',
        salon_id: n.salon_id,
        ime: n.ime,
        telefon: n.telefon,
        datum_vrijeme: n.datum_vrijeme,
        _: String(Date.now()),
      })
      if (n.termin_id) params.set('termin_id', n.termin_id)
      const res = await fetch(`/api/termini?${params.toString()}`, { cache: 'no-store' })
      const data = (await res.json()) as { error?: string; status?: string | null }
      if (data.error) {
        setGreska(data.error)
        return
      }
      const s = data.status != null ? storageTerminStatus(String(data.status)) : ''
      const prev = storageTerminStatus(n.status)
      if (s.length > 0 && s !== prev) {
        const nextNotif = { ...n, status: s }
        bookingNotifRef.current = nextNotif
        setBookingNotif(nextNotif)
        sacuvajBookingNotif(nextNotif)
        if (klijentUlogovan) void ucitajClientSummary({ silent: true })
      }
    } catch {
      setGreska('Ne možemo provjeriti status trenutno. Pokušajte ponovo.')
    } finally {
      setStatusLoading(false)
    }
  }, [sacuvajBookingNotif, klijentUlogovan, ucitajClientSummary])

  useEffect(() => {
    if (!bookingNotif || isTerminPotvrdjen(bookingNotif.status) || isTerminOtkazan(bookingNotif.status)) return

    void provjeriStatusTermina()
    const intervalId = window.setInterval(() => {
      void provjeriStatusTermina()
    }, 5000)

    /** U browseru setInterval vraća number; NodeJS.Timeout iz @types/node zbunjuje tsc na Vercelu. */
    let summaryPoll: number | undefined
    if (klijentUlogovan) {
      void ucitajClientSummary({ silent: true })
      summaryPoll = window.setInterval(() => void ucitajClientSummary({ silent: true }), 6000)
    }

    return () => {
      window.clearInterval(intervalId)
      if (summaryPoll) window.clearInterval(summaryPoll)
    }
  }, [bookingNotif, provjeriStatusTermina, klijentUlogovan, ucitajClientSummary])

  /** Kad salon potvrdi: obaveštenja, lista termina iz /api/clients/me ili različit ISO za datum — uskladi karticu. */
  useEffect(() => {
    const pending = bookingNotifRef.current
    if (!pending || isTerminPotvrdjen(pending.status) || isTerminOtkazan(pending.status)) return

    const normDatum = (iso: string) => {
      const t = iso.replace(' ', 'T').replace(/(\.\d{3})?Z?$/, '').replace(/\+00:00$/, '')
      return t.length >= 16 ? t.slice(0, 16) : t
    }

    if (clientSummary?.notifications?.length && pending.termin_id) {
      const confirmed = clientSummary.notifications.some(
        (n) =>
          n.tip === 'appointment_confirmed' &&
          n.appointment_id &&
          n.appointment_id === pending.termin_id
      )
      if (confirmed) {
        const nextNotif = { ...pending, status: 'potvrđen' as const }
        bookingNotifRef.current = nextNotif
        setBookingNotif(nextNotif)
        sacuvajBookingNotif(nextNotif)
        return
      }
    }

    if (!clientSummary?.appointments?.length) return

    const normTel = (t: string) => t.replace(/\s/g, '').replace(/^\+/g, '')
    const pendTel = normTel(pending.telefon)

    const row = pending.termin_id
      ? clientSummary.appointments.find((a) => a.id === pending.termin_id)
      : clientSummary.appointments.find((a) => {
          const sameTime = normDatum(a.datum_vrijeme) === normDatum(pending.datum_vrijeme)
          const sameIme = (a.ime_klijenta || '').trim() === pending.ime.trim()
          const aTel = normTel((a.telefon_klijenta || '').trim())
          const samePhone = !aTel || aTel === pendTel
          return sameTime && sameIme && samePhone
        })

    if (!row?.status) return
    const nextStored = storageTerminStatus(row.status)
    if (nextStored === storageTerminStatus(pending.status)) return

    const nextNotif = { ...pending, status: nextStored }
    bookingNotifRef.current = nextNotif
    setBookingNotif(nextNotif)
    sacuvajBookingNotif(nextNotif)
  }, [clientSummary, sacuvajBookingNotif, bookingNotif])

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
  const statusLabel = isTerminPotvrdjen(bookingNotif?.status)
    ? 'Termin je potvrđen'
    : isTerminOtkazan(bookingNotif?.status)
      ? 'Termin je otkazan'
      : 'Termin čeka potvrdu'

  const handleZakazivanje = async () => {
    if (klijentUlogovan && clientSummary?.booking_blocked) {
      setGreska('Zakazivanje nije dostupno: vaš nalog je na crnoj listi zbog kasnih otkazivanja.')
      return
    }
    if (!forma.ime || !forma.telefon || !forma.datum || !forma.vrijeme) {
      setGreska('Molimo popunite sva obavezna polja.')
      return
    }
    if (usluge.length > 0 && !odabranaUsluga) {
      setGreska('Izaberite kategoriju i uslugu pre slanja zahteva.')
      return
    }
    setLoading(true)
    setGreska('')
    try {
      const datumVrijeme = `${forma.datum}T${forma.vrijeme}:00`
      const emailZaTermin =
        klijentUlogovan && clientSummary?.client?.email ? String(clientSummary.client.email).trim() : undefined

      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (klijentUlogovan) {
        const { data: sessionData } = await supabase.auth.getSession()
        const token = sessionData.session?.access_token
        if (token) headers.Authorization = `Bearer ${token}`
      }

      const res = await fetch('/api/termini', {
        method: 'POST',
        headers,
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
      const data = (await res.json()) as { error?: string; success?: boolean; termin_id?: string | null }
      if (data.error) {
        setGreska(data.error)
        setLoading(false)
        return
      }
      const nextNotif: BookingNotification = {
        salon_id: salon.id,
        ime: forma.ime,
        telefon: forma.telefon,
        datum_vrijeme: datumVrijeme,
        status: 'ceka',
        ...(typeof data.termin_id === 'string' && data.termin_id ? { termin_id: data.termin_id } : {}),
      }
      bookingNotifRef.current = nextNotif
      setBookingNotif(nextNotif)
      sacuvajBookingNotif(nextNotif)
      window.setTimeout(() => void provjeriStatusTermina(), 700)
      window.setTimeout(() => void provjeriStatusTermina(), 4000)
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
    setKupacMenuOpen(false)
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

  const otvoriTerminZaEdit = (termin: TerminPregled) => {
    setTerminAkcijaPoruka('')
    setTerminAkcijaGreska('')
    const d = new Date(termin.datum_vrijeme)
    const pad = (n: number) => String(n).padStart(2, '0')
    setTerminEdit({
      id: termin.id,
      datum: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      vrijeme: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
      usluga_id: termin.usluga_id || '',
      napomena: termin.napomena || '',
    })
  }

  const snimiTerminIzmenu = async () => {
    if (!salon?.id || !terminEdit) return
    setTerminEditLoading(true)
    setTerminAkcijaGreska('')
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      if (!token) throw new Error('Nema sesije.')
      const params = new URLSearchParams({ auth_token: token, salon_id: salon.id })
      const res = await fetch(`/api/clients/appointments/${terminEdit.id}?${params.toString()}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          datum_vrijeme: `${terminEdit.datum}T${terminEdit.vrijeme}:00`,
          usluga_id: terminEdit.usluga_id || null,
          napomena: terminEdit.napomena || null,
        }),
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(data.error || 'Snimanje nije uspjelo.')
      setTerminEdit(null)
      setTerminAkcijaPoruka('Termin je ažuriran.')
      await ucitajClientSummary()
    } catch (e) {
      setTerminAkcijaGreska(e instanceof Error ? e.message : 'Greška.')
    } finally {
      setTerminEditLoading(false)
    }
  }

  const otkaziTermin = async (terminId: string) => {
    if (!salon?.id) return
    if (!window.confirm('Da li zaista želite da otkažete ovaj termin?')) return
    setTerminCancelLoading(terminId)
    setTerminAkcijaGreska('')
    setTerminAkcijaPoruka('')
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      if (!token) throw new Error('Nema sesije.')
      const params = new URLSearchParams({ auth_token: token, salon_id: salon.id })
      const res = await fetch(`/api/clients/appointments/${terminId}?${params.toString()}`, {
        method: 'DELETE',
      })
      const data = (await res.json()) as { error?: string; message?: string }
      if (!res.ok) throw new Error(data.error || 'Otkazivanje nije uspjelo.')
      setTerminEdit(null)
      setTerminAkcijaPoruka(data.message || 'Termin je otkazan.')
      await ucitajClientSummary()
    } catch (e) {
      setTerminAkcijaGreska(e instanceof Error ? e.message : 'Greška.')
    } finally {
      setTerminCancelLoading(null)
    }
  }

  const izaberiUsluguIzPickera = (u: Usluga) => {
    setOdabranaUsluga(u)
    setBookingPickerOpen(false)
    setShowForma(true)
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        uslugeAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    })
  }

  const scrollToUsluge = () => {
    setActiveView('booking')
    setMobileMenuOpen(false)
    setNotifPanelOpen(false)
    setKupacMenuOpen(false)
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        uslugeAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    })
  }

  const scrollToPodaci = () => {
    setActiveView('profile')
    setMobileMenuOpen(false)
    setNotifPanelOpen(false)
    setKupacMenuOpen(false)
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        podaciAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    })
  }

  const renderMainColumn = () => (
      <>
        {activeView === 'booking' && klijentUlogovan && neprocitaneObavestenja > 0 && (
          <button
            type="button"
            onClick={() => scrollToPodaci()}
            style={{
              marginTop: '28px',
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

        {activeView === 'profile' && (
          <div ref={podaciAnchorRef} id="salon-tvoji-podaci" style={{ marginTop: 28, scrollMarginTop: 88 }}>
            {!klijentUlogovan && (
          <div
            style={{
              marginBottom: 20,
              background: '#161616',
              border: `0.5px solid ${goldBorder}`,
              borderRadius: '18px',
              padding: '22px',
            }}
          >
            <h3 style={{ fontSize: '17px', fontWeight: 600, color: '#f5f0e8', marginBottom: '10px' }}>Tvoji podaci</h3>
            <p style={{ fontSize: '13px', color: 'rgba(245,240,232,.55)', lineHeight: 1.6, marginBottom: '16px' }}>
              Prijavite se ili registrujte kao kupac (zlatna ikonica profila u meniju) da biste videli podatke, obaveštenja o terminima i lojalnost za ovaj salon. Isti nalog možete koristiti i kod drugih salona; program lojalnosti i broj dolazaka uvek su vezani samo za salon u kom zakazujete.
            </p>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <Link
                href={`/kupac/registracija?next=${kupacReturnEnc}`}
                style={{
                  flex: '1 1 140px',
                  textAlign: 'center',
                  background: `linear-gradient(135deg,${gold},#b8960c)`,
                  color: '#0a0a0a',
                  padding: '12px 16px',
                  borderRadius: '10px',
                  fontWeight: 600,
                  fontSize: '13px',
                  textDecoration: 'none',
                }}
              >
                Registracija
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
                Prijava
              </Link>
            </div>
          </div>
            )}

            {klijentUlogovan && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ background: '#161616', border: `0.5px solid ${goldBorder}`, borderRadius: '18px', padding: '22px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' }}>
                <h3 style={{ fontSize: '17px', fontWeight: 600, color: '#f5f0e8' }}>Tvoji podaci</h3>
                {!profilUredi ? (
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
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
                    {clientMeError && !summaryLoading ? (
                      <button
                        type="button"
                        onClick={() => void ucitajClientSummary()}
                        style={{
                          background: 'rgba(212,175,55,.12)',
                          color: gold,
                          border: `0.5px solid ${goldBorder}`,
                          padding: '8px 14px',
                          borderRadius: '10px',
                          fontSize: '12px',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        Ponovo učitaj profil
                      </button>
                    ) : null}
                  </div>
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
              ) : clientMeError ? (
                <div style={{ fontSize: '13px', color: 'rgba(245,240,232,.75)', lineHeight: 1.55 }}>
                  <p style={{ marginBottom: '12px', color: '#ff8a8a' }}>{clientMeError}</p>
                  {(clientMeError.includes('povezan') ||
                    clientMeError.includes('nije') ||
                    clientMeError.includes('telefona') ||
                    clientMeError.includes('profil')) && (
                    <p style={{ marginBottom: '12px', color: 'rgba(245,240,232,.55)' }}>
                      Ako ste se tek prijavili, proverite da li su ime i telefon sačuvani u profilu kupca (meni profila), ili zakazujte kao gost.
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => void ucitajClientSummary()}
                    style={{
                      background: `linear-gradient(135deg,${gold},#b8960c)`,
                      color: '#0a0a0a',
                      border: 'none',
                      padding: '10px 16px',
                      borderRadius: '10px',
                      fontWeight: 600,
                      fontSize: '13px',
                      cursor: 'pointer',
                    }}
                  >
                    Pokušaj ponovo
                  </button>
                </div>
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
                  {(clientSummary.notifications ?? []).map((n) => (
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
                  {clientSummary.booking_blocked ? (
                    <div
                      style={{
                        marginBottom: '14px',
                        padding: '12px 14px',
                        borderRadius: '12px',
                        background: 'rgba(200,80,80,.12)',
                        border: '0.5px solid rgba(220,100,100,.35)',
                        fontSize: '13px',
                        color: '#e8a0a0',
                        lineHeight: 1.5,
                      }}
                    >
                      Zakazivanje je blokirano u svim salonima na ovoj platformi zbog višestrukih vrlo kasnih otkazivanja.
                      Za pomoć kontaktirajte podršku.
                    </div>
                  ) : null}
                  {terminAkcijaPoruka ? (
                    <div
                      style={{
                        marginBottom: '12px',
                        padding: '10px 12px',
                        borderRadius: '10px',
                        background: 'rgba(50,200,100,.08)',
                        border: '0.5px solid rgba(50,200,100,.25)',
                        fontSize: '12px',
                        color: '#9de0b4',
                      }}
                    >
                      {terminAkcijaPoruka}
                    </div>
                  ) : null}
                  {terminAkcijaGreska ? (
                    <div
                      style={{
                        marginBottom: '12px',
                        padding: '10px 12px',
                        borderRadius: '10px',
                        background: 'rgba(220,50,50,.1)',
                        border: '0.5px solid rgba(220,50,50,.3)',
                        fontSize: '12px',
                        color: '#ff6b6b',
                      }}
                    >
                      {terminAkcijaGreska}
                    </div>
                  ) : null}
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
                      <div style={{ fontSize: '11px', color: 'rgba(245,240,232,.45)' }}>Lojalnost (ovaj salon)</div>
                      <div style={{ fontSize: '22px', color: gold }}>{clientSummary.loyalty.progress_percent}%</div>
                    </div>
                  </div>
                  <div style={{ marginBottom: '14px', fontSize: '13px', color: 'rgba(245,240,232,.7)' }}>
                    Posete: {clientSummary.loyalty.visits_count} · Nagrada: {clientSummary.loyalty.reward_ready ? 'spremna' : 'nije spremna'}
                  </div>
                  <p style={{ marginBottom: '14px', fontSize: '11px', color: 'rgba(245,240,232,.38)', lineHeight: 1.5 }}>
                    Napredak važi samo za {salon?.naziv ?? 'ovaj salon'}. Kod drugog salona imate poseban brojač, iako je nalog isti.
                  </p>
                  <div style={{ marginBottom: '10px', fontSize: '13px', fontWeight: 500, color: 'rgba(245,240,232,.85)' }}>Moji termini</div>
                  {terminEdit ? (
                    <div
                      style={{
                        marginBottom: '14px',
                        padding: '14px',
                        borderRadius: '12px',
                        border: `0.5px solid ${goldBorder}`,
                        background: '#121212',
                      }}
                    >
                      <div style={{ fontSize: '13px', fontWeight: 600, color: '#f5f0e8', marginBottom: '10px' }}>Izmena termina</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
                        <div>
                          <label style={{ fontSize: '10px', color: 'rgba(245,240,232,.45)', display: 'block', marginBottom: '4px' }}>DATUM</label>
                          <input
                            type="date"
                            value={terminEdit.datum}
                            min={new Date().toISOString().split('T')[0]}
                            onChange={(e) => setTerminEdit({ ...terminEdit, datum: e.target.value })}
                            style={{
                              width: '100%',
                              padding: '8px 10px',
                              borderRadius: '8px',
                              border: `0.5px solid ${goldBorder}`,
                              background: '#1a1a1a',
                              color: '#f5f0e8',
                              fontSize: '13px',
                            }}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: '10px', color: 'rgba(245,240,232,.45)', display: 'block', marginBottom: '4px' }}>VREME</label>
                          <input
                            type="time"
                            value={terminEdit.vrijeme}
                            onChange={(e) => setTerminEdit({ ...terminEdit, vrijeme: e.target.value })}
                            style={{
                              width: '100%',
                              padding: '8px 10px',
                              borderRadius: '8px',
                              border: `0.5px solid ${goldBorder}`,
                              background: '#1a1a1a',
                              color: '#f5f0e8',
                              fontSize: '13px',
                            }}
                          />
                        </div>
                      </div>
                      <div style={{ marginBottom: '10px' }}>
                        <label style={{ fontSize: '10px', color: 'rgba(245,240,232,.45)', display: 'block', marginBottom: '4px' }}>USLUGA</label>
                        <select
                          value={terminEdit.usluga_id}
                          onChange={(e) => setTerminEdit({ ...terminEdit, usluga_id: e.target.value })}
                          style={{
                            width: '100%',
                            padding: '8px 10px',
                            borderRadius: '8px',
                            border: `0.5px solid ${goldBorder}`,
                            background: '#1a1a1a',
                            color: '#f5f0e8',
                            fontSize: '13px',
                          }}
                        >
                          <option value="">—</option>
                          {usluge.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.naziv}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div style={{ marginBottom: '12px' }}>
                        <label style={{ fontSize: '10px', color: 'rgba(245,240,232,.45)', display: 'block', marginBottom: '4px' }}>NAPOMENA</label>
                        <textarea
                          value={terminEdit.napomena}
                          onChange={(e) => setTerminEdit({ ...terminEdit, napomena: e.target.value })}
                          rows={2}
                          style={{
                            width: '100%',
                            padding: '8px 10px',
                            borderRadius: '8px',
                            border: `0.5px solid ${goldBorder}`,
                            background: '#1a1a1a',
                            color: '#f5f0e8',
                            fontSize: '13px',
                            resize: 'none',
                          }}
                        />
                      </div>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          disabled={terminEditLoading}
                          onClick={() => void snimiTerminIzmenu()}
                          style={{
                            background: `linear-gradient(135deg,${gold},#b8960c)`,
                            color: '#0a0a0a',
                            border: 'none',
                            padding: '8px 14px',
                            borderRadius: '8px',
                            fontWeight: 600,
                            fontSize: '12px',
                            cursor: 'pointer',
                            opacity: terminEditLoading ? 0.6 : 1,
                          }}
                        >
                          {terminEditLoading ? 'Čuvanje…' : 'Sačuvaj'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setTerminEdit(null)}
                          style={{
                            background: 'transparent',
                            color: 'rgba(245,240,232,.65)',
                            border: '0.5px solid rgba(245,240,232,.2)',
                            padding: '8px 14px',
                            borderRadius: '8px',
                            fontSize: '12px',
                            cursor: 'pointer',
                          }}
                        >
                          Odustani
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {clientSummary.appointments.length === 0 ? (
                    <p style={{ fontSize: '12px', color: 'rgba(245,240,232,.45)' }}>Još nema zakazanih termina.</p>
                  ) : (
                    clientSummary.appointments.map((termin) => {
                      const uBuducnosti = new Date(termin.datum_vrijeme).getTime() > Date.now()
                      const mozeUpravljati =
                        uBuducnosti && !isTerminOtkazan(termin.status) && !clientSummary.booking_blocked
                      const statusBoja =
                        isTerminPotvrdjen(termin.status)
                          ? '#4caf81'
                          : isTerminOtkazan(termin.status)
                            ? '#e07a7a'
                            : gold
                      return (
                        <div
                          key={termin.id}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'flex-start',
                            gap: '10px',
                            padding: '10px 0',
                            borderBottom: '0.5px solid rgba(255,255,255,.06)',
                            flexWrap: 'wrap',
                          }}
                        >
                          <div style={{ flex: '1 1 160px' }}>
                            <div style={{ fontSize: '12px', color: 'rgba(245,240,232,.85)' }}>
                              {new Date(termin.datum_vrijeme).toLocaleString('sr')}
                            </div>
                            <div style={{ fontSize: '11px', color: 'rgba(245,240,232,.45)', marginTop: '2px' }}>
                              {termin.usluge?.naziv || 'Usluga'}
                            </div>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
                            <span style={{ fontSize: '11px', color: statusBoja }}>{termin.status}</span>
                            {mozeUpravljati ? (
                              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                <button
                                  type="button"
                                  onClick={() => otvoriTerminZaEdit(termin)}
                                  style={{
                                    background: 'transparent',
                                    color: gold,
                                    border: `0.5px solid ${goldBorder}`,
                                    padding: '4px 10px',
                                    borderRadius: '8px',
                                    fontSize: '11px',
                                    cursor: 'pointer',
                                  }}
                                >
                                  Izmeni
                                </button>
                                <button
                                  type="button"
                                  disabled={terminCancelLoading === termin.id}
                                  onClick={() => void otkaziTermin(termin.id)}
                                  style={{
                                    background: 'transparent',
                                    color: '#e07a7a',
                                    border: '0.5px solid rgba(220,100,100,.35)',
                                    padding: '4px 10px',
                                    borderRadius: '8px',
                                    fontSize: '11px',
                                    cursor: 'pointer',
                                    opacity: terminCancelLoading === termin.id ? 0.5 : 1,
                                  }}
                                >
                                  {terminCancelLoading === termin.id ? '…' : 'Otkaži'}
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      )
                    })
                  )}
                  <button
                    type="button"
                    disabled={Boolean(clientSummary.booking_blocked)}
                    onClick={() => {
                      otvoriZakazivanjePicker()
                      window.requestAnimationFrame(() => {
                        window.requestAnimationFrame(() => {
                          uslugeAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                        })
                      })
                    }}
                    style={{
                      marginTop: '16px',
                      width: '100%',
                      background: clientSummary.booking_blocked
                        ? 'rgba(245,240,232,.12)'
                        : `linear-gradient(135deg,${gold},#b8960c)`,
                      color: clientSummary.booking_blocked ? 'rgba(245,240,232,.35)' : '#0a0a0a',
                      border: 'none',
                      padding: '12px 16px',
                      borderRadius: '12px',
                      fontWeight: 600,
                      fontSize: '14px',
                      cursor: clientSummary.booking_blocked ? 'not-allowed' : 'pointer',
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
          </div>
        )}

        {activeView === 'booking' && bookingNotif && (
          <div
            style={{
              marginTop: '24px',
              background: isTerminPotvrdjen(bookingNotif.status)
                ? 'rgba(50,200,100,.1)'
                : isTerminOtkazan(bookingNotif.status)
                  ? 'rgba(200,80,80,.1)'
                  : goldFaint,
              border: `0.5px solid ${
                isTerminPotvrdjen(bookingNotif.status)
                  ? 'rgba(50,200,100,.35)'
                  : isTerminOtkazan(bookingNotif.status)
                    ? 'rgba(220,100,100,.35)'
                    : goldBorder
              }`,
              borderRadius: '14px',
              padding: '14px 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '20px' }}>🔔</span>
              <div>
                <div
                  style={{
                    fontSize: '14px',
                    fontWeight: 600,
                    color: isTerminPotvrdjen(bookingNotif.status)
                      ? '#4caf81'
                      : isTerminOtkazan(bookingNotif.status)
                        ? '#e07a7a'
                        : gold,
                  }}
                >
                  {statusLabel}
                </div>
                <div style={{ fontSize: '12px', color: 'rgba(245,240,232,.45)' }}>Za broj {bookingNotif.telefon}</div>
              </div>
            </div>
            {!isTerminOtkazan(bookingNotif.status) && !isTerminPotvrdjen(bookingNotif.status) ? (
              <button
                type="button"
                onClick={() => void provjeriStatusTermina()}
                disabled={statusLoading}
                style={{
                  background: 'transparent',
                  color: 'rgba(245,240,232,.75)',
                  border: '0.5px solid rgba(245,240,232,.2)',
                  padding: '10px 14px',
                  borderRadius: '10px',
                  fontSize: '12px',
                  cursor: 'pointer',
                }}
              >
                {statusLoading ? 'Provjera...' : 'Provjeri status'}
              </button>
            ) : null}
          </div>
        )}

        {activeView === 'booking' && uspjeh && (
          <div style={{ background: 'rgba(50,200,100,.1)', border: '0.5px solid rgba(50,200,100,.3)', borderRadius: '16px', padding: '20px', margin: '32px 0', textAlign: 'center', animation: 'fadeUp .4s ease' }}>
            <div style={{ fontSize: '32px', marginBottom: '8px' }}>🎉</div>
            <div style={{ fontSize: '16px', fontWeight: 500, color: '#4caf81', marginBottom: '4px' }}>Termin je zakazan!</div>
            <div style={{ fontSize: '13px', color: 'rgba(245,240,232,.5)' }}>Salon će vas kontaktirati za potvrdu.</div>
          </div>
        )}

        {activeView === 'booking' && usluge.length > 0 && (
          <div ref={uslugeAnchorRef} style={{ marginTop: '48px' }}>
            <h2 style={{ fontSize: '22px', fontWeight: 500, color: '#f5f0e8', marginBottom: '8px' }}>Naše usluge</h2>
            <p style={{ fontSize: '13px', color: 'rgba(245,240,232,.4)', marginBottom: '24px' }}>
              Klik na karticu bira uslugu odmah. Dugme „Zakaži termin” otvara prozor za kategoriju pa uslugu.
            </p>
            <div className="usluge-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              {usluge.map((u) => (
                <div
                  key={u.id}
                  className={`usluga-card${odabranaUsluga?.id === u.id ? ' usluga-active' : ''}`}
                  onClick={() => {
                    setOdabranaUsluga(odabranaUsluga?.id === u.id ? null : u)
                    setShowForma(true)
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                    <div style={{ fontSize: '15px', fontWeight: 500, color: '#f5f0e8' }}>{u.naziv}</div>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: gold }}>{Number(u.cijena).toLocaleString()} RSD</div>
                  </div>
                  <div style={{ fontSize: '12px', color: 'rgba(245,240,232,.4)' }}>
                    {(u.kategorija?.trim() || 'Ostalo')} · {u.trajanje} min
                  </div>
                  {u.opis && <div style={{ fontSize: '12px', color: 'rgba(245,240,232,.35)', marginTop: '6px' }}>{u.opis}</div>}
                </div>
              ))}
            </div>
          </div>
        )}

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
              ].map((f) => (
                <div key={f.key}>
                  <label style={{ fontSize: '11px', color: 'rgba(245,240,232,.4)', display: 'block', marginBottom: '5px', letterSpacing: '.3px' }}>{f.label}</label>
                  <input
                    type={f.type}
                    style={{ width: '100%', background: '#1a1a1a', border: '0.5px solid rgba(212,175,55,.2)', borderRadius: '10px', padding: '12px 14px', fontSize: '14px' }}
                    placeholder={f.placeholder}
                    value={(forma as Record<string, string>)[f.key]}
                    onChange={(e) => setForma({ ...forma, [f.key]: e.target.value })}
                    min={f.type === 'date' ? new Date().toISOString().split('T')[0] : undefined}
                  />
                </div>
              ))}
              <div style={{ gridColumn: '1/-1' }}>
                <label style={{ fontSize: '11px', color: 'rgba(245,240,232,.4)', display: 'block', marginBottom: '5px', letterSpacing: '.3px' }}>NAPOMENA</label>
                <textarea
                  style={{ width: '100%', background: '#1a1a1a', border: '0.5px solid rgba(212,175,55,.2)', borderRadius: '10px', padding: '12px 14px', fontSize: '14px', resize: 'none', height: '80px' }}
                  placeholder="Posebni zahtjevi..."
                  value={forma.napomena}
                  onChange={(e) => setForma({ ...forma, napomena: e.target.value })}
                />
              </div>
            </div>

            {greska && (
              <div style={{ background: 'rgba(220,50,50,.1)', border: '0.5px solid rgba(220,50,50,.3)', borderRadius: '10px', padding: '12px 16px', marginBottom: '14px', fontSize: '13px', color: '#ff6b6b' }}>
                ⚠️ {greska}
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <button
                style={{
                  background: `linear-gradient(135deg,${gold},#b8960c)`,
                  color: '#0a0a0a',
                  border: 'none',
                  padding: '14px 28px',
                  borderRadius: '12px',
                  fontWeight: 600,
                  fontSize: '14px',
                  cursor: 'pointer',
                  fontFamily: 'sans-serif',
                  opacity: loading ? 0.6 : 1,
                }}
                disabled={loading}
                onClick={handleZakazivanje}
              >
                {loading ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span
                      style={{
                        width: '14px',
                        height: '14px',
                        border: '2px solid rgba(10,10,10,.3)',
                        borderTop: '2px solid #0a0a0a',
                        borderRadius: '50%',
                        display: 'inline-block',
                        animation: 'spin .8s linear infinite',
                      }}
                    />
                    Zakazivanje...
                  </span>
                ) : (
                  'Zakaži termin →'
                )}
              </button>
              <button
                style={{
                  background: 'transparent',
                  color: 'rgba(245,240,232,.5)',
                  border: '0.5px solid rgba(245,240,232,.15)',
                  padding: '14px 20px',
                  borderRadius: '12px',
                  fontSize: '14px',
                  cursor: 'pointer',
                  fontFamily: 'sans-serif',
                }}
                onClick={() => {
                  setShowForma(false)
                  setGreska('')
                }}
              >
                Odustani
              </button>
            </div>
          </div>
        )}

        {activeView === 'booking' && !showForma && !uspjeh && (
          <div style={{ marginTop: '32px', textAlign: 'center' }}>
            <button
              type="button"
              disabled={Boolean(klijentUlogovan && clientSummary?.booking_blocked)}
              style={{
                background:
                  klijentUlogovan && clientSummary?.booking_blocked
                    ? 'rgba(245,240,232,.12)'
                    : `linear-gradient(135deg,${gold},#b8960c)`,
                color: klijentUlogovan && clientSummary?.booking_blocked ? 'rgba(245,240,232,.35)' : '#0a0a0a',
                border: 'none',
                padding: '16px 36px',
                borderRadius: '28px',
                fontWeight: 600,
                fontSize: '16px',
                cursor: klijentUlogovan && clientSummary?.booking_blocked ? 'not-allowed' : 'pointer',
                fontFamily: 'sans-serif',
              }}
              onClick={() => otvoriZakazivanjePicker()}
            >
              Zakaži termin →
            </button>
          </div>
        )}

        {activeView === 'booking' && lojalnost?.aktivan && (
          <div style={{ marginTop: '48px', background: 'linear-gradient(135deg,#1a1500,#0f0e00)', border: '0.5px solid rgba(212,175,55,.35)', borderRadius: '20px', padding: '28px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '16px' }}>
              <div style={{ width: '48px', height: '48px', background: goldFaint, borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px' }}>🎁</div>
              <div>
                <h3 style={{ fontSize: '18px', fontWeight: 500, color: '#f5f0e8', marginBottom: '4px' }}>Program lojalnosti</h3>
                <p style={{ fontSize: '13px', color: 'rgba(245,240,232,.45)', lineHeight: 1.5 }}>
                  Nagrađujemo verne klijente u ovom salonu. Jedan nalog možete koristiti svuda; pečati i nagrade ovde ne prelaze na druge salone.
                </p>
              </div>
            </div>
            <div style={{ background: goldFaint, borderRadius: '12px', padding: '16px' }}>
              <div style={{ fontSize: '16px', color: gold, fontWeight: 500 }}>
                🏆 Svaki {lojalnost.svaki_koji}. dolazak →{' '}
                {lojalnost.tip === 'popust'
                  ? `${lojalnost.vrijednost}% popusta`
                  : lojalnost.tip === 'vaučer'
                    ? `vaučer ${lojalnost.vrijednost} RSD`
                    : 'besplatna usluga'}
              </div>
            </div>
          </div>
        )}

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
            <a href={openInMapsUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', marginTop: '12px', fontSize: '13px', color: gold }}>
              Otvori u Google Maps →
            </a>
          </div>
        )}
      </>
  )

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
              onClick={() => otvoriZakazivanjePicker()}
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
              onClick={scrollToPodaci}
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
            <div ref={kupacMenuRef} style={{ position: 'relative' }}>
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={kupacMenuOpen}
                aria-label="Kupac — nalog, prijava ili registracija"
                onClick={() => setKupacMenuOpen((o) => !o)}
                style={{
                  background: kupacMenuOpen
                    ? `linear-gradient(160deg, rgba(212,175,55,.22), rgba(212,175,55,.06))`
                    : `linear-gradient(160deg, rgba(212,175,55,.14), rgba(212,175,55,.04))`,
                  border: `1px solid ${gold}`,
                  borderRadius: 10,
                  padding: '8px 10px',
                  lineHeight: 0,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: kupacMenuOpen ? `0 0 0 1px rgba(212,175,55,.25)` : 'none',
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"
                    stroke={gold}
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <circle cx="12" cy="7" r="4" stroke={gold} strokeWidth="1.75" />
                </svg>
              </button>
              {kupacMenuOpen && (
                <div
                  role="menu"
                  style={{
                    position: 'absolute',
                    right: 0,
                    top: 'calc(100% + 8px)',
                    width: 'min(300px, calc(100vw - 32px))',
                    maxHeight: 420,
                    overflowY: 'auto',
                    background: '#121212',
                    border: `0.5px solid ${goldBorder}`,
                    borderRadius: 14,
                    boxShadow: '0 20px 50px rgba(0,0,0,.55)',
                    zIndex: 65,
                    padding: '14px 14px 12px',
                  }}
                >
                  <div style={{ fontSize: 11, color: 'rgba(245,240,232,.45)', marginBottom: 10, letterSpacing: '0.04em' }}>KUPAC</div>
                  {!klijentUlogovan ? (
                    <>
                      {!guestAuthCollapsed ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          <Link
                            href={`/kupac/registracija?next=${kupacReturnEnc}`}
                            onClick={() => setKupacMenuOpen(false)}
                            style={{
                              textAlign: 'center',
                              background: `linear-gradient(135deg,${gold},#b8960c)`,
                              color: '#0a0a0a',
                              padding: '11px 14px',
                              borderRadius: 10,
                              fontWeight: 600,
                              fontSize: 13,
                              textDecoration: 'none',
                            }}
                          >
                            Registracija kupca
                          </Link>
                          <Link
                            href={`/kupac/prijava?next=${kupacReturnEnc}`}
                            onClick={() => setKupacMenuOpen(false)}
                            style={{
                              textAlign: 'center',
                              background: 'transparent',
                              color: gold,
                              border: `0.5px solid ${goldBorder}`,
                              padding: '11px 14px',
                              borderRadius: 10,
                              fontWeight: 600,
                              fontSize: 13,
                              textDecoration: 'none',
                            }}
                          >
                            Prijava kupca
                          </Link>
                          <button
                            type="button"
                            onClick={() => {
                              setGuestAuthCollapsed(true)
                              setActiveView('booking')
                              setKupacMenuOpen(false)
                            }}
                            style={{
                              background: 'transparent',
                              color: 'rgba(245,240,232,.75)',
                              border: '0.5px solid rgba(245,240,232,.18)',
                              padding: '10px 12px',
                              borderRadius: 10,
                              fontSize: 12,
                              cursor: 'pointer',
                            }}
                          >
                            Nastavi kao gost
                          </button>
                        </div>
                      ) : (
                        <div style={{ fontSize: 12, color: 'rgba(245,240,232,.7)', lineHeight: 1.55 }}>
                          <p style={{ marginBottom: 10 }}>Zakazujete kao gost — nije potreban nalog.</p>
                          <button
                            type="button"
                            onClick={() => setGuestAuthCollapsed(false)}
                            style={{
                              background: 'transparent',
                              color: gold,
                              border: `0.5px solid ${goldBorder}`,
                              borderRadius: 10,
                              padding: '8px 12px',
                              fontSize: 12,
                              cursor: 'pointer',
                            }}
                          >
                            Nazad na nalog kupca
                          </button>
                        </div>
                      )}
                    </>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <p style={{ fontSize: 12, color: 'rgba(245,240,232,.65)', lineHeight: 1.5 }}>Prijavljeni ste kao kupac ovog salona.</p>
                      <button
                        type="button"
                        onClick={() => void handleClientLogout()}
                        style={{
                          background: 'transparent',
                          color: 'rgba(245,240,232,.75)',
                          border: '0.5px solid rgba(245,240,232,.2)',
                          padding: '10px 12px',
                          borderRadius: 10,
                          fontSize: 12,
                          cursor: 'pointer',
                        }}
                      >
                        Odjavi se
                      </button>
                    </div>
                  )}
                  {clientAuthSuccess ? (
                    <div style={{ marginTop: 12, background: 'rgba(50,200,100,.1)', border: '0.5px solid rgba(50,200,100,.3)', borderRadius: 10, padding: '8px 10px', fontSize: 11, color: '#4caf81' }}>
                      ✓ {clientAuthSuccess}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
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
                          scrollToPodaci()
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
                setMobileMenuOpen(false)
                otvoriZakazivanjePicker()
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
                scrollToPodaci()
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
                setMobileMenuOpen(false)
                otvoriZakazivanjePicker()
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
        {renderMainColumn()}

        <div style={{ marginTop: '48px', paddingTop: '24px', borderTop: '0.5px solid rgba(212,175,55,.1)', textAlign: 'center' }}>
          <p style={{ fontSize: '12px', color: 'rgba(245,240,232,.2)' }}>
            Powered by <span style={{ color: 'rgba(212,175,55,.5)' }}>SalonPro</span>
          </p>
        </div>
      </div>

      {bookingPickerOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="booking-picker-title"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 200,
            background: 'rgba(0,0,0,.72)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => setBookingPickerOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: 440,
              width: '100%',
              background: '#141414',
              border: `0.5px solid ${goldBorder}`,
              borderRadius: 18,
              padding: '22px 20px',
              maxHeight: '90vh',
              overflowY: 'auto',
            }}
          >
            <h2
              id="booking-picker-title"
              style={{ fontSize: '18px', fontWeight: 600, color: '#f5f0e8', marginBottom: '6px' }}
            >
              Izbor kategorije i usluge
            </h2>
            <p style={{ fontSize: '12px', color: 'rgba(245,240,232,.45)', marginBottom: '16px', lineHeight: 1.5 }}>
              Izaberite kategoriju, zatim uslugu — otvoriće se forma za datum i vreme.
            </p>
            <label
              style={{ fontSize: '10px', color: 'rgba(245,240,232,.45)', display: 'block', marginBottom: '6px' }}
            >
              KATEGORIJA
            </label>
            <select
              value={bookingPickerKategorija}
              onChange={(e) => setBookingPickerKategorija(e.target.value)}
              style={{
                width: '100%',
                marginBottom: '16px',
                padding: '10px 12px',
                borderRadius: 10,
                border: `0.5px solid ${goldBorder}`,
                background: '#1a1a1a',
                color: '#f5f0e8',
                fontSize: '14px',
              }}
            >
              {uslugeKategorije.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <div style={{ fontSize: '11px', color: 'rgba(245,240,232,.4)', marginBottom: '8px' }}>USLUGA</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {uslugeUFokusu.length === 0 ? (
                <p style={{ fontSize: '13px', color: 'rgba(245,240,232,.45)' }}>Nema usluga u ovoj kategoriji.</p>
              ) : (
                uslugeUFokusu.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => izaberiUsluguIzPickera(u)}
                    style={{
                      textAlign: 'left',
                      padding: '12px 14px',
                      borderRadius: 12,
                      border: `0.5px solid ${goldBorder}`,
                      background: '#1a1a1a',
                      color: '#f5f0e8',
                      cursor: 'pointer',
                      fontSize: '14px',
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>{u.naziv}</span>
                    <span style={{ marginLeft: 8, color: gold }}>{Number(u.cijena).toLocaleString()} RSD</span>
                    <div style={{ fontSize: '11px', color: 'rgba(245,240,232,.38)', marginTop: '4px' }}>{u.trajanje} min</div>
                  </button>
                ))
              )}
            </div>
            <button
              type="button"
              onClick={() => setBookingPickerOpen(false)}
              style={{
                marginTop: '16px',
                width: '100%',
                padding: '10px',
                background: 'transparent',
                border: '0.5px solid rgba(245,240,232,.15)',
                color: 'rgba(245,240,232,.55)',
                borderRadius: 10,
                cursor: 'pointer',
                fontSize: '13px',
              }}
            >
              Zatvori
            </button>
          </div>
        </div>
      ) : null}

      {inAppToast && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed',
            zIndex: 100,
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
                    scrollToPodaci()
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