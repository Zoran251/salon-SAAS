-- Osnovne tabele salona (saloni, usluge, lager, termini, lojalnost) + RLS.
-- Mora postojati PRIJE 2026-04-14_client_portal.sql (FK na saloni).
-- Idempotentno: IF NOT EXISTS / DROP POLICY IF EXISTS.

begin;

-- ---------------------------------------------------------------------------
-- Tabele
-- ---------------------------------------------------------------------------
create table if not exists public.saloni (
  id uuid primary key,
  naziv text not null,
  slug text unique,
  email text not null,
  telefon text,
  grad text,
  tip text,
  aktivan boolean default true,
  opis text,
  adresa text,
  radno_od text,
  radno_do text,
  logo_url text,
  boja_primarna text,
  landing_page text,
  created_at timestamptz default now()
);

create table if not exists public.usluge (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.saloni (id) on delete cascade,
  naziv text not null,
  cijena numeric not null default 0,
  trajanje integer,
  opis text,
  kategorija text,
  aktivan boolean default true,
  created_at timestamptz default now()
);

create index if not exists usluge_salon_id_idx on public.usluge (salon_id);

create table if not exists public.lager (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.saloni (id) on delete cascade,
  naziv text not null,
  kategorija text,
  kolicina numeric not null default 0,
  minimum numeric not null default 0,
  jedinica text,
  created_at timestamptz default now()
);

create index if not exists lager_salon_id_idx on public.lager (salon_id);

create table if not exists public.termini (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.saloni (id) on delete cascade,
  usluga_id uuid references public.usluge (id) on delete set null,
  ime_klijenta text not null,
  telefon_klijenta text not null,
  datum_vrijeme timestamptz not null,
  napomena text,
  status text default 'ceka',
  created_at timestamptz default now()
);

create index if not exists termini_salon_id_idx on public.termini (salon_id);
create index if not exists termini_datum_idx on public.termini (datum_vrijeme);

create table if not exists public.lojalnost (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.saloni (id) on delete cascade,
  aktivan boolean not null default false,
  tip text not null default 'popust',
  svaki_koji integer not null default 5,
  vrijednost numeric not null default 0,
  created_at timestamptz default now(),
  unique (salon_id)
);

create index if not exists lojalnost_salon_id_idx on public.lojalnost (salon_id);

-- ---------------------------------------------------------------------------
-- RLS: javna stranica (anon) čita aktivan salon / usluge / lojalnost;
-- vlasnik (authenticated, id = saloni.id) upravlja svojim redovima.
-- ---------------------------------------------------------------------------
alter table public.saloni enable row level security;
alter table public.usluge enable row level security;
alter table public.lager enable row level security;
alter table public.termini enable row level security;
alter table public.lojalnost enable row level security;

drop policy if exists saloni_public_read on public.saloni;
create policy saloni_public_read
on public.saloni
for select
to anon, authenticated
using (coalesce(aktivan, true));

drop policy if exists saloni_owner_insert on public.saloni;
create policy saloni_owner_insert
on public.saloni
for insert
to authenticated
with check (id = auth.uid());

drop policy if exists saloni_owner_update on public.saloni;
create policy saloni_owner_update
on public.saloni
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists usluge_public_read on public.usluge;
create policy usluge_public_read
on public.usluge
for select
to anon, authenticated
using (
  exists (
    select 1 from public.saloni s
    where s.id = usluge.salon_id and coalesce(s.aktivan, true)
  )
);

drop policy if exists usluge_owner_all on public.usluge;
create policy usluge_owner_all
on public.usluge
for all
to authenticated
using (salon_id = auth.uid())
with check (salon_id = auth.uid());

drop policy if exists lager_owner_all on public.lager;
create policy lager_owner_all
on public.lager
for all
to authenticated
using (salon_id = auth.uid())
with check (salon_id = auth.uid());

drop policy if exists termini_owner_all on public.termini;
create policy termini_owner_all
on public.termini
for all
to authenticated
using (salon_id = auth.uid())
with check (salon_id = auth.uid());

drop policy if exists lojalnost_public_read on public.lojalnost;
create policy lojalnost_public_read
on public.lojalnost
for select
to anon, authenticated
using (
  exists (
    select 1 from public.saloni s
    where s.id = lojalnost.salon_id and coalesce(s.aktivan, true)
  )
);

drop policy if exists lojalnost_owner_all on public.lojalnost;
create policy lojalnost_owner_all
on public.lojalnost
for all
to authenticated
using (salon_id = auth.uid())
with check (salon_id = auth.uid());

commit;
