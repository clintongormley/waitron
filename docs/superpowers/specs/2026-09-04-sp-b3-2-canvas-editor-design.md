# SP-B3.2 — Canvas editor (+ `profile → canvas` rename) — design

**Date:** 2026-09-04
**Slice of:** SP-B (`2026-09-03-sp-b-grid-editor-and-rendering-design.md`, §8 "Dashboard grid editor").
**Predecessors:** B1 (#204, renderer + counter), B2.1 (#206, tab shell), B2.2 (#207, heavy-screen wrap),
B3.1 (#209, reassign-to-device plumbing).

> **Terminology note for readers of older docs.** SP-A/B and B3.1 called the display-layout record a
> **layout profile** (`ProfileDef`, `layout_profiles`, `/management-api/profiles`, `profile.*` codes,
> `devices.layout_profile_id`). This slice **renames that concept to a _canvas_** and reserves
> **profile** for a future, bigger **device profile**. Earlier specs are not rewritten; this is the
> dated pointer (repo convention). See §2 and §5.

---

## 1. Summary

An owner authors the tab/card grids the till, handheld, KDS and tablet render from. The model, storage,
server routes and the render side already exist (SP-A.1 the model, B1/B2 the till rendering from it, B3.1
assigning one to an enrolled device). What is missing is **the tool that creates and edits those grids**.
This slice builds it — and, on the owner's call (2026-09-04), corrects the terminology first.

Two phases:

- **Phase A — `profile → canvas` rename** (behaviour-preserving). Today's "layout profile" does double
  duty: the *display layout* **and** the *device's capability grants* (capabilities enforce server-side,
  §4). This slice renames the **display** concept to a **canvas** across every package, while
  pre-production makes the table/error-code/FK rename free. No behaviour changes.
- **Phase B — the canvas editor** (the new feature). A `dashboard-canvas-editor-screen`: a canvas list
  (with miniature thumbnails), a grid-editor canvas, a card palette, a contextual property panel, and
  **clone** — wired to the (renamed) five CRUD endpoints that already exist server-side.

This is the SP-B **schedule risk** — the product-facing authoring UI. It is **not fiscal** and does not
touch the sale path. Phase A adds one migration (drop/recreate, pre-prod); Phase B adds **no** server
route, migration, grant or fiscal surface.

---

## 2. Terminology & model (owner decision, 2026-09-04)

- **Canvas** — the **display**: a `formFactor` (sizing guardrail) + **1+ tabs**, each tab a grid of
  **cards**. (Optional `theme`, deferred.) A canvas is authored, cloned and reused. This is what the
  editor edits. Structurally it is today's `ProfileDef`, renamed. Tabs and cards keep their names.
- **Device profile** *(future slice, not built here)* — the **bigger bundle**: the device's
  **capabilities**, its **area**, its **order-routing**, its **printer target**, **plus a reference to a
  canvas**. A device *uses* a device profile; the device profile *uses* a canvas. Today none of this is a
  first-class entity — a device points **straight at a canvas** (B3.1's assignment, renamed here), and
  the bundle is deferred (§10).
- **Capabilities stay on the canvas record — transitionally.** They are device-config in the target
  model, but they **enforce server-side today** (`device-session.ts:388` gates actions such as
  `/api/pay` on the bound record's `capabilities`) and drive the renderer's capability→absent axis
  (`card-grid.ts:159`). With no device-profile entity yet, the canvas is their only home, so they remain
  a canvas field and the editor still edits them (§7, "Profile selected" → renamed "Canvas settings").
  The device-profile slice relocates them; this is called out so that move is expected, not a surprise.

---

## 3. Decisions resolved in brainstorming (2026-09-04)

- **Scope split = canvas editor now, device profile as its own next slice.** Rationale: capabilities
  already enforce + render off the record, and area/routing/printer are separate existing subsystems to
  aggregate — the device-profile bundle is a data-model + multi-subsystem slice, and folding it in would
  balloon B3.2 and delay the display UI (the real schedule risk).
- **Rename depth = full, now.** `layout_profiles`→`canvases`, `ProfileDef`→`CanvasDef`,
  `profile.*`→`canvas.*` error codes, `devices.layout_profile_id`→`canvas_id`,
  `DEFAULT_PROFILES`→`DEFAULT_CANVASES`, the `/management-api/profiles` routes → `/management-api/canvases`,
  across `layouts`/`db`/`server`/`till`/`dashboard`. Pre-production makes the table/FK/code rename free;
  error codes are *never renamed once shipped*, so before more code piles on `profile.*` is the cheap
  moment.
- **Editor fidelity v1 = "complete but simple".** The editor ships the whole authoring capability with a
  **live visual grid preview + click-to-select**, span **steppers**, and **↑/↓ + keyboard** reorder.
  **Pointer drag-to-reorder and drag resize-handles are a deferred fast-follow** (owner call), off this
  slice's critical path. Every tile mounts at a **card-host seam** so drag *and* (later) live card
  renders drop in without a canvas rewrite.
- **Placement is flow-based, matching the shipped renderer.** `CardInstance` has `colSpan`/`rowSpan` and
  **no x/y coordinates** (`profile.ts:46-56`); the till renderer places cards by CSS auto-flow
  (`card-grid.ts:133,179`). "Move" = reorder in the array; "resize" = change spans. **No model change.**
- **Clone is in.** `getCanvas(id)` → `createCanvas(newName, sameDefinition)` — the same path as create,
  seeded from an existing canvas instead of a default. A "Duplicar" action + a name prompt.
- **Miniature thumbnail on the list.** Each canvas shows a *scaled* render of its first tab via the
  **same placeholder-tile grid** — an accurate reflection of the real geometry now, upgrading to live
  content for free when the live-render follow-on lands (shared card-host seam).
- **Theme editor is OUT** (deferred follow-on): no token editor, no `getTheme`/`putTheme` client methods.
- **Live card renders are OUT** (deferred follow-on, parent §2): v1 tiles are labelled placeholders.
- **The dashboard is the only place canvases are authored** (parent §2c). No on-till layout editor.

---

## 4. Current state (grounded)

Verified against the tree on 2026-09-04. Everything below is named **profile** today; Phase A renames it.

### 4.1 Model + contracts (`@waitron/layouts`, pure, DB-free)
- `ProfileDef { formFactor; tabs: TabDef[]; capabilities: CapabilityFlag[]; theme? }`,
  `TabDef { key; title; columns; cards: CardInstance[] }`,
  `CardInstance { type; colSpan; rowSpan; config; visibleWhen? }` — `profile.ts:46-77`.
- `FORM_FACTORS` (`profile.ts:9`); `CARD_TYPES` (12, `:18-31`); `CAPABILITY_FLAGS`
  (`integrated-card-payment`/`open-cash-drawer`/`act-as-kds`, `:38-42`).
- `CARD_CONTRACTS: Record<CardType, CardContract>` (`card-contract.ts:36-124`): per card `configSchema`,
  optional `requiredPermission`, optional `requiredCapability`, `visibilityStates`,
  `defaultColSpan/defaultRowSpan`, `saleCritical`. `GRID_MAX_COLUMNS = 24` (`:6`); `SALE_CRITICAL_CARDS`
  derived (`:127-129`) → `["product-grid","basket","total","tender-pay"]`. **Card/tab/contract names are
  not renamed** — only *profile* → *canvas*.
- `validateProfile` (`validate-profile.ts:41-55`), fail-closed, server-authoritative; `MAX_TAB_TITLE_LENGTH
  = 60` (`:17`); selling form factors (`["till"]`, `:20`) must place every sale-critical card
  (`missing_required`, `:150-153`).
- `DEFAULT_PROFILES` (`default-profiles.ts:87-92`), one valid profile per form factor.
- Error families `profile.invalid` (carries `reason`/`tabIndex`/`card`/`configKey`),
  `profile.not_found`, `profile.name_taken` (both param-less by design) — `errors.ts:83,104,108`;
  registered via the barrel's `import "./errors.js"`.

**The barrel drags the DB** (`index.ts` re-exports `profile-store`/`store` → `@waitron/db` → Node
builtins), so the dashboard uses a **local mirror**, never a runtime `import "@waitron/layouts"` (§8).

### 4.2 Storage + capability enforcement
- `layout_profiles` (many rows/tenant; jsonb `definition`) — `packages/db/src/schema/layout-profiles.ts`;
  FORCE RLS + `tenant_isolation` + SELECT/INSERT/UPDATE/DELETE grants (`drizzle/0089`). **Tenant-scoped
  ⇒ the inmutabilidad guard scans it** — renaming the table means re-running
  `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad`.
- `devices.layout_profile_id` (nullable uuid) with the composite FK
  `(tenant_id, layout_profile_id) → layout_profiles` — `schema/devices.ts:82-84,165-169`; B3.1's reassign
  route translates its violation via `bindingFkField`/`devices_layout_profile_fk` → `device.binding_invalid`.
- **Capabilities enforce server-side:** `device-session.ts:388`
  (`!profile.definition.capabilities.includes(capability)` → refuse) and render at `card-grid.ts:159`.
  This is why capabilities cannot simply leave the record in this slice (§2).

### 4.3 Server routes (renamed in Phase A; no new routes)
`apps/server/src/management-api.ts`, each `requireManagementSession` → `withTenant` + `asAppUser`; writes
gate `till.configure` in the store fn; reads self-authorize `till.configure`. Error→HTTP map at `:220-223`.

| Today | After Phase A | Body | Success |
| --- | --- | --- | --- |
| `GET /management-api/profiles` (`:895-908`) | `GET …/canvases` | — | `{ canvases: [{ id, name, definition }] }` |
| `GET …/profiles/:id` (`:912-927`) | `GET …/canvases/:id` | — | `{ id, name, definition }` (missing → 404) |
| `POST …/profiles` (`:933-961`) | `POST …/canvases` | `{ name, definition }` | **201** `{ id }` |
| `PUT …/profiles/:id` (`:968-995`) | `PUT …/canvases/:id` | `{ name, definition }` | **204** |
| `DELETE …/profiles/:id` (`:1000-1014`) | `DELETE …/canvases/:id` | — | **204** |

`:id` screened by `requireProfileId` (`:359-361`, non-UUID → not-found 404) → `requireCanvasId`. Body
screen (`:937-945`) rejects a bad body/`name`/`definition` as `management.request_invalid`. RLS+gate proof
in `management-api.profiles.rls.test.ts` (→ `…canvases.rls.test.ts`). The `theme` routes (`:1019-1057`)
are **out of scope** (theme deferred), and keep their names.

### 4.4 Dashboard client + nav + i18n
- `api/client.ts`: `listProfiles(): Promise<LayoutProfile[]>` (`:1851-1855`); `LayoutProfile = { id; name;
  definition: unknown }` (`:614`, `definition` deliberately `unknown` — bundle rule); `reassignDevice`
  (B3.1). No get/create/update/delete.
- `dashboard-app.ts`: configuration nav group (`:131-140`) — `layout`/`receipt`/`devices`/`printers`/
  `diagnostics`. The old `dashboard-layout-screen` (`nav.layout` "Diseño", edits the **old widget model**)
  is **removed in B4**, not here. Screen registration is the documented 5-step pattern.
- `devices-screen.ts` (B3.1) renders a per-device **profile `<select>`** bound to `layoutProfileId` and
  the `listProfiles()` names — Phase A renames its labels/field to canvas.
- i18n: `i18n/{t,strings,codes}.ts`. **`codes.ts` has no `profile.*` entries yet** (it has
  `layout.invalid`, `zone.name_taken`, `management.request_invalid`); this slice adds `canvas.*`.

---

## 5. Phase A — the `profile → canvas` rename (behaviour-preserving)

A cross-package refactor: **~560 lines mention "profile"** across `layouts`/`db`/`server`/`till`/
`dashboard`. It is a *rename*, not an `s/profile/canvas/` — only the **layout-display** concept renames;
unrelated "profile" strings (if any) and the deferred *device-profile* term must be left alone. Grep the
concrete tokens (`layoutProfile`, `layout_profile`, `ProfileDef`, `DEFAULT_PROFILES`, `validateProfile`,
`getProfile`/`listProfiles`/`createProfile`/`updateProfile`/`deleteProfile`, `getProfileForFormFactor`,
`profile-store`, `/profiles`, `profile.invalid|not_found|name_taken`, `profileId`), site by site.

**Inventory (the plan enumerates exhaustively; this is the known reach):**
- **`@waitron/layouts`** — `ProfileDef`→`CanvasDef`; `profile.ts`→`canvas.ts`; `validate-profile.ts`→
  `validate-canvas.ts` (`validateProfile`→`validateCanvas`); `default-profiles.ts`→`default-canvases.ts`
  (`DEFAULT_PROFILES`→`DEFAULT_CANVASES`); `profile-store.ts`→`canvas-store.ts` (`listProfiles`/`getProfile`/
  `createProfile`/`updateProfile`/`deleteProfile`/`getProfileForFormFactor` → `…Canvas…`); `errors.ts`
  codes `profile.*`→`canvas.*` (**param shapes preserved**); the `index.ts` barrel; `card-contract.ts`
  and `theme.ts` **unchanged** (card/theme names keep). Update the barrel's `import "./errors.js"`
  reachability (guarded by `scripts/errors-reachable.test.ts`).
- **`@waitron/db`** — `schema/layout-profiles.ts`→`canvases.ts` (table `layout_profiles`→`canvases`;
  uniques `layout_profiles_tenant_id_key`/`_tenant_name_key`→`canvases_*`; FK
  `layout_profiles_tenant_id_tenants_id_fk`→`canvases_*`). **Both** `devices.layout_profile_id` **and**
  `device_pairing_codes.layout_profile_id` (both in `schema/devices.ts`) → `canvas_id`, plus their
  composite FKs `devices_layout_profile_fk`→`devices_canvas_fk` and
  `device_pairing_codes_layout_profile_fk`→`device_pairing_codes_canvas_fk` (with `bindingFkField`
  updated and `devices.fk.test.ts` following). One **custom drizzle migration** (drop/recreate,
  pre-prod) re-establishing **FORCE RLS + `canvases_tenant_isolation` policy + SELECT/INSERT/UPDATE/DELETE
  grants** on `canvases` (`.enableRLS()` emits ENABLE only — verbatim adaptation of `drizzle/0089`).
  Regenerate the migration from the schema via the `db:generate`/`db:generate:custom` flow (do not
  hand-edit snapshots — the Drizzle rebase-collision lesson).
- **`apps/server`** — `management-api.ts` routes/handlers/imports; `requireProfileId`→`requireCanvasId`;
  `till-api.ts` boot resolution (`getProfile`/spread `profile:`→`canvas:`); `device-session.ts`
  capability read (`profile.definition`→`canvas.definition`); `device-api.ts` reassign route field; the
  error→HTTP map keys (`profile.*`→`canvas.*`); test file `management-api.profiles.rls.test.ts`→`…canvases…`.
- **`apps/till`** — `api/client.ts` `TillInfo.profile`→`canvas` (still typed `unknown`); `layout.ts`
  mirror (`ProfileDef`→`CanvasDef`, capabilities kept); `till-app.ts` (`this.profile`→`this.canvas`,
  `#renderScreen`/tab-shell wiring); `card-grid.ts` prop plumbing. **The `/api/till` payload key
  `profile`→`canvas`** is a client-visible contract change — both server and till move together (the
  bundle-mirror rule means a mismatch surfaces as a view-test shape error, not a compile break, so
  pin it with a test).
- **`apps/dashboard`** — `api/client.ts` `LayoutProfile`→`Canvas`, `listProfiles`→`listCanvases`;
  `devices-screen.ts` labels/field (`layoutProfileId`→`canvasId`, "profile" select → "canvas"); i18n
  `nav`/device strings; `codes.ts` `profile.*`→`canvas.*`.
- **Docs** — dated pointer in the parent SP-B spec (§8) and the backlog noting the rename; do **not**
  rewrite their history (repo convention).

**Guards to run after Phase A** (each a known cross-package trap): `pnpm typecheck` (workspace),
`pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` (the renamed tenant-scoped table),
`scripts/errors-reachable.test.ts` (barrel reachability of the renamed codes),
`packages/db`'s `layout-profiles.rls.test.ts`→`canvases.rls.test.ts` (FORCE RLS + policy + grants on the
new table), and **the whole workspace's suites** (a rename of a shared export is cross-package — a
filtered green proves nothing, CLAUDE.md §2). Behaviour is unchanged, so **existing behavioural
assertions are preserved**, only their names/fixtures updated (not rewritten to match).

**Execution:** Phase A lands as its **own PR** (a clean, reviewable rename) before Phase B, so the editor
is built on the final names.

---

## 6. Phase B — the canvas editor

### 6.1 The screen (`dashboard-canvas-editor-screen`)
New screen in the configuration nav group, key `canvas-editor`, label `nav.canvases` ("Lienzos" /
"Canvases"). The 5-step registration (§4.4). Injected `api: DashboardApi`; `errorKey` banner via
`codeMessage`; `data-test` throughout; axe a11y test in both themes. **Two modes in component state** —
a **list mode** and an **editor mode** (the shell has no sub-routing). The old `dashboard-layout-screen`
stays until B4.

### 6.2 List mode (landing)
- On connect, `api.listCanvases()`; a rejection → `errorKey` banner (never an unhandled rejection).
- Each canvas is a `wt-card`: its **name**, a **form-factor badge**, **tab/card counts**, and a
  **miniature grid thumbnail** — the canvas's **first tab** drawn by the shared placeholder-tile grid
  (§6.4) at a small fixed size (`aria-hidden`; the name is the accessible label). The thumbnail parses
  `definition` (`unknown`) into the local `CanvasDef` mirror at this edge; a parse failure renders a
  neutral "no preview" placeholder rather than throwing (a hand-edited/future-shaped definition must not
  break the list).
- Per card: **Editar** (→ editor mode, seeded from `getCanvas(id)`), **Duplicar** (a name prompt →
  `createCanvas(newName, sameDefinition)` → reload), **Eliminar** (a `wt-dialog` confirm →
  `deleteCanvas(id)` → reload).
- **Crear lienzo**: a `wt-dialog` asking **name + form-factor**; on confirm, seed the editor draft from a
  **deep clone of the local `DEFAULT_CANVASES[formFactor]` mirror** (valid from the first save) and enter
  editor mode (unsaved until Guardar).

### 6.3 Editor mode (one canvas draft)
Holds a working `CanvasDef` draft + a selection (`{tab, cardIndex}` | `{tab}` | `canvas`). Layout: a
**tab bar**, a **canvas**, a **palette**, and a **property panel**.

- **Tab bar** — one entry per `draft.tabs` (title), active tab highlighted; **+ Tab** appends a tab
  (unique generated `key`, default title, `columns` defaulted per form factor). Deleting the last tab is
  refused (`no_tabs`).
- **Canvas** — the active tab drawn by the shared placeholder-tile grid (§6.4) at editor scale; a tile is
  **click-to-select** (marked via a token, no hardcoded chrome, `aria-pressed`). Empty tab → an
  empty-grid affordance.
- **Palette** — every `CARD_TYPES` kind (localised name + `wt-icon`); each button **appends** the card to
  the active tab at its `defaultColSpan/defaultRowSpan` (clamped to `columns`). The model permits
  duplicate card types → **no dedup**.
- **Property panel** — contextual:
  - **Card selected:** `colSpan` stepper (`1..tab.columns`), `rowSpan` stepper (`≥1`); **config** fields
    from the local mirror (v1: only `product-grid.columns`, integer `1..12`; others → "Sin ajustes");
    **`visibleWhen`** checkboxes over that card's `visibilityStates` (empty list ⇒ hidden = "always");
    a **locked-permission** note when `requiredPermission` is set; a **capability warning** when the
    card's `requiredCapability` is not in the canvas's capabilities (would be structurally absent at
    runtime); **Eliminar**; **↑ / ↓**.
  - **Tab selected:** title (`1..60`), columns (`1..24`), **Eliminar tab** (unless last).
  - **Canvas settings:** name; **form-factor** (`<select>` of `FORM_FACTORS`); **capabilities** (checkbox
    per `CAPABILITY_FLAGS` — kept here transitionally, §2, labelled as device capabilities).
- **Preview size** — form-factor sets canvas/thumbnail aspect (landscape till/tablet/kds, portrait phone).
  Presentational only; no runtime reflow.
- **Guardar / Cancelar** — Guardar runs the client mirror (§8), then `createCanvas`/`updateCanvas`, then
  returns to list mode and reloads; a client-invalid draft is blocked with a message and **not** sent; a
  server `canvas.invalid`/`canvas.name_taken`/`canvas.not_found` → the mapped banner; the draft is kept
  on failure. Saves are idempotent full-replaces (PUT); disable the button while in-flight.

### 6.4 Shared placeholder-tile grid (dashboard-local render unit)
One reusable unit drawing a `TabDef` as a CSS grid **identical in geometry to the till renderer**
(`grid-template-columns: repeat(columns,1fr)`; each card `grid-column/row: span …` — mirrors
`card-grid.ts:133,179`). Each cell is a **card-host seam**: v1 renders a placeholder tile (localised name
+ `wt-icon` + `WxH` badge); the follow-on swaps in a live card without touching the canvas. Two consumers,
one unit: the list **thumbnail** (small, non-interactive, `aria-hidden`) and the editor **canvas**
(interactive, selectable), differing only by props. **No `wt-*` primitive** — the draggable cell primitive
is the drag fast-follow's job.

### 6.5 New API-client methods
`api/client.ts`, each a `#request` wrapper (`listCanvases` already exists after Phase A):

```
getCanvas(id): Promise<Canvas>                              // GET    …/canvases/:id
createCanvas(name, definition: unknown): Promise<{ id }>    // POST   …/canvases      → 201
updateCanvas(id, name, definition: unknown): Promise<void>  // PUT    …/canvases/:id  → 204
deleteCanvas(id): Promise<void>                             // DELETE …/canvases/:id  → 204
```

`definition` stays `unknown` at the boundary (bundle rule). Clone reuses `getCanvas` + `createCanvas`.
**No** `getTheme`/`putTheme`.

---

## 7. i18n

New `strings.ts` (en + es): `nav.canvases`, the editor's titles, palette/card names (reuse existing
`widget.*`/card labels where present), property-panel labels, dialog copy, buttons. New `codes.ts`
(en + es): `canvas.not_found`, `canvas.name_taken`, `canvas.invalid` (`management.request_invalid`
already present). Card/tab names are English identifiers with Spanish i18n values (the english-only guard
applies to identifiers, not values).

