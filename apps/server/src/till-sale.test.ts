import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  diningTables,
  products,
  saleLines,
  sales,
  withTransaction,
  workingOrderLines,
} from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createExtraList,
  createMenuItem,
  createMenuSection,
  createOptionList,
  createProduct,
  listAvailableProducts,
  readContentLanguages,
  setMenuVariants,
  setProductVariants,
  updateProduct,
  writeProductModifiers,
} from "@waitron/catalogue";
import type { AvailableProduct } from "@waitron/catalogue";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import { registrosFacturacion } from "@waitron/fiscal-verifactu";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
// Test-only infra of @waitron/fiscal — the sanctioned deep-import path core's tests and
// `daily-close-demo.ts` already use. Its `recordSale` returns a FiscalRecordRef with NO
// `verificationUrl`, which is how the "empty qr" branch below is exercised at all.
import { FakeFiscalBackend } from "@waitron/fiscal/src/testing/fake-backend.js";
import { hashPassword, hashPin } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import type { VenueResult } from "@waitron/provisioning";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import { deploymentEnvironment } from "./config.js";
import { ALL_MODULES } from "./modules.js";
import type { TillConfig } from "./till-config.js";
import { payWorkingOrder, recordTillSale } from "./till-sale.js";
import {
  addTabRound,
  createOpenOrder,
  openTab,
  updateHeldOrder,
  voidTabLine,
} from "./working-order.js";
import { formatReceipt } from "./receipt-ticket.js";
import { printedLines } from "./testing/decode-ticket.js";
import { offerProducts } from "./testing/zone-offers.js";
import type { ZoneOffers } from "./testing/zone-offers.js";

// Exercise the sale path and the chained fiscal write end to end: provision a venue, seed a
// catalogue, sell, and read the filed record back.
//
// Nothing here establishes what the deployment role, which no longer exists, may read or write.
const LOCALE = "es-ES";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

let backend: FiscalBackend;
let clock: TrustedClock;

/**
 * The wall clock at the moment this process runs, reported as already confident and anchored — the
 * identical stub shape `record-one-sale.ts` documents. `recordSale` reads
 * `now()` once and touches neither `anchor` nor `currentAnchor`.
 */
function systemClock(): TrustedClock {
  return {
    now: () => {
      const instant = new Date();
      return {
        instant,
        offsetMinutes: -instant.getTimezoneOffset(),
        confident: true,
        confidence: "anchored",
        anchorAgeSeconds: 0,
      };
    },
    anchor: () => {
      throw new Error("till-sale.test: anchor() is not used by recordSale");
    },
    currentAnchor: () => null,
  };
}

// `tenants_country_tax_id_key` is unique, so two venues provisioned without a reset between them
// need different NIFs. A local counter, the same shape `provision-till.test.ts`'s `nextNif` uses.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(50_000_000 + nifCounter).padStart(8, "0")}K`;
}

function tillConfigFromVenue(venue: VenueResult): TillConfig {
  return {
    tillId: brandTillId(venue.tillId),
    nodeId: brandNodeId(venue.nodeId),
    // planVenue emits the standard series first, then the rectificative one.
    seriesId: brandSeriesId(venue.seriesIds[0]!),
    locationId: brandLocationId(venue.locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    // No integrated card terminal — the walk-up sale path neither builds nor drives one.
    tipsEnabled: false,
    // The walk-up sale path is mode-agnostic; the provisioned venue defaults to prepay.
    orderFlow: "prepay",
  };
}

/**
 * Stand up a fresh chained venue + registered SIF, then seed a catalogue and read back the
 * sellable products — one `each` product (1.50 gross, general/21%) and one `weight` product
 * (24.90 €/kg, reduced/10%). Each test gets its OWN tenant so the `registros_facturacion` count is
 * that test's alone, order-independent (CLAUDE.md §4).
 */
async function setupVenue(options: { variants?: boolean } = {}): Promise<{
  cfg: TillConfig;
  available: AvailableProduct[];
  zoneId: string;
  waterOfferId: string;
  waterProductId: string;
  variantIds?: { double: string; unavailable: string };
  /** Every product offered at its own price in the counter zone, from a menu of the helper's own. */
  offers: ZoneOffers;
}> {
  const venue = await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: nextNif(),
        legalName: "Deli Test SL",
        location: {
          name: "Sala principal",
          fiscalTerritory: "ES-common",
          invoiceLocales: [LOCALE],
          operationDescription: "Venta en establecimiento",
          addressLine1: "Calle Mayor 1",
          addressLine2: null,
          postalCode: "28013",
          city: "Madrid",
          province: "Madrid",
          timeZone: "Europe/Madrid",
          dayCutover: "05:00",
        },
        tillName: "Caja 1",
        seriesCode: "A",
        rectificativeSeriesCode: "R",
        admin: {
          displayName: "Administradora",
          pinHash: hashPin("1234"),
          passwordHash: hashPassword("dashPass123"),
          email: "owner@example.test",
        },
      },
      ALL_MODULES,
    ),
    { db: suite.db, modules: ALL_MODULES },
  );

  const cfg = tillConfigFromVenue(venue);
  const catalogue = await withTransaction(suite.db, async (tx) => {
    const cat = await createCatalogue(tx, { name: "Delicatessen" });
    const comida = await createCategory(tx, { name: { [LOCALE]: "Comida" } });
    const bebidas = await createCategory(tx, { name: { [LOCALE]: "Bebidas" } });
    await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: comida.id,
      name: "Jamón cortado",
      pricingUnit: "weight",
      unitPrice: "24.90",
      vatClass: "reduced",
    });
    const water = await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: bebidas.id,
      name: "Agua mineral",
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
      kitchenName: "COLD BAR",
    });
    await assignCatalogueToLocation(tx, venue.locationId, cat.id);
    const zone = await tx.execute<{ id: string }>(sql`
      select zone_id as id from zone_service_policies
      where location_id = ${cfg.locationId}
        and is_counter_default`);
    const section = await createMenuSection(tx, {
      menuId: cat.id,
      name: { [LOCALE]: "Bebidas" },
    });
    const offer = await createMenuItem(tx, {
      menuId: cat.id,
      productId: water.id,
      sectionId: section.id,
      grossPrice: "2.25",
    });
    let variantIds: { double: string; unavailable: string } | undefined;
    if (options.variants) {
      const variants = await setProductVariants(
        tx,
        water.id,
        // "Doble" carries all three names and "Fuera" only its staff name, so a frozen line shows the
        // variant's customer text and kitchen name each falling back on its own. The product itself
        // has no customer name, so its own customer text falls back to "Agua mineral".
        [
          {
            name: "Doble",
            customerName: { [LOCALE]: "Doble ración" },
            kitchenName: "DBL",
            image: null,
            unitPrice: "3.20",
            available: true,
          },
          {
            name: "Fuera",
            customerName: null,
            kitchenName: null,
            image: null,
            unitPrice: "3.80",
            available: true,
          },
        ],
        LOCALE,
      );
      await setMenuVariants(tx, offer.id, [
        { variantId: variants[0]!.id, price: "4.10", offered: true },
        { variantId: variants[1]!.id, price: "4.80", offered: false },
      ]);
      variantIds = { double: variants[0]!.id, unavailable: variants[1]!.id };
    }
    await tx.execute(sql`
      insert into zone_menus (zone_id, menu_id)
      values (${zone.rows[0]!.id}, ${cat.id})`);
    await tx.execute(sql`
      update zone_service_policies set default_menu_id = ${cat.id}
      where zone_id = ${zone.rows[0]!.id}`);
    // `preparation_routes.id` names its own value here: the column's default moved client-side to
    // `$defaultFn(newId)` (`packages/venue-service/src/schema/service.ts`), which a raw insert never
    // reaches, and `newId` IS `randomUUID` (`packages/db/src/schema/columns.ts:270`). The insert
    // stays raw because the station is chosen by a subquery.
    await tx.execute(sql`
      insert into preparation_routes (id, location_id, category_id, station_id)
      values (${randomUUID()}, ${cfg.locationId}, ${bebidas.id},
        (select id from kitchen_stations
         where location_id = ${cfg.locationId} and is_default))`);
    return {
      available: (await listAvailableProducts(tx, cfg.locationId)).products,
      zoneId: zone.rows[0]!.id,
      waterOfferId: offer.id,
      waterProductId: water.id,
      variantIds,
    };
  });
  const offers = await withTransaction(suite.db, (tx) => offerProducts(tx, cfg));
  return { cfg, ...catalogue, offers };
}

beforeAll(() => {
  clock = systemClock();
  backend = new VerifactuBackend({
    clock,
    db: suite.db,
    environment: deploymentEnvironment(process.env),
    deploymentEnvironment: deploymentEnvironment(process.env),
    resolveClient: () =>
      Promise.reject(new Error("till-sale.test: resolveClient must never be called by recordSale")),
  });
});

/** The six frozen names a raw read of `working_order_lines` / `sale_lines` hands back — the two
 *  `descriptions` columns as the TEXT the engine stores, because a raw `execute` bypasses the
 *  column's own JSON read mapping (measured 2026-09-22 against `menu_sections.name` in
 *  `catalogue-api.test.ts`, which came back as `{"en":"Drinks",…}` rather than an object). */
type StoredNames = {
  name: string;
  variant_name: string | null;
  kitchen_name: string | null;
  variant_kitchen_name: string | null;
  descriptions: string;
  variant_descriptions: string | null;
};

/** Parse the two JSON columns at the row, leaving every assertion below exactly as it was. The
 *  decode moved out of the driver, not out of the test. */
function decodeNames<T extends StoredNames>(
  row: T,
): Omit<T, "descriptions" | "variant_descriptions"> & {
  descriptions: Record<string, string>;
  variant_descriptions: Record<string, string> | null;
} {
  return {
    ...row,
    descriptions: JSON.parse(row.descriptions) as Record<string, string>,
    variant_descriptions:
      row.variant_descriptions === null
        ? null
        : (JSON.parse(row.variant_descriptions) as Record<string, string>),
  };
}

