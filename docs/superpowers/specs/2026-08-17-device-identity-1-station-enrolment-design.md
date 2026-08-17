# Device identity-1 — Always-on station enrolment & authentication

**Date:** 2026-08-17. **Status:** design (approved section-by-section with the owner); plan alongside.
**Track:** the always-on device-identity subsystem split out of KDS-1 (sub-project 12). **Runs
SUPERVISED**. **Security-sensitive** — this is the **first** way a client proves it is a trusted
*device* (today there is none). **Depends on KDS-1** (it binds a device to a `kitchen_station` and drives
that station's display), which depends on TS-1/FP-1 — all specced, **unbuilt**.

Today **no device/station authentication exists**: the till boot (`GET /api/till`) is unauthenticated,
a till's "identity" is env vars stamped into its server process (`till-config.ts:44-82`, no token), and
the only client auth is a per-person PIN → session cookie (`till-session.ts:76-95`). The only wire-token
in the tree is the **server-to-server sync Bearer** (`sync-api.ts:80-88`). KDS-1's kitchen display is
therefore **session-gated** (kitchen staff log in). This slice adds what an *always-on* screen needs: a
way to enrol a physical device once and have it authenticate itself thereafter, with **no per-person
login** — built generally enough to later trust the till device itself, but wired only for the KDS
station display now.

## 0. Owner decisions this slice is built on (2026-08-17)

- **Enrolment: a pairing code.** An admin generates a short-lived, single-use code (bound to a station);
  the kitchen screen redeems it and becomes a trusted device. (Chosen over a one-time enrol link/QR and a
  provisioned/pasted token.)
- **Transport: an httpOnly device cookie** (set at enrolment, like the operator/management session —
  XSS-safe), **not** a localStorage bearer.
- **Entity: general-but-minimal.** A `devices` table with a `kind` + a binding; only the `kds_station`
  kind is wired this slice, so trusting the till device is an additive later `kind`.
- **`requireDevice` guard**: returns the device's binding; a device may **only read + bump its bound
  station** — no person permissions, no selling.
- **Token at rest is hashed** (the same scrypt primitive as the PIN); plaintext lives only in the cookie.
  A device is **revocable** (deactivate the row → the cookie stops validating) and re-enrollable.
- **`device.manage` permission** (admin + manager) gates enrolment/management. **Security review before
  build.**

## 1. Scope

**In:** a `devices` entity + a `device_pairing_codes` model; an admin **generate-pairing-code** verb +
a device **enrol** verb (redeem code → mint token → set cookie → bind to station); a **`requireDevice`**
guard; device-authenticated KDS routes (read + bump, **scoped to the bound station**); a dashboard
**Devices** screen (list · generate code · revoke); the KDS-1 station display gaining a **device mode**
(runs enrolled, no login) beside its session-gated path.

**Out:** other device `kind`s (trusting the till device, a customer-facing display) — additive later;
token **auto-rotation** / remote wipe / device-initiated re-key; multi-station devices (a device binds to
exactly one station); any public/online surface; changing KDS-1's session-gated path (this is **additive**
— an operator login still works).

## 2. Data model

All non-fiscal, pre-production (**no backfill** — CLAUDE.md §3, §5).

### 2a. `devices` (new, `packages/db/src/schema/`)

Tenant + location scoped (separate `tenant_id` + `location_id` FKs, `onDelete restrict` — the `shifts`
shape, so no change to `locations`).

```text
devices
-------
id            uuid PK
tenant_id     uuid → tenants (restrict)
location_id   uuid → locations (restrict)
kind          device_kind NOT NULL              -- pgEnum ['kds_station'] (extensible)
station_id    uuid NULL  composite FK (tenant_id, station_id) → kitchen_stations (tenant_id, id)  -- the kds_station binding
label         text NOT NULL                     -- "Pantalla Cocina", shown in management
token_hash    text NOT NULL                     -- scrypt: hashSecret(token) (secret-hash.ts)
active        bool NOT NULL DEFAULT true         -- revoke = active := false (no hard delete)
enrolled_at   timestamptz NOT NULL DEFAULT now()
last_seen_at  timestamptz NULL                   -- touched by requireDevice

UNIQUE (tenant_id, id)
```

