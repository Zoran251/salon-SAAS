-- Ako vidiš: "Could not find the table 'public.loyalty_accounts' in the schema cache"
-- pokreni ovu skriptu u Supabase → SQL Editor.
-- Ne dira triggere za obaveštenja (ostaju iz novijih migracija).

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