---

## 8. Client validation mirror + drift guard

A **dashboard-local mirror** of the layouts contract + a **light client validator** — not an
`@waitron/layouts` runtime import (§4.1 bundle rule), as the old `layout-screen.ts` and the till's
`layout.ts` already do.

- **Mirror** (`apps/dashboard/src/screens/canvas-editor/card-contracts.ts` or similar): `CARD_TYPES`,
  `CAPABILITY_FLAGS`, `FORM_FACTORS`, `GRID_MAX_COLUMNS`, `MAX_TAB_TITLE_LENGTH`, `SALE_CRITICAL_CARDS`,
  and per card `defaultColSpan`/`defaultRowSpan`/`visibilityStates`/`requiredPermission?`/
  `requiredCapability?`/`saleCritical` + the **config field names** it exposes (validators stay
  server-side).
- **Client validator** covers author-facing rules for fast feedback: a `till` canvas places every
  sale-critical card; ≥1 tab; unique tab keys; title `1..60`; columns `1..24`; each `colSpan` `1..columns`,
  `rowSpan ≥1`; `visibleWhen ⊆` states; `product-grid.columns` (when set) integer `1..12`. **The server's
  `validateCanvas` stays authoritative** — a client pass is never a guarantee.
- **Drift guard (parity test).** A hand-copied cross-package list is a known staleness trap (CLAUDE.md
  §2). A browser-mode test **deep-imports the pure source modules** (`@waitron/layouts/src/card-contract.js`
  + `profile.js`→`canvas.js`, DB-free ⇒ loadable in headless Chromium) and asserts the mirror equals the
  source: card types, spans, states, permissions, capabilities, `saleCritical`, config-key names, and the
  constants. Proven by deletion.

