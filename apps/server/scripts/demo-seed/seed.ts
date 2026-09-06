import { tenantId as brandTenantId } from "@waitron/shared";
// `seedDemoRestaurant` — the demo-seed orchestrator (Phase 2, Task 11). It wires the Task 6-10
// sub-seeds together into the one call `dev-setup` makes after provisioning a venue, turning a bare
// chained venue into the full demo restaurant: two menus, a floor plan, staff, per-dish media, and a
// back-fill of historical preproduction sales.
//
// TRANSACTION SHAPE (deliberate, matches each sub-seed's own header):
//   - `seedCatalogues` → `seedFloor` → `seedStaff` → `seedMedia` all run inside ONE
//     `withTenant(db, tenantId, asAppUser)` transaction: they write under the tenant GUC as `app_user`,
//     exactly as the running POS does, and share the image→product map `seedCatalogues` returns.
//   - `seedSales` is called AFTER that transaction commits, with `db` (NOT the tx): it opens its OWN
//     per-sale `withTenant` for each `recordSale`, so it must see the catalogue/products the first tx
//     committed. Running it inside the shared tx would nest transactions and hide those rows from its
//     fresh connections.
//
// FISCAL POSTURE (CLAUDE.md §5): `seedSales` writes IMMUTABLE preproduction `registros_facturacion`
// rows through `recordSale` and never drains — this orchestrator only passes `salesDays` through and
// adds nothing to that path. `WAITRON_ENV` unset resolves to `preproduction` (the safe default);
// dev-setup's guards keep this off any production database.
//
// `mediaDir` is resolved here (the one place that knows both the seed and the server's media store):
// `WAITRON_MEDIA_DIR` if set, else boot's `DEFAULT_MEDIA_ROOT` — the exact path the running dev server
// serves `GET /media/:filename` from, so the tiles seedMedia writes are the ones the till renders.

import { asAppUser, withTenant } from "@waitron/db";
import type { Database } from "@waitron/db";
import { listAvailableProducts } from "@waitron/catalogue";
import { DEFAULT_MEDIA_ROOT } from "../../src/boot.js";
import { seedCatalogues } from "./seed-catalogue.js";
import { seedFloor } from "./seed-floor.js";
import { seedStaff } from "./seed-staff.js";
import { seedMedia } from "./seed-media.js";
import { seedOptions } from "./seed-options.js";
import { seedSales } from "./seed-sales.js";
import type { SeedSalesProduct } from "./seed-sales.js";
import type { SeedLocale } from "./menu.js";

/** The provisioned venue's ids the orchestrator threads into the sub-seeds — the shape `applyVenue`
 *  returns (with `seriesId` picked from its `seriesIds`, the standard series being first). */
export interface SeedDemoVenue {
  tenantId: string;
  tillId: string;
  nodeId: string;
  seriesId: string;
  locationId: string;
}

export interface SeedDemoInput {
  venue: SeedDemoVenue;
  /** The BARE content locale every menu/floor/status is authored under; each sale is filed under the
   *  FULL tag it maps to (`SEED_INVOICE_LOCALE`) — content authored bare, filed full (feature B). */
  locale: SeedLocale;
  /** How many trailing days of historical sales to back-fill. `0` seeds no sales (the catalogue,
   *  floor, staff and media still seed). */
  salesDays: number;
}

/**
 * Seed the whole demo restaurant onto an already-provisioned venue: catalogues, floor, staff and
 * media inside one tenant/`app_user` transaction, then the historical sales on their own connections.
 */
export async function seedDemoRestaurant(
  db: Database,
  { venue, locale, salesDays }: SeedDemoInput,
): Promise<void> {
  // `||`, not `??`: an empty `WAITRON_MEDIA_DIR=""` is a valid-but-wrong value that must fall back to
  // the default, not be used verbatim (CLAUDE.md §3, "an empty connection string is a valid string").
  const mediaDir = process.env.WAITRON_MEDIA_DIR || DEFAULT_MEDIA_ROOT;
  const { tenantId, locationId } = venue;

  // One tenant/app_user tx for the four in-transaction sub-seeds. `listAvailableProducts` is read at
  // the end, inside the SAME tx, so the sales generator draws from exactly what was just seeded.
  const products = await withTenant(db, tenantId, async (tx) => {
    await asAppUser(tx);
    const { productsByImage } = await seedCatalogues(tx, brandTenantId(tenantId), {
      locationId,
      locale,
    });
    await seedOptions(tx, brandTenantId(tenantId), { productsByImage, locale });
    await seedFloor(tx, { tenantId, locationId, locale });
    await seedStaff(tx);
    await seedMedia(tx, { mediaDir, productsByImage });
    return (await listAvailableProducts(tx, locationId)).products;
  });

  // AFTER the tx commits: seedSales opens its own per-sale `withTenant`, so it must see the committed
  // catalogue. It maps the available products onto the fields the generator needs (id/descriptions/
  // gross unitPrice/vatClass/optionGroups); the rest of `AvailableProduct` is unused here.
  // `optionGroups` carries straight through — `listAvailableProducts` already resolved it from the
  // rows `seedOptions` just wrote, so a product with none reads back `[]` and the generator skips it.
  const salesProducts: SeedSalesProduct[] = products.map((p) => ({
    id: p.id,
    descriptions: p.descriptions,
    unitPrice: p.unitPrice,
    vatClass: p.vatClass,
    optionGroups: p.optionGroups,
  }));

  await seedSales(db, {
    venue: {
      tenantId: venue.tenantId,
      tillId: venue.tillId,
      nodeId: venue.nodeId,
      seriesId: venue.seriesId,
    },
    locale,
    days: salesDays,
    products: salesProducts,
  });
}
