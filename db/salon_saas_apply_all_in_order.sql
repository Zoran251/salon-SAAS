-- salon_saas_apply_all_in_order.sql — spojene migracije (bez test seed 04-26). Pokreni u Supabase SQL Editor posle backup-a.


-- ========== 2026-03-01_core_salon_tables.sql ==========
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
-- RLS: javna stranica (anon) ÄŤita aktivan salon / usluge / lojalnost;
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


-- ========== 2026-04-14_client_portal.sql ==========
-- Client portal foundation for per-salon customer accounts, loyalty progress,
-- and appointment notifications.
-- Safe to run multiple times (uses IF NOT EXISTS where possible).

begin;

-- 1) Customer profiles bound to a single salon
create table if not exists public.salon_clients (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.saloni(id) on delete cascade,
  auth_user_id uuid null,
  ime text not null,
  telefon text not null,
  email text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists salon_clients_salon_phone_uq
  on public.salon_clients (salon_id, telefon);

create unique index if not exists salon_clients_salon_auth_uq
  on public.salon_clients (salon_id, auth_user_id)
  where auth_user_id is not null;

-- 2) Connect appointments to clients
alter table public.termini
  add column if not exists client_id uuid null references public.salon_clients(id) on delete set null;

create index if not exists termini_client_id_idx on public.termini(client_id);

-- 3) Loyalty progress per client (works with existing lojalnost salon settings)
create table if not exists public.loyalty_accounts (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.saloni(id) on delete cascade,
  client_id uuid not null references public.salon_clients(id) on delete cascade,
  visits_count integer not null default 0,
  progress_percent integer not null default 0 check (progress_percent >= 0 and progress_percent <= 100),
  reward_ready boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (salon_id, client_id)
);

-- 4) Notification inbox for clients
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.saloni(id) on delete cascade,
  client_id uuid not null references public.salon_clients(id) on delete cascade,
  tip text not null check (tip in ('appointment_created', 'appointment_confirmed', 'appointment_cancelled', 'loyalty_reward_ready')),
  title text not null,
  body text not null,
  appointment_id uuid null references public.termini(id) on delete set null,
  read_at timestamptz null,
  created_at timestamptz not null default now()
);

create index if not exists notifications_client_created_idx
  on public.notifications (client_id, created_at desc);

create index if not exists notifications_unread_idx
  on public.notifications (client_id)
  where read_at is null;

-- 5) Auto-maintain updated_at on salon_clients
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_salon_clients_set_updated_at on public.salon_clients;
create trigger trg_salon_clients_set_updated_at
before update on public.salon_clients
for each row execute function public.set_updated_at();

-- 6) Create notification on appointment confirmation
create or replace function public.notify_client_on_appointment_status_change()
returns trigger
language plpgsql
as $$
begin
  if new.client_id is not null and old.status is distinct from new.status then
    if new.status = 'potvrÄ‘en' then
      insert into public.notifications (salon_id, client_id, tip, title, body, appointment_id)
      values (
        new.salon_id,
        new.client_id,
        'appointment_confirmed',
        'Termin potvrÄ‘en',
        'VaĹˇ termin je potvrÄ‘en od strane salona.',
        new.id
      );
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_on_termini_status on public.termini;
create trigger trg_notify_on_termini_status
after update on public.termini
for each row execute function public.notify_client_on_appointment_status_change();

-- 7) RLS
alter table public.salon_clients enable row level security;
alter table public.loyalty_accounts enable row level security;
alter table public.notifications enable row level security;

-- Salon owner can manage own clients
drop policy if exists salon_clients_owner_all on public.salon_clients;
create policy salon_clients_owner_all
on public.salon_clients
for all
to authenticated
using (salon_id = auth.uid())
with check (salon_id = auth.uid());

-- Client can read/update own profile by auth_user_id
drop policy if exists salon_clients_client_self_read on public.salon_clients;
create policy salon_clients_client_self_read
on public.salon_clients
for select
to authenticated
using (auth_user_id = auth.uid());

drop policy if exists salon_clients_client_self_update on public.salon_clients;
create policy salon_clients_client_self_update
on public.salon_clients
for update
to authenticated
using (auth_user_id = auth.uid())
with check (auth_user_id = auth.uid());

-- Loyalty visibility: salon owner or the same logged-in client
drop policy if exists loyalty_owner_read on public.loyalty_accounts;
create policy loyalty_owner_read
on public.loyalty_accounts
for select
to authenticated
using (salon_id = auth.uid());

