# SP-C — Dev per-tab device switcher (design)

**Status:** approved design, ready to plan
**Date:** 2026-09-03
**Parent:** [layout-designer-and-device-profiles](2026-09-02-layout-designer-and-device-profiles-design.md) §11 (the outline this spec fills in)
**Predecessors landed:** SP-A.1 (#194), SP-A.2 device unification (#199)

---

## 1. Goal, in one scenario

Today one browser can only be **one** device, because a device's identity is a single httpOnly
cookie shared across every tab of that browser (`waitron_device`, set on enrol, read on boot —
`apps/server/src/device-session.ts:42`/`:62`; the till boot probe is `GET /api/device/me` at
`apps/till/src/till-app.ts:585`). So a developer cannot run a **till** in one tab and a **handheld**
in another to exercise the handheld→KDS→till flow side by side.

SP-C makes each browser **tab** able to act as a different enrolled device, **in dev only**:

> Open `http://localhost:5190/?dev`. A chooser lists this venue's enrolled devices (plus an option to
> enrol a new one). Pick one; that tab reloads into the till **as that device** and behaves exactly
> as if that device's cookie were set — same profile, same till, same capabilities, same
> handheld/KDS shell. There is **no switcher chrome afterwards**: the tab is that device. To run a
> different device, open `/?dev` again in another tab.

`sessionStorage` is per-tab, so "one device per tab, permanently" falls straight out of storing the
chosen device id there.

This is a **developer convenience** with an **unauthenticated impersonation** at its core (see §4.1),
so the entire security story is the gate that switches it on: it is honoured **only** when this host
runs in the new `dev` environment (§3), and is **completely inert** — the header ignored, the dev
routes not even mounted — in `preproduction` and `production`.

---

## 2. What SP-C delivers

1. A third **`WAITRON_ENV` value, `dev`** (§3), that maps to `environment = preproduction` for every
   fiscal/AEAT/Stripe/DB-stamp consumer and additionally sets a new `config.devMode = true`.
2. A **dev-override request header** (`x-waitron-dev-device: <deviceId>`) honoured only when
   `devMode`, resolved at the single device-resolution chokepoint (`tryReadDevice`) with **no token
   check**, RLS- and `active`-scoped (§4.1).
3. A **dev-only device surface**, mounted **only** when `devMode`: a **list** the chooser reads
   (devices + the binding option-sources — §4.2) and a **mint-and-adopt** endpoint that creates a new
   device from the chooser and hands back its id (§4.3).
4. A **device-reset route** wiring the currently-orphaned `clearDeviceCookie`
   (`device-session.ts:56`) — the parent spec's §11 third bullet (§4.4).
5. A **client per-tab identity** in `sessionStorage` + header injection (§5.1) and the **chooser
   view** reached at `?dev` (§5.2).
6. The **dev run wiring**: `dev-setup.ts` emits `WAITRON_ENV=dev` (§6).

Non-goals: any change to production/preproduction behaviour; any new fiscal behaviour (§7); the
grid editor / rendering (that is SP-B); a persistent in-app switcher UI (deliberately rejected — see
§5.3).

---

## 3. The `dev` environment value (the small version)

`config.environment` is `"production" | "preproduction"` and is **fiscal-load-bearing**, not just a
runtime switch:

