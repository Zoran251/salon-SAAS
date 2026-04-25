-- Javna provera statusa termina (npr. „Provjeri status”) bez service_role:
-- direktan SELECT na termini sa anon ključem često ne vidi red zbog RLS.
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