`device_kind` = a new pgEnum `['kds_station']`. FORCE RLS + `devices_tenant_isolation` policy +
`GRANT SELECT,INSERT,UPDATE ON devices TO app_user` (no DELETE — revoke) in a **hand-written custom
migration** (model `0036_till_layouts_rls.sql:24-30`; the `station_id` composite FK hand-written, since
`kitchen_stations` is a KDS-1 table). Auto-covered by `inmutabilidad` (keys on `tenant_id`).

### 2b. `device_pairing_codes` (new) — the pairing-code model

Modelled on the **WebAuthn challenge** (`passkey.ts:49-93`, `schema/webauthn.ts:76-95`): a short-lived,
single-use row, **TTL computed from `created_at`** (no `expires_at` column), consumed by a **locking
`DELETE … RETURNING`**.

```text
device_pairing_codes
--------------------
id          uuid PK
tenant_id   uuid → tenants (restrict)
location_id uuid → locations (restrict)
code_sha256 text NOT NULL              -- SHA-256 of a HIGH-ENTROPY code (indexed lookup key, §2c)
kind        device_kind NOT NULL       -- the device kind this code enrols
station_id  uuid NULL  composite FK (tenant_id, station_id) → kitchen_stations   -- the binding to stamp on the device
label       text NOT NULL              -- the label to give the enrolled device
created_at  timestamptz NOT NULL DEFAULT now()

INDEX (tenant_id, code_sha256)         -- redemption lookup
```

FORCE RLS + policy + `GRANT SELECT,INSERT,DELETE TO app_user` (DELETE **is** granted here — redemption
consumes the row via `DELETE … RETURNING`, the WebAuthn-challenge pattern). `PAIRING_TTL_MS = 15 * 60 *
1000` (15 min), checked in code (`now - created_at > TTL` → expired), the way `CHALLENGE_TTL_MS` is
(`passkey.ts:49-51`).

### 2c. Two different secrets, two different treatments (security rationale)

- **The device token** (long-lived — the screen stays enrolled across reboots): high-entropy
  (`randomBytes(32).toString("base64url")`), hashed at rest with **scrypt** (`hashSecret`,
  `secret-hash.ts:24-28`), verified with `verifySecret` (constant-time `timingSafeEqual` inside,
  `:35-48`). Never stored plaintext.
- **The pairing code** (ephemeral — minutes, single-use): must be **looked up** by the redeeming device,
  which sends only the code (no selector), so a per-row scrypt salt can't be used for lookup. Instead the
  code is **high-entropy** (an 8-char Crockford-base32 string ≈ 40 bits, **not** a 6-digit PIN — a low
  entropy code would be brute-forceable), and its **SHA-256** is the indexed lookup key. High entropy +
  single-use + 15-min TTL + a redemption rate-limit makes an offline attack on a leaked hash infeasible
  within the window. (Rationale recorded for the security review, §8.)

### 2d. Migration

One `packages/db` migration set (number via `db:generate` — **not hardcoded**): create the `device_kind`
enum + `devices` + `device_pairing_codes`; custom part = FORCE RLS + policies + grants on both, the
`devices.station_id` / `device_pairing_codes.station_id` composite FKs, and the pairing-code index. Commit
journal + snapshot. Re-run `inmutabilidad`. **Sequences after KDS-1** (the `kitchen_stations` FK target).

## 3. Behaviour (`apps/server`)

### 3a. Generate a pairing code (management API, `device.manage`)