drop policy if exists loyalty_client_read on public.loyalty_accounts;
create policy loyalty_client_read
on public.loyalty_accounts
for select
to authenticated
using (
  exists (
    select 1
    from public.salon_clients sc
    where sc.id = loyalty_accounts.client_id
      and sc.auth_user_id = auth.uid()
  )
);

drop policy if exists loyalty_owner_write on public.loyalty_accounts;
create policy loyalty_owner_write
on public.loyalty_accounts
for all
to authenticated
using (salon_id = auth.uid())
with check (salon_id = auth.uid());

-- Notification visibility: salon owner or same logged-in client
drop policy if exists notifications_owner_read on public.notifications;
create policy notifications_owner_read
on public.notifications
for select
to authenticated
using (salon_id = auth.uid());

drop policy if exists notifications_client_read on public.notifications;
create policy notifications_client_read
on public.notifications
for select
to authenticated
using (
  exists (
    select 1
    from public.salon_clients sc
    where sc.id = notifications.client_id
      and sc.auth_user_id = auth.uid()
  )
);

drop policy if exists notifications_client_mark_read on public.notifications;
create policy notifications_client_mark_read
on public.notifications
for update
to authenticated
using (
  exists (
    select 1
    from public.salon_clients sc
    where sc.id = notifications.client_id
      and sc.auth_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.salon_clients sc
    where sc.id = notifications.client_id
      and sc.auth_user_id = auth.uid()
  )
);

-- Keep existing public booking behavior, now requiring client_id for better tracking.
drop policy if exists anon_can_insert_termini on public.termini;
create policy anon_can_insert_termini
on public.termini
for insert
to anon
with check (
  salon_id is not null
  and client_id is not null
  and ime_klijenta is not null
  and telefon_klijenta is not null
  and datum_vrijeme is not null
);

commit;


-- ========== 2026-04-18_kupac_nalozi.sql ==========
-- Globalni zapis registrovanog kupca (signup sa /kupac/registracija).
-- auth.users = nalog; kupac_nalozi = jasno vidljivi podaci u Table Editor-u.
-- Veza kupac â†” salon (landing) i dalje ide kroz salon_clients.

begin;