describe("recordTillSale", () => {
  it("requires an offered variant and freezes its menu price and presentation facts", async () => {
    const { cfg, zoneId, waterOfferId, variantIds } = await setupVenue({ variants: true });
    const deps = { db: suite.db, backend, clock };
    await expect(
      recordTillSale(deps, cfg, {
        zoneId,
        lines: [{ menuItemId: waterOfferId, quantity: "1" }],
        tender: { method: "cash", amount: "4.10" },
      }),
    ).rejects.toMatchObject({ code: "product.variant_required" });
    await expect(
      recordTillSale(deps, cfg, {
        zoneId,
        lines: [{ menuItemId: waterOfferId, variantId: variantIds!.unavailable, quantity: "1" }],
        tender: { method: "cash", amount: "4.80" },
      }),
    ).rejects.toMatchObject({ code: "product.variant_unavailable" });

    const result = await recordTillSale(deps, cfg, {
      zoneId,
      lines: [{ menuItemId: waterOfferId, variantId: variantIds!.double, quantity: "2" }],
      tender: { method: "cash", amount: "8.20" },
    });
    expect(result.total).toBe("8.20");
    // The filed sale line carries the SAME six names as the frozen order line — filing copies the
    // snapshot rather than resolving the catalogue a second time.
    const snapshots = await suite.db.execute<StoredNames & { unit_price_gross?: number | null }>(
      sql`
      -- unit_price_gross counts whole cents, and the assertion below is on that COUNT, not on an
      -- amount. The integer cast that used to sit on this column only normalised node-postgres's
      -- answer to a number; the column is an integer column on this engine and the driver already
      -- hands back a number, so the cast is dropped rather than replaced. The count is unchanged.
      select name, variant_name, kitchen_name, variant_kitchen_name, descriptions,
             variant_descriptions, unit_price_gross
      from working_order_lines
      union all
      select name, variant_name, kitchen_name, variant_kitchen_name, descriptions,
             variant_descriptions, null
      from sale_lines
      order by unit_price_gross nulls last`,
    );
    const names = {
      name: "Agua mineral",
      variant_name: "Doble",
      kitchen_name: "COLD BAR",
      variant_kitchen_name: "DBL",
      descriptions: { [LOCALE]: "Agua mineral" },
      variant_descriptions: { [LOCALE]: "Doble ración" },
    };
    expect(snapshots.rows.map(decodeNames)).toEqual([
      { ...names, unit_price_gross: 410 },
      { ...names, unit_price_gross: null },
    ]);
    // The open order's line names the variant as its product; the filed line keeps the frozen
    // names and no catalogue reference at all (spec decision 11), so neither table has a
    // `variant_id` column.
    const orderLines = await suite.db.execute<{ product_id: string }>(
      sql`select product_id from working_order_lines`,
    );
    expect(orderLines.rows).toEqual([{ product_id: variantIds!.double }]);
    for (const table of ["sale_lines", "working_order_lines"]) {
      const columns = await suite.db.execute<{ name: string }>(
        sql`select name from pragma_table_info(${table})`,
      );
      expect(columns.rows.map((column) => column.name)).not.toContain("variant_id");
    }
  });
  // Spec §15.5: a variant follows its parent onto the menu; with nothing set for it there, it is
  // charged its own price (3.80), neither the parent's menu price (2.25) nor the old override (4.80).
  it("sells a variant this menu sets nothing for at the variant's own price", async () => {
    const { cfg, zoneId, waterOfferId, variantIds } = await setupVenue({ variants: true });
    await withTransaction(suite.db, (tx) => setMenuVariants(tx, waterOfferId, []));
    const result = await recordTillSale({ db: suite.db, backend, clock }, cfg, {
      zoneId,
      lines: [{ menuItemId: waterOfferId, variantId: variantIds!.unavailable, quantity: "1" }],
      tender: { method: "cash", amount: "3.80" },
    });
    expect(result.total).toBe("3.80");
  });

  // Spec §15.1: a product with no Active variant sells as itself, at its menu price.
  it("sells a product whose every variant was removed as itself", async () => {
    const { cfg, zoneId, waterOfferId, waterProductId, variantIds } = await setupVenue({
      variants: true,
    });
    await withTransaction(suite.db, (tx) => setProductVariants(tx, waterProductId, [], LOCALE));
    const deps = { db: suite.db, backend, clock };
    await expect(
      recordTillSale(deps, cfg, {
        zoneId,
        lines: [{ menuItemId: waterOfferId, variantId: variantIds!.double, quantity: "1" }],
        tender: { method: "cash", amount: "4.10" },
      }),
    ).rejects.toMatchObject({ code: "product.variant_unavailable" });
    const result = await recordTillSale(deps, cfg, {
      zoneId,
      lines: [{ menuItemId: waterOfferId, quantity: "1" }],
      tender: { method: "cash", amount: "2.25" },
    });
    expect(result.total).toBe("2.25");
  });

  it("prints the variant on the receipt line that identifies the goods (art. 7.1.e)", async () => {
    const { cfg, zoneId, waterOfferId, variantIds } = await setupVenue({ variants: true });
    const result = await recordTillSale({ db: suite.db, backend, clock }, cfg, {
      zoneId,
      lines: [{ menuItemId: waterOfferId, variantId: variantIds!.double, quantity: "1" }],
      tender: { method: "cash", amount: "4.10" },
    });

    // Straight from the filed sale into the REAL receipt formatter, so this is the paper a customer
    // is handed. RD 1619/2012 art. 7.1.e is the identification of the goods: a 4.10 line that reads
    // only "Agua mineral" does not say which size was sold, and the price makes sense only with it.
    const paper = printedLines(
      formatReceipt({
        result,
        issuer: { venueName: "Deli Test SL", nif: "B12345678" },
        receipt: {},
        invoiceLocale: LOCALE,
        printer: {
          paperWidth: "80mm",
          resolution: "203dpi",
          characterSet: "pc858",
          characterTable: 19,
        },
      }),
    ).join("\n");
    expect(result.lines[0]!.descriptions).toEqual({ [LOCALE]: "Doble ración" });
    expect(paper).toContain("Doble ración");
    expect(paper).not.toContain("Agua mineral");
  });

  it("keeps distinct variants and their parked facts after live catalogue edits", async () => {
    const { cfg, zoneId, waterOfferId, waterProductId, variantIds } = await setupVenue({
      variants: true,
    });
    const workingOrderId = randomUUID();
    await withTransaction(suite.db, async (tx) => {
      await setMenuVariants(tx, waterOfferId, [
        { variantId: variantIds!.double, price: "4.10", offered: true },
        { variantId: variantIds!.unavailable, price: "4.80", offered: true },
      ]);
      await createOpenOrder(
        tx,
        cfg,
        workingOrderId,
        [
          { menuItemId: waterOfferId, variantId: variantIds!.double, quantity: "1" },
          { menuItemId: waterOfferId, variantId: variantIds!.unavailable, quantity: "1" },
        ],
        null,
        { zoneId },
      );
      await updateProduct(tx, waterProductId, {
        name: "Agua renombrada",
        kitchenName: "NEW BAR",
        unitPrice: "99.00",
      });
      await setProductVariants(
        tx,
        waterProductId,
        [
          {
            id: variantIds!.double,
            name: "Doble nuevo",
            customerName: null,
            kitchenName: null,
            image: null,
            unitPrice: "30.00",
            available: true,
          },
          {
            id: variantIds!.unavailable,
            name: "Fuera nuevo",
            customerName: null,
            kitchenName: null,
            image: null,
            unitPrice: "40.00",
            available: true,
          },
        ],
        LOCALE,
      );
      await setMenuVariants(tx, waterOfferId, [
        { variantId: variantIds!.double, price: "31.00", offered: true },
        { variantId: variantIds!.unavailable, price: "41.00", offered: true },
      ]);
    });

    const result = await payWorkingOrder({ db: suite.db, backend, clock }, cfg, {
      id: workingOrderId,
      lines: [],
      tender: { method: "cash", amount: "8.90" },
    });
    expect(result.total).toBe("8.90");
    const stored = await suite.db.execute<StoredNames>(sql`
      select name, variant_name, kitchen_name, variant_kitchen_name, descriptions,
             variant_descriptions
      from sale_lines
      order by line_no`);
    expect(stored.rows.map(decodeNames)).toEqual([
      {
        name: "Agua mineral",
        variant_name: "Doble",
        kitchen_name: "COLD BAR",
        variant_kitchen_name: "DBL",
        descriptions: { [LOCALE]: "Agua mineral" },
        variant_descriptions: { [LOCALE]: "Doble ración" },
      },
      {
        name: "Agua mineral",
        variant_name: "Fuera",
        kitchen_name: "COLD BAR",
        variant_kitchen_name: null,
        descriptions: { [LOCALE]: "Agua mineral" },
        variant_descriptions: { [LOCALE]: "Fuera" },
      },
    ]);
  });
  it("files a walk-up from the selected zone's menu price and stores its attribution", async () => {
    const { cfg, zoneId, waterOfferId } = await setupVenue();

    const result = await recordTillSale({ db: suite.db, backend, clock }, cfg, {
      zoneId,
      lines: [{ menuItemId: waterOfferId, quantity: "2" }],
      tender: { method: "cash", amount: "5.00" },
    });

    expect(result.total).toBe("4.50");
    const snapshots = await suite.db.execute<{
      zone_id: string;
      menu_item_id: string;
      menu_name: string;
      department_name: string;
    }>(sql`
      select o.zone_id, l.menu_item_id, l.menu_name, l.department_name
      from order_service_contexts o
      join working_order_lines w on w.working_order_id = o.working_order_id
      join working_line_contexts l on l.working_order_line_id = w.id
      where o.location_id = ${cfg.locationId}`);
    expect(snapshots.rows).toEqual([
      {
        zone_id: zoneId,
        menu_item_id: waterOfferId,
        menu_name: "Delicatessen",
        department_name: "Venue",
      },
    ]);
    const prep = await suite.db.execute<{ count: number }>(sql`
      select cast(count(*) as integer) as count from ticket_items
      `);
    expect(prep.rows).toEqual([{ count: 1 }]);
  });

  // Spec §15.3's last step: a menu that sets no price sells the product at its own (1.50), never
  // at the old menu price (2.25) and never at nothing.
  it("files a walk-up from a blank menu price at the product's own price", async () => {
    const { cfg, zoneId, waterOfferId } = await setupVenue();
    await withTransaction(suite.db, (tx) =>
      tx.execute(sql`update menu_items set gross_price = null where id = ${waterOfferId}`),
    );

    const result = await recordTillSale({ db: suite.db, backend, clock }, cfg, {
      zoneId,
      lines: [{ menuItemId: waterOfferId, quantity: "2" }],
      tender: { method: "cash", amount: "5.00" },
    });

    expect(result.total).toBe("3.00");
  });

  it("walk-up: prices the sent basket authoritatively and files a chained immediate cash sale", async () => {
    const { cfg, available, zoneId, offers } = await setupVenue();
    const each = available.find((p) => p.pricingUnit === "each")!; // 1.50 general(21%)

    const result = await recordTillSale({ db: suite.db, backend, clock }, cfg, {
      zoneId,
      lines: [{ menuItemId: offers.offerFor(each.id), quantity: "2" }],
      tender: { method: "cash", amount: "5.00" },
    });

    expect(result.total).toBe("3.00");
    expect(result.tender).toEqual({ method: "cash", change: "2.00" }); // 5.00 tendered − 3.00
    expect(result.invoiceNumber).toMatch(/^A\/\d+$/);
    expect(result.vatBreakdown).toEqual([{ rate: "21.00", base: "2.48", tax: "0.52" }]);
    expect(result.issuedAt).toMatch(/^\d{4}-\d\d-\d\dT/); // ISO-8601 instant
    expect(typeof result.qr).toBe("string"); // regime verification URL (may be empty)
    const prep = await suite.db.execute<{ count: number }>(sql`
      select cast(count(*) as integer) as count from ticket_items
      `);
    expect(prep.rows).toEqual([{ count: 1 }]);

    // A genuine chained fiscal record exists — one for this tenant's single sale.
    const rows = await withTransaction(suite.db, async (tx) => {
      return tx.select().from(registrosFacturacion);
    });
    expect(rows.length).toBe(1);
  });

  it("ignores a browser-sent price — it only reads menuItemId + quantity", async () => {
    const { cfg, available, zoneId, offers } = await setupVenue();
    const each = available.find((p) => p.pricingUnit === "each")!;

    // TillSaleRequest.lines has no price field; sending an extra `unitPrice` cast `as any` must not
    // change the filed total — the server re-reads the catalogue and prices authoritatively.
    const result = await recordTillSale({ db: suite.db, backend, clock }, cfg, {
      zoneId,
      lines: [
        { menuItemId: offers.offerFor(each.id), quantity: "1", unitPrice: "0.01" } as unknown as {
          menuItemId: string;
          quantity: string;
        },
      ],
      tender: { method: "cash", amount: "1.50" },
    });

    expect(result.total).toBe("1.50"); // 1 × 1.50 gross, NOT the browser's 0.01
    expect(result.tender).toEqual({ method: "cash", change: "0.00" });
  });

  it("rejects an empty basket, an unknown offer, an unsupported tender, and a shortfall", async () => {
    const { cfg, available, zoneId, offers } = await setupVenue();
    const each = available.find((p) => p.pricingUnit === "each")!;
    const UUID_NOT_IN_CAT = "00000000-0000-0000-0000-000000000000";
    const deps = { db: suite.db, backend, clock };

    await expect(
      recordTillSale(deps, cfg, { zoneId, lines: [], tender: { method: "cash", amount: "0" } }),
    ).rejects.toMatchObject({ code: "sale.empty_basket" });

    await expect(
      recordTillSale(deps, cfg, {
        zoneId,
        lines: [{ menuItemId: UUID_NOT_IN_CAT, quantity: "1" }],
        tender: { method: "cash", amount: "1" },
      }),
    ).rejects.toMatchObject({
      code: "service_zone.offer_not_allowed",
      params: { menuItemId: UUID_NOT_IN_CAT, zoneId },
    });

    // cash and card are supported (7a cash + this slice's manual card); every other tender_method is
    // still refused. The `as unknown` cast is how an untrusted till sends one past the widened type.
    for (const method of ["voucher", "transfer", "other"] as const) {
      await expect(
        recordTillSale(deps, cfg, {
          zoneId,
          lines: [{ menuItemId: offers.offerFor(each.id), quantity: "1" }],
          tender: { method: method as unknown as "cash", amount: "1.50" },
        }),
      ).rejects.toMatchObject({ code: "sale.unsupported_tender", params: { method } });
    }

    // Under-tender: 1.00 tendered against a 1.50 total. `settleSale` (inside recordSale's immediate
    // mode) raises `sale.tender_shortfall`; the whole transaction rolls back.
    await expect(
      recordTillSale(deps, cfg, {
        zoneId,
        lines: [{ menuItemId: offers.offerFor(each.id), quantity: "1" }],
        tender: { method: "cash", amount: "1.00" },
      }),
    ).rejects.toMatchObject({ code: "sale.tender_shortfall" });
  });

  it("returns an empty qr when the fiscal backend offers no verification url", async () => {
    // `TillSaleResult.qr` defaults to "" when the regime offers no verification link
    // (`FiscalRecordRef.verificationUrl` is optional). `VerifactuBackend` always sets one, so this
    // uses `FakeFiscalBackend` — a real test double writing through the caller's transaction — whose
    // records carry none. It exercises the same `recordSale` write path (real sale/lines/tenders/
    // settlement rows), only the fiscal record's own link is absent.
    const { cfg, available, zoneId, offers } = await setupVenue();
    const each = available.find((p) => p.pricingUnit === "each")!;

    await FakeFiscalBackend.install(suite.db);
    const fake = new FakeFiscalBackend(suite.db);
    await withTransaction(suite.db, async (tx) => {
      await fake.registerNode(tx, cfg.nodeId);
    });

    const result = await recordTillSale({ db: suite.db, backend: fake, clock }, cfg, {
      zoneId,
      lines: [{ menuItemId: offers.offerFor(each.id), quantity: "1" }],
      tender: { method: "cash", amount: "1.50" },
    });

    expect(result.qr).toBe("");
    expect(result.total).toBe("1.50");
    expect(result.invoiceNumber).toMatch(/^A\/\d+$/);
  });
});

