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
    if new.status = 'potvrđen' then
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