create table if not exists public.kupac_nalozi (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users (id) on delete cascade,
  email text not null,
  ime text not null,
  telefon text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists kupac_nalozi_email_idx on public.kupac_nalozi (lower(email));

drop trigger if exists trg_kupac_nalozi_set_updated_at on public.kupac_nalozi;
create trigger trg_kupac_nalozi_set_updated_at
before update on public.kupac_nalozi
for each row execute function public.set_updated_at();

alter table public.kupac_nalozi enable row level security;

drop policy if exists kupac_nalozi_select_own on public.kupac_nalozi;
create policy kupac_nalozi_select_own
on public.kupac_nalozi
for select
to authenticated
using (auth_user_id = auth.uid());

drop policy if exists kupac_nalozi_insert_own on public.kupac_nalozi;
create policy kupac_nalozi_insert_own
on public.kupac_nalozi
for insert
to authenticated
with check (auth_user_id = auth.uid());

drop policy if exists kupac_nalozi_update_own on public.kupac_nalozi;
create policy kupac_nalozi_update_own
on public.kupac_nalozi
for update
to authenticated
using (auth_user_id = auth.uid())
with check (auth_user_id = auth.uid());

commit;


-- ========== 2026-04-20_link_salon_client_rpc.sql ==========
-- Samo ovaj SQL u Supabase â†’ SQL Editor (ne TypeScript iz app/api).
-- Povezivanje kupca: funkcija link_salon_client + RLS za termine.

begin;

create or replace function public.link_salon_client(
  p_salon_id uuid,
  p_telefon text,
  p_ime text,
  p_email text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_telefon text := trim(coalesce(p_telefon, ''));
  v_ime text := coalesce(nullif(trim(coalesce(p_ime, '')), ''), 'Klijent');
  v_email text := nullif(trim(coalesce(p_email, '')), '');
  r_client_id uuid;
  r_existing_auth uuid;
begin
  if v_uid is null then
    raise exception 'Niste prijavljeni.';
  end if;
  if v_telefon = '' then
    raise exception 'Telefon je obavezan.';
  end if;
  if not exists (select 1 from public.saloni s where s.id = p_salon_id) then
    raise exception 'Salon nije pronaÄ‘en.';
  end if;

  select c.id, c.auth_user_id into r_client_id, r_existing_auth
  from public.salon_clients c
  where c.salon_id = p_salon_id and c.telefon = v_telefon
  limit 1;

  if r_client_id is not null then
    if r_existing_auth is not null and r_existing_auth <> v_uid then
      raise exception 'Ovaj telefon je veÄ‡ povezan sa drugim nalogom.';
    end if;
    update public.salon_clients sc
    set
      auth_user_id = v_uid,
      ime = v_ime,
      email = coalesce(v_email, sc.email),
      updated_at = now()
    where sc.id = r_client_id;
    return r_client_id;
  end if;

  insert into public.salon_clients (salon_id, auth_user_id, ime, telefon, email)
  values (p_salon_id, v_uid, v_ime, v_telefon, v_email)
  returning id into r_client_id;

  return r_client_id;
end;
$$;

grant execute on function public.link_salon_client(uuid, text, text, text) to authenticated;

drop policy if exists termini_client_select_own on public.termini;
create policy termini_client_select_own
on public.termini
for select
to authenticated
using (
  exists (
    select 1
    from public.salon_clients sc
    where sc.id = termini.client_id
      and sc.auth_user_id = auth.uid()
  )
);

commit;


-- ========== 2026-04-21_client_notifications_triggers.sql ==========
-- ObaveĹˇtenja kupcu: novi termin, potvrda, izmena vremena.
-- Pokreni u Supabase SQL Editor (posle 2026-04-14_client_portal.sql).

begin;

alter table public.notifications drop constraint if exists notifications_tip_check;
alter table public.notifications add constraint notifications_tip_check
  check (tip in (
    'appointment_created',
    'appointment_confirmed',
    'appointment_cancelled',
    'loyalty_reward_ready',
    'appointment_updated'
  ));

create or replace function public.notify_client_on_termini_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.client_id is not null then
    insert into public.notifications (salon_id, client_id, tip, title, body, appointment_id)
    values (
      new.salon_id,
      new.client_id,
      'appointment_created',
      'Zakazan termin',
      'VaĹˇ zahtev za termin je zabeleĹľen. Salon Ä‡e vas obavestiti o potvrdi.',
      new.id
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_on_termini_insert on public.termini;
create trigger trg_notify_on_termini_insert
after insert on public.termini
for each row execute function public.notify_client_on_termini_insert();

create or replace function public.notify_client_on_appointment_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.client_id is null then
    return new;
  end if;

  if old.status is distinct from new.status and new.status = 'potvrÄ‘en' then
    insert into public.notifications (salon_id, client_id, tip, title, body, appointment_id)
    values (
      new.salon_id,
      new.client_id,
      'appointment_confirmed',
      'Termin potvrÄ‘en',
      'VaĹˇ termin je potvrÄ‘en od strane salona.',
      new.id
    );
  end if;

  if old.datum_vrijeme is distinct from new.datum_vrijeme then
    insert into public.notifications (salon_id, client_id, tip, title, body, appointment_id)
    values (
      new.salon_id,
      new.client_id,
      'appointment_updated',
      'Izmenjeno vreme termina',
      'Salon je izmenio datum ili vreme vaĹˇeg termina. Proverite detalje u aplikaciji.',
      new.id
    );
  end if;

  return new;
end;
$$;

commit;


-- ========== 2026-04-22_client_blacklist_usluge_kategorija.sql ==========
-- Kategorija usluge (landing), globalna crna lista kupaca (kasno otkazivanje),
-- status otkazan + obaveĹˇtenje kupcu.
-- Pokreni posle 2026-04-21_client_notifications_triggers.sql.

begin;

-- 1) Usluge: grupa za biranje na landing stranici
alter table public.usluge
  add column if not exists kategorija text null;

comment on column public.usluge.kategorija is 'Grupa usluge (npr. Ĺ iĹˇanje, Kozmetika). Prikazuje se pri zakazivanju.';

-- 2) Normalizacija telefona za poreÄ‘enje
create or replace function public.normalizuj_telefon(p text)
returns text
language sql
immutable
as $$
  select nullif(
    regexp_replace(regexp_replace(coalesce(trim(p), ''), '\s+', '', 'g'), '[^\d+]', '', 'g'),
    ''
  );
$$;

-- 3) Globalna crna lista (jedan red po auth korisniku-kupcu)
create table if not exists public.kupci_crna_lista (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users (id) on delete cascade,
  telefon text not null,
  ime text,
  razlog text not null default 'kasno_otkazivanje',
  minuta_pre_otkazivanja integer null,
  salon_id uuid references public.saloni (id) on delete set null,
  termin_id uuid references public.termini (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists kupci_crna_lista_telefon_idx
  on public.kupci_crna_lista (telefon);

alter table public.kupci_crna_lista enable row level security;

drop policy if exists kupci_crna_lista_salon_read on public.kupci_crna_lista;
create policy kupci_crna_lista_salon_read
on public.kupci_crna_lista
for select
to authenticated
using (
  exists (select 1 from public.saloni s where s.id = auth.uid())
);

-- 4) Javne provere (za API sa anon kljuÄŤem)
create or replace function public.je_telefon_blokiran(p_telefon text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.kupci_crna_lista k
    where public.normalizuj_telefon(k.telefon) = public.normalizuj_telefon(p_telefon)
      and public.normalizuj_telefon(p_telefon) is not null
  );
$$;

create or replace function public.je_auth_blokiran(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.kupci_crna_lista k where k.auth_user_id = p_uid
  );
$$;

grant execute on function public.je_telefon_blokiran(text) to anon, authenticated;
grant execute on function public.je_auth_blokiran(uuid) to anon, authenticated;

-- 5) ObaveĹˇtenje pri otkazivanju + blaĹľi tekst za izmenu od strane kupca
create or replace function public.notify_client_on_appointment_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.client_id is null then
    return new;
  end if;

  if old.status is distinct from new.status and new.status = 'potvrÄ‘en' then
    insert into public.notifications (salon_id, client_id, tip, title, body, appointment_id)
    values (
      new.salon_id,
      new.client_id,
      'appointment_confirmed',
      'Termin potvrÄ‘en',
      'VaĹˇ termin je potvrÄ‘en od strane salona.',
      new.id
    );
  end if;

  if old.status is distinct from new.status and new.status = 'otkazan' then
    insert into public.notifications (salon_id, client_id, tip, title, body, appointment_id)
    values (
      new.salon_id,
      new.client_id,
      'appointment_cancelled',
      'Termin otkazan',
      'VaĹˇ termin je otkazan.',
      new.id
    );
  end if;

  if old.datum_vrijeme is distinct from new.datum_vrijeme then
    insert into public.notifications (salon_id, client_id, tip, title, body, appointment_id)
    values (
      new.salon_id,
      new.client_id,
      'appointment_updated',
      'Izmenjen termin',
      'Datum ili vreme vaĹˇeg termina je izmenjeno. Proverite detalje u aplikaciji.',
      new.id
    );
  end if;

  return new;
