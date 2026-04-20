-- Obaveštenja kupcu: novi termin, potvrda, izmena vremena.
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
      'Vaš zahtev za termin je zabeležen. Salon će vas obavestiti o potvrdi.',
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

  if old.datum_vrijeme is distinct from new.datum_vrijeme then
    insert into public.notifications (salon_id, client_id, tip, title, body, appointment_id)
    values (
      new.salon_id,
      new.client_id,
      'appointment_updated',
      'Izmenjeno vreme termina',
      'Salon je izmenio datum ili vreme vašeg termina. Proverite detalje u aplikaciji.',
      new.id
    );
  end if;

  return new;
end;
$$;

commit;
