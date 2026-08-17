# Expo device kind — always-on pass display

**Date:** 2026-08-17. **Status:** design (approved with the owner); plan alongside. **Track:** a small
follow-on joining [KDS-3 (expo/pass)](2026-08-17-kds-3-expo-pass-design.md) to
[device identity-1](2026-08-17-device-identity-1-station-enrolment-design.md). **Runs SUPERVISED**. Both
dependencies are specced, **unbuilt**.

KDS-3 built the expo/pass display **session-gated** (a person logs in and picks the pass). Device-identity
built enrolment + `requireDevice` for a **station** display (`kds_station`). This slice adds an
**`expo_pass` device kind** so the pass screen runs **always-on** — enrolled once, no per-person login —
exactly as the KDS-1 station display gains its device mode.

## 0. Owner decisions this slice is built on (2026-08-17)

- Trivial by construction — the pattern is device-identity's, applied to the expo. The one difference:
  an **expo device is location-wide, not station-bound** (the pass sees every station), so it enrols with
  **no `station_id`**.

## 1. Scope

**In:** an `expo_pass` value on device-identity's `device_kind` enum; enrolment of a station-less expo
device; **device-authenticated expo routes** (the KDS-3 read + the pass levers, `requireDevice` +
kind-`expo_pass`); the KDS-3 expo screen gaining **device mode** (+ an enrol view); the dashboard pairing
surface offering the expo kind.

**Out:** any change to KDS-3's session-gated path (unchanged — additive) or to the `kds_station` kind; a
per-station expo (the pass is location-wide).

## 2. Data model

**No new table.** Device-identity's `device_kind` enum gains **`expo_pass`**; its `devices.station_id` is
already **nullable** (the binding) — an `expo_pass` device has it **NULL** (location-wide, scoped by the
device's `location_id`). Add a CHECK/validation that `kds_station` requires `station_id` and `expo_pass`
requires it NULL (a one-line enum-add migration via `db:generate`; re-run `inmutabilidad`). No new
columns.

## 3. Behaviour

### 3a. Enrolment (device-identity, reused)

`generatePairingCode` (device-identity) gains a `kind: 'expo_pass'` option with **no station**; `enrolDevice`
creates a `devices` row with `kind='expo_pass'`, `station_id=NULL`. Everything else — the code, the token,
the cookie, `requireDevice`, revoke — is device-identity's, unchanged.

### 3b. Device-authenticated expo routes (mirror KDS-3, device-authed)

A device group (`requireDevice`, then **assert `kind === 'expo_pass'`** → else `device.forbidden_kind`,
403): `GET /api/device/expo/queue` → KDS-3's `listExpoQueue(cfg, device.locationId)`; `POST
/api/device/expo/orders/:id/courses/:cid/fire` / `.../ready` / `.../away` → KDS-3's `fireCourse` /
`bumpCourseReady` / `markCourseAway`. Scoped to the device's **location** (it sees/acts on every station
there — that is the pass). The KDS-3 **session-gated** expo routes are unchanged (a logged-in expo still
works — additive).

## 4. Fiscal safety (H2)

**None** — an auth kind over KDS-3's non-fiscal expo. Nothing touches the fiscal path. Grep receipt.

## 5. Client — the expo screen device mode (`apps/till`)

The KDS-3 `till-expo-screen` gains **device mode** (mirroring the KDS-1 station display): when the browser
holds an `expo_pass` device cookie (probed via `GET /api/device/expo/queue` succeeding), it renders the pass
board with **no login** and drives the device expo routes; when not enrolled, it shows an **enrol view**
(enter a pairing code → device-identity's `enrolDevice`). The session-gated path (KDS-3) remains for a
logged-in operator. `TillApi.getDeviceExpoQueue` / `deviceExpoFire` / `deviceExpoReady` / `deviceExpoAway`.

## 6. Client — dashboard

Device-identity's **Devices** screen (its pairing-code generator) gains the **`expo_pass`** kind option
(generate a code for a pass display — **no station picker** for this kind). Revoke is device-identity's,
unchanged. `printer`… no — `device.manage`-gated (device-identity's permission).

## 7. Conventions

- **English identifiers** — `expo_pass` (a `device_kind` value). No new `SPANISH_WORDS`; UI copy en/es.
- **Domain error codes** — `device.forbidden_kind` (403 — a non-expo device hitting an expo route); reuse
  device-identity's `device.unauthorized`. `import "./errors.js"`. Never renamed.
- **Permissions** — `device.manage` (enrol/revoke, device-identity's); the device routes are device-authed.
  No new permission.
- No backwards-compat / data-migration code (pre-production).

## 8. Testing

- **Real Postgres / PGlite** — enrolling an `expo_pass` device (no station); the CHECK (`kds_station` needs a
  station, `expo_pass` must not have one); `requireDevice` + the kind assert (`device.forbidden_kind` when a
  `kds_station` device hits an expo route, and vice-versa); a device expo action fires/bumps/aways scoped to
  the device's location; `inmutabilidad` green after the enum-add.
- **Till** — the expo screen device mode (renders no-login when the cookie is present, enrol view when not);
  device expo actions call the device routes; the session path still works.
- **Dashboard** — the pairing generator offers `expo_pass` (no station picker).
- **Fiscal** — the H2 grep.
- Coverage **98/98/98/95** (db, server), **95/95/90/88** (till, dashboard). Run `packages/db` unfiltered;
  `TESTCONTAINERS_RYUK_DISABLED=true` locally.

## 9. Sequencing / dependencies

- **Builds on device identity-1** (`devices`, `device_kind`, pairing, `requireDevice`, the Devices screen)
  **and KDS-3** (`listExpoQueue`, `fireCourse`/`bumpCourseReady`/`markCourseAway`, `till-expo-screen`) — build
  after both. Re-verify those symbols first (CLAUDE.md §1). This completes the always-on story for both KDS
  displays (the `kds_station` screen and the `expo_pass` pass).

## 10. Provenance

Designed against the device-identity + KDS-3 designs on 2026-08-17. Reuses device-identity's `devices`/`device_kind`/pairing/`requireDevice`/Devices-screen
and KDS-3's `listExpoQueue` + expo verbs + `till-expo-screen` — all cited to those specs, re-verified against
real code in the plan once they land (CLAUDE.md §1). The only genuinely new pieces are the `expo_pass` enum
value + station-less binding, the kind-asserting device expo routes, and the expo screen's device mode.
