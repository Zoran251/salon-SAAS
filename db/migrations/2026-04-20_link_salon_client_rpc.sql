-- Samo ovaj SQL u Supabase → SQL Editor (ne TypeScript iz app/api).
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
    raise exception 'Salon nije pronađen.';
  end if;

  select c.id, c.auth_user_id into r_client_id, r_existing_auth
  from public.salon_clients c
  where c.salon_id = p_salon_id and c.telefon = v_telefon
  limit 1;

  if r_client_id is not null then
    if r_existing_auth is not null and r_existing_auth <> v_uid then
      raise exception 'Ovaj telefon je već povezan sa drugim nalogom.';
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
