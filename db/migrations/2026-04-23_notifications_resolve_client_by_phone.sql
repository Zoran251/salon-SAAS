-- Obaveštenja kupcu kada termini.client_id nedostaje: razrešavanje preko salona + telefona.
-- Pokreni u Supabase SQL Editor (posle 2026-04-21 i 2026-04-22 ako ih imaš).

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
      'Vaš zahtev za termin je zabeležen. Salon će vas obavestiti o potvrdi.',
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

  if old.status is distinct from new.status and new.status = 'potvrđen' then
    insert into public.notifications (salon_id, client_id, tip, title, body, appointment_id)
    values (
      new.salon_id,
      v_client,
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
      v_client,
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
      v_client,
      'appointment_updated',
      'Izmenjen termin',
      'Datum ili vreme vašeg termina je izmenjeno. Proverite detalje u aplikaciji.',
      new.id
    );
  end if;

  return new;
end;
$$;

-- Jednokratno: postojeći potvrđeni termini bez obaveštenja (npr. client_id bio null na redu).
insert into public.notifications (salon_id, client_id, tip, title, body, appointment_id)
select
  t.salon_id,
  coalesce(t.client_id, sc.id),
  'appointment_confirmed',
  'Termin potvrđen',
  'Vaš termin je potvrđen od strane salona.',
  t.id
from public.termini t
left join public.salon_clients sc
  on sc.salon_id = t.salon_id
  and trim(replace(coalesce(sc.telefon, ''), ' ', '')) = trim(replace(coalesce(t.telefon_klijenta, ''), ' ', ''))
where t.status = 'potvrđen'
  and coalesce(t.client_id, sc.id) is not null
  and not exists (
    select 1
    from public.notifications n
    where n.appointment_id = t.id
      and n.tip = 'appointment_confirmed'
  );

commit;
