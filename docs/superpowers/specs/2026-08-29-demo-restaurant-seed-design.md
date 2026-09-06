# Demo-restaurant seed + live multi-menu till — design

**Status:** approved shape, spec under review · **Date:** 2026-08-29 · **Backlog:** Phase 1 Tier A #1
(seed) + part of Tier B #8 (live assign-menu-to-location), with the Square spike from Tier C #10.

## 1. Goal & scope

Two deliverables, one landing together because the seed demonstrates the feature:

- **A — a live multi-menu till.** Today a location sells exactly one catalogue, fixed at provisioning
  (`locations.catalogue_id`, a single FK; `assignCatalogueToLocation` is exposed by no route). This
  builds the ability to make **several menus sellable at one location** and **switch between them live
  on the till**. It realises Tier B #8's "assign menu to location" as a bounded many-to-many, which is
  real product code (a schema change + RLS + till UI), not demo dressing.
- **B — a believable demo restaurant seed.** `pnpm dev:setup` today seeds ~2 products, 0 tables. This
  replaces that with a realistic two-menu catalogue (per-dish images), a floor plan with zones and
  tables, staff across all four roles, and ~4 weeks of back-dated sales so the reporting screens are
  non-blank. The seed is **dev/demo only**, runs in `preproduction`, and never touches production or
  the AEAT drain.

The demo defaults to **English** with a Spanish flag.

**Out of scope (explicit non-goals):**

- The **Square import product feature** (Tier C #10). The spike below closes the "seed from Square"
  question; the feature is unrelated and deferred.
- A **dashboard UI to manage which catalogues are attached to a location.** Membership in the new
  `location_catalogues` table is set by the seed (and provisioning); a manager-facing editor is a
  Tier B #8 follow-up.
- **Per-till persisted menu selection.** The live switch is client-only/per-session (resets to the
  default on reload); a `tills.active_catalogue_id` column is a later nicety.
- **Category tabs / grouping** on the till grid — this adds a *menu* switcher only.
- **Table-service working orders** for the *historical* seeded sales — the generator uses the direct
  counter path; the live demo still shows table service via the seeded tables.
- **Bilingual** product descriptions — one active locale at a time.

## 2. Spike outcome — hand-author the menu, do not import from Square

The backlog asked: if a one-off Square catalogue import is easy, seed from a real Square export; else
hand-author. **It is not easy, so we hand-author.** Receipts:

- Square's **Item Library CSV export** can only be produced from a live Square account with a
  populated library; there is no account-free way to generate one, the column set drifts by seller
  config, and it **drops images entirely** (Square support: images are "not included" in export and
  "cannot be uploaded via the Item Import Tool").
- The **Catalog API** needs an OAuth token, returns prices as integer cents, and images are separate
  referenced objects — more code and setup.
- **No official public sample Square CSV exists** to grab as demo data.

A throwaway parser buys the demo nothing (the seed calls `createProduct` directly), so the Square path
is set aside for the seed; Tier C #10 remains a separate future build.

## 3. Deliverable A — live multi-menu till

### 3.1 Availability model — a `location_catalogues` join table

A location **specifies the default catalogue plus any other accessible catalogues**.
`locations.catalogue_id` stays as the location's **default** menu (the one the till selects on load,
and what existing consumers keep reading). A new tenant-scoped join table records the **other
accessible catalogues**:

```text
location_catalogues(tenant_id, location_id, catalogue_id)   -- composite PK (location_id, catalogue_id)
```

The location's **accessible set** is the default (`locations.catalogue_id`) **unioned with** the
`location_catalogues` members, de-duplicated — so the default is always accessible, and it need not
(but may) also appear as a join row. It is a `tenant_id`-bearing table, so it ships with **FORCE ROW
LEVEL SECURITY + a `location_catalogues_tenant_isolation` policy + grants**, hand-written in a custom
migration exactly as `0001_tenancy_rls.sql` does (`.enableRLS()` alone is insufficient — CLAUDE.md §3).
Grants to `app_user` mirror the catalogue tables' pattern (the seed and a future manager route write it
under `app_user` via RLS). After adding it, the `packages/fiscal-verifactu` `inmutabilidad` guard
(which scans every `tenant_id` table for FORCE RLS) must be re-run.

