# SP-B — Grid editor + rendering — design

- **Track:** Layout designer & device profiles (owner-inserted 2026-09-02).
- **Parent design:** [`2026-09-02-layout-designer-and-device-profiles-design.md`](2026-09-02-layout-designer-and-device-profiles-design.md).
- **Status:** Design approved (owner, 2026-09-03). SP-A.1 (#194), SP-A.2 (#199) and SP-C (#201)
  landed; SP-B is the sole remaining sub-project of this track.
- **Author:** brainstormed 2026-09-03 (owner present; three decisions resolved below).
- **Fiscal gate:** **Not H2.** SP-B changes *rendering and authoring*, not sale recording or the
  fiscal chain. But it **must preserve the sale path** — see §9.

---

## 1. Summary

SP-A delivered the layout-profile *data model* (profiles, tabs, grids, a 12-card catalogue with
per-card contracts, validation, built-in defaults, storage, RLS) and pushed the resolved `profile`
JSON to the till client — where it is currently ignored. SP-B makes the app **render from that
model** and gives owners a **visual grid editor** to author it, then removes the old widget model.

Three things do not yet exist and are the whole of SP-B:

1. A **grid/card renderer** in `apps/till` (there is none) plus a **tab shell**, booting the till
   into the `profile` model.
2. The four bespoke full-screen till screens (floor-plan, kds/station, expo, table-order) **wrapped
   as full-span cards**, plus the counter's small cards.
3. A dashboard **grid editor** (placeholder tiles, drag/move/resize) with its API-client methods and
   a route to reassign a profile to an already-enrolled device.

Then the old widget model (`till_layouts`, `WIDGET_TYPES`, `validateLayout`, `getLayout`, the
region-based counter render, the old dashboard widget editor) is **dropped**, and receipt config is
**rehomed** into a new `tenant_receipts` table.

**Out of scope (follow-ons, some owner-committed):** the visual **theme editor**; **NFC pairing
runtime / payment routing**; **community profile sharing**; **live card renders in the editor**
(v1 ships placeholder tiles at the same card-host seam a live render will later occupy —
owner-committed direction, §2, §8); and any **responsive column reflow / live-rotation** (parent
design §14 open item) should a rotating-device need ever arise (SP-B ships fluid width scaling only,
§2 decision (a)). **Not fiscal (not H2):** SP-B changes *rendering and authoring*, not sale recording
or the chain — but it **must preserve the sale path** (sale-critical cards stay mandatory on the till
profile; nothing new may block a sale, §10).

## 2. Decisions resolved in brainstorming (2026-09-03)

Recorded here so the plan can cite them:

- **Slicing = rendering-first** (B1 renderer/counter → B2 wrap bespoke screens → B3 editor → B4
  removal). Rationale: prove the profile model actually renders (de-risking the core) before building
  the tool that authors it; the editor is easier to build and validate once cards render for real.
- **Editor fidelity = placeholder tiles *for v1* (a deferral, not the end state).** Each card in the
  editor is a labelled tile (name + icon + span + resize/drag handles + a property panel), **not** a
  live render of the card. Live WYSIWYG is deferred, not rejected: the owner's intent is that the
  editor **will** show live card renders later. It is out of SP-B because faithful previews need till
  runtime context the dashboard lacks (a headless mock/data harness) — high effort and schedule risk
  for this slice. **Design constraint:** the tile occupies the **same card-host seam** a live render
  will later occupy, so swapping a tile for a real card render is a drop-in at that boundary, not a
  canvas rework. Tracked as a follow-on (§1).
- **Receipt config home = a new `tenant_receipts` table** (one row per tenant, mirroring
  `tenant_themes`). Folding receipt into `ProfileDef` was rejected (a tenant has many profiles but
  one receipt trim — no single profile owns it); folding into `tenant_themes` was rejected
  (overloads a table named for theming).

Three further calls the owner confirmed, presented as design (not questions):

- **(a) Fluid width, no column reflow.** The grid renders at its authored `columns` count using
  fluid columns (`grid-template-columns: repeat(columns, 1fr)`), so it **always fills the available
  width**: browser-window resize (including the SP-C dev switcher) and same-orientation screen-size
  differences (a 10" vs 13" tablet) scale every cell proportionally — for free, no reflow. What SP-B
  does **not** do is *responsive column collapse* (re-wrapping cards to fewer columns past a
  breakpoint). Orientation is a **form-factor choice, not a runtime adaptation**: `tablet-landscape`
  and `phone-portrait` are separate form-factors/profiles, and a device is provisioned to one fixed
  orientation (parent design §4.1). A physically rotated device won't *break* (fluid scaling refills
  the new width) but may look cramped — accepted, because rotation-in-service isn't a supported flow.
  True responsive reflow / live-rotation remains the parent design's open item (§14) for a future
  need; it is out of SP-B. Form-factor also drives the *editor's* preview sizes (§8).