/**
 * Feature B: catalogue content is authored under the BARE language tag (`es` = "our Spanish"), and a
 * write-side transform (`toInvoiceLineDescriptions`, wired into `priceOrderLines`) re-keys it to the
 * location's full-tag `invoice_locales` at the single point content enters a fiscal line — so the
 * `working_order_lines_check_locales` trigger (which requires the per-line `descriptions` map to hold
 * EXACTLY the venue's `invoice_locales`) passes on the insert, and the same re-keyed `priced` flows on
 * to `sale_lines`. Like the sales above, the trigger and the chained record are the point. A bare-`es` product on a `{es-ES}` venue would otherwise be REJECTED by the trigger.
 */
describe("priceOrderLines re-keys bare catalogue content to the venue invoice_locales", () => {
  // `customerName` is the per-language text the re-key acts on. The staff `name` is deliberately a
  // string no assertion expects, so a line that fell back to it instead of re-keying the customer
  // name would fail rather than pass by coincidence.
  async function setupBareVenue(
    invoiceLocales: string[],
    customerName: Record<string, string>,
  ): Promise<{ cfg: TillConfig; zoneId: string; menuItemId: string }> {
    const venue = await applyVenue(
      planVenue(
        {
          country: "ES",
          taxId: nextNif(),
          legalName: "Deli Bare SL",
          location: {
            name: "Sala principal",
            fiscalTerritory: "ES-common",
            invoiceLocales,
            operationDescription: "Venta en establecimiento",
            addressLine1: "Calle Mayor 1",
            addressLine2: null,
            postalCode: "28013",
            city: "Madrid",
            province: "Madrid",
            timeZone: "Europe/Madrid",
            dayCutover: "05:00",
          },
          tillName: "Caja 1",
          seriesCode: "A",
          rectificativeSeriesCode: "R",
          admin: {
            displayName: "Administradora",
            pinHash: hashPin("1234"),
            passwordHash: hashPassword("dashPass123"),
            email: "owner@example.test",
          },
        },
        ALL_MODULES,
      ),
      { db: suite.db, modules: ALL_MODULES },
    );
    const cfg = tillConfigFromVenue(venue);
    const productId = await withTransaction(suite.db, async (tx) => {
      const cat = await createCatalogue(tx, { name: "Delicatessen" });
      const bebidas = await createCategory(tx, { name: { [LOCALE]: "Bebidas" } });
      const product = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: bebidas.id,
        name: "Bare staff name",
        customerName,
        pricingUnit: "each",
        unitPrice: "1.50",
        vatClass: "general",
      });
      await assignCatalogueToLocation(tx, venue.locationId, cat.id);
      return product.id;
    });
    const offers = await withTransaction(suite.db, (tx) => offerProducts(tx, cfg));
    return { cfg, zoneId: offers.zoneId, menuItemId: offers.offerFor(productId) };
  }

  it("re-keys bare `es` to full-tag `es-ES` — reading invoice_locales FRESH from the DB, not cfg", async () => {
    // The venue's DB `invoice_locales` is {es-ES}; the catalogue product carries BARE `es`. We
    // deliberately DRIFT `cfg.invoiceLocales` to a WRONG value — if the re-key read cfg (env-derived)
    // rather than the DB, it would produce `ca-ES` and the trigger (checking the DB's {es-ES}) would
    // REJECT the insert. That it succeeds with `es-ES` proves the re-key reads the location fresh.
    const { cfg, zoneId, menuItemId } = await setupBareVenue(["es-ES"], { es: "Café" });
    const driftedCfg: TillConfig = { ...cfg, invoiceLocales: ["ca-ES"], locale: "ca-ES" };
    const workingOrderId = randomUUID();

    const result = await payWorkingOrder({ db: suite.db, backend, clock }, driftedCfg, {
      id: workingOrderId,
      zoneId,
      lines: [{ menuItemId, quantity: "1" }],
      tender: { method: "cash", amount: "1.50" },
    });
    expect(result.invoiceNumber).toMatch(/^A\/\d+$/);

    const { woLines, slLines } = await withTransaction(suite.db, async (tx) => {
      const woLines = await tx
        .select({ descriptions: workingOrderLines.descriptions })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, workingOrderId));
      const [sale] = await tx
        .select({ id: sales.id })
        .from(sales)
        .where(eq(sales.workingOrderId, workingOrderId));
      const slLines = await tx
        .select({ descriptions: saleLines.descriptions })
        .from(saleLines)
        .where(eq(saleLines.saleId, sale!.id));
      return { woLines, slLines };
    });

    // The working_order_lines insert SUCCEEDED (the trigger would reject bare `es`) with the re-keyed map…
    expect(woLines).toHaveLength(1);
    expect(woLines[0]!.descriptions).toEqual({ "es-ES": "Café" });
    // …and the same re-keyed `priced` flowed on to the filed sale_lines.
    expect(slLines).toHaveLength(1);
    expect(slLines[0]!.descriptions).toEqual({ "es-ES": "Café" });
  });

  it("re-keys a bilingual bare product to both venue locales", async () => {
    const { cfg, zoneId, menuItemId } = await setupBareVenue(["es-ES", "ca-ES"], {
      es: "Café",
      ca: "Cafè",
    });
    const workingOrderId = randomUUID();

    await payWorkingOrder({ db: suite.db, backend, clock }, cfg, {
      id: workingOrderId,
      zoneId,
      lines: [{ menuItemId, quantity: "1" }],
      tender: { method: "cash", amount: "1.50" },
    });

    const lines = await withTransaction(suite.db, async (tx) => {
      return tx
        .select({ descriptions: workingOrderLines.descriptions })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, workingOrderId));
    });
    expect(lines[0]!.descriptions).toEqual({ "es-ES": "Café", "ca-ES": "Cafè" });
  });
});

