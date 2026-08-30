# Handheld tableside ordering — Design

**Date:** 2026-08-30. **Status:** design (approved section-by-section with the owner 2026-08-30);
plan to follow. **Track:** Phase 1 demo build, Tier-A item 4
(`docs/backlog.md`) — "the waiter's tableside experience, a centrepiece of a restaurant demo".
**Runs SUPERVISED** (it adds a `device_kind` and a device-authenticated boundary; security-adjacent,
though it deliberately touches no fiscal path — see §5). **Pairs with modifiers (backlog #7)** but does
not depend on it.

Every claim about the current tree carries a `file:line`; anything I could not verify directly is
marked **assumption** or flagged **verify before coding**.

---

## 0. Owner decisions this slice is built on (2026-08-30)

Five decisions were taken in the brainstorming session; each reshapes scope, so they are recorded here
verbatim before the design that follows from them.

1. **Order-only, pre-fiscal.** The handheld takes and fires orders; it never settles payment. The bill
   is paid at the fixed counter till. This keeps the handheld entirely out of the hash-chain — no SIF,
   no chain, no installation number, no series. (The rejected alternative — pay-at-table — would make
   each handheld its own fiscal SIF, per the per-till-chain model, a large commitment touching
   unrecoverable invariants.)

   > **Correction (2026-08-30):** the parenthetical above is **wrong** on the fiscal model, and the
   > owner reversed this decision the same day. The SIF is the **submitting node** (`nodeId`), **not**
   > the till or the device — `packages/core/src/record-sale.ts:79-82` takes `tillId` and `nodeId` as
   > separate inputs and names `nodeId` "the SIF/chain/series key". A handheld is a client of a node, so
   > it files under **that node's SIF exactly like a till** — there is **no per-device SIF**. Order-only
   > was therefore a **risk-scoping choice, not a fiscal necessity**. Handhelds taking payment (cash
   > first) is the **NEXT build** — see `docs/backlog.md` item 4 "→ NEXT BUILD: handheld cash-at-table"
   > and the allowlist in `2026-08-30-device-auth-enrolment-fail-closed-design.md` §3.
2. **Build a `handheld` device kind now** (enrolled via a pairing code), rather than deferring to a
   plain PWA + PIN. The staff PIN is still the action gate; the device layer adds trust, location
   binding, shell selection, and management/revocation.
3. **Fixed phone shell this slice, with the configurable seam in place.** The handheld renders a
   built-in phone face-set (lock → floor → table-order), shipped as *declarative data keyed by device
   kind* so the persisted format is editor-ready. The dashboard editor and making the table-order
   screen itself layout-driven are a **later slice** (§9). The owner was explicit: *the configurable
   option is wanted long-term* — this slice must not close that door, only defer walking through it.
4. **No real-time this slice.** Match the rest of the app: refetch the affected read-model after each
   action, plus a manual refresh. Live updates (SSE/WebSocket) are recorded as a **backlog follow-up**
   (§10), not built here.
5. **Connectivity and cert-trust assumed-solved.** This slice builds the app + enrolment + order flow,
   assuming the phone can already load the handheld app from the box (dev: same-origin; a documented
   "accept the self-signed cert" path for a LAN demo). The full WiFi/AP-mode + CA-trust + PWA-install
   story stays in the **parked onboarding track** (slices 5–7). Order-only + PIN needs no WebAuthn, so
   an untrusted cert still works (a browser warning, not a hard block).

---

## 1. Problem and context

A restaurant demo's centrepiece is a waiter taking an order at the table on a phone. Today the tableside
flow exists but only on a fixed till: the floor plan (`apps/till/src/screens/till-floor-screen.ts`) and
the per-table order screen (`apps/till/src/screens/till-table-order-screen.ts`) are two faces of the
one till SPA, reached after an operator PIN-logs-in. There is **no phone-first way in**: no device kind
that marks a browser as a roving waiter handheld, and the app exposes every face (counter POS, KDS,
expo, schedule) rather than a focused waiter shell.

Two facts from the tree define what this slice is, and — importantly — what it is **not**:

1. **The tableside order flow already works and already reflows.** `till-table-order-screen` reuses the
   counter's widgets as tags (`till-product-grid`, `till-basket`, `till-tender-pay`,
   `till-menu-switcher`, imports `:16-20`), accumulates a round into a round-scoped `WorkingOrderStore`
   and emits `send-round` (`:398-409`), and its `.layout` is `display:flex; flex-wrap:wrap` with a
   `flex:1 1 20rem` grid region and a `flex:0 0 22rem` drawer (`:141-162`) — it **reflows on narrow
   screens today**. So this slice does not build the order flow; it makes a phone a first-class way to
   reach it.
