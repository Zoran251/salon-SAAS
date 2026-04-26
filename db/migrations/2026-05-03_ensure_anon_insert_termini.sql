-- Javno zakazivanje: Next API bez SUPABASE_SERVICE_ROLE_KEY koristi anon ključ.
-- Ako je RLS uključen na termini bez ove policy, POST /api/termini vraća RLS grešku.
-- Pokreni u Supabase SQL Editor (bezbedno više puta).

begin;

alter table if exists public.termini enable row level security;

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
