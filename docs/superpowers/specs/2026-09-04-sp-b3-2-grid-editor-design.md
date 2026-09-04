# SP-B3.2 — Dashboard grid editor — design

**Date:** 2026-09-04
**Slice of:** SP-B (`2026-09-03-sp-b-grid-editor-and-rendering-design.md`, §8 "Dashboard grid editor").
**Predecessors:** B1 (#204, renderer + counter), B2.1 (#206, tab shell), B2.2 (#207, heavy-screen wrap),
B3.1 (#209, reassign-to-device plumbing).

---

## 1. Summary

An owner authors layout **profiles** — the tab/card grids the till, handheld, KDS and tablet render
from — on the management dashboard. The model, storage, server routes and the render side already
exist (SP-A.1 built the model, B1/B2 made the till render from it, B3.1 lets an owner apply a profile
to an enrolled device). What is missing is the **tool that creates and edits the profiles themselves**.
This slice builds it: a new `dashboard-grid-editor-screen` with a profile list, a grid-editor canvas,
a card palette, and a contextual property panel, wired to the five profile-CRUD endpoints that already
exist server-side.

This is the SP-B **schedule risk** — the product-facing authoring UI. It is **not fiscal**, adds **no
migration, no grant, no server route** (every endpoint it calls exists), and does not touch the sale
path.

---

## 2. Decisions resolved in brainstorming (2026-09-04)

Recorded so the plan can cite them.

- **Editor fidelity v1 = "complete but simple".** The editor ships the *whole authoring capability*
  (create/edit/delete profiles; add/remove/reorder cards; span steppers; per-card config and
  `visibleWhen`; tab title/columns; profile name/form-factor/capabilities) with a **live visual grid
  preview + click-to-select**, and reorder via **↑/↓ buttons + keyboard**. **Pointer drag-to-reorder
  and drag resize-handles are a deferred fast-follow** — the owner's call, to take the drag-interaction
  hit-testing risk off this slice's critical path. Every tile mounts at the **card-host seam** so both
  drag and (later) live card renders drop in without a canvas rework.
- **Placement is flow-based, matching the shipped renderer.** `CardInstance` has `colSpan`/`rowSpan`
  and **no x/y coordinates** (`profile.ts:46-56`); the till renderer places cards by CSS auto-flow —
  `grid-column: span colSpan; grid-row: span rowSpan` on `grid-template-columns: repeat(columns,1fr)`
  (`apps/till/src/widgets/card-grid.ts:133,179`). So in the editor **"move" = reorder in the array**
  and **"resize" = change the spans**. There is **no model change** in this slice (no new coordinate
  fields, no new validator rule, no new migration).
- **Theme editor is OUT (deferred follow-on).** The backlog lists "visual theme editor" as a separate
  follow-on and B3.2's charter omits theme. So this slice adds **no** `getTheme`/`putTheme` client
  methods and no token editor. `ProfileDef.theme` is left untouched (absent on authored profiles).
- **Live card renders are OUT (deferred follow-on, per parent §2).** v1 tiles are labelled
  placeholders (name + icon + span badge), not live card content — but at the card-host seam, so the
  follow-on is a drop-in.
- **The dashboard is the only place profiles are authored** (parent §2c). No on-till grid-layout
  editor.

Two additions the owner asked for during this brainstorm:

- **A miniature grid thumbnail on the list view.** Each profile in the list shows a *scaled* render of
  its first tab using the **same placeholder-tile canvas** — so the thumbnail is an **accurate
  reflection of the real grid geometry** (tiles, spans, positions) now, and upgrades to live card
  content for free when the live-render follow-on lands (it shares the card-host seam). In scope.
- **Clone / duplicate a profile.** Deferred (owner's call), but recorded because it needs **zero
  server work**: it is `getProfile(id)` → `createProfile(newName, sameDefinition)` on the endpoints
  this slice already adds — a small client-only follow-on (a "Duplicar" action + a name prompt).

---

## 3. Current state (grounded)

Verified against the tree on 2026-09-04.

### 3.1 Model + contracts (`@waitron/layouts`, pure, DB-free)
- `ProfileDef { formFactor; tabs: TabDef[]; capabilities: CapabilityFlag[]; theme? }`,
  `TabDef { key; title; columns; cards: CardInstance[] }`,
  `CardInstance { type; colSpan; rowSpan; config; visibleWhen? }` — `profile.ts:46-77`.
- `FORM_FACTORS = ["till","phone-portrait","tablet-landscape","kds"]` (`profile.ts:9`);
  `CARD_TYPES` (12, `profile.ts:18-31`); `CAPABILITY_FLAGS =
  ["integrated-card-payment","open-cash-drawer","act-as-kds"]` (`profile.ts:38-42`).
- `CARD_CONTRACTS: Record<CardType, CardContract>` (`card-contract.ts:36-124`): per card `configSchema`,
  optional `requiredPermission`, optional `requiredCapability`, `visibilityStates`, `defaultColSpan`,
  `defaultRowSpan`, `saleCritical`. `GRID_MAX_COLUMNS = 24` (`card-contract.ts:6`);
  `SALE_CRITICAL_CARDS` derived (`:127-129`) → `["product-grid","basket","total","tender-pay"]`.
- `validateProfile(input): ProfileDef` (`validate-profile.ts:41-55`), fail-closed, server-authoritative;
  `MAX_TAB_TITLE_LENGTH = 60` (`:17`); selling form factors (`["till"]`, `:20`) must place every
  sale-critical card (`missing_required`, `:150-153`).
- `DEFAULT_PROFILES: Record<FormFactor, ProfileDef>` (`default-profiles.ts:87-92`) — one valid profile
  per form factor (till: `counter` + `floor` tabs; phone/tablet: `floor` + `order`; kds: `kitchen`).
- Error families `profile.invalid` / `profile.not_found` / `profile.name_taken` (+ `theme.invalid`),
  registered via the barrel's `import "./errors.js"`.

**The barrel drags the DB.** `index.ts` re-exports `profile-store.js`/`store.js`, which import
`@waitron/db` → drizzle → Node builtins. So a dashboard **runtime** `import "@waitron/layouts"` is
forbidden by the bundle rule (parent §10). The *pure* sub-modules (`card-contract`, `profile`,
`validate-profile`, `theme`, `errors`) are DB-free, but there is **no `exports` map** to keep them that
way (`package.json` has only `main`) — so the editor keeps a **local mirror**, not a deep import (§6).

### 3.2 Server routes exist (no server work in this slice)
All in `apps/server/src/management-api.ts`, each `requireManagementSession` → `withTenant` + `asAppUser`;
writes gate `till.configure` inside the store fn; reads self-authorize `till.configure`. Error→HTTP map
at `:220-223` (`profile.not_found`→404, `profile.name_taken`→409, `*.invalid`→400,
`management.request_invalid`→400).

| Route | Location | Body | Success |
| --- | --- | --- | --- |
| `GET /management-api/profiles` | `:895-908` | — | `{ profiles: [{ id, name, definition }] }` |
| `GET /management-api/profiles/:id` | `:912-927` | — | `{ id, name, definition }` (missing → 404) |
| `POST /management-api/profiles` | `:933-961` | `{ name, definition }` | **201** `{ id }` |
| `PUT /management-api/profiles/:id` | `:968-995` | `{ name, definition }` | **204** |
| `DELETE /management-api/profiles/:id` | `:1000-1014` | — | **204** |

`:id` is screened by `requireProfileId` (`:359-361`): a non-UUID → `profile.not_found` (404). The
POST/PUT body screen (`:937-945`) rejects a non-object body / non-string `name` / absent `definition`
as `management.request_invalid` **before** the store runs. RLS + gate coverage is proven in
`management-api.profiles.rls.test.ts`. `theme` routes (`GET/PUT /management-api/theme`, `:1019-1057`)
exist but are **out of scope** here.

### 3.3 Dashboard client — one method exists, four to add
`apps/dashboard/src/api/client.ts`:
- **Exists:** `listProfiles(): Promise<LayoutProfile[]>` (`:1851-1855`, unwraps `{ profiles }`);
  `reassignDevice(id, layoutProfileId|null)` (B3.1). `LayoutProfile = { id; name; definition: unknown }`
  (`:614`) — `definition` is deliberately `unknown` to keep the layouts barrel out of the bundle.
- **To add:** `getProfile(id)`, `createProfile(name, definition)`, `updateProfile(id, name, definition)`,
  `deleteProfile(id)` — thin `#request` wrappers (the private helper every method uses; rejects a bare
  `{ code }`). **Not added:** `getTheme`/`putTheme` (theme editor deferred).

### 3.4 Dashboard nav + screen registration
`dashboard-app.ts`: `type Screen` union (`:53`); `NAV_GROUPS` (`:94`), configuration group at
`:131-140` (`layout`, `receipt`, `devices`, `printers`, `diagnostics`). Adding a screen = (1)
side-effect import near `:22`; (2) add the `Screen` literal (`:53`); (3) add a `NavItem` to the group
(`:131-140`) with a `labelKey`; (4) add a `case` in `#renderScreen()` (`:681+`) passing `.api`;
(5) add the `labelKey` to `i18n/strings.ts` in **both** `en` and `es`.

The **old `dashboard-layout-screen`** (`nav.layout` "Diseño", `:134`, rendered `:698-699`, edits the
**old** widget model) is **removed in B4**, not here (§4). Accepted transient: two layout-ish nav
entries during B3.2→B4 (pre-production, no users).

### 3.5 i18n + error codes
`i18n/t.ts` (`t(key)`), `i18n/strings.ts` (`en`/`es`, `StringKey`), `i18n/codes.ts`
(`codeOf(error)` reads `error.code`; `codeMessage(code)` maps to localised copy, unmapped → GENERIC,
never the raw code). **Gap:** `codes.ts` has **no** `profile.not_found` / `profile.name_taken` /
`profile.invalid` entries yet (it has `layout.invalid`, `zone.name_taken`, `management.request_invalid`
at `:82`, etc.) — this slice adds the three profile codes (en + es).

### 3.6 `@waitron/ui` + screen conventions
Primitives: `wt-button`, `wt-icon`, `wt-card`, `wt-input`, `wt-switch`, `wt-dialog` (design-system doc
`docs/developers/design-system.md`, enforced by `no-hardcoded-chrome.test.ts`). Screen convention
(e.g. `printers-screen.ts`): `@property({attribute:false}) api!: DashboardApi`; `@state errorKey`; a
`#load()`/`#mutate()` each `try/catch { errorKey = codeOf(error) }` invoked via `void`; a
`role="alert"` banner rendering `codeMessage(errorKey)`; `data-test` throughout; `wt-dialog` for
confirm/edit dialogs. **No new `wt-*` primitive** is needed for v1 (the draggable grid-cell primitive
lands with the drag fast-follow).

---

## 4. What this slice builds

### 4.1 The screen (`dashboard-grid-editor-screen`)
A new screen in the configuration nav group, key `grid-editor`, label `nav.profiles` ("Perfiles").
Follows the 5-step registration (§3.4). Injected `api: DashboardApi`; `errorKey` banner; `data-test`
throughout; axe a11y test in both themes. It has **two modes** held in component state — a **list mode**
and an **editor mode** — not two routes (the dashboard shell has no sub-routing).

### 4.2 List mode (landing)
- On connect, `api.listProfiles()`; a rejection → `errorKey` banner (never an unhandled rejection).
- Each profile renders as a `wt-card` with: its **name**, a **form-factor badge**, **tab/card counts**,
  and a **miniature grid thumbnail** — the profile's **first tab** drawn by the shared placeholder-tile
  grid component (§4.4) at a small fixed size (`aria-hidden`; the name is the accessible label). The
  thumbnail parses `definition` (typed `unknown`) at this edge into the local `ProfileDef` mirror; a
  parse failure renders a neutral "no preview" placeholder rather than throwing (a hand-edited or
  future-shaped definition must not break the list).
- Per card: **Editar** (→ editor mode, seeded from `getProfile(id)`), **Eliminar** (a `wt-dialog`
  confirm → `deleteProfile(id)` → reload).
- **Crear perfil**: a `wt-dialog` asking **name + form-factor**; on confirm, seed the editor draft from
  a **deep clone of the local `DEFAULT_PROFILES[formFactor]` mirror** (so a new profile is valid from
  its first save) and enter editor mode (unsaved until Guardar).

### 4.3 Editor mode (one profile draft)
Holds a single working `ProfileDef` draft + a selection (`{tab, cardIndex}` | `{tab}` | `profile`).
Layout: a **tab bar**, a **canvas**, a **palette**, and a **property panel**.

- **Tab bar** — one entry per `draft.tabs` (title), the active tab highlighted; **+ Tab** appends a tab
  (unique generated `key`, default title, `columns` defaulted per form factor). A tab entry selects the
  tab; a tab's settings (title / columns / delete) show in the property panel when the tab (not a card)
  is selected. Deleting the last tab is refused (the model requires ≥1 tab — `no_tabs`).
- **Canvas** — the active tab drawn by the shared placeholder-tile grid (§4.4) at editor scale. A tile
  is **click-to-select**; the selected tile is visibly marked (`aria-pressed`/selected ring via a
  token, no hardcoded chrome). Empty tab → an empty-grid affordance.
- **Palette** — every `CARD_TYPES` kind (localised name + icon), each a button that **appends** the
  card to the active tab at its `defaultColSpan/defaultRowSpan` (clamped to the tab's `columns`). The
  model permits duplicate card types, so **no dedup** (unlike the old widget editor's `WIDGET_TYPES`
  exclude-list).
- **Property panel** — contextual to the selection:
  - **Card selected:** `colSpan` stepper (clamped `1..tab.columns`), `rowSpan` stepper (`≥1`);
    **config** fields from the local mirror's per-card field list (v1: only `product-grid.columns`, an
    integer `1..12`; every other card → "Sin ajustes"); **`visibleWhen`** — a checkbox set of that
    card's `visibilityStates` (empty list ⇒ the control is hidden, "always shows"); a **locked-
    permission** note when `requiredPermission` is set (informational — the card renders inert for
    operators lacking it at runtime, §B2.1); a **capability warning** when the card's
    `requiredCapability` is not among the profile's capabilities (the card would be structurally absent
    at runtime); **Eliminar**; **↑ / ↓** reorder within the tab.
  - **Tab selected:** title (`1..60`), columns (`1..24`), **Eliminar tab** (unless it's the last).
  - **Profile selected:** name; **form-factor** (a `<select>` of `FORM_FACTORS`); **capabilities**
    (a checkbox per `CAPABILITY_FLAGS`).
- **Preview size** — form-factor sets the canvas/thumbnail aspect (landscape for `till` /
  `tablet-landscape` / `kds`, portrait for `phone-portrait`). Presentational only; no runtime reflow.
- **Guardar / Cancelar** — Guardar runs the **client validation mirror** (§6); on pass, `createProfile`
  (new) or `updateProfile` (existing) then returns to list mode and reloads; on failure (client or
  server) the `errorKey`/message banner shows and the draft is kept for the operator to fix. Cancelar
  discards the draft and returns to list mode. Saves are idempotent full-replaces (PUT), so no
  single-flight guard beyond disabling the button while in-flight.

### 4.4 Shared placeholder-tile grid (`grid-preview` component or render helper)
One small, reusable render unit that draws a `TabDef` as a CSS grid **identical in geometry to the till
renderer** — `grid-template-columns: repeat(columns, 1fr)`, each card `grid-column: span colSpan;
grid-row: span rowSpan` (mirrors `card-grid.ts:133,179`). Each cell is a **card-host seam**: a wrapper
that in v1 renders a placeholder tile (localised card name + `wt-icon` + a `WxH` span badge) and in the
future can render a live card without changing the canvas. Two consumers, one component: the list-mode
**thumbnail** (small, non-interactive, `aria-hidden`) and the editor-mode **canvas** (interactive,
selectable). Interactivity (select handlers, selected marking) is driven by props/attributes, so the
same geometry serves both. **No `wt-*` primitive** — this is dashboard-local; the draggable primitive
is the drag fast-follow's job.

---

## 5. New API-client methods
`apps/dashboard/src/api/client.ts`, each a `#request` wrapper mirroring the existing `listProfiles`:

```
getProfile(id: string): Promise<LayoutProfile>                       // GET  …/profiles/:id
createProfile(name: string, definition: unknown): Promise<{ id }>    // POST …/profiles      → 201
updateProfile(id, name: string, definition: unknown): Promise<void>  // PUT  …/profiles/:id  → 204
deleteProfile(id: string): Promise<void>                             // DELETE …/profiles/:id → 204
```

`definition` stays `unknown` at the client boundary (the bundle rule — the editor parses/produces the
local `ProfileDef` mirror at its own edge). Errors reject a bare `{ code }` the screen maps via
`codeOf`/`codeMessage`. **No** `getTheme`/`putTheme`.

New `codes.ts` entries (en + es): `profile.not_found`, `profile.name_taken`, `profile.invalid`
(`management.request_invalid` already exists). New `strings.ts` entries (en + es) for `nav.profiles`
and the editor's own copy (titles, palette/card names, property-panel labels, dialog copy, buttons).

---

## 6. Client validation mirror + the drift guard

The editor keeps a **dashboard-local mirror** of the layouts contract data and a **light client
validator** — not an `@waitron/layouts` runtime import (§3.1 bundle rule), exactly as the old
`layout-screen.ts` kept a local `WIDGET_TYPES`/`WIDGET_CONFIG_FIELDS` and the till keeps `layout.ts`.

- **Mirror (`apps/dashboard/src/screens/grid-editor/card-contracts.ts` or similar):** `CARD_TYPES`,
  `CAPABILITY_FLAGS`, `FORM_FACTORS`, `GRID_MAX_COLUMNS`, `MAX_TAB_TITLE_LENGTH`, `SALE_CRITICAL_CARDS`,
  and per card: `defaultColSpan`, `defaultRowSpan`, `visibilityStates`, `requiredPermission?`,
  `requiredCapability?`, `saleCritical`, and the **config field names** it exposes (the UI list; the
  validator functions themselves stay server-side).
- **Client validator** covers the **author-facing** rules for fast feedback: a selling
  (`till`) profile places every sale-critical card (`missing_required`); ≥1 tab; unique tab keys; tab
  title `1..60`; columns `1..24`; each `colSpan` `1..columns` and `rowSpan ≥1`; `visibleWhen ⊆` the
  card's states; `product-grid.columns` (when set) an integer `1..12`. **The server's `validateProfile`
  stays authoritative** for everything — a client-side pass is never treated as a guarantee, and a
  server `profile.invalid` still surfaces in the banner.
- **Drift guard (parity test).** A hand-copied cross-package list is a known staleness trap (repo
  CLAUDE.md §2). A browser-mode test **deep-imports the *pure* source modules**
  (`@waitron/layouts/src/card-contract.js` + `profile.js` — DB-free, so they load in headless
  Chromium) and asserts the mirror equals the source: `CARD_TYPES`, `CAPABILITY_FLAGS`, `FORM_FACTORS`,
  `GRID_MAX_COLUMNS`, `MAX_TAB_TITLE_LENGTH`, `SALE_CRITICAL_CARDS`, and per card the spans / states /
  `requiredPermission` / `requiredCapability` / `saleCritical` / config-key names
  (`Object.keys(CARD_CONTRACTS[t].configSchema)`). Drift fails the dashboard's own suite. Proven by
  deletion (mutate the mirror → the test fails → restore).

---

## 7. Testing strategy (TDD, browser-mode)

`apps/dashboard` runs headless-Chromium vitest — **memory-heavy; do not run its `test:coverage`
concurrently with other browser-mode suites** (repo memory). Coverage bar for `apps/dashboard` is
`95/95/90/88`.

- **List mode:** loads and renders profiles (name, badge, counts, a thumbnail per row); a bad
  `definition` renders the neutral placeholder, not a throw; Editar enters editor mode seeded from
  `getProfile`; Eliminar confirms then calls `deleteProfile` and reloads; a load/delete rejection →
  banner. Crear opens the dialog, seeds from the default mirror, enters editor mode.
- **Editor mode:** add-from-palette appends at default spans; remove; ↑/↓ reorder; span steppers clamp;
  `product-grid.columns` edits config; `visibleWhen` toggles; tab add/rename/columns/delete (last-tab
  delete refused); profile name/form-factor/capabilities edit; capability warning appears when a placed
  card's `requiredCapability` is unmet; the produced draft is a valid `ProfileDef`.
- **Save path:** Guardar on a new profile → `createProfile` with the composed definition; on an existing
  one → `updateProfile`; a client-invalid draft is blocked with a message and **not** sent; a server
  `profile.invalid`/`profile.name_taken`/`profile.not_found` → the mapped banner.
- **Client mirror:** rejects each author-facing rule violation (sale-critical missing on a till profile,
  bad ranges, `visibleWhen` not a subset) — matched against what the server would reject.
- **Drift guard:** the §6 parity test, proven by deletion.
- **a11y:** axe clean in both themes; selection is keyboard-reachable (the canvas tiles are buttons);
  reorder works from the keyboard.
- **Prove every guard by deletion.**

---

## 8. Boundaries & invariants

- **No fiscal surface, no sale-path change.** The editor authors config; it never touches a sale. The
  sale-critical-card rule is enforced by the model already; the client mirror only surfaces it earlier.
- **No server work.** All five profile routes + the reassign route already exist; this slice adds only
  client methods, a screen, i18n, and tests.
- **No migration, no grant, no new table.**
- **Bundle rule.** The dashboard never runtime-imports `@waitron/layouts`; it uses local mirror types
  and the parity-tested contract mirror. `definition` crosses the client boundary as `unknown`.
- **Error codes** name the domain concept (`profile.*`), are never renamed once shipped, and every
  throwing file imports its registry — but this slice **throws no new codes** (it only *renders*
  existing server codes), so it adds i18n entries, not error definitions.
- **No hardcoded chrome** — `--wt-*` tokens only (enforced by `no-hardcoded-chrome.test.ts`); the
  selected-tile marking and thumbnail styling use tokens.
- **The old layout screen stays** until B4 removes it with the rest of the widget model.

---

## 9. Deferred (recorded follow-ons)

- **Pointer drag-to-reorder + drag resize-handles** (a new draggable grid-cell `wt-*` primitive
  adapting the `wt-floor-canvas` pointer/snap lifecycle to integer cells). The card-host seam and the
  reorder/span model are built so this is additive.
- **Live card renders in the tiles** (parent §2) — needs a headless till-runtime data harness; drops in
  at the card-host seam.
- **Clone / duplicate a profile** — client-only (`getProfile` → `createProfile(newName, definition)`),
  no server work; a small "Duplicar" action.
- **Theme editor** — `getTheme`/`putTheme` + the 7-token editor (`theme.ts` allowlist is provisional and
  finalised in that slice).

---

## 10. References
- Parent: `2026-09-03-sp-b-grid-editor-and-rendering-design.md` (§8 editor, §2 decisions, §10 boundaries).
- Model: `packages/layouts/src/{profile,card-contract,validate-profile,default-profiles,theme}.ts`.
- Routes: `apps/server/src/management-api.ts:895-1014`; RLS proof
  `management-api.profiles.rls.test.ts`.
- Renderer geometry to mirror: `apps/till/src/widgets/card-grid.ts:133,179`.
- Dashboard: `apps/dashboard/src/{dashboard-app.ts,api/client.ts,screens/layout-screen.ts,
  screens/printers-screen.ts,i18n/{t,strings,codes}.ts}`.