2. **The `till_layouts` configurable-layout system governs only the counter screen, not the tableside
   screen.** `getLayout` is folded into `GET /api/till` (`apps/server/src/till-api.ts:551-558`) and
   rendered by `till-counter-screen` alone (`till-app.ts:1403-1410`, `:1488`); the table-order screen
   is hardcoded and reads no layout. **So the backlog's framing — "needs a device→layout association +
   a layout-editor dimension" — is aimed at the wrong screen.** The genuinely missing pieces are a
   device kind, a phone shell, and a pre-fiscal firewall; the "layout" work is a deliberately-deferred
   later slice (§9, D3), not a prerequisite.

The enrolment and layout foundations this builds on are **already landed** (device-identity-1 and the
layout/receipt editors — both were specced 2026-08-08/08-17 as unbuilt and have since shipped; the
backlog line calling the layout "venue-wide today" is stale). Verified on disk: the `devices` /
`device_pairing_codes` tables (`packages/db/src/schema/devices.ts`), `requireDevice`
(`apps/server/src/device-session.ts:92-146`), the enrol/pairing routes (`apps/server/src/device-api.ts`),
and the dashboard Devices screen (`apps/dashboard/src/screens/devices-screen.ts`).

**Minimum coherent slice (this design):** a `handheld` `device_kind`; station-less enrolment reusing
device-identity; a kind-aware boot probe; a declarative phone face-set (lock → floor → table-order); the
table-order screen hiding its pay widget under a `canSettle=false` prop; a **server-enforced pre-fiscal
firewall** (a handheld device cookie cannot reach the sale/pay routes); the dashboard pairing generator
offering the `handheld` kind; and phone-touch polish on the two reused screens.

---

## 2. Scope

**In:** a `handheld` value on the `device_kind` enum + the station-less CHECK; enrolment of a handheld
device (reusing `generatePairingCode`/`enrolDevice`); a kind-aware device identity read for the boot
probe; the pre-fiscal firewall on the sale/pay routes; the till SPA gaining a **handheld mode** (a
declarative `HANDHELD_FACES` set, an enrol affordance on the lock screen, floor as the post-login
landing, `canSettle=false` on the table-order screen, phone-touch polish); the dashboard pairing
generator offering the `handheld` kind; guard suites.

**Out (YAGNI, deferred with reasons):**

- **Payment on the handheld** (decision 0.1) — the firewall (§5) forbids it by construction; pay-at-table
  is a separate, fiscal, SIF-per-device slice, parked.
- **A persisted per-device face-set + a dashboard layout editor for it, and making the table-order screen
  layout-driven** (decision 0.3) — a later slice; the seam here (§6) makes it additive, no destructive
  migration (pre-production).
- **Real-time / live multi-waiter sync** (decision 0.4) — backlog follow-up (§10); refetch-on-action
  this slice.
- **WiFi/AP-mode, CA trust, PWA install** (decision 0.5) — the parked onboarding track (slices 5–7).
- **A customer-facing display or a general "trusted till" device kind** — additive later enum values, as
  device-identity-1 §9 already anticipated; not this slice.

---

