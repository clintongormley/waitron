# Device enrolment & till login — redesign

**Date:** 2026-09-07
**Status:** design, pre-implementation
**Supersedes / absorbs:** the "now" half of backlog area 19 (register create at enrol, handheld
register picker, register/device wording, shift login keyed to the device's register) —
[`2026-09-05-register-and-device-model-decision.md`](2026-09-05-register-and-device-model-decision.md)
§4 first bullet. Builds on the device-profile model
([`2026-09-05-device-profile-design.md`](2026-09-05-device-profile-design.md)) and the dev per-tab
switcher (SP-C, #201).

---

## 0. The problem, from the owner's UI review

The lock screen and the `?dev` chooser were built screen-by-screen and now ask the operator things
the model already knows, twice over. The review named the whole list; the design below resolves each.

1. A device is described by **two** fields that are nearly the same thing — a `device_kind` (till /
   handheld / kitchen display) *and* a device profile — and nothing keeps them consistent. The form
   asks both.
2. The dev "mint a new device" form is a **second, divergent** enrolment path (a direct insert, no
   pairing code), so demo mode exercises code the real flow never runs.
3. There is no "which device is this browser?" front door: boot lands straight on the lock screen and
   enrolment hides under three links below the roster. The dev switcher is bolted on beside it.
4. The lock screen shows raw internal values ("Till", "Kind"), a full-width keypad that sprawls on a
   laptop, a "Back" button that should read "Cancel", and no memory of who last logged in here.
5. There is **no wrong-PIN throttle anywhere** (`docs/backlog.md` records it as an open gap;
   confirmed: the only limiter in the tree is the enrol one).

The through-line: **the profile is the single description of a class of device.** Everything else —
which shell to boot, what the device must be tied to, what money-hardware it may touch — derives
from the profile. Enrolment and login stop asking what they can derive.

---

## 1. The model change: kind derives from the profile's form factor

### 1.1 Today

- `device_kind` is a `pgEnum("device_kind", ["kds_station", "handheld", "till"])`
  ([`packages/db/src/schema/devices.ts:26`](../../../packages/db/src/schema/devices.ts)), carried on
  both `devices` and `device_pairing_codes`.
- A device profile (`device_profiles`) carries `name`, an optional `canvas_id`, and a `capabilities`
  jsonb — **no form factor of its own**
  ([`packages/db/src/schema/device-profiles.ts`](../../../packages/db/src/schema/device-profiles.ts)).
  Form factor lives on the *canvas*, and the seeded profiles bind no canvas.
- Five places read `kind` (verified, non-test):
  - `deviceFormFactor(kind)` — the canvas fallback: `till→till`, `kds_station→kds`,
    `handheld→phone-portrait` ([`apps/server/src/device.ts:135`](../../../apps/server/src/device.ts)).
  - `kindRequiresStation` / `kindRequiresTill` — the binding gates
    ([`device.ts:112,123`](../../../apps/server/src/device.ts)).
  - `assertNotHandheld` — the fiscal-write fence
    ([`apps/server/src/device-session.ts:360`](../../../apps/server/src/device-session.ts)).
  - the till boot switch — which shell to render
    ([`apps/till/src/till-app.ts:704-713`](../../../apps/till/src/till-app.ts)).
- A DB CHECK on both tables enforces the station rule off the kind:
  `(device_kind = 'kds_station') = (station_id IS NOT NULL)`
  ([`packages/db/drizzle/0001_db_baseline_sql.sql:610`](../../../packages/db/drizzle/0001_db_baseline_sql.sql)).

Every one of those five is really a question about the profile's **form factor** — the layout
package already owns exactly this vocabulary:
`FORM_FACTORS = ["till", "phone-portrait", "tablet-landscape", "kds"]`
([`packages/layouts/src/canvas.ts:9`](../../../packages/layouts/src/canvas.ts)).

### 1.2 After

**`device_profiles` gains a required `form_factor`** (a `form_factor` pgEnum over the four
`FORM_FACTORS` values). It is the profile's defining trait: a profile is "the layout, capabilities
**and form factor** of one class of screen." The three seeded starter profiles
([`packages/layouts/src/device-profile.ts`](../../../packages/layouts/src/device-profile.ts)) already
name their form factor in code (`DefaultDeviceProfile.formFactor`); that value now persists on the
row instead of being discarded.

**`devices` loses `device_kind`; `device_profile_id` becomes `NOT NULL`.** A device is now defined by
its profile. The three-way "kind" the rest of the code still wants is derived:

```ts
// packages/layouts (beside FORM_FACTORS) or apps/server/src/device.ts
export function kindOfFormFactor(ff: FormFactor): DeviceKind {
  switch (ff) {
    case "kds": return "kds_station";
    case "till": return "till";
    case "phone-portrait":
    case "tablet-landscape": return "handheld";
  }
}
```

`DeviceKind` stays as a **type** (the three consumers above read it), but no longer a column. Each of
the five readers takes the device's form factor (resolved through its profile) and calls
`kindOfFormFactor` where it wants the old value. `deviceFormFactor(kind)` — which mapped kind→form
factor — is deleted; the form factor is now the source, not the derivation.

`device_pairing_codes` loses `device_kind` too (see §3 — a key carries no bindings at all).

### 1.3 The station / register rule moves to a trigger through the profile

The old CHECK cannot express "read the profile's form factor" (a CHECK is per-row). Replace it with a
constraint trigger on `devices`:

- form factor `kds` ⇔ `station_id IS NOT NULL` and `till_id IS NULL`;
- any other form factor ⇔ `station_id IS NULL` and `till_id IS NOT NULL`.

The trigger joins to `device_profiles` on `(tenant_id, device_profile_id)` to read the form factor.
It is an ordinary integrity trigger (not `reject_mutation` — `devices` is a `state` table, not a
`ledger`), classified per the swap design; run the `inmutabilidad` trigger scan after adding it.

**Drift guard:** a second trigger on `device_profiles` refuses an `UPDATE` of `form_factor` while any
`active` device references the profile — so a profile and its devices can never disagree. Changing a
live device's class is done by re-pointing it at a different profile, not by mutating the profile
under it.

### 1.4 Why delete the column rather than stamp a copy

Pre-production (CLAUDE.md §"No backwards-compatibility"): schema drops and recreates, so there is no
migration cost to deletion. A stamped copy of the kind on the device row is a second source of truth
that drifts the moment a profile is edited — exactly the defect class §0.1 names. One source: the
profile.

---

## 2. Enrolment: a key is just a key

### 2.1 Today the pairing code carries the whole device description

`device_pairing_codes` carries `device_kind`, `station_id`, `till_id`, `device_profile_id`, the
hardware trio and `label` — the manager fills all of it in the dashboard "generate code" form
([`apps/dashboard/src/screens/devices-screen.ts`](../../../apps/dashboard/src/screens/devices-screen.ts)),
the device just types the code and is stamped. The device describes nothing about itself.

### 2.2 After: the device describes itself; the key only authorises

`device_pairing_codes` sheds every binding column. A code row is: `id`, `tenant_id`, `location_id`,
`code_sha256`, `created_at` — a bearer token scoped to a venue, 15-minute TTL, single use, exactly the
security shape it has now (~40-bit Crockford code, SHA-256 lookup, locking `DELETE … RETURNING`).

Two server calls, matching the two enrolment screens:

1. **`POST /api/device/enrol/verify {code}`** — unauthenticated, behind `enrolLimiter`. Validates the
   code **without consuming it** (a plain `SELECT` on `code_sha256`, TTL-checked in code, no DELETE).
   Returns the catalogue the second screen needs:
   `{ profiles: [{id, name, formFactor}], stations: [{id, name}], registers: [{id, name}] }`.
   Holding a live key is the authorisation to read that catalogue. A missing/expired code →
   `device.pairing_invalid` / `device.pairing_expired` (existing codes).

2. **`POST /api/device/enrol {code, name, profileId, stationId?, registerId?}`** — unauthenticated,
   behind `enrolLimiter`. Consumes the code (the existing locking `DELETE`), then:
   - resolves the profile → its form factor;
   - for a `kds` profile: requires `stationId`, ignores `registerId`;
   - for any other: requires `registerId`, ignores `stationId`; **and if the profile is `till`,
     creates a register** (a `tills` row) named after the device at the device's location, then binds
     the device to it — the owner's rule 1 ("nobody sets up a register by hand"). A phone/tablet
     profile binds to a `registerId` the operator picked (rule 2, defaulting to the location's only
     register — see §2.3).
   - inserts the `devices` row (`device_profile_id` set, `station_id` XOR `till_id` per the trigger),
     mints the token, sets the `waitron_device` cookie.

   The response drops `kind` (gone) and returns `{ deviceId, name, formFactor }` for the confirmation
   view. Register auto-creation and the device insert share **one** `withTenant` transaction, so a
   failed enrol leaves no orphan register (CLAUDE.md §3, "multi-table writes share one transaction").

   Hardware (receipt printer, cash drawer, card provider/reader) is **not** collected at enrolment —
   it is bound afterward from the dashboard (§4). The profile's capabilities already say whether the
   device *may* take card / open a drawer; the concrete hardware is per-device config.

The `till`-only "create a register at enrol" rule means a counter till's step 2 asks only **Name** and
**Profile** — no station, no register. A handheld adds a register picker; a kitchen display a station
picker.

### 2.3 The location default

`GET /api/device/enrol/verify` returns the venue's registers and stations. When there is exactly one
register the handheld picker defaults to it and may be left untouched (rule 2); the same for a single
station. A single-location deli is the common case, so most enrolments never touch these pickers.

### 2.4 Dev mode: one flow, key step skipped

`DEV_PAIRING_CODE = "DEMO"` stays. In dev mode:

- `/api/device/enrol/verify` and `/api/device/enrol` accept `DEMO` as a live, reusable, no-TTL code
  (the current dev branch, generalised from "enrol the counter till" to "run the real flow"). `DEMO`
  makes `verify` return the catalogue and `enrol` run the real insert — the demo "Set up a new device"
  screen **is** the production enrolment screen with the key pre-filled.
- `enrolDevTill` (the old dev-only direct-insert-the-counter-till helper) is **deleted**, along with
  the `POST /api/dev/devices` mint route and `POST /api/device/reset`. Demo mode no longer has a
  second enrolment path.

---

## 3. The till: a device front door

### 3.1 Boot decision

Replace the current boot (which always renders the lock screen, with enrolment hidden under it) and
the `?dev` fork with one decision in `main.ts` / `till-app` boot:

| Condition | Screen |
|---|---|
| dev mode **and** this tab has no device (`sessionStorage` empty) | **device chooser** (§3.2) |
| not enrolled (no cookie, not dev, `GET /api/device/me` → 401) | **enrolment, step 1** (the key) |
| enrolled, form factor `kds` | boot straight into the kitchen kiosk (unchanged) |
| enrolled, any other | **login screen** (§3.4) |

`GET /api/device/me` returns the device's `formFactor` (derived) in place of `kind`; the boot switch
calls `kindOfFormFactor` if it still wants the three-way value.

**Removed:** the `?dev` query flag, the three "Set up as …" links under the roster
([`till-lock-screen.ts:249`](../../../apps/till/src/screens/till-lock-screen.ts)), the standalone
`till-device-enrol-screen` parameterised by kind (folded into §3.3), the dev mint form and
"Reset this browser's cookie identity" button in the chooser.

### 3.2 The device chooser (dev only)

The front door for demo mode. Two sections:

- **Select a device** — the enrolled devices (`GET /api/dev/devices`, still dev-gated), each row
  `name · profile · station-or-register` with a "Use this device" button that writes the device id to
  the tab's `sessionStorage` and navigates to `/` (→ login screen for that device). This is how one
  tab is device X and another device Y: the per-tab `sessionStorage` id, sent as the
  `x-waitron-dev-device` header, which the server trusts over the cookie in dev mode (SP-C, unchanged).
- **Set up a new device** — collapsed by default; expands to the §3.3 enrolment screen at **step 2**
  with `DEMO` sent for the verify call automatically. After enrolling, the new device id is written to
  this tab's `sessionStorage` (so the fresh device stays this tab's identity rather than overwriting
  the browser cookie).

**Follow-up (2026-09-07):** User review moved the step-2 form into a modal with an explicit Cancel
action. The chooser and standalone enrolment form are centred, and front-door screens retain `/`
instead of publishing the canvas's first `/tabs/*` route before login.

The login screen carries a small **"Switch device"** link in dev mode only, which clears this tab's
`sessionStorage` device and returns to the chooser — the replacement for the removed reset button,
scoped to the tab.

### 3.3 The enrolment screen (production + demo)

One screen, two steps:

- **Step 1 — the key.** A single field for the enrolment key → `POST /api/device/enrol/verify`. On
  success, advance to step 2 with the returned catalogue. (In the demo "set up" path this step is
  skipped: `DEMO` is verified for you.)
- **Step 2 — describe this device.** **Name** (text), then **Profile** (a `<select>` of the venue's
  profiles by human name). Then, driven by the chosen profile's form factor: a **station** picker
  (`kds`) or a **cash register** picker (phone/tablet, defaulting to the sole register); a counter
  **till** profile shows neither. "Set up device" → `POST /api/device/enrol`.

No hardware pickers here (§2.2). Human labels throughout — no `kds_station`, no `till` literal shown.

### 3.4 The login screen

Rework of [`till-lock-screen.ts`](../../../apps/till/src/screens/till-lock-screen.ts):

- **Heading:** the device's name (from `GET /api/device/me`).
- **"Login as"** `<select>`, alphabetical (already, `listActiveStaff` orders by display name),
  **defaulting to the last person who logged in on this device** — remembered in `localStorage` keyed
  by device id (`waitron.lastOperator.<deviceId>`), written on a successful login. Per-device key so
  each demo tab remembers its own device's last operator.
- **The keypad appears as soon as a person is selected** (immediately, when there is a remembered
  default). Layout in PIN mode: `1 2 3 / 4 5 6 / 7 8 9 / (blank) 0 ⌫` — a phone dialpad, top-to-bottom.
  The cash-amount pad (`numeric-pad` in non-`pin` mode) keeps its calculator order `7 8 9 / …`; only
  the PIN ordering flips. This is a `mode`-dependent key ordering in
  [`numeric-pad.ts`](../../../apps/till/src/widgets/numeric-pad.ts).
- **Width:** the whole form is capped (~24rem) and centred, so the keypad no longer spans a laptop.
- **"Back" → "Cancel"** (`t("action.back")` → a cancel string); clears the selection and PIN.
- **Wrong-PIN throttle** (§5): on a throttled response the keypad greys and shows "Try again in Ns"
  counting down; cleared on success.
- **On-duty / others split:** noted for later, not built now (the roster is one flat alphabetical
  list, as today).

### 3.5 Dev seeding

`dev:setup` pre-creates **three** devices — one per seeded profile (Counter till + its auto-created
register, Kitchen display + a seeded station, Handheld + the counter's register) — so demo mode has a
till, a handheld and a kitchen display in the chooser on first run. It creates these by running the
real enrol path with `DEMO` (not a direct insert), so seeding exercises the shipping code.

---

## 4. Dashboard

- **Devices screen** ([`devices-screen.ts`](../../../apps/dashboard/src/screens/devices-screen.ts)):
  the "generate code" form collapses to a single **"Generate enrolment key"** button (no kind, no
  station/till/profile/hardware fields — the key carries none of it). Device rows show
  `name · profile · station-or-register`.
- Because hardware left the pairing code, each device row gains an **edit-hardware** control (receipt
  printer, has-cash-drawer, card provider + reader), backed by a new
  **`PATCH /management-api/devices/:id/hardware`**. This is the scope cost of the bare key: hardware
  binding moves from "baked into the code" to "edited on the device after it exists." (Profile
  assignment already has `POST /management-api/devices/:id/assign-device-profile`.)
- **Profile editor** (create/edit under `/management-api/device-profiles`): a **form-factor** picker
  with human labels (Cash register / Handheld phone / Handheld tablet / Kitchen display).
- **Wording:** "Till" → **"Cash register"** in both apps' strings (the register/device decision doc
  said "Register"; the owner's UI review overrides it to "Cash register"). This is the
  `devices.till`→register rename that decision doc §4 queued, with the owner's chosen word.

---

## 5. Wrong-PIN throttle

**Scope:** per **(device, person)**. A prankster mashing one till locks only that pairing on that
screen; the victim walks to another device. An attacker gains only as many parallel guesses as the
venue has devices — a handful. (Not per-person: that lets one screen lock a colleague out everywhere.
Not per-device: that lets one bad actor's fumbling block a whole till.)

**Shape:** three free failures, then a doubling wait — 2s, 4s, 8s, 16s, 32s, capped at 60s. Cleared by
a successful login **or** by 15 minutes of no attempts on that pairing.

**Where:** in the server's memory (a small map keyed by `deviceId:personId`, pruned by the 15-minute
idle rule), the same shape as `enrol-rate-limit.ts`. The box is the only thing the till talks to, so
there is nothing to share across processes; a restart clearing the state is acceptable (it only ever
*relaxes* a throttle). **Not** in the database — a throttle write on the login path must never contend
with the sale path (CLAUDE.md §5).

**Wire:** `POST /api/session` checks the throttle for `(device, person)` before `loginWithPin`. Inside
the window it refuses with a **new** error code `pin.throttled`, carrying `retryAfterSeconds` in the
error payload. A wrong PIN records a failure and (past the 3 free) starts/extends the window;
`pin.invalid` is unchanged (codes are never renamed — CLAUDE.md §3). The device is resolved from the
cookie/header exactly as the sale routes resolve it, so the throttle keys off the real device.

The countdown the till shows is courtesy; the server is the gate.

---

## 6. Shift login keyed to the device's register

`POST /api/session` today stamps `deps.cfg.tillId` — the box's env register — on the session
([`till-api.ts:521`](../../../apps/server/src/till-api.ts)), so a handheld's shift names the wrong
register. `sessions.till_id` is `NOT NULL` and nothing reads it yet
([`sessions.ts:17`](../../../packages/identity/src/schema/sessions.ts)), so this is latent, not a
live bug — but the route is being reworked for §5 anyway.

Change: resolve the device from the request (the same `tryReadDevice` the throttle uses) and pass its
`till_id` to `loginWithPin` instead of `deps.cfg.tillId`. A kitchen display never reaches this route
(cookie-only, no roster login), and every sale-capable device has a non-null `till_id` by the §1.3
trigger, so the `NOT NULL` column is always satisfied. This retires the env register from the login
path, as the register/device decision §1 rule 5 called for.

---

## 7. What is explicitly out of scope

- The on-duty / off-duty split of the roster (§3.4) — a later step.
- The `tills.receipt_printer_id` vs `devices.receipt_printer_id` "one meaning per hardware column"
  rename — that waits for Track A's squash (decision doc §4, second bullet); this design only *adds*
  the per-device hardware edit, it does not touch the register's printer column.
- Any change to `sales.till_id` / `registros_facturacion.till_id` semantics — unchanged; the register
  snapshot on a fiscal record is inert to the chain, and this design does not touch it.
- Multi-currency, real cloud hosting, promotion — unrelated.

---

## 8. Testing

**Real Postgres (privileges/triggers require it — CLAUDE.md §4):**

- the §1.3 device trigger: a `kds` profile with a null station is refused; a non-`kds` profile with a
  null register is refused; the happy XOR passes. Prove by deletion (drop the trigger → the bad row
  inserts).
- the §1.3 drift guard: updating a profile's `form_factor` while an `active` device references it is
  refused; with no active device it succeeds.
- register auto-creation: enrolling a `till` profile creates exactly one `tills` row named after the
  device, in the same transaction (a forced failure after the register insert leaves no register).
- `inmutabilidad` trigger scan green after the schema change; the new `devices` trigger is classified.

**Server (e2e / unit):**

- `verify` returns the catalogue without consuming the code; `enrol` then consumes it (a second
  `enrol` with the same code → `device.pairing_invalid`).
- `verify`/`enrol` accept `DEMO` only in dev mode; outside dev mode `DEMO` misses.
- the throttle on a fake clock: 3 free failures, then 2s/4s/…/60s cap; `pin.throttled` carries
  `retryAfterSeconds`; a success clears it; 15 idle minutes clear it; the key is `(device, person)`
  (a second person on the same device is unthrottled; the same person on a second device is
  unthrottled).
- `POST /api/session` stamps the **device's** register, not `cfg.tillId` (a handheld bound to
  register B, box env register A → session names B).
- `PATCH /management-api/devices/:id/hardware` sets the trio; rejects unknown card providers.

**Browser — till** (real Chromium; check machine headroom first — CLAUDE.md §4):

- chooser → "Use this device" → login screen for that device; two tabs, two devices.
- enrolment step 1 → step 2; profile choice drives the station-vs-register picker; counter till shows
  neither.
- login: remembered default selected on load, keypad shown immediately; PIN pad order
  `1 2 3 / 4 5 6 / 7 8 9 / _ 0 ⌫`; throttle countdown greys the pad; Cancel clears.

**Browser — dashboard:**

- the "Generate enrolment key" button (no binding fields); device-row hardware edit; profile
  form-factor picker.

**Guards:** english-only stays green (app-side Spanish identifiers remain review-only — CLAUDE.md §3);
`errors-reachable` sees the new `pin.throttled` (registered in the right `errors.ts`); `module-seams`
unaffected.

---

## 9. Open questions for the plan

- **Where `kindOfFormFactor` lives** — `packages/layouts` (beside `FORM_FACTORS`) so both server and
  the layout consumers import it, vs `apps/server/src/device.ts` beside the predicates it feeds. Lean
  layouts; the plan confirms after checking the import graph (layouts must not gain a forbidden dep).
- **Register naming at auto-create** — "after the device" means the device `name` verbatim; if a
  register of that name exists at the location, suffix or reject? Lean: reject with a clear error, the
  operator picks a different device name (registers are rarely duplicated in a small venue).