---

## 9. Testing strategy (TDD, browser-mode)

`apps/dashboard` runs headless-Chromium vitest — **memory-heavy; do not run its `test:coverage`
concurrently with other browser-mode suites**. Coverage bar `95/95/90/88`.

- **Phase A:** existing behavioural assertions preserved through the rename (names/fixtures updated, not
  rewritten to match); the §5 guard suite green (typecheck, inmutabilidad, errors-reachable, the RLS
  suite on `canvases`, whole-workspace).
- **List mode:** loads/renders canvases (name, badge, counts, a thumbnail each); a bad `definition`
  renders the neutral placeholder, not a throw; Editar seeds from `getCanvas`; Duplicar calls
  `createCanvas(name, definition)` and reloads; Eliminar confirms → `deleteCanvas` → reload; a
  load/mutation rejection → banner; Crear seeds from the default mirror.
- **Editor mode:** add-from-palette appends at default spans; remove; ↑/↓; span steppers clamp;
  `product-grid.columns` edits config; `visibleWhen` toggles; tab add/rename/columns/delete (last-tab
  refused); canvas name/form-factor/capabilities edit; capability warning when a placed card's
  `requiredCapability` is unmet; the draft is a valid `CanvasDef`.
- **Save path:** Guardar new → `createCanvas`; existing → `updateCanvas`; a client-invalid draft blocked
  and not sent; server `canvas.*` → mapped banner.
