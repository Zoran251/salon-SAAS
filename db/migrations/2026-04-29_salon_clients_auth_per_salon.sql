-- Kupac može imati po jedan salon_clients red po salonu (isti auth_user_id u više redova).
-- Stara šema: auth_user_id uuid UNIQUE — greška pri drugom salonu:
-- duplicate key value violates unique constraint "salon_clients_auth_user_id_key"

begin;

alter table public.salon_clients
  drop constraint if exists salon_clients_auth_user_id_key;

-- Najviše jedan ulogovan kupac po paru (salon, nalog); NULL auth i dalje dozvoljen (gosti).
create unique index if not exists salon_clients_salon_auth_uq
  on public.salon_clients (salon_id, auth_user_id)
  where auth_user_id is not null;

commit;