## 3. UX product-decisions (each named, with the chosen default)

| # | Decision | Options | **Chosen default** | Why |
|---|----------|---------|--------------------|-----|
| **D1** | Device kind name | `handheld` / `till` / `waiter` | **`handheld`** | Clearest domain term for a roving waiter phone; English identifier (§8). device-identity-1 §9 spoke of a future "till" kind, but this device is specifically the order-only handheld. |
| **D2** | Handheld binding | station / location / node | **Location (station_id NULL)** | A handheld is location-wide (any table at the venue), not station-bound. `devices.station_id` is already nullable; a handheld has it NULL — exactly the shape expo_pass anticipated (`2026-08-17-expo-device-kind-design.md` §2). No `node_id` on devices: the handheld fires under whichever box (node) it talks to (`cfg.nodeId`), and tables are venue-wide (`client.ts:1109-1112`). |
| **D3** | The "layout" work the backlog names | build device→layout now / defer with a seam | **Fixed face-set constant this slice; persisted per-device face-set + editor later** | The table-order screen is not layout-driven (§1.2); making it so is the heavy half. Ship the shell as declarative data keyed by device kind (editor-ready shape), defer the editor — the counter layout system was built this exact way (constant `DEFAULT_LAYOUT` first, editor as a plug-in slice). |
| **D4** | Order-only enforcement | client hides the pay button / server rejects too | **Both — the server rejects a handheld device cookie on the sale/pay routes** | "Order-only" is a fiscal invariant, not a UI preference. A hidden button is not a firewall; a server guard is provable by deletion (§5, §7). Cheap: the device cookie already rides every same-origin request. |
| **D5** | How a handheld reaches its shell | separate app/entry / one SPA, kind-aware boot probe | **One SPA, kind-aware boot probe** | Mirrors the KDS device mode exactly (`till-app.ts:500-515`): an enrolled device's cookie makes the boot probe succeed and routes it into its shell; no cookie → normal operator lock. One codebase, one deploy. |
| **D6** | Does the waiter still log in? | device-only (like KDS) / device + per-waiter PIN | **Device + per-waiter PIN session** | Every order must be attributed to a real person (the sale/round records `personId`). KDS is anonymous (bump a ticket); a handheld authors orders, so the person matters. This is the **new device+session combination** (§4). |
| **D7** | Fresh-handheld enrol entry | a hidden URL / an affordance on the lock screen | **An affordance on the lock screen** ("Set up as waiter handheld") | Twin of the existing "set up as kitchen display" affordance (`till-app.ts:887-889`); discoverable, no new routing (the SPA has no router). |

---

## 4. The device + session combination (the genuinely new shape)

Three client shapes exist after this slice; the handheld is the first to combine both cookies:

| Shape | Device cookie | Operator session (PIN) | Reaches |
|-------|---------------|------------------------|---------|
| Counter till | none | required | full operator shell |
| KDS station / expo | required | **none** (always-on) | one bound station / the pass |
| **Handheld (new)** | **required** | **required** | the phone face-set (lock → floor → table-order) |

The **device cookie** (`waitron_device`, `device-session.ts:21`) establishes: this browser is a trusted
`handheld` at location L → render the phone shell. The **operator session cookie**
(`waitron_till_session`, `till-session.ts:17`) establishes: this waiter is person P → attribute their
orders. Both ride every same-origin request (`credentials:"include"`, `client.ts:1271-1282`).

Crucially, **the order routes are unchanged**: `open-table` → `POST /api/tables/:id/tab`
(`till-api.ts:1302`), `send-round` → `POST /api/working-orders/:id/round` (`:1318`), `fire-course` →
`POST /api/orders/:id/courses/:cid/fire` (`:392`), `serve-line` →
`POST /api/working-orders/:id/lines/:lineNo/served` (`:1384`) are all `requireSession` (the person), and
the handheld waiter holds a valid session, so they work **as-is**. The device layer is additive: it
selects the shell and (via §5) fences the fiscal routes. No order-path code changes behaviour.