- **Client mirror:** rejects each author-facing rule violation, matched to what the server would reject.
- **Drift guard:** the §8 parity test, proven by deletion.
- **a11y:** axe clean both themes; tiles are keyboard-reachable buttons; reorder works from the keyboard.
- **Prove every guard by deletion.**

---

## 10. Boundaries, invariants & deferred work

**Invariants**
- **No fiscal surface, no sale-path change.** The editor authors config; it never touches a sale. The
  sale-critical-card rule is model-enforced; the client mirror only surfaces it earlier.
- **Phase A is behaviour-preserving.** Only names change; the migration is drop/recreate (pre-prod, no
  backfill). The renamed `canvases` table re-establishes FORCE RLS + policy + grants (not just
  `.enableRLS()`), and the inmutabilidad guard must be green after.
- **Phase B adds no server route, migration, grant or new table.**
- **Bundle rule.** The dashboard/till never runtime-import `@waitron/layouts`; local mirror types +
  the parity-tested contract mirror. `definition` crosses the client boundary as `unknown`.
- **Error codes** name the domain concept, carry the same param shapes across the rename, and every
  throwing file imports its registry. Phase B **throws no new codes** (it renders existing server codes).
- **No hardcoded chrome** — `--wt-*` tokens only (`no-hardcoded-chrome.test.ts`).

