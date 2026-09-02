# Layout designer & device profiles — design

- **Date:** 2026-09-02
- **Status:** Design approved (owner). SP-A.1 landed (#194). SP-A.2 slice resolutions added
  2026-09-02 — see §16 — now pre-plan. Fiscal touchpoints owner-gated (H2) — see §7 and §16.
- **Topic:** A visual, HA-Sections-style layout designer; reusable **layout profiles** carrying
  abilities; unification of tills into the enrolled-device model with per-device hardware binding;
  and a dev-only per-tab device switcher.

---

## 1. Summary

Today Waitron has a deliberately narrow "configurable till": a **flat, ordered list of six fixed
widget types** across two regions (`main`/`aside`), **one row per tenant**, edited by a list +
up/down-button screen (no grid, no positions, no sizes, no visibility rules). Separately, a device's
reachable **screens** are a hardcoded allow-list (`HANDHELD_FACES`), and a "till" is **not a device
at all** — it is the server process, configured by env vars, with hardware bound on the `tills` row
and via env.

This initiative replaces that with a single, general mechanism for **every** device:

> A **layout profile** is an HA-style dashboard — one or more **tabs**, each tab a **grid**, every
> screen (including today's bespoke full-screen views) expressed as a **card**. Profiles are reusable
> templates that also carry **abilities**. A **device** enrols, is assigned a profile, and binds its
> hardware. A dev-only **per-tab** switcher lets one browser run several device identities at once.

One editor, one card catalogue, one contract, for tills, handhelds, KDS displays, and whatever comes
later.

**North-star framing:** this is Track-1 (UI/UX polish & correctness) foundation work — it makes
"every screen correct and intuitive" configurable rather than hardcoded. It sits beneath the two
backlog tracks but is a prerequisite the owner has chosen to add before resuming Track-2 infra.

---

## 2. Motivation & the gap

The owner wants: (a) different **layout profiles** for tills and different sizes of handheld; (b)
profiles that carry **different abilities** (a till may edit the table layout, one handheld may, another
may not); (c) an HA-Sections-style visual editor (resizable columns, drag/drop/resize cards, cards
whose visibility depends on live state); (d) at device set-up, choose a profile and declare the
attached hardware (printer, cash drawer, card/POS terminal); (e) a much easier way, in dev, to *be* a
different device — ideally a different device **per browser tab**.

None of this is expressible today. The current system is single-tenant-single-layout, list-not-grid,
has no card catalogue beyond six sale widgets, no visibility conditions, no per-device anything, and
no notion of "a till" as an enrollable, hardware-bound device.

---

## 3. Current state (grounded)

Facts below are from a code sweep and carry `file:line`. They are the ground the design builds on.

### 3.1 The existing layout system (`@waitron/layouts`)

- **Data shape** — a layout is a flat ordered list, not a grid:
  `packages/layouts/src/types.ts:16-50` — `WIDGET_TYPES` = `product-grid | basket | total |
  tender-pay | held-orders | prep-queue`; `WidgetInstance = { type, region: "main"|"aside", config
  }`; `LayoutDef = WidgetInstance[]`.
- **Persistence** — **one row per tenant**: `packages/db/src/schema/layouts.ts:28-43` and
  `packages/db/drizzle/0035_till_layouts.sql` (`till_layouts` keyed on `tenant_id` PK; `definition`
  jsonb, `receipt` jsonb). RLS added in `0036_till_layouts_rls.sql`. No row → defaults, no backfill.
- **Defaults precedent** — `packages/layouts/src/store.ts:35-47` (`getLayout` returns
  `DEFAULT_LAYOUT`/`DEFAULT_RECEIPT` when no row exists); defaults at
  `packages/layouts/src/defaults.ts:9-19`.
- **Per-widget config registry** — `packages/layouts/src/widget-config.ts:25-32`; today the only wired
  key is `product-grid.columns`. Validation (fail-closed, mandatory sale-critical widgets) in
  `packages/layouts/src/validate.ts`.
- **Editor UI** — `apps/dashboard/src/screens/layout-screen.ts` — explicitly a **list + up/down-button**
  editor, "no drag-and-drop" (its header comment cites design §9/D1). Receipt trim editor at
  `apps/dashboard/src/screens/receipt-screen.ts`.
- **Rendering** — the counter screen is data-driven: `apps/till/src/screens/till-counter-screen.ts`
  iterates the `LayoutDef`, filters by region, and maps `type → custom element` in a `switch`; the two
  regions sit in a **fixed** `2fr 1fr` CSS grid. The **table-order screen is NOT** layout-driven
  (`apps/till/src/screens/till-table-order-screen.ts` — hardcoded regions).
- **Endpoints** — boot read `GET /api/till` (`apps/server/src/till-api.ts:617-680`); management
  read/write `GET/PUT /management-api/layout` + `PUT /management-api/receipt`
  (`apps/server/src/management-api.ts:743-807`), writes gated on `till.configure`.

### 3.2 `HANDHELD_FACES`

`apps/till/src/till-app.ts:65-78` — a hardcoded array of whole **screens** a handheld may reach
(`["lock","floor","table-order"]`); the navigation gate at `till-app.ts:1630-1654` refuses any target
outside it. Comment marks it the "configurable seam" awaiting persistence + an editor.

### 3.3 Device identity

- **Kinds** — `packages/db/src/schema/devices.ts:24` — `device_kind` pgEnum = `kds_station |
  handheld` (added incrementally: `0060_devices.sql`, `0075_*.sql`). **No `till` kind.** The schema
  comment (`devices.ts:13-23`) already anticipates a "till device" as an additive enum value.
- **Tables** — `devices` (`devices.ts:51-94`: `token_hash` scrypt, `active` flag for instant revoke,
  `station_id`, `label`, `last_seen_at`) and `device_pairing_codes` (`devices.ts:116-154`: `code_sha256`,
  15-min TTL in code).
- **Enrol/revoke** — crypto core `apps/server/src/device.ts` (`generatePairingCode`, `enrolDevice`),
  routes `apps/server/src/device-api.ts` (`POST /api/device/enrol` unauthenticated + rate-limited;
  `GET /api/device/me` boot probe; `/management-api/device*` gated on `device.manage`).
- **Client token** — **httpOnly cookie `waitron_device`** only (value `deviceId.token`, 1-year
  Max-Age, `sameSite:"Strict"`); helpers `apps/server/src/device-session.ts`. `requireDevice`
  (`device-session.ts:159`) verifies scrypt; `assertNotHandheld` (`device-session.ts:183`) is the
  hardcoded handheld fiscal firewall. **No client-side localStorage/sessionStorage device usage.**
- **A till is a server process** — identity from `WAITRON_TILL_*` env; users authenticated by operator
  session cookies. Hardware: receipt printer on `tills.receipt_printer_id`
  (`packages/db/src/schema/tenants.ts:230`; also the cash-drawer kick — no separate drawer device);
  card provider/reader from env (`apps/server/src/till-config.ts` — `WAITRON_TILL_CARD_PROVIDER`,
  `WAITRON_TILL_STRIPE_READER_ID`; `boot.ts:230`). KDS station→printer via `station_printers` m2m.

### 3.4 Abilities today

No device-capability catalogue. Abilities are three ad-hoc mechanisms: the `assertNotHandheld`
kind-firewall (server-enforced), station-scoped route gating (`/api/device/*`), and client shell
selection by kind. **"Can edit the table layout" is a *person-role* permission** (`till.configure`,
`packages/identity/src/permissions.ts`), surfaced as `SessionResult.canConfigureTill`, re-checked
server-side — orthogonal to device identity.

### 3.5 The dev "stuck device" pain (confirmed)

The device token is an httpOnly cookie (1-year), unreadable by script. `clearDeviceCookie`
(`device-session.ts:53`) exists but is **wired to no route** (only its own unit test calls it). The
lock screen hides its re-enrol affordance once `deviceEnrolled` (`till-app.ts:1832`,
`till-lock-screen.ts:150-155`). Reset today = dashboard-revoke-then-reboot, or manual cookie deletion.
No dev affordance exists.

---

## 4. The layout-profile model

### 4.1 Concepts

- **Profile** — a reusable, named template for one **form-factor**. Contains **1+ tabs**, a
  **form-factor** tag, an optional **theme override**, and (see §5) a set of **capability flags**.
- **Tab** — always a **grid**. A "single-card tab" (KDS board, floor plan) is simply a grid holding
  one full-span card. A tab replaces the old `HANDHELD_FACES` notion: "which tabs a profile has" =
  "which screens the device can reach".
- **Grid** — HA-Sections model: a **column count** per tab (driven by form-factor), cards placed by
  **span** (columns × rows), reordered by drag, **reflowing** to fewer columns on a narrower viewport.
  No stored pixel range; **form-factor + editor preview sizes** stand in for "what size is this for".
- **Card** — the universal unit. "Big" cards fill a tab (floor plan, table-layout editor, KDS board,
  expo/pass, table order); "small" cards share a grid (product grid, basket, total, tender/pay, prep
  queue, held orders, notifications). A big card is just a card with a full-tab span — no separate
  concept. (Implementation note, SP-A.1: `held-orders` is a small aside card — its `card-contract`
  default span is 4 wide, not full-tab.)

One device is assigned **one** profile (form-factor is a guardrail, not a runtime selector — devices
are used in a fixed orientation and do not switch profiles by size).

### 4.2 The card contract

Every card in the catalogue declares:

1. **config schema** — typed, validated keys (generalises today's `widget-config.ts`; e.g.
   `product-grid.columns`, a table-order card's default course view).
2. **required permission(s)** — the person-role permission gating its sensitive action(s). Drives the
   **in-card locked state** (§5).
3. **required capability/hardware** — what the device must have for the card to be *available at all*
   (e.g. a "pay by reader" card needs a bound/linked card reader). Drives **structural absence**
   (§6, axis 1).
4. **visibility states** — a card-owned set of named states plus which is current at runtime; the
   editor lets the author pick which states cause the card to render (§6, axis 3).
5. **theme-token-driven rendering** — no hardcoded chrome colour/spacing/radius/font; consumes
   `--wt-*` tokens only (§8). A card that hardcodes chrome is a bug.

### 4.3 Defaults & portability

Ship **built-in default profiles** per form-factor (till, handheld, KDS, …) — the same
"return-defaults-when-unauthored" precedent as `getLayout`. A venue starts from / copies a default.
Profiles serialise to plain JSON (they already would as jsonb), keeping the door open to
**community-contributed profiles** later without new machinery.

---

## 5. Abilities — two layers, both must permit

An "ability" splits along the seam that already exists in the code:

1. **UI-surface ability = card/tab presence.** "This handheld profile has the table-layout-editor
   card; that one doesn't." Pure profile config. This is what lets *another* handheld profile be
   allowed where one isn't. Makes `HANDHELD_FACES` obsolete.
2. **Device-capability flag = a small, server-enforced set on the profile** (e.g. take integrated-card
   payment, open the cash drawer, act as KDS). Generalises the hardcoded `assertNotHandheld` firewall
   from "kind == handheld → blocked" into "the profile says so", still enforced server-side.

**Person-role stays the server-side authority** for every sensitive action behind a card. A card being
*present* never bypasses its role check. So "edit table layout" = card in profile (layer 1) **and**
person-role permits the save (existing `till.configure`).

**UX rule:** when the signed-in person lacks a card's permission, the card renders **locked in place
and flagged up front** — never "looks usable, fails on tap". The client already learns session
permissions at login (`canConfigureTill` precedent); each card maps its `required permission` to an
available/locked state at render.

---

## 6. Visibility — three distinct axes

Kept separate so the fiscal-sensitive one stays safe:

1. **Capability/hardware → ABSENT.** Structural; the card isn't in the layout for a device lacking the
   capability/hardware. Config-time, not a runtime toggle.
2. **Permission → LOCKED (not hidden).** Per §5 — visible but locked when the person's role lacks it.
3. **Runtime data condition → SHOW/HIDE live.** Each **card declares its own states** (e.g. a
   notifications card: `unread` / `any` / `empty`); the author picks which states should render the
   card. No global condition language and no shared context contract — each card is the authority on
   its own states and computes them from data it already has. Default: always render. A false-state
   conditional card is simply not rendered and its grid space collapses.

---

## 7. Device unification & the fiscal boundary

**A till becomes a first-class enrolled device** — a new `till` value on the `device_kind` enum,
alongside `kds_station` and `handheld`. All screens enrol via the existing pairing-code flow and boot
into their assigned profile.

**Fiscal identity does NOT move.** The SIF / hash chain / installation number / series stay anchored
to the **node** (server), exactly as today ("SIF = the submitting node, not the till"). A till-device
is a **non-fiscal client** that files under its node's SIF, exactly as handhelds already do; the only
fiscal touchpoint is that `till_id` **metadata** on records is now sourced from the device record
instead of an env var.

> **H2 gate — owner sign-off + a code receipt before landing.** This §7 principle is *design intent*,
> not a verified fact. Before any code lands, trace every consumer of the env-based till identity,
> `till_id`, and `node_id` (start at `record-sale.ts` and the fiscal backend) and prove — with a
> container/test, not by reading — that enrolment/profile/hardware changes never touch the chain,
> installation number, or series. Per `CLAUDE.md` §1/§5, reading is not verification.

---

## 8. Hardware binding

**All hardware moves onto the device record.** A device references its **receipt printer** (with a
`has cash drawer` flag on that binding — the drawer is the printer's kick, no separate device) and its
**card provider + reader selection** (`none` / `stripe_terminal` + reader id / `stripe_on_device`),
moved out of env. **Provider *credentials* stay sealed in the credentials vault**; only the selection
lives on the device. **Profiles stay hardware-free** — hardware is per physical device instance; a
profile is a shared template. A card's hardware requirement (§6 axis 1) is checked against the
device's actual attachments. Because the binding is on the (synced) device record, a card reader
**travels with the device across a failover** instead of being pinned to a node's env.

**Two binding modes:**

- **Static** — device ↔ hardware fixed at set-up (a till and its printer/drawer/reader).
- **Transient** — a handheld grabs one of a few shared **networked** card readers by **NFC tap**; the
  link is **exclusive** (one handheld holds a reader at a time; a new tap transfers it); the **node
  routes** the payment request to the currently-linked reader over the network. Card readers/POS
  terminals are therefore modelled as **first-class networked devices** (registered with an identity,
  addressable by id) — essentially Stripe Terminal's server-driven model.

**Scope decision:** this initiative **models** networked readers + transient links in the device/
hardware layer, but the **NFC pairing runtime + payment routing is a follow-on slice** (payments-
adjacent, gated on the open SumUp/reader questions in the backlog `Debt → SumUp` and the tap-to-pay
research). Readers are registered through the payment provider (e.g. Stripe Terminal), **not** the
browser pairing-code flow.

---

## 9. Theme

A theme is a set of `--wt-*` token overrides. **Tenant base + optional per-profile override** (a
profile inherits the tenant theme unless it sets its own) — covers brand consistency plus real
per-role variation (e.g. a dark KDS while the till stays light); no per-device layer. **This
initiative guarantees the token-driven card contract and stores the theme at those scopes; the visual
theme editor is a follow-on slice.**

---

## 10. Enrolment flow

Extends, not replaces, the pairing-code flow. In the dashboard, **"Add device"** picks the **kind**,
the **assigned profile**, the **hardware bindings**, and a label, then mints a pairing code (carrying
those). The physical device redeems the code at `POST /api/device/enrol` (as today) → httpOnly cookie
→ boots into its assigned profile. Revoke (`active=false`) is unchanged.

---

## 11. Dev per-tab device switcher (dev-only)

Each browser **tab** can act as a different configured device — better than a global dropdown because
the real device token is a single shared cookie. Mechanism:

- A **dev-only** picker sets *this tab's* device into `sessionStorage` (tab-scoped).
- The client sends a **dev-override header** on each request; the server honours it **only** in
  dev/preproduction, **never** production (guarded, fail-closed to the cookie).
- Also **wire the unused `clearDeviceCookie`** to a device-reset route so a browser can drop its
  identity.

Result: run a till in one tab and a handheld in another, side by side, to test profiles and the
handheld→KDS→till flow.

---

## 12. Decomposition & order

Approved order: **A → C → B**, with follow-ons after.

- **SP-A — Device & profile foundation** *(first; everything sits on it)*. Data model (profiles,
  tabs, grid, card catalogue + contract), the `till` device kind, per-device hardware bindings
  (static; modelled for transient), enrolment extension, the two-layer ability model + three
  visibility axes, built-in default profiles, theme storage (tenant + per-profile) and the
  token-driven card contract. Reworks/replaces `@waitron/layouts` and the `till_layouts` table.
- **SP-C — Dev per-tab device switcher** *(second; small, unblocks side-by-side testing of A and B)*.
  Per-tab `sessionStorage` identity + dev-only override header + the reset route.
- **SP-B — Grid editor + rendering** *(third; largest)*. The HA-Sections editor UI (drag/move/resize,
  preview sizes, tab management, per-card properties incl. visibility states and the locked-permission
  indicator) and making screens **render from grid profiles** — wrapping today's bespoke screens
  (floor plan, KDS board, expo, table order) as cards. Expect **phasing** here (counter is already
  grid-driven; table-order/floor/KDS wrap incrementally).
- **Follow-ons (each its own slice):** visual **theme editor**; **NFC pairing runtime + payment
  routing** to a linked networked reader; **community profile sharing**.

Each sub-project gets its own spec → plan → implementation cycle. SP-A is specified here in enough
detail to plan next; SP-B/SP-C are outlined and will be specced when reached.

---

## 13. Boundaries & invariants to preserve

- **Fiscal core (H2).** §7 gate: SIF/chain stays on the node; verified-by-container + owner sign-off
  before landing anything fiscal-adjacent. Never widen a grant to make a test pass.
- **No back-compat / data migration (pre-production).** The existing `till_layouts` is **dropped and
  recreated**, not migrated; schema changes drop/recreate; no backfill.
- **New tenant-scoped tables need FORCE RLS + a tenant-isolation policy + grants** (not just
  `.enableRLS()`), and after adding any such table run
  `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad`.
- **Error codes name the domain concept, not the package** (`profile.*`, `device.*`, `layout.*` —
  grep siblings before coining); never renamed once shipped; every throwing file imports its registry.
- **No SQL by string concatenation**; utility statements (`CREATE ROLE`, `GRANT`, …) escape/validate.
- **No hardcoded chrome** in any card — `--wt-*` tokens only.
- **Nothing may block a sale** (fiscal §5); sale-critical cards remain mandatory in a till profile
  (generalises today's `SALE_CRITICAL` guard).

---

## 14. Open questions / risks

- **SP-B is large** — wrapping several mature bespoke screens (floor plan, KDS, table-order) as cards
  is the bulk of the effort and the main schedule risk; phasing is expected and will be planned in
  SP-B's own spec.
- **Transient-reader details** (link lifetime: per-payment vs until-reassigned; which side carries the
  NFC identifier; contention/handover semantics) are deferred to the NFC follow-on, but SP-A's data
  model must not foreclose them.
- **SumUp/tap-to-pay unknowns** (backlog `Debt → SumUp`) gate the reader-routing follow-on.
- **Grid reflow rules** across form-factors (how card spans collapse on the narrowest supported width)
  need concrete rules in SP-B.

---

## 15. References

- Existing code: §3 file:line citations throughout.
- Package to rework: `packages/layouts/*`; table `till_layouts`
  (`packages/db/src/schema/layouts.ts`, `drizzle/0035`/`0036`).
- Device model: `packages/db/src/schema/devices.ts`, `apps/server/src/{device,device-api,device-session,
  till-config}.ts`, `packages/identity/src/permissions.ts`.
- Design system tokens: `@waitron/ui` token layer + primitives (`--wt-*`) — backlog SP1.
- Related specs: `2026-08-15-distribution-and-client-topology-design.md`,
  `2026-08-01-local-server-sif-and-failover-design.md`,
  `2026-07-30-sumup-card-present-provider-design.md`.
- Backlog: sub-projects SP1 (design system), SP7 (counter POS), SP12 (KDS/devices), SP10/11
  (tabs/floor); `Debt → SumUp`, `Debt → Cross-cutting (handheld layout/face-set editor)`.

---

## 16. SP-A.2 slice — resolutions (2026-09-02, pre-plan)

Brainstorming for the SP-A.2 implementation plan resolved the open points below. Recorded here (with
receipts, per `CLAUDE.md` §1) so the plan can cite them; this section refines §4–§13, it does not
replace them. All owner decisions were taken 2026-09-02.

### 16.1 Slice shape — one H2-gated unit

SP-A.2 is the **full** device-unification slice per the backlog, **not** the finer A.2 (persistence)
/ A.3 (device) split the SP-A.1 plan's "does NOT do" proposed. It bundles: the `layout_profiles` +
`tenant_themes` tables, the store service, the management API, the `till` device kind, the
device→profile FK, static per-device hardware bindings, the enrolment extension, server-side
capability enforcement, theme storage, **and the fiscal `till_id` cutover** — one slice, H2-gated,
nothing lands without the §16.4 receipt and owner sign-off. (Owner decision. The SP-A.1 plan's
"does NOT do" text describing an A.2/A.3 split is superseded by this.)

### 16.2 `till_layouts` stays until SP-B

The old widget model is **not** removed in SP-A.2. `till_layouts`, `WIDGET_TYPES`, `validateLayout`,
the counter render (`apps/till/src/screens/till-counter-screen.ts`, which reads it via `getLayout`),
and `GET /api/till`'s `layout`/`receipt` fields all remain — the counter still renders from the
widget model until the SP-B rendering swap. SP-A.2 **adds** `layout_profiles` + `tenant_themes`
alongside it. (Corrects an in-session claim that `till_layouts` is dropped in this slice; §13's
drop-not-migrate principle governs *when SP-B removes it*, not this slice.)

### 16.3 Schema (`@waitron/db`)

- **`layout_profiles`** — `id` uuid pk; `tenant_id` → `tenants.id` (`onDelete restrict`); `name` text;
  the whole `ProfileDef` (form factor, tabs, capabilities, optional theme) as one **validated jsonb**
  `definition` — the opaque-jsonb precedent from `packages/db/src/schema/layouts.ts` (`till_layouts`),
  which avoids the `@waitron/layouts` ↔ `@waitron/db` dependency cycle by validating shape on write
  and storing opaque jsonb. `updated_at`. `UNIQUE(tenant_id, name)` and `UNIQUE(tenant_id, id)` (the
  latter is the composite-FK target for `devices.layout_profile_id`).
- **`tenant_themes`** — `tenant_id` pk; `theme` jsonb; `updated_at`. The one-per-tenant **base**
  theme; the per-profile **override** lives inside a profile's `definition.theme`. get-with-default
  returns "no override" when the row is absent (no backfill).
- **`device_kind` enum** — add `"till"` (additive `ALTER TYPE … ADD VALUE`, hand-written migration —
  the enum comment at `packages/db/src/schema/devices.ts:13-24` already anticipates this). Update
  `kindRequiresStation` (`apps/server/src/device.ts:103`) so `till` needs no station, and extend the
  per-kind station `CHECK` on both device tables.
- **`devices`** and **`device_pairing_codes`** each gain, stamped at enrol: `layout_profile_id`
  (composite FK → `layout_profiles(tenant_id, id)`, `restrict`, nullable), `till_id` (composite FK →
  `tills(tenant_id, id)`, `restrict`, nullable — the fiscal register-snapshot, §16.4; populated for
  **every sale-capable kind** — `till` AND `handheld`, since both record sales at `/api/sales` — and
  left NULL for `kds_station`, which rings none), and static hardware:
  `receipt_printer_id` (composite FK → `printers`), `has_cash_drawer` bool, `card_provider` text
  (`none | stripe_terminal | stripe_on_device`), `card_reader_id` text (external reader id; provider
  **credentials stay in the vault**, only the selection lives here). All additive.
- Both new tenant tables carry **FORCE RLS + a `_tenant_isolation` policy + `app_user` grants** in the
  paired `--custom` migration (`.enableRLS()` alone is insufficient — `CLAUDE.md` §3). Run
  `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` after adding them.

### 16.4 Fiscal cutover mechanism (H2) — the receipt

**Every sale-capable device** (`till` and `handheld`) carries a **`till_id` FK to the existing
`tills` row** it rings against, stamped at enrol (owner decision, 2026-09-02: "any sale-capable device
carries `till_id`" — `/api/sales` is unfenced against handhelds, `till-api.ts:722-728`, so a handheld
also writes `till_id` to `registros_facturacion`). At sale time the value passed to `recordSale`
(today `cfg.tillId` at `till-sale.ts:598` and the other `recordSale` call sites) resolves **only**
from the authenticated device's `till_id`; the env `WAITRON_TILL_TILL_ID` is **retired as the
sale-time source** (kept only for setup/adopt seeding). `nodeId` (the SIF / series anchor; the guard
is `series.nodeId !== input.nodeId` at `packages/core/src/record-sale.ts:239`), `seriesId`, and every
huella input are **untouched**; `till_id` is confirmed **not** a huella input (the eight-field alta /
five-field anulación tuples at `packages/verifactu/src/types.ts:197` and `:209` do not include it).

**One intended metadata change, not a regression:** a handheld today stamps the single env till
(`cfg.tillId`) on its sale; after the cutover it stamps its **assigned** `tills` row. That `till_id`
value legitimately *changes* for handhelds (a node may now have several tills). This is deliberate —
the handheld records against the register it is assigned to — and is safe precisely because `till_id`
is inert to the chain (proven by §16.4(b)). A `till`-kind device assigned the *same* `tills` row the
env named is byte-identical (§16.4(a)).

**The receipt** (container / mutation, never reading — `CLAUDE.md` §1/§5). State the failing case
before running each probe: if the device path sourced a *different* `till_id`, or if any device /
profile / hardware code perturbed `nodeId` or the series, the records would **differ** — that is what
each probe below must be able to show, not just confirm the pass:

- **(a) Cross-baseline byte-identity.** Record a sale for one `tills` row X on the **pre-change build**
  (env sources `till_id = X`) and on the **post-change build** (a till-device with `till_id = X`), in a
  container against real Postgres. The two `registros_facturacion` rows — `huella`, `huella_anterior`,
  the canonical string, the whole chain — are **byte-identical**. The FAILING case that makes this
  meaningful: a build where `device.till_id ≠ X` (see (b)) produces a *different* `sales.till_id`, so
  the probe distinguishes the two.
- **(b) Mutation control.** Force `device.till_id` to a *different* `tills` row and re-record: **only**
  `sales.till_id` and the record's `till_id` snapshot change; the `huella` / chain / series /
  installation number do **not** (confirms `till_id` is inert to the chain, consistent with
  `types.ts:197/209`).
- **(c) `nodeId` untouched.** Trace every `nodeId` producer from the sale handler down and prove — by
  a test that fails when the device path is made to influence `nodeId` — that no device / profile /
  hardware code path feeds it.

Plus explicit owner sign-off before the PR lands.

### 16.5 Sale-block risk to preserve (§5 fiscal invariant)

Requiring every sale-capable device (till and handheld) to be enrolled **with a `till_id`** is a
**setup precondition, not a per-sale block** — directly analogous to today's boot-time
`server.till_config_missing` when `WAITRON_TILL_*` is unset (`apps/server/src/till-config.ts`).
Handhelds already enrol via the pairing-code flow today; the only addition is that enrolment now
assigns the `tills` row they ring against. Once enrolled, sales proceed with nothing blocking them, so
"nothing may block a sale" holds. One **new failure mode** to document and mitigate: a lost or cleared
`waitron_device` cookie (httpOnly, `sameSite:Strict`, 1-year Max-Age — `device-session.ts:21-47`)
stops sales until re-enrol. Mitigations: the long-lived cookie makes loss rare; SP-C adds the
device-reset route (wiring the currently-orphaned `clearDeviceCookie`, `device-session.ts:53`) and the
dev per-tab switcher. Recorded, not a blocker.

### 16.6 Server-side capability enforcement

Generalise the hardcoded `assertNotHandheld(action)` firewall (`device-session.ts:183`; called after
`requireSession` at six fenced routes — pay/place/reprint/drawer/collect/cancel,
`apps/server/src/till-api.ts:765,912,1136,1192,1253,1279`) into a **profile-capability check**: each
fenced route names the `CapabilityFlag` it requires (e.g. `POST /api/pay` → `integrated-card-payment`,
drawer-open → `open-cash-drawer`), checked against the authenticated device's **profile**
capabilities. The built-in **handheld default profile omits those flags**, so existing handheld
behaviour is preserved — pinned by a proven-by-deletion test. Person-role permission checks (layer 1,
§5) are unchanged: a present card never bypasses its role check.

### 16.7 SP-A.1 deferrals — folded in

- **(a)** `validateProfile` folds in `validateThemeOverride` so a profile's `theme` **round-trips**
  (today it is dropped) — required for per-profile theme storage (§9, §16.3).
- **(b)** dedicated `profile.invalid` reasons: `bad_capabilities` (a bad capability flag, replacing the
  `not_object` overload) and `bad_tab` (a non-array `cards`). New leaf reasons under the existing
  `profile.invalid` code (`packages/layouts/src/errors.ts:75-91`); the code itself is never renamed.
- **(c)** keep the **provisional seven** `THEMEABLE_TOKENS` and add a **cross-package consistency
  guard** that sources/verifies every entry against the real `packages/ui/src/tokens/{colors,
  structure}.css` registry (turning today's dated-comment check in `packages/layouts/src/theme.ts`
  into an enforced test); defer the "which tokens are exposed" expansion to the theme-editor slice,
  where a visual editor can validate them. (Owner decision.)
- **(d)** `validateProfile` **defensively copies** the returned card `config` (today it copies
  `visibleWhen` only; `config` still aliases the input).

### 16.8 Reader model = static only

SP-A.2 builds **only** the static per-device hardware binding (§16.3). The reader-as-first-class-
networked-device model and the exclusive transient link are deferred **wholly** to the NFC follow-on
(§8) — the static `card_provider` / `card_reader_id` columns are additive, so nothing about that model
is foreclosed. (Owner decision, tightening §8's "models … transient" to "does not foreclose
transient".)