`POST /management-api/device-codes { kind: "kds_station", stationId, label } → 200 { code }` — gated
`authorizeManager("device.manage")` (the `booking-api`/`purchasing-api` `gated()` shape). Generates a
high-entropy code (§2c), stores `{ code_sha256: sha256(code), kind, stationId, label }`, and returns the
**plaintext code once** (never re-readable — like a passkey challenge handle). Validates the station is a
live `kitchen_stations` row (`station.not_found`, reused from KDS-1).

### 3b. Enrol a device (UNAUTHENTICATED enrol API — mirrors `POST /api/session`)

`POST /api/device/enrol { code } → 200 { deviceId, kind, stationId, label }` + **sets the device cookie**.
Unauthenticated (the device has no identity yet), mounted like the login route (`till-api.ts:139-151`),
running `withTenant(cfg.tenantId) + asAppUser` (the server process is one tenant, so enrolment is scoped
to *this venue's* server):

1. `sha256(code)` → **locking `DELETE FROM device_pairing_codes WHERE tenant_id = $t AND code_sha256 = $h
   RETURNING …`** (single-use, serialises concurrent redeems — the `consumeChallenge` pattern
   `passkey.ts:81-93`). No row → `device.pairing_invalid`.
2. `now - created_at > PAIRING_TTL_MS` → `device.pairing_expired` (the deleted row is rolled back with the
   tx so it lapses by TTL rather than being burned — the WebAuthn semantic).
3. mint `token = randomBytes(32).toString("base64url")`; INSERT a `devices` row (`kind`, `station_id`,
   `label` from the code; `token_hash = hashSecret(token)`; `active = true`).
4. `setDeviceCookie(c, `${deviceId}.${token}`, secureCookies)` (§3c); return the binding.

**Redemption is rate-limited** (a per-process attempt cap / small delay — exact mechanism in the plan +
security review) so the SHA-256 lookup can't be hammered.

### 3c. The device cookie + `requireDevice` guard

- Cookie `waitron_device` = `` `${deviceId}.${token}` `` (a **selector.validator**: `deviceId` selects the
  row, `token` validates it — scrypt is per-row-salted, so the id is needed to fetch the salt). Attributes
  mirror `setManagementCookie` (`management-session.ts:25-39`) — `{ httpOnly: true, secure: secureCookies,
  sameSite: "Strict", path: "/" }` — **except** a **long `Max-Age`** (≈ 1 year), because a kitchen screen
  must stay enrolled across reboots (the session cookie deliberately has none; this one deliberately
  does). `secureCookies = config.tls !== undefined` (`boot.ts:290`).
- `requireDevice(deps, c) → { deviceId, kind, stationId }` — read the cookie, split on `.`, `isUuid` the
  selector (`till-session.ts:28`), `withTenant + asAppUser` fetch the **active** device by id, `verifySecret(token,
  row.token_hash)` (constant-time), touch `last_seen_at`; any miss → **`device.unauthorized`** (401). A
  **revoked** device (`active = false`) fails here — instant revocation.

### 3d. Device-authenticated KDS routes (scoped to the bound station)

A device group `mountDeviceApi` whose handlers call `requireDevice` first:

- `GET /api/device/station` → the device's `{ station, queue }` — reuses KDS-1's `listStationQueue(cfg,
  device.stationId)` with the device's **own** `stationId` (a device cannot pass another's).
- `POST /api/device/ticket-items/:id/advance { to }` → reuses KDS-1's `advanceTicketItem`, **after
  asserting the item's `station_id === device.stationId`** (else `device.forbidden_station`, 403) — a
  device bumps only its own station.

No `/api/device/*` route touches sales, tabs, or config. The KDS-1 **session-gated** station routes are
unchanged (an operator login still works — this is additive).

### 3e. Device management (management API, `device.manage`)

`GET /management-api/devices` (list: label · kind · station · `active` · `last_seen_at`), `POST
…/devices/:id/revoke` (`active := false`). Plus the generate-code route (§3a). All `authorizeManager("device.manage")`.