end;
$$;

commit;


-- ========== 2026-04-23_notifications_resolve_client_by_phone.sql ==========
-- ObaveĹˇtenja kupcu kada termini.client_id nedostaje: razreĹˇavanje preko salona + telefona.
-- Pokreni u Supabase SQL Editor (posle 2026-04-21 i 2026-04-22 ako ih imaĹˇ).

begin;

create or replace function public.notify_client_on_termini_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client uuid;
begin
  v_client := new.client_id;
  if v_client is null and new.telefon_klijenta is not null then
    select sc.id
    into v_client
    from public.salon_clients sc
    where sc.salon_id = new.salon_id
      and trim(replace(coalesce(sc.telefon, ''), ' ', '')) = trim(replace(coalesce(new.telefon_klijenta, ''), ' ', ''))
    limit 1;
  end if;

  if v_client is not null then
    insert into public.notifications (salon_id, client_id, tip, title, body, appointment_id)
    values (
      new.salon_id,
      v_client,
      'appointment_created',
      'Zakazan termin',
      'VaĹˇ zahtev za termin je zabeleĹľen. Salon Ä‡e vas obavestiti o potvrdi.',
      new.id
    );
  end if;
  return new;
end;
$$;

create or replace function public.notify_client_on_appointment_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client uuid;
begin
  v_client := new.client_id;
  if v_client is null and new.telefon_klijenta is not null then
    select sc.id
    into v_client
    from public.salon_clients sc
    where sc.salon_id = new.salon_id
      and trim(replace(coalesce(sc.telefon, ''), ' ', '')) = trim(replace(coalesce(new.telefon_klijenta, ''), ' ', ''))
    limit 1;
  end if;

  if v_client is null then
    return new;
  end if;

  if old.status is distinct from new.status and new.status = 'potvrÄ‘en' then
    insert into public.notifications (salon_id, client_id, tip, title, body, appointment_id)
    values (
      new.salon_id,
      v_client,
      'appointment_confirmed',
      'Termin potvrÄ‘en',
      'VaĹˇ termin je potvrÄ‘en od strane salona.',
      new.id
    );
  end if;

  if old.status is distinct from new.status and new.status = 'otkazan' then
    insert into public.notifications (salon_id, client_id, tip, title, body, appointment_id)
    values (
      new.salon_id,
      v_client,
      'appointment_cancelled',
      'Termin otkazan',
      'VaĹˇ termin je otkazan.',
      new.id
    );
  end if;

  if old.datum_vrijeme is distinct from new.datum_vrijeme then
    insert into public.notifications (salon_id, client_id, tip, title, body, appointment_id)
    values (
      new.salon_id,
      v_client,
      'appointment_updated',
      'Izmenjen termin',
      'Datum ili vreme vaĹˇeg termina je izmenjeno. Proverite detalje u aplikaciji.',
      new.id
    );
  end if;

  return new;