/**
 * Ordering extras and options: the till rings a dish answering the extras and options lists it
 * attaches, and `priceOrderLines` expands each picked extra into a CHILD line under the dish's
 * PARENT line, validating every answer server-side (the client is never the gate). These are the
 * fiscal-adjacent invariants — a filed order carries parent + child `sale_lines`, and a
 * parked-then-paid one re-prices its children from their add-time lock to the same total/desglose.
 * Like the sales above, the chained record and the self-referential `parent_line_id` are the point.
 */
describe("ordering extras and options — parent + child lines", () => {
  interface ModifierVenue {
    cfg: TillConfig;
    /** The counter-default zone, which offers every product at its own price. */
    zoneId: string;
    /** A second zone, `table_tab`, offering the same menu, for the tabs' dining tables. */
    tablesZoneId: string;
    /** The offer of a product in either zone — both zones share one menu. */
    offerFor: (productId: string) => string;
    burgerId: string;
    menuProductId: string;
    jamonId: string;
    comboId: string;
    platoId: string;
    baconId: string;
    quesoId: string;
    patatasId: string;
    /** "Extras": Bacon 0.50 at 10%, Queso 0.75 at 21%; at most three picks. */
    extrasListId: string;
    /** "Guarnición": at least two picks, at most three. */
    guarnicionListId: string;
    /** "Tamaño": an active options list, so every Menú line must answer it. */
    sizeListId: string;
    /** "Grande" — an available label of "Tamaño", the one answer these tests send. */
    sizeLabelGrandeId: string;
    /** The venue's default content language, the key every frozen staff-name map is stored under. */
    defaultLanguage: string;
    /** "Salsa": active, with "Alioli" WITHDRAWN and one label still available. */
    salsaListId: string;
    /** "Alioli" — a label the list still carries and no longer offers. */
    salsaLabelId: string;
  }

  /**
   * Stand up a fresh chained venue and seed a catalogue with four `each` dishes and one `weight`
   * product, plus the extras and options lists they attach:
   *  - "Hamburguesa" (each, 9.00 general) + extras "Extras" (min 0, max 3): Bacon 0.50 at the BACON
   *    product's own reduced rate, Queso 0.75 at general.
   *  - "Menú" (each, 12.00 general) + options "Tamaño" (Pequeño / Grande), which must be answered.
   *  - "Jamón" (weight, 24.90 reduced), carrying "Extras" too — a pick on a weighed dish is what the
   *    pricing-unit refusal is about, so the list has to be genuinely offered there.
   *  - "Combo" (each, 8.00 general) + options "Salsa", whose "Alioli" label is withdrawn.
   *  - "Plato" (each, 10.00 general) + extras "Guarnición" (min 2, max 3): Patatas 1.00, Ensalada 1.50.
   *
   * An extra's price is the LIST ITEM's, never the product's own — so every extra product is priced
   * 3.00 of itself, and a child line reading 3.00 would mean the offer was never read.
   */
  async function setupModifierVenue(): Promise<ModifierVenue> {
    const venue = await applyVenue(
      planVenue(
        {
          country: "ES",
          taxId: nextNif(),
          legalName: "Deli Mods SL",
          location: {
            name: "Sala principal",
            fiscalTerritory: "ES-common",
            invoiceLocales: [LOCALE],
            operationDescription: "Venta en establecimiento",
            addressLine1: "Calle Mayor 1",
            addressLine2: null,
            postalCode: "28013",
            city: "Madrid",
            province: "Madrid",
            timeZone: "Europe/Madrid",
            dayCutover: "05:00",
          },
          tillName: "Caja 1",
          seriesCode: "A",
          rectificativeSeriesCode: "R",
          admin: {
            displayName: "Administradora",
            pinHash: hashPin("1234"),
            passwordHash: hashPassword("dashPass123"),
            email: "owner@example.test",
          },
        },
        ALL_MODULES,
      ),
      { db: suite.db, modules: ALL_MODULES },
    );
    const cfg = tillConfigFromVenue(venue);
    const seeded = await withTransaction(suite.db, async (tx) => {
      const { defaultLanguage } = await readContentLanguages(tx, cfg.locale);
      const cat = await createCatalogue(tx, { name: "Delicatessen" });
      const comida = await createCategory(tx, { name: { [LOCALE]: "Comida" } });
      const dish = (
        name: string,
        unitPrice: string,
        vatClass: "general" | "reduced",
        pricingUnit: "each" | "weight" = "each",
      ) =>
        createProduct(tx, {
          catalogueId: cat.id,
          categoryId: comida.id,
          name,
          pricingUnit,
          unitPrice,
          vatClass,
        });
      // The three names carry DIFFERENT text, so a surface reading the wrong one of them fails
      // (CLAUDE.md §3).
      const extraProduct = (name: string, vatClass: "general" | "reduced") =>
        createProduct(tx, {
          catalogueId: cat.id,
          categoryId: comida.id,
          name: `${name} staff`,
          customerName: { [defaultLanguage]: `${name} customer` },
          kitchenName: `${name} kitchen`,
          pricingUnit: "each",
          unitPrice: "3.00",
          vatClass,
        });

      const burger = await dish("Hamburguesa", "9.00", "general");
      const menu = await dish("Menú", "12.00", "general");
      const jamon = await dish("Jamón", "24.90", "reduced", "weight");
      const combo = await dish("Combo", "8.00", "general");
      const plato = await dish("Plato", "10.00", "general");
      const bacon = await extraProduct("Bacon", "reduced");
      const queso = await extraProduct("Queso", "general");
      const patatas = await extraProduct("Patatas", "general");
      const ensalada = await extraProduct("Ensalada", "general");

      const extrasList = await createExtraList(
        tx,
        {
          name: "Extras",
          customerName: null,
          kitchenName: null,
          minPicks: 0,
          maxPicks: 3,
          active: true,
          items: [
            { productId: bacon.id, maxQuantity: 3, preselected: false, price: "0.50" },
            { productId: queso.id, maxQuantity: 1, preselected: false, price: "0.75" },
          ],
        },
        cfg.locale,
      );
      const guarnicionList = await createExtraList(
        tx,
        {
          name: "Guarnición",
          customerName: null,
          kitchenName: null,
          minPicks: 2,
          maxPicks: 3,
          active: true,
          items: [
            { productId: patatas.id, maxQuantity: 1, preselected: false, price: "1.00" },
            { productId: ensalada.id, maxQuantity: 1, preselected: false, price: "1.50" },
          ],
        },
        cfg.locale,
      );
      const sizeList = await createOptionList(
        tx,
        {
          // Six DIFFERENT strings across the list's and the labels' three names, so a surface that
          // prints or files the wrong one of them cannot match (CLAUDE.md §3).
          name: "Tamaño staff",
          customerName: { [defaultLanguage]: "Tamaño customer" },
          kitchenName: "Tamaño kitchen",
          defaultLabelId: null,
          active: true,
          labels: [
            { name: "Pequeño", customerName: null, kitchenName: null, available: true },
            {
              name: "Grande staff",
              customerName: { [defaultLanguage]: "Grande customer" },
              kitchenName: "Grande kitchen",
              available: true,
            },
          ],
        },
        cfg.locale,
      );
      // "Alioli" is WITHDRAWN while the list stays active — the shape a till can still send, because
      // its menu was loaded before the withdrawal. An active list with no available label at all
      // cannot be built here: `parseOptionListInput` refuses it (`options.invalid`, field `labels`),
      // which is where that authoring mistake is now caught.
      const salsaList = await createOptionList(
        tx,
        {
          name: "Salsa",
          customerName: null,
          kitchenName: null,
          defaultLabelId: null,
          active: true,
          labels: [
            { name: "Alioli", customerName: null, kitchenName: null, available: false },
            { name: "Sin salsa", customerName: null, kitchenName: null, available: true },
          ],
        },
        cfg.locale,
      );

      await writeProductModifiers(tx, burger.id, [{ kind: "extras", id: extrasList.id }]);
      await writeProductModifiers(tx, menu.id, [{ kind: "options", id: sizeList.id }]);
      await writeProductModifiers(tx, jamon.id, [{ kind: "extras", id: extrasList.id }]);
      await writeProductModifiers(tx, combo.id, [{ kind: "options", id: salsaList.id }]);
      await writeProductModifiers(tx, plato.id, [{ kind: "extras", id: guarnicionList.id }]);

      await assignCatalogueToLocation(tx, venue.locationId, cat.id);
      return {
        burgerId: burger.id,
        menuProductId: menu.id,
        jamonId: jamon.id,
        comboId: combo.id,
        platoId: plato.id,
        baconId: bacon.id,
        quesoId: queso.id,
        patatasId: patatas.id,
        extrasListId: extrasList.id,
        guarnicionListId: guarnicionList.id,
        sizeListId: sizeList.id,
        sizeLabelGrandeId: sizeList.labels.find((label) => label.name === "Grande staff")!.id,
        defaultLanguage,
        salsaListId: salsaList.id,
        salsaLabelId: salsaList.labels.find((label) => label.name === "Alioli")!.id,
      };
    });
    const { counter, tables } = await withTransaction(suite.db, async (tx) => ({
      counter: await offerProducts(tx, cfg),
      tables: await offerProducts(tx, cfg, { zone: "tables" }),
    }));
    return {
      cfg,
      ...seeded,
      zoneId: counter.zoneId,
      tablesZoneId: tables.zoneId,
      offerFor: counter.offerFor,
    };
  }

  /** One answer to the burger's "Extras" list, in the wire shape every order path takes. */
  const extrasPick = (v: ModifierVenue, picks: { productId: string; quantity: number }[]) => [
    { listId: v.extrasListId, picks },
  ];

  it("counter sale of a dish with two extras files THREE sale_lines with parent/child links", async () => {
    const v = await setupModifierVenue();
    const workingOrderId = randomUUID();

    const result = await recordTillSale({ db: suite.db, backend, clock }, v.cfg, {
      zoneId: v.zoneId,
      lines: [
        {
          menuItemId: v.offerFor(v.burgerId),
          quantity: "1",
          extras: extrasPick(v, [
            { productId: v.baconId, quantity: 1 },
            { productId: v.quesoId, quantity: 1 },
          ]),
        },
      ],
      tender: { method: "cash", amount: "20.00" },
      workingOrderId,
    });

    // 9.00 dish + 0.50 bacon + 0.75 queso = 10.25 gross.
    expect(result.total).toBe("10.25");
    expect(result.tender).toEqual({ method: "cash", change: "9.75" });
    // The receipt line list is parent + both children, each child showing the picked product's
    // CUSTOMER-facing text rather than its staff or kitchen name.
    expect(result.lines).toHaveLength(3);
    expect(result.lines.map((l) => l.descriptions["es-ES"])).toEqual([
      "Hamburguesa",
      "Bacon customer",
      "Queso customer",
    ]);

    const { wol, sl } = await withTransaction(suite.db, async (tx) => {
      const wol = await tx
        .select({
          id: workingOrderLines.id,
          lineNo: workingOrderLines.lineNo,
          productId: workingOrderLines.productId,
          parentLineId: workingOrderLines.parentLineId,
          optionSnapshots: workingOrderLines.optionSnapshots,
        })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, workingOrderId))
        .orderBy(workingOrderLines.lineNo);
      const [sale] = await tx
        .select({ id: sales.id })
        .from(sales)
        .where(eq(sales.workingOrderId, workingOrderId));
      const sl = await tx
        .select({ parentLineId: saleLines.parentLineId })
        .from(saleLines)
        .where(eq(saleLines.saleId, sale!.id));
      return { wol, sl };
    });

    // THREE working_order_lines: one parent (the dish, no parent link), two children (the PICKED
    // product, parent_line_id → the parent's id). A child answers no options list of its own.
    expect(wol).toHaveLength(3);
    const [parent, childBacon, childQueso] = wol;
    expect(parent!.productId).toBe(v.burgerId);
    expect(parent!.parentLineId).toBeNull();
    expect(parent!.optionSnapshots).toEqual([]);

    expect(childBacon!.productId).toBe(v.baconId);
    expect(childBacon!.parentLineId).toBe(parent!.id);
    expect(childBacon!.optionSnapshots).toEqual([]);

    expect(childQueso!.productId).toBe(v.quesoId);
    expect(childQueso!.parentLineId).toBe(parent!.id);
    expect(childQueso!.optionSnapshots).toEqual([]);

    // THREE filed sale_lines too, the two children carrying parent_line_id.
    expect(sl).toHaveLength(3);
    expect(sl.filter((l) => l.parentLineId !== null)).toHaveLength(2);
  });

  it("counter sale of a dish ×2 with a pick ×3 files the child at the COMBINED quantity 6", async () => {
    const v = await setupModifierVenue();
    const workingOrderId = randomUUID();

    const result = await recordTillSale({ db: suite.db, backend, clock }, v.cfg, {
      zoneId: v.zoneId,
      // Two burgers, each carrying Bacon ×3 → the Bacon child is priced dish(2) × pick(3) = 6.
      lines: [
        {
          menuItemId: v.offerFor(v.burgerId),
          quantity: "2",
          extras: extrasPick(v, [{ productId: v.baconId, quantity: 3 }]),
        },
      ],
      tender: { method: "cash", amount: "30.00" },
      workingOrderId,
    });

    // 9.00 × 2 dish = 18.00, plus 0.50 × 6 Bacon = 3.00 → 21.00 gross.
    expect(result.total).toBe("21.00");
    expect(result.lines).toHaveLength(2); // parent + one child (the repeat is a single summed line)

    const { wol, sl } = await withTransaction(suite.db, async (tx) => {
      const wol = await tx
        .select({
          lineNo: workingOrderLines.lineNo,
          productId: workingOrderLines.productId,
          parentLineId: workingOrderLines.parentLineId,
          quantity: workingOrderLines.quantity,
          lineTotal: workingOrderLines.lineTotal,
        })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, workingOrderId))
        .orderBy(workingOrderLines.lineNo);
      const [sale] = await tx
        .select({ id: sales.id })
        .from(sales)
        .where(eq(sales.workingOrderId, workingOrderId));
      const sl = await tx
        .select({
          parentLineId: saleLines.parentLineId,
          quantity: saleLines.quantity,
        })
        .from(saleLines)
        .where(eq(saleLines.saleId, sale!.id))
        .orderBy(saleLines.lineNo);
      return { wol, sl };
    });

    // Parent burger ×2 unchanged; child Bacon at the COMBINED 6, priced 0.50 × 6 = 3.00 gross.
    // Both columns are read straight off the row, so each is the whole number its own scale stores:
    // 300 is that gross in cents, and 2000 and 6000 are the two quantities in thousandths.
    expect(wol).toHaveLength(2);
    expect(wol[0]).toMatchObject({ productId: v.burgerId, parentLineId: null, quantity: 2000 });
    expect(wol[1]!.productId).toBe(v.baconId);
    expect(wol[1]!.quantity).toBe(6000);
    expect(wol[1]!.lineTotal).toBe(300);

    // The FILED child sale_line carries the same combined quantity (fiscal record).
    expect(sl).toHaveLength(2);
    const child = sl.find((l) => l.parentLineId !== null)!;
    expect(child.quantity).toBe(6000);
  });

  /** The six frozen strings one answer to "Tamaño" carries, under the venue's default content
   *  language. Every name differs, so an assertion cannot pass while the wrong one was copied. */
  const grandeSnapshot = (defaultLanguage: string) => ({
    listName: { [defaultLanguage]: "Tamaño staff" },
    listCustomerName: { [defaultLanguage]: "Tamaño customer" },
    listKitchenName: "Tamaño kitchen",
    labelName: { [defaultLanguage]: "Grande staff" },
    labelCustomerName: { [defaultLanguage]: "Grande customer" },
    labelKitchenName: "Grande kitchen",
  });

  /** The filed lines of the one sale this working order produced, in `line_no` order. */
  async function filedLinesOf(workingOrderId: string) {
    return withTransaction(suite.db, async (tx) => {
      const [sale] = await tx
        .select({ id: sales.id })
        .from(sales)
        .where(eq(sales.workingOrderId, workingOrderId));
      return tx
        .select({
          lineNo: saleLines.lineNo,
          name: saleLines.name,
          descriptions: saleLines.descriptions,
          kitchenName: saleLines.kitchenName,
          quantity: saleLines.quantity,
          unitPrice: saleLines.unitPrice,
          vatRate: saleLines.vatRate,
          lineTotal: saleLines.lineTotal,
          parentLineId: saleLines.parentLineId,
          optionSnapshots: saleLines.optionSnapshots,
        })
        .from(saleLines)
        .where(eq(saleLines.saleId, sale!.id))
        .orderBy(saleLines.lineNo);
    });
  }

  /**
   * Sells a Tostada (4.00, super-reduced 4%) with one extra: a variant of Bacon (reduced 10%, 3.00)
   * holding the given price and VAT of its own, or blanks. Three different rates, so a child line
   * taxed at the dish's, the parent's or the variant's own rate each reads differently. The variant
   * carries three names of its own — `<stem> staff`, `<stem> customer`, `<stem> kitchen` — each
   * different from Bacon's and from each other, so a line that takes a name from the wrong product,
   * or the wrong one of the three, fails.
   */
  async function sellVariantAsExtra(own: {
    stem: string;
    unitPrice: number | null;
    vatClass: "general" | null;
  }) {
    const v = await setupModifierVenue();
    const workingOrderId = randomUUID();
    const seeded = await withTransaction(suite.db, async (tx) => {
      const [bacon] = await tx
        .select({ catalogueId: products.catalogueId })
        .from(products)
        .where(eq(products.id, v.baconId));
      const [variant] = await tx
        .insert(products)
        .values({
          catalogueId: bacon!.catalogueId,
          parentId: v.baconId,
          name: `${own.stem} staff`,
          customerName: { [v.defaultLanguage]: `${own.stem} customer` },
          kitchenName: `${own.stem} kitchen`,
          pricingUnit: null,
          unitPrice: own.unitPrice,
          vatClass: own.vatClass,
          dietaryDeclarations: null,
        })
        .returning({ id: products.id });
      const dish = await createProduct(tx, {
        catalogueId: bacon!.catalogueId,
        categoryId: null,
        name: "Tostada",
        pricingUnit: "each",
        unitPrice: "4.00",
        vatClass: "super_reduced",
      });
      const list = await createExtraList(
        tx,
        {
          name: "Encima",
          customerName: null,
          kitchenName: null,
          minPicks: 0,
          maxPicks: 1,
          active: true,
          items: [{ productId: variant!.id, maxQuantity: 1, preselected: false }],
        },
        v.cfg.locale,
      );
      await writeProductModifiers(tx, dish.id, [{ kind: "extras", id: list.id }]);
      const offers = await offerProducts(tx, v.cfg);
      return {
        dishOfferId: offers.offerFor(dish.id),
        listId: list.id,
        variantId: variant!.id,
      };
    });

    const result = await recordTillSale({ db: suite.db, backend, clock }, v.cfg, {
      zoneId: v.zoneId,
      lines: [
        {
          menuItemId: seeded.dishOfferId,
          quantity: "1",
          extras: [
            { listId: seeded.listId, picks: [{ productId: seeded.variantId, quantity: 1 }] },
          ],
        },
      ],
      tender: { method: "cash", amount: "10.00" },
      workingOrderId,
    });
    const child = (await filedLinesOf(workingOrderId)).find((line) => line.parentLineId !== null)!;
    return { total: result.total, child };
  }

  // A variant may be an extras item like any product (Review Focus 1 of the plan,
  // `docs/superpowers/plans/2026-09-23-variants-as-products.md`). One that leaves its VAT and price
  // blank is taxed and priced at its PARENT's, and carries its OWN three names, never Bacon's.
  it("a variant picked as an extra files its parent's VAT and price under its own name", async () => {
    const { total, child } = await sellVariantAsExtra({
      stem: "Bacon doble",
      unitPrice: null,
      vatClass: null,
    });
    // 4.00 dish + 3.00 borrowed from Bacon = 7.00 gross.
    expect(total).toBe("7.00");
    // 3.00 gross at 10% is 2.73 net: 273 in cents, and the rate 1000 in basis points.
    expect(child).toMatchObject({
      name: "Bacon doble staff",
      descriptions: { [LOCALE]: "Bacon doble customer" },
      kitchenName: "Bacon doble kitchen",
      unitPrice: 273,
      vatRate: 1000,
    });
  });

  // ...and one that sets its own keeps them: general 21% and 3.50, not Bacon's 10% and 3.00.
  it("a variant picked as an extra files its OWN VAT and price when it sets them", async () => {
    const { total, child } = await sellVariantAsExtra({
      stem: "Bacon triple",
      unitPrice: 350,
      vatClass: "general",
    });
    // 4.00 dish + 3.50 of its own = 7.50 gross.
    expect(total).toBe("7.50");
    // 3.50 gross at 21% is 2.89 net (3.50 / 1.21 = 2.8926): 289 in cents, the rate 2100.
    expect(child).toMatchObject({ name: "Bacon triple staff", unitPrice: 289, vatRate: 2100 });
  });

  it("a WALK-UP files the dish's options answers onto the dish's own sale_line", async () => {
    const v = await setupModifierVenue();
    const workingOrderId = randomUUID();

    await recordTillSale({ db: suite.db, backend, clock }, v.cfg, {
      zoneId: v.zoneId,
      lines: [
        {
          menuItemId: v.offerFor(v.menuProductId),
          quantity: "1",
          options: [{ listId: v.sizeListId, labelId: v.sizeLabelGrandeId }],
        },
      ],
      tender: { method: "cash", amount: "20.00" },
      workingOrderId,
    });

    // A walk-up never touches the stored lock: it is filed from the live `priceBasketWithOptions`
    // result `createOpenOrder` returns, so the answers have to ride on THAT and not only on the
    // working-order row this same call writes.
    const filed = await filedLinesOf(workingOrderId);
    expect(filed.map((line) => line.optionSnapshots)).toEqual([
      [grandeSnapshot(v.defaultLanguage)],
    ]);
  });

  it("a RETRIEVED order files the options answers its working-order line stored", async () => {
    const v = await setupModifierVenue();
    const workingOrderId = randomUUID();

    await withTransaction(suite.db, async (tx) => {
      await createOpenOrder(
        tx,
        v.cfg,
        workingOrderId,
        [
          {
            menuItemId: v.offerFor(v.menuProductId),
            quantity: "1",
            options: [{ listId: v.sizeListId, labelId: v.sizeLabelGrandeId }],
          },
        ],
        null,
        { zoneId: v.zoneId },
      );
    });

    // The till sends no basket, so this files from `readLockedLines` — the answers reach the sale
    // only if that reader selects `working_order_lines.option_snapshots` and carries it.
    await payWorkingOrder({ db: suite.db, backend, clock }, v.cfg, {
      id: workingOrderId,
      lines: [],
      tender: { method: "cash", amount: "20.00" },
    });

    const filed = await filedLinesOf(workingOrderId);
    expect(filed.map((line) => line.optionSnapshots)).toEqual([
      [grandeSnapshot(v.defaultLanguage)],
    ]);
  });

  it("files an extras pick as a snapshot-only child line, with no catalogue reference on the table", async () => {
    const v = await setupModifierVenue();
    const workingOrderId = randomUUID();

    await recordTillSale({ db: suite.db, backend, clock }, v.cfg, {
      zoneId: v.zoneId,
      lines: [
        {
          menuItemId: v.offerFor(v.burgerId),
          quantity: "2",
          extras: extrasPick(v, [{ productId: v.baconId, quantity: 1 }]),
        },
      ],
      tender: { method: "cash", amount: "30.00" },
      workingOrderId,
    });

    // Bacon is offered at 0.50 by the list and is a 3.00 product in its own right, at its OWN reduced
    // rate where the burger is general — so name, quantity, price and VAT each come from the frozen
    // pick rather than from the catalogue row or the dish. 0.50 gross at 10% is 0.45 net per unit,
    // 0.91 for the two. Every one of these columns is read straight off `sale_lines`, so each is
    // the whole number its own scale stores: 45 and 91 are the amounts in cents, 2000 is two units
    // in thousandths, and 1000 is the 10% rate in basis points.
    const filed = await filedLinesOf(workingOrderId);
    expect(filed).toHaveLength(2);
    const child = filed.find((line) => line.parentLineId !== null)!;
    expect(child).toMatchObject({
      name: "Bacon staff",
      quantity: 2000,
      unitPrice: 45,
      vatRate: 1000,
      lineTotal: 91,
      optionSnapshots: [],
    });

    // The structural half of the same rule (spec decision 11, and `sale_lines`'s own "snapshotted
    // values, never catalogue references" header): there is no column for the picked product at all,
    // so no future write can put one there without this failing first. Same instrument as
    // `packages/fiscal-verifactu/src/write-path.e2e.test.ts`'s note guard.
    const columns = await withTransaction(suite.db, async (tx) => {
      // This engine has no `information_schema`; a table's columns come from the PRAGMA function,
      // the same replacement `configuration-transfer.ts:403` takes. The structural claim is
      // unchanged: an unknown table would yield no rows, and `toContain("option_snapshots")` below
      // would fail first, so an empty answer cannot pass the two `not.toContain` assertions by
      // vacuum.
      const { rows } = await tx.execute<{ column_name: string }>(
        sql`select name as column_name from pragma_table_info('sale_lines')`,
      );
      return rows.map((row) => row.column_name);
    });
    expect(columns).toContain("option_snapshots");
    expect(columns).not.toContain("product_id");
    expect(columns).not.toContain("menu_item_id");
    expect(columns).not.toContain("extra_list_item_id");
  });

  it("park → retrieve → pay re-prices children from their lock to the same total and desglose", async () => {
    const v = await setupModifierVenue();
    const workingOrderId = randomUUID();

    // PARK: persist an OPEN order with parent + child lines, and capture the PREVIEW price its lines
    // were built from (the same authoritative `priceBasketWithOptions` result).
    const preview = await withTransaction(suite.db, async (tx) => {
      const { priced } = await createOpenOrder(
        tx,
        v.cfg,
        workingOrderId,
        [
          {
            menuItemId: v.offerFor(v.burgerId),
            quantity: "1",
            extras: extrasPick(v, [
              { productId: v.baconId, quantity: 1 },
              { productId: v.quesoId, quantity: 1 },
            ]),
          },
        ],
        null,
        { zoneId: v.zoneId },
      );
      return priced;
    });

    // RETRIEVE + PAY: the till sends the parked order's id and NO basket, so payWorkingOrder files from
    // the STORED locked lines (readLockedLines → priceStoredOrder), re-pricing the children from their
    // add-time `unit_price_gross`/`vat_rate` — never a re-read of the catalogue.
    const result = await payWorkingOrder({ db: suite.db, backend, clock }, v.cfg, {
      id: workingOrderId,
      lines: [],
      tender: { method: "cash", amount: "20.00" },
    });

    // The filed total and desglose equal the previewed ones to the céntimo — the fiscal invariant a
    // locked-line filing of a customised order must hold: it never diverges from its preview.
    expect(result.total).toBe(preview.total);
    // `result.vatBreakdown` is `{rate, base, tax}` strings (the ticket shape); the preview's bands
    // carry the same three fields (Decimals are branded strings), so compare that projection.
    expect(result.vatBreakdown).toEqual(
      preview.vatBreakdown.map((b) => ({ rate: b.rate, base: b.base, tax: b.tax })),
    );
    // The filed record carries all three lines.
    expect(result.lines).toHaveLength(3);

    // LINKAGE must survive the lock round-trip: the filed child sale_lines point at the filed
    // PARENT's id, not `null`. `readLockedLines` reconstructs each child's `parentLineNo` from its
    // stored `parent_line_id`, so the persisted-order file path preserves parent→child linkage
    // exactly as a live walk-up does — a child sale_line is never orphaned by the re-price.
    const filed = await withTransaction(suite.db, async (tx) => {
      const [sale] = await tx
        .select({ id: sales.id })
        .from(sales)
        .where(eq(sales.workingOrderId, workingOrderId));
      return tx
        .select({
          id: saleLines.id,
          lineNo: saleLines.lineNo,
          parentLineId: saleLines.parentLineId,
        })
        .from(saleLines)
        .where(eq(saleLines.saleId, sale!.id))
        .orderBy(saleLines.lineNo);
    });
    expect(filed).toHaveLength(3);
    const [filedParent, filedBacon, filedQueso] = filed;
    expect(filedParent!.parentLineId).toBeNull();
    expect(filedBacon!.parentLineId).toBe(filedParent!.id);
    expect(filedQueso!.parentLineId).toBe(filedParent!.id);

    // The JSON-facing `TillSaleResult.lines[i].parentLineNo` carries the SAME linkage (the till's
    // settled-ticket view groups on this field) — the dish renders `null`, each child the parent's
    // own `lineNo`, proven against the real persisted lineNo rather than an assumed constant.
    expect(result.lines[0]!.parentLineNo).toBeNull();
    expect(result.lines[1]!.parentLineNo).toBe(filedParent!.lineNo);
    expect(result.lines[2]!.parentLineNo).toBe(filedParent!.lineNo);
  });

  // What the server BILLS for a pick the till can no longer re-send; the till's showing and dropping
  // of it are pinned in apps/till/src/till-app.test.ts.
  it("bills a parked extra that gained an Active variant until an edit omits it, which re-prices without it", async () => {
    const v = await setupModifierVenue();
    const park = (id: string, quantity: string, baconQuantity: number) =>
      withTransaction(suite.db, (tx) =>
        createOpenOrder(
          tx,
          v.cfg,
          id,
          [
            {
              menuItemId: v.offerFor(v.burgerId),
              quantity,
              extras: extrasPick(v, [{ productId: v.baconId, quantity: baconQuantity }]),
            },
          ],
          null,
          { zoneId: v.zoneId },
        ),
      );
    const unedited = randomUUID();
    const edited = randomUUID();
    await park(unedited, "2", 2);
    await park(edited, "1", 1);
    await withTransaction(suite.db, (tx) =>
      setProductVariants(
        tx,
        v.baconId,
        [
          {
            name: "Bacon ahumado",
            customerName: null,
            kitchenName: null,
            image: null,
            unitPrice: "0.90",
            available: true,
          },
        ],
        LOCALE,
      ),
    );
    const pay = (id: string) =>
      payWorkingOrder({ db: suite.db, backend, clock }, v.cfg, {
        id,
        lines: [],
        tender: { method: "cash", amount: "50.00" },
      });

    // 2 × 9.00 + (2 × 2) × 0.50. Counterpart: till-app.test.ts's "shows a retrieved pick no list
    // offers any more, marked, and counts it in the total".
    expect((await pay(unedited)).total).toBe("20.00");

    const [dish] = await suite.db
      .select({ id: workingOrderLines.id })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, edited));
    await updateHeldOrder({ db: suite.db }, v.cfg, edited, {
      lines: [{ workingOrderLineId: dish!.id, menuItemId: v.offerFor(v.burgerId), quantity: "2" }],
    });
    const stored = await suite.db
      .select({ productId: workingOrderLines.productId })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, edited));
    expect(stored).toEqual([{ productId: v.burgerId }]);
    // Two Hamburguesas at 9.00, and no Bacon.
    expect((await pay(edited)).total).toBe("18.00");
  });

  it("re-prices without a parked extra that gained an Active variant when an edit changes only ANOTHER line", async () => {
    const v = await setupModifierVenue();
    const id = randomUUID();
    await withTransaction(suite.db, (tx) =>
      createOpenOrder(
        tx,
        v.cfg,
        id,
        [
          {
            menuItemId: v.offerFor(v.burgerId),
            quantity: "1",
            extras: extrasPick(v, [{ productId: v.baconId, quantity: 1 }]),
          },
          { menuItemId: v.offerFor(v.jamonId), quantity: "0.1" },
        ],
        null,
        { zoneId: v.zoneId },
      ),
    );
    await withTransaction(suite.db, (tx) =>
      setProductVariants(
        tx,
        v.baconId,
        [
          {
            name: "Bacon ahumado",
            customerName: null,
            kitchenName: null,
            image: null,
            unitPrice: "0.90",
            available: true,
          },
        ],
        LOCALE,
      ),
    );

    const parked = await suite.db
      .select({ id: workingOrderLines.id, productId: workingOrderLines.productId })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id));
    const lineOf = (productId: string) => parked.find((line) => line.productId === productId)!.id;
    // The burger is re-sent unchanged but without the Bacon, which the till cannot name.
    await updateHeldOrder({ db: suite.db }, v.cfg, id, {
      lines: [
        {
          workingOrderLineId: lineOf(v.burgerId),
          menuItemId: v.offerFor(v.burgerId),
          quantity: "1",
        },
        {
          workingOrderLineId: lineOf(v.jamonId),
          menuItemId: v.offerFor(v.jamonId),
          quantity: "0.2",
        },
      ],
    });

    const stored = await suite.db
      .select({ productId: workingOrderLines.productId })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id));
    expect(stored.map((line) => line.productId).sort()).toEqual([v.burgerId, v.jamonId].sort());
    // Hamburguesa 9.00 + 0.2 kg of Jamón at 24.90, and no Bacon.
    const result = await payWorkingOrder({ db: suite.db, backend, clock }, v.cfg, {
      id,
      lines: [],
      tender: { method: "cash", amount: "50.00" },
    });
    expect(result.total).toBe("13.98");
    expect((await filedLinesOf(id)).filter((line) => line.parentLineId !== null)).toEqual([]);
  });

  it("settling a TAB with extras files child sale_lines linked to their parent (the primary path)", async () => {
    // Tabs are the PRIMARY customisation path and settle through `priceStoredOrder` (the locked-line
    // file), so this proves the linkage survives openTab → addTabRound(extras) → settle, not just the
    // parked counter retrieve above. Provisioning already ships the venue's default 'Cocina' station
    // (so addTabRound can fire); we add only the dining table the tab opens on.
    const v = await setupModifierVenue();

    const tableId = randomUUID();
    await withTransaction(suite.db, async (tx) => {
      await tx.insert(diningTables).values({
        id: tableId,
        locationId: v.cfg.locationId,
        zoneId: v.tablesZoneId,
        label: "Mesa 1",
        active: true,
      });
    });

    // Open a tab and send a round of the burger with two extras.
    const tabId = await withTransaction(suite.db, async (tx) => {
      const { tabId } = await openTab(tx, v.cfg, { tableId });
      await addTabRound(tx, v.cfg, tabId, [
        {
          menuItemId: v.offerFor(v.burgerId),
          quantity: "1",
          extras: extrasPick(v, [
            { productId: v.baconId, quantity: 1 },
            { productId: v.quesoId, quantity: 1 },
          ]),
        },
      ]);
      return tabId;
    });

    // Settle the tab (files from the STORED locked lines via priceStoredOrder).
    const result = await payWorkingOrder({ db: suite.db, backend, clock }, v.cfg, {
      id: tabId,
      lines: [],
      tender: { method: "cash", amount: "20.00" },
    });
    expect(result.total).toBe("10.25");
    expect(result.lines).toHaveLength(3);

    const filed = await withTransaction(suite.db, async (tx) => {
      const [sale] = await tx
        .select({ id: sales.id })
        .from(sales)
        .where(eq(sales.workingOrderId, tabId));
      return tx
        .select({ id: saleLines.id, parentLineId: saleLines.parentLineId })
        .from(saleLines)
        .where(eq(saleLines.saleId, sale!.id))
        .orderBy(saleLines.lineNo);
    });
    expect(filed).toHaveLength(3);
    const [filedParent, ...children] = filed;
    expect(filedParent!.parentLineId).toBeNull();
    expect(children.map((c) => c.parentLineId)).toEqual([filedParent!.id, filedParent!.id]);
  });

  it("settles a tab through recordTillSale (the /api/sales entry point) with an EMPTY basket", async () => {
    // REGRESSION (table-service settle 400s). The tab-pay flow posts `lines: []` with the tab id to
    // `POST /api/sales` (till-app `#onPayTab`) — a retrieved order files its STORED locked lines and
    // IGNORES the sent basket. That route calls `recordTillSale`, whose entry-point empty-basket
    // early-out fired BEFORE `payWorkingOrder`'s walk-up-ONLY guard, refusing every tab settle with
    // `sale.empty_basket`. The sibling tab test above exercises `payWorkingOrder` directly and so
    // never saw it; this drives the SAME entry point the HTTP route does, where the guard lived.
    const v = await setupModifierVenue();

    const tableId = randomUUID();
    const tabId = await withTransaction(suite.db, async (tx) => {
      await tx.insert(diningTables).values({
        id: tableId,
        locationId: v.cfg.locationId,
        zoneId: v.tablesZoneId,
        label: "Mesa 1",
        active: true,
      });
      const { tabId } = await openTab(tx, v.cfg, { tableId });
      await addTabRound(tx, v.cfg, tabId, [{ menuItemId: v.offerFor(v.burgerId), quantity: "1" }]);
      return tabId;
    });

    const result = await recordTillSale({ db: suite.db, backend, clock }, v.cfg, {
      lines: [],
      tender: { method: "cash", amount: "20.00" },
      workingOrderId: tabId,
    });
    // Files the tab's stored burger line (9.00 gross), never a `sale.empty_basket` refusal.
    expect(result.total).toBe("9.00");
    expect(result.lines).toHaveLength(1);
  });

  it("settles a NON-CONTIGUOUS tab (a voided child) with each child linked to its OWN dish", async () => {
    // FIX 1 (Critical, unrepairable fiscal record): after a void leaves a tab's `line_no`
    // non-contiguous, the STORED `line_no` space diverges from the COMPACTED array-position space
    // `priceRows` renumbers into and `recordSale`'s `byLineNo` map is keyed on. `readLockedLines` must
    // reconstruct each child's `parentLineNo` in that position space, else a child files with a WRONG
    // `parent_line_id` (self / null / wrong sibling) — a permanent error in the append-only record.
    const v = await setupModifierVenue();

    const tableId = randomUUID();
    await withTransaction(suite.db, async (tx) => {
      await tx.insert(diningTables).values({
        id: tableId,
        locationId: v.cfg.locationId,
        zoneId: v.tablesZoneId,
        label: "Mesa NC",
        active: true,
      });
    });

    // Tab: dish#1 (line_no 1) + bacon child (line_no 2); dish#2 (line_no 3) + queso child (line_no 4).
    // Then VOID the bacon child (line_no 2), leaving {1,3,4} — non-contiguous.
    const tabId = await withTransaction(suite.db, async (tx) => {
      const { tabId } = await openTab(tx, v.cfg, { tableId });
      await addTabRound(tx, v.cfg, tabId, [
        {
          menuItemId: v.offerFor(v.burgerId),
          quantity: "1",
          extras: extrasPick(v, [{ productId: v.baconId, quantity: 1 }]),
        },
        {
          menuItemId: v.offerFor(v.burgerId),
          quantity: "1",
          extras: extrasPick(v, [{ productId: v.quesoId, quantity: 1 }]),
        },
      ]);
      await voidTabLine(tx, v.cfg, tabId, 2);
      return tabId;
    });

    const result = await payWorkingOrder({ db: suite.db, backend, clock }, v.cfg, {
      id: tabId,
      lines: [],
      tender: { method: "cash", amount: "30.00" },
    });
    // Two dishes (9.00 each) + queso (0.75) = 18.75, unchanged by line_no compaction.
    expect(result.total).toBe("18.75");
    expect(result.lines).toHaveLength(3);

    const filed = await withTransaction(suite.db, async (tx) => {
      const [sale] = await tx
        .select({ id: sales.id })
        .from(sales)
        .where(eq(sales.workingOrderId, tabId));
      return tx
        .select({ id: saleLines.id, parentLineId: saleLines.parentLineId })
        .from(saleLines)
        .where(eq(saleLines.saleId, sale!.id))
        .orderBy(saleLines.lineNo);
    });
    // Filed (sorted by line_no): dish#1, dish#2, queso — the compaction gives emitted lineNo 1,2,3.
    expect(filed).toHaveLength(3);
    const [dish1, dish2, quesoChild] = filed;
    expect(dish1!.parentLineId).toBeNull();
    expect(dish2!.parentLineId).toBeNull();
    // The queso child points at DISH#2's filed id — never at itself (the self-reference the bug files),
    // never null, never dish#1.
    expect(quesoChild!.parentLineId).toBe(dish2!.id);
    expect(quesoChild!.parentLineId).not.toBe(quesoChild!.id);
    expect(quesoChild!.parentLineId).not.toBeNull();
    expect(quesoChild!.parentLineId).not.toBe(dish1!.id);
  });

  it("rejects unoffered answers, an unanswered options list, an over-cap pick and extras on a fractional product", async () => {
    const v = await setupModifierVenue();
    const bogus = "00000000-0000-0000-0000-000000000000";
    const deps = { db: suite.db, backend, clock };

    // (a) a list the dish does not attach → extras.invalid naming the offending field.
    await expect(
      recordTillSale(deps, v.cfg, {
        zoneId: v.zoneId,
        lines: [
          {
            menuItemId: v.offerFor(v.burgerId),
            quantity: "1",
            extras: [{ listId: bogus, picks: [] }],
          },
        ],
        tender: { method: "cash", amount: "20.00" },
      }),
    ).rejects.toMatchObject({ code: "extras.invalid", params: { field: "listId" } });

    // (a2) a pick naming a product the attached list does not offer → extras.invalid.
    await expect(
      recordTillSale(deps, v.cfg, {
        zoneId: v.zoneId,
        lines: [
          {
            menuItemId: v.offerFor(v.burgerId),
            quantity: "1",
            extras: extrasPick(v, [{ productId: bogus, quantity: 1 }]),
          },
        ],
        tender: { method: "cash", amount: "20.00" },
      }),
    ).rejects.toMatchObject({ code: "extras.invalid", params: { field: "productId" } });

    // (b) an ACTIVE options list (Tamaño) left unanswered → options.label_required.
    await expect(
      recordTillSale(deps, v.cfg, {
        zoneId: v.zoneId,
        lines: [{ menuItemId: v.offerFor(v.menuProductId), quantity: "1", options: [] }],
        tender: { method: "cash", amount: "20.00" },
      }),
    ).rejects.toMatchObject({
      code: "options.label_required",
      params: { optionListId: v.sizeListId },
    });

    // (b2) more picks than the list's own cap (Extras allows three; bacon ×3 plus queso is four) →
    // extras.limit_exceeded.
    await expect(
      recordTillSale(deps, v.cfg, {
        zoneId: v.zoneId,
        lines: [
          {
            menuItemId: v.offerFor(v.burgerId),
            quantity: "1",
            extras: extrasPick(v, [
              { productId: v.baconId, quantity: 3 },
              { productId: v.quesoId, quantity: 1 },
            ]),
          },
        ],
        tender: { method: "cash", amount: "20.00" },
      }),
    ).rejects.toMatchObject({
      code: "extras.limit_exceeded",
      params: { extraListId: v.extrasListId },
    });

    // (c) an extras pick on a WEIGHED dish keeps the each-only contract: a child is priced
    // dishQuantity × pickQuantity, so 0.250 kg of ham would bill a quarter of a rasher.
    await expect(
      recordTillSale(deps, v.cfg, {
        zoneId: v.zoneId,
        lines: [
          {
            menuItemId: v.offerFor(v.jamonId),
            quantity: "0.250",
            extras: extrasPick(v, [{ productId: v.baconId, quantity: 1 }]),
          },
        ],
        tender: { method: "cash", amount: "20.00" },
      }),
    ).rejects.toMatchObject({
      code: "extras.unsupported_product",
      params: { productId: v.jamonId, pricingUnit: "weight" },
    });

    // (d) fewer picks than a list's floor (Guarnición demands two, one sent) → extras.limit_exceeded.
    await expect(
      recordTillSale(deps, v.cfg, {
        zoneId: v.zoneId,
        lines: [
          {
            menuItemId: v.offerFor(v.platoId),
            quantity: "1",
            extras: [
              { listId: v.guarnicionListId, picks: [{ productId: v.patatasId, quantity: 1 }] },
            ],
          },
        ],
        tender: { method: "cash", amount: "20.00" },
      }),
    ).rejects.toMatchObject({
      code: "extras.limit_exceeded",
      params: { extraListId: v.guarnicionListId },
    });
  });

  // Spec §15.6 and the plan's V16: an extra is sold like any product, so one that is Unavailable
  // or Inactive is refused with the code a pick the list does not offer already gets. Each product
  // takes one state with the OTHER flag still set, so a read of the wrong column lets it through.
  it("refuses an extras pick of an Unavailable or an Inactive product as a pick the list does not offer", async () => {
    const v = await setupModifierVenue();
    const deps = { db: suite.db, backend, clock };
    const burgerWith = (productId: string) => ({
      zoneId: v.zoneId,
      lines: [
        {
          menuItemId: v.offerFor(v.burgerId),
          quantity: "1",
          extras: extrasPick(v, [{ productId, quantity: 1 }]),
        },
      ],
      tender: { method: "cash" as const, amount: "20.00" },
    });

    await withTransaction(suite.db, (tx) => updateProduct(tx, v.baconId, { available: false }));
    await expect(recordTillSale(deps, v.cfg, burgerWith(v.baconId))).rejects.toMatchObject({
      code: "extras.invalid",
      params: { field: "productId" },
    });
    // The control: the same list still sells the item that is both Active and Available.
    await expect(recordTillSale(deps, v.cfg, burgerWith(v.quesoId))).resolves.toBeDefined();

    await withTransaction(suite.db, (tx) => updateProduct(tx, v.quesoId, { active: false }));
    await expect(recordTillSale(deps, v.cfg, burgerWith(v.quesoId))).rejects.toMatchObject({
      code: "extras.invalid",
      params: { field: "productId" },
    });
  });

  it("refuses a dish answered with a WITHDRAWN option label, and one left unanswered", async () => {
    const v = await setupModifierVenue();
    const deps = { db: suite.db, backend, clock };

    // An active list must be answered, and a withdrawn label is not an answer — so a till holding a
    // stale menu is refused rather than selling the dish with nothing chosen.
    await expect(
      recordTillSale(deps, v.cfg, {
        zoneId: v.zoneId,
        lines: [{ menuItemId: v.offerFor(v.comboId), quantity: "1", options: [] }],
        tender: { method: "cash", amount: "10.00" },
      }),
    ).rejects.toMatchObject({
      code: "options.label_required",
      params: { optionListId: v.salsaListId },
    });
    await expect(
      recordTillSale(deps, v.cfg, {
        zoneId: v.zoneId,
        lines: [
          {
            menuItemId: v.offerFor(v.comboId),
            quantity: "1",
            options: [{ listId: v.salsaListId, labelId: v.salsaLabelId }],
          },
        ],
        tender: { method: "cash", amount: "10.00" },
      }),
    ).rejects.toMatchObject({
      code: "options.label_required",
      params: { optionListId: v.salsaListId },
    });
  });
});
