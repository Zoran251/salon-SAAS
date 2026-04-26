'use client'
import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { waitForClientSession } from '@/lib/wait-client-session'
import { buildSalonSlug, fallbackSalonSlug } from '@/lib/slug'
import { getAppRole } from '@/lib/user-role'
import { getPublicSiteBase } from '@/lib/public-site-url'

/** FK na saloni(id) — čest problem kad u bazi nema reda za auth.uid(). */
function formatSalonFkErrorMessage(message: string | undefined): string {
  if (!message) return 'Operacija nije uspjela.'
  const m = message.toLowerCase()
  if (m.includes('foreign key') && (m.includes('salon_id') || m.includes('saloni'))) {
    return (
      'U tabeli saloni nema reda čiji id odgovara vašem nalogu (usluge/lager/termini moraju biti vezani na salon). ' +
      'Dovršite registraciju (/registracija) ili u Supabase SQL Editor dodajte jedan red u public.saloni gdje je id = uuid vlasnika iz Authentication.'
    )
  }
  return message
}

/** Naziv usluge na terminu bez PostgREST embed-a (manje konflikata sa RLS / status kodovima). */
function terminiSaUslugaNazivom(termini: any[] | null, uslugeLista: any[] | null): any[] {
  const map = new Map((uslugeLista || []).map((u: { id: string }) => [u.id, u]))
  return (termini || []).map((t) => ({
    ...t,
    usluge:
      t.usluga_id && map.has(t.usluga_id)
        ? { naziv: (map.get(t.usluga_id) as { naziv?: string | null }).naziv ?? null }
        : null,
  }))
}

const navItems = [
  { id: 'pregled', icon: '🏠', label: 'Pregled' },
  { id: 'profil', icon: '👤', label: 'Profil' },
  { id: 'usluge', icon: '💈', label: 'Usluge' },
  { id: 'lager', icon: '📦', label: 'Lager' },
  { id: 'termini', icon: '📅', label: 'Termini' },
  { id: 'stranica', icon: '🔗', label: 'Moja stranica' },
  { id: 'lojalnost', icon: '🎁', label: 'Lojalnost' },
]

