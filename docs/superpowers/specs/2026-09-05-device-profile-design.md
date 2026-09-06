# Device profile — design

- **Date:** 2026-09-05
- **Track:** Layout designer & device profiles (owner-inserted 2026-09-02) — the deferred *device
  profile* follow-on recorded in `2026-09-04-sp-b3-2-canvas-editor-design.md` §10 and backlog
  "SP-B → Deferred follow-on — device profile".
- **Status:** design, approved in brainstorming 2026-09-05 (two owner decisions below); spec pending
  owner review before the implementation plan.

---

## 1. Summary & scope

Today a device points **straight at a canvas** and carries its **capabilities on that canvas**
(`CanvasDef.capabilities`, `canvas.ts:71`). This slice inserts a first-class **device profile**
between them, so the chain becomes:

```
device  ──▶  device_profile  ──▶  canvas
(kind,       (name,               (formFactor,
 till_id,     canvas_id,           tabs → cards)
 hardware,    capabilities[])
 station,
 …)
```

A **device profile** is a reusable, tenant-wide bundle. This slice gives it exactly two payloads: a
**canvas reference** and a **capabilities set**. It relocates capabilities **off the canvas record**
onto the profile — the move the canvas-editor spec called out as "expected, not a surprise"
(`2026-09-04-sp-b3-2-canvas-editor-design.md` §2). The device stops carrying `canvas_id`; it carries
`device_profile_id`, and its canvas *and* capabilities both resolve through the profile.

**In scope (owner: "skeleton + capabilities", 2026-09-05):**

- `device_profiles` table (`name`, `canvas_id`, `capabilities`), tenant-scoped, RLS.
- `devices` / `device_pairing_codes`: `canvas_id` → `device_profile_id` (replace, not coexist — owner
  decision 2026-09-05).
- Capabilities removed from `CanvasDef`; resolution + server enforcement + render axis read them
  from the profile.
- Enrolment carries a device profile; a post-enrol reassign route; the CRUD API.
- Dashboard: a device-profile editor; the canvas editor loses its Capabilities section; the devices
  screen assigns a device profile.
- `dev:setup` seeds and assigns a default device profile so the dev till stays sale-capable.

**Out of scope (deferred to a later device-profile slice, unchanged today):**

- Relocating **till_id**, **station_id**, and the **hardware trio** (`receipt_printer_id`,
  `has_cash_drawer`, `card_provider`, `card_reader_id`) off the device onto the profile — they stay
  **per-device** columns, set at enrolment, exactly as SP-A.2 shipped them.
- **Area**, **order-routing**, **printer target** as *aggregated* profile fields (the fuller bundle
  in the parent design). Not built here.
- Theme editing. Live card renders. NFC pairing.

**Fiscal:** **not fiscal.** No table in this slice is a `registros_facturacion`/fiscal table; the
sale path's `till_id` still resolves from the authenticated **device** (`requireSaleTillId`,
`device-session.ts:286`), and the fiscal chain stays keyed on the **node** (`series.ts:19`, memory
[sif-is-the-submitting-node]). This slice touches neither. It **does** touch the sale-capability
firewall (`assertDeviceCapability`, `/api/pay` gate) — that is a security surface, tested by mutation
and container, but it is not a fiscal invariant.

---

## 2. Terminology & model

- **Canvas** — the **display**: a `formFactor` + 1+ tabs of cards (`CanvasDef`, `canvas.ts:71`).
  Reusable, authored in the dashboard canvas editor. **After this slice it no longer carries
  `capabilities`.**
- **Device profile** — the **binding bundle** a device *uses*: a **name**, a **canvas reference**,
  and a **capabilities set**. Reusable and tenant-wide (like a canvas — *not* location-scoped). A
  device *uses* a device profile; the device profile *uses* a canvas.
