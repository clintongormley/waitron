# Multi-menu till + demo-restaurant seed — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a location sell several menus and switch between them live on the till, then replace the thin `dev:setup` seed with a believable demo restaurant (two menus with per-dish images, a floor plan, staff, and ~4 weeks of back-dated sales), defaulting to English.

**Architecture:** Phase 1 adds a tenant-scoped `location_catalogues` join table (default catalogue in `locations.catalogue_id` ∪ join-table members = the accessible set); `listAvailableProducts` returns products across the accessible set tagged with their catalogue, so both the till grid and the park/retrieve reprice see every menu; the till switches menus with a client-side filter. Phase 2 is a hand-authored demo seed that provisions two catalogues (both accessible), a floor plan, staff on one PIN, and back-dated counter sales via the existing `recordSale` path in preproduction.

**Tech Stack:** TypeScript, pnpm workspace, Drizzle ORM + PostgreSQL (RLS), Hono (server), Lit (`apps/till`), Vitest, Testcontainers/PGlite.

**Spec:** `docs/superpowers/specs/2026-08-29-demo-restaurant-seed-design.md`

## Global Constraints

- **English-only identifiers in `packages/*`** (Spanish only as fiscal schema tokens in `SPANISH_WORDS`); `apps/*` is out of the guard's scope but keep UI identifiers English (i18n VALUES may be Spanish). Run `pnpm --filter @waitron/db test` unfiltered when touching `packages/db` (loads `english-only`).
- **A new `tenant_id`-bearing table needs FORCE RLS + a tenant-isolation policy + grants**, hand-written in a `--custom` migration (`.enableRLS()` gives only ENABLE). After adding one, run `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad`.
- **Never build SQL by string concatenation** — Drizzle parameterises; utility/DDL statements that can't bind use `quoteIdent`/`quoteLiteral` or a validated fixture path. The seed's only raw SQL is parameterised `tx.execute(sql\`… ${value}\`)`.
- **Error codes name the domain concept, not the package** (`catalogue.*` / `sale.*`), and are never renamed once shipped; every file that throws one imports its registry (`import "./errors.js"`).
- **Fiscal safety:** the seed runs only in `preproduction` and NEVER against a production `DATABASE_URL`; it never runs the AEAT drain. Seeded `sales`/`registros`/`envios` rows are append-only and permanent (undo = `pnpm dev:reset`).
- **Coverage thresholds:** 98/98/98/95 for packages except the four browser packages (`apps/till` etc.) at 95/95/90/88. Run `pnpm --filter <pkg> test:coverage` before claiming green.
- **Commit every commit with `-s`.** Feature work on this branch (`feat/multi-menu-demo-seed`), full PR gate.

---

## File Structure

**Phase 1 — feature (`packages/db`, `packages/catalogue`, `apps/server`, `apps/till`):**

- `packages/db/src/schema/location-catalogues.ts` — NEW. The `location_catalogues` join table (tenant + location + catalogue), `.enableRLS()`, composite-FK note. Modelled exactly on `station-printers.ts`.
- `packages/db/src/schema/catalogue.ts` — MODIFY. Add `catalogues_tenant_id_key` unique `(tenant_id, id)` so the join table's composite FK has a target.
- `packages/db/src/index.ts` — MODIFY. Export `locationCatalogues`.
- `packages/db/drizzle/00NN_*.sql` — NEW (generated). Table + `catalogues` unique.
- `packages/db/drizzle/00NN_location_catalogues_rls.sql` — NEW (`--custom`). FORCE RLS + policy + grants + composite FKs.
- `packages/catalogue/src/operations.ts` — MODIFY. `resolveAccessibleCatalogueIds`, tag `listAvailableProducts` rows with catalogue, add `listAccessibleCatalogues`, `addCatalogueToLocation`.
- `apps/server/src/till-api.ts` — MODIFY. `GET /api/products` returns `{ menus, products }`.
- `apps/till/src/api/client.ts` — MODIFY. `listProducts()` returns the new shape.
- `apps/till/src/till-app.ts` — MODIFY. `selectedCatalogueId` state + grid filter + thread menus to screens.
- `apps/till/src/widgets/menu-switcher.ts` — NEW. `<till-menu-switcher>`.
- `apps/till/src/screens/till-counter-screen.ts`, `till-table-order-screen.ts` — MODIFY. Render the switcher; filter products.

**Phase 2 — seed (`apps/server/scripts/demo-seed/`):**

- `menu.ts`, `floor.ts`, `staff.ts` — NEW. Typed demo content (both locales).
- `seed-catalogue.ts`, `seed-floor.ts`, `seed-staff.ts`, `seed-media.ts`, `seed-sales.ts`, `seed.ts` — NEW. Seeding logic + orchestrator.
- `media/*.png` — NEW. Committed per-dish placeholder tiles.
- `apps/server/scripts/dev-setup.ts` — MODIFY. Call the orchestrator; `WAITRON_TILL_LOCALE`/`WAITRON_SEED_LOCALE`; `ADMIN_PIN = "5555"`.
- `docs/backlog.md` — MODIFY. Move Tier A #1 to built; note the multi-menu foundation.

---

## PHASE 1 — Live multi-menu till

### Task 1: `location_catalogues` join table + RLS

**Files:**
- Create: `packages/db/src/schema/location-catalogues.ts`
- Modify: `packages/db/src/schema/catalogue.ts` (add `catalogues_tenant_id_key`), `packages/db/src/index.ts`
- Create (generated): `packages/db/drizzle/00NN_<auto>.sql`, `packages/db/drizzle/00NN_location_catalogues_rls.sql`
- Test: `packages/db/src/schema/location-catalogues.test.ts`

