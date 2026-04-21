-- Kategorija usluge (landing), globalna crna lista kupaca (kasno otkazivanje),
-- status otkazan + obaveštenje kupcu.
-- Pokreni posle 2026-04-21_client_notifications_triggers.sql.

begin;

-- 1) Usluge: grupa za biranje na landing stranici
alter table public.usluge
  add column if not exists kategorija text null;

comment on column public.usluge.kategorija is 'Grupa usluge (npr. Šišanje, Kozmetika). Prikazuje se pri zakazivanju.';

-- 2) Normalizacija telefona za poređenje
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

-- 4) Javne provere (za API sa anon ključem)
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

-- 5) Obaveštenje pri otkazivanju + blaži tekst za izmenu od strane kupca
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

  if old.status is distinct from new.status and new.status = 'potvrđen' then
    insert into public.notifications (salon_id, client_id, tip, title, body, appointment_id)
    values (
      new.salon_id,
      new.client_id,
      'appointment_confirmed',
      'Termin potvrđen',
      'Vaš termin je potvrđen od strane salona.',
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
      'Vaš termin je otkazan.',
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
      'Datum ili vreme vašeg termina je izmenjeno. Proverite detalje u aplikaciji.',
      new.id
    );
  end if;

  return new;
end;
$$;

commit;
