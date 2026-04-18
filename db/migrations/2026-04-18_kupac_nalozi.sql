-- Globalni zapis registrovanog kupca (signup sa /kupac/registracija).
-- auth.users = nalog; kupac_nalozi = jasno vidljivi podaci u Table Editor-u.
-- Veza kupac ↔ salon (landing) i dalje ide kroz salon_clients.

begin;

create table if not exists public.kupac_nalozi (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users (id) on delete cascade,
  email text not null,
  ime text not null,
  telefon text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists kupac_nalozi_email_idx on public.kupac_nalozi (lower(email));

drop trigger if exists trg_kupac_nalozi_set_updated_at on public.kupac_nalozi;
create trigger trg_kupac_nalozi_set_updated_at
before update on public.kupac_nalozi
for each row execute function public.set_updated_at();

alter table public.kupac_nalozi enable row level security;

drop policy if exists kupac_nalozi_select_own on public.kupac_nalozi;
create policy kupac_nalozi_select_own
on public.kupac_nalozi
for select
to authenticated
using (auth_user_id = auth.uid());

drop policy if exists kupac_nalozi_insert_own on public.kupac_nalozi;
create policy kupac_nalozi_insert_own
on public.kupac_nalozi
for insert
to authenticated
with check (auth_user_id = auth.uid());

drop policy if exists kupac_nalozi_update_own on public.kupac_nalozi;
create policy kupac_nalozi_update_own
on public.kupac_nalozi
for update
to authenticated
using (auth_user_id = auth.uid())
with check (auth_user_id = auth.uid());

commit;
