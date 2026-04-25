# Stanje projekta — salon-saas

Poslednji pregled repozitorijuma: aplikacija za salone (vlasnik + javna stranica) i portal kupca po salonu. Baza: **Supabase** (PostgreSQL, Auth, RLS). Aplikacija: **Next.js** (App Router).

---

## 1. Šta je urađeno

### 1.1 Salon (vlasnik)

| Oblast | Opis |
|--------|------|
| **Prijava / sesija** | `/login`, čekanje sesije iz storage-a da ne bi bilo lažnog odjave. |
| **Dashboard** `/dashboard` | Sekcije: Pregled, Profil, Usluge, Lager, Termini, Moja stranica (QR/link ka `/salon/[slug]`), Lojalnost (podešavanja u tabeli `lojalnost`). |
| **Podaci** | CRUD nad `saloni`, `usluge`, `lager`, `termini`, `lojalnost`, pregled / ručni unos **crne liste** (`kupci_crna_lista`). |
| **Termini** | Lista zahteva; **Potvrdi** → `status = 'potvrđen'`; statusi `ceka` / `otkazan`. |

### 1.2 Kupac (javna stranica + nalozi)

| Oblast | Opis |
|--------|------|
| **Landing** `/salon/[slug]` | Podaci salona, usluge (kategorije), mapa, zakazivanje (gost ili ulogovan), forma / picker. |
| **Registracija / prijava kupca** | `/kupac/registracija`, `/kupac/prijava`; tabela `kupac_nalozi` (globalni podaci kupca). |
| **Profil u kontekstu salona** | `salon_clients` po **salon_id**; automatsko povezivanje (`ensureSalonClientForCustomer` + RPC `link_salon_client`) da kupac ne mora ručno da „linkuje” svaki salon. |
| **Više salona po jednom nalogu** | Migracija: uklonjen pogrešan globalni `UNIQUE` na `auth_user_id` u `salon_clients`; jedinstveno je **(salon_id, auth_user_id)**. |
| **Lojalnost (prikaz)** | `loyalty_accounts` po `(salon_id, client_id)` — UI naglašava da se broji **samo u tom salonu**. |
| **Zakazivanje** | `POST /api/termini` — RPC `ensure_salon_client_for_booking`, insert u `termini`, JWT → vezivanje `auth_user_id` na `salon_clients` gde je prazno. |
| **Moji termini** | Lista iz `GET /api/clients/me`; izmena / otkazivanje preko `PATCH` / `DELETE` na `/api/clients/appointments/[id]` (pragovi vremena, crna lista). |

### 1.3 Notifikacije (salon → kupac, perzistencija u bazi)

| Oblast | Opis |
|--------|------|
| **Tabela** `notifications` | Tipovi: npr. `appointment_created`, `appointment_confirmed`, `appointment_cancelled`, `appointment_updated`, `loyalty_reward_ready` (gde je u šemi). |
| **Triggeri** | Na `INSERT` / `UPDATE` `termini` — funkcije `notify_client_on_termini_insert`, `notify_client_on_appointment_status_change` (varijante u migracijama **21**, **22**, **23**). |
| **Razrešavanje klijenta** | Migracija **23**: ako na terminu nema `client_id`, pokušaj po **telefonu** u okviru salona; backfill za stare potvrđene redove. |
| **Čitanje u aplikaciji** | `GET /api/clients/me` vraća `notifications`; `PATCH` označava kao pročitano. |
| **UI** | Zvonce, panel, toast za nove stavke na landing stranici. |

### 1.4 Status termina na kartici „čekanje / potvrđeno”

| Oblast | Opis |
|--------|------|
| **RLS i javna provera** | RPC `get_public_termin_status` (migracija **2026-04-30**) — čitanje statusa bez oslanjanja na direktan `SELECT` termina kao anon. |
| **API** | `GET /api/termini?status_check=1` koristi RPC; `Cache-Control: no-store`; otpakivanje odgovora RPC ako je ugnježđen. |
| **Frontend** | Poling, `localStorage`, sinhronizacija sa `clientSummary.appointments` i notifikacijom `appointment_confirmed`; `lib/termin-status.ts` za jedinstveno tumačenje statusa (npr. `potvrđen` sa **đ**). |
| **Profil u pozadini** | Tihe ponovne učitavanja `GET /api/clients/me` dok termin čeka potvrdu (ulogovan kupac). |