---

## 5. The pre-fiscal firewall (fiscal safety, H2) — load-bearing

> **Update (2026-08-30, branch `feat/handheld-cash-at-table`):** the order-only firewall below was
> **reversed for settlement at `POST /api/sales`** (following the fiscal-model correction in §0.1,
> lines 26–33). A handheld may now **settle a sale on `POST /api/sales` for CASH or a MANUAL card
> tender**, filing under its node's SIF exactly like a till. The manual card is the datáfono leg — the
> operator charges a **separate bank terminal the POS never talks to** (`recordManualCardPayment` makes
> no network call), so it is fiscally identical to cash and needs no reader; `POST /api/sales` therefore
> runs **no handheld guard at all**. What stays fenced (`assertNotHandheld` in
> `apps/server/src/device-session.ts`): the **INTEGRATED** card path (`POST /api/pay`, Stripe Terminal /
> Tap to Pay — the deferred "mobile reader" slice) and the amendment/drawer/place/collect routes. The
> earlier `assertHandheldTenderAllowed` tender-split was removed with this widening. See
> `docs/backlog.md`'s "→ NEXT BUILD: handheld cash-at-table" row and the fail-closed allowlist in
> `2026-08-30-device-auth-enrolment-fail-closed-design.md` §3. The section below is preserved as the
> original order-only design.

Order-only (decision 0.1) is enforced **on the server**, not merely by hiding a button (D4). The
table-order screen embeds `till-tender-pay` and re-emits `pay-tab` → `recordSale`
(`till-app.ts:1316+`, the fiscal settle in `apps/server/src/till-sale.ts`). On a handheld that path
must be unreachable.

**The guard:** the sale/pay routes — `POST /api/sales` (`till-api.ts:652`) and `POST /api/pay`
(`:682`) — **reject when the request carries a valid `handheld` device cookie**, with a new domain
error `device.forbidden_action` (403). A handheld holds a device cookie on every request; the counter
till holds none, so it is untouched. This makes "a handheld cannot file a sale" a property of the
server, provable by deletion (§7), independent of the client.

**Verify before coding (CLAUDE.md §1, §3):** confirm the exact route list that must be fenced — at
minimum `POST /api/sales` and `POST /api/pay`; consider `POST /api/sales/:id/reprint` (`:1039`) and the
drawer routes (`:1056`, `:1091`) since they are cash-handling, not order-taking. The plan enumerates the
final set with a grep receipt over `till-api.ts`'s `requireSession` routes, classifying each as
order-taking (allowed) vs cash/fiscal (fenced).

**H2 grep receipt (for the plan):** no `/api/device/*` path and no handheld-shell client path reaches
`till-sale.ts` / the alta builders; and the fenced-route guard is proven by a real-PG test that a
handheld cookie gets 403 on `POST /api/sales` while an ordinary operator session (no device cookie)
gets through. Nothing in this slice writes a `registros_facturacion` row, a `huella`, an invoice number,
or a chain link.

---

## 6. Client — the phone shell (`apps/till`)

The single till SPA gains a **handheld mode**, mirroring the KDS device mode (`till-app.ts:189-202`,
`:500-515`).

### 6a. The declarative face-set (the seam)