- **(b) Transient drill-ins stay app-level, not authored tabs.** A specific table's order, the
  ticket/receipt view, and the schedule are pushed surfaces the profile does not author (§5).
- **(c) The dashboard is the only place to author profiles.** The till keeps its floor-plan
  *table-position* editor (the `table-layout-editor` card), but there is no on-till grid-layout
  editor.

---

## 3. Current state (grounded)

### 3.1 The profile model exists and is complete (`@waitron/layouts`)

Landed by SP-A.1/A.2. The editor edits, and the renderer consumes, these shapes
(`packages/layouts/src/profile.ts:46-77`):

```ts
interface CardInstance { type: CardType; colSpan: number; rowSpan: number;
                         config: Record<string, unknown>; visibleWhen?: string[]; }
interface TabDef       { key: string; title: string; columns: number; cards: CardInstance[]; }
interface ThemeOverride{ tokens: Record<string, string>; }
interface ProfileDef   { formFactor: FormFactor; tabs: TabDef[];
                         capabilities: CapabilityFlag[]; theme?: ThemeOverride; }
```

- 12 card types (`profile.ts:18-32`); `FORM_FACTORS = ["till","phone-portrait","tablet-landscape","kds"]`
  (`profile.ts:9-10`); `CAPABILITY_FLAGS = ["integrated-card-payment","open-cash-drawer","act-as-kds"]`
  (`profile.ts:38-43`).
- Per-card contract registry `CARD_CONTRACTS` (`card-contract.ts:36-124`): `configSchema`,
  `requiredPermission`, `requiredCapability`, `visibilityStates`, `defaultColSpan`/`defaultRowSpan`,
  `saleCritical`. `GRID_MAX_COLUMNS = 24` (`card-contract.ts:6`). `SALE_CRITICAL_CARDS` is derived
  (`card-contract.ts:127-129`) → `["product-grid","basket","total","tender-pay"]`.
- `validateProfile` (`validate-profile.ts:41-55`) fail-closed, server-authoritative on every write;
  `validateThemeOverride` (`theme.ts:45-66`) allowlists 7 `--wt-*` tokens. Selling form-factors
  (`SELLING_FORM_FACTORS = ["till"]`) must place every sale-critical card.
- Built-in `DEFAULT_PROFILES` per form-factor (`default-profiles.ts:87-92`); the TILL default has a
  `counter` tab (product-grid/basket/total/tender-pay/held-orders) and a `floor` tab (floor-plan).
- Error families `profile.invalid`/`profile.not_found`/`profile.name_taken`/`theme.invalid`
  (`errors.ts`), reachable via the barrel's side-effect import.

### 3.2 Storage + API exist (`layout_profiles`, `tenant_themes`, management API)

- `layout_profiles` (many rows/tenant; jsonb `definition`) — `packages/db/src/schema/layout-profiles.ts:26-50`;
  FORCE RLS + `tenant_isolation` policy + SELECT/INSERT/UPDATE/DELETE grants in
  `drizzle/0089_normal_ted_forrester.sql:24-30`. `tenant_themes` (one row/tenant) —
  `tenant-themes.ts:28-47`, `drizzle/0091_moaning_sharon_carter.sql:24-30` (no DELETE).
- Management API (`apps/server/src/management-api.ts:882-1057`): `GET/POST /management-api/profiles`,
  `GET/PUT/DELETE /management-api/profiles/:id`, `GET/PUT /management-api/theme`. Every route
  `requireManagementSession` → `withTenant` + `asAppUser`; writes gate `till.configure` inside the
  store; error→HTTP map at `:220-223` (`profile.not_found`→404, `profile.name_taken`→409,
  `*.invalid`→400).
- **Gap:** the dashboard API client (`apps/dashboard/src/api/client.ts:1849`) has **only
  `listProfiles()`** — no get/create/update/delete/theme methods.
