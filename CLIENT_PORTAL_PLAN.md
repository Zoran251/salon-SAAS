# Client Portal Plan (Salon-specific)

> **Aktuelno stanje implementacije i backlog:** vidi **[STANJE_PROJEKTA.md](./STANJE_PROJEKTA.md)**. Ovaj fajl zadržavamo kao istorijski arhitektonski nacrt.

This plan is tailored to the current app architecture:
- Salon owner app: `app/dashboard/page.tsx`
- Public salon page: `app/salon/[slug]/page.tsx`
- Booking API: `app/api/termini/route.ts`

## Goal

Enable users of one salon (example: `/salon/maja`) to have:
- guest booking (already exists),
- optional sign-up / login as salon client,
- previous appointments,
- loyalty progress,
- appointment notifications.

## 1) Database Foundation

Run migration:
- `db/migrations/2026-04-14_client_portal.sql`

It adds:
- `salon_clients` (client identity per salon),
- `client_id` in `termini`,
- `loyalty_accounts`,
- `notifications`,
- trigger to create notification when salon confirms appointment.

## 2) API Changes Required

### `POST /api/termini` (existing route)
Current file: `app/api/termini/route.ts`

Update flow:
1. Read `salon_id`, `ime_klijenta`, `telefon_klijenta`, `email` (optional).
2. `upsert` into `salon_clients` by `(salon_id, telefon)`.
3. Use returned `salon_clients.id` as `client_id` in appointment insert.
4. Keep current guest behavior (no app login required).

Why:
- notification + history become stable and no longer tied to localStorage heuristics.

### New route: `GET /api/clients/me`
If logged in as client, return:
- profile (`salon_clients`),
- recent appointments (`termini` by `client_id`),
- loyalty (`loyalty_accounts`),
- unread notifications count (`notifications` where `read_at is null`).

### New route: `POST /api/notifications/read`
Mark selected notification IDs as read for current client.

## 3) Auth Model for Clients

Use Supabase Auth for clients (separate from salon owner login, but same auth system):
- login/signup from `app/salon/[slug]` context,
- on successful auth, link `salon_clients.auth_user_id = auth.uid()`.

Recommended UX:
- guest can always book,
- after booking prompt: "Sačuvaj nalog za praćenje termina",
- if logged in, show "Moj profil", "Moji termini", "Notifikacije", "Lojalnost".

## 4) UI Integration

### Public salon page (`app/salon/[slug]/page.tsx`)
Add tabs/sections:
- `Zakazivanje` (existing),
- `Moji termini`,
- `Lojalnost`,
- `Notifikacije`.

When logged in:
- fetch from `/api/clients/me`,
- replace localStorage status tracking with notification feed.

### Dashboard (`app/dashboard/page.tsx`)
Keep current bell badge for unconfirmed appointments.
Optional enhancement:
- add "Klijenti" section (search by phone/name + loyalty snapshot).

## 5) Rollout Order

1. Run SQL migration.
2. Update booking API to always write `client_id`.
3. Add client login/signup on salon page.
4. Add "My portal" UI (appointments + loyalty + notifications).
5. Remove fallback localStorage status polling once client notifications are live.

## 6) Backward Compatibility

- Existing salons/appointments keep working.
- Old `termini` rows may have `client_id = null`; this is expected.
- New bookings should always produce `client_id`.

## 7) Acceptance Checklist

- Guest can book on `/salon/maja` without account.
- Same guest can create account and see prior appointments (matched by phone per salon).
- Salon confirms appointment in dashboard -> client receives notification.
- Client sees loyalty progress for that salon.
- Data is isolated per salon via `salon_id` + RLS.