A built-in constant — **`HANDHELD_FACES`** (a `Screen[]` subset: `["lock", "floor", "table-order"]`) —
declares which of the SPA's faces (`Screen` union, `till-app.ts:59-60`) a handheld may reach and that
**floor** is the post-login landing (the counter's default is `counter`, `till-app.ts:542`). The screen
state machine consults the face-set for the current device kind rather than a hardcoded `if (handheld)`.
Shipped as a constant this slice; **the same shape persists per-device and gains an editor in a later
slice** (§9) — the persisted format is identical, so the editor is additive (the counter layout
precedent). Excluded from the handheld: `counter`, `ticket`, `station`, `expo`, `schedule` (walk-up
POS, receipts, KDS, and rostering are not the waiter's tableside job).

### 6b. Kind-aware boot probe (D5)

`#boot` (`till-app.ts:451`) today probes `GET /api/device/station`; success → KDS device mode, 401 →
normal lock. This slice makes the probe **kind-aware** via a small `requireDevice`-backed identity read
returning the device's `kind` (**verify before coding:** whether to add a kind-agnostic
`GET /api/device/me` returning `{ deviceId, kind, label }`, or branch the existing probe — the plan
picks the lower-churn option and preserves the KDS "one authenticated queue read per boot" optimization,
`till-app.ts:508-512`). Branch: `kind === "handheld"` → handheld mode (render the face-set, land on
lock); `kind === "kds_station"` → station screen (unchanged); 401 / no cookie → normal operator lock
(unchanged, the expected not-a-device case, swallowed — not `boot.error`, `till-app.ts:502-504`).

### 6c. Fresh-handheld enrolment (D7)

The lock screen gains a **"Set up as waiter handheld"** affordance, the twin of "set up as kitchen
display" (`#onSetupDevice`, `till-app.ts:887-889`). It routes a fresh phone into the handheld shell's
**enrol view** (enter a pairing code → `POST /api/device/enrol` → device cookie set → reload boots
straight into the phone shell via §6b). Reuses `TillApi.enrolDevice(code)` (`client.ts:959-961`); the
enrol call needs no session (it is the unauthenticated enrol route).

### 6d. The order flow + `canSettle` (order-only)

After PIN login the waiter lands on **floor** → taps a table → **table-order**. The flow is the existing
one (§4). The table-order screen takes a new **`canSettle=false`** prop under handheld mode: its embedded
`till-tender-pay` and the pay-tab affordance are hidden (`till-table-order-screen.ts:591-613` drawer,
the tender-pay embed `:44-58`/`:483-493`); the waiter **fires and serves only**. (The server firewall,
§5, is the real guarantee; hiding the widget is the honest UI.) Refetch-on-action is unchanged
(`#loadTabLines` after each round/serve/fire, `till-app.ts:1229-1239`), plus a manual refresh control on
the handheld (decision 0.4).

### 6e. Phone-touch polish

The floor and table-order screens already reflow (§1.1); this slice verifies and refines them for a
phone in the hand: touch-target sizing, the pay-drawer's behaviour on a narrow viewport (now hidden
under `canSettle=false`, so mainly the round/serve controls), and no horizontal scroll. Pure CSS/markup;
no new layout system.

---

## 7. Server behaviour summary (`apps/server`)

- **Enrolment:** `generatePairingCode` (`device.ts:101-144`) gains a `kind: "handheld"` path with **no
  station** (validate: a handheld code carries no `station_id`; reuse the station-required check for
  `kds_station`). `enrolDevice` (`device.ts:164-222`) is unchanged — it stamps `kind`/`station_id` from
  the code, so a handheld row lands with `station_id = NULL`.
- **Identity read for the probe** (§6b) — a `requireDevice`-backed read exposing `kind` (endpoint
  decided in the plan).
- **The firewall** (§5) — the sale/pay (and cash) routes reject a valid `handheld` device cookie with
  `device.forbidden_action` (403).
- **Dashboard pairing** — `POST /management-api/device-codes` (`device-api.ts:241`) already validates
  `kind` against `deviceKind.enumValues` (`:252`), so `handheld` is accepted the moment the enum grows;
  the only server change is the station-optionality validation per kind.

---

## 8. Data model + conventions

### 8a. Migration (`packages/db`)