- **Capability** — a per-**physical-device** permission flag (`CAPABILITY_FLAGS`, `canvas.ts:37`):
  exactly `integrated-card-payment`, `open-cash-drawer`, `act-as-kds` today. Two readers:
  1. **Server firewall** — `assertDeviceCapability` refuses `/api/pay`
     (`till-api.ts:849`) and `/api/drawer/open` (`till-api.ts:1316`) unless the device holds the
     flag. **Fail-closed** (CLAUDE.md §5): a device that cannot be shown to hold it is refused.
  2. **Render axis** — a card declaring `requiredCapability` (`card-contract.ts:60,104`:
     `tender-pay` → `integrated-card-payment`, `kds-board` → `act-as-kds`) is **hidden** on a device
     lacking the flag (`card-grid.ts:159`) — **except** `tender-pay`, which has a pre-existing
     always-render cash carve-out (`card-grid.ts:157`, SP-B2.1 / #206) so the card itself always shows
     for the cash path (its integrated-card option is separately gated). So of today's two capability
     cards only `kds-board` is actually hidden by this axis.

     > **Correction, 2026-09-05.** This bullet and §5.3 previously said a no-profile / absent-flag
     > device HIDES both `tender-pay` and `kds-board`. That **overstated** the render effect:
     > `card-grid.ts:157` short-circuits `#capable` to `true` for `tender-pay` (the cash path is
     > sale-critical and never gated absent — SP-B2.1 / #206), so `tender-pay` **always renders**.
     > Only `kds-board` — a capability card with **no** cash carve-out — is hidden. The server firewall
     > still fail-closed refuses the underlying integrated-card and drawer operations regardless of what
     > the grid drew (§2 reader 1), so the fiscal/cash paths are unchanged; only which *card* is drawn
     > differed from the original prose.

  Capabilities are facts about the **box** (does it have a reader / a drawer / act as a kitchen
  screen), not about the layout — which is why they belong on the device profile, not the canvas.
  This slice moves the existing three; it adds none.

---

## 3. Decisions resolved in brainstorming (2026-09-05)

- **Scope = skeleton + capabilities** (owner). The entity plus the two assignment links, and the
  capability relocation. Till/station/hardware stay per-device; area/routing/printer aggregation
  deferred.
- **Canvas reference = replace, not coexist** (owner). Drop `devices.canvas_id` /
  `device_pairing_codes.canvas_id`; a device carries only `device_profile_id`. Its canvas AND
  capabilities resolve **through** the profile. Pre-production makes the column move free (CLAUDE.md
  §5 "no backwards-compatibility until production"; no backfill).
- **No-profile fallback = the current fail-closed shape.** A device with `device_profile_id = NULL`:
  - **capabilities:** none ⇒ every `assertDeviceCapability` refuses — identical to today's "no
    assigned canvas ⇒ refuse" (`device-session.ts:369-371`).
  - **canvas (render):** the **form-factor default** canvas (`getCanvasForFormFactor`,
    `canvas-store.ts:187`), with **`capabilities: []`** handed to the render axis — capability cards
    hidden. See §5.2 for the one behaviour change this introduces at the render axis and why it is
    acceptable.
- **Capabilities storage = a validated `jsonb` array + `canvas_id` as a real FK column** (recommended,
  owner-confirmed). Not boolean columns, not buried in a `definition` blob. Keeping `canvas_id` a real
  column preserves the composite-FK RESTRICT protection the binding idiom relies on.
- **Type/validation home = `@waitron/layouts`** (owner-confirmed). It already owns `CAPABILITY_FLAGS`;
  a small `device-profile.ts` module is enough for this slice. A future aggregated bundle
  (area/routing/printer) may warrant its own package; not now.
- **The canvas editor drops capability editing entirely** (owner-confirmed) — relocated to the
  device-profile editor, not shown read-only.

---

## 4. Current state (grounded)

Verified against the tree on 2026-09-05.

### 4.1 Model (`@waitron/layouts`)

*(The **model** modules below — `canvas.ts`, `card-contract.ts`, `validate-canvas.ts`,
`default-canvases.ts` — are pure/DB-free. The package as a whole is **not**: `canvas-store.ts`
imports `@waitron/db` + `@waitron/identity`, so `@waitron/layouts` depends on `@waitron/db`
(`package.json:15`). The dashboard therefore never runtime-imports the package — it deep-imports the
pure modules and mirrors them, the #70 bundle rule.)*
- `CanvasDef { formFactor; tabs; capabilities: CapabilityFlag[]; theme? }` — `canvas.ts:71`.
- `CAPABILITY_FLAGS` (3) — `canvas.ts:37`. `CardContract.requiredCapability` — `card-contract.ts:23`
  (`tender-pay`:60, `kds-board`:104).
- `validateCanvas` reads `input.capabilities` via `validateCapabilities` — `validate-canvas.ts:45`.
- `DEFAULT_CANVASES[formFactor].capabilities` — `default-canvases.ts`: **till** =
  `["integrated-card-payment","open-cash-drawer"]` (:13), **kds** = `["act-as-kds"]` (:76),
  phone/tablet = `[]` (:38,:57). **These four values are what must relocate to default device
  profiles / dev seed (§8).**
- `getCanvasForFormFactor` — `canvas-store.ts:187` (tenant's first of a form factor, else built-in
  default).

### 4.2 Storage (`packages/db`)
- `canvases` — `schema/canvases.ts:26`: `id`, `tenant_id`, `name`, `definition jsonb`, timestamps;
  uniques `(tenant_id,id)` + `(tenant_id,name)`; `.enableRLS()`. Custom RLS/grants in `0102`.
- `devices` / `device_pairing_codes` — `schema/devices.ts:53,141`: both carry `canvas_id` (:84,:169)
  as a bare uuid with a composite `(tenant_id, canvas_id) → canvases` FK (RESTRICT/MATCH SIMPLE,
  `devices_canvas_fk`), plus `till_id`, `station_id`, and the hardware trio. Uniques `(tenant_id,id)`;
  `.enableRLS()`; custom RLS/grants/FKs in `0061`/`0095`/`0102`.

### 4.3 Server (`apps/server`)
- **Resolution** `/api/till` — `till-api.ts:668-687`: enrolled device → `getCanvas(canvas_id)` else
  `getCanvasForFormFactor(deviceFormFactor(kind))`; cookieless → `till` default. Capabilities travel
  embedded in the returned `CanvasDef`.
- **Enforcement** `assertDeviceCapability` — `device-session.ts:359-390`: reads `device.canvasId`
  (null ⇒ refuse), resolves the canvas, checks `canvas.definition.capabilities.includes(flag)`.
- **Enrolment** `enrolDevice` — `device.ts:326`: locking `DELETE … RETURNING` on the pairing code,
  copies **every binding verbatim** (incl. `canvas_id`) onto the new `devices` row.
- **Mint** `generatePairingCode` — `device.ts:201`: stamps kind + bindings onto a pairing code; maps
  binding `23503` → `device.binding_invalid` via `bindingFkField` (:177) / `BINDING_FK_FIELD` (:158).
- **Reassign** `POST /management-api/devices/:id/assign-canvas` — `device-api.ts:432`:
  `UPDATE devices SET canvas_id`, `device.manage`-gated, FK violation → `device.binding_invalid`.
- **Canvas CRUD** — `management-api.ts:859-987` (`/management-api/canvases[/:id]`), store
  `canvas-store.ts` (`listCanvases`/`getCanvas`/`createCanvas`/`updateCanvas`/`deleteCanvas`).

### 4.4 Dashboard (`apps/dashboard`)
- Canvas editor — `screens/canvas-editor-screen.ts`; the **Capabilities** section at :1168-1180
  (draft.capabilities checkboxes), warning derivation at :1050, i18n key `canvas_editor.capabilities`
  (`i18n/strings.ts:576,1090`).
- Devices screen — `screens/devices-screen.ts`: mint form (kind + bindings incl. canvas) + per-row
  canvas reassign `<select>`; client `DeviceRow.canvasId` (`api/client.ts:589`), `reassignDevice`
  (:1860), `createDeviceCode` bindings (:1797-1805).

### 4.5 dev seed
- `apps/server/scripts/dev-setup.ts` mints a `till` pairing code (memory
  [sp-a2-device-unification-landed]: "DEV must enrol the counter till once via the printed pairing
  code").

---

## 5. Data model

### 5.1 New table `device_profiles` (`packages/db/src/schema/device-profiles.ts`)

Mirrors the `canvases` idiom (CLAUDE.md §3 — tenant table, composite-FK target, hand-written FORCE
RLS + policy + grants in a paired `--custom` migration):

| column | type | notes |
|---|---|---|
| `id` | `uuid` PK `defaultRandom` | |
| `tenant_id` | `uuid` NOT NULL | FK → `tenants.id` `onDelete restrict` (the `.references` two-arg form, v8-ignored, as `canvases.ts`) |
| `name` | `text` NOT NULL | human label, unique per tenant |
| `canvas_id` | `uuid` NULL | **bare** uuid; composite `(tenant_id, canvas_id) → canvases(tenant_id, id)` FK, `ON DELETE RESTRICT`, `MATCH SIMPLE`, **hand-written** in the `--custom` migration. NULL ⇒ resolve the form-factor default canvas (§5.2). |
| `capabilities` | `jsonb` NOT NULL `DEFAULT '[]'` | a `CapabilityFlag[]`; validated in code by `validateCapabilities` (§7). Plain `jsonb`, **not** `$type<>`-annotated — the same `@waitron/layouts`→`@waitron/db` circular-dep avoidance `canvases.definition` uses. |
| `created_at`, `updated_at` | `timestamptz` NOT NULL `defaultNow` | |

Constraints: `unique(tenant_id, id)` (the composite-FK target for `devices`/`device_pairing_codes`)
and `unique(tenant_id, name)`. `.enableRLS()`.

**Why `canvas_id` NULLABLE.** A profile that says "default canvas + these capabilities" is legitimate
(e.g. a till that hasn't authored a bespoke canvas yet but needs the reader capability). Mirrors
today's nullable `devices.canvas_id`. MATCH SIMPLE skips the FK check on NULL.

**Custom migration** (`--custom`, paired): `FORCE ROW LEVEL SECURITY`;
`CREATE POLICY device_profiles_tenant_isolation … USING/WITH CHECK (tenant_id = current_tenant_id())`;
`REVOKE ALL` then `GRANT SELECT, INSERT, UPDATE, DELETE ON device_profiles TO app_user` (the
`canvases` grant shape — DELETE included: a profile is deletable when unreferenced, RESTRICT blocks
deleting a referenced one); the composite `device_profiles_canvas_fk`. `inmutabilidad`
(`packages/fiscal-verifactu`) scans every `tenant_id`-bearing table for both RLS flags, so a missing
FORCE fails that suite (CLAUDE.md §3 — run `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad`
after adding this table).

### 5.2 `devices` / `device_pairing_codes` change

Both tables: **drop** `canvas_id` and its `devices_canvas_fk` / `device_pairing_codes_canvas_fk`;
**add** `device_profile_id` (`uuid` NULL, bare) with a composite
`(tenant_id, device_profile_id) → device_profiles(tenant_id, id)` FK, `ON DELETE RESTRICT`, `MATCH
SIMPLE`, named `devices_device_profile_fk` / `device_pairing_codes_device_profile_fk`. Nullable ⇒ a
device may carry no profile (fail-closed for capabilities; form-factor default for the render canvas).

### 5.3 Resolution & fallback (the contract)

For an enrolled device:

| | `device_profile_id` set → profile resolves | `device_profile_id` NULL |
|---|---|---|
| **canvas (render, `/api/till`)** | `profile.canvas_id` → `getCanvas`; if `canvas_id` NULL → `getCanvasForFormFactor(deviceFormFactor(kind))` | `getCanvasForFormFactor(deviceFormFactor(kind))` |
| **capabilities (render + firewall)** | `profile.capabilities` | `[]` (render) / refuse (firewall) |

**The one behaviour change, called out.** Today a device rendering the **default** till canvas gets
that canvas's baked-in capabilities at the render axis (`till-app.ts:2129` reads
`this.canvas?.capabilities`), so capability cards *show* on a default-canvas till even though the
**server firewall already refuses** the underlying action for a device with no explicit canvas
(`device-session.ts:369`). After this slice, capabilities at the render axis come from the **profile**,
so a **no-profile** device renders the default canvas with `capabilities: []` and a capability card
**without a cash carve-out is hidden** — today that is only `kds-board`. `tender-pay` is **not**
hidden: `card-grid.ts:157` always renders it for the cash path (SP-B2.1 / #206), a pre-existing
carve-out this slice does not touch (its integrated-card option remains separately gated, and the
firewall still refuses `/api/pay` for a no-profile device). This makes render and firewall agree for
the gated cards (a `kds-board` whose action would be refused is no longer drawn) — strictly *more*
correct, and the reason `dev:setup` must seed+assign a profile (§8) so the dev till still shows and
can use its reader/drawer. Pin this with a test (§9). See the dated correction under §2 — the original
prose here overstated the change as hiding `tender-pay` too.

---

## 6. Migrations

Pre-production ⇒ drop/recreate is allowed (CLAUDE.md §5); **no backfill** for the `canvas_id` →
`device_profile_id` move. Generated with `drizzle-kit generate` for the modelled table + column moves
and `drizzle-kit generate --custom` for the RLS/policy/grant/FK half (the `canvases`/`devices`
precedent). Watch the migration-number rebase collision trap (memory
[drizzle-migration-rebase-collision]): if `main` moves, reset `drizzle/` to main, keep the schema TS,
re-run `db:generate` + `db:generate:custom`, and re-verify RLS + `inmutabilidad`.

Order within the migration set (the module-dependency graph, CLAUDE.md §3 — FK edges): the
`device_profiles` table + its RLS must migrate **before** the `devices`/`device_pairing_codes`
`device_profile_id` FK that targets it (`CREATE TABLE` before the referencing FK; there is no trigger
edge here).

---

## 7. `@waitron/layouts` — capability relocation

- **Remove** `capabilities` from `CanvasDef` (`canvas.ts:71`) and from `validateCanvas`
  (`validate-canvas.ts:45`). `validateCanvas` no longer reads or emits it.
- **New module `device-profile.ts`**: export `validateCapabilities(input: unknown): CapabilityFlag[]`
  (moved from `validate-canvas.ts`, fail-closed, rejects unknown flags → a new
  `device_profile.invalid` param shape) and `DEFAULT_PROFILE_CAPABILITIES: Record<FormFactor,
  CapabilityFlag[]>` seeded from the values §4.1 lists (the source of the `dev:setup` seed and any
  built-in default profile). `CAPABILITY_FLAGS` stays in `canvas.ts` (cards still reference it via
  `requiredCapability`).
- **`DEFAULT_CANVASES`** lose their `capabilities` key (the field is gone from `CanvasDef`).
- Barrel `index.ts` re-exports the new module. The dashboard's client-side `validateCanvas` mirror
  (`screens/canvas-editor/validate-canvas.ts`, a drift-guarded deep-import, spec
  `2026-09-04` §4/§7) must drop capabilities in lockstep, and the local contract mirror stays aligned
  (the #70 bundle rule — the dashboard never runtime-imports `@waitron/layouts`).

---

## 8. Server (`apps/server`)

### 8.1 Store — `packages/layouts/src/device-profile-store.ts` (new, beside `canvas-store.ts`)

Beside `canvas-store.ts` (`packages/layouts/src/canvas-store.ts`, which already imports `@waitron/db`
+ `@waitron/identity` — so the home is settled, no DB-free contract to break). Follows it exactly,
tenant-scoped via RLS (callers wrap in `withTenant + asAppUser`): `listDeviceProfiles`,
`getDeviceProfile(id)`, `createDeviceProfile`, `updateDeviceProfile`, `deleteDeviceProfile`. Writers
`authorizeManager(…, "till.configure")` (the exact gate `canvas-store` writers use) then
`validateCapabilities`; a duplicate name (`23505`) → `device_profile.name_taken` (the `asNameTaken`
idiom, `canvas-store.ts:51`); a bad `canvas_id` (`23503` on `device_profiles_canvas_fk`) →
`device_profile.invalid`.

### 8.2 Resolution + enforcement

- **`assertDeviceCapability`** (`device-session.ts:359`): resolve the device's **profile** (via a new
  `getDeviceProfile`) instead of its canvas; check `profile.capabilities.includes(capability)`. Null
  profile ⇒ refuse (unchanged shape — the `resolved.canvasId === null` branch becomes
  `resolved.deviceProfileId === null`). Keep the same `device.forbidden_action` throw and the
  `withTenant + asAppUser` tx shape.
- **`/api/till`** (`till-api.ts:668`): resolve the profile; canvas = `profile.canvas_id` → `getCanvas`
  → else `getCanvasForFormFactor`; **capabilities** returned to the client come from the profile
  (a new field on the till payload, since they no longer live in the `CanvasDef`). `till-app.ts:2129`
  reads that new field rather than `this.canvas?.capabilities`.

  *Payload note:* the `/api/till` response currently exposes capabilities implicitly inside `canvas`.
  It now needs an explicit `capabilities: CapabilityFlag[]` sibling. The till's local `layout.ts`
  mirror (`apps/till/src/layout.ts:69`) and the SP-C dev-switcher till-side mirror drop capabilities
  from the canvas type and read the sibling.

### 8.3 Enrolment + reassign

- **`generatePairingCode`** / **`enrolDevice`** (`device.ts`): swap `canvas_id` for
  `device_profile_id` in the stamped/copied binding set (verbatim copy, unchanged mechanism). The
  `BINDING_FK_FIELD` map gains `device_profiles_device_profile_fk → deviceProfileId`.
- **Reassign route**: rename `POST /management-api/devices/:id/assign-canvas` →
  `/assign-device-profile` (`device-api.ts:432`), `UPDATE devices SET device_profile_id`, still
  `device.manage`-gated, FK violation → `device.binding_invalid` (the B3.1 idiom; atomic, no
  read-then-write race — memory / backlog B3.1). Routes are not error codes, so a route rename is
  free pre-ship.

### 8.4 CRUD routes

Five `/management-api/device-profiles[/:id]` routes mirroring the canvas CRUD
(`management-api.ts:859-987`): gated on **`till.configure`** — the gate the canvas routes use
(`management-api.ts:866`), enforced by the store's `authorizeManager` for writes and by an explicit
`authorizeManager` on the read routes, exactly the canvas pattern. (The *reassign* route in §8.3 stays
on `device.manage`, matching its `assign-canvas` sibling — reassigning a device is a device action;
authoring a reusable profile is `till.configure`.) The error→HTTP map gains
`device_profile.not_found`→404 / `name_taken`→409 / `invalid`→400. `GET /management-api/devices`
returns `deviceProfileId` (replacing `canvasId`).

---

## 9. Dashboard (`apps/dashboard`)

- **New device-profile editor screen** (`screens/device-profiles-screen.ts`, nav
  `nav.device_profiles`): a **list** (name + the referenced canvas + a capabilities summary; create /
  duplicate / delete) and an **editor** (name field, a **canvas picker** `<select>` populated from
  `listCanvases`, and the **capability checkboxes** relocated from the canvas editor). +5 API-client
  methods (`listDeviceProfiles`/`get`/`create`/`update`/`delete`) and a `DeviceProfile` client type
  (`{ id, name, canvasId, capabilities }`).
- **Canvas editor loses its Capabilities section** (`canvas-editor-screen.ts:1168-1180`, the
  `:1050` warning derivation, the `:694` save path, the `canvas_editor.capabilities` i18n keys). The
  editor no longer sends or renders capabilities.
- **Devices screen**: the per-row reassign `<select>` and the Add-device mint form pick a **device
  profile** (from `listDeviceProfiles`) instead of a canvas; `DeviceRow.canvasId` →
  `deviceProfileId`; `reassignDevice` → `reassignDeviceProfile`; `createDeviceCode` bindings swap
  `canvasId` → `deviceProfileId`.
- No hardcoded chrome — `--wt-*` tokens only (`no-hardcoded-chrome.test.ts`). Match the a11y pattern
  the canvas editor settled on (plain button group with `aria-current`, not an ARIA `tablist`).

---

## 10. `dev:setup`

`apps/server/scripts/dev-setup.ts` must, in the seeded tenant: create a **default device profile**
(name e.g. "Counter", `canvas_id = NULL` so it resolves the till default canvas, `capabilities =
DEFAULT_PROFILE_CAPABILITIES.till = ["integrated-card-payment","open-cash-drawer"]`) and stamp its id
on the minted `till` pairing code's `device_profile_id`. Without this the dev till enrols with no
profile and — per §5.3 — loses the reader/drawer capability (firewall refuses `/api/pay` and
`/api/drawer/open`) and disables the card grid's integrated-card option, a regression on the dev
flow. (`tender-pay` itself still renders for the cash path — the carve-out at `card-grid.ts:157`.)
Update `dev-setup.test.ts` accordingly.

---

> **2026-09-06:** `dev:setup` no longer mints or stamps a pairing code. Provisioning seeds the starter
> profiles and, under `WAITRON_ENV=dev`, the fixed pairing code `DEMO` binds the seeded till profile at
> enrol time (`apps/server/src/dev-pairing.ts`).

## 11. Error codes (CLAUDE.md §3 — domain concept, never the package; never renamed once shipped)

New family **`device_profile.*`** registered in **`packages/layouts/src/errors.ts`** (beside the
`canvas.*` family, since the store that throws them lives there), imported by every throwing file:

- `device_profile.not_found` — CRUD get/update/delete of a missing id → 404.
- `device_profile.name_taken` — duplicate `(tenant_id, name)` (23505) → 409.
- `device_profile.invalid` — a bad capability flag (fail-closed `validateCapabilities`) or a bad
  `canvas_id` reference (FK `23503`) → 400. Keep the param shapes parallel to the `canvas.*` family
  (grep `canvas.invalid` / `canvas.name_taken` / `canvas.not_found` in `errors.ts` before writing —
  CLAUDE.md §1 "grep the siblings").

Reuses (unchanged): `device.binding_invalid` for the enrolment/reassign FK violation;
`device.forbidden_action` for the capability firewall refusal. **No `canvas.*` code is renamed** —
capabilities leaving the canvas removes no shipped code (capabilities threw none;
`canvas.invalid` stays for canvas-shape validation).

---

## 12. Testing (CLAUDE.md §4)

- **RLS**, real Postgres via Testcontainers: `device-profiles.rls.test.ts` (tenant isolation as
  `app_user`), `device-profiles.fk.test.ts` (the composite canvas FK + the device→profile FK, RESTRICT
  behaviour). PGlite is a false pass for RLS-as-app-role — use the real target.
- **`inmutabilidad`**: `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` must stay green
  (the new tenant table needs FORCE + policy).
- **Firewall**: keep the existing `assertDeviceCapability` behavioural assertions (CLAUDE.md
  "preserve behavioural assertions") — update the fixture so capabilities come from a **profile**, and
  keep the fail-closed cases (no profile → refuse `pay` and `drawer_open`). **Prove by mutation**: the
  `/api/pay` + `/api/drawer/open` refusal is a security gate; a container+mutation receipt (the
  SP-A.2 §7 shape) shows a device without the flag is refused and one with it passes.
- **Render axis**: a test pinning §5.3's behaviour change — a no-profile device renders the
  form-factor default canvas with `capabilities: []` and hides `kds-board` (the only capability card
  with no cash carve-out; `tender-pay` always renders per `card-grid.ts:157`); a profile-carrying
  device that grants `act-as-kds` shows `kds-board` (prove by deletion of the profile-read).
- **Resolution**: `/api/till` returns the profile's canvas (and the default when `canvas_id` NULL /
  no profile), and the explicit `capabilities` sibling.
- **Enrolment**: a pairing code carrying `device_profile_id` enrols a device carrying it; a bad id →
  `device.binding_invalid` at mint (FK).
- **Cross-package stale-list guard** (CLAUDE.md §2): grep for any test pinning a canvas/capability
  shape (e.g. a `CanvasDef` snapshot) and run the whole workspace, not just the changed package —
  removing `capabilities` from `CanvasDef` will ripple.
- **Coverage**: package thresholds hold (98/98/98/95; browser packages 95/95/90/88). Run
  `test:coverage`, not `test` (CLAUDE.md §2).

---

## 13. Non-goals / boundaries

- The sale path is untouched: `requireSaleTillId` still reads `till_id` off the device; `nodeId` /
  series / huella unchanged. Verify end-to-end (a cash + a manual-card sale still settle) — but this
  is a *capability-firewall* change, not a *fiscal* one.
- No till/station/hardware relocation. No area/routing/printer aggregation. Those are the next
  device-profile slice.

---

## 14. Deferred follow-ons (recorded)

- **Aggregated bundle** — relocate `till_id`, `station_id`, the hardware trio, and add **area** +
  **order-routing** + **printer target** onto the device profile (the parent design's fuller device
  profile). Multi-subsystem; its own slice.
- **Built-in default device profiles** beyond the dev seed (a tenant-facing "Counter"/"Kitchen"
  starter set), if wanted — parallels `DEFAULT_CANVASES`.
- **Theme editor**, **live card renders**, **NFC pairing**, **community profile sharing** (parent
  follow-ons, unchanged).

---

## 15. References

- Parent: `2026-09-02-layout-designer-and-device-profiles-design.md`;
  `2026-09-04-sp-b3-2-canvas-editor-design.md` §2 (capabilities "transitional"), §10 (this deferral).
- Model: `packages/layouts/src/{canvas,card-contract,validate-canvas,default-canvases,canvas-store}.ts`.
- Storage: `packages/db/src/schema/{canvases,devices}.ts`; migrations `0060/0061/0094/0095/0101/0102`.
- Enforcement: `apps/server/src/device-session.ts:359`; render axis `apps/till/src/widgets/card-grid.ts:159`;
  resolution `apps/server/src/till-api.ts:668`.
- Enrolment: `apps/server/src/device.ts:201,326`; reassign `apps/server/src/device-api.ts:432`;
  CRUD `apps/server/src/management-api.ts:859-987`.
- Dashboard: `apps/dashboard/src/screens/{canvas-editor-screen,devices-screen}.ts`,
  `api/client.ts`, `i18n/{strings,codes}.ts`.
- Fiscal boundary: `series.ts:19` (node-keyed chain); memory [sif-is-the-submitting-node],
  [sp-a2-device-unification-landed].
