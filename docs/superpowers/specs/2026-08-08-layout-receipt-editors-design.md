# Layout & receipt editors + per-widget config — Design

**Status:** design, unbuilt. Slice 1 of the Counter POS "configurable-till" follow-up
(`docs/backlog.md` → *Counter POS follow-ups* → "The layout & receipt editors + per-widget config").
**Depends on:** the counter-POS widget seam (already shipped) and the management dashboard
(`apps/dashboard`, #67–#70). **Priority:** lowest in the current queue — kept MODERATE in depth.

Every claim about the current tree carries a `file:line`; anything I could not verify against the
tree is marked **assumption**.

---

## 1. Problem and context

The counter screen is already **layout-driven from data**. `apps/till/src/layout.ts:14-25` defines
`WidgetType` (six widgets: `product-grid`, `basket`, `total`, `tender-pay`, `held-orders`,
`prep-queue`), `WidgetInstance` (`{ type, region: "main"|"aside", config: Record<string, unknown> }`)
and `LayoutDef = WidgetInstance[]`. `till-counter-screen` renders by iterating the layout and mapping
each `type` to its element (`till-counter-screen.ts:183-209`).

Two facts define the gap this slice fills:

1. **Slice 1 ships one fixed layout with empty config bags, and nothing reads them.**
   `LAYOUT_A` is hardcoded (`layout.ts:34-41`), `till-app` imports it and derives `#layoutFor()`
   (`till-app.ts:667-671`), and the counter screen's `#widget(instance)` **ignores
   `instance.config` entirely** (`till-counter-screen.ts:183-209`) — every widget prop is threaded
   from screen-level `@property`s, not from the per-widget bag.
2. **The owner intent is a "dashboard of movable blocks"**, built as a seam "from the start" so the
   editor is "a plug-in later slice, not a rewrite"
   (`docs/superpowers/specs/2026-08-05-counter-pos-walkup-sale-design.md` §3).

So the editor is a **new authoring surface** that produces a `LayoutDef` (+ a receipt config), persists
it tenant-scoped, and the till reads it in place of the hardcoded `LAYOUT_A`. The owner-facing home is
`apps/dashboard` — the management console is where owner configuration already lives
(`docs/superpowers/specs/2026-08-07-management-dashboard-design.md` §2: "data tables + forms" paradigm,
a client of the local server's management API).

**Minimum coherent slice (this design):** persist a `LayoutDef` + a receipt config, a
`person`-gated write API, a list-based editor that can place/reorder/remove the six existing widgets
and edit their config, **one real per-widget config key wired end to end** (`product-grid.columns`) to
prove the bag → widget path, and the till rendering the authored layout instead of the hardcoded one.

---

## 2. Scope

**In:** a `till_layouts` table (per-tenant, FORCE RLS); a `@waitron/layouts` service package
(validation, defaults, get/put); management write routes + a till read; a dashboard layout editor
(list-based) and receipt editor (trim only); `product-grid.columns` wired bag→widget; guard suites.

**Out (YAGNI, deferred with reasons):**

- **Drag-and-drop.** The persisted format is identical, so it plugs in later without rework
  (§3, decision D1). A list-based, button-driven editor is fully keyboard-accessible and matches the
  dashboard's forms paradigm.
- **Per-widget config beyond `product-grid.columns`.** The bag → widget path is proven with one key;
  further keys (e.g. `tender-pay`'s enabled tenders) are additive and touch fiscal-adjacent widgets
  (§3, D6).
- **Named / multiple saved layouts, per-till or per-location divergence, custom themes/CSS, a live
  pixel preview.** All later; none needs a destructive migration to add (pre-production, CLAUDE.md §3).
- **Receipt fiscal-core editing** — forbidden by construction (§8).

---

## 3. UX product-decisions (each named, with the chosen default)

This is built **without the owner present**. Where a real product choice exists I name it and pick a
defensible, conservative default rather than leaving it open.

| # | Decision | Options | **Chosen default** | Why |
|---|----------|---------|--------------------|-----|
| **D1** | Editor interaction model | drag-and-drop vs list + buttons | **List of widget rows per region, reorder via up/down buttons, add via a picker, remove via a button** | Keyboard-accessible + axe-testable (the dashboard is a11y-first, both-theme tested); matches the dashboard's forms paradigm; the persisted `LayoutDef` is identical either way, so DnD is a pure later enhancement. |
| **D2** | Layout scope (per-what?) | tenant / location / till | **Per-tenant (one row per tenant)** | Single-venue single-till deli today; the management API is already "scoped to the one venue tenant" (`management-api.ts:145`); keeps `ManagementApiDeps` unchanged (`{ tenantId }`). Per-till/per-location divergence is a later slice needing only a discriminator column + a resolution rule — additive, no destructive migration (pre-production). |
| **D3** | Where the till reads it | new `GET /api/layout` vs fold into `GET /api/till` | **Extend `GET /api/till`** with `layout` + `receipt` fields | The till already does exactly one unauthenticated boot fetch and threads config from it (`till-app.ts:230-242`); one fetch, minimal till change. The config has no secrets (arrangement + footer text), same as `venueName`/`orderFlow` already on that route. |
| **D4** | Required widgets | none / require sale-critical set | **Require `product-grid`, `basket`, `total`, `tender-pay` present** | "A till that cannot sell is a shop that cannot trade" (CLAUDE.md §5). `held-orders`/`prep-queue` stay optional. Relaxes when a non-selling till type arrives (KDS, sub-project 12). |
| **D5** | Duplicate widget of the same type | allow / reject | **Reject** (`layout.invalid`) | Two baskets/totals are meaningless today; matches `LAYOUT_A`'s one-of-each. Loosens later if a widget is legitimately repeatable. |
| **D6** | Which config key to wire in slice 1 | none / one / several | **`product-grid.columns` only** | One visible, low-risk key (a fixed grid column count) proves the whole bag → widget path; every other widget keeps an empty bag. `tender-pay`'s "which tenders" is the obvious next key but touches the fiscal pay widget — deferred. |
| **D7** | Receipt editor scope | full template edit / trim only | **Trim only: a header subtitle + a footer message** | The receipt is a legal document with a non-removable core (§8, `till-ticket-view.ts:56-82`). Only non-fiscal trim is authorable. `showCashChange` toggle deferred. |
| **D8** | Unknown config keys / values on write | strip silently / reject | **Reject** (`layout.invalid`, fail-closed) | The repo's fail-loud culture; a silently-stripped key hides an editor bug. |
| **D9** | Write permission | reuse `person.manage` / new permission | **New `till.configure`, granted to manager + admin** | Layout/receipt config is a distinct action from staff admin; a domain-named permission keeps the gate legible. Granted to the same roles as `person.manage`. |
| **D10** | Package boundary | schema+service in one new package / schema in `packages/db`, service in `@waitron/layouts` | **Schema in `packages/db` (core), service in `@waitron/layouts`** | Exactly the `@waitron/catalogue` precedent (its table lives at `packages/db/src/schema/catalogue.ts`). Puts the table in the core migration set, so the `inmutabilidad` FORCE-RLS scan covers it **for free** (it scans core tenant_id tables — `0003_sessions_rls.sql:13-16`) and no `migrations.manifest.json` entry is needed. |

---

## 4. Persistence model

**Table `till_layouts`** (English tokens throughout — `till_layouts`, `tenant_id`, `definition`,
`receipt`, `updated_at`), **schema at `packages/db/src/schema/layouts.ts`**, registered in
`packages/db/src/schema/index.ts`, **migration `packages/db/drizzle/0034_till_layouts.sql`** (next
after `0033`, `packages/db/drizzle/`; sequence around any concurrent `_journal.json` collision —
backlog note).

Columns:

- `tenant_id uuid PRIMARY KEY` — **one row per tenant** (D2); PK doubles as the upsert conflict target.
- `definition jsonb NOT NULL` — the `LayoutDef` (array of `WidgetInstance`).
- `receipt jsonb NOT NULL` — the `ReceiptConfig` (§8).
- `updated_at timestamptz NOT NULL DEFAULT now()`.
- FK `tenant_id → tenants(id) ON DELETE restrict` (the `foreignKey({...})` array form + `.enableRLS()`,
  mirroring `packages/identity/src/schema/management-sessions.ts:31-50`).

**FORCE RLS recipe** (hand-written `--custom` migration, modelled verbatim on
`packages/identity/drizzle/0003_sessions_rls.sql`):

```sql
ALTER TABLE "till_layouts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "till_layouts_tenant_isolation" ON "till_layouts"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
REVOKE ALL ON "till_layouts" FROM app_user;
GRANT SELECT, INSERT, UPDATE ON "till_layouts" TO app_user;   -- mutable config, upserted; no DELETE
```

`current_tenant_id()` is already defined by `packages/db`'s `0001_tenancy_rls.sql` and fails closed on
an unset `app.tenant_id` (`0003_sessions_rls.sql:1-5`). `.enableRLS()` alone gives only `ENABLE` — the
`FORCE` + policy + grants are hand-written (CLAUDE.md §3).

**Why a DB table, not env/provisioning:** the owner edits it at runtime; unlike `cardProvider`
(env-stamped, `till-config.ts`), it must be writable by the dashboard and re-read by the till.

---

## 5. Data model and the `@waitron/layouts` package

`@waitron/layouts` (a service package, `packages/layouts`, depends on `@waitron/db` + `@waitron/identity`
— identity for the authorize gate; no `drizzle/` dir, schema lives in db per D10). Public surface:

- **Canonical types** `WidgetType`, `WidgetInstance`, `LayoutDef`, `ReceiptConfig` — the server-side
  source of truth. (The till and dashboard keep their own **local** copies, bundle-decoupled, exactly
  as `apps/till/src/api/client.ts:10-17` explains for every server shape; `apps/till/src/layout.ts` is
  already the till's local copy.)
- **`WIDGET_CONFIG`** — the per-widget config registry: for each `WidgetType`, the allowed config keys
  and each key's validator. Slice 1: only `product-grid` has a key (`columns`: an integer in 1..12);
  every other widget declares an empty schema. This is the ONE tested place that defines what a config
  bag may contain (D8).
- **`DEFAULT_LAYOUT`** — the built-in default `LayoutDef` (the current `LAYOUT_A`, mode-agnostic; the
  server/till apply the Mode-P prep-queue drop as today, see §7). **`DEFAULT_RECEIPT`** — empty trim.
- **`validateLayout(input: unknown): LayoutDef`** — throws `layout.invalid` (§6).
- **`validateReceiptConfig(input: unknown): ReceiptConfig`** — throws `receipt.invalid`.
- **`getLayout(tx, tenantId): Promise<{ definition, receipt }>`** — the row, or the defaults when
  absent (a fresh tenant has never authored one).
- **`putLayout(tx, { managementSessionId, tenantId, definition })`** and
  **`putReceipt(tx, { managementSessionId, tenantId, receipt })`** — each calls
  `authorizeManager(tx, { managementSessionId, permission: "till.configure" })`
  (`packages/identity/src/manager-login.ts:43-52`, the exact gate `listPersons` uses in
  `staff.ts`), then upserts (`INSERT ... ON CONFLICT (tenant_id) DO UPDATE`). Validation runs before
  the write.

`ReceiptConfig = { headerSubtitle?: string; footerMessage?: string }` (D7); both optional, each a
string capped (assumption: 200 chars) — validation rejects a longer or non-string value with
`receipt.invalid`.

---

## 6. Validation rules and error codes

`validateLayout(input)` accepts only:

- an **array**; else `layout.invalid { reason: "not_array" }`.
- each item an object with `type` ∈ the six `WidgetType`s (else `layout.invalid { unknownWidget }`),
  `region` ∈ `{"main","aside"}` (else `layout.invalid { badRegion }`), `config` an object whose keys
  are all in that widget's `WIDGET_CONFIG` schema and whose values pass their validator (else
  `layout.invalid { widget, badConfig }`) (D8).
- **no duplicate `type`** (D5) → `layout.invalid { duplicate }`.
- the **sale-critical four present** (D4) → `layout.invalid { missing }`.

**Error codes** — domain concept, never the package (CLAUDE.md §3). Registered in
`packages/layouts/src/errors.ts` (the `declare module "@waitron/shared"` augmentation + the
`import "./errors.js"` reachability side-effect, per `packages/identity/src/errors.ts`):

| Code | Status | Meaning |
|------|--------|---------|
| `layout.invalid` | 400 | the `definition` failed validation; `params` name the problem, never echo values |
| `receipt.invalid` | 400 | the `receipt` config failed validation |

**Reused, not new:** `authorization.not_permitted` (403, from `authorizeManager`),
`management_session.required` / `management_session.expired` (401, the session guard),
`management.request_invalid` (400, the route's body-shape screen — `management-api.ts:89`).

> **Claim to verify before coding (CLAUDE.md §3 "grep the siblings"):** confirm no existing
> `layout.*` / `receipt.*` / `till.*` error-code family in `packages/*/src/errors.ts` and
> `apps/server/src/errors.ts` before minting these — `till_config` codes exist under `server.*`
> (`till-config.ts`), which is a different namespace, but grep is the receipt, not this note.

---

## 7. The write API and the till read

### Write (management API, `apps/server/src/management-api.ts` — same `mountManagementApi`)

Gated exactly like the staff routes: `requireManagementSession(c)` (401 before any DB work), then the
service's `authorizeManager` enforces `till.configure` under RLS; every DB touch inside
`withTenant(deps.db, deps.cfg.tenantId, …)` + `asAppUser(tx)`.

| Verb + path | Body | Success | Errors |
|-------------|------|---------|--------|
| `GET /management-api/layout` | — | `200 { definition, receipt }` (authored or defaults) | 401 unauth, 403 not-permitted |
| `PUT /management-api/layout` | `{ definition }` | `204` | 401, 403, 400 `layout.invalid`, 400 `management.request_invalid` (body not an object / `definition` absent) |
| `PUT /management-api/receipt` | `{ receipt }` | `204` | 401, 403, 400 `receipt.invalid`, 400 `management.request_invalid` |

`PUT` = full replacement, idempotent — matches the working-order `PUT` full-replace precedent
(`apps/till/src/api/client.ts:312-319`) and the editor's "author the whole layout" semantics. Add
`layout.invalid` + `receipt.invalid` to `management-api.ts`'s `STATUS` map explicitly (both 400 — the
`?? 400` default already covers them, but listing is the house style, `management-api.ts:64-91`). The
route body-shape screen (`?? {}` then a `typeof` check) mirrors `management-api.ts:250-266`.

### Read (till API, `apps/server/src/till-api.ts` — `GET /api/till`)

Extend the existing handler (`till-api.ts:216-249`): after reading the issuer, call
`getLayout(tx, deps.cfg.tenantId)` in the same `withTenant`+`asAppUser` block and add two fields to the
JSON: `layout` (the authored `definition`, or `DEFAULT_LAYOUT`) and `receipt` (authored or
`DEFAULT_RECEIPT`). No new route, no new codes on this surface (read uses defaults on absence).

**Till changes (minimal):**

- `apps/till/src/api/client.ts` — `TillInfo` (`:32-39`) gains `layout: LayoutDef` and
  `receipt: ReceiptConfig`, importing the local `LayoutDef` from `../layout.js` and a new local
  `ReceiptConfig` alias (bundle-decoupled, same rule as every other type there).
- `apps/till/src/till-app.ts` — `#boot` (`:230-242`) sets `this.layout = till.layout` and
  `this.receipt = till.receipt`. The Mode-P prep-queue drop stays: when the server returns
  `DEFAULT_LAYOUT` the current `#layoutFor()` filter still applies as the fallback; an **authored**
  layout is rendered verbatim (the owner's choice — a prep-queue placed under Mode P simply shows its
  empty state). `till-ticket-view` gains a `receipt` prop threaded from here.
- `apps/till/src/screens/till-counter-screen.ts` — `#widget(instance)` (`:183-209`) now passes
  `instance.config` to the widget that reads it: `product-grid` gets `.columns=${instance.config.columns}`.
- `apps/till/src/widgets/product-grid.ts` — a `@property() columns?: number` that, when set, replaces
  the `grid-template-columns: repeat(auto-fill, minmax(9rem,1fr))` with
  `repeat(${columns}, 1fr)` (via a style binding). This is the ONE widget touched.

---

## 8. Receipt editor — the fiscal-safety constraint (load-bearing)

The customer receipt (`apps/till/src/screens/till-ticket-view.ts`) is a **legal document** whose core
is **non-removable and non-reorderable**: issuer venue + NIF (RD 1619/2012 art. 7.1.d), número/serie +
fecha (7.1.a/b), goods identification (7.1.e), tipo + base per rate (7.1.f), total (7.1.g), and the QR
+ VERI\*FACTU legend (Orden HAC/1177/2024 arts. 20–21) — all fixed in the template
(`till-ticket-view.ts:56-82`). **The receipt editor MUST NOT touch any of these.**

The editor authors only **non-fiscal trim** rendered *around* the immutable core: a `headerSubtitle`
(e.g. an address line) and a `footerMessage` (e.g. "Gracias por su visita" / opening hours / a wifi
note). `till-ticket-view` renders `receipt.headerSubtitle` under the venue name and
`receipt.footerMessage` under the legend, both `nothing` when absent. This is the whole receipt-editor
surface for slice 1 (D7). Anyone extending it must keep the art. 7.1 core untouched — a validation test
pins that `ReceiptConfig` carries no field that could suppress or reorder a mandated element.

---

## 9. Editor UI (apps/dashboard)

New screens on `@waitron/ui` primitives (`wt-card`, `wt-button`, `wt-input`, `wt-switch`, `wt-dialog`;
a native token-styled `<select>` for pickers — there is no `wt-select`, per the 1c plan) with a
`.a11y.test.ts` per screen in **both themes**, on the dashboard's own Chromium shard.

**Shell nav.** Extend the shell machine (`apps/dashboard/src/dashboard-app.ts`, today `login | staff`)
to `login | staff | layout | receipt`, with a simple header nav (three `wt-button`s: *Personal* /
*Disposición* / *Recibo*). Keyboard-navigable; no routing library.

**Layout editor (`dashboard-layout-screen`).** Loads `GET /management-api/layout`. Renders **two
region columns** (`main`, `aside`); each is an **ordered list of widget rows** (a `wt-card` per row
showing the widget's name). Per row: **↑ / ↓** (reorder, disabled at ends), **Eliminar** (remove),
**Editar** (expand a config sub-form). A **"Añadir widget"** picker (`<select>` of the widget types not
yet placed — since duplicates are rejected, D5) appends to the chosen region. The config sub-form is
driven by `WIDGET_CONFIG`: `product-grid` shows a `columns` number field; every other widget's sub-form
is empty (a "sin ajustes" note). A **Guardar** `wt-button` → `PUT /management-api/layout`; a
`layout.invalid` rejection surfaces a `role="alert"` message (raw code for slice 1, i18n a follow-up
exactly as 1c deferred it).

**Receipt editor (`dashboard-receipt-screen`).** Loads the same `GET /management-api/layout`
(`receipt` half). Two fields: `headerSubtitle` (`wt-input`) and `footerMessage` (`wt-input`,
multiline). **Guardar** → `PUT /management-api/receipt`.

**No live pixel preview** (YAGNI); the editor authors structure, the till renders it.

`DashboardApi` (`apps/dashboard/src/api/client.ts`) gains `getLayout()`, `putLayout(definition)`,
`putReceipt(receipt)` with **local** `LayoutDef`/`ReceiptConfig` types (bundle-decoupled, per the 1c
client's rule).

---

## 10. Guard suites and the churn checklist

**New / run these (CLAUDE.md §3, §4):**

- **`till_layouts` RLS** — `packages/db/src/schema/layouts.rls.test.ts`, real Postgres via the db
  harness (`describeEachTarget`/`useRealPostgres` — RLS as the app role is a false pass on PGlite,
  CLAUDE.md §4). Positive tenant isolation **and** the negative `WITH CHECK` cross-tenant INSERT
  refusal (the test the sibling `sessions.rls`/`management-sessions.rls` is noted as missing — write
  it here). **Prove FORCE and the policy by deletion** (remove each line, watch it fail, restore).
- **`inmutabilidad` (fiscal-verifactu)** — `till_layouts` is a new `tenant_id` table in **core**, which
  that scan covers automatically (it asserts `relforcerowsecurity` on every core tenant_id table —
  `0003_sessions_rls.sql:13-16`). Run `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad`
  after the migration; a missing `FORCE` shows as `till_layouts: relforcerowsecurity=false` (the exact
  gap `nodes` shipped with, CLAUDE.md §3).
- **`english-only`** — `till_layouts`'s tokens are English → passes; run it (root Vitest project,
  `scripts/english-only.test.ts`).
- **`@waitron/layouts` unit** — `validateLayout` (positive + every rejection branch: not-array,
  unknown widget, bad region, bad config key/value, duplicate, missing-required), `validateReceiptConfig`,
  `WIDGET_CONFIG`, `DEFAULT_LAYOUT`; real-PG for `getLayout`/`putLayout`/`putReceipt` (authorize by
  deletion + cross-tenant). Coverage **98/98/98/95**.
- **`apps/server`** — management-api routes: real-PG e2e — unauth **401**, non-manager **403**
  (a *differential* proof that fails if `authorizeManager` is dropped), valid write → read-back,
  `layout.invalid`/`receipt.invalid` **400**, cross-tenant isolation; till-api `GET /api/till` returns
  authored-then-default layout.
- **`apps/till`** — counter-screen renders an authored layout and threads `product-grid.columns`;
  product-grid `columns` config test; `till-app` boot sets `layout`/`receipt`; `.a11y` unchanged.
  Coverage **95/95/90/88**.
- **`apps/dashboard`** — layout-screen + receipt-screen `.test.ts` + `.a11y.test.ts` (**both themes**),
  on the existing `test-dashboard` Chromium shard (no new shard needed — the package is already gated).
  Coverage **95/95/90/88**.

**Churn to do in the same change (CLAUDE.md §3 "a hardcoded list goes stale"):**

- **`till.configure`** → add to `PERMISSIONS` + the manager/admin sets in
  `packages/identity/src/permissions.ts:7-34`. Grep for any test pinning the exact `PERMISSIONS` array
  (none found in `packages/*/**.test.ts` at design time — verify before adding) and update it if found.
- **`@waitron/layouts` in `GENERIC_PACKAGES`** — add `"layouts"` to
  `packages/db/src/english-only.ts` (the sibling service package `catalogue` is in it) **and** update
  the pinning test `packages/fiscal-verifactu/src/vocabulary-scope.test.ts` in the same commit (the
  stale-list trap). *Alternative considered:* leave it out (it carries no Spanish tokens); default is
  to add it for consistency with `catalogue`.
- **`migrations.manifest.json`** — **no change** (the table is in the already-listed `core` set, D10).
- **CI scope** — **no change**: `@waitron/layouts` is a plain Node package (auto in `test-light`);
  `apps/dashboard`/`apps/till` already have shards. `packages/db`'s new RLS test runs on `test-heavy`.

---

## 11. Provenance

Every external legal citation here (RD 1619/2012 art. 7.1, Orden HAC/1177/2024 arts. 20–21) is
**carried from** `till-ticket-view.ts:56-82` and `docs/compliance/verifactu-findings.md` §14, which
settled them on primary source; this design adds none of its own and must not be read as a fresh
citation. Every in-tree claim is `file:line`-cited above; the two "verify before coding" grep notes
(§6 error-code siblings, §10 `PERMISSIONS` pinning) are flagged rather than asserted.