Add `handheld` to the `device_kind` pgEnum (`packages/db/src/schema/devices.ts:20`) — an additive
`ALTER TYPE … ADD VALUE` generated via `db:generate` (migration number **not** hand-chosen; sequence
around any concurrent `_journal.json` collision — the Drizzle rebase note in CLAUDE.md/memory). Add a
CHECK constraint (hand-written custom migration, the way the RLS/FK migrations are): `kds_station` ⇒
`station_id IS NOT NULL`, `handheld` ⇒ `station_id IS NULL`, mirroring
`2026-08-17-expo-device-kind-design.md` §2. The `DeviceKind` TS type is derived
(`apps/server/src/device.ts:29`, `(typeof deviceKind.enumValues)[number]`), so it tracks the enum
automatically. Re-run `inmutabilidad` (the enum-add touches a `tenant_id` table) and `english-only`.

### 8b. Conventions reviewers enforce (CLAUDE.md §3)

- **English identifiers** — `handheld` (a `device_kind` value); `HANDHELD_FACES`, `canSettle`. No new
  `SPANISH_WORDS`; UI copy en/es.
- **Domain error codes** — one new: **`device.forbidden_action`** (403 — a handheld device hitting a
  fiscal/cash route). **Grep the `device.*` siblings** (`apps/server/src/errors.ts`,
  `packages/*/src/errors.ts`) before minting, to match the family's naming and confirm no collision
  (device-identity-1 shipped `device.unauthorized`, `device.forbidden_station`, `device.pairing_*`,
  `device.not_found`). Reuse `device.unauthorized` for the probe. `import "./errors.js"`. Never renamed
  once shipped.
- **Permission** — enrol/manage via the existing **`device.manage`** (`packages/identity/src/permissions.ts`);
  the device routes are device-authed. **No new permission.**
- **Reuse, don't reinvent** — the pairing/cookie/scrypt machinery (`device.ts`, `device-session.ts`,
  `secret-hash.ts`), the KDS device-mode client pattern (`till-app.ts`), the enrol client call
  (`client.ts:959-961`). The only new server logic is the per-kind station validation and the firewall
  guard.
- **No backwards-compat / data-migration code** (pre-production).

---

## 9. The configurable seam — what a later slice adds (not this one)

Recorded so the deferral (decision 0.3) is concrete and the door is provably open:

- **Today (this slice):** `HANDHELD_FACES` is a constant keyed by `device_kind`. Resolution is
  "device kind → built-in face-set".
- **Later slice (unblocked, additive):** persist a face-set per device (or per device kind) — a new
  jsonb column or a small table keyed by `device_id`/`device_kind`, resolved with a fallback to the
  built-in constant (the `getLayout`-returns-defaults precedent, `packages/layouts/src/store.ts:35-90`).
  Add a dashboard editor mirroring the layout editor (`apps/dashboard/src/screens/layout-screen.ts`).
  Making the **table-order screen itself** layout-driven (like the counter) is the heavier, separable
  half. **None of this needs a destructive migration** (pre-production), and the persisted shape is the
  constant's shape — so the constant is the editor's default, exactly as `DEFAULT_LAYOUT` is.

---

## 10. Testing (CLAUDE.md §4)

- **Real Postgres / PGlite (`packages/db`)** — enrolling a `handheld` device (no station); the CHECK
  (`kds_station` needs a station, `handheld` must not have one) proven in **both directions**;
  `inmutabilidad` green after the enum-add; `english-only` green. RLS on `devices`/`device_pairing_codes`
  is device-identity-1's, unchanged (the enum-add adds a value, not a table).
- **Server (`apps/server`)** — `generatePairingCode(kind:"handheld")` stores a station-less code and
  rejects a station on a handheld code; `enrolDevice` mints a `handheld` row with `station_id NULL`; the
  kind-aware probe returns `handheld`; **the firewall** — a real-PG e2e proving a **handheld device
  cookie gets 403 (`device.forbidden_action`) on `POST /api/sales`** while an ordinary operator session
  (no device cookie) settles, **proven by deletion of the guard**; the H2 grep receipt (§5). Enumerate
  and pin every fenced route.