end;
$$;

-- Jednokratno: postojeÄ‡i potvrÄ‘eni termini bez obaveĹˇtenja (npr. client_id bio null na redu).
insert into public.notifications (salon_id, client_id, tip, title, body, appointment_id)
select
  t.salon_id,
  coalesce(t.client_id, sc.id),
  'appointment_confirmed',
  'Termin potvrÄ‘en',
  'VaĹˇ termin je potvrÄ‘en od strane salona.',
  t.id
from public.termini t
left join public.salon_clients sc
  on sc.salon_id = t.salon_id
  and trim(replace(coalesce(sc.telefon, ''), ' ', '')) = trim(replace(coalesce(t.telefon_klijenta, ''), ' ', ''))
where t.status = 'potvrÄ‘en'
  and coalesce(t.client_id, sc.id) is not null
  and not exists (
    select 1
    from public.notifications n
    where n.appointment_id = t.id
      and n.tip = 'appointment_confirmed'
  );

commit;


-- ========== 2026-04-24_ensure_salon_client_booking_rpc.sql ==========
-- Javno zakazivanje: kreiranje / pronalaĹľenje salon_clients bez service_role kljuÄŤa.
-- RLS na salon_clients dozvoljava INSERT samo vlasniku (authenticated + salon_id = auth.uid());
-- anon kljuÄŤ iz Next API-ja zato pada. Ova funkcija radi kao security definer.

begin;