**Deferred (recorded follow-ons)**
- **Device profile slice** — a first-class device profile (capabilities + area + order-routing + printer
  target + `canvasId`), relocating capabilities off the canvas; device → device-profile → canvas. The
  next slice after B3.2.
- **Pointer drag-to-reorder + drag resize-handles** — a draggable grid-cell `wt-*` primitive adapting the
  `wt-floor-canvas` pointer/snap lifecycle to integer cells; additive at the card-host seam.
- **Live card renders in the tiles** (parent §2) — needs a headless till-runtime data harness; drops in
  at the card-host seam.
- **Theme editor** — `getTheme`/`putTheme` + the 7-token editor (`theme.ts` allowlist is provisional).

---

## 11. References
- Parent: `2026-09-03-sp-b-grid-editor-and-rendering-design.md` (§8 editor, §2 decisions, §10 boundaries).
- Model: `packages/layouts/src/{profile,card-contract,validate-profile,default-profiles,theme,
  profile-store,errors}.ts`; barrel `index.ts`.
- Storage: `packages/db/src/schema/{layout-profiles,devices}.ts`, `drizzle/0089`; RLS suite
  `layout-profiles.rls.test.ts`.
- Capability enforcement: `apps/server/src/device-session.ts:388`; render axis
  `apps/till/src/widgets/card-grid.ts:159`. Renderer geometry to mirror: `card-grid.ts:133,179`.
- Routes: `apps/server/src/management-api.ts:895-1014`; proof `management-api.profiles.rls.test.ts`.
- Dashboard: `apps/dashboard/src/{dashboard-app.ts,api/client.ts,screens/{layout-screen,devices-screen,
  printers-screen}.ts,i18n/{t,strings,codes}.ts}`.