- **Gap:** there is **no route to assign a profile to an already-enrolled device**. Assignment is
  mint-time only, via `POST /management-api/device-codes`'s `layoutProfileId`
  (`apps/server/src/device-api.ts:296`), stamped onto the `devices` row at enrol.

### 3.3 The profile already reaches the client, unused

`GET /api/till` (`apps/server/src/till-api.ts:612-736`): `tryReadDevice` (`:619`) resolves the calling
device; when `device.layoutProfileId != null` the boot tx resolves `getProfile(...)` (`:663-666`) and
spreads `profile: boot.profile.definition` onto the response **only when present** (`:733`) — additive,
so a cookieless payload is byte-for-byte unchanged. The client type carries `profile?: unknown`
(`apps/till/src/api/client.ts:98`), explicitly marked "consumed in SP-B". `getProfileForFormFactor`
(`profile-store.ts:187`) exists and is barrel-exported but **has no consumer** — the form-factor
fallback is not yet wired.

### 3.4 Nothing renders from a profile yet

- **`apps/till` has no card/grid renderer.** `till-app.ts` is a hand-rolled state machine over a
  `screen` enum (`type Screen = "lock"|"counter"|"ticket"|"schedule"|"floor"|"table-order"|"station"|"expo"`,
  `:66-67`); `#renderScreen()` (`:1886-1974`) is a big `switch`. The `profile` field is never read;
  `#layoutFor()` (`:1793-1800`) still feeds the OLD `LayoutDef`.