## 4. Fiscal safety (H2)

**None.** Device identity is an auth subsystem over KDS-1's non-fiscal kitchen model; a device can only
read/bump ticket items. Nothing writes a `registros_facturacion` row, a `huella`, an invoice number, or a
chain link, and no `/api/device/*` route reaches the sale/pay path. The plan states this with a grep
receipt.

## 5. Client

### 5a. KDS-1 station display — device mode (`apps/till`)

The KDS-1 station display gains a **device mode**: when the browser holds the device cookie, the screen
skips the login/station-picker and calls `/api/device/station` + `/api/device/ticket-items/:id/advance`
(its station is fixed by enrolment). When not enrolled, it shows an **enrol view** — enter the pairing
code → `POST /api/device/enrol` → the screen reloads authenticated. The session-gated path (KDS-1) remains
for a logged-in operator. A small `TillApi` addition: `enrolDevice(code)`, `getDeviceStation()`,
`deviceAdvance(itemId, to)` (local types; the enrol/station calls need no session).

### 5b. Dashboard Devices screen (`apps/dashboard`)

A **Devices** screen (modelled on the `staff`/`bookings` list+form pattern): a list (label · station ·
status · last-seen), a **"Generate pairing code"** action (pick station + label → shows the code **once**,
with copy), and a **Revoke** action per device. `device.manage`-gated; `@waitron/ui` primitives; both-theme
a11y. `DashboardApi` gains `listDevices` / `createDeviceCode` / `revokeDevice`.

## 6. Conventions

- **English identifiers** — `devices`, `device_kind`, `station_id`, `token_hash`, `last_seen_at`,
  `device_pairing_codes`, `code_sha256`, `enrolled_at`. No new `SPANISH_WORDS`; UI copy en/es.
- **Domain error codes** — `device.unauthorized` (401), `device.forbidden_station` (403),
  `device.pairing_invalid` (400), `device.pairing_expired` (400), `device.not_found` (404). `import
  "./errors.js"`; reuse `station.not_found` (KDS-1). Never renamed once shipped.
- **Permission** — a new **`device.manage`**, added to `PERMISSIONS` + the `MANAGER`/`ALL` sets
  (`permissions.ts:7-57`). **Churn:** update `permissions.test.ts` (the catalog-shape assertion) in the
  same change (CLAUDE.md §3).
- **Reuse, don't reinvent crypto** — `hashSecret`/`verifySecret` (scrypt, `secret-hash.ts`), the cookie
  helpers (`management-session.ts:25-39`), `timingSafeEqual` via `verifySecret`, `randomBytes` for the
  token, `node:crypto` `createHash("sha256")` for the code lookup. **No new hashing/crypto is written.**
- No backwards-compat / data-migration code (pre-production).

## 7. Testing

- **Real Postgres** — `devices` + `device_pairing_codes` cross-tenant RLS (by deletion of the tenant
  predicate) + negative `WITH CHECK`; `inmutabilidad` green after the migration; **the pairing-code
  single-use** proven by a **concurrent redeem** (two enrols with one code → exactly one device, the
  other `device.pairing_invalid`, the locking `DELETE … RETURNING` the guard — proven by deletion of the
  lock); a **revoked** device fails `requireDevice` (differential).
- **Unit / PGlite** — `hashSecret`/`verifySecret` round-trip for a device token (reuse the identity
  tests' shape); `requireDevice` accepts a valid cookie, rejects a wrong token (constant-time via
  `verifySecret`), a malformed cookie, an unknown id, and a revoked device; the TTL boundary
  (`device.pairing_expired` just past `PAIRING_TTL_MS`); `device.forbidden_station` when a device bumps
  another station's item.