export default function Dashboard() {
  const router = useRouter()
  const [aktivan, setAktivan] = useState('pregled')
  const [ucitavanje, setUcitavanje] = useState(true)
  const [autentifikovan, setAutentifikovan] = useState(false)
  const [salon, setSalon] = useState<any>(null)
  const [usluge, setUsluge] = useState<any[]>([])
  const [lager, setLager] = useState<any[]>([])
  const [termini, setTermini] = useState<any[]>([])
  const [crnaLista, setCrnaLista] = useState<any[]>([])
  const [crnaRučnoTelefon, setCrnaRučnoTelefon] = useState('')
  const [crnaRučnoIme, setCrnaRučnoIme] = useState('')
  const [crnaRučnoLoading, setCrnaRučnoLoading] = useState(false)
  const [crnaRučnoGreska, setCrnaRučnoGreska] = useState('')
  const [lojalnost, setLojalnost] = useState<any>(null)
  const [resolvedSlug, setResolvedSlug] = useState('')
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [qrSvg, setQrSvg] = useState('')
  const [qrLoading, setQrLoading] = useState(false)
  const [qrError, setQrError] = useState('')
  // ...ostatak state-a ostaje isti...
  const [novaUsluga, setNovaUsluga] = useState({ naziv: '', cijena: '', trajanje: '', opis: '' })
  const [noviLager, setNoviLager] = useState({ naziv: '', kategorija: '', kolicina: '', minimum: '', jedinica: 'kom' })
  const [showNovaUsluga, setShowNovaUsluga] = useState(false)
  const [showNoviLager, setShowNoviLager] = useState(false)
  const [uslugaGreska, setUslugaGreska] = useState('')
  const [uslugaLoading, setUslugaLoading] = useState(false)
  const [lagerGreska, setLagerGreska] = useState('')
  const [terminiPotvrdaGreska, setTerminiPotvrdaGreska] = useState('')
  const [sauvano, setSacuvano] = useState('')
  const [profil, setProfil] = useState({
    naziv: '', opis: '', telefon: '', adresa: '', grad: '',
    radno_od: '09:00', radno_do: '20:00', logo: '', boja_primarna: '#d4af37'
  })

  const gold = '#d4af37'
  const goldFaint = 'rgba(212,175,55,.12)'
  const goldBorder = 'rgba(212,175,55,.25)'
  const muted = 'rgba(245,240,232,.45)'
  const text = '#f5f0e8'
  const neprocitaniTermini = termini.filter(t => t.status !== 'potvrđen' && t.status !== 'otkazan').length

  // getSession() pri prvom renderu često vrati null dok Supabase ne učita sesiju iz localStorage.
  // onAuthStateChange + kratki retry sprječavaju lažni redirect na /login nakon uspješne prijave.
  useEffect(() => {
    let cancelled = false
    let loaded = false

    const loadDashboard = async (userId: string) => {
      if (cancelled || loaded) return
      loaded = true
      setAutentifikovan(true)
      await ucitajPodatke(userId)
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return
      if (event === 'SIGNED_OUT') {
        loaded = false
        setAutentifikovan(false)
        router.push('/login')
        return
      }
      if (
        session?.user &&
        (event === 'INITIAL_SESSION' ||
          event === 'SIGNED_IN' ||
          event === 'TOKEN_REFRESHED')
      ) {
        void loadDashboard(session.user.id)
      }
    })

    ;(async () => {
      try {
        const session = await waitForClientSession()
        if (cancelled || loaded) return
        if (session?.user) {
          await loadDashboard(session.user.id)
        } else {
          router.push('/login')
        }
      } catch (err) {
        console.error('Greška pri provjeri autentifikacije:', err)
        if (!cancelled) router.push('/login')
      }
    })()

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [router])

  const ucitajPodatke = async (userId: string) => {
    try {
      setUcitavanje(true)

      // Učitaj salon podatke
      const { data: salonData, error: salonError } = await supabase
        .from('saloni')
        .select('*')
        .eq('id', userId)
        .single()

      if (salonError || !salonData) {
        console.error('Salon nije pronađen:', salonError)
        const { data: userData } = await supabase.auth.getUser()
        const role = getAppRole(userData.user)
        if (role === 'customer') {
          router.replace('/')
          return
        }
        router.push('/registracija')
        return
      }

      let workingSlug = buildSalonSlug(salonData.slug || '')
      if (!workingSlug) {
        const landingPage = typeof salonData.landing_page === 'string' ? salonData.landing_page : ''
        const pathSlug = landingPage.split('/salon/')[1]?.split('?')[0] || ''
        workingSlug = buildSalonSlug(pathSlug) || fallbackSalonSlug(salonData.naziv || userId)

        const { error: slugUpdateError } = await supabase
          .from('saloni')
          .update({ slug: workingSlug })
          .eq('id', userId)

        if (slugUpdateError) {
          console.error('Greška pri automatskom popravku sluga:', slugUpdateError)
        } else {
          console.log('Slug automatski popravljen:', workingSlug)
        }
      }

      console.log('Salon učitan:', salonData.naziv)
      setResolvedSlug(workingSlug)
      setSalon(salonData)
      setProfil({
        naziv: salonData.naziv || '',
        opis: salonData.opis || '',
        telefon: salonData.telefon || '',
        adresa: salonData.adresa || '',
        grad: salonData.grad || '',
        radno_od: salonData.radno_od || '09:00',
        radno_do: salonData.radno_do || '20:00',
        logo: salonData.logo_url || '',
        boja_primarna: salonData.boja_primarna || '#d4af37'
      })

      // Učitaj usluge
      const { data: uslugeData, error: uslugeErr } = await supabase
        .from('usluge')
        .select('*')
        .eq('salon_id', userId)
        .order('created_at', { ascending: true })

      if (uslugeErr) {
        console.error('[dashboard] Usluge:', uslugeErr.message, uslugeErr)
      }
      setUsluge(uslugeData || [])

      // Učitaj lager
      const { data: lagerData, error: lagerErr } = await supabase
        .from('lager')
        .select('*')
        .eq('salon_id', userId)
        .order('created_at', { ascending: true })

      if (lagerErr) {
        console.error('[dashboard] Lager:', lagerErr.message, lagerErr)
      }
      setLager(lagerData || [])

      // Učitaj termine (bez embed usluge — spajamo u memoriji posle učitanih usluga)
      const { data: terminiData, error: terminiErr } = await supabase
        .from('termini')
        .select('*')
        .eq('salon_id', userId)
        .order('datum_vrijeme', { ascending: true })

      if (terminiErr) {
        console.error('[dashboard] Termini:', terminiErr.message, terminiErr)
      }
      setTermini(terminiSaUslugaNazivom(terminiData, uslugeData || []))

      const { data: crnaListaData, error: crnaListaErr } = await supabase
        .from('kupci_crna_lista')
        .select('*, saloni ( naziv )')
        .order('created_at', { ascending: false })
      if (!crnaListaErr) setCrnaLista(crnaListaData || [])

      // Učitaj lojalnost
      const { data: lojalnostData } = await supabase
        .from('lojalnost')
        .select('*')
        .eq('salon_id', userId)
        .single()

      setLojalnost(lojalnostData || { aktivan: false, tip: 'popust', svaki_koji: 5, vrijednost: 20 })

      console.log('Svi podaci učitani uspješno')
    } catch (err) {
      console.error('Greška pri učitavanju podataka:', err)
    } finally {
      setUcitavanje(false)
    }
  }

  useEffect(() => {
    if (!resolvedSlug || typeof window === 'undefined') {
      setQrDataUrl('')
      setQrSvg('')
      setQrError('')
      setQrLoading(false)
      return
    }
    let cancelled = false
    setQrLoading(true)
    setQrError('')
    const fullUrl = `${getPublicSiteBase()}/salon/${resolvedSlug}`

    ;(async () => {
      try {
        const QR = (await import('qrcode')).default
        const [png, svg] = await Promise.all([
          QR.toDataURL(fullUrl, {
            width: 240,
            margin: 2,
            errorCorrectionLevel: 'M',
            color: { dark: '#0a0a0a', light: '#ffffff' },
          }),
          QR.toString(fullUrl, {
            type: 'svg',
            margin: 2,
            color: { dark: '#0a0a0a', light: '#ffffff' },
          }),
        ])
        if (!cancelled) {
          setQrDataUrl(png)
          setQrSvg(svg)
        }
      } catch (e) {
        if (!cancelled) {
          setQrError(e instanceof Error ? e.message : 'QR kod se nije mogao generisati.')
          setQrDataUrl('')
          setQrSvg('')
        }
      } finally {
        if (!cancelled) setQrLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [resolvedSlug])

  const preuzmiQrPng = () => {
    if (!qrDataUrl || !resolvedSlug) return
    const a = document.createElement('a')
    a.href = qrDataUrl
    a.download = `salon-${resolvedSlug}-qr.png`
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  const preuzmiQrSvg = () => {
    if (!qrSvg || !resolvedSlug) return
    const blob = new Blob([qrSvg], { type: 'image/svg+xml;charset=utf-8' })
    const u = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = u
    a.download = `salon-${resolvedSlug}-qr.svg`
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(u)
  }

  const sacuvajProfil = async () => {
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser()

      if (!user || userError) {
        console.error('Greška pri dohvatanju korisnika')
        return
      }

      const updateData = {
        naziv: profil.naziv,
        opis: profil.opis,
        telefon: profil.telefon,
        adresa: profil.adresa,
        grad: profil.grad,
        radno_od: profil.radno_od,
        radno_do: profil.radno_do,
        logo_url: profil.logo,
        boja_primarna: profil.boja_primarna,
      }

      const { error } = await supabase
        .from('saloni')
        .update(updateData)
        .eq('id', user.id)

      if (!error) {
        setSacuvano('profil')
        setTimeout(() => setSacuvano(''), 3000)
        console.log('Profil sačuvan!')
      } else {
        console.error('Greška pri čuvanju:', error)
      }
    } catch (err) {
      console.error('Catch error:', err)
    }
  }

  // ...ostatak funkcija ostaje isti (dodajUslugu, obrisiUslugu, itd.)...
  
  const dodajUslugu = async () => {
    const naziv = novaUsluga.naziv.trim()
    const cijena = parseFloat(novaUsluga.cijena.replace(',', '.'))
    const trajanje = parseInt(novaUsluga.trajanje, 10) || 30

    if (!naziv || Number.isNaN(cijena) || cijena <= 0) {
      setUslugaGreska('Unesi naziv i ispravnu cijenu.')
      return
    }

    setUslugaGreska('')
    setUslugaLoading(true)

    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser()
      if (userError || !user) {
        setUslugaGreska('Sesija je istekla. Prijavi se ponovo.')
        return
      }

      if (!salon?.id) {
        setUslugaGreska('Salon nije učitan. Osvježite stranicu ili ponovo se prijavite.')
        return
      }

      const { data, error } = await supabase.from('usluge').insert({
        salon_id: salon.id,
        naziv,
        cijena,
        trajanje,
        opis: novaUsluga.opis.trim(),
        aktivan: true,
      }).select().single()

      if (error || !data) {
        setUslugaGreska(formatSalonFkErrorMessage(error?.message) || 'Neuspješno dodavanje usluge.')
        return
      }

      setUsluge((prev) => [...prev, data])
      setNovaUsluga({ naziv: '', cijena: '', trajanje: '', opis: '' })
      setShowNovaUsluga(false)
    } catch {
      setUslugaGreska('Došlo je do greške. Pokušaj ponovo.')
    } finally {
      setUslugaLoading(false)
    }
  }

  const obrisiUslugu = async (id: string) => {
    await supabase.from('usluge').delete().eq('id', id)
    setUsluge(usluge.filter(u => u.id !== id))
  }

  const dodajLager = async () => {
    if (!noviLager.naziv || !noviLager.kolicina) return
    setLagerGreska('')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    if (!salon?.id) {
      setLagerGreska('Salon nije učitan. Osvježite stranicu.')
      return
    }
    const kol = parseInt(noviLager.kolicina)
    const min = parseInt(noviLager.minimum) || 0
    const { data, error } = await supabase.from('lager').insert({
      salon_id: salon.id,
      naziv: noviLager.naziv,
      kategorija: noviLager.kategorija || 'Ostalo',
      kolicina: kol,
      minimum: min,
      jedinica: noviLager.jedinica
    }).select().single()
    if (error) {
      setLagerGreska(formatSalonFkErrorMessage(error.message))
      return
    }
    if (data) {
      setLager([...lager, data])
      setNoviLager({ naziv: '', kategorija: '', kolicina: '', minimum: '', jedinica: 'kom' })
      setShowNoviLager(false)
    }
  }

  const obrisiLager = async (id: string) => {
    await supabase.from('lager').delete().eq('id', id)
    setLager(lager.filter(l => l.id !== id))
  }

  const potvrdiTermin = async (id: string) => {
    setTerminiPotvrdaGreska('')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.id) {
      setTerminiPotvrdaGreska('Sesija je istekla. Prijavi se ponovo.')
      return
    }
    const sid = salon?.id ?? user.id
    const { error } = await supabase
      .from('termini')
      .update({ status: 'potvrđen' })
      .eq('id', id)
      .eq('salon_id', sid)
    if (error) {
      setTerminiPotvrdaGreska(formatSalonFkErrorMessage(error.message))
      return
    }
    const { data: refreshed, error: refErr } = await supabase
      .from('termini')
      .select('*')
      .eq('salon_id', sid)
      .order('datum_vrijeme', { ascending: true })
    if (refErr) {
      setTermini(terminiSaUslugaNazivom(termini.map((t) => (t.id === id ? { ...t, status: 'potvrđen' } : t)), usluge))
      return
    }
    if (refreshed) setTermini(terminiSaUslugaNazivom(refreshed, usluge))
  }

  const sacuvajLojalnost = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: existing } = await supabase.from('lojalnost').select('id').eq('salon_id', user.id).single()
    if (existing) {
      await supabase.from('lojalnost').update({ ...lojalnost }).eq('salon_id', user.id)
    } else {
      await supabase.from('lojalnost').insert({ ...lojalnost, salon_id: user.id })
    }
    setSacuvano('lojalnost')
    setTimeout(() => setSacuvano(''), 3000)
  }

  const osveziCrnuListu = async () => {
    const { data, error } = await supabase
      .from('kupci_crna_lista')
      .select('*, saloni ( naziv )')
      .order('created_at', { ascending: false })
    if (!error && data) setCrnaLista(data)
  }

  const dodajNaCrnuListu = async () => {
    setCrnaRučnoGreska('')
    const tel = crnaRučnoTelefon.trim()
    if (!tel) {
      setCrnaRučnoGreska('Unesite broj telefona.')
      return
    }
    setCrnaRučnoLoading(true)
    try {
      const { data, error } = await supabase.rpc('salon_dodaj_kupca_u_crnu_listu', {
        p_telefon: tel,
        p_ime: crnaRučnoIme.trim() || null,
      })
      if (error) {
        setCrnaRučnoGreska(error.message)
        return
      }
      const r = data as { ok?: boolean; error?: string } | null
      if (r && r.ok === false) {
        setCrnaRučnoGreska(r.error || 'Dodavanje nije uspelo.')
        return
      }
      setCrnaRučnoTelefon('')
      setCrnaRučnoIme('')
      await osveziCrnuListu()
    } finally {
      setCrnaRučnoLoading(false)
    }
  }

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      if (file.size > 2 * 1024 * 1024) { alert('Fajl je prevelik! Maksimalno 2MB.'); return }
      const reader = new FileReader()
      reader.onload = ev => setProfil({ ...profil, logo: ev.target?.result as string })
      reader.readAsDataURL(file)
    }
  }

  const handleOdjava = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  // Stiilo definicije
  const inputStyle: React.CSSProperties = {
    outline: 'none', width: '100%', fontSize: '14px', background: '#1a1a1a',
    border: `0.5px solid ${goldBorder}`, color: text, padding: '12px 14px',
    borderRadius: '10px', fontFamily: 'sans-serif'
  }
  const labelStyle: React.CSSProperties = {
    fontSize: '11px', color: muted, display: 'block', marginBottom: '5px', letterSpacing: '.3px'
  }
  const cardStyle: React.CSSProperties = {
    background: '#161616', border: `0.5px solid ${goldBorder}`, borderRadius: '16px', padding: '24px'
  }
  const btnGold: React.CSSProperties = {
    background: `linear-gradient(135deg,${gold},#b8960c)`, color: '#0a0a0a',
    border: 'none', padding: '10px 20px', borderRadius: '10px',
    fontWeight: 600, fontSize: '13px', cursor: 'pointer', fontFamily: 'sans-serif'
  }
  const btnOutline: React.CSSProperties = {
    background: 'transparent', color: muted, border: `0.5px solid ${goldBorder}`,
    padding: '10px 20px', borderRadius: '10px', fontSize: '13px',
    cursor: 'pointer', fontFamily: 'sans-serif'
  }

  // Render funkcije ostaju identične...
  const renderPregled = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: '12px' }}>
        {[
          { label: 'Termini danas', value: termini.filter(t => new Date(t.datum_vrijeme).toDateString() === new Date().toDateString()).length.toString(), icon: '📅' },
          { label: 'Ukupno termina', value: termini.length.toString(), icon: '📋' },
          { label: 'Usluge', value: usluge.length.toString(), icon: '💈' },
          { label: 'Artikala u lageru', value: lager.length.toString(), icon: '📦' },
        ].map((s, i) => (
          <div key={i} style={{ ...cardStyle, textAlign: 'center' }}>
            <div style={{ fontSize: '24px', marginBottom: '8px' }}>{s.icon}</div>
            <div style={{ fontSize: '20px', fontWeight: 500, color: gold, marginBottom: '4px' }}>{s.value}</div>
            <div style={{ fontSize: '11px', color: muted }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={cardStyle}>
        <h3 style={{ fontSize: '15px', fontWeight: 500, color: text, marginBottom: '16px' }}>Nadolazeći termini</h3>
        {termini.length === 0
          ? <p style={{ fontSize: '13px', color: muted }}>Nema zakazanih termina.</p>
          : termini.slice(0, 5).map((t, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: i < 4 ? `0.5px solid rgba(255,255,255,.06)` : 'none', gap: '12px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ width: '44px', height: '44px', background: goldFaint, borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 600, color: gold, flexShrink: 0, textAlign: 'center' }}>
                  {new Date(t.datum_vrijeme).toLocaleTimeString('sr', { hour: '2-digit', minute: '2-digit' })}
                </div>
                <div>
                  <div style={{ fontSize: '14px', color: text, fontWeight: 500 }}>{t.ime_klijenta}</div>
                  <div style={{ fontSize: '12px', color: muted }}>{t.usluge?.naziv || 'Bez usluge'} · {new Date(t.datum_vrijeme).toLocaleDateString('sr')}</div>
                </div>
              </div>
              <div
                style={{
                  fontSize: '11px',
                  padding: '4px 10px',
                  borderRadius: '20px',
                  background:
                    t.status === 'potvrđen'
                      ? 'rgba(50,200,100,.1)'
                      : t.status === 'otkazan'
                        ? 'rgba(200,80,80,.12)'
                        : goldFaint,
                  color: t.status === 'potvrđen' ? '#4caf81' : t.status === 'otkazan' ? '#e07a7a' : gold,
                  border: `0.5px solid ${
                    t.status === 'potvrđen'
                      ? 'rgba(50,200,100,.2)'
                      : t.status === 'otkazan'
                        ? 'rgba(220,100,100,.3)'
                        : goldBorder
                  }`,
                }}
              >
                {t.status}
              </div>
            </div>
          ))
        }
      </div>

      <div style={cardStyle}>
        <h3 style={{ fontSize: '15px', fontWeight: 500, color: text, marginBottom: '12px' }}>⚠️ Upozorenja lagera</h3>
        {lager.filter(l => l.kolicina <= l.minimum).length === 0
          ? <p style={{ fontSize: '13px', color: muted }}>Sve zalihe su uredne ✓</p>
          : lager.filter(l => l.kolicina <= l.minimum).map((l, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', background: 'rgba(220,80,50,.08)', border: '0.5px solid rgba(220,80,50,.2)', borderRadius: '10px', marginBottom: '8px' }}>
              <span style={{ fontSize: '13px', color: '#ff6b6b' }}>⚠️ {l.naziv} — samo {l.kolicina} {l.jedinica} (min: {l.minimum})</span>
            </div>
          ))
        }
      </div>
    </div>
  )

  const renderProfil = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {sauvano === 'profil' && (
        <div style={{ background: 'rgba(50,200,100,.1)', border: '0.5px solid rgba(50,200,100,.3)', borderRadius: '12px', padding: '12px 16px', fontSize: '13px', color: '#4caf81' }}>
          ✓ Profil je uspješno sačuvan!
        </div>
      )}
      <div style={cardStyle}>
        <h3 style={{ fontSize: '15px', fontWeight: 500, color: text, marginBottom: '20px' }}>Logo salona</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap' }}>
          <div style={{ width: '100px', height: '100px', borderRadius: '16px', background: goldFaint, border: `0.5px dashed ${gold}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden', cursor: 'pointer' }}
            onClick={() => document.getElementById('logo-upload')?.click()}>
            {profil.logo
              ? <img src={profil.logo} alt="logo" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '28px', marginBottom: '4px' }}>📷</div>
                <div style={{ fontSize: '10px', color: muted }}>Dodaj logo</div>
              </div>
            }
          </div>
          <div>
            <p style={{ fontSize: '13px', color: muted, lineHeight: 1.7, marginBottom: '12px' }}>
              Preporučena veličina: 400x400px<br />Format: JPG, PNG · Max: 2MB
            </p>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <button style={btnGold} onClick={() => document.getElementById('logo-upload')?.click()}>Učitaj logo</button>
              {profil.logo && <button style={btnOutline} onClick={() => setProfil({ ...profil, logo: '' })}>Ukloni</button>}
            </div>
          </div>
          <input id="logo-upload" type="file" accept="image/*" style={{ display: 'none' }} onChange={handleLogoUpload} />
        </div>
      </div>

      <div style={cardStyle}>
        <h3 style={{ fontSize: '15px', fontWeight: 500, color: text, marginBottom: '20px' }}>Informacije o salonu</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: '14px' }}>
          {[
            { label: 'NAZIV SALONA', key: 'naziv', placeholder: 'Ime vašeg salona' },
            { label: 'TELEFON', key: 'telefon', placeholder: '+381 60 000 000' },
            { label: 'ADRESA', key: 'adresa', placeholder: 'Ulica i broj' },
            { label: 'GRAD', key: 'grad', placeholder: 'Vaš grad' },
          ].map(f => (
            <div key={f.key}>
              <label style={labelStyle}>{f.label}</label>
              <input style={inputStyle} value={(profil as any)[f.key]} placeholder={f.placeholder}
                onChange={e => setProfil({ ...profil, [f.key]: e.target.value })} />
            </div>
          ))}
          <div style={{ gridColumn: '1/-1' }}>
            <label style={labelStyle}>OPIS SALONA</label>
            <textarea style={{ ...inputStyle, height: '80px', resize: 'none' } as React.CSSProperties}
              value={profil.opis} placeholder="Kratki opis vašeg salona..."
              onChange={e => setProfil({ ...profil, opis: e.target.value })} />
          </div>
        </div>
      </div>

      <div style={cardStyle}>
        <h3 style={{ fontSize: '15px', fontWeight: 500, color: text, marginBottom: '20px' }}>Radno vrijeme</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
          <div>
            <label style={labelStyle}>RADI OD</label>
            <input style={inputStyle} type="time" value={profil.radno_od} onChange={e => setProfil({ ...profil, radno_od: e.target.value })} />
          </div>
          <div>
            <label style={labelStyle}>RADI DO</label>
            <input style={inputStyle} type="time" value={profil.radno_do} onChange={e => setProfil({ ...profil, radno_do: e.target.value })} />
          </div>
        </div>
      </div>

      <button style={{...btnGold, padding:'14px', borderRadius:'12px', fontSize:'14px', width:'100%'}} onClick={sacuvajProfil}>
        Sačuvaj izmjene ✓
      </button>
    </div>
  )

  const renderUsluge = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {usluge.length === 0 && !showNovaUsluga && (
        <div style={{ ...cardStyle, textAlign: 'center', padding: '40px' }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>💈</div>
          <p style={{ fontSize: '14px', color: muted, marginBottom: '16px' }}>Još nemaš dodanih usluga.</p>
        </div>
      )}
      {usluge.map(u => (
        <div key={u.id} style={{ ...cardStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div style={{ width: '42px', height: '42px', background: goldFaint, borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', flexShrink: 0 }}>💈</div>
            <div>
              <div style={{ fontSize: '15px', fontWeight: 500, color: text }}>{u.naziv}</div>
              <div style={{ fontSize: '12px', color: muted }}>
                {u.trajanje} min · {Number(u.cijena).toLocaleString()} RSD
              </div>
              {u.opis && <div style={{ fontSize: '11px', color: 'rgba(245,240,232,.3)', marginTop: '2px' }}>{u.opis}</div>}
            </div>
          </div>
          <button style={btnOutline} onClick={() => obrisiUslugu(u.id)}>Obriši</button>
        </div>
      ))}
      {showNovaUsluga ? (
        <div style={cardStyle}>
          <h3 style={{ fontSize: '14px', fontWeight: 500, color: text, marginBottom: '16px' }}>Nova usluga</h3>
          {uslugaGreska && (
            <div style={{ background: 'rgba(220,50,50,.1)', border: '0.5px solid rgba(220,50,50,.3)', borderRadius: '10px', padding: '10px 12px', marginBottom: '12px', fontSize: '12px', color: '#ff6b6b' }}>
              ⚠️ {uslugaGreska}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: '12px', marginBottom: '14px' }}>
            <div><label style={labelStyle}>NAZIV</label><input style={inputStyle} placeholder="Šišanje" value={novaUsluga.naziv} onChange={e => setNovaUsluga({ ...novaUsluga, naziv: e.target.value })} /></div>
            <div><label style={labelStyle}>CIJENA (RSD)</label><input style={inputStyle} placeholder="1500" value={novaUsluga.cijena} onChange={e => setNovaUsluga({ ...novaUsluga, cijena: e.target.value })} /></div>
            <div><label style={labelStyle}>TRAJANJE (min)</label><input style={inputStyle} placeholder="45" value={novaUsluga.trajanje} onChange={e => setNovaUsluga({ ...novaUsluga, trajanje: e.target.value })} /></div>
            <div style={{ gridColumn: '1/-1' }}><label style={labelStyle}>OPIS (opciono)</label><input style={inputStyle} placeholder="Kratki opis usluge" value={novaUsluga.opis} onChange={e => setNovaUsluga({ ...novaUsluga, opis: e.target.value })} /></div>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button style={btnGold} disabled={uslugaLoading} onClick={dodajUslugu}>{uslugaLoading ? 'Dodavanje...' : 'Dodaj uslugu'}</button>
            <button style={btnOutline} onClick={() => { setShowNovaUsluga(false); setUslugaGreska('') }}>Odustani</button>
          </div>
        </div>
      ) : (
        <button style={{ ...btnGold, padding: '14px', borderRadius: '12px', fontSize: '14px', width: '100%' }} onClick={() => { setShowNovaUsluga(true); setUslugaGreska('') }}>
          + Dodaj novu uslugu
        </button>
      )}
    </div>
  )

  const renderLager = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {lager.length === 0 && !showNoviLager && (
        <div style={{ ...cardStyle, textAlign: 'center', padding: '40px' }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>📦</div>
          <p style={{ fontSize: '14px', color: muted }}>Lager je prazan. Dodaj prvi artikal.</p>
        </div>
      )}
      {lager.map(l => (
        <div key={l.id} style={{ ...cardStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', borderColor: l.kolicina <= l.minimum ? 'rgba(220,80,50,.3)' : goldBorder }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div style={{ width: '42px', height: '42px', background: l.kolicina <= l.minimum ? 'rgba(220,80,50,.1)' : goldFaint, borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', flexShrink: 0 }}>
              {l.kolicina <= l.minimum ? '⚠️' : '📦'}
            </div>
            <div>
              <div style={{ fontSize: '15px', fontWeight: 500, color: text }}>{l.naziv}</div>
              <div style={{ fontSize: '12px', color: muted }}>{l.kategorija} · Min: {l.minimum} {l.jedinica}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '20px', fontWeight: 500, color: l.kolicina <= l.minimum ? '#ff6b6b' : gold }}>{l.kolicina}</div>
              <div style={{ fontSize: '11px', color: muted }}>{l.jedinica}</div>
            </div>
            <button style={btnOutline} onClick={() => obrisiLager(l.id)}>Obriši</button>
          </div>
        </div>
      ))}
      {showNoviLager ? (
        <div style={cardStyle}>
          <h3 style={{ fontSize: '14px', fontWeight: 500, color: text, marginBottom: '16px' }}>Novi artikal</h3>
          {lagerGreska && (
            <div style={{ background: 'rgba(220,50,50,.1)', border: '0.5px solid rgba(220,50,50,.3)', borderRadius: '10px', padding: '10px 12px', marginBottom: '12px', fontSize: '12px', color: '#ff6b6b' }}>
              ⚠️ {lagerGreska}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: '12px', marginBottom: '14px' }}>
            <div><label style={labelStyle}>NAZIV</label><input style={inputStyle} placeholder="Farba #5" value={noviLager.naziv} onChange={e => setNoviLager({ ...noviLager, naziv: e.target.value })} /></div>
            <div><label style={labelStyle}>KATEGORIJA</label><input style={inputStyle} placeholder="Boje" value={noviLager.kategorija} onChange={e => setNoviLager({ ...noviLager, kategorija: e.target.value })} /></div>
            <div><label style={labelStyle}>KOLIČINA</label><input style={inputStyle} placeholder="10" value={noviLager.kolicina} onChange={e => setNoviLager({ ...noviLager, kolicina: e.target.value })} /></div>
            <div><label style={labelStyle}>MINIMUM</label><input style={inputStyle} placeholder="5" value={noviLager.minimum} onChange={e => setNoviLager({ ...noviLager, minimum: e.target.value })} /></div>
            <div>
              <label style={labelStyle}>JEDINICA</label>
              <select style={inputStyle} value={noviLager.jedinica} onChange={e => setNoviLager({ ...noviLager, jedinica: e.target.value })}>
                {['kom', 'L', 'ml', 'kg', 'g', 'pakovanje'].map(j => <option key={j} value={j}>{j}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button style={btnGold} onClick={dodajLager}>Dodaj artikal</button>
            <button style={btnOutline} onClick={() => { setShowNoviLager(false); setLagerGreska('') }}>Odustani</button>
          </div>
        </div>
      ) : (
        <button
          style={{ ...btnGold, padding: '14px', borderRadius: '12px', fontSize: '14px', width: '100%' }}
          onClick={() => {
            setShowNoviLager(true)
            setLagerGreska('')
          }}
        >
          + Dodaj artikal u lager
        </button>
      )}
    </div>
  )

  const renderTermini = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div style={cardStyle}>
        <h3 style={{ fontSize: '15px', fontWeight: 500, color: text, marginBottom: '16px' }}>Svi termini</h3>
        {terminiPotvrdaGreska && (
          <div style={{ background: 'rgba(220,50,50,.1)', border: '0.5px solid rgba(220,50,50,.3)', borderRadius: '10px', padding: '10px 12px', marginBottom: '14px', fontSize: '12px', color: '#ff6b6b' }}>
            ⚠️ {terminiPotvrdaGreska}
          </div>
        )}
        {termini.length === 0
          ? <p style={{ fontSize: '13px', color: muted }}>Nema zakazanih termina.</p>
          : termini.map((t, i) => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0', borderBottom: i < termini.length - 1 ? `0.5px solid rgba(255,255,255,.06)` : 'none', gap: '12px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ width: '44px', height: '44px', background: goldFaint, borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: '11px', fontWeight: 600, color: gold, textAlign: 'center' }}>
                  {new Date(t.datum_vrijeme).toLocaleTimeString('sr', { hour: '2-digit', minute: '2-digit' })}
                </div>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 500, color: text }}>{t.ime_klijenta}</div>
                  <div style={{ fontSize: '12px', color: muted }}>{t.usluge?.naziv || 'Bez usluge'} · {new Date(t.datum_vrijeme).toLocaleDateString('sr')}</div>
                  <div style={{ fontSize: '11px', color: 'rgba(245,240,232,.3)' }}>{t.telefon_klijenta}</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <div
                  style={{
                    fontSize: '11px',
                    padding: '4px 10px',
                    borderRadius: '20px',
                    background:
                      t.status === 'potvrđen'
                        ? 'rgba(50,200,100,.1)'
                        : t.status === 'otkazan'
                          ? 'rgba(200,80,80,.12)'
                          : goldFaint,
                    color: t.status === 'potvrđen' ? '#4caf81' : t.status === 'otkazan' ? '#e07a7a' : gold,
                    border: `0.5px solid ${
                      t.status === 'potvrđen'
                        ? 'rgba(50,200,100,.2)'
                        : t.status === 'otkazan'
                          ? 'rgba(220,100,100,.3)'
                          : goldBorder
                    }`,
                  }}
                >
                  {t.status}
                </div>
                {t.status !== 'potvrđen' && t.status !== 'otkazan' && <button style={btnGold} onClick={() => potvrdiTermin(t.id)}>Potvrdi</button>}
              </div>
            </div>
          ))
        }
      </div>
    </div>
  )

  const renderStranica = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={cardStyle}>
        <h3 style={{ fontSize: '15px', fontWeight: 500, color: text, marginBottom: '16px' }}>Tvoja landing page</h3>
        <div style={{ background: goldFaint, border: `0.5px solid ${goldBorder}`, borderRadius: '12px', padding: '16px', marginBottom: '16px' }}>
          <div style={{ fontSize: '11px', color: muted, marginBottom: '6px' }}>TVOJ LINK</div>
          <div style={{ fontSize: '15px', color: gold, fontWeight: 500, wordBreak: 'break-all' }}>
            {getPublicSiteBase() || '…'}/salon/{resolvedSlug}
          </div>
          {!process.env.NEXT_PUBLIC_SITE_URL?.trim() && typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? (
            <p style={{ fontSize: 11, color: 'rgba(245,240,232,.35)', marginTop: 8, lineHeight: 1.45 }}>
              Lokalni prikaz: QR i kopirani link koriste localhost. Za produkciju dodaj u Vercel (ili .env.local) varijablu{' '}
              <code style={{ color: gold }}>NEXT_PUBLIC_SITE_URL</code> punim URL-om salona (npr. https://app.vercel.app).
            </p>
          ) : null}
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button
            style={btnGold}
            disabled={!resolvedSlug}
            onClick={() => navigator.clipboard.writeText(`${getPublicSiteBase()}/salon/${resolvedSlug}`)}
          >
            Kopiraj link
          </button>
          <a href={`/salon/${resolvedSlug}`} target="_blank" rel="noreferrer" style={{ ...btnOutline, textDecoration: 'none', display: 'inline-block', pointerEvents: resolvedSlug ? 'auto' : 'none', opacity: resolvedSlug ? 1 : 0.5 }}>
            Otvori stranicu →
          </a>
        </div>
      </div>
      <div style={cardStyle}>
        <h3 style={{ fontSize: '15px', fontWeight: 500, color: text, marginBottom: '16px' }}>QR kod</h3>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '24px', flexWrap: 'wrap' }}>
          <div
            style={{
              width: 132,
              height: 132,
              flexShrink: 0,
              background: '#fff',
              borderRadius: 12,
              padding: 6,
              border: `0.5px solid ${goldBorder}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {qrLoading ? (
              <span style={{ fontSize: 12, color: muted }}>Generisanje…</span>
            ) : qrError ? (
              <span style={{ fontSize: 11, color: '#ff8a8a', textAlign: 'center', padding: 4 }}>{qrError}</span>
            ) : qrDataUrl ? (
              <img src={qrDataUrl} alt={`QR kod za ${resolvedSlug}`} width={120} height={120} style={{ display: 'block' }} />
            ) : (
              <span style={{ fontSize: 12, color: muted }}>Nema sluga</span>
            )}
          </div>
          <div style={{ minWidth: 0, flex: '1 1 200px' }}>
            <p style={{ fontSize: '13px', color: muted, lineHeight: 1.7, marginBottom: '14px' }}>
              Odštampaj QR kod i postavi ga u salon.<br />
              Klijenti skeniranjem dolaze na tvoju stranicu (isti link kao gore).
            </p>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <button type="button" style={btnGold} disabled={!qrDataUrl || qrLoading} onClick={preuzmiQrPng}>
                Preuzmi PNG
              </button>
              <button type="button" style={btnOutline} disabled={!qrSvg || qrLoading} onClick={preuzmiQrSvg}>
                Preuzmi SVG
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  const renderLojalnost = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {sauvano === 'lojalnost' && (
        <div style={{ background: 'rgba(50,200,100,.1)', border: '0.5px solid rgba(50,200,100,.3)', borderRadius: '12px', padding: '12px 16px', fontSize: '13px', color: '#4caf81' }}>
          ✓ Program lojalnosti je sačuvan!
        </div>
      )}
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '12px' }}>
          <h3 style={{ fontSize: '15px', fontWeight: 500, color: text }}>Program lojalnosti</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '13px', color: muted }}>{lojalnost?.aktivan ? 'Aktivan' : 'Neaktivan'}</span>
            <div style={{ width: '44px', height: '24px', borderRadius: '12px', background: lojalnost?.aktivan ? `linear-gradient(135deg,${gold},#b8960c)` : 'rgba(255,255,255,.1)', cursor: 'pointer', position: 'relative', transition: 'all .3s' }}
              onClick={() => setLojalnost({ ...lojalnost, aktivan: !lojalnost?.aktivan })}>
              <div style={{ position: 'absolute', top: '3px', left: lojalnost?.aktivan ? '23px' : '3px', width: '18px', height: '18px', borderRadius: '50%', background: 'white', transition: 'left .3s' }} />
            </div>
          </div>
        </div>
        <p style={{ fontSize: '12px', color: muted, lineHeight: 1.55, marginBottom: '18px' }}>
          Kupac jednim nalogom može ići kod više salona; kod vas se lojalnost računa samo za termine ovde — u drugom salonu ima poseban brojač.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: '14px', marginBottom: '20px' }}>
          <div>
            <label style={labelStyle}>TIP NAGRADE</label>
            <select style={inputStyle} value={lojalnost?.tip} onChange={e => setLojalnost({ ...lojalnost, tip: e.target.value })}>
              <option value="popust">Popust (%)</option>
              <option value="vaučer">Vaučer (RSD)</option>
              <option value="besplatna">Besplatna usluga</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>{lojalnost?.tip === 'popust' ? 'POPUST (%)' : lojalnost?.tip === 'vaučer' ? 'VRIJEDNOST (RSD)' : 'NAZIV USLUGE'}</label>
            <input style={inputStyle} value={lojalnost?.vrijednost}
              onChange={e => setLojalnost({ ...lojalnost, vrijednost: parseInt(e.target.value) || 0 })}
              placeholder={lojalnost?.tip === 'popust' ? '20' : '500'} />
          </div>
          <div>
            <label style={labelStyle}>SVAKI KOJI DOLAZAK</label>
            <input style={inputStyle} type="number" min="2" max="20" value={lojalnost?.svaki_koji}
              onChange={e => setLojalnost({ ...lojalnost, svaki_koji: parseInt(e.target.value) || 5 })} />
          </div>
        </div>
        <div style={{ background: goldFaint, border: `0.5px solid ${goldBorder}`, borderRadius: '12px', padding: '16px', marginBottom: '20px' }}>
          <div style={{ fontSize: '11px', color: muted, marginBottom: '6px' }}>PREGLED PROGRAMA</div>
          <div style={{ fontSize: '15px', color: gold, fontWeight: 500 }}>
            Svaki {lojalnost?.svaki_koji}. dolazak → {lojalnost?.tip === 'popust' ? `${lojalnost?.vrijednost}% popusta` : lojalnost?.tip === 'vaučer' ? `vaučer ${lojalnost?.vrijednost} RSD` : 'besplatna usluga'}
          </div>
        </div>
        <button style={{ ...btnGold, padding: '14px', borderRadius: '12px', fontSize: '14px', width: '100%' }} onClick={sacuvajLojalnost}>
          Sačuvaj program lojalnosti ✓
        </button>
      </div>
      <div
        style={{
          ...cardStyle,
          border: '0.5px solid rgba(200,80,80,.35)',
          background: crnaLista.length > 0 ? 'rgba(200,40,40,.06)' : 'rgba(255,255,255,.02)',
        }}
      >
        <h3 style={{ fontSize: '15px', fontWeight: 500, color: crnaLista.length > 0 ? '#e8a0a0' : text, marginBottom: '10px' }}>
          Crna lista kupaca
        </h3>
        <p style={{ fontSize: '12px', color: muted, marginBottom: '14px', lineHeight: 1.55 }}>
          Prikaz je isti za sve salone u aplikaciji. Zakazivanje je blokirano za brojeve na listi. Ručno možete dodati samo klijenta koji je već kod vas u bazi (isti telefon kao kod zakazivanja).
        </p>
        <div style={{ marginBottom: '18px', paddingBottom: '18px', borderBottom: '0.5px solid rgba(255,255,255,.08)' }}>
          <div style={{ fontSize: '12px', fontWeight: 500, color: text, marginBottom: '10px' }}>Dodaj svog klijenta ručno</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: '12px', marginBottom: '12px' }}>
            <div>
              <label style={labelStyle}>TELEFON</label>
              <input
                style={inputStyle}
                placeholder="npr. 064 123 4567"
                value={crnaRučnoTelefon}
                onChange={(e) => { setCrnaRučnoTelefon(e.target.value); setCrnaRučnoGreska('') }}
              />
            </div>
            <div>
              <label style={labelStyle}>IME (opciono)</label>
              <input
                style={inputStyle}
                placeholder="Marko Marković"
                value={crnaRučnoIme}
                onChange={(e) => { setCrnaRučnoIme(e.target.value); setCrnaRučnoGreska('') }}
              />
            </div>
          </div>
          {crnaRučnoGreska ? (
            <p style={{ fontSize: '12px', color: '#ff8a8a', marginBottom: '10px' }}>{crnaRučnoGreska}</p>
          ) : null}
          <button
            type="button"
            style={{ ...btnGold, padding: '12px 18px', fontSize: '13px' }}
            disabled={crnaRučnoLoading}
            onClick={() => void dodajNaCrnuListu()}
          >
            {crnaRučnoLoading ? 'Dodavanje…' : 'Dodaj na crnu listu'}
          </button>
        </div>
        {crnaLista.length === 0 ? (
          <p style={{ fontSize: '13px', color: 'rgba(245,240,232,.35)', fontStyle: 'italic' }}>Trenutno nema unosa na crnoj listi.</p>
        ) : (
          crnaLista.map((r, idx) => (
            <div
              key={r.id}
              style={{
                padding: '12px 0',
                borderBottom: idx < crnaLista.length - 1 ? '0.5px solid rgba(255,255,255,.06)' : 'none',
              }}
            >
              <div style={{ fontSize: '14px', fontWeight: 500, color: text }}>{r.ime || '—'}</div>
              <div style={{ fontSize: '12px', color: muted }}>{r.telefon}</div>
              <div style={{ fontSize: '11px', color: 'rgba(245,240,232,.32)', marginTop: '4px' }}>
                {r.razlog === 'salon_rucno'
                  ? `Ručno · ${r.saloni?.naziv?.trim() || 'Nepoznat salon'}`
                  : r.razlog === 'kasno_otkazivanje'
                    ? `Kasno otkazivanje${r.saloni?.naziv ? ` · ${r.saloni.naziv}` : ''}`
                    : r.razlog}
                {' · '}
                {new Date(r.created_at).toLocaleString('sr')}
                {typeof r.minuta_pre_otkazivanja === 'number' ? ` · ~${r.minuta_pre_otkazivanja} min pre termina` : ''}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )

  const sections: Record<string, () => React.ReactElement> = {
    pregled: renderPregled, profil: renderProfil, usluge: renderUsluge,
    lager: renderLager, termini: renderTermini, stranica: renderStranica, lojalnost: renderLojalnost
  }

  // Ako nije autentifikovan - loading screen
  if (!autentifikovan || ucitavanje) return (
    <div style={{ background: '#0a0a0a', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: '40px', height: '40px', border: '2px solid rgba(212,175,55,.2)', borderTop: '2px solid #d4af37', borderRadius: '50%', animation: 'spin .8s linear infinite', margin: '0 auto 16px' }} />
        <p style={{ color: 'rgba(245,240,232,.4)', fontFamily: 'sans-serif', fontSize: '14px' }}>Učitavanje...</p>
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  return (
    <div style={{ background: '#0a0a0a', minHeight: '100vh', color: '#f5f0e8', fontFamily: 'sans-serif', display: 'flex', flexDirection: 'column' }}>
      <style>{`
        @keyframes shimmer{0%{background-position:-200% center}100%{background-position:200% center}}
        @keyframes spin{to{transform:rotate(360deg)}}
        *{box-sizing:border-box;margin:0;padding:0}
        input,select,textarea{outline:none;font-family:sans-serif;color:#f5f0e8}
        input:focus,select:focus,textarea:focus{border-color:rgba(212,175,55,.6)!important}
        select option{background:#1a1a1a;color:#f5f0e8}
        .nav-item{cursor:pointer;display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:10px;transition:all .2s;font-size:14px;color:rgba(245,240,232,.5);border:0.5px solid transparent}
        .nav-item:hover{background:rgba(212,175,55,.06);color:rgba(245,240,232,.8)}
        .nav-item.active{background:rgba(212,175,55,.12);color:#d4af37;border-color:rgba(212,175,55,.2)}
        .tab-item{cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:3px;padding:6px 2px;flex:1;font-size:9px;color:rgba(245,240,232,.4);transition:color .2s;text-align:center}
        .tab-item.active{color:#d4af37}
        @media(min-width:769px){.mobile-tabs{display:none!important}}
        @media(max-width:768px){
          .sidebar{display:none!important}
          .mobile-tabs{display:flex!important}
          .dash-content{padding:16px!important;padding-bottom:90px!important}
        }
      `}</style>

      <nav style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 24px', borderBottom: '0.5px solid rgba(212,175,55,.2)', background: 'rgba(10,10,10,.97)', position: 'sticky', top: 0, zIndex: 100 }}>
        <Link href="/" style={{ fontSize: '20px', fontWeight: 500, background: 'linear-gradient(90deg,#d4af37,#f5e17a,#d4af37)', backgroundSize: '200% auto', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', animation: 'shimmer 3s linear infinite', textDecoration: 'none' }}>
          SalonPro
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            onClick={() => setAktivan('termini')}
            style={{ width: '36px', height: '36px', borderRadius: '50%', border: `0.5px solid ${goldBorder}`, background: '#111', color: text, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', position: 'relative' }}
            title="Notifikacije termina"
          >
            🔔
            {neprocitaniTermini > 0 && (
              <span style={{ position: 'absolute', top: '-4px', right: '-4px', minWidth: '18px', height: '18px', borderRadius: '9px', background: '#d4af37', color: '#0a0a0a', fontSize: '10px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>
                {neprocitaniTermini}
              </span>
            )}
          </button>
          {profil.logo && <img src={profil.logo} alt="logo" style={{ width: '28px', height: '28px', borderRadius: '50%', objectFit: 'cover' }} />}
          <span style={{ fontSize: '13px', color: muted }}>{salon?.naziv}</span>
          <div style={{ width: '36px', height: '36px', background: `linear-gradient(135deg,${gold},#b8960c)`, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: 600, color: '#0a0a0a', cursor: 'pointer', flexShrink: 0 }}>
            {salon?.naziv?.charAt(0)}
          </div>
        </div>
      </nav>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <aside className="sidebar" style={{ width: '220px', borderRight: '0.5px solid rgba(212,175,55,.15)', padding: '20px 12px', display: 'flex', flexDirection: 'column', gap: '4px', position: 'sticky', top: '57px', height: 'calc(100vh - 57px)', overflowY: 'auto', flexShrink: 0 }}>
          {navItems.map(item => (
            <div key={item.id} className={`nav-item${aktivan === item.id ? ' active' : ''}`} onClick={() => setAktivan(item.id)}>
              <span style={{ fontSize: '16px' }}>{item.icon}</span>
              {item.label}
            </div>
          ))}
          <div style={{ flex: 1 }} />
          <div style={{ padding: '10px 14px', borderRadius: '10px', background: 'rgba(212,175,55,.06)', border: '0.5px solid rgba(212,175,55,.15)', marginTop: '12px' }}>
            <div style={{ fontSize: '11px', color: muted, marginBottom: '4px' }}>PLAN</div>
            <div style={{ fontSize: '13px', color: gold, fontWeight: 500 }}>Pro · $19.99/mes</div>
          </div>
          <button onClick={handleOdjava} style={{ background: 'none', border: 'none', color: muted, fontSize: '12px', cursor: 'pointer', padding: '10px', marginTop: '8px', fontFamily: 'sans-serif' }}>
            Odjavi se
          </button>
        </aside>

        <main className="dash-content" style={{ flex: 1, padding: '28px', overflowY: 'auto', paddingBottom: '80px' }}>
          <div style={{ marginBottom: '24px' }}>
            <h1 style={{ fontSize: '22px', fontWeight: 500, color: text, marginBottom: '4px' }}>
              {navItems.find(n => n.id === aktivan)?.icon} {navItems.find(n => n.id === aktivan)?.label}
            </h1>
            <p style={{ fontSize: '13px', color: muted }}>{salon?.naziv} · {salon?.tip}</p>
          </div>
          {sections[aktivan]?.()}
        </main>
      </div>

      <div className="mobile-tabs" style={{ display: 'none', position: 'fixed', bottom: 0, left: 0, right: 0, background: '#111', borderTop: '0.5px solid rgba(212,175,55,.2)', zIndex: 100, padding: '4px 0' }}>
        {navItems.map(item => (
          <div key={item.id} className={`tab-item${aktivan === item.id ? ' active' : ''}`} onClick={() => setAktivan(item.id)}>
            <span style={{ fontSize: '18px' }}>{item.icon}</span>
            <span>{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}