### 3.2 Read path — union across the location's available catalogues

`listAvailableProducts(tx, locationId)` (`packages/catalogue/src/operations.ts`) changes from joining
the single `locations.catalogue_id` to resolving the location's **accessible set** (the default
unioned with the `location_catalogues` members, de-duplicated) and returning products from **every
active accessible catalogue**, each row additionally tagged with its **`catalogueId` and catalogue
`name`**. The till-api `GET /api/products` (`apps/server/src/till-api.ts`) returns the
tagged products plus a small **menu list** (`[{ id, name, isDefault }]`) so the till can render the
switcher and pick the default. RLS still scopes tenant; `catalogues.active`/`products.active` filters
are unchanged.

### 3.3 Park/retrieve reprice — the one leak, closed by the union

`priceOrderLines` (`apps/server/src/working-order.ts:~105`) re-reads the sellable set on
`parkOrder`/`updateHeldOrder` and throws `sale.unknown_product` for anything absent. Pointing it at
the **same union read** (all of the location's available catalogues) means a held order containing
items from either menu reprices cleanly. This makes **mixing items from both menus in one order/tab
safe** — which is also correct because working-order lines are fully snapshotted (price/description/
category label copied at add-time, only a `product_id`, **no catalogue reference on line or order**),
so nothing re-resolves a line against a catalogue at pay time.

### 3.4 Till UI — a client-side menu switcher

The product grid (`apps/till/src/widgets/product-grid.ts`) is a flat wall today with no tabs. Add a
**menu switcher** (a segmented control / tabs listing the available menus) above the grid on the
counter and table-order screens. The till loads all available products once (§3.2); a new app-level
`selectedCatalogueId` state (`apps/till/src/till-app.ts`) drives a **client-side filter** of the grid
by `catalogueId` — the switch is instant, no re-fetch. Default selection is the menu flagged
`isDefault`. In-flight cart lines are untouched by a switch (§3.3).

## 4. Deliverable B — the demo venue

Provisioning already creates the tenant, admin, location, till, node, SIF, two invoice series, and a
default kitchen station "Cocina". The seed runs after `applyVenue` and adds everything below under
`withTenant` / `asAppUser`.

### 4.1 Catalogues (two, both sellable)

- **"Casa Delgado" — the full à-la-carte menu** (restaurant + deli counter), set as the location's
  **primary** (`locations.catalogue_id`) so it is the default on the till.
- **"Menú del Día" — a set lunch menu** (~4–6 courses/items) — a real, believable second menu.

Casa Delgado is the **default** (`locations.catalogue_id`); Menú del Día is added to
`location_catalogues` as an **other accessible** menu. Both are therefore sellable and the till
switcher offers both (§3). The dashboard catalogue selector (an *editing* selector) also shows both.

### 4.2 Menu content ("Casa Delgado")

~35–45 products across ~8 categories spanning both sides of the hybrid venue:

- **Deli counter, weight-priced (`pricingUnit: "weight"`, per kg):** Charcutería (jamón ibérico,
  chorizo, lomo, salchichón), Quesos (manchego curado, cabrales, tetilla), Conservas.
- **Restaurant, each-priced (`pricingUnit: "each"`):** Tapas, Raciones, Platos principales, Postres,
  Bebidas (soft/coffee vs. alcohol split so VAT differs).

Each product carries `descriptions` keyed by the active locale (§6), a gross VAT-inclusive `unitPrice`
(`numeric(12,2)`), and a `vatClass` mapped to the standing Spanish rates — food
`reduced`/`super_reduced`, alcohol/soft-drinks `general`. Values are demo dressing; plausibility, not
accuracy, is the bar. **KDS routing:** categories are routed to stations via a direct `update` on
`categories.station_id` (the create ops don't accept a station) — kitchen categories → "Cocina",
drinks → a seeded **"Barra"** station — so the KDS demo shows kitchen vs. bar tickets.

### 4.3 Floor plan

Three zones via `createZone` — **Comedor**, **Terraza**, **Barra** — and ~16 tables via `createTable`,
each with a `capacity`, a `zone_id`, and spatial placement (`setTablePlacement`) so the live floor and
the spatial editor both look real. `createStatus` is session-gated, so the handful of
`table_service_statuses` (Libre / Ocupada / Reservada / Cuenta pedida) are seeded by direct insert.

### 4.4 Staff

~6 people covering all four `person_role` values (`staff`, `supervisor`, `manager`, `admin`). The
admin exists from provisioning; the rest use the raw-insert + `hashPin` pattern (`createPerson` is
session-gated). **Every demo person uses till PIN `5555`** — one memorable PIN for the whole demo,
including the provisioning admin (its `ADMIN_PIN` constant is set to `5555`). PINs are printed in the
seed output. (The admin's dashboard password login is separate and unchanged.)

### 4.5 Images (per-dish placeholders)

`products.image` is a content-addressed filename (`<sha256hex>.<ext>`, jpg/png/webp) served by the
public `GET /media/:filename` route from `config.mediaDir` (`apps/server/src/media-api.ts`). The seed
supplies **one generated placeholder per dish**:

1. **Authoring time:** one SVG tile per product (a per-category colour, a simple food glyph, the dish
   name) is rasterised to PNG and the PNGs are **committed** under
   `apps/server/scripts/demo-seed/media/` (SVG is not a servable type; PNG is).
2. **Seed time:** `seed-media.ts` reads each PNG, computes its SHA-256, copies it into
   `config.mediaDir` as `<sha256>.png`, and sets the product's `image`.

`mediaDir` is resolved as `boot.ts` computes its default (or `WAITRON_MEDIA_DIR`), so the seed writes
where the dev server serves. Committing the PNGs keeps assets reviewable; the content-hash rename is
done at seed time so no hashes are hard-coded.

## 5. Back-dated sales generator (for non-blank reports)

The reporting layer (`packages/reporting`) is a pure read over the commercial tables: VAT summary
reads `sales.vat_breakdown` by `issued_at`, cash-up reads `tenders` by `settled_at`, counts read
`sales`. So `seed-sales.ts` populates `sales` + `sale_lines` + `tenders` + `sale_settlements` via
`recordSale` in `immediate` settlement mode, mirroring `apps/server/scripts/record-one-sale.ts`:

- Loop `recordSale(tx, backend, input)`, `workingOrderId` omitted (counter path), one immediate tender.
- **Back-dating:** `recordSale` takes its instant from an injected `TrustedClock`; there is no CHECK
  that `issued_at` be near `now()`, and the huella chain orders by insertion `secuencia`, not
  timestamp, so historical sales in any order don't break the chain. The generator injects a clock
  returning the chosen past `Date` (+ venue offset) and sets each tender's `settledAt` to match.
- **Volume/pattern:** last **28 days** (`WAITRON_SEED_SALES_DAYS`, default 28, `0` skips), ~15–40
  sales/day with lunch/dinner peaks and busier weekends. Lines are drawn from the seeded "Casa
  Delgado" products (so "top sellers" is real); tenders mix `cash`/`card` (the `tender_method` enum is
  `cash|card|voucher|transfer|other`).
- **Line maths:** `RecordSaleLine.lineTotal` is the tax-**exclusive** base and `vatRate` a percentage
  literal; product `unitPrice` is gross, so the base is reversed out using the same helpers
  `record-one-sale.ts` uses (`buildVatBreakdown` / `percentOf`).
- **Backend:** one `VerifactuBackend` with `deploymentEnvironment` from the env (→ `preproduction`)
  and a `resolveClient` stub that throws (never called by `recordSale`). **The drain never runs** —
  `envios` rows stay `pendiente`; nothing reaches AEAT.

Persisted *cierre Z* rows (`recordDailyClose`) are not required (reports compute from the sales), so
they're out of scope.

## 6. Locale — English default, Spanish flag

Only `es-ES` and `en-GB` are supported (`packages/shared/src/locales.ts`; fallback `en-GB`). The demo
defaults to English via three coordinated levers keyed off one seed constant:

- Product `descriptions` are keyed under the active locale (`en-GB` by default).
- The location's `invoiceLocales` is `["en-GB"]`, so receipts/invoices render in English.
- A **new `WAITRON_TILL_LOCALE=en-GB`** key is written into the generated `apps/server/.env` (extend
  `DevEnv`/`ENV_KEYS` in `dev-setup.ts`); it flows to `cfg.localeOverride` → `resolveVenueLocale`
  override and wins over the `ES` country default for the UI.

`WAITRON_SEED_LOCALE=es-ES` flips all three back to Spanish. `country` stays `ES` (fiscal identity).
Menu content is authored in both languages as data so the flag is a real switch; only the active
locale is written into each product's `descriptions` (no bilingual jsonb).

## 7. Module layout & invocation

A new `apps/server/scripts/demo-seed/` module: typed data (`menu.ts`, `floor.ts`, `staff.ts`,
authored in both locales), logic (`seed-catalogue.ts`, `seed-floor.ts`, `seed-staff.ts`,
`seed-media.ts`, `seed-sales.ts`, `seed.ts` orchestrator), and `media/` (committed per-dish PNGs).
`provisionVenue` in `dev-setup.ts` calls the orchestrator instead of the current inline 2-product
block. The existing fiscal safety guard (`inspectVenues` — never mint a second venue/chain into a
populated DB) is unchanged, so the seed stays idempotent; `pnpm dev:reset` rebuilds from scratch. The
multi-menu **feature** code lives in its normal homes (`packages/db` schema + migration,
`packages/catalogue`, `apps/server`, `apps/till`), not under `demo-seed/`.

## 8. Testing (TDD)

- **Feature (deliverable A):** RLS isolation on `location_catalogues` (proven by cross-tenant deletion
  of the tenant predicate); FORCE RLS present (the `inmutabilidad` guard); the union read returns
  products from every available catalogue tagged with `catalogueId`; a working order **mixing both
  menus** records and prices correctly; **park/retrieve of an order whose items span both menus**
  survives the reprice; the till switcher filters client-side and defaults to the primary.
- **Seed (deliverable B):** `seed-sales` — coverage identity, positive tenders, back-dated
  `issued_at`/`settled_at`, `entorno = preproduction`, base-from-gross maths; `seed-media` —
  deterministic SHA-256 naming + copy + `image` set; the locale flag selects the right
  descriptions/`invoiceLocales`/env. **Integration (real Postgres):** run the full seed and assert the
  reporting layer returns non-blank VAT/cash-up/counts; both catalogues are available and
  `listAvailableProducts`-visible; `/media` serves a seeded image byte-for-byte.
- Guard-by-deletion where a check is load-bearing.

## 9. Fiscal safety

Seeded rows in `sales`/`sale_lines`/`tenders`/`sale_settlements`/`registros_facturacion`/`cadenas`/
`envios` are **append-only** and **permanent** — to undo, `pnpm dev:reset`. The generator runs only in
`preproduction` and must never point at a production `DATABASE_URL` (a wrong `production` `entorno`
stamp is unrecoverable). No drain runs. The multi-menu feature touches no fiscal path — lines are
snapshotted, and the fiscal write path is byte-unchanged.

## 10. Items the implementation plan pins

- The exact `location_catalogues` grants to `app_user` (SELECT for the read; INSERT/DELETE if the seed
  and future manager route manage membership under RLS) — mirror the catalogue tables' grants.
- Whether `listAvailableProducts` gains a new variant or its existing signature is repointed (and the
  handful of its other callers audited for the tagged-row shape change).
- The `/api/products` response shape (tagged products + menu list) and the `apps/till` client type.
- `mediaDir` default-resolution parity with `boot.ts` from the standalone `tsx` seed process.
- The per-dish SVG→PNG rasterisation step (tool + committed output) and tile count.
- Confirming `record-one-sale.ts`'s exact `VerifactuBackend` construction + clock stub to copy.


> **2026-09-06 update:** The menu preference now persists in browser session storage through new
> and parked orders. Every login resets it to the default, including the PIN login after refresh. See [UI navigation and controls](../plans/2026-09-06-ui-navigation-and-controls.md).