**Interfaces:**
- Produces: `locationCatalogues` (Drizzle table: `tenantId`, `locationId`, `catalogueId`; PK `(tenant_id, location_id, catalogue_id)`), exported from `@waitron/db`.

- [ ] **Step 1: Write the failing RLS/shape test** — real Postgres (privileges + FORCE RLS can't be shown on PGlite). Mirror `station-printers`' RLS test if present; otherwise:

```ts
// packages/db/src/schema/location-catalogues.test.ts
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { useRealPostgres } from "@waitron/db/testing/lifecycle.js";
import { asAppUser, withTenant } from "@waitron/db";

describe("location_catalogues", () => {
  const db = useRealPostgres();
  it("has FORCE row level security enabled", async () => {
    const [row] = await db().execute(sql`
      select relforcerowsecurity from pg_class where relname = 'location_catalogues'`);
    expect(row).toMatchObject({ relforcerowsecurity: true });
  });
  it("app_user can insert + read its own tenant's membership but not another's", async () => {
    // seed two tenants + a location + a catalogue each via the provisioning/fixtures helper,
    // then: withTenant(A) asAppUser insert (locationA, catA) → readable; withTenant(B) asAppUser
    // select → zero rows (RLS). Assert the cross-tenant read returns [].
  });
});
```

- [ ] **Step 2: Run it, watch it fail** — `pnpm --filter @waitron/db test location-catalogues` → FAIL (`relation "location_catalogues" does not exist`).

- [ ] **Step 3: Add the schema + the catalogues unique.** New file, copied from `station-printers.ts` shape:

```ts
// packages/db/src/schema/location-catalogues.ts
import { pgTable, primaryKey, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

/**
 * The location → catalogue accessibility map: the OTHER catalogues (menus) a location may sell,
 * beyond its default `locations.catalogue_id`. A many-to-many join keyed on identity —
 * PRIMARY KEY (tenant_id, location_id, catalogue_id); a (location, catalogue) pair is present at
 * most once and attach/detach is add/remove of exactly that row. `location_id`/`catalogue_id` are
 * BARE uuids: their tenant-consistent composite FKs — (tenant_id, location_id) → locations
 * (tenant_id, id) and (tenant_id, catalogue_id) → catalogues(tenant_id, id) — are hand-written in
 * the paired --custom migration, exactly as station_printers does. `.enableRLS()` emits only ENABLE;
 * the FORCE, the location_catalogues_tenant_isolation policy and the SELECT/INSERT/DELETE grant are
 * hand-written there too (the inmutabilidad scan requires FORCE on every tenant_id table).
 */
export const locationCatalogues = pgTable(
  "location_catalogues",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      /* v8 ignore next */
      .references(() => tenants.id, { onDelete: "restrict" }),
    locationId: uuid("location_id").notNull(),
    catalogueId: uuid("catalogue_id").notNull(),
  },
  (t) => [
    primaryKey({
      columns: [t.tenantId, t.locationId, t.catalogueId],
      name: "location_catalogues_pk",
    }),
  ],
).enableRLS();
```

In `catalogue.ts`, add to the `catalogues` table's second arg (alongside the existing index) the composite unique the FK needs (mirrors `products_tenant_id_key`):

```ts
  (t) => [
    index("catalogues_tenant_id_idx").on(t.tenantId),
    unique("catalogues_tenant_id_key").on(t.tenantId, t.id),
  ],
```

(add `unique` to the `drizzle-orm/pg-core` import in `catalogue.ts`.) Export from `index.ts`: `export { locationCatalogues } from "./schema/location-catalogues.js";`

- [ ] **Step 4: Generate the table migration** — `pnpm --filter @waitron/db db:generate`. It emits one migration creating `location_catalogues` (+ ENABLE RLS + the `tenant_id → tenants` FK) and the `catalogues_tenant_id_key` unique. Inspect it; do not hand-edit.

- [ ] **Step 5: Generate + fill the custom RLS migration** — `pnpm --filter @waitron/db db:generate:custom`, then write into the new empty `00NN_location_catalogues_rls.sql` (copy `0066_station_printers_rls.sql` verbatim in shape):

```sql
-- Hand-written (--custom): drizzle models no policies, FORCE, privileges, or tenant-consistent
-- composite FKs. current_tenant_id()/app_user exist (0001). The inmutabilidad scan requires FORCE on
-- every tenant_id-bearing table. A membership row is ADDED or REMOVED, never edited → SELECT/INSERT/
-- DELETE, no UPDATE (0066 precedent).
ALTER TABLE "location_catalogues" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "location_catalogues_tenant_isolation" ON "location_catalogues"
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());--> statement-breakpoint
REVOKE ALL ON "location_catalogues" FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "location_catalogues" TO app_user;--> statement-breakpoint
ALTER TABLE "location_catalogues"
  ADD CONSTRAINT "location_catalogues_location_fk"
  FOREIGN KEY ("tenant_id", "location_id") REFERENCES "locations" ("tenant_id", "id");--> statement-breakpoint
ALTER TABLE "location_catalogues"
  ADD CONSTRAINT "location_catalogues_catalogue_fk"
  FOREIGN KEY ("tenant_id", "catalogue_id") REFERENCES "catalogues" ("tenant_id", "id");
```

- [ ] **Step 6: Run the test + guards** — `pnpm --filter @waitron/db test location-catalogues` (PASS), then unfiltered `pnpm --filter @waitron/db test:coverage` and `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` (must be green — proves FORCE RLS present). Prove the guard by deleting the FORCE line, watching inmutabilidad go red, restoring.

- [ ] **Step 7: Commit** — `git add -A && git commit -s -m "feat(db): location_catalogues join table for multi-menu locations"`

---

### Task 2: accessible-set resolution + tag `listAvailableProducts`

**Files:**
- Modify: `packages/catalogue/src/operations.ts`
- Test: `packages/catalogue/src/operations.test.ts` (extend)

**Interfaces:**
- Consumes: `locationCatalogues`, `locations`, `catalogues`, `products`, `categories` from `@waitron/db`.
- Produces:
  - `resolveAccessibleCatalogueIds(tx: Transaction, locationId: string): Promise<string[]>` — the default (`locations.catalogue_id`, if non-null) unioned with `location_catalogues` members, de-duplicated.
  - `AvailableProduct` gains `catalogueId: string` and `catalogueName: string`.
  - `listAvailableProducts(tx, locationId)` now returns products across the whole accessible set, ordered by `catalogueName`, then `products.createdAt`, `products.id`.

- [ ] **Step 1: Write the failing test** — extend `operations.test.ts`:

```ts
it("lists products across the default AND other accessible catalogues, tagged", async () => {
  await withTenant(db(), TENANT, async (tx) => {
    await asAppUser(tx);
    const main = await createCatalogue(tx, { name: "Main" });
    const lunch = await createCatalogue(tx, { name: "Lunch" });
    const other = await createCatalogue(tx, { name: "Unlisted" }); // NOT accessible
    const pMain = await createProduct(tx, { catalogueId: main.id, categoryId: null,
      descriptions: { "en-GB": "Steak" }, pricingUnit: "each", unitPrice: "20.00", vatClass: "general" });
    const pLunch = await createProduct(tx, { catalogueId: lunch.id, categoryId: null,
      descriptions: { "en-GB": "Set menu" }, pricingUnit: "each", unitPrice: "12.00", vatClass: "general" });
    await createProduct(tx, { catalogueId: other.id, categoryId: null,
      descriptions: { "en-GB": "Hidden" }, pricingUnit: "each", unitPrice: "9.00", vatClass: "general" });
    await assignCatalogueToLocation(tx, LOCATION, main.id);   // default
    await addCatalogueToLocation(tx, LOCATION, lunch.id);     // other accessible (Task defines it)
    const rows = await listAvailableProducts(tx, LOCATION);
    expect(rows.map((r) => r.id).sort()).toEqual([pMain.id, pLunch.id].sort());
    expect(rows.find((r) => r.id === pLunch.id)).toMatchObject({
      catalogueId: lunch.id, catalogueName: "Lunch",
    });
  });
});
```

Also add `addCatalogueToLocation(tx, locationId, catalogueId)` (insert into `location_catalogues`, `ON CONFLICT DO NOTHING`) — the seed and this test use it.

- [ ] **Step 2: Run it, watch it fail** — `pnpm --filter @waitron/catalogue test operations` → FAIL (`addCatalogueToLocation` undefined; only default catalogue's products returned; no `catalogueName`).

- [ ] **Step 3: Implement.** Add `addCatalogueToLocation` + `resolveAccessibleCatalogueIds`, and rewrite `listAvailableProducts`:

```ts
import { and, eq, inArray, sql } from "drizzle-orm";
import { catalogues, categories, locationCatalogues, locations, products } from "@waitron/db";

export async function addCatalogueToLocation(
  tx: Transaction, locationId: string, catalogueId: string,
): Promise<void> {
  await tx.insert(locationCatalogues)
    .values({ tenantId: sql`current_tenant_id()`, locationId, catalogueId })
    .onConflictDoNothing();
}

export async function resolveAccessibleCatalogueIds(
  tx: Transaction, locationId: string,
): Promise<string[]> {
  const [def] = await tx.select({ id: locations.catalogueId }).from(locations)
    .where(eq(locations.id, locationId));
  const members = await tx.select({ id: locationCatalogues.catalogueId })
    .from(locationCatalogues).where(eq(locationCatalogues.locationId, locationId));
  const ids = new Set<string>();
  if (def?.id != null) ids.add(def.id);
  for (const m of members) ids.add(m.id);
  return [...ids];
}

export async function listAvailableProducts(
  tx: Transaction, locationId: string,
): Promise<AvailableProduct[]> {
  const accessible = await resolveAccessibleCatalogueIds(tx, locationId);
  if (accessible.length === 0) return [];
  const rows = await tx
    .select({
      id: products.id, descriptions: products.descriptions, pricingUnit: products.pricingUnit,
      unitPrice: products.unitPrice, vatClass: products.vatClass, category: categories.name,
      allergens: products.allergens, courseId: products.courseId,
      catalogueId: catalogues.id, catalogueName: catalogues.name,
    })
    .from(products)
    .innerJoin(catalogues, eq(catalogues.id, products.catalogueId))
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(and(inArray(catalogues.id, accessible), eq(catalogues.active, true), eq(products.active, true)))
    .orderBy(catalogues.name, products.createdAt, products.id);
  return rows.map((row) => ({
    id: row.id, descriptions: row.descriptions, pricingUnit: row.pricingUnit as PricingUnit,
    unitPrice: row.unitPrice, vatClass: row.vatClass as VatClass, category: row.category,
    allergens: row.allergens, courseId: row.courseId,
    catalogueId: row.catalogueId, catalogueName: row.catalogueName,
  }));
}
```

Add the two fields to the `AvailableProduct` interface (with doc comments) — they are additive, so it stays structurally assignable to `PriceableProduct` (priceBasket ignores them, like `courseId`).

- [ ] **Step 4: Run + fix fallout** — `pnpm --filter @waitron/catalogue test:coverage`. Any existing `listAvailableProducts` assertion using `toEqual` on a full row gains `catalogueId`/`catalogueName`; update those fixtures. Run `pnpm --filter @waitron/server test working-order` (its `priceOrderLines` now reprices against the union — assert an order mixing two accessible menus parks + retrieves; add that case in Task 5's server test if not already covered here).

- [ ] **Step 5: Commit** — `git commit -s -m "feat(catalogue): sell products across a location's accessible menu set"`

---

### Task 3: `listAccessibleCatalogues` (the switcher's menu list)

**Files:**
- Modify: `packages/catalogue/src/operations.ts`
- Test: `packages/catalogue/src/operations.test.ts`

**Interfaces:**
- Produces: `AccessibleCatalogue = { id: string; name: string; isDefault: boolean }`; `listAccessibleCatalogues(tx, locationId): Promise<AccessibleCatalogue[]>` — the accessible active catalogues, `isDefault` true for `locations.catalogue_id`, ordered default-first then by name.

- [ ] **Step 1: Failing test:**

```ts
it("lists accessible catalogues with the default flagged, default first", async () => {
  await withTenant(db(), TENANT, async (tx) => {
    await asAppUser(tx);
    const main = await createCatalogue(tx, { name: "Main" });
    const lunch = await createCatalogue(tx, { name: "Lunch" });
    await assignCatalogueToLocation(tx, LOCATION, main.id);
    await addCatalogueToLocation(tx, LOCATION, lunch.id);
    expect(await listAccessibleCatalogues(tx, LOCATION)).toEqual([
      { id: main.id, name: "Main", isDefault: true },
      { id: lunch.id, name: "Lunch", isDefault: false },
    ]);
  });
});
```

- [ ] **Step 2: Run, watch fail** — `pnpm --filter @waitron/catalogue test operations` → FAIL (undefined).

- [ ] **Step 3: Implement:**

```ts
export interface AccessibleCatalogue { id: string; name: string; isDefault: boolean; }

export async function listAccessibleCatalogues(
  tx: Transaction, locationId: string,
): Promise<AccessibleCatalogue[]> {
  const [loc] = await tx.select({ defaultId: locations.catalogueId }).from(locations)
    .where(eq(locations.id, locationId));
  const ids = await resolveAccessibleCatalogueIds(tx, locationId);
  if (ids.length === 0) return [];
  const rows = await tx.select({ id: catalogues.id, name: catalogues.name })
    .from(catalogues).where(and(inArray(catalogues.id, ids), eq(catalogues.active, true)));
  return rows
    .map((r) => ({ id: r.id, name: r.name, isDefault: r.id === loc?.defaultId }))
    .sort((a, b) => (a.isDefault === b.isDefault ? a.name.localeCompare(b.name) : a.isDefault ? -1 : 1));
}
```

- [ ] **Step 4: Run** — `pnpm --filter @waitron/catalogue test:coverage` → PASS.
- [ ] **Step 5: Commit** — `git commit -s -m "feat(catalogue): list a location's accessible menus for the switcher"`

---

### Task 4: `GET /api/products` returns `{ menus, products }`

**Files:**
- Modify: `apps/server/src/till-api.ts` (the `/api/products` handler, ~629-638)
- Test: `apps/server/src/till-api.test.ts` (the products-route test)

**Interfaces:**
- Produces: `GET /api/products` response `{ menus: AccessibleCatalogue[], products: AvailableProduct[] }` (was `AvailableProduct[]`). Session-guarded, tenant-scoped as before.

- [ ] **Step 1: Failing test** — update the existing products-route test to expect the wrapped shape and a `menus` array with the default flagged. Add a second accessible catalogue via `addCatalogueToLocation` in the fixture and assert its products appear.

- [ ] **Step 2: Run, watch fail** — `pnpm --filter @waitron/server test till-api` → FAIL (shape mismatch).

- [ ] **Step 3: Implement** — import `listAccessibleCatalogues`; in the handler:

```ts
app.get("/api/products", (c) =>
  run(c, log, async () => {
    await requireSession(deps, c);
    const { menus, products } = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return {
        menus: await listAccessibleCatalogues(tx, deps.cfg.locationId),
        products: await listAvailableProducts(tx, deps.cfg.locationId),
      };
    });
    return c.json({ menus, products });
  }),
);
```

- [ ] **Step 4: Run** — `pnpm --filter @waitron/server test:coverage till-api` (and grep for other consumers of the old array shape in `apps/server` — there should be none server-side). PASS.
- [ ] **Step 5: Commit** — `git commit -s -m "feat(till-api): return the location's menus alongside its products"`

---

### Task 5: till UI — client shape + menu switcher + client-side filter

**Files:**
- Modify: `apps/till/src/api/client.ts` (`listProducts`, ~715), `apps/till/src/till-app.ts` (products state ~207, login load ~519, screen threading ~1453/1494)
- Create: `apps/till/src/widgets/menu-switcher.ts`
- Modify: `apps/till/src/screens/till-counter-screen.ts`, `apps/till/src/screens/till-table-order-screen.ts`
- Test: `apps/till/src/widgets/menu-switcher.test.ts`, and extend the relevant screen/app test.

**Interfaces:**
- Consumes: `{ menus, products }` from `GET /api/products`.
- Produces: `<till-menu-switcher>` (props `menus: {id,name,isDefault}[]`, `selectedId: string`; emits `menu-selected` with `{ id }`); `TillApp.selectedCatalogueId` state driving a client-side `products` filter.

- [ ] **Step 1: Write the failing widget test** — `menu-switcher.test.ts`: renders one button per menu, marks the selected one, emits `menu-selected` with the clicked id. (Follow an existing `apps/till/src/widgets/*.test.ts` for the render harness.)

- [ ] **Step 2: Run, watch fail** — `pnpm --filter @waitron/till test menu-switcher` → FAIL (module missing).

- [ ] **Step 3: Implement the widget** (representative — follow `product-grid.ts`/`wt-button` conventions):

```ts
// apps/till/src/widgets/menu-switcher.ts — <till-menu-switcher>
// A segmented control listing the location's accessible menus. Hidden (renders nothing) when there
// is only one menu, so a single-menu venue looks exactly as before. Props in, event out; holds no
// state — the parent owns selectedId and re-filters the grid.
@customElement("till-menu-switcher")
export class TillMenuSwitcher extends LitElement {
  @property({ attribute: false }) menus: { id: string; name: string; isDefault: boolean }[] = [];
  @property() selectedId = "";
  render() {
    if (this.menus.length <= 1) return nothing;
    return html`<div class="switcher" role="tablist">
      ${this.menus.map((m) => html`<wt-button
        role="tab" aria-selected=${m.id === this.selectedId}
        variant=${m.id === this.selectedId ? "primary" : "ghost"}
        @click=${() => this.dispatchEvent(new CustomEvent("menu-selected",
          { detail: { id: m.id }, bubbles: true, composed: true }))}
      >${m.name}</wt-button>`)}
    </div>`;
  }
}
```

- [ ] **Step 4: Client shape** — `client.ts` `listProducts()` returns `{ menus, products }` (update its return type + the one call site). In `till-app.ts`: keep `@state() private products` (all products), add `@state() private menus` and `@state() private selectedCatalogueId = ""`; after the login load, set `menus`, `products`, and `selectedCatalogueId = menus.find(m => m.isDefault)?.id ?? menus[0]?.id ?? ""`. Compute a derived `visibleProducts = this.products.filter(p => p.catalogueId === this.selectedCatalogueId)` and thread THAT to the counter + table-order screens in place of `products`. Wire `<till-menu-switcher>` above the grid on both screens (a new layout region or the screen header), handling `menu-selected` → `this.selectedCatalogueId = e.detail.id`.

- [ ] **Step 5: Screen test** — extend the counter/table-order (or app) test: two menus load, the grid shows only the default's products, selecting the second menu re-filters, an in-flight cart line survives the switch. Guard-by-deletion: remove the `.filter` and watch the "shows only default" assertion fail.

- [ ] **Step 6: Run** — `pnpm --filter @waitron/till test:coverage`. PASS. (Browser package thresholds 95/95/90/88.)
- [ ] **Step 7: Commit** — `git commit -s -m "feat(till): live menu switcher over a location's accessible menus"`

---

## PHASE 2 — Demo-restaurant seed

### Task 6: seed module scaffold + menu data + `seed-catalogue`

**Files:**
- Create: `apps/server/scripts/demo-seed/menu.ts`, `apps/server/scripts/demo-seed/seed-catalogue.ts`
- Test: `apps/server/scripts/demo-seed/seed-catalogue.test.ts`

**Interfaces:**
- Produces:
  - `type SeedLocale = "en-GB" | "es-ES";`
  - `menu.ts`: `CASA_DELGADO: SeedCatalogue`, `MENU_DEL_DIA: SeedCatalogue` where `SeedCatalogue = { name: Record<SeedLocale,string>; categories: SeedCategory[] }`, `SeedCategory = { name: Record<SeedLocale,string>; station: "kitchen" | "bar" | null; products: SeedProduct[] }`, `SeedProduct = { descriptions: Record<SeedLocale,string>; pricingUnit: PricingUnit; unitPrice: string; vatClass: VatClass; image: string }` (`image` = the committed PNG basename, Task 9).
  - `seedCatalogues(tx, { locationId, locale, stationIds }): Promise<{ productsByImage: Map<string,string> }>` — creates both catalogues + categories + products, routes categories to stations, sets Casa Delgado as the location default (`assignCatalogueToLocation`) and adds Menú del Día via `addCatalogueToLocation`; returns a map from image basename → created product id (for the sales generator + media).

- [ ] **Step 1: Author the menu data** (`menu.ts`) — content per spec §4.2. Provide the FULL `CASA_DELGADO` (~8 categories, ~35-45 products) and `MENU_DEL_DIA` (~5 items), each `descriptions` carrying both `en-GB` and `es-ES`. This is demo content, so exact dishes are the author's; a representative row:

```ts
// apps/server/scripts/demo-seed/menu.ts
export const CASA_DELGADO: SeedCatalogue = {
  name: { "en-GB": "Casa Delgado", "es-ES": "Casa Delgado" },
  categories: [
    { name: { "en-GB": "Charcuterie", "es-ES": "Charcutería" }, station: "kitchen", products: [
      { descriptions: { "en-GB": "Sliced Iberian ham (per kg)", "es-ES": "Jamón ibérico cortado (por kg)" },
        pricingUnit: "weight", unitPrice: "89.00", vatClass: "reduced", image: "jamon-iberico.png" },
      // …chorizo, lomo, salchichón
    ]},
    { name: { "en-GB": "Drinks", "es-ES": "Bebidas" }, station: "bar", products: [
      { descriptions: { "en-GB": "Glass of house red", "es-ES": "Copa de vino tinto de la casa" },
        pricingUnit: "each", unitPrice: "3.50", vatClass: "general", image: "vino-tinto.png" },
      // …water (reduced), coffee (general), beer (general)
    ]},
    // …Cheeses, Conservas (kitchen); Tapas, Raciones, Mains, Desserts (kitchen)
  ],
};
export const MENU_DEL_DIA: SeedCatalogue = { /* name + ~5 each-priced courses, both locales */ };
```

- [ ] **Step 2: Write the failing `seedCatalogues` test** (real Postgres, provision a venue fixture first):

```ts
it("creates both menus, sets the default, makes the second accessible", async () => {
  // provision a venue → { tenantId, locationId, ... }, seed a "kitchen"/"bar" station map
  const res = await withTenant(db(), tenantId, async (tx) => {
    await asAppUser(tx);
    const out = await seedCatalogues(tx, { locationId, locale: "en-GB", stationIds });
    const menus = await listAccessibleCatalogues(tx, locationId);
    const products = await listAvailableProducts(tx, locationId);
    return { out, menus, products };
  });
  expect(res.menus.map((m) => m.name)).toEqual(["Casa Delgado", "Menú del Día"]); // default first
  expect(res.menus.find((m) => m.name === "Casa Delgado")!.isDefault).toBe(true);
  expect(res.products.length).toBeGreaterThan(35);
  expect(res.products.some((p) => p.descriptions["en-GB"] === "Sliced Iberian ham (per kg)")).toBe(true);
});
```

- [ ] **Step 3: Run, watch fail** — `pnpm --filter @waitron/server test seed-catalogue` → FAIL.

- [ ] **Step 4: Implement `seedCatalogues`** — loop the data through `createCatalogue`/`createCategory`/`createProduct` (picking `descriptions: { [locale]: cat/product[locale] }`); after creating a category, if `station !== null` set its route with a parameterised update:

```ts
await tx.execute(sql`update categories set station_id = ${stationIds[cat.station]} where id = ${category.id}`);
```

Set Casa Delgado default via `assignCatalogueToLocation(tx, locationId, casaId)`, add Menú del Día via `addCatalogueToLocation(tx, locationId, diaId)`. Build the image→productId map as you create products.

- [ ] **Step 5: Run** — `pnpm --filter @waitron/server test:coverage seed-catalogue`. PASS.
- [ ] **Step 6: Commit** — `git commit -s -m "feat(demo-seed): two-menu catalogue with KDS routing"`

---

### Task 7: `seed-floor` — zones, tables, statuses

**Files:**
- Create: `apps/server/scripts/demo-seed/floor.ts`, `apps/server/scripts/demo-seed/seed-floor.ts`
- Test: `apps/server/scripts/demo-seed/seed-floor.test.ts`

**Interfaces:**
- Consumes: `createZone`, `createTable`, `setTablePlacement` from `apps/server/src/tables.ts` (each `(tx, cfg, …)` with `cfg = { tenantId, locationId }`).
- Produces: `seedFloor(tx, cfg): Promise<void>` — 3 zones (Comedor/Terraza/Barra), ~16 placed tables with capacities, 4 `table_service_statuses`.

- [ ] **Step 1: Failing test** — after `seedFloor`, assert 3 active zones, ~16 tables each with a `zone_id`, `capacity`, and non-null `pos_x/pos_y/shape`, and 4 statuses. (Read back via `@waitron/db` selects under `withTenant`/`asAppUser`.)
- [ ] **Step 2: Run, watch fail** — `pnpm --filter @waitron/server test seed-floor` → FAIL.
- [ ] **Step 3: Implement** — `floor.ts` holds the typed layout data (zone names both locales, table labels, capacities, `posX/posY/shape/rotation`); `seedFloor` loops `createZone` then `createTable` then `setTablePlacement`; statuses via parameterised `insert into table_service_statuses (tenant_id,label,color,display_order) values (current_tenant_id(), ${label}, ${color}, ${i})` (the CRUD path is session-gated — raw insert per spec §4.3). Labels come from the active `locale`.
- [ ] **Step 4: Run** — `pnpm --filter @waitron/server test:coverage seed-floor`. PASS.
- [ ] **Step 5: Commit** — `git commit -s -m "feat(demo-seed): floor plan with zones, placed tables, statuses"`

---

### Task 8: `seed-staff` — six people, one PIN

**Files:**
- Create: `apps/server/scripts/demo-seed/staff.ts`, `apps/server/scripts/demo-seed/seed-staff.ts`
- Test: `apps/server/scripts/demo-seed/seed-staff.test.ts`

**Interfaces:**
- Consumes: `hashPin` from `@waitron/identity`.
- Produces: `DEMO_PIN = "5555"`; `seedStaff(tx): Promise<void>` — inserts ~5 non-admin persons (roles across `staff`/`supervisor`/`manager`/`admin`) all on `DEMO_PIN`, via parameterised raw insert (`createPerson` is session-gated).

- [ ] **Step 1: Failing test** — after `seedStaff`, assert ≥5 persons exist beyond the provisioned admin, at least one of each of the four roles, and each `pin_hash` verifies against `5555` (use the identity verify helper).
- [ ] **Step 2: Run, watch fail** — FAIL.
- [ ] **Step 3: Implement** — loop `staff.ts` rows: `insert into persons (tenant_id, display_name, pin_hash, role) values (current_tenant_id(), ${name}, ${hashPin(DEMO_PIN)}, ${role})` (role is a fixed enum literal from typed data, never interpolated user input). Names may be localized or plain.
- [ ] **Step 4: Run** — `pnpm --filter @waitron/server test:coverage seed-staff`. PASS.
- [ ] **Step 5: Commit** — `git commit -s -m "feat(demo-seed): staff across all roles on the demo PIN"`

---

### Task 9: `seed-media` — per-dish placeholder images

**Files:**
- Create: `apps/server/scripts/demo-seed/seed-media.ts`, `apps/server/scripts/demo-seed/media/*.png` (committed), a small `apps/server/scripts/demo-seed/gen-media.mjs` authoring helper
- Test: `apps/server/scripts/demo-seed/seed-media.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_MEDIA_ROOT` from `apps/server/src/boot.js`; the `productsByImage` map from Task 6.
- Produces: `seedMedia(tx, { mediaDir, productsByImage }): Promise<void>` — for each committed PNG, read bytes, `sha256`, copy to `<mediaDir>/<sha256>.png`, and `update products set image = <name> where id = <productId>`.

- [ ] **Step 1: Author the tiles** — `gen-media.mjs` rasterises one SVG per product (per-category colour + food glyph + dish name) to PNG under `media/`. Run it once and COMMIT the PNGs (the generator is a dev convenience; the committed PNGs are the source of truth). One PNG per distinct `image` basename referenced in `menu.ts`.
- [ ] **Step 2: Failing test** — real Postgres + a temp `mediaDir`: seed a couple of products with known `image` basenames, run `seedMedia`, assert each product's `image` is now a `^[0-9a-f]{64}\.png$` name, the file exists at `<mediaDir>/<that name>`, and its bytes match the committed source (sha256 equal).
- [ ] **Step 3: Run, watch fail** — FAIL.
- [ ] **Step 4: Implement:**

```ts
import { createHash } from "node:crypto";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { join, basename } from "node:path";
export async function seedMedia(tx, { mediaDir, productsByImage }) {
  const srcDir = fileURLToPath(new URL("media", import.meta.url));
  for (const [imageName, productId] of productsByImage) {
    const bytes = await readFile(join(srcDir, imageName));
    const hashed = createHash("sha256").update(bytes).digest("hex") + ".png";
    await writeFile(join(mediaDir, hashed), bytes);
    await tx.execute(sql`update products set image = ${hashed} where id = ${productId}`);
  }
}
```

The seed's `mediaDir` = `process.env.WAITRON_MEDIA_DIR || DEFAULT_MEDIA_ROOT` (matches `config.mediaDir`, so the dev server serves what the seed wrote). Ensure the dir exists (`mkdir -p`).

- [ ] **Step 5: Run** — `pnpm --filter @waitron/server test:coverage seed-media`. PASS. Confirm the `/media` filename regex (`^[0-9a-f]{64}\.(jpg|png|webp)$`) accepts the produced names.
- [ ] **Step 6: Commit** — `git add -A && git commit -s -m "feat(demo-seed): per-dish placeholder images into the media store"`

---

### Task 10: `seed-sales` — back-dated historical sales

**Files:**
- Create: `apps/server/scripts/demo-seed/seed-sales.ts`
- Test: `apps/server/scripts/demo-seed/seed-sales.test.ts`

**Interfaces:**
- Consumes: `recordSale` (`@waitron/core`), `VerifactuBackend` (`@waitron/fiscal-verifactu`), `deploymentEnvironment` (`../../src/config.js`), `percentOf`/`addDecimal`/branders (`@waitron/shared`); the seeded Casa Delgado products.
- Produces: `seedSales(db, { venue, locale, days, products, clock? }): Promise<{ count: number }>` where `venue = { tenantId, tillId, nodeId, seriesId }`, `days` from `WAITRON_SEED_SALES_DAYS` (default 28, 0 = skip). Each sale: 1-4 lines drawn from `products`, base reversed out of the gross `unitPrice`, one `cash`|`card` tender, `issued_at`/`settled_at` back-dated.

- [ ] **Step 1: Failing test** (real Postgres, provisioned venue + a few products): run `seedSales` for `days: 3` and assert (a) `count > 0`; (b) every `sales.issued_at` is in the past N days; (c) each sale's `entorno` on its `registros_facturacion` row is `preproduction`; (d) `sum(tenders.amount) = sales.total + sum(tip)` for a sampled sale; (e) the reporting VAT summary + cash-up for one seeded day are non-empty. Guard-by-deletion: force `days: 0` and assert `count === 0` and no sales written.

- [ ] **Step 2: Run, watch fail** — FAIL.

- [ ] **Step 3: Implement** — mirror `record-one-sale.ts`'s backend construction, but a back-dating clock:

```ts
function backDatingClock(): { clock: TrustedClock; set: (d: Date, offsetMinutes: number) => void } {
  let instant = new Date(); let offsetMinutes = -instant.getTimezoneOffset();
  const clock: TrustedClock = {
    now: () => ({ instant, offsetMinutes, confident: true, confidence: "anchored", anchorAgeSeconds: 0 }),
    anchor: () => { throw new Error("seed-sales: anchor() unused"); }, currentAnchor: () => null,
  };
  return { clock, set: (d, o) => { instant = d; offsetMinutes = o; } };
}
```

Construct ONE `VerifactuBackend` with `environment`/`deploymentEnvironment: deploymentEnvironment(process.env)` and a throwing `resolveClient` (never called). For each day in the last `days`, generate a per-day count (lunch/dinner peaks, weekends busier), and for each sale: `set(pastInstant, offset)`, pick 1-4 random products, build `lines` where for each line the **base** = `percentOf`-reverse of the gross (`base = round(gross / (1 + rate/100))`), `lineTotal = base`, `vatRate = RATE_FOR[vatClass]`, sum to `total`; one tender `{ method, amount: total, tipAmount: "0.00", settledAt: pastInstant }`; then `await withTenant(db, tenantId, (tx) => recordSale(tx, backend, input))`. `vatRate` per `vatClass`: general 21, reduced 10, super_reduced 4, zero 0.

Use a seeded PRNG (a small deterministic LCG) so the demo is reproducible and the test is stable.

- [ ] **Step 4: Run** — `pnpm --filter @waitron/server test:coverage seed-sales`. PASS.
- [ ] **Step 5: Commit** — `git commit -s -m "feat(demo-seed): back-dated preproduction sales for non-blank reports"`

---

### Task 11: orchestrator + locale flag + wire into `dev-setup`

**Files:**
- Create: `apps/server/scripts/demo-seed/seed.ts`
- Modify: `apps/server/scripts/dev-setup.ts`
- Test: `apps/server/scripts/dev-setup.test.ts` (extend), `apps/server/scripts/demo-seed/seed.test.ts`

**Interfaces:**
- Produces: `seedDemoRestaurant(db, { venue, locale, salesDays }): Promise<void>` — runs `seedCatalogues` → `seedFloor` → `seedStaff` → `seedMedia` (inside one `withTenant`/`asAppUser`) then `seedSales` (its own per-sale tx). Adds `WAITRON_TILL_LOCALE` to `DevEnv`/`ENV_KEYS`.

- [ ] **Step 1: Failing test** — extend `dev-setup.test.ts`: after a fresh `devSetup`, `WAITRON_TILL_LOCALE` is present in the written `.env` and equals `en-GB` by default (or `es-ES` when `WAITRON_SEED_LOCALE=es-ES`); `ADMIN_PIN` is `5555`. A `seed.test.ts` asserts the orchestrator runs all sub-seeds (both menus present, tables present, staff present, ≥1 sale).
- [ ] **Step 2: Run, watch fail** — FAIL.
- [ ] **Step 3: Implement:**
  - `seed.ts`: the orchestrator (venue ids in, seed everything). Resolve seed locale: `const SEED_LOCALE = process.env.WAITRON_SEED_LOCALE === "es-ES" ? "es-ES" : "en-GB";`
  - `dev-setup.ts`: set `ADMIN_PIN = "5555"`. Add `WAITRON_TILL_LOCALE: string` to `DevEnv` + `ENV_KEYS`; set it to `SEED_LOCALE` in the built `env`. Replace the inline catalogue/cashier block in `provisionVenue` with a call to `seedDemoRestaurant(db, { venue: {…}, locale: SEED_LOCALE, salesDays })`, where `salesDays = Number(process.env.WAITRON_SEED_SALES_DAYS ?? "28")`. Set the location's `invoiceLocales` to `[SEED_LOCALE]` in the `planVenue` call. Update the CLI summary to print the demo PIN `5555` and that reports have ~`days` of history.
- [ ] **Step 4: Run** — `pnpm --filter @waitron/server test:coverage dev-setup seed`. PASS.
- [ ] **Step 5: Commit** — `git commit -s -m "feat(demo-seed): orchestrator, English default + Spanish flag, dev-setup wiring"`

---

### Task 12: end-to-end integration + backlog

**Files:**
- Create: `apps/server/scripts/demo-seed/seed.integration.test.ts`
- Modify: `docs/backlog.md`

- [ ] **Step 1: Failing integration test** (real Postgres) — migrate + provision + `seedDemoRestaurant`, then assert: reporting VAT summary / cash-up / counts for a seeded day are all non-empty; `listAccessibleCatalogues` returns both menus (default first); `listAvailableProducts` includes products from both; a sampled product's `image` resolves to an existing `<mediaDir>/<sha256>.png`; a working order that mixes a Casa Delgado item and a Menú del Día item parks and retrieves without `sale.unknown_product`.
- [ ] **Step 2: Run, watch fail then pass** — implement nothing new; this test composes Tasks 1-11. Fix any integration gaps it exposes.
- [ ] **Step 3: Full gate** — from repo root: `pnpm lint && pnpm typecheck && pnpm format:check`; then `pnpm --filter @waitron/db --filter @waitron/catalogue --filter @waitron/server --filter @waitron/till test:coverage`; then `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad`. All green.
- [ ] **Step 4: Update `docs/backlog.md`** — move Tier A #1 (seed) to *What's built* (SP18 / demo), note the multi-menu foundation landed (part of Tier B #8: location default + accessible catalogues + live till switch), record the remaining Tier B #8 follow-ups (a dashboard route to manage `location_catalogues` membership; per-till persisted selection). Keep it state-not-history.
- [ ] **Step 5: Commit** — `git commit -s -m "test(demo-seed): end-to-end seed + reporting integration; backlog"`

---

## Self-Review

**Spec coverage:** §3.1 accessible model → Task 1-3; §3.2 union read → Task 2; §3.3 park/retrieve union + mixing → Task 2/5/12; §3.4 switcher → Task 5; §4.1 two catalogues → Task 6; §4.2 menu + KDS routing → Task 6; §4.3 floor → Task 7; §4.4 staff PIN 5555 → Task 8; §4.5 images → Task 9; §5 back-dated sales → Task 10; §6 locale → Task 11; §7 module layout + dev-setup → Task 11; §8 testing → each task + Task 12; §9 fiscal safety → Task 10 (preproduction, no drain). All covered.

**Type consistency:** `AvailableProduct` gains `catalogueId`/`catalogueName` in Task 2 and is consumed unchanged (extra fields) by priceBasket and Task 4/5; `AccessibleCatalogue { id, name, isDefault }` defined Task 3, consumed Task 4/5; `{ menus, products }` response defined Task 4, consumed Task 5; `productsByImage: Map<string,string>` produced Task 6, consumed Task 9; `venue = { tenantId, tillId, nodeId, seriesId }` produced by `provisionVenue`, consumed Task 10/11. Consistent.

**Placeholders:** menu/floor/staff CONTENT (dish lists, table layout, names) is deliberately author-filled demo data with exact types + representative rows given — not logic placeholders. All logic steps carry real code and exact commands.
