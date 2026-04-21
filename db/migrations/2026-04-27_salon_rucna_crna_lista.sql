-- Ručno dodavanje na crnu listu od strane salona (telefon + opciono ime).
-- Ručno: samo ako broj već postoji u salon_clients za taj salon (auth.uid() = salon_id).
-- Čitanje cele liste: i dalje za sve ulogovane salone (RLS kupci_crna_lista_salon_read).
--
-- Ako još nisi pokrenuo 2026-04-22_client_blacklist_usluge_kategorija.sql, ovaj fajl
-- ipak kreira minimalnu tabelu kupci_crna_lista + normalizuj_telefon + RLS + je_telefon_blokiran.
-- (Za kategoriju usluge i ostalo iz 2026-04-22 i dalje pokreni tu migraciju kad možeš.)

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

-- Ako je tabela nastala starom migracijom (auth_user_id NOT NULL), dozvoli NULL za ručne unose.
alter table public.kupci_crna_lista
  alter column auth_user_id drop not null;

comment on column public.kupci_crna_lista.auth_user_id is
  'Kupčev auth nalog ako postoji; NULL ako je zapis samo po telefonu (ručno od salona).';

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
    return json_build_object('ok', false, 'error', 'Samo salon može dodati zapis na crnu listu.');
  end if;

  v_norm := public.normalizuj_telefon(p_telefon);
  if v_norm is null or v_norm = '' then
    return json_build_object('ok', false, 'error', 'Unesite ispravan broj telefona.');
  end if;

  -- Ručna crna lista: samo klijenti koji već postoje kod ovog salona (sprečava zloupotrebu tuđih brojeva).
  if not exists (
    select 1
    from public.salon_clients sc
    where sc.salon_id = v_salon
      and public.normalizuj_telefon(sc.telefon) = v_norm
  ) then
    return json_build_object(
      'ok', false,
      'error',
      'Možete dodati samo broj koji je već kod vas kao klijent (npr. iz zakazivanja).'
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
