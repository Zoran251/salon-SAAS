# salon-saas

SaaS za salone: **dashboard za vlasnika** (termini, usluge, lager, lojalnost, crna lista, javna stranica) i **javni portal** po salonu (`/salon/[slug]`) sa zakazivanjem, nalogom kupca, obaveštenjima i lojalnošću po salonu.

## Dokumentacija stanja

**[STANJE_PROJEKTA.md](./STANJE_PROJEKTA.md)** — šta je implementirano, šta je u planu, migracije, API rute, okruženje.

## Zahtevi

- **Node** (LTS), **npm**
- **Supabase** projekat — primeni SQL migracije iz `db/migrations/` (redosled po datumu u imenu fajla).

## Varijable okruženja

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (ili `SUPABASE_URL` / `SUPABASE_ANON_KEY`)
- `SUPABASE_SERVICE_ROLE_KEY` — server (npr. `POST /api/termini`, RPC); preporučeno za produkciju

## Razvoj

```bash
npm install
npm run dev
```

- Početna: [http://localhost:3000](http://localhost:3000)
- Dashboard: `/dashboard` (nakon prijave vlasnika)
- Javni salon: `/salon/<slug>`
- Kupac: `/kupac/prijava`, `/kupac/registracija`

## Ostalo

- Pravila za AI / Next: `AGENTS.md`, `CLAUDE.md`
- Lint: `npm run lint`