### 1.5 API rute (pregled)

- `POST/GET` — `app/api/termini/route.ts`
- `GET/PATCH` — `app/api/clients/me/route.ts`
- `POST` — `app/api/clients/link/route.ts`
- `PATCH/DELETE` — `app/api/clients/appointments/[id]/route.ts`
- `app/api/auth/password/route.ts`, `app/api/supabase-config/route.ts`, `app/api/salon/register-initial/route.ts`

### 1.6 Migracije baze (`db/migrations/`)

Redosled za novi projekat prati datume u imenima fajlova; bitnije grupe:

- **2026-04-14** — client portal (`salon_clients`, `client_id`, `loyalty_accounts`, `notifications`, triggeri, RLS).
- **2026-04-18** — `kupac_nalozi`.
- **2026-04-20** — `link_salon_client` + RLS termini za kupca.
- **2026-04-21** — proširenje tipova notifikacija + triggeri.
- **2026-04-22** — crna lista, RPC `je_telefon_blokiran` / `je_auth_blokiran`, trigger notifikacija.
- **2026-04-23** — notifikacije kada `client_id` nedostaje (telefon).
- **2026-04-24** — `ensure_salon_client_for_booking`.
- **2026-04-27** — ručna crna lista salona.
- **2026-04-28** — `loyalty_accounts` ensure.
- **2026-04-29** — `salon_clients` jedinstveno po salonu + auth.
- **2026-04-30** — `get_public_termin_status`.

---

## 2. Šta još treba / željena pobolšanja

### 2.1 Proizvod i UX

| Prioritet | Stavka |
|-----------|--------|
| Visok | **Real-time ažuriranje** — Supabase Realtime (ili SSE) na `termini` / `notifications` za kupca, da ne zavisi od intervala polinga. |
| Visok | **Lojalnost — automatska logika** — povećanje `visits_count` / `progress_percent` pri potvrdi posete (trigger ili job); sada je šema + prikaz, bez jasnog automatskog brojanja u kodu. |
| Srednji | **Dashboard „Klijenti”** — pretraga po telefonu/ime, pregled lojalnosti (bilo u starom planu). |
| Srednji | **Email / SMS** — obaveštenja trenutno samo u aplikaciji (baza + UI), bez spoljnog kanala. |
| Niži | **Testovi** (E2E/API), CI pipeline, monitoring. |

### 2.2 Tehnički dug

| Stavka |
|--------|
| U repou postoje **duplirani putovi** za neke fajlove (`app/api/...` sa različitim separatorima u git istoriji) — vredi uskladiti na jedan kanonski path. |
| `CLIENT_PORTAL_PLAN.md` — stariji plan; ova datoteka je izvor istine za **stanje**. |
| Provera da su **sve migracije** primenjene na ciljnom Supabase projektu (posebno **04-30** za status termina). |

### 2.3 Okruženje

Potrebne promenljive (skraćeno; detalj u kodu `lib/env-supabase.ts`, `lib/server-supabase.ts`):

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (ili `SUPABASE_*`).
- Za server: **`SUPABASE_SERVICE_ROLE_KEY`** (zakazivanje, RPC, zaobilazak RLS gde je predviđeno).

---

## 3. Brzi start

```bash
npm install
npm run dev
```

Otvori `http://localhost:3000` — marketing; salon: `/dashboard`; kupac: `/salon/<slug>` i `/kupac/prijava`.

---

## 4. Reference

- Pravila za agente: `AGENTS.md`
- Stari arhitektonski nacrt portala: `CLIENT_PORTAL_PLAN.md` (delimično zastareo u odnosu na ovaj fajl)

Ako želiš da se ovaj dokument automatski ažurira pri svakom većem feature-u, drži ga kao checklist u PR-ovima.