- **Security-focused** — a **negative** enrol test (a random/expired/consumed code never enrols); assert
  the plaintext token/code is **never** returned except the one-time code at generation and the token only
  in the `Set-Cookie` (httpOnly, never in a JSON body); the redemption rate-limit fires. **A security
  review (the `security-review` skill or a dedicated review pass) runs before merge** — this is auth infra.
- **Server e2e (real-PG)** — generate-code (`device.manage`: 401/403/manager, gate by deletion) → enrol →
  authenticated `GET /api/device/station` → revoke → the same cookie now 401.
- **Dashboard** — the Devices list + generate-code (shows once) + revoke; `.a11y` both themes.
- **Fiscal** — the H2 grep receipt (no `/api/device/*` path reaches `record-sale.ts` / the alta builders).
- Coverage **98/98/98/95** (db, server, identity), **95/95/90/88** (till, dashboard). Run `packages/db`
  unfiltered; `TESTCONTAINERS_RYUK_DISABLED=true` locally.

## 8. Security notes (for the review)

- **Two-tier secret handling** (§2c): scrypt for the long-lived token, indexed SHA-256 of a high-entropy
  code for ephemeral lookup — the code is **not** a low-entropy PIN.
- **Fail-closed everywhere**: `verifySecret` returns false on any malformed input (`secret-hash.ts:35-48`);
  `requireDevice` and the enrol path reject on any miss. Cookie is `httpOnly` + `Secure` (under TLS) +
  `SameSite=Strict`.
- **Instant revocation** via `active = false` (checked in `requireDevice`, no token TTL to wait out).
- **Least privilege**: a device can only read/bump **its own** station; `device.forbidden_station` guards
  cross-station bumps; no sales/tab/config surface is device-reachable.
- **Open items for the reviewer**: the exact **redemption rate-limit** mechanism (per-process cap vs a DB
  attempt counter); whether the device cookie's long `Max-Age` should be shortened with a silent renewal;
  and confirming the enrol endpoint's unauthenticated exposure is acceptable given it only consumes a
  short-lived admin-minted code within the venue's own tenant.

## 9. Sequencing / dependencies

- **Depends on KDS-1** (the `kitchen_stations` binding + `listStationQueue`/`advanceTicketItem` +the
  station display it adds device-mode to) → so build-blocked behind KDS-1 (→ TS-1/FP-1). Re-verify KDS-1's
  station verbs + the display screen against real code first (CLAUDE.md §1).
- **Generalises later**: a `till` (or `customer_display`) `device_kind` is an additive enum value + a new
  device group; the `devices` table + `requireDevice` + enrolment are built to carry them without a
  destructive migration.

## 10. Provenance

Designed against the live tree on 2026-08-17 via a targeted crypto/auth read (cited inline): the gap
(`apps/server/src/till-api.ts:190-247` unauthenticated boot, `till-config.ts:44-82`, `till-session.ts:76-95`,
`sync-api.ts:80-88` the only wire-token); the reusable primitives —
`packages/identity/src/secret-hash.ts:1,24-28,35-48` (**scrypt** `hashSecret`/`verifySecret`, deliberately
not bcrypt/argon2), `apps/server/src/{till-session.ts:17,38-58,76-95, management-session.ts:17,25-39}` (cookie
helpers + the `requireDevice` template), `apps/server/src/sync-api.ts:80-88` (`timingSafeEqual` Bearer shape),
`packages/identity/src/passkey.ts:49-51,81-93` + `schema/webauthn.ts:76-95` (the single-use TTL-from-`created_at`
`DELETE … RETURNING` pairing-code model), `packages/identity/src/permissions.ts:7-57` (+ `permissions.test.ts`
the pinning test), `apps/server/src/boot.ts:290,340-394` (mounting + `secureCookies`), and `node:crypto`
`randomBytes` (`secret-hash.ts:1`). Dependencies on KDS-1 (`kitchen_stations`, `listStationQueue`,
`advanceTicketItem`, the station display) are cited to the KDS-1 spec, re-verified in the plan once KDS-1
lands.
