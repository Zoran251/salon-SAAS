-- Javno zakazivanje: kreiranje / pronalaženje salon_clients bez service_role ključa.
-- RLS na salon_clients dozvoljava INSERT samo vlasniku (authenticated + salon_id = auth.uid());
-- anon ključ iz Next API-ja zato pada. Ova funkcija radi kao security definer.

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
    raise exception 'Salon nije pronađen.';
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