- It selects AEAT's endpoints and the Stripe key mode (`config.ts:502`'s own doc).
- It is written into a **locked database column**: `packages/db/src/deployment.ts:16` narrows the
  stamp to those two values precisely because `0010_deployment_stamp.sql`'s
  `deployment_environment_ck` CHECK rejects any other word (`deployment.ts:33`'s doc). The stamp is
  **immutable once written** (`stampDeployment` refuses a different value — `deployment.ts:52`).
- It is mirrored one layer down as the Veri\*Factu `Entorno` type
  (`packages/fiscal-verifactu/src/registro-row.ts`), whose domain is AEAT's fixed
  `produccion`/`pruebas`. A `dev` value has no legitimate fiscal meaning.

So SP-C does **not** widen that enum. Instead:

- **`deploymentEnvironment(env)`** (`config.ts:510`) learns a third accepted **input** string,
  `"dev"`, and **returns `"preproduction"`** for it. Any other unknown value still throws
  `server.config_invalid` (`reason: "not_a_deployment_environment"`) exactly as today.
- A new **`config.devMode: boolean`** is derived, `true` **iff** the normalized `WAITRON_ENV` is
  literally `"dev"` (same `isUnset`/trim normalization `deploymentEnvironment` applies), `false`
  otherwise.

Result, one env var in, two derived values out:

| `WAITRON_ENV`          | `config.environment` | `config.devMode` |
| ---------------------- | -------------------- | ---------------- |
| `dev`                  | `preproduction`      | `true`           |
| `preproduction`        | `preproduction`      | `false`          |
| unset                  | `preproduction`      | `false`          |
| `production`           | `production`         | `false`          |
| anything else          | *(throws)*           | —                |

`environment === "production"` and `devMode === true` are **mutually exclusive by construction**
(one needs `WAITRON_ENV=production`, the other `WAITRON_ENV=dev`); a test pins that no input yields
both (defence, §9). Nothing fiscal ever sees the word `dev`; a dev database stamps `preproduction`,
so a dev DB and a preproduction DB are indistinguishable at the stamp — no migration, no fiscal
change.

---

## 4. Server design

### 4.1 The override, resolved at the one chokepoint

Every server-side device resolution funnels through **`tryReadDevice`**
(`device-session.ts:113`) — `requireDevice`, `requireSaleTillId`, `assertNotHandheld` and
`assertDeviceCapability` all call it (`device-session.ts:198`/`:238`/`:270`/`:313`). That is the
single place the override belongs, so a switched tab behaves as its device **everywhere** — boot
probe, sales, capability firewalls — with one edit.

Behaviour, added to `tryReadDevice` and gated on a `devMode` flag threaded from config:

- **`devMode === false`** (preproduction/production): the override header is **never read**. The
  function is byte-for-byte its current self — cookie only. This is the fail-closed guarantee.
- **`devMode === true`** and the request carries `x-waitron-dev-device: <id>`:
  - The header **wins over the cookie** (an explicit override is explicit).
  - `<id>` is screened for UUID shape (`isUuid`, as the cookie selector already is —
    `device-session.ts:130`), then looked up **exactly like the cookie path**: inside
    `withTenant(tenantId)` + `asAppUser`, filtered `active = true`, selecting the same
    `DeviceBinding` columns. **No token is verified** — the trust is "in dev, name any active device
    of this tenant and become it".
  - A miss (bad shape, unknown id, revoked, or another tenant's — hidden by RLS) returns the **same
    `null`** every other miss returns, folding to `device.unauthorized` at the callers. It does
    **not** fall back to the cookie: an override that names a bad device fails, rather than silently
    using a different identity.
- **`devMode === true`** and **no** override header: the cookie path, unchanged.

Threading: `tryReadDevice`'s deps grow an optional `devMode?: boolean` (default `false`), so the
four wrappers and their call sites in `device-api.ts` pass `deps.devMode`; the narrow
`cfg: { tenantId }` shape is untouched. `mountDeviceApi`'s `DeviceApiDeps` (`device-api.ts:40`) and
the till/sale mounts grow `devMode`, fed from `config.devMode` in `boot.ts` beside the existing
`secureCookies` binding (`boot.ts:879`/`:923`).

Header name follows the lowercase-kebab precedent in the tree (`x-request-id`,
`request-id.ts:23`).

### 4.2 The dev-only device-list endpoint

The chooser needs the venue's enrolled devices **and** the option-sources it will bind a *new* device
to (§4.3) — all **before operator login** (device identity is a boot-time thing). The existing list
`GET /management-api/devices` (`device-api.ts:361`) is management-session gated (dashboard),
unreachable from the pre-login till. So SP-C adds one dev-only read that carries everything the
chooser renders:

- **`GET /api/dev/devices`** returns `{ devices, tills, stations, profiles }`:
  - `devices` — each enrolled device's `{ id, kind, label, tillId, layoutProfileId, stationId,
    active }` (all non-secret; **never** a token or reader credential), active only (a revoked device
    cannot be chosen).
  - `tills` — `{ id, name, locationId }` (a trivial tenant-scoped `tills` projection; no `listTills`
    verb exists today — a few lines).
  - `stations` — reusing `listStations(tx, cfg)` (`kitchen.ts:128`).
  - `profiles` — reusing `listProfiles(tx, tenantId)` → `{ id, name, definition }[]`
    (`packages/layouts/src/profile-store.ts:62`); the chooser shows `name` and can read
    `definition.formFactor`.
- All four reads run inside one `withTenant(tenantId)` + `asAppUser` scope, so RLS confines every list
  to this box's tenant.
- It is **mounted only when `devMode`** (a `if (deps.devMode) { ... }` dev-only mount group inside
  `mountDeviceApi`). Outside dev the route **does not exist** → a plain 404. Same fail-closed shape as
  the override: nothing to gate per-request because the surface is absent.

### 4.3 Mint-and-adopt: enrolling a new device from the chooser

A dev-only endpoint creates a fully-bound device in one call and hands back its id, so a developer can
spin up (say) a handheld bound to the counter till with a chosen profile **without bouncing to the
dashboard**:

- **`POST /api/dev/devices`** — body `{ kind, label, stationId?, tillId?, layoutProfileId? }` (the
  mint form's fields — §5.2; hardware bindings default: no printer, no drawer, `cardProvider: "none"`,
  a device needing those is still minted from the dashboard). Body-screened **exactly** as
  `POST /management-api/device-codes` already screens the same fields (`device-api.ts:281`–`:342`:
  `requireEnum` on `kind`, `requireString` on `label`, the `optionalBindingUuid` shape screens),
  reusing those screens so validation cannot drift.
- Under the hood it runs the **existing** verbs in one tenant transaction:
  `generatePairingCode(tx, cfg, { kind, stationId, tillId, layoutProfileId, … })` then
  `enrolDevice(tx, cfg, { code })`. So every binding rule is enforced unchanged — the per-kind till
  gate (`device.till_required`), the station requirement (`device.station_required`), and the
  binding FKs (`device.binding_invalid`) — with **no new validation surface**.
- It returns `{ deviceId, kind, stationId, label }` (the enrol shape, minus the token). It **does not
  set the device cookie**: the dev override is deviceId-only (§4.1), so the tab adopts the new device
  purely by writing `deviceId` to its own `sessionStorage` (§5.2) and reloading — the shared cookie is
  never touched, keeping other tabs undisturbed. (This is cleaner than routing through
  `POST /api/device/enrol`, whose whole purpose is to set that cookie.)
- **Mounted only when `devMode`**, in the same dev-only group as the list — absent (404) outside dev.

### 4.4 The device-reset route

Wire the orphaned `clearDeviceCookie` (`device-session.ts:56`), the parent spec's §11 third bullet:

- **`POST /api/device/reset`** → `clearDeviceCookie(c)` → `204`.
- **Mounted always** (not dev-gated): dropping your *own* device cookie is harmless — the device row
  is untouched and still active; the browser simply reverts to un-enrolled and can re-enrol. The
  cookie is `sameSite: "Strict"`, so a cross-site POST cannot reach it. It is generally useful (clear
  a stuck cookie identity) and the parent spec frames it as such.
- The chooser exposes it as a "reset this browser's cookie identity" action; it is orthogonal to the
  per-tab `sessionStorage` switch (which the override drives).

---

## 5. Client design (`apps/till`)

There is **no router** in the till app — it is a single-screen SPA driven by reactive state, with
overlay screens for enrolling (`till-app.ts:1867`); `main.ts` renders `<till-app>` unconditionally
(`apps/till/src/main.ts:21`). And there is **no existing `sessionStorage`/`localStorage` use** in the
app — SP-C introduces the first.

### 5.1 Per-tab identity + header injection

- **Storage:** `sessionStorage["waitron.devDeviceId"] = <deviceId>` — per-tab, persists across
  same-tab reload/navigation. Absent for a tab that never chose a device (it then uses the cookie, as
  today).
- **Injection:** wrap the `fetchImpl` passed into `TillApi` in `main.ts` (compose with the existing
  `createInstrumentedFetch(fetch, diag)` at `main.ts:21`): if `sessionStorage` holds the key, add the
  `x-waitron-dev-device` header before delegating to the real fetch. This needs **no change to
  `client.ts`** — `#request` (`client.ts:1774`) treats `fetchImpl` as opaque, so every request the
  client makes carries the header automatically. Every read wrapped in `try/catch` (a private window
  or blocked storage must degrade to "no override", never throw).

Because the header is set from `sessionStorage`, the injection is inert wherever storage is empty;
its actual honouring is still fully server-gated on `devMode` (§4.1), so shipping the wrapper is safe
even in a production bundle.

### 5.2 The chooser view

- **Reached at `?dev`:** `main.ts` checks `new URLSearchParams(location.search).has("dev")`. When
  present, it renders a new `<till-dev-chooser>` element **instead of** `<till-app>`; otherwise the
  app boots exactly as today. Using a query param, not a path, avoids depending on any SPA
  path-fallback in the dev server.
- **What it shows** (all from the one `GET /api/dev/devices` payload — §4.2): the enrolled `devices`,
  each row naming its kind, label, till and profile; a **mint form** (§4.3) — a `kind` picker, a
  `label` field, and the binding the kind needs (a `till` picker from `tills` for a `till`/`handheld`,
  a `station` picker from `stations` for a `kds_station`) plus an optional `profile` picker from
  `profiles`; and the reset action (§4.4).
- **Picking an existing device:** write `sessionStorage["waitron.devDeviceId"]`, then
  `location.assign("/")` (drop the `?dev`). The tab reloads into `<till-app>`, whose boot probe
  (`/api/till` then `/api/device/me`, `till-app.ts:511`/`:585`) now carries the header and resolves to
  the chosen device — so the existing kind-branching shell selection (`till-app.ts:586`) "just works"
  (a `handheld` boots the handheld shell, a `kds_station` the station shell, a `till` the till shell).
- **Minting then adopting:** submit the mint form → `POST /api/dev/devices` (§4.3) → write the
  returned `deviceId` to `sessionStorage` → `location.assign("/")`. The new device becomes this tab's
  identity, cookie untouched. A validation refusal (`device.till_required` etc.) renders inline on the
  form, not a nav.

If `GET /api/dev/devices` 404s (the app is not running in dev), the chooser renders a plain "dev mode
is off — set `WAITRON_ENV=dev`" message rather than an error, so hitting `?dev` against a
non-dev host is self-explanatory.

### 5.3 No post-selection chrome (rejected: a persistent badge)

An always-visible in-app "current device / switch" badge was considered and **rejected** by the
owner: the chosen model is that a tab, once it has picked a device, is simply that device with no
switcher affordances. Switching means opening `/?dev` again (typically in a new tab). This keeps the
running till identical to production and the dev seam confined to the chooser view + the storage key.

---

## 6. Dev run wiring

For the switcher to be active under `pnpm dev`, the server must boot with `WAITRON_ENV=dev`:

- `apps/server/scripts/dev-setup.ts` writes `apps/server/.env` with a `WAITRON_ENV` field (today
  `preproduction`; `dev-setup.ts:85`/`:100`). SP-C changes the emitted value to **`dev`**.
- The provisioning/stamp path in `dev-setup` still stamps **`preproduction`** — because
  `deploymentEnvironment("dev")` returns `preproduction` (§3), so the DB stamp and the fiscal records
  are unchanged. A dev venue is a preproduction venue with the switcher on.
- **Existing dev checkouts** carry a `.env` still saying `preproduction`; the switcher is inert there
  until they re-run `pnpm dev:reset` (or edit the one line). Pre-production, throwaway dev DBs — no
  migration, no data concern.

---

## 7. Fiscal boundary (H2)

SP-C introduces **no new fiscal behaviour** and needs **no new H2 receipt**:

- Outside `devMode` every path is byte-identical to today (§4.1) — the override header is never read,
  the dev routes are not mounted.
- Inside `devMode`, the override changes only **which enrolled device authenticates**. A sale then
  files under that device's `till_id` via the **unchanged** `requireSaleTillId`
  (`device-session.ts:233`) — the exact path SP-A.2 already landed. Per SP-A.2's §7/§16.4 receipt,
  `till_id` is **inert to `computeHuella`**, and `nodeId`/`seriesId` stay on the node (the SIF/chain
  key is the node, not the device — `device-session.ts:208`). The override never touches node or
  series. *(This relies on SP-A.2's landed container+mutation receipt for `till_id` inertness; SP-C
  re-pins it as a test, §9, but does not re-run that receipt.)*
- `devMode` is only ever `preproduction` fiscally, never `production` (§3, mutually exclusive), and
  only ever a local throwaway dev DB. Files written wrong under an override are recoverable exactly
  as any other preproduction dev data (CLAUDE.md §5).

---

## 8. Error codes

**No new codes.** The dev routes simply do not exist outside `devMode` (404). An override miss folds
to the existing `device.unauthorized` (`device-session.ts:199`). The reset route returns `204`. The
mint endpoint (§4.3) reuses `generatePairingCode`/`enrolDevice` and their existing codes
(`device.till_required`, `device.station_required`, `device.binding_invalid`, `station.not_found`)
plus the shared `management.request_invalid` body screens.

---

## 9. Testing

TDD, failing test first. The security assertions are the load-bearing ones — prove each by deletion
(remove the guard, watch it fail, restore).

**Config (`apps/server`, unit):**
- `deploymentEnvironment("dev") === "preproduction"`; `devMode` true iff `WAITRON_ENV=dev`; unknown
  values still throw `server.config_invalid`.
- The mutual-exclusion pin: no `WAITRON_ENV` yields `environment === "production" && devMode`.

**Override resolution (`apps/server`, real Postgres — it is a device lookup under RLS as the app
role, so PGlite's superuser cannot show the tenant scoping; CLAUDE.md §4):**
- **Fail-closed (the core proof), both `preproduction` and `production`:** a request carrying
  `x-waitron-dev-device: <valid other device id>` resolves to the **cookie's** device (or `null`),
  **never** the header's. *Prove by deletion:* drop the `devMode` gate and the same request now
  honours the header in preproduction — the failing control.
- **`devMode` honour:** with `devMode`, the header resolves to that device's binding; a sale routed
  through `requireSaleTillId` files under the **overridden** `till_id` while `nodeId`/series are
  unchanged (the §7 boundary, pinned).
- **Precedence:** header present + valid → wins over a different cookie; header present + unknown/
  revoked/malformed → `device.unauthorized`, **no** cookie fallback; header absent → cookie.
- **RLS:** an id belonging to another tenant → miss (`device.unauthorized`), the same as unknown.

**Dev surface + reset (`apps/server`):**
- `GET /api/dev/devices` returns this tenant's active `devices` (non-secret projection, **no token
  field**) plus `tills`/`stations`/`profiles`; RLS confines each list to the tenant; it is **absent
  (404) when not `devMode`** (prove by toggling the flag).
- `POST /api/dev/devices` mints-and-adopts: a valid body creates a device via
  `generatePairingCode`+`enrolDevice` and returns `{ deviceId, … }` with **no cookie set** (assert the
  response carries no `Set-Cookie`); an invalid body reuses the existing refusals
  (`device.till_required` for a till/handheld with no till, `device.station_required` for a
  kds_station with none, `device.binding_invalid` for a foreign id, `management.request_invalid` for a
  bad field). Absent (404) when not `devMode`.
- `POST /api/device/reset` clears the cookie (`Max-Age=0`, matching `Path` — mirror the existing
  `clearDeviceCookie` test at `device-session.test.ts:335`) and returns `204`.

**Client (`apps/till`, browser-mode vitest):**
- The `main.ts` fetch wrapper adds `x-waitron-dev-device` **iff** `sessionStorage` holds the key, and
  omits it otherwise; a throwing/blocked `sessionStorage` degrades to no header (no throw).
- `<till-dev-chooser>` renders on `?dev`; lists devices from `GET /api/dev/devices`; picking an
  existing device writes the storage key and navigates to `/`; submitting the mint form calls
  `POST /api/dev/devices` and writes the returned id; a validation refusal renders inline; a 404 list
  renders the "dev mode is off" message.

Per-tab isolation itself is a property of `sessionStorage` (per-tab by definition) — documented, and
covered indirectly by the header-injection unit test rather than a two-tab integration harness.

---

## 10. Files touched (orientation for the plan)

- `apps/server/src/config.ts` — `deploymentEnvironment` accepts `dev`→`preproduction`; add
  `config.devMode`.
- `apps/server/src/device-session.ts` — override branch in `tryReadDevice` (+ `devMode` dep threaded
  to the four wrappers).
- `apps/server/src/device-api.ts` — `DeviceApiDeps.devMode`; the dev-only mount group
  (`GET /api/dev/devices`, `POST /api/dev/devices`); `POST /api/device/reset`. Reuses the existing
  body screens and `generatePairingCode`/`enrolDevice` verbs; a trivial `tills` projection; and
  `listStations`/`listProfiles`.
- `apps/server/src/boot.ts` — thread `config.devMode` into the device/till/sale mounts.
- `apps/server/scripts/dev-setup.ts` — emit `WAITRON_ENV=dev`.
- `apps/till/src/main.ts` — `?dev` check → render chooser; per-tab header wrapper around `fetchImpl`.
- `apps/till/src/screens/till-dev-chooser.ts` (new) — the chooser view (list + mint form + reset).
- `apps/till/src/api/client.ts` — `getDevDevices()`, `mintDevDevice(req)`, `resetDevice()`.

---

## 11. Status

All decisions settled (enrol-new is **mint-and-adopt** — §4.3, owner call 2026-09-03). This is a
single implementation plan; the slice is small.