create or replace function public.ensure_salon_client_for_booking(
  p_salon_id uuid,
  p_ime text,
  p_telefon text,
  p_email text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_tel text := trim(coalesce(p_telefon, ''));
  v_ime text := trim(coalesce(p_ime, ''));
  v_email text := nullif(trim(coalesce(p_email, '')), '');
begin
  if not exists (select 1 from public.saloni s where s.id = p_salon_id) then
    raise exception 'Salon nije pronaÄ‘en.';
  end if;
  if v_tel = '' then
    raise exception 'Telefon je obavezan.';
  end if;
  if v_ime = '' then
    v_ime := 'Klijent';
  end if;

  insert into public.salon_clients (salon_id, ime, telefon, email)
  values (p_salon_id, v_ime, v_tel, v_email)
  on conflict (salon_id, telefon)
  do update set
    ime = case
      when public.salon_clients.auth_user_id is null then excluded.ime
      else public.salon_clients.ime
    end,
    email = case
      when excluded.email is not null then excluded.email
      else public.salon_clients.email
    end
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.ensure_salon_client_for_booking(uuid, text, text, text) to anon;
grant execute on function public.ensure_salon_client_for_booking(uuid, text, text, text) to authenticated;

commit;


-- ========== 2026-04-27_salon_rucna_crna_lista.sql ==========
-- RuÄŤno dodavanje na crnu listu od strane salona (telefon + opciono ime).
-- RuÄŤno: samo ako broj veÄ‡ postoji u salon_clients za taj salon (auth.uid() = salon_id).
-- ÄŚitanje cele liste: i dalje za sve ulogovane salone (RLS kupci_crna_lista_salon_read).
--
-- Ako joĹˇ nisi pokrenuo 2026-04-22_client_blacklist_usluge_kategorija.sql, ovaj fajl
-- ipak kreira minimalnu tabelu kupci_crna_lista + normalizuj_telefon + RLS + je_telefon_blokiran.
-- (Za kategoriju usluge i ostalo iz 2026-04-22 i dalje pokreni tu migraciju kad moĹľeĹˇ.)

begin;

-- ---------------------------------------------------------------------------
-- Bootstrap (kada public.kupci_crna_lista ne postoji)
-- ---------------------------------------------------------------------------
create or replace function public.normalizuj_telefon(p text)
returns text
language sql
immutable
as $$
  select nullif(
    regexp_replace(regexp_replace(coalesce(trim(p), ''), '\s+', '', 'g'), '[^\d+]', '', 'g'),
    ''
  );
$$;

create table if not exists public.kupci_crna_lista (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid null unique references auth.users (id) on delete cascade,
  telefon text not null,
  ime text,
  razlog text not null default 'kasno_otkazivanje',
  minuta_pre_otkazivanja integer null,
  salon_id uuid references public.saloni (id) on delete set null,
  termin_id uuid references public.termini (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists kupci_crna_lista_telefon_idx
  on public.kupci_crna_lista (telefon);

alter table public.kupci_crna_lista enable row level security;

drop policy if exists kupci_crna_lista_salon_read on public.kupci_crna_lista;
create policy kupci_crna_lista_salon_read
on public.kupci_crna_lista
for select
to authenticated
using (
  exists (select 1 from public.saloni s where s.id = auth.uid())
);

create or replace function public.je_telefon_blokiran(p_telefon text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.kupci_crna_lista k
    where public.normalizuj_telefon(k.telefon) = public.normalizuj_telefon(p_telefon)
      and public.normalizuj_telefon(p_telefon) is not null
  );
$$;

create or replace function public.je_auth_blokiran(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.kupci_crna_lista k where k.auth_user_id = p_uid
  );
$$;

grant execute on function public.je_telefon_blokiran(text) to anon, authenticated;
grant execute on function public.je_auth_blokiran(uuid) to anon, authenticated;

-- Ako je tabela nastala starom migracijom (auth_user_id NOT NULL), dozvoli NULL za ruÄŤne unose.
alter table public.kupci_crna_lista
  alter column auth_user_id drop not null;

comment on column public.kupci_crna_lista.auth_user_id is
  'KupÄŤev auth nalog ako postoji; NULL ako je zapis samo po telefonu (ruÄŤno od salona).';

create or replace function public.salon_dodaj_kupca_u_crnu_listu(
  p_telefon text,
  p_ime text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_salon uuid := auth.uid();
  v_norm text;
  v_auth uuid;
  v_ime text;
  v_phone_saved text;
begin
  if v_salon is null then
    return json_build_object('ok', false, 'error', 'Niste prijavljeni.');
  end if;

  if not exists (select 1 from public.saloni s where s.id = v_salon) then
    return json_build_object('ok', false, 'error', 'Samo salon moĹľe dodati zapis na crnu listu.');
  end if;

  v_norm := public.normalizuj_telefon(p_telefon);
  if v_norm is null or v_norm = '' then
    return json_build_object('ok', false, 'error', 'Unesite ispravan broj telefona.');
  end if;

  -- RuÄŤna crna lista: samo klijenti koji veÄ‡ postoje kod ovog salona (spreÄŤava zloupotrebu tuÄ‘ih brojeva).
  if not exists (
    select 1
    from public.salon_clients sc
    where sc.salon_id = v_salon
      and public.normalizuj_telefon(sc.telefon) = v_norm
  ) then
    return json_build_object(
      'ok', false,
      'error',
      'MoĹľete dodati samo broj koji je veÄ‡ kod vas kao klijent (npr. iz zakazivanja).'
    );
  end if;

  select sc.auth_user_id, sc.telefon into v_auth, v_phone_saved
  from public.salon_clients sc
  where sc.salon_id = v_salon
    and public.normalizuj_telefon(sc.telefon) = v_norm
  limit 1;

  v_ime := coalesce(
    nullif(trim(p_ime), ''),
    (select sc2.ime from public.salon_clients sc2
     where sc2.salon_id = v_salon and public.normalizuj_telefon(sc2.telefon) = v_norm
     limit 1)
  );

  if v_auth is not null then
    insert into public.kupci_crna_lista (
      auth_user_id, telefon, ime, razlog, salon_id, termin_id, minuta_pre_otkazivanja
    ) values (
      v_auth, p_telefon, v_ime, 'salon_rucno', v_salon, null, null
    )
    on conflict (auth_user_id) do update set
      telefon = excluded.telefon,
      ime = coalesce(excluded.ime, kupci_crna_lista.ime),
      razlog = 'salon_rucno',
      salon_id = excluded.salon_id,
      termin_id = null,
      minuta_pre_otkazivanja = null;
  else
    if exists (
      select 1 from public.kupci_crna_lista k
      where public.normalizuj_telefon(k.telefon) = v_norm
    ) then
      update public.kupci_crna_lista k set
        telefon = coalesce(v_phone_saved, p_telefon),
        ime = coalesce(v_ime, k.ime),
        razlog = 'salon_rucno',
        salon_id = v_salon,
        termin_id = null,
        minuta_pre_otkazivanja = null
      where public.normalizuj_telefon(k.telefon) = v_norm;
    else
      insert into public.kupci_crna_lista (
        auth_user_id, telefon, ime, razlog, salon_id, termin_id, minuta_pre_otkazivanja
      ) values (
        null, coalesce(v_phone_saved, p_telefon), v_ime, 'salon_rucno', v_salon, null, null
      );
    end if;
  end if;

  return json_build_object('ok', true);
end;
$$;

revoke all on function public.salon_dodaj_kupca_u_crnu_listu(text, text) from public;
grant execute on function public.salon_dodaj_kupca_u_crnu_listu(text, text) to authenticated;

-- Blokada i kada je zapis samo po telefonu, a kupac je ulogovan (isti broj u kupac_nalozi).
create or replace function public.je_auth_blokiran(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.kupci_crna_lista k where k.auth_user_id = p_uid
  )
  or exists (
    select 1
    from public.kupci_crna_lista k
    join public.kupac_nalozi kn on kn.auth_user_id = p_uid
    where public.normalizuj_telefon(k.telefon) = public.normalizuj_telefon(kn.telefon)
  );
$$;

grant execute on function public.je_auth_blokiran(uuid) to anon, authenticated;

commit;


-- ========== 2026-04-28_ensure_loyalty_accounts.sql ==========
-- Ako vidiĹˇ: "Could not find the table 'public.loyalty_accounts' in the schema cache"
-- pokreni ovu skriptu u Supabase â†’ SQL Editor.
-- Ne dira triggere za obaveĹˇtenja (ostaju iz novijih migracija).

begin;

create table if not exists public.loyalty_accounts (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.saloni(id) on delete cascade,
  client_id uuid not null references public.salon_clients(id) on delete cascade,
  visits_count integer not null default 0,
  progress_percent integer not null default 0 check (progress_percent >= 0 and progress_percent <= 100),
  reward_ready boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (salon_id, client_id)
);

create index if not exists loyalty_accounts_salon_client_idx
  on public.loyalty_accounts (salon_id, client_id);

alter table public.loyalty_accounts enable row level security;

drop policy if exists loyalty_owner_read on public.loyalty_accounts;
create policy loyalty_owner_read
on public.loyalty_accounts
for select
to authenticated
using (salon_id = auth.uid());

drop policy if exists loyalty_client_read on public.loyalty_accounts;
create policy loyalty_client_read
on public.loyalty_accounts
for select
to authenticated
using (
  exists (
    select 1
    from public.salon_clients sc
    where sc.id = loyalty_accounts.client_id
      and sc.auth_user_id = auth.uid()
  )
);

drop policy if exists loyalty_owner_write on public.loyalty_accounts;
create policy loyalty_owner_write
on public.loyalty_accounts
for all
to authenticated
using (salon_id = auth.uid())
with check (salon_id = auth.uid());

commit;


-- ========== 2026-04-29_salon_clients_auth_per_salon.sql ==========
-- Kupac moĹľe imati po jedan salon_clients red po salonu (isti auth_user_id u viĹˇe redova).
-- Stara Ĺˇema: auth_user_id uuid UNIQUE â€” greĹˇka pri drugom salonu:
-- duplicate key value violates unique constraint "salon_clients_auth_user_id_key"

begin;

alter table public.salon_clients
  drop constraint if exists salon_clients_auth_user_id_key;

-- NajviĹˇe jedan ulogovan kupac po paru (salon, nalog); NULL auth i dalje dozvoljen (gosti).
create unique index if not exists salon_clients_salon_auth_uq
  on public.salon_clients (salon_id, auth_user_id)
  where auth_user_id is not null;

commit;


-- ========== 2026-04-30_get_public_termin_status_rpc.sql ==========
-- Javna provera statusa termina (npr. â€žProvjeri statusâ€ť) bez service_role:
-- direktan SELECT na termini sa anon kljuÄŤem ÄŤesto ne vidi red zbog RLS.
-- GRANT i za service_role (Next sa SUPABASE_SERVICE_ROLE_KEY); tolerancija za datum.

begin;

create or replace function public.get_public_termin_status(
  p_salon_id uuid,
  p_termin_id uuid default null,
  p_ime text default null,
  p_telefon text default null,
  p_datum_vrijeme text default null
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_status text;
  v_tel_norm text;
  v_ts timestamptz;
begin
  if not exists (select 1 from public.saloni s where s.id = p_salon_id) then
    return null;
  end if;

  if p_termin_id is not null then
    select t.status::text into v_status
    from public.termini t
    where t.id = p_termin_id
      and t.salon_id = p_salon_id
    limit 1;
    return v_status;
  end if;

  if p_ime is null or trim(p_ime) = '' or p_telefon is null or trim(p_telefon) = ''
     or p_datum_vrijeme is null or trim(p_datum_vrijeme) = '' then
    return null;
  end if;

  v_tel_norm := trim(replace(coalesce(p_telefon, ''), ' ', ''));
  begin
    v_ts := trim(p_datum_vrijeme)::timestamptz;
  exception when others then
    return null;
  end;

  select t.status::text into v_status
  from public.termini t
  where t.salon_id = p_salon_id
    and t.ime_klijenta = trim(p_ime)
    and trim(replace(coalesce(t.telefon_klijenta, ''), ' ', '')) = v_tel_norm
    and abs(extract(epoch from (t.datum_vrijeme - v_ts))) <= 120
  order by t.created_at desc
  limit 1;

  return v_status;
end;
$$;

grant execute on function public.get_public_termin_status(uuid, uuid, text, text, text) to anon;
grant execute on function public.get_public_termin_status(uuid, uuid, text, text, text) to authenticated;
grant execute on function public.get_public_termin_status(uuid, uuid, text, text, text) to service_role;

commit;


-- ========== 2026-05-01_loyalty_on_visit_confirmed.sql ==========
-- Broj poseta i progres lojalnosti kada salon potvrdi termin (status -> potvrÄ‘en).
-- Radi sa postojeÄ‡om tabelom lojalnost (aktivan, svaki_koji, tip, vrijednost).

begin;

create or replace function public.bump_loyalty_on_termin_confirmed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sv integer;
  v_akt boolean;
  v_cnt integer;
  v_mod integer;
  v_prog integer;
  v_ready boolean;
  v_prev_ready boolean;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;
  if new.client_id is null then
    return new;
  end if;
  if new.status is distinct from 'potvrÄ‘en' then
    return new;
  end if;
  if coalesce(old.status, '') = 'potvrÄ‘en' then
    return new;
  end if;

  insert into public.loyalty_accounts (salon_id, client_id, visits_count, progress_percent, reward_ready, updated_at)
  values (new.salon_id, new.client_id, 0, 0, false, now())
  on conflict (salon_id, client_id) do nothing;

  select
    coalesce((select l.aktivan from public.lojalnost l where l.salon_id = new.salon_id limit 1), false),
    greatest(coalesce((select l.svaki_koji from public.lojalnost l where l.salon_id = new.salon_id limit 1), 5), 2)
  into v_akt, v_sv;

  select la.reward_ready into v_prev_ready
  from public.loyalty_accounts la
  where la.salon_id = new.salon_id and la.client_id = new.client_id
  limit 1;

  update public.loyalty_accounts la
  set
    visits_count = la.visits_count + 1,
    updated_at = now()
  where la.salon_id = new.salon_id and la.client_id = new.client_id
  returning la.visits_count into v_cnt;

  if v_akt then
    v_mod := v_cnt % v_sv;
    if v_mod = 0 then
      v_prog := 100;
      v_ready := true;
    else
      v_prog := least(100, greatest(0, round((v_mod::numeric / v_sv::numeric) * 100)));
      v_ready := false;
    end if;
  else
    v_prog := 0;
    v_ready := false;
  end if;

  update public.loyalty_accounts la
  set
    progress_percent = v_prog,
    reward_ready = v_ready,
    updated_at = now()
  where la.salon_id = new.salon_id and la.client_id = new.client_id;

  if v_akt and v_ready and (not coalesce(v_prev_ready, false)) then
    insert into public.notifications (salon_id, client_id, tip, title, body, appointment_id)
    values (
      new.salon_id,
      new.client_id,
      'loyalty_reward_ready',
      'Nagrada lojalnosti',
      format('Dostigli ste %s. posetu u ovom salonu â€” proverite uslove popusta kod osoblja.', v_sv),
      new.id
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_loyalty_on_termin_confirmed on public.termini;
create trigger trg_loyalty_on_termin_confirmed
after update on public.termini
for each row execute function public.bump_loyalty_on_termin_confirmed();

commit;