- **The counter is NOT grid-driven** (correcting parent design §12's "counter is already
  grid-driven"). `till-counter-screen.ts` renders from the OLD region model: a fixed two-column
  `main`/`aside` CSS layout (`:100-105`) with a `#widget()` switch over `WidgetType` (`:267-307`) and
  a bespoke header (brand + Allergens/Floor/Station/Expo/Schedule/Logout + language chooser). It reads
  a local `LAYOUT_A`/`LayoutDef` (`apps/till/src/layout.ts`), never a profile.
- **The four bespoke screens** are self-contained full-screen Lit elements under
  `apps/till/src/screens/`, each rendering `<section class="screen">` with its own header + Back
  button, communicating props-down / composed-events-up:
  - `till-expo-screen.ts` — **highest self-containment**; self-fetches via `.api`, needs only
    `api`/`fireControl`.
  - `till-floor-screen.ts` — high; renders purely from `zones`/`tables` props; already has a
    `canExitToCounter` flag that suppresses its Back button (a partial "embeddable" seam).
  - `till-station-screen.ts` (kds-board) — high, but self-fetches and carries device-mode/enrol paths
    that overlap the device model.
  - `till-table-order-screen.ts` — **heaviest** prop surface (~12 props) and drives an internal
    round-composing `WorkingOrderStore`; most event wiring (`send-round`/`serve-line`/`pay-tab`/
    `move-tab`/`merge-tabs`/`transfer-lines`/…). The main schedule risk.

### 3.5 The old widget model to be removed (every consumer)

- Package: `packages/layouts/src/{types.ts,defaults.ts,widget-config.ts,validate.ts,store.ts}` and
  the `till_layouts` table (`packages/db/src/schema/layouts.ts:28-43`).
- **Survives removal** (reused by the profile model): `ReceiptConfig` + `validateReceiptConfig`
  (`validate.ts:94`, shared by both models), and `ConfigValidator`/`WidgetConfigSchema`
  (`widget-config.ts:8-11`, reused by `card-contract.ts:3`).
- Server consumers: `GET /api/till` `layout`/`receipt` (`till-api.ts:658,727-728`);
  `receipt-print.ts:52,135` (receipt half only); `management-api.ts` layout/receipt routes
  (`:812,843,872`).
- Dashboard consumers: `layout-screen.ts` (the old widget editor), `receipt-screen.ts`,
  `api/client.ts` (`getLayout`/`putLayout` + mirror types), nav registration in `dashboard-app.ts:22-23`.
- Till consumers: `api/client.ts:89-90` (`TillInfo.layout`/`receipt`), `layout.ts` (local mirror),
  `till-counter-screen.ts`, `#layoutFor()` in `till-app.ts`.

### 3.6 `@waitron/ui` — what the editor and cards build on

- Doc: `docs/developers/design-system.md` (contract; enforced by
  `packages/ui/src/no-hardcoded-chrome.test.ts`). Primitives: `wt-button`, `wt-icon`, `wt-card`,
  `wt-input`, `wt-switch`, `wt-dialog`, `wt-table-token`, and **`wt-floor-canvas`**
  (`packages/ui/src/components/wt-floor-canvas.ts`) — the existing drag/resize/snap canvas
  (pointer lifecycle, `gridSnap`, snap-to-grid, rotation detents) to **adapt** for the card grid.
- Tokens: `packages/ui/src/tokens/{colors,structure}.css` (`--wt-*`). The 7 themeable tokens are the
  allowlist in `theme.ts:19-27`.
- **Gap:** no draggable-card / grid-cell primitive yet — SP-B adds one (follow the "Adding a
  primitive" checklist in the design-system doc: test-first in real Chromium, `baseStyles`, reflect
  variant props, `--wt-tap-min` hit targets, an axe a11y test in both themes).

---

## 4. Runtime rendering (till) — B1/B2

The `screen` enum + `#renderScreen` switch is replaced by a **tab shell** plus a **grid renderer**.

- **Tab shell.** A tab bar built from `profile.tabs` (key/title). The active tab is app state. Tabs
  are switched by the user (tapping the bar) *and* programmatically by card events (§5). The bespoke
  header chrome the counter carries today (nav buttons, language chooser) relocates to the shell so
  every tab shares it.
- **Grid renderer.** For the active tab, a CSS grid of `columns` columns using **fluid `1fr`
  columns** (`grid-template-columns: repeat(columns, 1fr)`); each `CardInstance` spans `colSpan` ×
  `rowSpan`. Because columns are `fr`, the grid always fills the available width — window resize and
  same-orientation screen-size differences scale proportionally with **no reflow** (decision (a)); the
  column *count* is never changed at runtime. A new `wt-*` grid/card primitive (adapted from
  `wt-floor-canvas` mechanics) hosts each card.
- **Card registry.** A `cardType → Lit element` map in the till bundle resolves each `CardInstance.type`.
  Small cards (product-grid/basket/total/tender-pay/held-orders/prep-queue/notifications) are existing
  till widgets rebound to the card host; big cards (floor-plan/kds-board/expo/table-order/
  table-layout-editor) are the wrapped bespoke screens (§6).
- **Local mirror types (bundle rule).** The till never imports `@waitron/layouts` (it already mirrors
  `LayoutDef` locally). SP-B adds a local `ProfileDef`/`CardType`/`TabDef`/`CardInstance` mirror; the
  server is authoritative on validation, so the client trusts the shape it receives.
- **Profile resolution.** `GET /api/till` resolves **explicit device profile → else the form-factor
  default** (`getProfileForFormFactor`), so an unassigned device still renders. B1 wires this fallback
  (today only the explicit path exists, §3.3).

### 4.1 Boot behaviour across slices

- **B1:** the till boots into the tab shell + renderer and renders the **counter tab's small cards**
  from the profile. Tabs whose card is a not-yet-wrapped big card (e.g. `floor`) render a thin card
  host that mounts the existing bespoke screen element unchanged (they are already self-contained), so
  no screen is lost mid-slice. The old `layout` field stays as a safety fallback until B4.
- **B2:** each bespoke screen becomes a real full-span card (header/Back chrome removed in favour of
  the shell); the navigation model (§5) replaces the `screen` enum transitions.

---

## 5. Navigation model — B2

Two layers, matching today's behaviour so no flow is lost:

- **Authored tabs** = persistent top-level surfaces from `profile.tabs`. The tab bar switches them.
- **Transient drill-in stack** = app-level pushed surfaces that the profile does **not** author: a
  chosen table's order, the ticket/receipt view, the schedule. A `floor-plan` card's "open table 5"
  pushes the table-order surface with that order's context and pops back — exactly today's
  `open-table`/`back-to-floor`/`back-to-counter` composed-event flow, layered over the tab shell
  instead of the `screen` enum.

So `table-order` is one Lit element mounted two ways: a **full-span card** in a handheld's `order`
tab (where ordering is the primary job), or a **pushed drill-in** on a till (reached from the floor).
This duality is deliberate and is why drill-ins are not forced to be authored tabs.

---

## 6. Wrapping the bespoke screens as cards — B2

Order by ascending effort (§3.4): **expo → floor-plan → kds/station → table-order**. For each:

- A thin full-span card wrapper mounts the existing Lit element in the card host.
- The screen's own header + Back button are removed; the tab shell / drill-in stack provides them
  (the floor screen's `canExitToCounter` seam is the precedent).
- Data the app fetches for a screen moves to the card/host boundary; self-fetching screens (expo,
  station) need little. Table-order's large prop surface + internal `WorkingOrderStore` is the
  heaviest and is taken last.
- Behaviour is preserved: every composed event a screen emits keeps working against the shell.

---

## 7. Card semantics at render — B1/B2

The three visibility axes (parent design §6), kept separate so the fiscal-sensitive path stays safe:

1. **Capability → ABSENT.** Editor-time: a card with a `requiredCapability` may only be placed in a
   profile whose `capabilities` include it. The renderer also **defensively skips** such a card if
   the capability is absent, collapsing its grid space.
2. **Permission → LOCKED in place.** The client maps a card's `requiredPermission` to a locked
   overlay from the session permissions it already learns at login (`canConfigureTill` precedent) —
   visible but locked, never "looks usable, fails on tap".
3. **Runtime data → `visibleWhen`.** Each card computes its own declared states and renders only when
   its current state is in `visibleWhen` (absent/empty ⇒ always). A card in no matching state is not
   rendered and its grid space collapses. No global condition language.

---

## 8. Dashboard grid editor — B3

- **Screen.** A new `dashboard-*-screen` in the `configuration` nav group (`dashboard-app.ts:132-138`),
  succeeding the old `layout-screen.ts`. Lit + `wt-*` primitives, injected `api`, i18n via `t()`.
- **Canvas.** Placeholder-tile grid (decision: placeholder tiles *for v1*): a labelled tile per card
  (name + icon + current span), drag to move, handles to resize, driven by an adapted
  `wt-floor-canvas`-style pointer/snap lifecycle. A card palette sourced from `CARD_CONTRACTS`
  (default spans on drop, per-card config schema, `requiredPermission`/`requiredCapability`,
  `visibilityStates`). **Seam for live renders:** each tile is mounted at a card-host boundary so a
  future follow-on can swap the tile for a real card render without reworking the canvas (§1, §2).
- **Property panel.** Per selected card: config keys from `configSchema`; `visibleWhen` chosen from
  the card's `visibilityStates`; a locked-permission indicator. Per tab: title, `columns`. Per
  profile: form-factor, capabilities, name.
- **Preview sizes.** Form-factor drives the editor's preview canvas dimensions (the only place
  form-factor matters at authoring time; no runtime reflow).
- **Client-side validation** mirrors `validateProfile`/`validateThemeOverride` for fast feedback; the
  server re-validates every write (authoritative).
- **New API-client methods** (endpoints already exist server-side): `getProfile`, `createProfile`,
  `updateProfile`, `deleteProfile`, `getTheme`, `putTheme`.
- **Reassign route.** A new `PUT /management-api/devices/:id` (gate `till.configure`) sets a device's
  `layoutProfileId` so an authored profile can be applied to an already-enrolled device without
  re-enrolling (§3.2 gap). The devices screen (`devices-screen.ts`, already lists profiles) grows a
  reassign control.

---

## 9. Old-model removal + receipt rehoming — B4

- **New `tenant_receipts` table**, one row per tenant, mirroring `tenant_themes`: FORCE RLS +
  `tenant_receipts_tenant_isolation` policy + grants (SELECT/INSERT/UPDATE; no DELETE — replaced in
  place). Hand-written custom migration (`.enableRLS()` emits ENABLE only). Because it carries a
  `tenant_id` column, the **inmutabilidad** guard scans it — run
  `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` after adding it. Receipt store fns
  (`getReceipt`/`putReceipt`) + management endpoints move onto it; `receipt-print.ts` reads from it.
  `ReceiptConfig`/`validateReceiptConfig` are reused unchanged.
- **Drop `till_layouts`** (dropped, not migrated — pre-production, no backfill) and remove
  `WIDGET_TYPES`/`WidgetInstance`/`LayoutDef`/`Region` (`types.ts`), `WIDGET_CONFIG` (`widget-config.ts`,
  keeping `ConfigValidator`/`WidgetConfigSchema`), `validateLayout` (`validate.ts`, keeping
  `validateReceiptConfig`), `store.ts`, `defaults.ts`, the till's local `layout.ts` + region render in
  `till-counter-screen.ts` + `#layoutFor()`, the old `dashboard-layout-screen.ts`, and the `layout`
  field from `GET /api/till` and the till/dashboard API clients.
- Timing: removal happens in B4 *after* the counter (B1) and all bespoke screens (B2) render from the
  profile, so nothing is removed while still in use.

---

## 10. Boundaries & invariants to preserve

- **Sale path (fiscal §5).** Nothing may block a sale. The sale-critical cards remain mandatory on a
  till profile (`validateProfile`'s `missing_required`, already enforced). The renderer must always
  produce a working counter (product-grid/basket/total/tender-pay). This is the one hard invariant of
  an otherwise non-fiscal slice.
- **No back-compat / data migration** (pre-production): `till_layouts` dropped, not migrated; new
  tables drop/recreate.
- **New tenant-scoped table** (`tenant_receipts`) needs FORCE RLS + policy + grants (not just
  `.enableRLS()`); run the inmutabilidad suite after (§9).
- **Error codes name the domain concept** — `profile.*`/`layout.*`/`theme.*`/`device.*`; grep siblings
  before coining; never renamed once shipped; every throwing file imports its registry.
- **No hardcoded chrome** in any card or editor tile — `--wt-*` tokens only (enforced by
  `no-hardcoded-chrome.test.ts`).
- **Bundle rule:** the till never imports `@waitron/layouts`; it uses local mirror types.

---

## 11. Testing strategy

- **TDD throughout** (failing test first). Renderer, cards, and editor are browser-mode vitest
  (`apps/till`, `apps/dashboard`, `packages/ui` run headless Chromium — do not run their
  `test:coverage` concurrently; browser-mode is memory-heavy).
- **Renderer:** a profile → rendered grid (spans, tab switching), the three visibility axes
  (capability-absent collapses space; permission-locked overlay; `visibleWhen` show/hide), and a
  **sale-path guard** (a till profile always yields a usable counter).
- **Wrapped screens:** each bespoke screen's existing behavioural assertions are preserved through the
  card wrapper (update mounts/props, keep the assertions — a rewritten-to-match test hides the
  regression).
- **Editor:** drag/move/resize produces a valid `ProfileDef`; client validation mirrors the server;
  round-trip create/update/delete against the management API; reassign route.
- **Removal (B4):** the inmutabilidad suite green with `tenant_receipts`; receipt printing reads the
  new table; no dangling references to the dropped model (typecheck + the whole workspace's suites,
  since removing a shared export is cross-package).
- **Prove guards by deletion** where a guard is added.

---

## 12. Open items (for the plan, not blockers)

- **Exact PR cut-lines inside B1/B2** — e.g. whether the `floor` tab's real floor-plan card lands in
  B1 (alongside the counter) or B2 (with the other bespoke screens). The plan decides; the design only
  fixes the strategy (rendering-first) and the wrapping order (§6).
- **Grid/card `wt-*` primitive shape** — one primitive for the cell + a separate draggable wrapper, or
  one combined; settled during B1 against the `wt-floor-canvas` precedent.
- **Receipt editor** (`dashboard-receipt-screen.ts`) repoint to `tenant_receipts` — B4, alongside the
  store move.

---

## 13. References

- Parent design: `2026-09-02-layout-designer-and-device-profiles-design.md` (§4 model, §5 abilities,
  §6 visibility, §12 decomposition, §13 boundaries, §14 risks, §16 SP-A.2 resolutions).
- Sibling specs/plans: `2026-09-02-layout-profiles-sp-a1-data-model.md`,
  `2026-09-02-layout-sp-a2-device-unification.md`, `2026-09-03-sp-c-dev-device-switcher-design.md`.
- Code — model: `packages/layouts/src/{profile,card-contract,validate-profile,theme,default-profiles,
  profile-store,theme-store}.ts`. Storage: `packages/db/src/schema/{layout-profiles,tenant-themes,
  layouts}.ts`, `drizzle/0089`/`0091`. API: `apps/server/src/{management-api,till-api,device-api,
  device}.ts`. Till: `apps/till/src/{till-app.ts,api/client.ts,layout.ts,screens/*}`. Dashboard:
  `apps/dashboard/src/{dashboard-app.ts,api/client.ts,screens/{layout,receipt,devices,floor}-screen.ts}`.
  UI: `packages/ui/src/{index.ts,components/wt-floor-canvas.ts,tokens/*}`, `docs/developers/design-system.md`.
- Backlog row: *Layout designer & device profiles → SP-B*.
