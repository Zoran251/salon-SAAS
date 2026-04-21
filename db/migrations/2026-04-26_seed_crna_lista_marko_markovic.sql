-- Marko Marković na globalnoj crnoj listi (public.kupci_crna_lista).
-- Pokreni u Supabase → SQL Editor (posle migracije 2026-04-22_client_blacklist_usluge_kategorija.sql).
--
-- Redosled:
-- 1) Ako postoji kupac sa imenom „Marko Marković“ u kupac_nalozi ili salon_clients (sa auth_user_id), koristi taj nalog.
-- 2) Inače kreira se demo korisnik u auth (email: crna-lista-seed.marko@salonpro.invalid) i upisuje se crna lista.
-- Ponovno pokretanje je bezbedno (UPSERT po auth_user_id).

begin;

create extension if not exists pgcrypto;

do $$
declare
  v_uid uuid;
  v_phone text;
  v_email text := 'crna-lista-seed.marko@salonpro.invalid';
  v_pw text;
begin
  v_phone := null;
  v_uid := null;

  select kn.auth_user_id, kn.telefon
  into v_uid, v_phone
  from public.kupac_nalozi kn
  where regexp_replace(lower(trim(kn.ime)), '\s+', ' ', 'g') in ('marko marković', 'marko markovic')
  limit 1;

  if v_uid is null then
    select sc.auth_user_id, sc.telefon
    into v_uid, v_phone
    from public.salon_clients sc
    where sc.auth_user_id is not null
      and regexp_replace(lower(trim(sc.ime)), '\s+', ' ', 'g') in ('marko marković', 'marko markovic')
    limit 1;
  end if;

  if v_uid is null then
    select u.id into v_uid from auth.users u where u.email = v_email limit 1;

    if v_uid is null then
      v_uid := gen_random_uuid();
      v_pw := crypt('SalonProCrnaListaSeed2026', gen_salt('bf'));

      insert into auth.users (
        id,
        instance_id,
        aud,
        role,
        email,
        encrypted_password,
        email_confirmed_at,
        raw_app_meta_data,
        raw_user_meta_data,
        created_at,
        updated_at
      ) values (
        v_uid,
        '00000000-0000-0000-0000-000000000000',
        'authenticated',
        'authenticated',
        v_email,
        v_pw,
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{"full_name":"Marko Marković"}'::jsonb,
        now(),
        now()
      );
    end if;

    if not exists (select 1 from auth.identities i where i.user_id = v_uid) then
      insert into auth.identities (
        id,
        user_id,
        identity_data,
        provider,
        provider_id,
        last_sign_in_at,
        created_at,
        updated_at
      ) values (
        gen_random_uuid(),
        v_uid,
        jsonb_build_object('sub', v_uid::text, 'email', v_email),
        'email',
        v_uid::text,
        now(),
        now(),
        now()
      );
    end if;
  end if;

  insert into public.kupci_crna_lista (auth_user_id, telefon, ime, razlog, minuta_pre_otkazivanja)
  values (
    v_uid,
    coalesce(nullif(trim(v_phone), ''), '+381641112223'),
    'Marko Marković',
    'kasno_otkazivanje',
    30
  )
  on conflict (auth_user_id) do update set
    telefon = excluded.telefon,
    ime = excluded.ime,
    razlog = excluded.razlog,
    minuta_pre_otkazivanja = excluded.minuta_pre_otkazivanja;
end $$;

commit;

-- Ako INSERT u auth.users / auth.identities zbog verzije Supabase-a ne prođe,
-- uradi ručno: Authentication → Add user (npr. marko@test.local), kopiraj UUID, pa:
-- insert into public.kupci_crna_lista (auth_user_id, telefon, ime, razlog)
-- values ('UUID_OVDE'::uuid, '+381641112223', 'Marko Marković', 'kasno_otkazivanje')
-- on conflict (auth_user_id) do update set telefon = excluded.telefon, ime = excluded.ime;