- **Till (`apps/till`)** — the boot probe branches to handheld mode on a handheld cookie (renders the
  phone shell, lands on lock; after login, floor); the enrol view shows for a fresh phone and the
  "Set up as waiter handheld" affordance routes into it; `HANDHELD_FACES` constrains navigation (the
  excluded faces are unreachable); the table-order screen hides pay under `canSettle=false` and still
  fires/serves; `.a11y` on the phone shell in both themes.
- **Dashboard (`apps/dashboard`)** — the pairing generator offers the `handheld` kind with **no station
  picker**; `.a11y` both themes. On the existing `test-dashboard` shard.
- **Fiscal (`packages/fiscal-verifactu`)** — `inmutabilidad` after the migration; the H2 grep.
- **Prove guards by deletion** (the CHECK, the firewall, the face-set constraint): remove each, watch
  the test fail, restore.
- Coverage **98/98/98/95** (db, server), **95/95/90/88** (till, dashboard). Run `packages/db`
  **unfiltered** (the tree-wide guards, CLAUDE.md §2/§4); `TESTCONTAINERS_RYUK_DISABLED=true` locally;
  `pnpm reap` if a run is interrupted.

**Churn to do in the same change (CLAUDE.md §3 "a hardcoded list goes stale"):**

- **`device.forbidden_action`** → register in the server error registry; if any test pins the exact
  `device.*` code set, update it in the same commit.
- **Migration manifest / CI scope** — the enum-add is in the `packages/db` core set (no
  `migrations.manifest.json` change); `apps/till`/`apps/dashboard` already have shards. Re-run the
  cross-package guards unfiltered (the `vocabulary-scope` / manifest-pinning trap, CLAUDE.md §2).
- **Backlog follow-ups** (add in the landing change): *handheld live updates (SSE/WebSocket)* (decision
  0.4) and *configurable per-device layout editor* (§9, decision 0.3).

---

## 11. Sequencing / dependencies

- **Builds on device-identity-1** (`devices`, `device_kind`, `generatePairingCode`/`enrolDevice`,
  `requireDevice`, the Devices screen) **and the table-service flow** (floor + table-order + tabs +
  rounds + fire/serve) — both **landed**. Re-verify the cited symbols against real code first
  (CLAUDE.md §1) — every `file:line` here was read during design but the plan re-confirms them.
- **Independent of** the layout/receipt editors (this slice touches neither), of modifiers (backlog #7,
  it pairs but does not block), and of the parked onboarding connectivity work (decision 0.5).
- **Completes** the always-on/enrolled-device family for its third member: KDS station (anonymous),
  expo pass (anonymous, when built), and now the handheld (device + per-waiter session).

---

## 12. Provenance

Designed against the live tree on 2026-08-30 via three targeted reads (device model, layout system,
till order-flow + auth), each claim cited inline. Reuses device-identity-1's
`devices`/`device_kind`/pairing/`requireDevice`/Devices-screen
(`2026-08-17-device-identity-1-station-enrolment-design.md`, re-verified on disk:
`packages/db/src/schema/devices.ts`, `apps/server/src/device{,-api,-session}.ts`,
`apps/dashboard/src/screens/devices-screen.ts`), the station-less-kind + CHECK pattern from the expo_pass
design (`2026-08-17-expo-device-kind-design.md` §2), the KDS device-mode client pattern
(`apps/till/src/till-app.ts:189-202,451,500-515,887-889`), and the table-service order flow
(`apps/till/src/screens/till-table-order-screen.ts`, `apps/server/src/till-api.ts` order routes). The
genuinely new pieces are the `handheld` enum value + station-less binding, the kind-aware boot probe, the
declarative `HANDHELD_FACES` seam, the `canSettle` order-only client mode, and the server-enforced
pre-fiscal firewall (`device.forbidden_action`). Two mechanisms are flagged **verify before coding**: the
exact fenced-route set (§5) and the boot-probe identity endpoint (§6b).
