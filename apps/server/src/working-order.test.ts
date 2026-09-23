import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  captureError,
  isUniqueViolation,
  locations,
  nowIso,
  printJobs,
  ticketItems,
  tills,
  withTransaction,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { AllergenMap, Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createMenuItem,
  createMenuSection,
  createProduct,
  listAvailableProducts,
  priceBasket,
  replaceProductCategories,
  setMenuVariants,
  setProductVariants,
  units,
  updateCategory,
  EACH_UNIT,
} from "@waitron/catalogue";
import * as catalogue from "@waitron/catalogue";
import type { DietaryLabel } from "@waitron/catalogue";
import type { ExtraSelection, OptionSelection } from "@waitron/shared";
import {
  centsToDecimal,
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { TillConfig } from "./till-config.js";
import {
  abandonHeldOrder,
  addTabRound,
  advanceTicket,
  advanceTicketItem,
  bumpCourseReady,
  createOpenOrder,
  fireCourse,
  fireLines,
  getHeldOrder,
  listExpoQueue,
  listHeldOrders,
  listStationQueue,
  markCourseAway,
  markLineServed,
  openTab,
  parkOrder,
  placeOrder,
  readTabLines,
  recallLines,
  sendLines,
  sendToPrep,
  setLineCourse,
  updateHeldOrder,
  voidTabLine,
} from "./working-order.js";
import type { TicketState } from "./working-order.js";
import {
  createCourse,
  createStation,
  deactivateCourse,
  deactivateStation,
  setCategoryStation,
  setProductCourse,
  setProductStation,
} from "./kitchen.js";
import { createPrinter } from "@waitron/printing";
import type { PrintConfig } from "@waitron/printing";
import { attachPrinterToStation } from "./station-printers.js";
import { decodeTicket } from "./testing/decode-ticket.js";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { VENUE_SERVICE } from "./modules.js";
import "./errors.js";

// PGlite exercises working-order state, validation, foreign keys, triggers and node-scoped reads.
// Real PostgreSQL covers concurrent order-number allocation.
const LOCALE = "es-ES";

/**
 * An ISO timestamp `minutes` in the past, for backdating a `queued_at` that a band assertion reads.
 *
 * This replaces `now() - interval '12 minutes'`: SQLite has no interval type, and `queued_at` is a
 * `tsString` column (packages/db/src/schema/ticket-items.ts:62), so the arithmetic happens on a
 * JavaScript `Date` and the ISO string binds. The reading is the TEST process's clock rather than
 * the database's, which on this engine is the same process.
 */
function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

let db: Database;

beforeAll(() => {
  db = suite.db;
});

interface SeededVenue {
  cfg: TillConfig;
  /** The catalogue assigned to this venue's location — where the KDS routing tests add more products. */
  catalogueId: string;
  /** The `each`-priced "Café" product (VAT general/21%, category "Bebidas"). */
  cafeId: string;
  /** A second `each` product with NO category, so its priced line carries `category: null`. */
  aguaId: string;
  zoneId: string;
  cafeOfferId: string;
  premiumCafeOfferId: string;
  eachUnitId: string;
  kgUnitId: string;
}

/**
 * Stand up the one taxpayer row + a location + till + node and a catalogue with two products, all
 * keyed to `LOCALE` so the `working_order_lines_check_locales` trigger (descriptions must hold
 * EXACTLY the location's `invoice_locales`) is satisfied. Each test gets its OWN node, and
 * `allocateOrderNumber` counts per node, so the order number is that test's own — always 1 on the
 * first park — and the suite is order-independent (CLAUDE.md §4).
 */
async function setupVenue(orderFlow: TillConfig["orderFlow"] = "prepay"): Promise<SeededVenue> {
  await seedTenant(db);
  // Through the table definitions rather than raw SQL, the same change `testing/seed-units.ts`
  // took: `units.id`, `locations.id` and `tills.id` are `$defaultFn` generators a raw insert never
  // reaches, the `::jsonb` casts are `unrecognized token: ":"` on this engine, and
  // `invoice_locales` is a JSON array in a text column (`labelList`), so there is no array
  // constructor to write. The ids are minted here rather than read back from `returning`, which
  // also drops the find-by-seed-key step the two-row insert needed.
  const eachUnitId = randomUUID();
  const kgUnitId = randomUUID();
  await db.insert(units).values([
    {
      id: eachUnitId,
      seedKey: "each",
      name: { en: "each" },
      abbreviation: { en: "ea" },
      precision: 0,
      hardwareUnit: null,
    },
    {
      id: kgUnitId,
      seedKey: "kg",
      name: { en: "kg" },
      abbreviation: { en: "kg" },
      precision: 3,
      hardwareUnit: "kg",
    },
  ]);
  const locationId = randomUUID();
  await db.insert(locations).values({
    id: locationId,
    name: "Barra",
    invoiceLocales: [LOCALE],
    operationDescription: "Venta en establecimiento",
  });
  const tillId = randomUUID();
  await db.insert(tills).values({ id: tillId, locationId, name: "Caja 1" });
  const nodeId = await seedNode(db, brandLocationId(locationId));

  const { cafeId, aguaId, catalogueId, zoneId, cafeOfferId, premiumCafeOfferId } =
    await withTransaction(db, async (tx) => {
      const cat = await createCatalogue(tx, { name: "Carta" });
      const bebidas = await createCategory(tx, { name: { en: "Bebidas" } });
      const cafe = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: bebidas.id,
        name: "Café",
        pricingUnit: "each",
        unitPrice: "1.50",
        vatClass: "general",
      });
      // Deliberately category-less: `listAvailableProducts` resolves its `category` to NULL (LEFT JOIN),
      // so its priced line snapshots `category: null` — the other side of `parkOrder`'s `?? null`.
      const agua = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: null,
        name: "Agua",
        pricingUnit: "each",
        unitPrice: "2.00",
        vatClass: "general",
      });
      await assignCatalogueToLocation(tx, locationId, cat.id);
      const premium = await createCatalogue(tx, { name: "Carta premium" });
      const section = await createMenuSection(tx, {
        menuId: cat.id,
        name: { [LOCALE]: "Bebidas" },
      });
      const premiumSection = await createMenuSection(tx, {
        menuId: premium.id,
        name: { [LOCALE]: "Bebidas" },
      });
      const cafeOffer = await createMenuItem(tx, {
        menuId: cat.id,
        productId: cafe.id,
        sectionId: section.id,
        grossPrice: "2.50",
      });
      const premiumCafeOffer = await createMenuItem(tx, {
        menuId: premium.id,
        productId: cafe.id,
        sectionId: premiumSection.id,
        grossPrice: "3.25",
      });
      // `departments.id`/`floor_zones.id` and both tables' `created_at` are `$defaultFn`
      // generators a raw insert never reaches — it failed with
      // `NOT NULL constraint failed: departments.id`. One clock reading for the two rows, which
      // is what the transaction-start `now()` default gave them.
      const departmentId = randomUUID();
      const zoneId = randomUUID();
      const createdAt = nowIso();
      await tx.execute(sql`
      insert into departments
        (id, location_id, name, trading_name, default_service_mode, created_at)
      values (${departmentId}, ${locationId}, 'Restaurant', 'Restaurant', ${orderFlow}, ${createdAt})`);
      await tx.execute(sql`
      insert into floor_zones (id, location_id, name, created_at)
      values (${zoneId}, ${locationId}, 'Counter', ${createdAt})`);
      // Three statements where this fixture had two, because `zone_service_policies` and
      // `zone_menus` point at each other: a policy's `default_menu_id` names a row of `zone_menus`,
      // and a `zone_menus` row's `zone_id` names a row of `zone_service_policies`. The policy's
      // half was DEFERRABLE INITIALLY DEFERRED on PostgreSQL, so one insert order satisfied both;
      // sqlite-core has no deferrable option, both checks land at their own statement, and NEITHER
      // order works. Both measured here, one run each with this fixture: policy-first with
      // `default_menu_id = ${cat.id}` is refused AT THE POLICY INSERT, and zone_menus-first is
      // refused AT THE `zone_menus` INSERT — `FOREIGN KEY constraint failed` either way, which is
      // the only text SQLite gives for a key. The way through is the
      // one recorded against the schema itself (packages/venue-service/src/schema/service.ts, above
      // `zone_service_policies_default_menu_zone_fk`): insert the policy with a NULL default menu,
      // insert the allowed menus, then name one of them. The end state is the row this fixture
      // always wrote.
      await tx.execute(sql`
      insert into zone_service_policies
        (location_id, zone_id, department_id, default_menu_id, is_counter_default)
      values (${locationId}, ${zoneId}, ${departmentId}, null, true)`);
      await tx.execute(sql`
      insert into zone_menus (zone_id, menu_id, display_order)
      values
        (${zoneId}, ${cat.id}, 0),
        (${zoneId}, ${premium.id}, 1)`);
      await tx.execute(sql`
      update zone_service_policies set default_menu_id = ${cat.id} where zone_id = ${zoneId}`);
      return {
        cafeId: cafe.id,
        aguaId: agua.id,
        catalogueId: cat.id,
        zoneId,
        cafeOfferId: cafeOffer.id,
        premiumCafeOfferId: premiumCafeOffer.id,
      };
    });

  const cfg: TillConfig = {
    tillId: brandTillId(tillId),
    nodeId: brandNodeId(nodeId),
    // `parkOrder` reads neither series nor locale/invoiceLocales; fresh values keep the shape whole.
    seriesId: brandSeriesId(randomUUID()),
    locationId: brandLocationId(locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    // No integrated card terminal; these park routes never read it.
    tipsEnabled: false,
    // Defaults to prepay (park/list/retrieve/update/abandon don't dispatch on the mode); the KDS fire
    // tests pass "ticket_then_pay" so placeOrder takes the non-fiscal placing path.
    orderFlow,
  };
  return {
    cfg,
    cafeId,
    aguaId,
    catalogueId,
    zoneId,
    cafeOfferId,
    premiumCafeOfferId,
    eachUnitId,
    kgUnitId,
  };
}

/**
 * The venue's default content language — what the order path widens a plain staff name under when it
 * freezes an options answer, and the key a product's customer-name map has to use to be read back.
 */
const CONTENT_LANGUAGE = "es";

/** Attach one more list to a product without dropping what it already carries: `writeProductModifiers`
 *  replaces the whole set. */
async function attachModifierList(
  tx: Transaction,
  productId: string,
  ref: { kind: "extras" | "options"; id: string },
): Promise<void> {
  const carried = (await catalogue.readProductModifiers(tx, [productId])).get(productId) ?? [];
  await catalogue.writeProductModifiers(tx, productId, [
    ...carried.map((each) => ({ kind: each.kind, id: each.id })),
    ref,
  ]);
}

/**
 * An extras list offering ONE product, attached to `dishId`. Its three names all differ, and so do
 * the offered product's, so a surface reading the wrong one of the six fails (CLAUDE.md §3).
 *
 * `price` is the list item's own — `null` makes it borrow the offered product's `unitPrice`, which is
 * deliberately different, so a child priced at `unitPrice` when a `price` was given means the offer
 * was never read.
 */
async function addExtraList(
  tx: Transaction,
  catalogueId: string,
  dishId: string,
  label: string,
  opts: {
    price?: string | null;
    unitPrice?: string;
    vatClass?: "general" | "reduced" | "super_reduced" | "zero";
    maxQuantity?: number;
    minPicks?: number;
    maxPicks?: number | null;
    active?: boolean;
  } = {},
): Promise<{ listId: string; productId: string }> {
  const offered = await createProduct(tx, {
    catalogueId,
    categoryId: null,
    name: `${label} staff`,
    customerName: { [CONTENT_LANGUAGE]: `${label} customer` },
    kitchenName: `${label} kitchen`,
    pricingUnit: "each",
    unitPrice: opts.unitPrice ?? "9.99",
    vatClass: opts.vatClass ?? "general",
  });
  const list = await catalogue.createExtraList(
    tx,
    {
      name: `${label} list staff`,
      customerName: { [CONTENT_LANGUAGE]: `${label} list customer` },
      kitchenName: `${label} list kitchen`,
      minPicks: opts.minPicks ?? 0,
      maxPicks: opts.maxPicks === undefined ? null : opts.maxPicks,
      active: opts.active ?? true,
      items: [
        {
          productId: offered.id,
          maxQuantity: opts.maxQuantity ?? 1,
          preselected: false,
          price: opts.price === undefined ? "0.50" : opts.price,
        },
      ],
    },
    LOCALE,
  );
  await attachModifierList(tx, dishId, { kind: "extras", id: list.id });
  return { listId: list.id, productId: offered.id };
}

/**
 * An options list of one or more labels, attached to `dishId`. Every ACTIVE options list a dish
 * carries MUST be answered, so a fixture that adds one commits every line ordering that dish to
 * answering it.
 */
async function addOptionList(
  tx: Transaction,
  dishId: string,
  label: string,
  labelNames: string[] = [label],
): Promise<{ listId: string; labelIds: string[] }> {
  const list = await catalogue.createOptionList(
    tx,
    {
      name: `${label} list staff`,
      customerName: { [CONTENT_LANGUAGE]: `${label} list customer` },
      kitchenName: `${label} list kitchen`,
      defaultLabelId: null,
      active: true,
      labels: labelNames.map((each) => ({
        name: `${each} staff`,
        customerName: { [CONTENT_LANGUAGE]: `${each} customer` },
        kitchenName: `${each} kitchen`,
        available: true,
      })),
    },
    LOCALE,
  );
  await attachModifierList(tx, dishId, { kind: "options", id: list.id });
  return { listId: list.id, labelIds: list.labels.map((each) => each.id) };
}

/**
 * Publish one "Coffee" product with a "Large" variant on `catalogueId`, both carrying a
 * customer-facing name of their own that DIFFERS from their staff name, and return the offer and
 * variant ids. The two customer names differ from the staff names on purpose: a label built from the
 * staff names, or from the product's customer name alone, reads differently from the joined one, so a
 * reader that drops the variant is tellable apart from one that keeps it.
 */
async function seedVariantOffer(
  tx: Transaction,
  catalogueId: string,
): Promise<{ offerId: string; variantId: string; productId: string }> {
  const product = await createProduct(tx, {
    catalogueId,
    categoryId: null,
    name: "Coffee",
    customerName: { [LOCALE]: "Freshly ground coffee" },
    kitchenName: "COF",
    pricingUnit: "each",
    unitPrice: "1.50",
    vatClass: "general",
  });
  const section = await createMenuSection(tx, {
    menuId: catalogueId,
    name: { [LOCALE]: "Cafés" },
  });
  const offer = await createMenuItem(tx, {
    menuId: catalogueId,
    productId: product.id,
    sectionId: section.id,
    grossPrice: "2.50",
  });
  const variants = await setProductVariants(
    tx,
    product.id,
    [
      {
        name: "Large",
        customerName: { [LOCALE]: "Large cup" },
        kitchenName: "LG",
        image: null,
        unitPrice: "3.00",
        available: true,
      },
      {
        name: "Small",
        customerName: null,
        kitchenName: null,
        image: null,
        unitPrice: "2.00",
        available: true,
      },
    ],
    LOCALE,
  );
  await setMenuVariants(tx, offer.id, [
    { variantId: variants[0]!.id, unitPrice: "3.20", available: true },
    { variantId: variants[1]!.id, unitPrice: "2.20", available: true },
  ]);
  return { offerId: offer.id, variantId: variants[0]!.id, productId: product.id };
}

/**
 * Every screen that shows a sold line shows ONE label, and a line that named a variant froze its
 * product text and its variant text in separate columns. Without the variant a large coffee and a
 * small one are indistinguishable on the tab, on the kitchen queue, on the pass and on the retrieve
 * screen, at prices that only make sense with the size.
 *
 * Which of the three names each reader shows is the other half of what this pins. A table tab's line
 * list is read by a waiter, so it carries the STAFF pair. The station queue and the pass are read by
 * cooks, so they carry the KITCHEN pair, exactly as the printed ticket does. The retrieve screen is
 * the till's own and joins the staff halves itself (`lineProductName`,
 * `apps/till/src/widgets/product-name.ts`), so it receives both halves unjoined.
 *
 * The fixture's three pairs are three different strings, so a reader that shows the wrong name fails
 * here rather than passing. All four readers run over the SAME fired order, so one revert on any
 * single reader fails this.
 */
describe("a sold line's label carries its variant", () => {
  const STAFF = "Coffee · Large";
  const KITCHEN = "COF · LG";

  it("carries product and variant onto the tab, the station queue, the pass and the retrieve screen", async () => {
    const { cfg, zoneId, catalogueId } = await setupVenue();
    const orderId = randomUUID();
    const { tabLines, stationItems, expoItems } = await withTransaction(db, async (tx) => {
      const { offerId, variantId, productId } = await seedVariantOffer(tx, catalogueId);
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      await tx.execute(sql`
        insert into preparation_routes (id, location_id, zone_id, product_id, station_id)
        values (${randomUUID()}, ${cfg.locationId}, ${zoneId}, ${productId}, ${cocina.id})`);
      await createOpenOrder(
        tx,
        cfg,
        orderId,
        [{ menuItemId: offerId, variantId, quantity: "1" }],
        null,
        { zoneId },
      );
      const fired = await tx
        .select({
          id: workingOrderLines.id,
          productId: workingOrderLines.productId,
          courseId: workingOrderLines.courseId,
          parentLineId: workingOrderLines.parentLineId,
          note: workingOrderLines.note,
        })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, orderId));
      await fireLines(tx, cfg, orderId, fired);
      return {
        tabLines: await readTabLines(tx, cfg, orderId),
        stationItems: (await listStationQueue(tx, cocina.id))[0]!.items,
        expoItems: (await listExpoQueue(tx, cfg))[0]!.courses[0]!.items,
      };
    });
    // `getHeldOrder` opens its own transaction, so it runs outside the block above.
    const held = await getHeldOrder({ db }, cfg, orderId);

    expect(tabLines.map((l) => l.name)).toEqual([STAFF]);
    expect(stationItems.map((i) => i.name)).toEqual([KITCHEN]);
    expect(expoItems.map((i) => i.name)).toEqual([KITCHEN]);
    expect(held.lines.map((l) => [l.product?.name, l.product?.variantName])).toEqual([
      ["Coffee", "Large"],
    ]);
    // The frozen customer halves reach it too, still apart — the staff name is what the till shows,
    // but a retrieved line that later prints must not have lost its customer text.
    expect(held.lines.map((l) => l.product?.customerName)).toEqual([
      { [LOCALE]: "Freshly ground coffee" },
    ]);
    expect(held.lines.map((l) => l.product?.variantCustomerName)).toEqual([
      { [LOCALE]: "Large cup" },
    ]);
  });
});

describe("parkOrder", () => {
  it("freezes the product's staff name and the variant's three names, each falling back alone", async () => {
    const { cfg, zoneId, catalogueId } = await setupVenue();
    const id = randomUUID();
    const seeded = await withTransaction(db, async (tx) => {
      const product = await createProduct(tx, {
        catalogueId,
        categoryId: null,
        name: "Coffee",
        customerName: { [LOCALE]: "Freshly ground coffee" },
        kitchenName: "COF",
        pricingUnit: "each",
        unitPrice: "1.50",
        vatClass: "general",
      });
      const section = await createMenuSection(tx, {
        menuId: catalogueId,
        name: { [LOCALE]: "Cafés" },
      });
      const offer = await createMenuItem(tx, {
        menuId: catalogueId,
        productId: product.id,
        sectionId: section.id,
        grossPrice: "2.50",
      });
      // "Large" carries all three names; "Small" carries only its staff name, so the row it freezes
      // shows each of the other two falling back on its own.
      const variants = await setProductVariants(
        tx,
        product.id,
        [
          {
            name: "Large",
            customerName: { [LOCALE]: "Large cup" },
            kitchenName: "LG",
            image: null,
            unitPrice: "3.00",
            available: true,
          },
          {
            name: "Small",
            customerName: null,
            kitchenName: null,
            image: null,
            unitPrice: "2.00",
            available: true,
          },
        ],
        LOCALE,
      );
      await setMenuVariants(tx, offer.id, [
        { variantId: variants[0]!.id, unitPrice: "3.20", available: true },
        { variantId: variants[1]!.id, unitPrice: "2.20", available: true },
      ]);
      return { offerId: offer.id, large: variants[0]!.id, small: variants[1]!.id };
    });

    await parkOrder({ db }, cfg, {
      id,
      zoneId,
      lines: [
        { menuItemId: seeded.offerId, variantId: seeded.large, quantity: "1" },
        { menuItemId: seeded.offerId, variantId: seeded.small, quantity: "1" },
      ],
    });

    const frozen = await db.execute<{
      name: string;
      variant_name: string | null;
      descriptions: string;
      variant_descriptions: string | null;
      kitchen_name: string | null;
      variant_kitchen_name: string | null;
    }>(sql`
      select name, variant_name, descriptions, variant_descriptions, kitchen_name,
             variant_kitchen_name
      from working_order_lines where working_order_id = ${id} order by line_no`);
    // The two description columns hold JSON in a TEXT column, and a RAW read returns the stored
    // text — the parse is drizzle's column mapping, which `db.execute` does not go through. Parsed
    // here so the assertion below still names the maps it always named rather than a serialisation.
    const frozenRows = frozen.rows.map((row) => ({
      ...row,
      descriptions: JSON.parse(row.descriptions) as Record<string, string>,
      variant_descriptions:
        row.variant_descriptions === null
          ? null
          : (JSON.parse(row.variant_descriptions) as Record<string, string>),
    }));
    expect(frozenRows).toEqual([
      {
        name: "Coffee",
        variant_name: "Large",
        descriptions: { [LOCALE]: "Freshly ground coffee" },
        variant_descriptions: { [LOCALE]: "Large cup" },
        kitchen_name: "COF",
        variant_kitchen_name: "LG",
      },
      {
        name: "Coffee",
        variant_name: "Small",
        descriptions: { [LOCALE]: "Freshly ground coffee" },
        variant_descriptions: { [LOCALE]: "Small" },
        kitchen_name: "COF",
        variant_kitchen_name: null,
      },
    ]);
  });

  it("prices the selected menu offer and freezes its service context", async () => {
    const { cfg, zoneId, premiumCafeOfferId } = await setupVenue();
    const id = randomUUID();

    await parkOrder({ db }, cfg, {
      id,
      zoneId,
      lines: [{ menuItemId: premiumCafeOfferId, quantity: "1" }],
    });

    // Read straight from the column, which counts whole cents: 325 is the locked 3.25. Nothing
    // converts here, so this asserts the stored COUNT. The cast is a no-op on this engine — the
    // column is already an integer and the driver hands it back as a number — and is kept only so
    // the select list says which JavaScript type the assertion below is written against. The
    // sentence this replaces claimed the cast would raise 22003 on an out-of-range value; that was
    // PostgreSQL's four-byte `::int`, and SQLite's INTEGER is 64-bit, so nothing here refuses one.
    const line = await db.execute<{ unit_price_gross: number }>(sql`
      select cast(unit_price_gross as int) as unit_price_gross
      from working_order_lines where working_order_id = ${id}`);
    const context = await db.execute<{ zone_id: string; service_mode: string }>(sql`
      select zone_id, service_mode from order_service_contexts where working_order_id = ${id}`);
    const attribution = await db.execute<{
      menu_item_id: string;
      menu_name: string;
      department_name: string;
    }>(sql`
      select menu_item_id, menu_name, department_name
      from working_line_contexts
      where working_order_line_id = (
        select id from working_order_lines where working_order_id = ${id})`);
    expect(line.rows).toEqual([{ unit_price_gross: 325 }]);
    expect(context.rows).toEqual([{ zone_id: zoneId, service_mode: "prepay" }]);
    expect(attribution.rows).toEqual([
      {
        menu_item_id: premiumCafeOfferId,
        menu_name: "Carta premium",
        department_name: "Restaurant",
      },
    ]);
  });

  it("loads one zone-offer snapshot for a basket with repeated offers", async () => {
    const { cfg, zoneId, premiumCafeOfferId } = await setupVenue();
    const listOffers = vi.spyOn(VENUE_SERVICE, "listZoneOffers");
    const resolveOffer = vi.spyOn(VENUE_SERVICE, "resolveZoneOffer");
    try {
      await parkOrder({ db }, cfg, {
        id: randomUUID(),
        zoneId,
        lines: [
          { menuItemId: premiumCafeOfferId, quantity: "1" },
          { menuItemId: premiumCafeOfferId, quantity: "1" },
        ],
      });
      expect(listOffers).toHaveBeenCalledTimes(1);
      expect(resolveOffer).not.toHaveBeenCalled();
    } finally {
      listOffers.mockRestore();
      resolveOffer.mockRestore();
    }
  });

  it("parks an open working order with number 1 and its priced lines", async () => {
    const { cfg, cafeId } = await setupVenue();
    const id = randomUUID();

    const { orderNumber } = await parkOrder({ db }, cfg, {
      id,
      lines: [{ productId: cafeId, quantity: "2" }],
      label: "John",
    });
    expect(orderNumber).toBe(1);

    const [wo] = await db.select().from(workingOrders).where(eq(workingOrders.id, id));
    expect(wo).toMatchObject({
      status: "open",
      label: "John",
      orderNumber: 1,
      nodeId: cfg.nodeId,
      tillId: cfg.tillId,
      settledAt: null,
    });

    const lines = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id));
    expect(lines).toHaveLength(1);
    // The line carries its product FK + quantity AND the full display snapshot priceBasket produced:
    // 1.50 gross each × 2 = 3.00 gross. `line_total` on this DRAFT is the GROSS 3.00 (the
    // customer-facing total the held list shows), NOT the net base 2.48 the FILED sale line carries;
    // `unit_price` stays the net unit 1.24 and `vat_rate` 21%. Every one of these four columns is
    // read straight off the row, so each is the whole number its own scale stores: 300 is that
    // gross 3.00 in cents and 124 the net unit 1.24, 2000 is two units in thousandths, and 2100 is
    // the 21% rate in basis points.
    expect(lines[0]).toMatchObject({
      productId: cafeId,
      lineNo: 1,
      quantity: 2000,
      descriptions: { [LOCALE]: "Café" },
      unitPrice: 124,
      vatRate: 2100,
      lineTotal: 300,
      category: "Bebidas",
    });
  });

  it("stores a quantity as whole thousandths and a rate as whole basis points", async () => {
    // The two scaled-integer columns on `working_order_lines`, pinned as COUNTS. Nothing else does:
    // every other assertion in this file reads a quantity or a rate back through a converter, so a
    // conversion applied at the wrong scale on BOTH sides would round-trip and pass. The quantity
    // carries three decimal places on purpose — 1.500 is the one figure that separates thousandths
    // (1500) from cents (150) and from a bare unit count (1 or 2).
    const { cfg, cafeId, kgUnitId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      // Café is priced `each` by default, and `assertQuantityPrecision` refuses a fractional
      // quantity on it; the kg unit's precision of 3 is what admits 1.500.
      await catalogue.assignProductUnit(tx, cafeId, kgUnitId);
    });
    const id = randomUUID();
    await parkOrder({ db }, cfg, {
      id,
      lines: [{ productId: cafeId, quantity: "1.500" }],
    });

    // Read as TEXT rather than through drizzle, so what is asserted is the number the column holds
    // and not a driver's or an engine's rendering of it.
    const stored = await db.execute<{ quantity: string; vat_rate: string }>(sql`
      select cast(quantity as text) as quantity, cast(vat_rate as text) as vat_rate
      from working_order_lines where working_order_id = ${id}`);
    // 1.500 kg is 1500 thousandths, and the general 21.00% rate is 2100 basis points.
    expect(stored.rows).toEqual([{ quantity: "1500", vat_rate: "2100" }]);
  });

  it("parks a multi-line order without a label, snapshotting a category-less line as null", async () => {
    const { cfg, cafeId, aguaId } = await setupVenue();
    const id = randomUUID();

    const { orderNumber } = await parkOrder({ db }, cfg, {
      id,
      // Two lines in a deliberate order, so the per-line product_id zip (line i ← req.lines[i]) is
      // proven for more than index 0.
      lines: [
        { productId: cafeId, quantity: "1" },
        { productId: aguaId, quantity: "3" },
      ],
    });
    // A fresh tenant/node, so this park's own first allocation is 1.
    expect(orderNumber).toBe(1);

    const [wo] = await db.select().from(workingOrders).where(eq(workingOrders.id, id));
    expect(wo!.label).toBeNull();

    const lines = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ lineNo: 1, productId: cafeId, category: "Bebidas" });
    // `quantity` is read straight off the column, so 3000 is three units as a count of thousandths.
    expect(lines[1]).toMatchObject({ lineNo: 2, productId: aguaId, quantity: 3000 });
    // The category-less product's line snapshots NULL, the other branch of `?? null`.
    expect(lines[1]!.category).toBeNull();
  });

  it("refuses an empty basket (sale.empty_basket) and an unknown product (sale.unknown_product)", async () => {
    const { cfg, cafeId } = await setupVenue();
    const UUID_NOT_IN_CAT = "00000000-0000-0000-0000-000000000000";

    await expect(parkOrder({ db }, cfg, { id: randomUUID(), lines: [] })).rejects.toMatchObject({
      code: "sale.empty_basket",
    });

    await expect(
      parkOrder({ db }, cfg, {
        id: randomUUID(),
        lines: [{ productId: UUID_NOT_IN_CAT, quantity: "1" }],
      }),
    ).rejects.toMatchObject({
      code: "sale.unknown_product",
      params: { productId: UUID_NOT_IN_CAT },
    });

    // The unknown-product refusal aborts the whole transaction: even the good line beside it leaves
    // no working order behind (the refuse-empty guard runs before the tx; the unknown guard inside it).
    await expect(
      parkOrder({ db }, cfg, {
        id: randomUUID(),
        lines: [
          { productId: cafeId, quantity: "1" },
          { productId: UUID_NOT_IN_CAT, quantity: "1" },
        ],
      }),
    ).rejects.toMatchObject({ code: "sale.unknown_product" });
    const parked = await withTransaction(db, async (tx) => {
      return tx.select().from(workingOrders);
    });
    expect(parked).toHaveLength(0);
  });

  it("replays the existing order on a re-sent park, creating no second order", async () => {
    // PGlite (a single backend) is correct here: this is a SEQUENTIAL lost-response retry — the
    // first park commits, then the re-sent park with the SAME client-minted id collides against
    // that already-committed row on the SAME backend. It is NOT concurrency (two backends racing):
    // one connection replaying its own committed write is exactly what a single backend proves. The
    // CONCURRENT park backstop — two backends racing the same id — is proven separately against
    // real Postgres in `working-order.pay-and-dispatch.test.ts` ("parkOrder concurrent replay").
    const { cfg, cafeId } = await setupVenue();
    const id = randomUUID();
    const lines = [{ productId: cafeId, quantity: "2" }];

    const first = await parkOrder({ db }, cfg, { id, lines, label: "John" });
    expect(first.orderNumber).toBe(1);

    // The re-sent park (a lost-response retry) REPLAYS the committed order rather than PK-colliding into
    // an opaque 500 — same id, same allocated number, nothing new filed.
    const replay = await parkOrder({ db }, cfg, { id, lines, label: "John" });
    expect(replay).toEqual({ id, orderNumber: 1 });

    // Exactly ONE order and ONE line survive: the replay re-inserted neither the order nor its lines.
    const orders = await db.select().from(workingOrders).where(eq(workingOrders.id, id));
    expect(orders).toHaveLength(1);
    const woLines = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id));
    expect(woLines).toHaveLength(1);
  });

  it("replays the ORIGINAL order when a re-sent park carries a DIFFERENT basket (id is the idempotency key)", async () => {
    // The replay is keyed on the id ALONE and files nothing, so a re-park whose lines DIFFER from the
    // committed order does NOT update it — the original composition survives and the differing basket is
    // discarded. This is deliberate idempotency (the id is the key, exactly like pay's replay), and it is
    // WHY the till must route a retrieved-and-EDITED order's re-hold through `updateWorkingOrder`, not a
    // re-park: re-parking an edit would silently drop it (see `#onParkOrder` / `#syncIfDirty` in apps/till).
    const { cfg, cafeId, aguaId } = await setupVenue();
    const id = randomUUID();

    const first = await parkOrder({ db }, cfg, {
      id,
      lines: [{ productId: cafeId, quantity: "1" }],
    });
    expect(first.orderNumber).toBe(1);

    // Re-park the SAME id with a different product and quantity. It replays the original, unchanged.
    const replay = await parkOrder({ db }, cfg, {
      id,
      lines: [{ productId: aguaId, quantity: "5" }],
    });
    expect(replay).toEqual({ id, orderNumber: 1 });

    // The one surviving line is the ORIGINAL Café line — the re-park's Agua line was never inserted.
    const woLines = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id));
    expect(woLines).toHaveLength(1);
    // Straight off the column: 1000 is the original one unit, as a count of thousandths.
    expect(woLines[0]).toMatchObject({ productId: cafeId, quantity: 1000 });
  });

  it("re-throws when the colliding id is no longer an open order", async () => {
    // A CHARACTERIZATION test: its external behaviour (a rejection) is UNCHANGED by this fix, so it is
    // not RED. It is proven to guard the new not-open branch BY DELETION (CLAUDE.md §4): replacing that
    // branch's `throw error` with a fabricated `return { id: req.id, orderNumber: -1 }` makes this test
    // FAIL (done, then restored) — confirming the assertion exercises the branch, not something else.
    const { cfg, cafeId } = await setupVenue();
    const id = randomUUID();
    const lines = [{ productId: cafeId, quantity: "1" }];

    await parkOrder({ db }, cfg, { id, lines });
    // Abandon it: `abandonHeldOrder` is a conditional open→abandoned UPDATE, so the row PERSISTS (status
    // 'abandoned'), not a delete — a re-park's id still PK-collides, but the committed row is no longer open.
    await abandonHeldOrder({ db }, cfg, id);

    // The re-park collides on the committed (now abandoned) row. Not being `open`, it is NOT a replayable
    // held order, so the ORIGINAL driver refusal is re-thrown rather than a result fabricated. Read
    // through `isUniqueViolation` (not `.rejects.toMatchObject({ code })`) because drizzle wraps the
    // driver error in a `DrizzleQueryError` whose own `code` is undefined, and the predicate walks
    // the cause chain — the same normalisation `record-void.test.ts` makes for this identical
    // assertion shape.
    //
    // This asserted the SQLSTATE `23505` through `pgErrorCode` until the storage swap. `node:sqlite`
    // puts `"ERR_SQLITE_ERROR"` on `code` for every failure alike and the discriminating value on
    // `errcode`, so no string code separates a duplicate key from anything else here; and SQLite
    // splits what PostgreSQL folded into `23505` — 1555 for a primary key, 2067 for any other
    // unique index (packages/db/src/sql-state.ts). `UNIQUE_VIOLATION` holds both, so the claim is
    // the one this case always made: the collision surfaced as a duplicate key.
    const error = await captureError(() => parkOrder({ db }, cfg, { id, lines }));
    expect(isUniqueViolation(error)).toBe(true);

    // The failed re-park did not resurrect the abandoned row.
    const [wo] = await db.select().from(workingOrders).where(eq(workingOrders.id, id));
    expect(wo!.status).toBe("abandoned");
  });
});

describe("openTab service context", () => {
  it("derives the service zone from the table and prices its menu offer", async () => {
    const { cfg, zoneId, premiumCafeOfferId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await tx.execute(sql`
        update departments set default_service_mode = 'table_tab'
        where location_id = ${cfg.locationId}`);
      const table = await tx.execute<{ id: string }>(sql`
        insert into dining_tables (id, location_id, label, zone_id, created_at)
        values (${randomUUID()}, ${cfg.locationId}, 'Offer table', ${zoneId}, ${nowIso()})
        returning id`);

      const { tabId } = await openTab(tx, cfg, {
        tableId: table.rows[0]!.id,
        lines: [{ menuItemId: premiumCafeOfferId, quantity: "1" }],
      });

      const priced = await tx.execute<{ unit_price_gross: number }>(sql`
        select cast(unit_price_gross as int) as unit_price_gross
        from working_order_lines where working_order_id = ${tabId}`);
      const context = await tx.execute<{ zone_id: string; service_mode: string }>(sql`
        select zone_id, service_mode from order_service_contexts where working_order_id = ${tabId}`);
      expect(priced.rows).toEqual([{ unit_price_gross: 325 }]);
      expect(context.rows).toEqual([{ zone_id: zoneId, service_mode: "table_tab" }]);
    });
  });

  it("uses the tab's stored zone for later menu-offer rounds", async () => {
    const { cfg, zoneId, premiumCafeOfferId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const station = await createStation(tx, cfg, { name: "Kitchen", isDefault: true });
      await tx.execute(sql`
        insert into preparation_routes
          (id, location_id, zone_id, product_id, station_id)
        values (${randomUUID()}, ${cfg.locationId}, ${zoneId},
          (select product_id from menu_items where id = ${premiumCafeOfferId}), ${station.id})`);
      await tx.execute(sql`
        update departments set default_service_mode = 'table_tab'
        where location_id = ${cfg.locationId}`);
      const table = await tx.execute<{ id: string }>(sql`
        insert into dining_tables (id, location_id, label, zone_id, created_at)
        values (${randomUUID()}, ${cfg.locationId}, 'Round table', ${zoneId}, ${nowIso()})
        returning id`);
      const { tabId } = await openTab(tx, cfg, { tableId: table.rows[0]!.id });

      await addTabRound(tx, cfg, tabId, [{ menuItemId: premiumCafeOfferId, quantity: "1" }]);

      const line = await tx.execute<{ unit_price_gross: number; menu_item_id: string }>(sql`
        select cast(l.unit_price_gross as int) as unit_price_gross, c.menu_item_id
        from working_order_lines l
        join working_line_contexts c on c.working_order_line_id = l.id
        where l.working_order_id = ${tabId}`);
      expect(line.rows).toEqual([{ unit_price_gross: 325, menu_item_id: premiumCafeOfferId }]);
    });
  });

  it("routes the same product to the station configured for each table zone", async () => {
    const { cfg, zoneId, premiumCafeOfferId, cafeId, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const department = await tx.execute<{ id: string }>(sql`
        update departments set default_service_mode = 'table_tab'
        where location_id = ${cfg.locationId}
        returning id`);
      const downstairsZone = await tx.execute<{ id: string }>(sql`
        insert into floor_zones (id, location_id, name, created_at)
        values (${randomUUID()}, ${cfg.locationId}, 'Downstairs', ${nowIso()}) returning id`);
      // The policy goes in with a NULL default menu, the allowed menus follow, and the last
      // statement names one — the same three-step the venue fixture above explains: the two tables
      // point at each other and neither key is deferrable on this engine.
      await tx.execute(sql`
        insert into zone_service_policies
          (location_id, zone_id, department_id, default_menu_id)
        values (${cfg.locationId}, ${downstairsZone.rows[0]!.id},
          ${department.rows[0]!.id}, null)`);
      await tx.execute(sql`
        insert into zone_menus (zone_id, menu_id)
        values
          (${downstairsZone.rows[0]!.id}, ${catalogueId}),
          (${downstairsZone.rows[0]!.id},
            (select menu_id from menu_items where id = ${premiumCafeOfferId}))`);
      await tx.execute(sql`
        update zone_service_policies set default_menu_id = ${catalogueId}
        where zone_id = ${downstairsZone.rows[0]!.id}`);
      const upstairsBar = await createStation(tx, cfg, { name: "Upstairs bar" });
      const downstairsBar = await createStation(tx, cfg, { name: "Downstairs bar" });
      const product = await tx.execute<{ category_id: string }>(sql`
        select category_id from products where id = ${cafeId}`);
      await tx.execute(sql`
        insert into preparation_routes
          (id, location_id, zone_id, category_id, station_id)
        values
          (${randomUUID()}, ${cfg.locationId}, ${zoneId}, ${product.rows[0]!.category_id},
            ${upstairsBar.id}),
          (${randomUUID()}, ${cfg.locationId}, ${downstairsZone.rows[0]!.id},
            ${product.rows[0]!.category_id}, ${downstairsBar.id})`);

      const upstairsTable = await tx.execute<{ id: string }>(sql`
        insert into dining_tables (id, location_id, label, zone_id, created_at)
        values (${randomUUID()}, ${cfg.locationId}, 'Upstairs', ${zoneId}, ${nowIso()})
        returning id`);
      const downstairsTable = await tx.execute<{ id: string }>(sql`
        insert into dining_tables (id, location_id, label, zone_id, created_at)
        values (${randomUUID()}, ${cfg.locationId}, 'Downstairs', ${downstairsZone.rows[0]!.id},
          ${nowIso()})
        returning id`);
      const upstairs = await openTab(tx, cfg, { tableId: upstairsTable.rows[0]!.id });
      const downstairs = await openTab(tx, cfg, { tableId: downstairsTable.rows[0]!.id });

      await addTabRound(tx, cfg, upstairs.tabId, [
        { menuItemId: premiumCafeOfferId, quantity: "1" },
      ]);
      await addTabRound(tx, cfg, downstairs.tabId, [
        { menuItemId: premiumCafeOfferId, quantity: "1" },
      ]);

      const routed = await tx.execute<{ working_order_id: string; station_id: string }>(sql`
        select working_order_id, station_id from ticket_items
        where working_order_id in (${upstairs.tabId}, ${downstairs.tabId})
        order by working_order_id`);
      expect(new Map(routed.rows.map((row) => [row.working_order_id, row.station_id]))).toEqual(
        new Map([
          [upstairs.tabId, upstairsBar.id],
          [downstairs.tabId, downstairsBar.id],
        ]),
      );
    });
  });

  it("stores an explicitly no-preparation offer without creating a kitchen ticket", async () => {
    const { cfg, zoneId, premiumCafeOfferId, cafeId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await tx.execute(sql`
        update departments set default_service_mode = 'table_tab'
        where location_id = ${cfg.locationId}`);
      await tx.execute(sql`
        insert into preparation_routes
          (id, location_id, zone_id, product_id, no_preparation)
        values (${randomUUID()}, ${cfg.locationId}, ${zoneId}, ${cafeId}, true)`);
      const table = await tx.execute<{ id: string }>(sql`
        insert into dining_tables (id, location_id, label, zone_id, created_at)
        values (${randomUUID()}, ${cfg.locationId}, 'Deli shelf', ${zoneId}, ${nowIso()})
        returning id`);
      const { tabId } = await openTab(tx, cfg, { tableId: table.rows[0]!.id });

      await addTabRound(tx, cfg, tabId, [{ menuItemId: premiumCafeOfferId, quantity: "1" }]);

      const counts = await tx.execute<{ lines: number; tickets: number }>(sql`
        select
          (select cast(count(*) as int) from working_order_lines where working_order_id = ${tabId}) as lines,
          (select cast(count(*) as int) from ticket_items where working_order_id = ${tabId}) as tickets`);
      expect(counts.rows).toEqual([{ lines: 1, tickets: 0 }]);
    });
  });

  it("refuses to open a table tab in a counter-mode zone", async () => {
    const { cfg, zoneId } = await setupVenue("prepay");
    await withTransaction(db, async (tx) => {
      const table = await tx.execute<{ id: string }>(sql`
        insert into dining_tables (id, location_id, label, zone_id, created_at)
        values (${randomUUID()}, ${cfg.locationId}, 'Counter table', ${zoneId}, ${nowIso()})
        returning id`);
      await expect(openTab(tx, cfg, { tableId: table.rows[0]!.id })).rejects.toMatchObject({
        code: "service_zone.mode_incompatible",
        params: { zoneId, expected: "table_tab", actual: "prepay" },
      });
    });
  });
});

/**
 * Read a working order and its lines back RAW (no tenant scope), for computing what
 * `listHeldOrders`/`getHeldOrder` should independently return. `openedAt` is the actual persisted
 * value, so a `toEqual` on the list carries every field rather than an `objectContaining` that
 * would let an unasserted key slip through (CLAUDE.md §4).
 */
async function readOrder(id: string): Promise<{
  openedAt: string;
  lineTotals: string[];
}> {
  const [wo] = await db.select().from(workingOrders).where(eq(workingOrders.id, id));
  const lines = await db
    .select()
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, id))
    .orderBy(workingOrderLines.lineNo);
  // `line_total` stores a count of whole cents; the helper hands back the amounts, which is what
  // the caller compares against a held-orders total.
  return { openedAt: wo!.openedAt, lineTotals: lines.map((l) => centsToDecimal(l.lineTotal)) };
}

/**
 * The GROSS (VAT-inclusive) basket total the operator saw for `lines` — computed the SAME way the
 * server prices a basket (`listAvailableProducts` → `priceBasket`), then take its `.total`. This is
 * the number every other surface shows (the basket grand total, the printed ticket), and the
 * invariant a held-orders `total` MUST equal EXACTLY (Important review finding). Derived independently
 * of the persisted `line_total` column, so a held total computed from the NET base — the bug — fails
 * against it (2 × 1.50 gross is 3.00 here, not the net 2.48 the fiscal line carries).
 */
async function grossBasketTotal(
  cfg: TillConfig,
  lines: { productId: string; quantity: string }[],
): Promise<string> {
  return withTransaction(db, async (tx) => {
    const { products: available } = await listAvailableProducts(tx, cfg.locationId);
    const byId = new Map(available.map((p) => [p.id, p]));
    // A catalogue row is not priceable as read: its customer-facing text is resolved from
    // `name`/`customerName` by `product-presentation.ts` first, exactly as `priceOrderLines` does.
    const items = lines.map((l) => {
      const product = byId.get(l.productId)!;
      return {
        product: {
          ...product,
          descriptions: catalogue.customerPresentationText(
            {
              name: product.name,
              customerName: product.customerName,
              kitchenName: null,
              variantName: null,
              variantCustomerName: null,
              variantKitchenName: null,
            },
            LOCALE,
          ).product,
        },
        quantity: l.quantity,
      };
    });
    return priceBasket(items).total;
  });
}

/** Drive a parked order to a terminal status by UPDATE, the transition the enforce trigger allows. */
async function setStatus(id: string, status: "settled" | "abandoned"): Promise<void> {
  await withTransaction(db, async (tx) => {
    // `settled` demands a settled_at (working_orders_settled_at_ck is a biconditional); `abandoned`
    // demands it stay NULL. The BEFORE UPDATE enforce_transition trigger permits open→either.
    if (status === "settled") {
      await tx.execute(
        sql`update working_orders set status = 'settled', settled_at = ${nowIso()} where id = ${id}`,
      );
    } else {
      await tx.execute(sql`update working_orders set status = 'abandoned' where id = ${id}`);
    }
  });
}

// `setStatus` needs the tenant of the venue it is acting on; each test assigns this before using it.

/**
 * Insert an open order on ANOTHER node at the same location. The row exists to prove reads are
 * venue-wide (till-reroute §3.6): a promoted node inherits the venue's open tabs even though they are
 * tagged with the dead node's id (swap spec §4.3). `node_id` is the foreign node's on purpose.
 */
async function seedForeignNodeOrder(cfg: TillConfig): Promise<string> {
  const id = randomUUID();
  const otherNode = await seedNode(db, cfg.locationId);
  await db.execute(sql`
    insert into working_orders (id, till_id, node_id, order_number, status, opened_at)
    values (${id}, ${cfg.tillId}, ${otherNode}, 1, 'open', ${nowIso()})`);
  return id;
}

describe("listHeldOrders", () => {
  it("lists the node's open orders with itemCount, GROSS total and label, ordered by number", async () => {
    const { cfg, cafeId, aguaId } = await setupVenue();
    const idA = randomUUID();
    const idB = randomUUID();

    // A: a single line (itemCount 1). B: two lines (itemCount 2) and NO label (the null branch). A is
    // parked first, so its per-node number is 1 and B's is 2 — the order the list must come back in.
    const linesA = [{ productId: cafeId, quantity: "2" }];
    const linesB = [
      { productId: cafeId, quantity: "1" },
      { productId: aguaId, quantity: "3" },
    ];
    await parkOrder({ db }, cfg, { id: idA, lines: linesA, label: "Mesa 4" });
    await parkOrder({ db }, cfg, { id: idB, lines: linesB });

    // The Important review finding: the held `total` is the GROSS (VAT-inclusive) basket total the
    // operator saw — `priceBasket(sameItems).total`, computed independently of the persisted column —
    // NOT the summed net base. A: 1.50 × 2 = 3.00 gross (the old bug showed the net 2.48); B: 1.50 +
    // 6.00 = 7.50. Both asserted as literals AND against the pricer, so the test fails if the held
    // total ever reverts to net (2.48 ≠ 3.00) or if the pricer itself drifts.
    const grossA = await grossBasketTotal(cfg, linesA);
    const grossB = await grossBasketTotal(cfg, linesB);
    expect(grossA).toBe("3.00");
    expect(grossB).toBe("7.50");

    const a = await readOrder(idA);
    const b = await readOrder(idB);

    const held = await listHeldOrders({ db }, cfg);
    expect(held).toEqual([
      {
        id: idA,
        orderNumber: 1,
        label: "Mesa 4",
        itemCount: 1,
        total: grossA,
        openedAt: a.openedAt,
      },
      { id: idB, orderNumber: 2, label: null, itemCount: 2, total: grossB, openedAt: b.openedAt },
    ]);
  });

  it("omits settled and abandoned orders — the status filter is the only reason they are gone", async () => {
    const { cfg, cafeId } = await setupVenue();
    const openId = randomUUID();
    const abandonedId = randomUUID();
    const settledId = randomUUID();

    // All three are parked identically (same node, real lines), so the ONLY thing separating the
    // listed one from the other two is status — not a missing node_id or an empty basket.
    for (const id of [openId, abandonedId, settledId]) {
      await parkOrder({ db }, cfg, { id, lines: [{ productId: cafeId, quantity: "1" }] });
    }
    await setStatus(abandonedId, "abandoned");
    await setStatus(settledId, "settled");

    const held = await listHeldOrders({ db }, cfg);
    expect(held.map((o) => o.id)).toEqual([openId]);
  });

  it("lists an open order from ANOTHER node of the same tenant — reads are venue-wide under warm standby (till-reroute §3.6)", async () => {
    const { cfg, cafeId } = await setupVenue();
    const mine = randomUUID();
    await parkOrder({ db }, cfg, { id: mine, lines: [{ productId: cafeId, quantity: "1" }] });
    const foreign = await seedForeignNodeOrder(cfg);
    const listed = (await listHeldOrders({ db }, cfg)).map((o) => o.id);
    expect(listed).toContain(mine);
    expect(listed).toContain(foreign);
  });
});

describe("getHeldOrder", () => {
  it("keeps a fractional item's unit snapshot after the live unit is renamed", async () => {
    const { cfg, catalogueId, zoneId } = await setupVenue();
    const { productId, menuItemId, unitId } = await withTransaction(db, async (tx) => {
      const inserted = await tx.execute<{ id: string }>(sql`
        insert into units (id, name, abbreviation, precision, hardware_unit)
        values (${randomUUID()}, ${JSON.stringify({ [LOCALE]: "kg" })},
          ${JSON.stringify({ [LOCALE]: "kg" })}, 3, 'kg')
        returning id`);
      const unitId = inserted.rows[0]!.id;
      const product = await createProduct(tx, {
        catalogueId,
        categoryId: null,
        name: "Jamón",
        unitId,
        unitPrice: "12.00",
        vatClass: "general",
      });
      const section = await createMenuSection(tx, {
        menuId: catalogueId,
        name: { [LOCALE]: "Charcutería" },
      });
      const menuItem = await createMenuItem(tx, {
        menuId: catalogueId,
        productId: product.id,
        sectionId: section.id,
        grossPrice: "12.00",
      });
      return { productId: product.id, menuItemId: menuItem.id, unitId };
    });
    const id = randomUUID();

    await parkOrder({ db }, cfg, {
      id,
      zoneId,
      lines: [{ menuItemId, quantity: "0.375" }],
    });
    await db.execute(sql`
      update units set name = ${JSON.stringify({ [LOCALE]: "kilogramo" })}
      where id = ${unitId}`);

    const order = await getHeldOrder({ db }, cfg, id);
    const stored = await db.execute<{
      quantity: string;
      line_total: number;
      unit_name: string;
      unit_precision: number;
    }>(sql`
      select cast(quantity as text) as quantity, cast(line_total as int) as line_total,
             unit_name, unit_precision
      from working_order_lines
      where working_order_id = ${id}`);
    // `unit_name` holds JSON in a TEXT column, and a RAW read returns the stored text — the parse
    // is drizzle's column mapping, which `db.execute` does not go through. Parsed here so the
    // assertion still names the map it always named rather than a serialisation.
    const storedRows = stored.rows.map((row) => ({
      ...row,
      unit_name: JSON.parse(row.unit_name) as Record<string, string>,
    }));
    // `quantity` counts whole THOUSANDTHS, so 375 grams is stored as 375 — read as text so the
    // assertion pins the stored count rather than a driver's rendering of an eight-byte integer.
    expect(storedRows).toEqual([
      {
        quantity: "375",
        line_total: 450,
        unit_name: { [LOCALE]: "kg" },
        unit_precision: 3,
      },
    ]);
    expect(order.lines).toEqual([
      expect.objectContaining({
        productId,
        quantity: "0.375",
        product: expect.objectContaining({
          unit: { id: unitId, name: { [LOCALE]: "kg" }, precision: 3, hardwareUnit: "kg" },
          unitPrice: "12.00",
        }),
      }),
    ]);
  });

  it("reconstructs a parked offer with its extras, customisation and locked display prices", async () => {
    const { cfg, zoneId, cafeId, catalogueId, premiumCafeOfferId } = await setupVenue();
    const extra = await withTransaction(db, async (tx) => {
      const attached = await addExtraList(tx, catalogueId, cafeId, "Leche", {
        price: "0.10",
        maxQuantity: 2,
        maxPicks: 2,
      });
      // The OFFER reprices what the list charges, so a child at 0.10 would mean the menu's own
      // override was never read.
      await catalogue.setMenuItemExtraLists(tx, premiumCafeOfferId, [
        {
          listId: attached.listId,
          items: [{ productId: attached.productId, price: "0.75", available: true }],
        },
      ]);
      return attached;
    });
    const id = randomUUID();
    await parkOrder({ db }, cfg, {
      id,
      zoneId,
      lines: [
        {
          menuItemId: premiumCafeOfferId,
          quantity: "2",
          extras: [{ listId: extra.listId, picks: [{ productId: extra.productId, quantity: 2 }] }],
          note: "Sin espuma",
        },
      ],
    });

    const order = await getHeldOrder({ db }, cfg, id);

    expect(order.lines).toEqual([
      expect.objectContaining({
        workingOrderLineId: expect.any(String),
        menuItemId: premiumCafeOfferId,
        productId: cafeId,
        quantity: "2.000",
        note: "Sin espuma",
        extras: [
          {
            productId: extra.productId,
            name: "Leche staff",
            descriptions: { [LOCALE]: "Leche customer" },
            kitchenName: "Leche kitchen",
            price: "0.75",
            quantity: 2,
          },
        ],
      }),
    ]);
  });

  it("returns the parked offer's identity and snapshots after its live product changes", async () => {
    const { cfg, zoneId, cafeId, premiumCafeOfferId } = await setupVenue();
    const id = randomUUID();
    // Give the product a customer name that DIFFERS from its staff name before parking, so the two
    // frozen halves below cannot be confused for one another.
    await db.execute(sql`
      update products set customer_name = ${JSON.stringify({ [LOCALE]: "Café de la casa" })}
      where id = ${cafeId}`);
    await parkOrder({ db }, cfg, {
      id,
      zoneId,
      lines: [{ menuItemId: premiumCafeOfferId, quantity: "1" }],
    });
    await db.execute(sql`
      update products
      set name = 'Renamed café',
          customer_name = ${JSON.stringify({ [LOCALE]: "Renamed café de la casa" })},
          pricing_unit = 'weight', vat_class = 'reduced',
          allergens = ${JSON.stringify({ milk: { presence: "contains" } })}
      where id = ${cafeId}`);
    await db.execute(sql`
      update menu_items set active = false where id = ${premiumCafeOfferId}`);

    const order = await getHeldOrder({ db }, cfg, id);
    expect(order.lines).toEqual([
      expect.objectContaining({
        menuItemId: premiumCafeOfferId,
        productId: cafeId,
        quantity: "1.000",
        product: expect.objectContaining({
          id: cafeId,
          productId: cafeId,
          menuItemId: premiumCafeOfferId,
          // Both frozen halves survive the rename, and they are distinct text.
          name: "Café",
          customerName: { [LOCALE]: "Café de la casa" },
          // The café is priced by the each (no unit), so its snapshot resolves to the synthetic
          // Each unit — frozen at park time, unaffected by the live product's switch to weight above.
          unit: {
            id: EACH_UNIT.id,
            name: EACH_UNIT.name,
            precision: EACH_UNIT.precision,
            hardwareUnit: EACH_UNIT.hardwareUnit,
          },
          unitPrice: "3.25",
          vatClass: "general",
          category: "Bebidas",
          allergens: null,
          catalogueName: "Carta premium",
        }),
      }),
    ]);
  });

  it("returns the open order's product/quantity lines, ordered by lineNo", async () => {
    const { cfg, cafeId, aguaId } = await setupVenue();
    const id = randomUUID();
    await parkOrder({ db }, cfg, {
      id,
      label: "Mesa 7",
      lines: [
        { productId: cafeId, quantity: "1" },
        { productId: aguaId, quantity: "3" },
      ],
    });

    const order = await getHeldOrder({ db }, cfg, id);
    // Saved selections and quantities return in lineNo order; a quantity reads back at the three
    // places `thousandthsToDecimal` renders.
    expect(order).toEqual({
      id,
      orderNumber: 1,
      label: "Mesa 7",
      lines: [
        { productId: cafeId, quantity: "1.000", optionSnapshots: [] },
        { productId: aguaId, quantity: "3.000", optionSnapshots: [] },
      ],
    });
  });

  it("throws working_order.not_found for an unknown id", async () => {
    const { cfg } = await setupVenue();
    const missing = randomUUID();
    await expect(getHeldOrder({ db }, cfg, missing)).rejects.toMatchObject({
      code: "working_order.not_found",
      params: { workingOrderId: missing },
    });
  });

  it("throws working_order.not_found for a settled (non-open) order — closed is not retrievable", async () => {
    const { cfg, cafeId } = await setupVenue();
    const id = randomUUID();
    await parkOrder({ db }, cfg, { id, lines: [{ productId: cafeId, quantity: "1" }] });
    await setStatus(id, "settled");

    await expect(getHeldOrder({ db }, cfg, id)).rejects.toMatchObject({
      code: "working_order.not_found",
      params: { workingOrderId: id },
    });
  });

  it("retrieves an open order from ANOTHER node of the same tenant — reads are venue-wide (till-reroute §3.6)", async () => {
    const { cfg } = await setupVenue();
    const foreign = await seedForeignNodeOrder(cfg);

    // The by-id lookup reaches the foreign-node order like the node's own — a promoted node inherits it.
    const order = await getHeldOrder({ db }, cfg, foreign);
    expect(order.id).toBe(foreign);
    expect(order.lines).toEqual([]);
  });
});

describe("updateHeldOrder", () => {
  it("keeps extras rows and customisation on a quantity-only edit", async () => {
    const { cfg, zoneId, cafeId, catalogueId, premiumCafeOfferId } = await setupVenue();
    const extra = await withTransaction(db, async (tx) => {
      const attached = await addExtraList(tx, catalogueId, cafeId, "Leche", {
        price: "0.10",
        maxQuantity: 2,
        maxPicks: 2,
      });
      await catalogue.setMenuItemExtraLists(tx, premiumCafeOfferId, [
        {
          listId: attached.listId,
          items: [{ productId: attached.productId, price: "0.75", available: true }],
        },
      ]);
      return attached;
    });
    const id = randomUUID();
    const picks = [{ productId: extra.productId, quantity: 2 }];
    await parkOrder({ db }, cfg, {
      id,
      zoneId,
      lines: [
        {
          menuItemId: premiumCafeOfferId,
          quantity: "1",
          extras: [{ listId: extra.listId, picks }],
          note: "Sin espuma",
        },
      ],
    });
    const before = await db.execute<{
      id: string;
      parent_line_id: string | null;
      unit_price_gross: number;
    }>(sql`
      select id, parent_line_id, cast(unit_price_gross as int) as unit_price_gross
      from working_order_lines
      where working_order_id = ${id} order by line_no`);

    await db.execute(sql`
      update menu_items set gross_price = 900 where id = ${premiumCafeOfferId}`);
    await db.execute(sql`
      update menu_item_extra_items set price = 400 where menu_item_id = ${premiumCafeOfferId}`);
    await updateHeldOrder({ db }, cfg, id, {
      lines: [
        {
          workingOrderLineId: before.rows[0]!.id,
          menuItemId: premiumCafeOfferId,
          quantity: "3",
          extras: [{ listId: extra.listId, picks }],
          note: "Sin espuma",
        },
      ],
    });

    const after = await db.execute<{
      id: string;
      parent_line_id: string | null;
      quantity: string;
      unit_price_gross: number;
      line_total: number;
    }>(sql`
      select id, parent_line_id, cast(quantity as text) as quantity,
             cast(unit_price_gross as int) as unit_price_gross, cast(line_total as int) as line_total
      from working_order_lines
      where working_order_id = ${id} order by line_no`);
    // The quantities are counts of whole thousandths: three dishes and their six picks.
    expect(after.rows).toEqual([
      {
        id: before.rows[0]!.id,
        parent_line_id: null,
        quantity: "3000",
        unit_price_gross: 325,
        line_total: 975,
      },
      {
        id: before.rows[1]!.id,
        parent_line_id: before.rows[0]!.id,
        quantity: "6000",
        unit_price_gross: 75,
        line_total: 450,
      },
    ]);
  });

  it("keeps a quantity-only offer edit on the original line id and locked price", async () => {
    const { cfg, zoneId, premiumCafeOfferId } = await setupVenue();
    const id = randomUUID();
    await parkOrder({ db }, cfg, {
      id,
      zoneId,
      lines: [{ menuItemId: premiumCafeOfferId, quantity: "1" }],
    });
    const before = await db.execute<{ id: string }>(sql`
      select id from working_order_lines
      where working_order_id = ${id}`);
    const lineId = before.rows[0]!.id;

    await db.execute(sql`
      update menu_items set gross_price = 900 where id = ${premiumCafeOfferId}`);
    await updateHeldOrder({ db }, cfg, id, {
      lines: [
        {
          workingOrderLineId: lineId,
          menuItemId: premiumCafeOfferId,
          quantity: "2",
        },
      ],
    });

    const after = await db.execute<{
      id: string;
      quantity: string;
      unit_price_gross: number;
      line_total: number;
    }>(sql`
      select id, cast(quantity as text) as quantity, cast(unit_price_gross as int) as unit_price_gross,
             cast(line_total as int) as line_total
      from working_order_lines
      where working_order_id = ${id}`);
    // Two units, as a count of whole thousandths.
    expect(after.rows).toEqual([
      {
        id: lineId,
        quantity: "2000",
        unit_price_gross: 325,
        line_total: 650,
      },
    ]);
  });

  it("replaces an offer line using the order's stored zone and refreshes its attribution", async () => {
    const { cfg, zoneId, premiumCafeOfferId } = await setupVenue();
    const id = randomUUID();
    await parkOrder({ db }, cfg, {
      id,
      zoneId,
      lines: [{ menuItemId: premiumCafeOfferId, quantity: "1" }],
    });

    await updateHeldOrder({ db }, cfg, id, {
      lines: [{ menuItemId: premiumCafeOfferId, quantity: "2" }],
    });

    const line = await db.execute<{
      quantity: string;
      unit_price_gross: number;
      menu_item_id: string;
    }>(sql`
      select cast(l.quantity as text) as quantity, cast(l.unit_price_gross as int) as unit_price_gross,
             c.menu_item_id
      from working_order_lines l
      join working_line_contexts c on c.working_order_line_id = l.id
      where l.working_order_id = ${id}`);
    // Two units, as a count of whole thousandths.
    expect(line.rows).toEqual([
      { quantity: "2000", unit_price_gross: 325, menu_item_id: premiumCafeOfferId },
    ]);
  });

  it("replaces the lines, re-prices the total and updates the label, leaving the order row otherwise unchanged", async () => {
    const { cfg, cafeId, aguaId } = await setupVenue();
    const id = randomUUID();
    await parkOrder({ db }, cfg, {
      id,
      lines: [{ productId: cafeId, quantity: "2" }],
      label: "Mesa 4",
    });
    const [beforeSummary] = await listHeldOrders({ db }, cfg);

    // A fresh basket in a deliberately different order (agua first) — proving the per-line product_id
    // zip is re-applied, the line_no is re-numbered from 1, and the total is re-priced authoritatively.
    const newLines = [
      { productId: aguaId, quantity: "1" },
      { productId: cafeId, quantity: "1" },
    ];
    await updateHeldOrder({ db }, cfg, id, { lines: newLines, label: "Mesa 7" });

    // order_number / node_id / till_id are untouched; only the label changed and the
    // status stays open (the update ran over the enforce_transition trigger, not around it).
    const [wo] = await db.select().from(workingOrders).where(eq(workingOrders.id, id));
    expect(wo).toMatchObject({
      status: "open",
      label: "Mesa 7",
      orderNumber: 1,
      nodeId: cfg.nodeId,
      tillId: cfg.tillId,
      settledAt: null,
    });

    // The old café line is gone; the two new lines carry the new products, re-numbered from 1.
    const lines = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ lineNo: 1, productId: aguaId });
    expect(lines[1]).toMatchObject({ lineNo: 2, productId: cafeId });

    // Re-priced: the new total differs from the parked one AND equals the GROSS basket total for the
    // replaced lines (`priceBasket(newLines).total`, computed independently of the persisted column) —
    // agua 2.00 + café 1.50 = 3.50 gross, where the parked cafe×2 was 3.00. Asserting against the
    // gross pricer (not the summed line_total column) is what fails if the held total reverts to net.
    const grossAfter = await grossBasketTotal(cfg, newLines);
    expect(grossAfter).toBe("3.50");
    const [afterSummary] = await listHeldOrders({ db }, cfg);
    expect(afterSummary!.itemCount).toBe(2);
    expect(afterSummary!.total).not.toBe(beforeSummary!.total);
    expect(afterSummary!.total).toBe(grossAfter);
  });

  it("clears the label to null when the update omits one — the whole request is the new state", async () => {
    const { cfg, cafeId, aguaId } = await setupVenue();
    const id = randomUUID();
    await parkOrder({ db }, cfg, {
      id,
      lines: [{ productId: cafeId, quantity: "1" }],
      label: "Mesa 4",
    });

    // No label on the update: a label is part of the order's state, so omitting it clears the
    // parked "Mesa 4" rather than leaving it in place.
    await updateHeldOrder({ db }, cfg, id, { lines: [{ productId: aguaId, quantity: "1" }] });

    const [wo] = await db.select().from(workingOrders).where(eq(workingOrders.id, id));
    expect(wo!.label).toBeNull();
  });

  it("refuses an empty basket (sale.empty_basket) and an unknown product (sale.unknown_product), leaving the parked lines untouched", async () => {
    const { cfg, cafeId } = await setupVenue();
    const id = randomUUID();
    await parkOrder({ db }, cfg, {
      id,
      lines: [{ productId: cafeId, quantity: "2" }],
      label: "Mesa 4",
    });
    const before = await readOrder(id);
    const UUID_NOT_IN_CAT = "00000000-0000-0000-0000-000000000000";

    await expect(updateHeldOrder({ db }, cfg, id, { lines: [] })).rejects.toMatchObject({
      code: "sale.empty_basket",
    });
    await expect(
      updateHeldOrder({ db }, cfg, id, { lines: [{ productId: UUID_NOT_IN_CAT, quantity: "1" }] }),
    ).rejects.toMatchObject({
      code: "sale.unknown_product",
      params: { productId: UUID_NOT_IN_CAT },
    });

    // Both refusals happen before any line is deleted, so the parked order still holds its one
    // original café line unchanged.
    const after = await readOrder(id);
    expect(after.lineTotals).toEqual(before.lineTotals);
    const lines = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ productId: cafeId, lineNo: 1 });
  });

  it("throws working_order.not_open on a settled order — a closed order can no longer be edited", async () => {
    const { cfg, cafeId } = await setupVenue();
    const id = randomUUID();
    await parkOrder({ db }, cfg, { id, lines: [{ productId: cafeId, quantity: "1" }] });
    await setStatus(id, "settled");

    await expect(
      updateHeldOrder({ db }, cfg, id, { lines: [{ productId: cafeId, quantity: "2" }] }),
    ).rejects.toMatchObject({
      code: "working_order.not_open",
      params: { workingOrderId: id },
    });
  });

  it("throws working_order.not_open for an absent id", async () => {
    const { cfg, cafeId } = await setupVenue();
    const missing = randomUUID();

    await expect(
      updateHeldOrder({ db }, cfg, missing, { lines: [{ productId: cafeId, quantity: "1" }] }),
    ).rejects.toMatchObject({
      code: "working_order.not_open",
      params: { workingOrderId: missing },
    });
  });

  it("edits an open order from ANOTHER node of the same tenant — reads are venue-wide (till-reroute §3.6)", async () => {
    const { cfg, cafeId } = await setupVenue();
    const foreign = await seedForeignNodeOrder(cfg);

    // The foreign-node order is edited like the node's own: the whole-basket replacement lands.
    await expect(
      updateHeldOrder({ db }, cfg, foreign, { lines: [{ productId: cafeId, quantity: "1" }] }),
    ).resolves.toBeUndefined();
    const after = await getHeldOrder({ db }, cfg, foreign);
    expect(after.lines).toHaveLength(1);
    expect(after.lines[0]!.productId).toBe(cafeId);
    expect(Number(after.lines[0]!.quantity)).toBe(1);
  });
});

describe("abandonHeldOrder", () => {
  it("flips an open order to abandoned and drops it from the held list, leaving settled_at null", async () => {
    const { cfg, cafeId } = await setupVenue();
    const id = randomUUID();
    await parkOrder({ db }, cfg, { id, lines: [{ productId: cafeId, quantity: "1" }] });
    expect((await listHeldOrders({ db }, cfg)).map((o) => o.id)).toEqual([id]);

    await abandonHeldOrder({ db }, cfg, id);

    const [wo] = await db.select().from(workingOrders).where(eq(workingOrders.id, id));
    // abandoned is terminal and carries NO settled_at (the settled_at biconditional): only `settled`
    // may set it. The held list, filtered to status = 'open', no longer shows the order.
    expect(wo).toMatchObject({ status: "abandoned", settledAt: null });
    expect(await listHeldOrders({ db }, cfg)).toEqual([]);
  });

  it("throws working_order.not_open on an already-abandoned order", async () => {
    const { cfg, cafeId } = await setupVenue();
    const id = randomUUID();
    await parkOrder({ db }, cfg, { id, lines: [{ productId: cafeId, quantity: "1" }] });
    await abandonHeldOrder({ db }, cfg, id);

    await expect(abandonHeldOrder({ db }, cfg, id)).rejects.toMatchObject({
      code: "working_order.not_open",
      params: { workingOrderId: id },
    });
  });

  it("throws working_order.not_open on a settled order and on an absent id", async () => {
    const { cfg, cafeId } = await setupVenue();
    const id = randomUUID();
    await parkOrder({ db }, cfg, { id, lines: [{ productId: cafeId, quantity: "1" }] });
    await setStatus(id, "settled");

    await expect(abandonHeldOrder({ db }, cfg, id)).rejects.toMatchObject({
      code: "working_order.not_open",
      params: { workingOrderId: id },
    });

    const missing = randomUUID();
    await expect(abandonHeldOrder({ db }, cfg, missing)).rejects.toMatchObject({
      code: "working_order.not_open",
      params: { workingOrderId: missing },
    });
  });

  it("abandons an open order from ANOTHER node of the same tenant — reads are venue-wide (till-reroute §3.6)", async () => {
    const { cfg } = await setupVenue();
    const foreign = await seedForeignNodeOrder(cfg);

    // The conditional UPDATE reaches the foreign-node open order and abandons it like the node's own.
    await expect(abandonHeldOrder({ db }, cfg, foreign)).resolves.toBeUndefined();
    const [wo] = await db.select().from(workingOrders).where(eq(workingOrders.id, foreign));
    expect(wo).toMatchObject({ status: "abandoned", settledAt: null });
  });
});

// ---------------------------------------------------------------------------------------------------
// KDS-1 Task 3 — fire → ticket items. `fireLines` resolves `product ?? category ?? default` and
// SNAPSHOTS the station onto each ticket item; the three fire points (placeOrder, sendToPrep, and a
// tab's round-send via addTabRound) funnel through it. PGlite proves the resolver, the snapshot rule
// and the no-default refusal — plain SQL a single backend proves; the `ticket_items` schema's own
// columns, unique and cascade are real-Postgres's job (packages/db `ticket-items.test.ts`). Every
// write runs through `withTransaction`.
// ---------------------------------------------------------------------------------------------------

/** The accountable operator a placing amendment is attributed to (a fixed fixture uuid — only ever
 *  stored, never joined; mirrors working-order.pay-and-dispatch.test.ts's OPERATOR). */
const OPERATOR = "0000ffff-2222-4000-8000-0000000000aa";

/** A trusted-clock stub: placeOrder reads only `now()` for its amendment's wall-clock. */
const stubClock = {
  now: () => ({ instant: new Date(), offsetMinutes: 0 }),
} as unknown as TrustedClock;

/** A fiscal-backend stub — never touched on the non-`invoice_first` placing paths these tests exercise. */
const stubBackend = {} as unknown as FiscalBackend;

/** A basket line for a product at quantity 1 — the shape createOpenOrder/fireLines consume. */
const line = (productId: string) => ({ productId, quantity: "1" });

/** Create a sellable product in the venue's catalogue, optionally with a category and/or a station
 *  override; returns its id. Descriptions match the location's single locale so `check_locales` passes. */
async function makeProduct(
  tx: Transaction,
  cfg: TillConfig,
  catalogueId: string,
  route: { categoryId?: string; stationId?: string },
): Promise<string> {
  const { id } = await createProduct(tx, {
    catalogueId,
    categoryId: route.categoryId ?? null,
    name: `P-${randomUUID().slice(0, 8)}`,
    pricingUnit: "each",
    unitPrice: "1.50",
    vatClass: "general",
  });
  if (route.stationId !== undefined) {
    await setProductStation(tx, cfg, id, route.stationId);
  }
  return id;
}

/** Create a station, an active cloud-poll printer, and attach the printer to it — the createStation +
 *  createPrinter + attachPrinterToStation trio the print-on-fire / correction-slip tests repeat verbatim.
 *  Returns the created station and the printer id (call sites use whichever they need). */
async function attachedPrinter(
  tx: Transaction,
  cfg: TillConfig,
  station: { name: string; isDefault?: boolean },
  printerName: string,
): Promise<{ station: Awaited<ReturnType<typeof createStation>>; printerId: string }> {
  const printCfg: PrintConfig = { locationId: cfg.locationId };
  const created = await createStation(tx, cfg, station);
  const { id: printerId } = await createPrinter(tx, printCfg, {
    name: printerName,
    transport: "cloud_poll",
    pollId: `poll-${randomUUID()}`,
  });
  await attachPrinterToStation(tx, { stationId: created.id, printerId });
  return { station: created, printerId };
}

/** Insert an active dining table in the venue and return its id (for the openTab → addTabRound path). */
async function makeTable(tx: Transaction, cfg: TillConfig): Promise<string> {
  const { rows } = await tx.execute<{ id: string }>(sql`
    insert into dining_tables (id, location_id, label, created_at)
    values (${randomUUID()}, ${cfg.locationId}, ${`T-${randomUUID().slice(0, 8)}`}, ${nowIso()})
    returning id`);
  return rows[0]!.id;
}

/** Open a fresh working order carrying `lines` and FIRE it — the same read-lines → fireLines sequence
 *  placeOrder/sendToPrep run, isolated onto the caller's tx so the resolver + snapshot can be asserted
 *  without the fiscal machinery. Returns the order's id. */
async function placeOrderWith(
  tx: Transaction,
  cfg: TillConfig,
  // `note` is the per-line KDS customisation (spec §2/§3, NON-FISCAL) — `createOpenOrder` validates
  // and persists it on the parent dish line, and `fireLines` snapshots it onto the ticket.
  lines: {
    productId: string;
    quantity: string;
    extras?: ExtraSelection[];
    options?: OptionSelection[];
    note?: string;
  }[],
): Promise<{ id: string }> {
  const id = randomUUID();
  await createOpenOrder(tx, cfg, id, lines, null);
  const fired = await tx
    .select({
      id: workingOrderLines.id,
      productId: workingOrderLines.productId,
      courseId: workingOrderLines.courseId,
      parentLineId: workingOrderLines.parentLineId,
      note: workingOrderLines.note,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, id))
    .orderBy(workingOrderLines.lineNo);
  await fireLines(tx, cfg, id, fired);
  return { id };
}

/** Attach a fresh one-product extras list to `dishId`, priced 0.50 at the reduced rate — the shape a
 *  line's `extras: [{ listId, picks: [{ productId }] }]` picks from, for the child-line tests.
 *
 *  The extra's OWN allergens and dietary labels live on the PRODUCT the list offers, which is where
 *  the kitchen and expo reads take them from. Omitted leaves `allergens` null and the declarations
 *  empty. */
async function addExtra(
  tx: Transaction,
  catalogueId: string,
  dishId: string,
  name: string,
  overlay?: {
    add?: AllergenMap;
    suitableFor?: DietaryLabel[];
  },
): Promise<{ listId: string; productId: string }> {
  const offered = await createProduct(tx, {
    catalogueId,
    categoryId: null,
    name,
    pricingUnit: "each",
    unitPrice: "9.99",
    vatClass: "reduced",
    ...(overlay?.add === undefined ? {} : { allergens: overlay.add }),
    ...(overlay?.suitableFor === undefined ? {} : { dietaryDeclarations: overlay.suitableFor }),
  });
  const list = await catalogue.createExtraList(
    tx,
    {
      name: `${name} list`,
      customerName: null,
      kitchenName: null,
      minPicks: 0,
      maxPicks: 1,
      active: true,
      items: [{ productId: offered.id, maxQuantity: 1, preselected: false, price: "0.50" }],
    },
    LOCALE,
  );
  await attachModifierList(tx, dishId, { kind: "extras", id: list.id });
  return { listId: list.id, productId: offered.id };
}

/** The order's ticket items joined back to each line's product, for asserting where each line routed. */
async function ticketItemsFor(
  tx: Transaction,
  orderId: string,
): Promise<{ productId: string | null; stationId: string; state: string }[]> {
  return tx
    .select({
      productId: workingOrderLines.productId,
      stationId: ticketItems.stationId,
      state: ticketItems.state,
    })
    .from(ticketItems)
    .innerJoin(workingOrderLines, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .where(eq(ticketItems.workingOrderId, orderId));
}

const byProduct = (
  items: { productId: string | null; stationId: string; state: string }[],
  productId: string,
) => items.find((i) => i.productId === productId)!;

describe("createOpenOrder empty-basket skips the full catalogue read (perf)", () => {
  afterEach(() => vi.restoreAllMocks());

  // A lineless order (every splitOffCheck, a lineless openTab, unjoin's new tab) has nothing to resolve
  // or price, so priceOrderLines must NOT issue the full listAvailableProducts scan. Behaviour alone
  // can't distinguish this (an empty basket yields an empty order either way), so SPY the catalogue read
  // and assert it is skipped for [] and taken for a real line. Proven by deletion: remove the early
  // return in priceOrderLines and the empty-lines case calls the spy → this test fails.
  it("does NOT call listAvailableProducts for an empty basket", async () => {
    const { cfg } = await setupVenue();
    const spy = vi.spyOn(catalogue, "listAvailableProducts");
    await withTransaction(db, async (tx) => {
      await createOpenOrder(tx, cfg, randomUUID(), [], null);
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("DOES call listAvailableProducts for a non-empty basket (negative control)", async () => {
    const { cfg, cafeId } = await setupVenue();
    const spy = vi.spyOn(catalogue, "listAvailableProducts");
    await withTransaction(db, async (tx) => {
      await createOpenOrder(tx, cfg, randomUUID(), [line(cafeId)], null);
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("basket-wide modifier resolution (perf)", () => {
  afterEach(() => vi.restoreAllMocks());

  // CLAUDE.md §3: shared catalogue data is resolved ONCE before the line loop, never per line.
  // The two THREE-LINE baskets below — the same dish twice, then a second dish — are what can see
  // that: a resolver moved inside the loop resolves three times instead of once. Behaviour alone
  // cannot tell the two apart (the same order comes out either way), so the resolver is spied on.
  // Proven by mutation: moving the `resolveBasketModifiers` call in `priceOrderLines` inside the
  // line loop takes those two from 1 to 3 ("expected resolveAttachedModifiers to be called 1
  // times, but got 3 times").
  // The MIDDLE case is not one of them and does not cover the line loop at all: its basket is a
  // SINGLE line, so it reads 1 either way, and it passed under that same mutation. What it pins is
  // a different thing — that a preserve check which cannot hold does not resolve the catalogue a
  // SECOND time on top of `priceOrderLines`.
  //
  // What is spied on is `resolveAttachedModifiers` — the ORDER path's own way into the shared walk,
  // and the only caller of it in product code (`resolveBasketModifiers`, working-order.ts). It is
  // NOT what the two reads a till sells from call: those reach the shared body,
  // `walkAttachedModifiers`, through `readOfferedModifiers`, so nothing counted here says anything
  // about what a till is offered (packages/catalogue/src/offered-modifiers.ts). The readers that
  // body calls are not reachable from here either: it calls them through its own relative imports,
  // which are different namespace objects from the `@waitron/catalogue` index these spies replace
  // bindings on. Which reader each side of a basket reaches, and that the attachments map is handed
  // on rather than read twice, is covered where the walk lives — "one shared resolution for a set
  // of dishes" (packages/catalogue/src/offered-modifiers.test.ts).

  it("reads each PRODUCT-side definition once for a walk-up basket", async () => {
    const { cfg, cafeId, aguaId, catalogueId } = await setupVenue();
    const seeded = await withTransaction(db, async (tx) => {
      await addExtraList(tx, catalogueId, cafeId, "Bacon");
      const cafe = await addOptionList(tx, cafeId, "Punto");
      await addExtraList(tx, catalogueId, aguaId, "Hielo");
      const agua = await addOptionList(tx, aguaId, "Tamano");
      return { cafe, agua };
    });
    const resolve = vi.spyOn(catalogue, "resolveAttachedModifiers");

    await parkOrder({ db }, cfg, {
      id: randomUUID(),
      lines: [
        {
          productId: cafeId,
          quantity: "1",
          options: [{ listId: seeded.cafe.listId, labelId: seeded.cafe.labelIds[0]! }],
        },
        {
          productId: cafeId,
          quantity: "2",
          options: [{ listId: seeded.cafe.listId, labelId: seeded.cafe.labelIds[0]! }],
        },
        {
          productId: aguaId,
          quantity: "1",
          options: [{ listId: seeded.agua.listId, labelId: seeded.agua.labelIds[0]! }],
        },
      ],
    });

    expect(resolve).toHaveBeenCalledTimes(1);
    // One entry per line, every one of them on the PRODUCT side: no line names a menu offer, so
    // nothing the resolver is handed can send it to the menu-side read.
    expect(resolve.mock.calls[0]![1]).toEqual([
      { productId: cafeId, menuItemId: null },
      { productId: cafeId, menuItemId: null },
      { productId: aguaId, menuItemId: null },
    ]);
  });

  it("does not resolve the catalogue twice for an edit that cannot be preserved", async () => {
    const { cfg, cafeId, catalogueId } = await setupVenue();
    const seeded = await withTransaction(db, async (tx) => {
      await addExtraList(tx, catalogueId, cafeId, "Bacon");
      return addOptionList(tx, cafeId, "Punto");
    });
    const answer = { listId: seeded.listId, labelId: seeded.labelIds[0]! };
    const id = randomUUID();
    await parkOrder({ db }, cfg, {
      id,
      lines: [{ productId: cafeId, quantity: "1", options: [answer], note: "sin sal" }],
    });
    const held = await getHeldOrder({ db }, cfg, id);

    const contentLanguages = vi.spyOn(catalogue, "readContentLanguages");
    const resolve = vi.spyOn(catalogue, "resolveAttachedModifiers");

    // A changed note is not a quantity-only edit, so this takes the replacement path and is
    // re-priced from the current offer. The preserve check that runs first decides that from the
    // stored `note` alone, which costs nothing — so the catalogue is resolved once, by
    // `priceOrderLines`, and not a second time by a preserve check that was never going to hold.
    await updateHeldOrder({ db }, cfg, id, {
      lines: [
        {
          workingOrderLineId: held.lines[0]!.workingOrderLineId,
          productId: cafeId,
          quantity: "1",
          options: [answer],
          note: "con sal",
        },
      ],
    });

    expect(contentLanguages).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledTimes(1);

    const stored = await db
      .select({ note: workingOrderLines.note })
      .from(workingOrderLines)
      .where(and(eq(workingOrderLines.workingOrderId, id), isNull(workingOrderLines.parentLineId)));
    expect(stored).toEqual([{ note: "con sal" }]);
  });

  it("reads each MENU-side definition once for an offer basket", async () => {
    const { cfg, cafeId, aguaId, catalogueId, zoneId, cafeOfferId } = await setupVenue();
    const seeded = await withTransaction(db, async (tx) => {
      const section = await createMenuSection(tx, {
        menuId: catalogueId,
        name: { [LOCALE]: "Aguas" },
      });
      const aguaOffer = await createMenuItem(tx, {
        menuId: catalogueId,
        productId: aguaId,
        sectionId: section.id,
        grossPrice: "2.20",
      });
      const bacon = await addExtraList(tx, catalogueId, cafeId, "Bacon");
      await catalogue.setMenuItemExtraLists(tx, cafeOfferId, [
        {
          listId: bacon.listId,
          items: [{ productId: bacon.productId, price: "1.00", available: true }],
        },
      ]);
      const cafe = await addOptionList(tx, cafeId, "Punto");
      const agua = await addOptionList(tx, aguaId, "Tamano");
      return { aguaOfferId: aguaOffer.id, cafe, agua };
    });
    const resolve = vi.spyOn(catalogue, "resolveAttachedModifiers");

    await parkOrder({ db }, cfg, {
      id: randomUUID(),
      zoneId,
      lines: [
        {
          menuItemId: cafeOfferId,
          quantity: "1",
          options: [{ listId: seeded.cafe.listId, labelId: seeded.cafe.labelIds[0]! }],
        },
        {
          menuItemId: cafeOfferId,
          quantity: "2",
          options: [{ listId: seeded.cafe.listId, labelId: seeded.cafe.labelIds[0]! }],
        },
        {
          menuItemId: seeded.aguaOfferId,
          quantity: "1",
          options: [{ listId: seeded.agua.listId, labelId: seeded.agua.labelIds[0]! }],
        },
      ],
    });

    expect(resolve).toHaveBeenCalledTimes(1);
    // One entry per line, every one of them carrying the OFFER it was ordered through, so nothing
    // the resolver is handed can send it to the product-side read.
    expect(resolve.mock.calls[0]![1]).toEqual([
      { productId: cafeId, menuItemId: cafeOfferId },
      { productId: cafeId, menuItemId: cafeOfferId },
      { productId: aguaId, menuItemId: seeded.aguaOfferId },
    ]);
  });
});

describe("fireLines (KDS-1 routing resolver + snapshot)", () => {
  it("routes product > category > default and snapshots the station at fire time", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const barra = await createStation(tx, cfg, { name: "Barra" });
      const drinks = await createCategory(tx, { name: { en: "Copas" } });
      await setCategoryStation(tx, cfg, drinks.id, barra.id);
      const cana = await makeProduct(tx, cfg, catalogueId, { categoryId: drinks.id }); // → barra (category)
      const cafe = await makeProduct(tx, cfg, catalogueId, {
        categoryId: drinks.id,
        stationId: cocina.id,
      }); // → cocina (the product override wins over its category default)

      const { id: orderId } = await placeOrderWith(tx, cfg, [line(cana), line(cafe)]);
      const items = await ticketItemsFor(tx, orderId);
      expect(byProduct(items, cana).stationId).toBe(barra.id);
      expect(byProduct(items, cafe).stationId).toBe(cocina.id);
      expect(items.every((i) => i.state === "queued")).toBe(true);

      // Re-route the category AFTER firing. The already-fired item is SNAPSHOTTED, so it does NOT move —
      // the load-bearing rule (re-categorising a product later never reroutes food already sent).
      await setCategoryStation(tx, cfg, drinks.id, cocina.id);
      const after = await ticketItemsFor(tx, orderId);
      expect(byProduct(after, cana).stationId).toBe(barra.id);
    });
  });

  it("routes a multi-category product by its primary category and freezes that label on its line", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const kitchen = await createStation(tx, cfg, { name: "Kitchen", isDefault: true });
      const bar = await createStation(tx, cfg, { name: "Bar" });
      const drinks = await createCategory(tx, { name: { en: "Drinks" } });
      const food = await createCategory(tx, { name: { en: "Food" } });
      await setCategoryStation(tx, cfg, drinks.id, bar.id);
      await setCategoryStation(tx, cfg, food.id, kitchen.id);
      const product = await makeProduct(tx, cfg, catalogueId, { categoryId: drinks.id });
      await replaceProductCategories(tx, product, {
        categoryIds: [food.id, drinks.id],
        primaryCategoryId: drinks.id,
      });

      const { id: orderId } = await placeOrderWith(tx, cfg, [line(product)]);
      expect(byProduct(await ticketItemsFor(tx, orderId), product).stationId).toBe(bar.id);
      const [before] = await tx
        .select({ category: workingOrderLines.category })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, orderId));
      expect(before).toEqual({ category: "Drinks" });

      await updateCategory(tx, drinks.id, {
        name: { en: "Cocktails" },
        parentId: food.id,
      });
      const [after] = await tx
        .select({ category: workingOrderLines.category })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, orderId));
      expect(after).toEqual({ category: "Drinks" });
    });
  });

  it("snapshots the line note at fire, and a later draft edit never moves the fired ticket (NON-FISCAL, spec §2/§3)", async () => {
    // The note counterpart of "Re-route the category AFTER firing" above: a fired ticket_items
    // row is a SNAPSHOT (like station_id/course_id), so editing the working_order_line afterwards must
    // NOT rewrite food already sent to the pass. Task 2's tabs.test.ts already pins that fire CAPTURES
    // the value; this pins that it stays FROZEN against a later edit — the immutability half.
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const p = await makeProduct(tx, cfg, catalogueId, {});
      const { id: orderId } = await placeOrderWith(tx, cfg, [
        { productId: p, quantity: "1", note: "sin cebolla" },
      ]);

      // Fire snapshotted the parent line's note onto the ticket item.
      const [before] = await tx
        .select({ note: ticketItems.note })
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderId, orderId));
      expect(before).toEqual({ note: "sin cebolla" });

      // Edit the DRAFT working_order_line AFTER firing.
      await tx
        .update(workingOrderLines)
        .set({ note: "con cebolla" })
        .where(eq(workingOrderLines.workingOrderId, orderId));

      // Self-contained guard (mirrors verify.test.ts's entorno test): confirm the DRAFT actually
      // changed, so the ticket_items assertion below cannot pass merely because the update no-op'd.
      const [draft] = await tx
        .select({ note: workingOrderLines.note })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, orderId));
      expect(draft).toEqual({ note: "con cebolla" });

      // The already-fired ticket is UNCHANGED — the snapshot did not move.
      const [after] = await tx
        .select({ note: ticketItems.note })
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderId, orderId));
      expect(after).toEqual({ note: "sin cebolla" });
    });
  });

  it("refuses to fire when the location has no default station (station.no_default)", async () => {
    const { cfg, catalogueId } = await setupVenue(); // no default station created
    await withTransaction(db, async (tx) => {
      const uncategorised = await makeProduct(tx, cfg, catalogueId, {}); // no product/category route
      await expect(placeOrderWith(tx, cfg, [line(uncategorised)])).rejects.toMatchObject({
        code: "station.no_default",
        params: { locationId: cfg.locationId },
      });
    });
  });

  it("refuses to fire when the only default station has been DEACTIVATED (station.no_default)", async () => {
    // `deactivateStation` sets `active=false` but leaves `is_default=true`, so the venue keeps a
    // default row that is no longer a live routing target. The fallback query must filter `active=true`,
    // else it resolves the dead station and food routes to a queue the till/station display (active-only)
    // never surface — silently dropped. With the filter it resolves no default and fires fail loud.
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      await deactivateStation(tx, cfg, cocina.id);
      const uncategorised = await makeProduct(tx, cfg, catalogueId, {}); // no product/category route
      await expect(placeOrderWith(tx, cfg, [line(uncategorised)])).rejects.toMatchObject({
        code: "station.no_default",
        params: { locationId: cfg.locationId },
      });
    });
  });

  it("a re-fire of an already-fired line is refused ticket.already_fired, not a raw 23505", async () => {
    const { cfg, catalogueId } = await setupVenue();
    const orderId = await withTransaction(db, async (tx) => {
      await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const p = await makeProduct(tx, cfg, catalogueId, {});
      const { id } = await placeOrderWith(tx, cfg, [line(p)]);
      return id;
    });
    // A SECOND fire of the same lines collides on `ticket_items`' per-line
    // `(working_order_line_id)` unique. `fireLines` maps that 23505 to the domain code
    // (naming the order) rather than leaking the raw constraint error as an opaque 500. The re-fire runs
    // in its OWN transaction so the 23505 poisons that one and the mapped AppError rolls it back cleanly.
    await expect(
      withTransaction(db, async (tx) => {
        const fired = await tx
          .select({
            id: workingOrderLines.id,
            productId: workingOrderLines.productId,
            courseId: workingOrderLines.courseId,
            parentLineId: workingOrderLines.parentLineId,
            note: workingOrderLines.note,
          })
          .from(workingOrderLines)
          .where(eq(workingOrderLines.workingOrderId, orderId));
        await fireLines(tx, cfg, orderId, fired);
      }),
    ).rejects.toMatchObject({
      code: "ticket.already_fired",
      params: { workingOrderId: orderId },
    });
  });

  it("addTabRound fires the appended round's lines to the resolved station (the tab round-send)", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const cafe = await makeProduct(tx, cfg, catalogueId, {});
      const tableId = await makeTable(tx, cfg);
      const { tabId } = await openTab(tx, cfg, { tableId });

      await addTabRound(tx, cfg, tabId, [line(cafe)]);

      const items = await ticketItemsFor(tx, tabId);
      expect(items).toHaveLength(1);
      expect(items[0]!.stationId).toBe(cocina.id);
      expect(items[0]!.state).toBe("queued");
    });
  });

  it("resolves every fired product's venue-service route in ONE batched call", async () => {
    // Two lines of cafe and one of agua: one call carrying each distinct product once, never a call
    // per line or per product on the shared transaction.
    const { cfg, zoneId, catalogueId, premiumCafeOfferId, cafeId, aguaId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await tx.execute(sql`
        update departments set default_service_mode = 'table_tab'
        where location_id = ${cfg.locationId}`);
      const bar = await createStation(tx, cfg, { name: "Bar", isDefault: true });
      const kitchen = await createStation(tx, cfg, { name: "Kitchen" });
      const product = await tx.execute<{ category_id: string }>(sql`
        select category_id from products where id = ${cafeId}`);
      await tx.execute(sql`
        insert into preparation_routes (id, location_id, zone_id, category_id, station_id)
        values (${randomUUID()}, ${cfg.locationId}, ${zoneId}, ${product.rows[0]!.category_id},
          ${bar.id})`);
      await tx.execute(sql`
        insert into preparation_routes (id, location_id, zone_id, product_id, station_id)
        values (${randomUUID()}, ${cfg.locationId}, ${zoneId}, ${aguaId}, ${kitchen.id})`);
      const section = await createMenuSection(tx, {
        menuId: catalogueId,
        name: { [LOCALE]: "Agua" },
      });
      const aguaOffer = await createMenuItem(tx, {
        menuId: catalogueId,
        productId: aguaId,
        sectionId: section.id,
        grossPrice: "2.00",
      });
      const table = await tx.execute<{ id: string }>(sql`
        insert into dining_tables (id, location_id, label, zone_id, created_at)
        values (${randomUUID()}, ${cfg.locationId}, 'Two of a kind', ${zoneId}, ${nowIso()})
        returning id`);
      const { tabId } = await openTab(tx, cfg, { tableId: table.rows[0]!.id });

      const resolveRoutes = vi.spyOn(VENUE_SERVICE, "resolvePreparationRoutes");
      try {
        await addTabRound(tx, cfg, tabId, [
          { menuItemId: premiumCafeOfferId, quantity: "1" },
          { menuItemId: premiumCafeOfferId, quantity: "1" },
          { menuItemId: aguaOffer.id, quantity: "1" },
        ]);
        expect(resolveRoutes).toHaveBeenCalledTimes(1);
        expect(resolveRoutes.mock.calls[0]!.slice(2)).toEqual([zoneId, [cafeId, aguaId]]);
        const items = await ticketItemsFor(tx, tabId);
        expect(items).toHaveLength(3);
        const stationsOf = (productId: string) =>
          items.filter((item) => item.productId === productId).map((item) => item.stationId);
        expect(stationsOf(cafeId)).toEqual([bar.id, bar.id]);
        expect(stationsOf(aguaId)).toEqual([kitchen.id]);
      } finally {
        resolveRoutes.mockRestore();
      }
    });
  });
});

describe("placeOrder / sendToPrep fire ticket items", () => {
  it("placeOrder fires one ticket item per line to the resolved station (Mode T)", async () => {
    const { cfg, catalogueId } = await setupVenue("ticket_then_pay");
    const { cocinaId, cafe } = await withTransaction(db, async (tx) => {
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const p = await makeProduct(tx, cfg, catalogueId, {});
      return { cocinaId: cocina.id, cafe: p };
    });

    const id = randomUUID();
    await parkOrder({ db }, cfg, { id, lines: [line(cafe)] });
    await placeOrder({ db, backend: stubBackend, clock: stubClock }, cfg, id, OPERATOR, cfg.tillId);

    const items = await withTransaction(db, async (tx) => {
      return ticketItemsFor(tx, id);
    });
    expect(items).toHaveLength(1);
    expect(items[0]!.stationId).toBe(cocinaId);
    expect(items[0]!.state).toBe("queued");
  });

  it("sendToPrep refuses an order that is not settled (working_order.not_settled)", async () => {
    const { cfg, cafeId } = await setupVenue();
    const id = randomUUID();
    // An OPEN (parked, never settled) order is ineligible — Mode P's pickup fires only a settled order.
    await parkOrder({ db }, cfg, { id, lines: [{ productId: cafeId, quantity: "1" }] });
    await expect(sendToPrep({ db }, cfg, id)).rejects.toMatchObject({
      code: "working_order.not_settled",
      params: { workingOrderId: id },
    });
  });
});

// KDS-1 Task 4 — bump (advance) + per-station queue read. `advanceTicketItem` is the per-line
// conditional-UPDATE state machine (queued → preparing → ready, illegal moves refused via an empty
// `returning` → `ticket.invalid_transition`); `advanceTicket` bumps every not-yet-`to` line of one
// order at one station together; `listStationQueue` groups a station's items by order, dropping
// collected and abandoned orders. PGlite proves the transition logic, the whole-ticket fan-out and the
// grouping/exclusion filters — plain SQL a single backend proves; the NODE scoping is real-Postgres's
// job (working-order.pay-and-dispatch.test.ts). Every write runs through `withTransaction`.
// ---------------------------------------------------------------------------------------------------

/** The order's ticket items joined to their line, in line_no order — each item's id (the bump target),
 *  line and current state, so a test can address item[0]/item[1] deterministically. */
async function ticketItemRows(
  tx: Transaction,
  orderId: string,
): Promise<{ id: string; lineNo: number; state: string }[]> {
  return tx
    .select({ id: ticketItems.id, lineNo: workingOrderLines.lineNo, state: ticketItems.state })
    .from(ticketItems)
    .innerJoin(workingOrderLines, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .where(eq(ticketItems.workingOrderId, orderId))
    .orderBy(workingOrderLines.lineNo);
}

describe("advanceTicketItem / advanceTicket / listStationQueue (bump + queue)", () => {
  it("bumps a line queued→preparing→ready, refuses illegal moves, and whole-ticket bumps together", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const cafe = await makeProduct(tx, cfg, catalogueId, {});
      const agua = await makeProduct(tx, cfg, catalogueId, {});
      const { id: orderId } = await placeOrderWith(tx, cfg, [line(cafe), line(agua)]); // both → Cocina, queued

      const items = await ticketItemRows(tx, orderId);
      expect(items.map((i) => i.state)).toEqual(["queued", "queued"]);

      // Per-line bump: item[0] walks queued → preparing → ready.
      await advanceTicketItem(tx, cfg, items[0]!.id, "preparing");
      await advanceTicketItem(tx, cfg, items[0]!.id, "ready");

      // Backwards (ready → preparing) is refused via the empty `returning` — the state predicate no
      // longer matches — naming the offending ticket item.
      await expect(advanceTicketItem(tx, cfg, items[0]!.id, "preparing")).rejects.toMatchObject({
        code: "ticket.invalid_transition",
        params: { ticketItemId: items[0]!.id },
      });

      // Whole-ticket bump advances only the still-queued item[1] (item[0], already `ready`, is left
      // alone — it is no longer at the `queued` predecessor).
      await advanceTicket(tx, cfg, orderId, cocina.id, "preparing");

      const queue = await listStationQueue(tx, cocina.id);
      const group = queue.find((g) => g.orderId === orderId)!;
      expect(group.items).toHaveLength(2);
      expect(group.items.map((i) => i.state).sort()).toEqual(["preparing", "ready"]);

      // A second whole-ticket bump to `ready` advances the now-preparing item[1]; item[0] (already
      // `ready`) is skipped — the bulk UPDATE matches only the `preparing` predecessor.
      await advanceTicket(tx, cfg, orderId, cocina.id, "ready");
      const readied = await listStationQueue(tx, cocina.id);
      expect(readied.find((g) => g.orderId === orderId)!.items.map((i) => i.state)).toEqual([
        "ready",
        "ready",
      ]);
    });
  });

  it("advanceTicketItem refuses a skip (queued→ready), to='queued', and a nonexistent item", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const cafe = await makeProduct(tx, cfg, catalogueId, {});
      const { id: orderId } = await placeOrderWith(tx, cfg, [line(cafe)]);
      const [item] = await ticketItemRows(tx, orderId);

      // Skipping preparing (queued → ready) matches no row — `ready`'s only legal predecessor is
      // `preparing` — so the empty `returning` refuses it.
      await expect(advanceTicketItem(tx, cfg, item!.id, "ready")).rejects.toMatchObject({
        code: "ticket.invalid_transition",
        params: { ticketItemId: item!.id },
      });
      // No state legally advances INTO queued — refused before any query.
      await expect(advanceTicketItem(tx, cfg, item!.id, "queued")).rejects.toMatchObject({
        code: "ticket.invalid_transition",
      });
      // An absent id matches no row and returns the same not-found code.
      const missing = randomUUID();
      await expect(advanceTicketItem(tx, cfg, missing, "preparing")).rejects.toMatchObject({
        code: "ticket.invalid_transition",
        params: { ticketItemId: missing },
      });
      // The refusals changed nothing.
      const [after] = await ticketItemRows(tx, orderId);
      expect(after!.state).toBe("queued");
    });
  });

  it("advanceTicketItem refuses a garbage or missing `to` with the same code, not a raw TypeError", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const cafe = await makeProduct(tx, cfg, catalogueId, {});
      const { id: orderId } = await placeOrderWith(tx, cfg, [line(cafe)]);
      const [item] = await ticketItemRows(tx, orderId);

      // A garbage `to` — not a key of TICKET_TRANSITIONS. The till route casts `body.to as TicketState`
      // with no route-level screen, so this is reachable at runtime despite the narrower static type;
      // this is the till-api.ts route comment's claim, exercised directly at the verb.
      await expect(
        advanceTicketItem(tx, cfg, item!.id, "garbage" as unknown as TicketState),
      ).rejects.toMatchObject({
        code: "ticket.invalid_transition",
        params: { ticketItemId: item!.id },
      });
      // A missing `to` — an absent JSON field reaches here as `undefined` the same way.
      await expect(
        advanceTicketItem(tx, cfg, item!.id, undefined as unknown as TicketState),
      ).rejects.toMatchObject({
        code: "ticket.invalid_transition",
        params: { ticketItemId: item!.id },
      });

      // Neither refusal changed the item's state.
      const [after] = await ticketItemRows(tx, orderId);
      expect(after!.state).toBe("queued");
    });
  });

  it("listStationQueue groups a station's items by order oldest-first, dropping collected and abandoned orders", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const barra = await createStation(tx, cfg, { name: "Barra" });
      const cafe = await makeProduct(tx, cfg, catalogueId, {});
      const copa = await makeProduct(tx, cfg, catalogueId, { stationId: barra.id });

      // Order 1 → Cocina (two lines), then order 2 → Cocina (one line) + one line to Barra.
      const { id: order1 } = await placeOrderWith(tx, cfg, [line(cafe), line(cafe)]);
      const { id: order2 } = await placeOrderWith(tx, cfg, [line(cafe), line(copa)]);

      // now() is constant inside this transaction; give the ordering fixture distinct times.
      await tx.execute(
        sql`update ticket_items set queued_at = '2026-07-20T10:00:00Z' where working_order_id = ${order1}`,
      );
      await tx.execute(
        sql`update ticket_items set queued_at = '2026-07-20T10:01:00Z' where working_order_id = ${order2}`,
      );
      const cocinaQueue = await listStationQueue(tx, cocina.id);
      // Two groups, oldest order first; order 1 has two Cocina lines, order 2 has one (its copa went
      // to Barra, so it is NOT in this station's group).
      expect(cocinaQueue.map((g) => g.orderId)).toEqual([order1, order2]);
      expect(cocinaQueue[0]!.items).toHaveLength(2);
      expect(cocinaQueue[1]!.items).toHaveLength(1);
      // The Barra station sees only order 2's copa line.
      const barraQueue = await listStationQueue(tx, barra.id);
      expect(barraQueue.map((g) => g.orderId)).toEqual([order2]);
      expect(barraQueue[0]!.items).toHaveLength(1);

      // Collecting order 1 (handover marker) drops it from the station queue.
      await tx
        .update(workingOrders)
        .set({ collectedAt: nowIso() })
        .where(eq(workingOrders.id, order1));
      expect((await listStationQueue(tx, cocina.id)).map((g) => g.orderId)).toEqual([order2]);

      // Abandoning order 2 drops it too — the queue is empty at Cocina.
      await tx
        .update(workingOrders)
        .set({ status: "abandoned" })
        .where(eq(workingOrders.id, order2));
      expect(await listStationQueue(tx, cocina.id)).toEqual([]);
    });
  });

  it("carries each line's snapshotted kitchen name + quantity, items ordered by line_no", async () => {
    const { cfg, cafeId, aguaId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      // Line 1 → 2× Café, line 2 → 3× Agua, both routed to the default station.
      const { id: orderId } = await placeOrderWith(tx, cfg, [
        { productId: cafeId, quantity: "2" },
        { productId: aguaId, quantity: "3" },
      ]);

      const [group] = await listStationQueue(tx, cocina.id);
      expect(group!.orderId).toBe(orderId);
      expect(group!.items).toHaveLength(2);
      // Items in line_no order, each carrying the line's snapshotted kitchen name + quantity (the
      // stored count read back as "2.000"/"3.000") — what the kitchen display turns into "2× Café".
      // Neither product carries a kitchen name of its own, so each falls back to its staff name.
      expect(group!.items[0]).toMatchObject({
        name: "Café",
        unitName: { en: "ea" },
        unitPrecision: 0,
        quantity: "2.000",
      });
      expect(group!.items[1]).toMatchObject({
        name: "Agua",
        unitName: { en: "ea" },
        unitPrecision: 0,
        quantity: "3.000",
      });
    });
  });

  it("attaches a parent's picked extras as sub-items on listStationQueue and listExpoQueue", async () => {
    const { cfg, cafeId, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      // Café with TWO picked extras — each a child line, never its own ticket item.
      const grande = await addExtra(tx, catalogueId, cafeId, "Grande");
      const avena = await addExtra(tx, catalogueId, cafeId, "Leche avena");
      const { id: orderId } = await placeOrderWith(tx, cfg, [
        {
          productId: cafeId,
          quantity: "1",
          extras: [
            { listId: grande.listId, picks: [{ productId: grande.productId, quantity: 1 }] },
            { listId: avena.listId, picks: [{ productId: avena.productId, quantity: 1 }] },
          ],
        },
      ]);

      // The station queue: ONE item (the parent dish), carrying both options as modifier sub-items, in
      // selection (line_no) order — localised client-side via each modifier's descriptions map.
      const [group] = await listStationQueue(tx, cocina.id);
      expect(group!.orderId).toBe(orderId);
      expect(group!.items).toHaveLength(1);
      // Each option declared no allergens/diet, so its own list is empty (`addAllergens: null`,
      // `suitableFor: []`) — the shape the KDS renders per extra beside the dish's own.
      expect(group!.items[0]!.modifiers).toEqual([
        { descriptions: { [LOCALE]: "Grande" }, addAllergens: null, suitableFor: [] },
        { descriptions: { [LOCALE]: "Leche avena" }, addAllergens: null, suitableFor: [] },
      ]);

      // The expo queue attaches the same modifier sub-items to its item.
      const expo = await listExpoQueue(tx, cfg);
      const expoItem = expo[0]!.courses[0]!.items[0]!;
      expect(expoItem.modifiers).toEqual([
        { descriptions: { [LOCALE]: "Grande" }, addAllergens: null, suitableFor: [] },
        { descriptions: { [LOCALE]: "Leche avena" }, addAllergens: null, suitableFor: [] },
      ]);
    });
  });

  // Order-line customisation (spec §2/§3, Task 5): the station/expo reads surface the SNAPSHOTTED
  // per-line `note` so the cook sees it. Read off `ticket_items` (the snapshot frozen at fire), never
  // the live line — a later draft edit must not change what the kitchen already sees.
  it("surfaces a fired line's snapshotted note on listStationQueue and listExpoQueue", async () => {
    const { cfg, cafeId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const { id: orderId } = await placeOrderWith(tx, cfg, [
        { productId: cafeId, quantity: "1", note: "sin cebolla" },
      ]);

      const [group] = await listStationQueue(tx, cocina.id);
      expect(group!.orderId).toBe(orderId);
      expect(group!.items).toHaveLength(1);
      expect(group!.items[0]!.note).toBe("sin cebolla");

      const expo = await listExpoQueue(tx, cfg);
      const expoItem = expo[0]!.courses[0]!.items[0]!;
      expect(expoItem.note).toBe("sin cebolla");

      // A later DRAFT edit of the parent line does NOT move the fired snapshot the kitchen reads.
      const [parent] = await tx
        .select({ id: workingOrderLines.id })
        .from(workingOrderLines)
        .where(
          and(
            eq(workingOrderLines.workingOrderId, orderId),
            isNull(workingOrderLines.parentLineId),
          ),
        );
      await tx
        .update(workingOrderLines)
        .set({ note: "con cebolla" })
        .where(eq(workingOrderLines.id, parent!.id));
      const [afterEdit] = await listStationQueue(tx, cocina.id);
      expect(afterEdit!.items[0]!.note).toBe("sin cebolla");
    });
  });

  // A plain line (no note) surfaces null — the belt-and-braces default so a cook never sees a phantom
  // instruction, and a plain fixture reads exactly as before this task.
  it("surfaces a null note for a plain fired line", async () => {
    const { cfg, cafeId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      await placeOrderWith(tx, cfg, [{ productId: cafeId, quantity: "1" }]);

      const [group] = await listStationQueue(tx, cocina.id);
      expect(group!.items[0]!.note).toBeNull();
      const expo = await listExpoQueue(tx, cfg);
      expect(expo[0]!.courses[0]!.items[0]!.note).toBeNull();
    });
  });

  // Modifier↔allergen — the KDS station/expo reads attach each fired dish line's OWN allergen profile:
  // the parent product's published allergens, with no modifier contribution. Each extra's own list is
  // shown separately. Display-only; no fiscal path.
  it("attaches the dish's own allergens, ignoring a gluten-removing option", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      // A gluten burger with a "gluten-free bun" option: base `{gluten: contains}`. The option states no
      // allergens of its own; the dish shows its OWN gluten (options are never folded into the dish).
      const burger = await createProduct(tx, {
        catalogueId,
        categoryId: null,
        name: "Hamburguesa",
        pricingUnit: "each",
        unitPrice: "9.00",
        vatClass: "general",
        allergens: { gluten: { presence: "contains" } },
      });
      const gfBun = await addExtra(tx, catalogueId, burger.id, "Pan sin gluten");
      const { id: orderId } = await placeOrderWith(tx, cfg, [
        {
          productId: burger.id,
          quantity: "1",
          extras: [{ listId: gfBun.listId, picks: [{ productId: gfBun.productId, quantity: 1 }] }],
        },
      ]);
      // The parent dish line (parentLineId IS NULL) — the key the queue item is attached under.
      const [parent] = await tx
        .select({ id: workingOrderLines.id })
        .from(workingOrderLines)
        .where(
          and(
            eq(workingOrderLines.workingOrderId, orderId),
            sql`${workingOrderLines.parentLineId} is null`,
          ),
        );
      const parentLineId = parent!.id;

      const queue = await listStationQueue(tx, cocina.id);
      const item = queue
        .flatMap((g) => g.items)
        .find((i) => i.workingOrderLineId === parentLineId)!;
      expect(item.asServed.allergens).toEqual({ gluten: { presence: "contains" } });
      expect(item.asServed.pending).toBe(false);

      // The expo read attaches the same profile to its item.
      const expoItem = (await listExpoQueue(tx, cfg))[0]!.courses[0]!.items[0]!;
      expect(expoItem.asServed.allergens).toEqual({ gluten: { presence: "contains" } });
      expect(expoItem.asServed.pending).toBe(false);
    });
  });

  // A dish whose OWN allergens are unreviewed (products.allergens NULL) stays `pending` — the dish
  // shows only its own (unknown) allergens, and an attached option never changes that.
  it("marks the as-served profile pending when the dish's base allergens are unreviewed", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const dish = await makeProduct(tx, cfg, catalogueId, {}); // no allergens → published NULL
      const opt = await addExtra(tx, catalogueId, dish, "Extra");
      await placeOrderWith(tx, cfg, [
        {
          productId: dish,
          quantity: "1",
          extras: [{ listId: opt.listId, picks: [{ productId: opt.productId, quantity: 1 }] }],
        },
      ]);
      const item = (await listStationQueue(tx, cocina.id))[0]!.items[0]!;
      expect(item.asServed.pending).toBe(true);
      expect(item.asServed.allergens).toEqual({});
    });
  });

  // A PLAIN, modifier-less dish whose base is unreviewed (products.allergens NULL, NO options at all)
  // still gets an as-served profile attached to its parent line — the server errs safe and marks the
  // plate `pending` so the KDS shows it unverified. (Divergence from the till, which SUPPRESSES the row
  // for this same case — pinned in basket.test.ts. Kept as-is: the KDS is deliberately the cautious one.)
  it("attaches a pending profile to a plain, modifier-less unreviewed dish (KDS errs safe)", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const dish = await makeProduct(tx, cfg, catalogueId, {}); // no allergens → published NULL
      await placeOrderWith(tx, cfg, [line(dish)]); // no options at all
      const item = (await listStationQueue(tx, cocina.id))[0]!.items[0]!;
      expect(item.modifiers).toEqual([]);
      expect(item.asServed.pending).toBe(true);
      expect(item.asServed.allergens).toEqual({});
      // The expo read attaches the same pending profile to its item.
      const expoItem = (await listExpoQueue(tx, cfg))[0]!.courses[0]!.items[0]!;
      expect(expoItem.modifiers).toEqual([]);
      expect(expoItem.asServed.pending).toBe(true);
      expect(expoItem.asServed.allergens).toEqual({});
    });
  });

  // An option that ADDS an allergen no longer merges it into the dish's profile — the dish shows its OWN
  // allergens, and the option's added allergen is shown separately (later task).
  it("attaches the dish's own allergens, ignoring an added allergen from an option", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const dish = await createProduct(tx, {
        catalogueId,
        categoryId: null,
        name: "Ensalada",
        pricingUnit: "each",
        unitPrice: "7.00",
        vatClass: "general",
        allergens: { gluten: { presence: "contains" } },
      });
      const nuts = await addExtra(tx, catalogueId, dish.id, "Con nueces", {
        add: { nuts: { presence: "contains" } },
      });
      await placeOrderWith(tx, cfg, [
        {
          productId: dish.id,
          quantity: "1",
          extras: [{ listId: nuts.listId, picks: [{ productId: nuts.productId, quantity: 1 }] }],
        },
      ]);
      const item = (await listStationQueue(tx, cocina.id))[0]!.items[0]!;
      expect(item.asServed.allergens).toEqual({ gluten: { presence: "contains" } });
      expect(item.asServed.pending).toBe(false);
    });
  });

  it("shows the dish's own vegan declaration when an option is selected", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const dish = await createProduct(tx, {
        catalogueId,
        categoryId: null,
        name: "Crema",
        pricingUnit: "each",
        unitPrice: "6.00",
        vatClass: "general",
        dietaryDeclarations: ["vegan"],
      });
      const dairyFree = await addExtra(tx, catalogueId, dish.id, "Sin lácteos", {
        suitableFor: [],
      });
      const { id: orderId } = await placeOrderWith(tx, cfg, [
        {
          productId: dish.id,
          quantity: "1",
          extras: [
            { listId: dairyFree.listId, picks: [{ productId: dairyFree.productId, quantity: 1 }] },
          ],
        },
      ]);
      const [parent] = await tx
        .select({ id: workingOrderLines.id })
        .from(workingOrderLines)
        .where(
          and(
            eq(workingOrderLines.workingOrderId, orderId),
            sql`${workingOrderLines.parentLineId} is null`,
          ),
        );
      const parentLineId = parent!.id;

      const queue = await listStationQueue(tx, cocina.id);
      const item = queue
        .flatMap((g) => g.items)
        .find((i) => i.workingOrderLineId === parentLineId)!;
      expect(item.asServedDiet).toEqual({ vegan: "yes", vegetarian: "yes", contains: [] });

      // The expo read attaches the same profile.
      const expoItem = (await listExpoQueue(tx, cfg))[0]!.courses[0]!.items[0]!;
      expect(expoItem.asServedDiet!.vegan).toBe("yes");
      expect(expoItem.asServedDiet).toEqual({ vegan: "yes", vegetarian: "yes", contains: [] });
    });
  });

  // A selected option that invalidates no-meat used to withhold the dish's vegan/vegetarian claims. The
  // fold is gone: the dish keeps its OWN declared claims, and the option's meat is shown separately.
  it("keeps the dish's own vegan/vegetarian claims regardless of a selected invalidating option", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const dish = await createProduct(tx, {
        catalogueId,
        categoryId: null,
        name: "Ensalada",
        pricingUnit: "each",
        unitPrice: "7.00",
        vatClass: "general",
        dietaryDeclarations: ["vegan"],
      });
      const bacon = await addExtra(tx, catalogueId, dish.id, "Con bacon", {
        add: { milk: { presence: "contains" } },
        suitableFor: ["halal"],
      });
      await placeOrderWith(tx, cfg, [
        {
          productId: dish.id,
          quantity: "1",
          extras: [{ listId: bacon.listId, picks: [{ productId: bacon.productId, quantity: 1 }] }],
        },
      ]);

      const stationItem = (await listStationQueue(tx, cocina.id))[0]!.items[0]!;
      expect(stationItem.asServedDiet).toEqual({
        vegan: "yes",
        vegetarian: "yes",
        contains: [],
      });
      // The dish is NOT folded, but the extra carries its OWN allergens/suitability on the KDS wire so the
      // station display shows the extra's own list beside the dish's own.
      expect(stationItem.modifiers[0]).toMatchObject({
        addAllergens: { milk: { presence: "contains" } },
        suitableFor: ["halal"],
      });
      const expoItem = (await listExpoQueue(tx, cfg))[0]!.courses[0]!.items[0]!;
      expect(expoItem.asServedDiet).toEqual({
        vegan: "yes",
        vegetarian: "yes",
        contains: [],
      });
      expect(expoItem.modifiers[0]).toMatchObject({
        addAllergens: { milk: { presence: "contains" } },
        suitableFor: ["halal"],
      });
    });
  });

  it("reads unknown suitability when a product has no direct declarations", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const dish = await makeProduct(tx, cfg, catalogueId, {});
      await placeOrderWith(tx, cfg, [line(dish)]);

      const item = (await listStationQueue(tx, cocina.id))[0]!.items[0]!;
      expect(item.asServedDiet).toEqual({ vegan: "unknown", vegetarian: "unknown", contains: [] });

      const expoItem = (await listExpoQueue(tx, cfg))[0]!.courses[0]!.items[0]!;
      expect(expoItem.asServedDiet).toEqual({
        vegan: "unknown",
        vegetarian: "unknown",
        contains: [],
      });
    });
  });

  // KDS order-timing alerts (design §3/§6/§11) — the group carries the station's thresholds (Controller
  // Ruling A), each item its own age band classified against them on the DB clock.
  it("bands each item by the station's thresholds and carries them on the group", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true }); // 5/10/15 defaults
      const cafe = await makeProduct(tx, cfg, catalogueId, {});
      const agua = await makeProduct(tx, cfg, catalogueId, {});
      const { id: orderId } = await placeOrderWith(tx, cfg, [line(cafe), line(agua)]);
      const items = await ticketItemRows(tx, orderId);

      // Backdate item[0] past the station's default overdue threshold (10) but under forgotten (15);
      // item[1] stays fresh.
      await tx.execute(
        sql`update ticket_items set queued_at = ${minutesAgo(12)} where id = ${items[0]!.id}`,
      );

      const [group] = await listStationQueue(tx, cocina.id);
      expect(group!.thresholds).toEqual({
        warmAfterMinutes: 5,
        overdueAfterMinutes: 10,
        forgottenAfterMinutes: 15,
      });
      const backdated = group!.items.find((i) => i.id === items[0]!.id)!;
      const fresh = group!.items.find((i) => i.id === items[1]!.id)!;
      expect(backdated.band).toBe("overdue");
      expect(fresh.band).toBe("fresh");
      // Each item carries its OWN queued_at (not just the group's oldest-line anchor) — the widget's
      // TickingClock re-derives the band from this plus the group's thresholds between refreshes.
      expect(typeof backdated.queuedAt).toBe("string");
      expect(typeof fresh.queuedAt).toBe("string");
      expect(backdated.queuedAt).not.toBe(fresh.queuedAt);
    });
  });
});

// PGlite exercises course hold/fire decisions, held-item refusal and fireCourse idempotency.

/** The order's ticket items joined to their line, carrying the fields the hold-and-fire tests read:
 *  the item id (the bump target), its product (to key by line), its snapshotted course and — the
 *  load-bearing one — `fired_at` (NULL = held). */
async function courseItemsFor(
  tx: Transaction,
  orderId: string,
): Promise<
  {
    id: string;
    productId: string | null;
    courseId: string | null;
    firedAt: string | null;
    // KDS-3: the pass's dispatch marker (`null` = not away), read by the expo-verb tests.
    awayAt: string | null;
    state: string;
  }[]
> {
  return tx
    .select({
      id: ticketItems.id,
      productId: workingOrderLines.productId,
      courseId: ticketItems.courseId,
      firedAt: ticketItems.firedAt,
      awayAt: ticketItems.awayAt,
      state: ticketItems.state,
    })
    .from(ticketItems)
    .innerJoin(workingOrderLines, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .where(eq(ticketItems.workingOrderId, orderId));
}

const byLine = <T extends { productId: string | null }>(items: T[], productId: string): T =>
  items.find((i) => i.productId === productId)!;

describe("fireCourse / hold-and-fire (KDS-2 auto-fire-first + held-item advance guard)", () => {
  it("auto-fires the earliest course, holds later ones, and fireCourse releases a held course", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const ent = await createCourse(tx, cfg, { name: "Entrantes", displayOrder: 0 });
      const pri = await createCourse(tx, cfg, { name: "Principales", displayOrder: 1 });
      const soup = await makeProduct(tx, cfg, catalogueId, {});
      const steak = await makeProduct(tx, cfg, catalogueId, {});
      await setProductCourse(tx, cfg, soup, ent.id);
      await setProductCourse(tx, cfg, steak, pri.id);

      const { id: orderId } = await placeOrderWith(tx, cfg, [line(soup), line(steak)]);
      const items = await courseItemsFor(tx, orderId);
      expect(byLine(items, soup).firedAt).not.toBeNull(); // earliest course auto-fired
      expect(byLine(items, steak).firedAt).toBeNull(); // later course held

      // A held item cannot advance — the kitchen must not bump food it has not been told to start.
      await expect(
        advanceTicketItem(tx, cfg, byLine(items, steak).id, "preparing"),
      ).rejects.toMatchObject({ code: "ticket.item_held" });

      // Firing the held course releases its items.
      await fireCourse(tx, cfg, orderId, pri.id);
      const afterFire = await courseItemsFor(tx, orderId);
      expect(byLine(afterFire, steak).firedAt).not.toBeNull();

      // Now advancing the (now fired) steak is allowed.
      await advanceTicketItem(tx, cfg, byLine(afterFire, steak).id, "preparing");
      const advanced = await courseItemsFor(tx, orderId);
      expect(byLine(advanced, steak).state).toBe("preparing");
    });
  });

  it("a null-course line fires immediately (treated as earliest) even while a real later course is held", async () => {
    // §2b: a null course_id has no display_order and fires immediately. Proven alongside a genuine
    // coursed hold: the loose (courseless) line fires at once while the later Principales line waits.
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const ent = await createCourse(tx, cfg, { name: "Entrantes", displayOrder: 0 });
      const pri = await createCourse(tx, cfg, { name: "Principales", displayOrder: 1 });
      const loose = await makeProduct(tx, cfg, catalogueId, {}); // no course → null
      const starter = await makeProduct(tx, cfg, catalogueId, {});
      const main = await makeProduct(tx, cfg, catalogueId, {});
      await setProductCourse(tx, cfg, starter, ent.id);
      await setProductCourse(tx, cfg, main, pri.id);

      const { id: orderId } = await placeOrderWith(tx, cfg, [
        line(loose),
        line(starter),
        line(main),
      ]);
      const items = await courseItemsFor(tx, orderId);
      expect(byLine(items, loose).firedAt).not.toBeNull(); // null course fires immediately
      expect(byLine(items, starter).firedAt).not.toBeNull(); // earliest real course fires
      expect(byLine(items, main).firedAt).toBeNull(); // later course held
    });
  });

  it("fireCourse is idempotent — re-firing an already-fired course leaves its timestamps untouched", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const ent = await createCourse(tx, cfg, { name: "Entrantes", displayOrder: 0 });
      const pri = await createCourse(tx, cfg, { name: "Principales", displayOrder: 1 });
      const starter = await makeProduct(tx, cfg, catalogueId, {});
      const main = await makeProduct(tx, cfg, catalogueId, {});
      await setProductCourse(tx, cfg, starter, ent.id);
      await setProductCourse(tx, cfg, main, pri.id);

      const { id: orderId } = await placeOrderWith(tx, cfg, [line(starter), line(main)]);

      // The earliest course (Entrantes) auto-fired; re-firing it must NOT restamp — its WHERE
      // (`fired_at IS NULL`) matches nothing already-fired.
      const beforeEnt = byLine(await courseItemsFor(tx, orderId), starter).firedAt;
      await fireCourse(tx, cfg, orderId, ent.id);
      expect(byLine(await courseItemsFor(tx, orderId), starter).firedAt).toBe(beforeEnt);

      // Fire the held course, capture its stamp, then fire it AGAIN — the second call is a no-op.
      await fireCourse(tx, cfg, orderId, pri.id);
      const firstStamp = byLine(await courseItemsFor(tx, orderId), main).firedAt;
      expect(firstStamp).not.toBeNull();
      await fireCourse(tx, cfg, orderId, pri.id);
      expect(byLine(await courseItemsFor(tx, orderId), main).firedAt).toBe(firstStamp);
    });
  });

  it("across tab rounds: a later round holds a late course, and joins one already fired for the order", async () => {
    // The incremental tab path (addTabRound fires round by round), where the fired-vs-held decision is
    // taken over the WHOLE order, not just the current round. Two behaviours a single-round place cannot
    // reach: (1) a later round of ONLY a late course stays held — decided by the courses of PRIOR rounds,
    // not the round in hand (without them the round would see itself as the sole, hence earliest, course
    // and wrongly auto-fire); (2) a later item of a course already fired for the order joins it and fires
    // immediately, even when that course is NOT the earliest.
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const ent = await createCourse(tx, cfg, { name: "Entrantes", displayOrder: 0 });
      const pri = await createCourse(tx, cfg, { name: "Principales", displayOrder: 1 });
      const post = await createCourse(tx, cfg, { name: "Postres", displayOrder: 2 });
      const starter = await makeProduct(tx, cfg, catalogueId, {});
      const main = await makeProduct(tx, cfg, catalogueId, {});
      const dessert = await makeProduct(tx, cfg, catalogueId, {});
      await setProductCourse(tx, cfg, starter, ent.id);
      await setProductCourse(tx, cfg, main, pri.id);
      await setProductCourse(tx, cfg, dessert, post.id);
      const tableId = await makeTable(tx, cfg);
      const { tabId } = await openTab(tx, cfg, { tableId });

      // Round 1: starter (Entrantes, earliest) auto-fires; main (Principales) is held.
      await addTabRound(tx, cfg, tabId, [line(starter), line(main)]);
      let items = await courseItemsFor(tx, tabId);
      expect(byLine(items, starter).firedAt).not.toBeNull();
      expect(byLine(items, main).firedAt).toBeNull();

      // Round 2: dessert (Postres) ALONE. It is NOT the order's earliest (Entrantes from round 1 is), so
      // it stays held — decisive proof the earliest is taken over prior rounds, not this batch (a
      // batch-only min would make Postres its own earliest and fire it).
      await addTabRound(tx, cfg, tabId, [line(dessert)]);
      items = await courseItemsFor(tx, tabId);
      expect(byLine(items, dessert).firedAt).toBeNull();

      // Release Principales explicitly — now fired for the order though it is not the earliest course.
      await fireCourse(tx, cfg, tabId, pri.id);
      expect(byLine(await courseItemsFor(tx, tabId), main).firedAt).not.toBeNull();

      // Round 3: another main. Principales is already fired for this order, so this new item joins the
      // fired course and fires at once — the `firedCourseIds` branch, isolated (Principales is not the
      // earliest). Dessert (Postres, still unfired) remains held.
      await addTabRound(tx, cfg, tabId, [line(main)]);
      items = await courseItemsFor(tx, tabId);
      const mains = items.filter((i) => i.productId === main);
      expect(mains).toHaveLength(2);
      expect(mains.every((i) => i.firedAt !== null)).toBe(true);
      expect(byLine(items, dessert).firedAt).toBeNull();
    });
  });

  it("advanceTicket (whole-ticket bump) advances fired items and SKIPS held ones", async () => {
    // §5a: the bulk bump acts only on fired items — a mixed ticket's fired line advances while its held
    // line stays put (no throw, unlike the per-line verb). Both items sit at the same (default) station,
    // so the whole-ticket sweep addresses both; only the fired one is in the match.
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const ent = await createCourse(tx, cfg, { name: "Entrantes", displayOrder: 0 });
      const pri = await createCourse(tx, cfg, { name: "Principales", displayOrder: 1 });
      const starter = await makeProduct(tx, cfg, catalogueId, {});
      const main = await makeProduct(tx, cfg, catalogueId, {});
      await setProductCourse(tx, cfg, starter, ent.id);
      await setProductCourse(tx, cfg, main, pri.id);

      const { id: orderId } = await placeOrderWith(tx, cfg, [line(starter), line(main)]);
      const before = await courseItemsFor(tx, orderId);
      expect(byLine(before, starter).firedAt).not.toBeNull(); // Entrantes auto-fired
      expect(byLine(before, main).firedAt).toBeNull(); // Principales held

      // Whole-ticket bump to preparing: the fired starter advances; the held main is skipped.
      await advanceTicket(tx, cfg, orderId, cocina.id, "preparing");

      const after = await courseItemsFor(tx, orderId);
      expect(byLine(after, starter).state).toBe("preparing"); // fired item advanced
      expect(byLine(after, main).state).toBe("queued"); // held item untouched
      expect(byLine(after, main).firedAt).toBeNull(); // and still held
    });
  });

  it("releases a HELD course's items even after the course is DEACTIVATED (A2: existence, not liveness)", async () => {
    // The deactivated-course edge: a course deactivated WHILE it holds items must still be fireable, or
    // its held items are stranded (can't fire, can't advance). `fireCourse` now requires only that the
    // course EXISTS in this venue (active OR inactive) — the items already carry the `course_id` snapshot
    // — so the release works; the former `requireLiveCourse` gate threw `course.not_found` here forever.
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const ent = await createCourse(tx, cfg, { name: "Entrantes", displayOrder: 0 });
      const pri = await createCourse(tx, cfg, { name: "Principales", displayOrder: 1 });
      const starter = await makeProduct(tx, cfg, catalogueId, {});
      const main = await makeProduct(tx, cfg, catalogueId, {});
      await setProductCourse(tx, cfg, starter, ent.id);
      await setProductCourse(tx, cfg, main, pri.id);

      const { id: orderId } = await placeOrderWith(tx, cfg, [line(starter), line(main)]);
      expect(byLine(await courseItemsFor(tx, orderId), main).firedAt).toBeNull(); // Principales held

      await deactivateCourse(tx, cfg, pri.id);
      await fireCourse(tx, cfg, orderId, pri.id);
      expect(byLine(await courseItemsFor(tx, orderId), main).firedAt).not.toBeNull(); // released
    });
  });

  it("fireCourse rejects an unknown course with course.not_found", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const cafe = await makeProduct(tx, cfg, catalogueId, {});
      const { id: orderId } = await placeOrderWith(tx, cfg, [line(cafe)]);

      const missing = randomUUID();
      await expect(fireCourse(tx, cfg, orderId, missing)).rejects.toMatchObject({
        code: "course.not_found",
        params: { courseId: missing },
      });
    });
  });
});

// Coursing editing (A1) — `setLineCourse` moves a not-yet-fired tab line into another active course (or
// clears it to null), updating BOTH the open-tab line's `course_id` and its held ticket item's snapshot.
// It refuses a line whose ticket item has already FIRED (`ticket.already_fired`) — a fired line is
// corrected via recall, not a silent move — validates a non-null target with the same `requireLiveCourse`
// the config/fire verbs use (`course.not_found` for an absent / foreign / retired course), and throws
// `tab.line_not_found` for a `line_no` not on the tab. Non-fiscal: it touches only `working_order_lines`
// (open tab) and `ticket_items` (kitchen), never a filed record. PGlite proves the update + the guards —
// plain SQL a single backend proves; the two-backend serialisation of a concurrent send/recall/fire is
// real-Postgres's job (working-order.pay-and-dispatch.test.ts). Every write runs through
// `withTransaction`.
// ---------------------------------------------------------------------------------------------------
describe("setLineCourse (A1: move a held line to another course)", () => {
  it("moves a HELD line to another course, updating both course_id snapshots", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const ent = await createCourse(tx, cfg, { name: "Entrantes", displayOrder: 0 });
      const pri = await createCourse(tx, cfg, { name: "Principales", displayOrder: 1 });
      const post = await createCourse(tx, cfg, { name: "Postres", displayOrder: 2 });
      const starter = await makeProduct(tx, cfg, catalogueId, {});
      const main = await makeProduct(tx, cfg, catalogueId, {});
      await setProductCourse(tx, cfg, starter, ent.id);
      await setProductCourse(tx, cfg, main, pri.id);
      const tableId = await makeTable(tx, cfg);
      const { tabId } = await openTab(tx, cfg, { tableId });

      // Ring both: starter (Entrantes, earliest) auto-fires; main (Principales) is HELD — it is line 2.
      await addTabRound(tx, cfg, tabId, [line(starter), line(main)]);
      const before = await courseItemsFor(tx, tabId);
      expect(byLine(before, main).firedAt).toBeNull(); // held — a later course
      expect(byLine(before, main).courseId).toBe(pri.id); // its snapshot sits on Principales

      // Move the held line (line_no 2) onto Postres.
      await setLineCourse(tx, cfg, tabId, 2, post.id);

      // The open-tab line AND its held ticket item snapshot both moved to Postres…
      const [lineRow] = await tx
        .select({ courseId: workingOrderLines.courseId })
        .from(workingOrderLines)
        .where(and(eq(workingOrderLines.workingOrderId, tabId), eq(workingOrderLines.lineNo, 2)));
      expect(lineRow!.courseId).toBe(post.id);
      const after = await courseItemsFor(tx, tabId);
      expect(byLine(after, main).courseId).toBe(post.id);
      expect(byLine(after, main).firedAt).toBeNull(); // …and it is STILL held — a move does not fire it
    });
  });

  it("clears a held line's course to null (fire-earliest), updating both snapshots", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const ent = await createCourse(tx, cfg, { name: "Entrantes", displayOrder: 0 });
      const pri = await createCourse(tx, cfg, { name: "Principales", displayOrder: 1 });
      const starter = await makeProduct(tx, cfg, catalogueId, {});
      const main = await makeProduct(tx, cfg, catalogueId, {});
      await setProductCourse(tx, cfg, starter, ent.id);
      await setProductCourse(tx, cfg, main, pri.id);
      const tableId = await makeTable(tx, cfg);
      const { tabId } = await openTab(tx, cfg, { tableId });
      await addTabRound(tx, cfg, tabId, [line(starter), line(main)]);

      // A null target clears the course (skipping the requireLiveCourse screen).
      await setLineCourse(tx, cfg, tabId, 2, null);

      const [lineRow] = await tx
        .select({ courseId: workingOrderLines.courseId })
        .from(workingOrderLines)
        .where(and(eq(workingOrderLines.workingOrderId, tabId), eq(workingOrderLines.lineNo, 2)));
      expect(lineRow!.courseId).toBeNull();
      expect(byLine(await courseItemsFor(tx, tabId), main).courseId).toBeNull();
    });
  });

  it("refuses to re-course a FIRED line (ticket.already_fired)", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const ent = await createCourse(tx, cfg, { name: "Entrantes", displayOrder: 0 });
      const pri = await createCourse(tx, cfg, { name: "Principales", displayOrder: 1 });
      const starter = await makeProduct(tx, cfg, catalogueId, {});
      await setProductCourse(tx, cfg, starter, ent.id);
      const tableId = await makeTable(tx, cfg);
      const { tabId } = await openTab(tx, cfg, { tableId });
      // A lone Entrantes line is the order's earliest (only) course, so it auto-fires at round-send.
      await addTabRound(tx, cfg, tabId, [line(starter)]);
      expect(byLine(await courseItemsFor(tx, tabId), starter).firedAt).not.toBeNull();

      // Principales is a valid LIVE course, so requireLiveCourse passes — the FIRED guard is what refuses.
      await expect(setLineCourse(tx, cfg, tabId, 1, pri.id)).rejects.toMatchObject({
        code: "ticket.already_fired",
        params: { workingOrderId: tabId },
      });
    });
  });

  it("refuses an unknown OR retired target course (course.not_found)", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const ent = await createCourse(tx, cfg, { name: "Entrantes", displayOrder: 0 });
      const retired = await createCourse(tx, cfg, { name: "Postres", displayOrder: 1 });
      await deactivateCourse(tx, cfg, retired.id);
      const starter = await makeProduct(tx, cfg, catalogueId, {});
      await setProductCourse(tx, cfg, starter, ent.id);
      const tableId = await makeTable(tx, cfg);
      const { tabId } = await openTab(tx, cfg, { tableId });
      await addTabRound(tx, cfg, tabId, [line(starter)]);

      // An id naming no course of this venue — screened by requireLiveCourse BEFORE the line is resolved.
      const missing = randomUUID();
      await expect(setLineCourse(tx, cfg, tabId, 1, missing)).rejects.toMatchObject({
        code: "course.not_found",
        params: { courseId: missing },
      });
      // A DEACTIVATED course is not a valid new target either (liveness, not mere existence).
      await expect(setLineCourse(tx, cfg, tabId, 1, retired.id)).rejects.toMatchObject({
        code: "course.not_found",
        params: { courseId: retired.id },
      });
    });
  });

  it("throws tab.line_not_found for a line_no not on the tab", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const ent = await createCourse(tx, cfg, { name: "Entrantes", displayOrder: 0 });
      const starter = await makeProduct(tx, cfg, catalogueId, {});
      await setProductCourse(tx, cfg, starter, ent.id);
      const tableId = await makeTable(tx, cfg);
      const { tabId } = await openTab(tx, cfg, { tableId });
      await addTabRound(tx, cfg, tabId, [line(starter)]);

      // A live target course, so we get PAST requireLiveCourse to the line-resolution miss.
      await expect(setLineCourse(tx, cfg, tabId, 999, ent.id)).rejects.toMatchObject({
        code: "tab.line_not_found",
        params: { tabId, lineNo: 999 },
      });
    });
  });
});

// sendLines releases selected held items, refreshes queue time and enqueues their kitchen prints.
// PGlite exercises these writes and skips already-fired items.
describe("sendLines (A2: fire specific held lines / send-all)", () => {
  /** A fixed instant well in the past — an aged `queued_at` a same-tx `now()` refresh moves off, so the
   *  refresh is observable (within one transaction `now()` is constant, so an un-aged held line rung and
   *  sent in the same tx would read the identical stamp before and after). */
  const AGED = "2000-01-01T00:00:00.000Z";

  /** Read `(fired_at, queued_at)` for a tab's ticket items, keyed by the line's `line_no` (two lines can
   *  share a product, so `byLine` — which keys on product — cannot address them individually here). */
  async function itemsByLineNo(
    tx: Transaction,
    tabId: string,
  ): Promise<Map<number, { firedAt: string | null; queuedAt: string }>> {
    const rows = await tx
      .select({
        lineNo: workingOrderLines.lineNo,
        firedAt: ticketItems.firedAt,
        queuedAt: ticketItems.queuedAt,
      })
      .from(ticketItems)
      .innerJoin(workingOrderLines, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
      .where(eq(ticketItems.workingOrderId, tabId));
    return new Map(rows.map((r) => [r.lineNo, { firedAt: r.firedAt, queuedAt: r.queuedAt }]));
  }

  it("fires a SUBSET of held lines (refreshing queued_at) and leaves the rest held", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const ent = await createCourse(tx, cfg, { name: "Entrantes", displayOrder: 0 });
      const pri = await createCourse(tx, cfg, { name: "Principales", displayOrder: 1 });
      const starter = await makeProduct(tx, cfg, catalogueId, {});
      const main1 = await makeProduct(tx, cfg, catalogueId, {});
      const main2 = await makeProduct(tx, cfg, catalogueId, {});
      await setProductCourse(tx, cfg, starter, ent.id);
      await setProductCourse(tx, cfg, main1, pri.id);
      await setProductCourse(tx, cfg, main2, pri.id);
      const tableId = await makeTable(tx, cfg);
      const { tabId } = await openTab(tx, cfg, { tableId });

      // Ring three: starter (Entrantes, earliest) auto-fires as line 1; both Principales mains are HELD
      // — main1 is line 2, main2 is line 3.
      await addTabRound(tx, cfg, tabId, [line(starter), line(main1), line(main2)]);
      // Age the held lines' queued_at so the send's now() refresh is distinguishable from the ring stamp.
      await tx
        .update(ticketItems)
        .set({ queuedAt: AGED })
        .where(and(eq(ticketItems.workingOrderId, tabId), isNull(ticketItems.firedAt)));

      const before = await itemsByLineNo(tx, tabId);
      // Read the stored aged stamp back (Postgres renders it in the session TZ, not the ISO literal we
      // wrote), and use THAT as the baseline the refresh must move off.
      const agedStamp = before.get(2)!.queuedAt;
      expect(before.get(2)!.firedAt).toBeNull(); // main1 held
      expect(before.get(3)!.firedAt).toBeNull(); // main2 held
      expect(before.get(3)!.queuedAt).toBe(agedStamp); // both held lines aged identically

      // Send ONLY line 2.
      await sendLines(tx, cfg, tabId, [2]);

      const after = await itemsByLineNo(tx, tabId);
      // Line 2 fired, and its queued_at was refreshed off the aged value to the send instant (== fired_at).
      expect(after.get(2)!.firedAt).not.toBeNull();
      expect(after.get(2)!.queuedAt).not.toBe(agedStamp);
      expect(after.get(2)!.queuedAt).toBe(after.get(2)!.firedAt);
      // Line 3 is untouched — still held, queued_at still the aged value.
      expect(after.get(3)!.firedAt).toBeNull();
      expect(after.get(3)!.queuedAt).toBe(agedStamp);
    });
  });

  it("an empty line list releases EVERY held line (send-all together)", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const ent = await createCourse(tx, cfg, { name: "Entrantes", displayOrder: 0 });
      const pri = await createCourse(tx, cfg, { name: "Principales", displayOrder: 1 });
      const post = await createCourse(tx, cfg, { name: "Postres", displayOrder: 2 });
      const starter = await makeProduct(tx, cfg, catalogueId, {});
      const main = await makeProduct(tx, cfg, catalogueId, {});
      const dessert = await makeProduct(tx, cfg, catalogueId, {});
      await setProductCourse(tx, cfg, starter, ent.id);
      await setProductCourse(tx, cfg, main, pri.id);
      await setProductCourse(tx, cfg, dessert, post.id);
      const tableId = await makeTable(tx, cfg);
      const { tabId } = await openTab(tx, cfg, { tableId });

      // starter (line 1) auto-fires; main (line 2, Principales) and dessert (line 3, Postres) are held.
      await addTabRound(tx, cfg, tabId, [line(starter), line(main), line(dessert)]);
      const before = await itemsByLineNo(tx, tabId);
      expect(before.get(2)!.firedAt).toBeNull();
      expect(before.get(3)!.firedAt).toBeNull();

      // Empty list ⇒ release every remaining held line, regardless of course.
      await sendLines(tx, cfg, tabId, []);

      const after = await itemsByLineNo(tx, tabId);
      expect(after.get(1)!.firedAt).not.toBeNull(); // starter still fired
      expect(after.get(2)!.firedAt).not.toBeNull(); // main released
      expect(after.get(3)!.firedAt).not.toBeNull(); // dessert released
    });
  });

  it("is idempotent — an already-fired line in the set is left untouched", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const ent = await createCourse(tx, cfg, { name: "Entrantes", displayOrder: 0 });
      const pri = await createCourse(tx, cfg, { name: "Principales", displayOrder: 1 });
      const starter = await makeProduct(tx, cfg, catalogueId, {});
      const main = await makeProduct(tx, cfg, catalogueId, {});
      await setProductCourse(tx, cfg, starter, ent.id);
      await setProductCourse(tx, cfg, main, pri.id);
      const tableId = await makeTable(tx, cfg);
      const { tabId } = await openTab(tx, cfg, { tableId });

      await addTabRound(tx, cfg, tabId, [line(starter), line(main)]);
      // Send line 2 once — it fires. Age line 1's (already-fired) stamps so a re-fire that wrongly matched
      // it would move them.
      await sendLines(tx, cfg, tabId, [2]);
      await tx
        .update(ticketItems)
        .set({ firedAt: AGED, queuedAt: AGED })
        .where(
          and(
            eq(ticketItems.workingOrderId, tabId),
            eq(
              ticketItems.workingOrderLineId,
              tx
                .select({ id: workingOrderLines.id })
                .from(workingOrderLines)
                .where(
                  and(eq(workingOrderLines.workingOrderId, tabId), eq(workingOrderLines.lineNo, 1)),
                ),
            ),
          ),
        );

      // Read the stored aged stamps back (session-TZ rendering, not the ISO literal) as the baseline.
      const aged = await itemsByLineNo(tx, tabId);
      const agedFired = aged.get(1)!.firedAt;
      const agedQueued = aged.get(1)!.queuedAt;

      // Sending line 1 (already fired) matches no HELD row — its aged stamps stay put (the fired_at IS
      // NULL predicate skips it), so the timestamps are not overwritten with now().
      await sendLines(tx, cfg, tabId, [1]);
      const after = await itemsByLineNo(tx, tabId);
      expect(after.get(1)!.firedAt).toBe(agedFired);
      expect(after.get(1)!.queuedAt).toBe(agedQueued);
    });
  });

  it("a held line produces NO kitchen print until sent, then exactly one after", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      // A printer per station, so the HELD line's print can be counted in isolation from the auto-fired
      // starter's (which prints at Cocina the moment it is rung).
      await attachedPrinter(tx, cfg, { name: "Cocina", isDefault: true }, "P-Cocina");
      const { station: barra, printerId: pBarra } = await attachedPrinter(
        tx,
        cfg,
        { name: "Barra" },
        "P-Barra",
      );

      const ent = await createCourse(tx, cfg, { name: "Entrantes", displayOrder: 0 });
      const pri = await createCourse(tx, cfg, { name: "Principales", displayOrder: 1 });
      const starter = await makeProduct(tx, cfg, catalogueId, {}); // → Cocina (default)
      const main = await makeProduct(tx, cfg, catalogueId, { stationId: barra.id }); // → Barra
      await setProductCourse(tx, cfg, starter, ent.id);
      await setProductCourse(tx, cfg, main, pri.id);
      const tableId = await makeTable(tx, cfg);
      const { tabId } = await openTab(tx, cfg, { tableId });

      // Ring both: starter auto-fires (prints at Cocina); main (Principales, Barra) is HELD — no Barra
      // print yet, because a held line prints only when it is sent.
      await addTabRound(tx, cfg, tabId, [line(starter), line(main)]);
      const allJobsBefore = await tx.select({ id: printJobs.id }).from(printJobs);
      const barraJobsBefore = await tx
        .select({ id: printJobs.id })
        .from(printJobs)
        .where(eq(printJobs.printerId, pBarra));
      expect(barraJobsBefore).toHaveLength(0); // the HELD Barra line has NOT printed
      // (Cocina already has the auto-fired starter's ticket, so the outbox is not simply empty.)
      expect(allJobsBefore.length).toBeGreaterThan(0);

      // Send the held line — its kitchen print is enqueued now.
      await sendLines(tx, cfg, tabId, [2]);
      const barraJobsAfter = await tx
        .select({ id: printJobs.id })
        .from(printJobs)
        .where(eq(printJobs.printerId, pBarra));
      expect(barraJobsAfter).toHaveLength(1);
    });
  });
});

// recallLines clears fired_at only while a ticket is queued. Started items refuse recall;
// already-held items are unchanged. PGlite exercises these state transitions.
describe("recallLines (A4: un-send a not-started line — fired → held)", () => {
  it("un-fires a fired-not-started line back to held (fired_at → null, state stays queued)", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const ent = await createCourse(tx, cfg, { name: "Entrantes", displayOrder: 0 });
      const starter = await makeProduct(tx, cfg, catalogueId, {});
      await setProductCourse(tx, cfg, starter, ent.id);
      const tableId = await makeTable(tx, cfg);
      const { tabId } = await openTab(tx, cfg, { tableId });

      // A lone earliest-course line auto-fires at round-send — fired but not yet started (state queued).
      await addTabRound(tx, cfg, tabId, [line(starter)]);
      const before = byLine(await courseItemsFor(tx, tabId), starter);
      expect(before.firedAt).not.toBeNull();
      expect(before.state).toBe("queued");

      // Recall line 1 — it un-fires back to held.
      await recallLines(tx, cfg, tabId, [1]);

      const after = byLine(await courseItemsFor(tx, tabId), starter);
      expect(after.firedAt).toBeNull(); // greyed back to held
      expect(after.state).toBe("queued"); // recall does not move the kitchen state
    });
  });

  it("refuses a STARTED (preparing/ready) line with ticket.already_started, naming its item id", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const ent = await createCourse(tx, cfg, { name: "Entrantes", displayOrder: 0 });
      const starter = await makeProduct(tx, cfg, catalogueId, {});
      await setProductCourse(tx, cfg, starter, ent.id);
      const tableId = await makeTable(tx, cfg);
      const { tabId } = await openTab(tx, cfg, { tableId });
      await addTabRound(tx, cfg, tabId, [line(starter)]);

      // The kitchen begins the (fired) line — advance it to `preparing` via the real bump verb.
      const item = byLine(await courseItemsFor(tx, tabId), starter);
      await advanceTicketItem(tx, cfg, item.id, "preparing");

      // Recall is refused once cooking has begun — a started line is corrected via cancel, not recall.
      await expect(recallLines(tx, cfg, tabId, [1])).rejects.toMatchObject({
        code: "ticket.already_started",
        params: { ticketItemId: item.id },
      });
      // The line is untouched — still fired, still preparing (the refusal ran before any update).
      const after = byLine(await courseItemsFor(tx, tabId), starter);
      expect(after.firedAt).not.toBeNull();
      expect(after.state).toBe("preparing");
    });
  });

  it("refuses an AWAY (ready + dispatched) line with ticket.already_started, naming its item id", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const ent = await createCourse(tx, cfg, { name: "Entrantes", displayOrder: 0 });
      const starter = await makeProduct(tx, cfg, catalogueId, {});
      await setProductCourse(tx, cfg, starter, ent.id);
      const tableId = await makeTable(tx, cfg);
      const { tabId } = await openTab(tx, cfg, { tableId });
      await addTabRound(tx, cfg, tabId, [line(starter)]);

      // Cook it through to READY, then dispatch it to the floor (away). markCourseAway stamps away_at ONLY
      // on state='ready' items, so an away line is state='ready' — caught by the started-check's `ready`
      // disjunct (NOT a no-op: a dispatched/served line cannot be cleanly recalled).
      const item = byLine(await courseItemsFor(tx, tabId), starter);
      await advanceTicketItem(tx, cfg, item.id, "preparing");
      await advanceTicketItem(tx, cfg, item.id, "ready");
      await markCourseAway(tx, cfg, tabId, ent.id);
      const away = byLine(await courseItemsFor(tx, tabId), starter);
      expect(away.state).toBe("ready");
      expect(away.awayAt).not.toBeNull(); // actually dispatched to the floor

      await expect(recallLines(tx, cfg, tabId, [1])).rejects.toMatchObject({
        code: "ticket.already_started",
        params: { ticketItemId: item.id },
      });
    });
  });

  it("is a no-op on an already-HELD line (its fired_at stays null)", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const ent = await createCourse(tx, cfg, { name: "Entrantes", displayOrder: 0 });
      const pri = await createCourse(tx, cfg, { name: "Principales", displayOrder: 1 });
      const starter = await makeProduct(tx, cfg, catalogueId, {});
      const main = await makeProduct(tx, cfg, catalogueId, {});
      await setProductCourse(tx, cfg, starter, ent.id);
      await setProductCourse(tx, cfg, main, pri.id);
      const tableId = await makeTable(tx, cfg);
      const { tabId } = await openTab(tx, cfg, { tableId });

      // starter (line 1) auto-fires; main (line 2, Principales) is HELD — fired_at already null.
      await addTabRound(tx, cfg, tabId, [line(starter), line(main)]);
      expect(byLine(await courseItemsFor(tx, tabId), main).firedAt).toBeNull();

      // Recalling an already-held line resolves and changes nothing.
      await recallLines(tx, cfg, tabId, [2]);
      const after = byLine(await courseItemsFor(tx, tabId), main);
      expect(after.firedAt).toBeNull();
      expect(after.state).toBe("queued");
    });
  });

  it("throws tab.line_not_found for a line_no not on the tab", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const ent = await createCourse(tx, cfg, { name: "Entrantes", displayOrder: 0 });
      const starter = await makeProduct(tx, cfg, catalogueId, {});
      await setProductCourse(tx, cfg, starter, ent.id);
      const tableId = await makeTable(tx, cfg);
      const { tabId } = await openTab(tx, cfg, { tableId });
      await addTabRound(tx, cfg, tabId, [line(starter)]);

      await expect(recallLines(tx, cfg, tabId, [999])).rejects.toMatchObject({
        code: "tab.line_not_found",
        params: { tabId, lineNo: 999 },
      });
    });
  });
});

// Coursing editing (A6) — a recall or void of a PREVIOUSLY-FIRED (printed) line tells the paper kitchen
// what changed via a correction slip (`enqueueCorrectionSlips` → `formatCorrectionSlip`). Only a line
// whose ticket item had a NON-null `fired_at` produced paper, so ONLY it produces a slip: recalling or
// voiding a HELD line (never printed) enqueues nothing. `recallLines` emits RECALLED for the items it
// actually un-fires (fired-and-queued before the update); `voidTabLine` emits VOID for a fired line,
// reading it BEFORE the ON DELETE CASCADE removes the line + its ticket item. Non-fiscal: only
// `ticket_items`/`working_order_lines`/`print_jobs`. PGlite proves the enqueue count + payload in both
// directions; every write runs through `withTransaction`.
// ---------------------------------------------------------------------------------------------------
describe("correction slips on recall & void (A6)", () => {
  /** Create a sellable product with a KNOWN name (so the slip payload can be asserted for it), routed to
   *  an optional course. Station routing is left to the venue default. */
  async function namedProduct(
    tx: Transaction,
    cfg: TillConfig,
    catalogueId: string,
    name: string,
    courseId?: string,
  ): Promise<string> {
    const { id } = await createProduct(tx, {
      catalogueId,
      categoryId: null,
      name: name,
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
    });
    if (courseId !== undefined) await setProductCourse(tx, cfg, id, courseId);
    return id;
  }

  /** Read print-job ids for the before/after enqueue comparison. */
  function jobRows(
    tx: Transaction,
  ): Promise<{ id: string; printerId: string; payload: Uint8Array }[]> {
    return tx
      .select({ id: printJobs.id, printerId: printJobs.printerId, payload: printJobs.payload })
      .from(printJobs);
  }

  it("(a) recalling a FIRED line enqueues ONE RECALLED slip at that station's printer", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const { printerId: pCocina } = await attachedPrinter(
        tx,
        cfg,
        { name: "Cocina", isDefault: true },
        "P-Cocina",
      );
      const ent = await createCourse(tx, cfg, { name: "Entrantes", displayOrder: 0 });
      const starter = await namedProduct(tx, cfg, catalogueId, "Croquetas", ent.id);
      const tableId = await makeTable(tx, cfg);
      const { tabId } = await openTab(tx, cfg, { tableId });

      // A lone earliest-course line auto-fires at round-send — it prints (fire ticket) at Cocina.
      await addTabRound(tx, cfg, tabId, [line(starter)]);
      expect(byLine(await courseItemsFor(tx, tabId), starter).firedAt).not.toBeNull();
      const before = await jobRows(tx);

      await recallLines(tx, cfg, tabId, [1]);

      const after = await jobRows(tx);
      const fresh = after.filter((j) => !before.some((b) => b.id === j.id));
      expect(fresh).toHaveLength(1);
      expect(fresh[0]!.printerId).toBe(pCocina);
      const text = decodeTicket(fresh[0]!.payload);
      expect(text).toContain("RECALLED");
      expect(text).toContain("Croquetas");
    });
  });

  it("(b) recalling a HELD line enqueues NO slip (it never printed)", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await attachedPrinter(tx, cfg, { name: "Cocina", isDefault: true }, "P-Cocina");
      const ent = await createCourse(tx, cfg, { name: "Entrantes", displayOrder: 0 });
      const pri = await createCourse(tx, cfg, { name: "Principales", displayOrder: 1 });
      const starter = await namedProduct(tx, cfg, catalogueId, "Croquetas", ent.id);
      const main = await namedProduct(tx, cfg, catalogueId, "Chuleton", pri.id);
      const tableId = await makeTable(tx, cfg);
      const { tabId } = await openTab(tx, cfg, { tableId });

      // starter (line 1) auto-fires; main (line 2, Principales) is HELD — never printed.
      await addTabRound(tx, cfg, tabId, [line(starter), line(main)]);
      expect(byLine(await courseItemsFor(tx, tabId), main).firedAt).toBeNull();
      const before = await jobRows(tx);

      await recallLines(tx, cfg, tabId, [2]);

      const after = await jobRows(tx);
      const fresh = after.filter((j) => !before.some((b) => b.id === j.id));
      expect(fresh).toHaveLength(0);
    });
  });

  it("(c) voiding a FIRED line enqueues ONE VOID slip at that station's printer", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const { printerId: pCocina } = await attachedPrinter(
        tx,
        cfg,
        { name: "Cocina", isDefault: true },
        "P-Cocina",
      );
      const ent = await createCourse(tx, cfg, { name: "Entrantes", displayOrder: 0 });
      const starter = await namedProduct(tx, cfg, catalogueId, "Croquetas", ent.id);
      const tableId = await makeTable(tx, cfg);
      const { tabId } = await openTab(tx, cfg, { tableId });

      await addTabRound(tx, cfg, tabId, [line(starter)]);
      expect(byLine(await courseItemsFor(tx, tabId), starter).firedAt).not.toBeNull();
      const before = await jobRows(tx);

      await voidTabLine(tx, cfg, tabId, 1);

      const after = await jobRows(tx);
      const fresh = after.filter((j) => !before.some((b) => b.id === j.id));
      expect(fresh).toHaveLength(1);
      expect(fresh[0]!.printerId).toBe(pCocina);
      const text = decodeTicket(fresh[0]!.payload);
      expect(text).toContain("VOID");
      expect(text).toContain("Croquetas");
    });
  });

  it("(d) voiding a HELD line enqueues NO slip (it never printed)", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await attachedPrinter(tx, cfg, { name: "Cocina", isDefault: true }, "P-Cocina");
      const ent = await createCourse(tx, cfg, { name: "Entrantes", displayOrder: 0 });
      const pri = await createCourse(tx, cfg, { name: "Principales", displayOrder: 1 });
      const starter = await namedProduct(tx, cfg, catalogueId, "Croquetas", ent.id);
      const main = await namedProduct(tx, cfg, catalogueId, "Chuleton", pri.id);
      const tableId = await makeTable(tx, cfg);
      const { tabId } = await openTab(tx, cfg, { tableId });

      // starter (line 1) auto-fires; main (line 2) is HELD — never printed.
      await addTabRound(tx, cfg, tabId, [line(starter), line(main)]);
      expect(byLine(await courseItemsFor(tx, tabId), main).firedAt).toBeNull();
      const before = await jobRows(tx);

      await voidTabLine(tx, cfg, tabId, 2);

      const after = await jobRows(tx);
      const fresh = after.filter((j) => !before.some((b) => b.id === j.id));
      expect(fresh).toHaveLength(0);
    });
  });
});

// Coursing editing (A3) — `hold` on send. A round line may carry `hold: true`; `addTabRound` correlates
// that marker onto the priced PARENT row (parents come out of `priceOrderLines` in input order) and hands
// it to `fireLines`, which inserts the held line with `fired_at NULL` REGARDLESS of its course — greyed on
// the KDS, no kitchen print — until a later `sendLines`/`fireCourse` releases it. Transient: read at fire
// time, never stored (no migration). PGlite proves the hold short-circuit and the parent correlation under
// modifier expansion — plain SQL a single backend proves; every write runs through `withTransaction`.
// ---------------------------------------------------------------------------------------------------
describe("addTabRound hold-on-send (A3)", () => {
  it("holds a line marked hold:true even when its course would auto-fire, printing only the fired line", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const { printerId: pCocina } = await attachedPrinter(
        tx,
        cfg,
        { name: "Cocina", isDefault: true },
        "P-Cocina",
      );
      const ent = await createCourse(tx, cfg, { name: "Entrantes", displayOrder: 0 });
      const olives = await makeProduct(tx, cfg, catalogueId, {});
      const bread = await makeProduct(tx, cfg, catalogueId, {});
      await setProductCourse(tx, cfg, olives, ent.id);
      await setProductCourse(tx, cfg, bread, ent.id);
      const tableId = await makeTable(tx, cfg);
      const { tabId } = await openTab(tx, cfg, { tableId });

      // Both starters sit in the EARLIEST course, so both WOULD auto-fire — but line 2 carries hold:true.
      await addTabRound(tx, cfg, tabId, [
        { productId: olives, quantity: "1" },
        { productId: bread, quantity: "1", hold: true },
      ]);

      // Both lines get a ticket item; only the un-held one is fired.
      const items = await courseItemsFor(tx, tabId);
      expect(items).toHaveLength(2);
      expect(byLine(items, olives).firedAt).not.toBeNull(); // fired (earliest course)
      expect(byLine(items, bread).firedAt).toBeNull(); // HELD despite the earliest course

      // Exactly one kitchen print — the fired line only; the held line prints nothing until sent.
      const jobs = await tx
        .select({ id: printJobs.id })
        .from(printJobs)
        .where(eq(printJobs.printerId, pCocina));
      expect(jobs).toHaveLength(1);
    });
  });

  it("correlates hold to the right PARENT when a modifier expands the row count (modifier line first)", async () => {
    // The load-bearing correlation guard. The MODIFIED product is rung FIRST, so its child modifier row
    // sits BETWEEN the two parents in `priceOrderLines`'s output — a naive position map (one that did not
    // skip child rows) would slide hold onto the wrong parent and hold the modified dish instead of the
    // plain one. No courses, so both parents fire by the null-course rule and ONLY hold decides which stays
    // held, isolating the correlation from coursing.
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const { printerId: pCocina } = await attachedPrinter(
        tx,
        cfg,
        { name: "Cocina", isDefault: true },
        "P-Cocina",
      );
      const modified = await makeProduct(tx, cfg, catalogueId, {});
      const plain = await makeProduct(tx, cfg, catalogueId, {});
      const extra = await addExtra(tx, catalogueId, modified, "Extra");
      const tableId = await makeTable(tx, cfg);
      const { tabId } = await openTab(tx, cfg, { tableId });

      await addTabRound(tx, cfg, tabId, [
        {
          productId: modified,
          quantity: "1",
          extras: [{ listId: extra.listId, picks: [{ productId: extra.productId, quantity: 1 }] }],
          hold: false,
        },
        { productId: plain, quantity: "1", hold: true },
      ]);

      // A child modifier line never gets a ticket item, so the only items are the two PARENT dishes.
      const items = await courseItemsFor(tx, tabId);
      expect(items).toHaveLength(2);
      expect(byLine(items, modified).firedAt).not.toBeNull(); // the modified dish (+ child) fires
      expect(byLine(items, plain).firedAt).toBeNull(); // the PLAIN dish is the one held

      // Only the fired modified dish printed; the held plain dish and the child modifier print nothing.
      const jobs = await tx
        .select({ id: printJobs.id })
        .from(printJobs)
        .where(eq(printJobs.printerId, pCocina));
      expect(jobs).toHaveLength(1);
    });
  });
});

// KDS-3 Task 2 — the cross-station expo/pass read. `listExpoQueue` aggregates every OPEN order on the
// node (with at least one not-yet-away item), gathers its ticket items ACROSS stations, and groups them
// by course in display_order with per-course fired/away roll-ups. Unlike `listStationQueue` (one
// station, no station name) it joins `kitchen_stations` to label each item's station. PGlite proves the
// join, the collected/abandoned/fully-away exclusions, the course grouping and the roll-ups — plain SQL a
// single backend proves; the NODE scoping is real-Postgres's job (working-order.pay-and-dispatch.test.ts).
// Every read/write runs through `withTransaction`.
// ---------------------------------------------------------------------------------------------------
describe("listExpoQueue (KDS-3 cross-station expo/pass read)", () => {
  it("aggregates one order's two-station single-course lines into one course with station names, excluding collected/abandoned orders", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const barra = await createStation(tx, cfg, { name: "Barra" });
      const ent = await createCourse(tx, cfg, { name: "Entrantes", displayOrder: 0 });
      // Two products in the SAME course, routed to DIFFERENT stations — the cross-station shape.
      const soup = await makeProduct(tx, cfg, catalogueId, {}); // → Cocina (default)
      const olives = await makeProduct(tx, cfg, catalogueId, { stationId: barra.id }); // → Barra
      await setProductCourse(tx, cfg, soup, ent.id);
      await setProductCourse(tx, cfg, olives, ent.id);

      const { id: orderId } = await placeOrderWith(tx, cfg, [line(soup), line(olives)]);

      const expo = await listExpoQueue(tx, cfg);
      expect(expo).toHaveLength(1);
      const order = expo[0]!;
      expect(order.orderId).toBe(orderId);
      // A single earliest course, both items auto-fired, neither away.
      expect(order.courses).toHaveLength(1);
      const course = order.courses[0]!;
      expect(course.courseId).toBe(ent.id);
      expect(course.courseName).toBe("Entrantes");
      expect(course.displayOrder).toBe(0);
      expect(course.fired).toBe(true);
      expect(course.away).toBe(false);
      // Both lines under the one course, each labelled with its OWN station — the join listStationQueue omits.
      expect(course.items).toHaveLength(2);
      expect(course.items.map((i) => i.stationName).sort()).toEqual(["Barra", "Cocina"]);
      expect(course.items.every((i) => i.state === "queued")).toBe(true);
      expect(course.items.every((i) => i.firedAt !== null)).toBe(true);
      expect(course.items.every((i) => i.awayAt === null)).toBe(true);
      // The display snapshot rides through: `name` is the resolved kitchen label, `qty` the
      // quantity as a three-place decimal string.
      const soupItem = course.items.find((i) => i.stationName === "Cocina")!;
      // The fixture seeds no kitchen name, so the label is the product's staff name (`P-<uuid>`),
      // a plain string rather than a locale map.
      expect(soupItem.name).toMatch(/^P-/);
      expect(typeof soupItem.qty).toBe("string");

      // A COLLECTED order and an ABANDONED order are both excluded, the same two listStationQueue drops.
      const { id: collected } = await placeOrderWith(tx, cfg, [line(soup)]);
      await tx
        .update(workingOrders)
        .set({ collectedAt: nowIso() })
        .where(eq(workingOrders.id, collected));
      const { id: abandoned } = await placeOrderWith(tx, cfg, [line(soup)]);
      await tx
        .update(workingOrders)
        .set({ status: "abandoned" })
        .where(eq(workingOrders.id, abandoned));

      expect((await listExpoQueue(tx, cfg)).map((o) => o.orderId)).toEqual([orderId]);
    });
  });

  it("groups by course in display_order; a held later course reads fired:false, and the away roll-up follows per course", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const ent = await createCourse(tx, cfg, { name: "Entrantes", displayOrder: 0 });
      const pri = await createCourse(tx, cfg, { name: "Principales", displayOrder: 1 });
      const starter = await makeProduct(tx, cfg, catalogueId, {});
      const main = await makeProduct(tx, cfg, catalogueId, {});
      await setProductCourse(tx, cfg, starter, ent.id);
      await setProductCourse(tx, cfg, main, pri.id);

      const { id: orderId } = await placeOrderWith(tx, cfg, [line(starter), line(main)]);

      const order = (await listExpoQueue(tx, cfg))[0]!;
      // Courses in display_order: Entrantes (0) then Principales (1).
      expect(order.courses.map((c) => c.courseName)).toEqual(["Entrantes", "Principales"]);
      const [c0, c1] = order.courses;
      expect(c0!.fired).toBe(true); // earliest course auto-fired
      expect(c0!.away).toBe(false);
      expect(c1!.fired).toBe(false); // later course HELD — fired_at null on its item
      expect(c1!.items.every((i) => i.firedAt === null)).toBe(true);

      // Fire the held course, and mark the earliest course AWAY (KDS-3's dispatch marker). The per-course
      // roll-ups follow: Entrantes now `away`, Principales now `fired`; the order stays (main not away).
      await fireCourse(tx, cfg, orderId, pri.id);
      const items = await courseItemsFor(tx, orderId);
      const entItem = items.find((i) => i.courseId === ent.id)!;
      await tx.update(ticketItems).set({ awayAt: nowIso() }).where(eq(ticketItems.id, entItem.id));

      const after = await listExpoQueue(tx, cfg);
      expect(after).toHaveLength(1);
      const c0b = after[0]!.courses.find((c) => c.courseId === ent.id)!;
      const c1b = after[0]!.courses.find((c) => c.courseId === pri.id)!;
      expect(c0b.away).toBe(true);
      expect(c0b.items[0]!.awayAt).not.toBeNull();
      expect(c1b.fired).toBe(true); // released
      expect(c1b.away).toBe(false);
    });
  });

  it("drops a FULLY-away order but keeps one that still has a not-yet-away item", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const ent = await createCourse(tx, cfg, { name: "Entrantes", displayOrder: 0 });
      const a = await makeProduct(tx, cfg, catalogueId, {});
      const b = await makeProduct(tx, cfg, catalogueId, {});
      await setProductCourse(tx, cfg, a, ent.id);
      await setProductCourse(tx, cfg, b, ent.id);

      const { id: orderId } = await placeOrderWith(tx, cfg, [line(a), line(b)]);
      const items = await courseItemsFor(tx, orderId);

      // One item away → the order stays (a not-yet-away item remains).
      await tx
        .update(ticketItems)
        .set({ awayAt: nowIso() })
        .where(eq(ticketItems.id, items[0]!.id));
      expect((await listExpoQueue(tx, cfg)).map((o) => o.orderId)).toEqual([orderId]);

      // The last item away → the whole order is fully dispatched and leaves the pass.
      await tx
        .update(ticketItems)
        .set({ awayAt: nowIso() })
        .where(eq(ticketItems.id, items[1]!.id));
      expect(await listExpoQueue(tx, cfg)).toEqual([]);
    });
  });

  it("surfaces the dining-table label for a tab and omits it for a walk-up; openedMinutes is derived from opened_at", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const cafe = await makeProduct(tx, cfg, catalogueId, {}); // null course → fires immediately

      // A TAB at a known-labelled table: dining_tables.tab_id back-points at the order.
      const { rows } = await tx.execute<{ id: string }>(sql`
        insert into dining_tables (id, location_id, label, created_at)
        values (${randomUUID()}, ${cfg.locationId}, 'Mesa 5', ${nowIso()})
        returning id`);
      const tableId = rows[0]!.id;
      const { tabId } = await openTab(tx, cfg, { tableId });
      await addTabRound(tx, cfg, tabId, [line(cafe)]);

      // A WALK-UP counter order, no table → tableLabel omitted.
      const { id: walkup } = await placeOrderWith(tx, cfg, [line(cafe)]);

      const expo = await listExpoQueue(tx, cfg);
      const tab = expo.find((o) => o.orderId === tabId)!;
      expect(tab.tableLabel).toBe("Mesa 5");
      expect(tab.openedMinutes).toBeGreaterThanOrEqual(0);
      const walk = expo.find((o) => o.orderId === walkup)!;
      expect(walk.tableLabel).toBeUndefined();
    });
  });

  // KDS order-timing alerts (design §3/§6/§11) — the expo spans stations, so PER-ITEM thresholds
  // (Controller Ruling A) prove the join resolved each item's OWN station, not another's (CLAUDE.md §3's
  // correlated-subquery caution: a wrong join binds to the wrong row silently).
  it("carries each item's own station thresholds/band, and rolls the order up to the worst", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, cfg, { name: "Cocina", isDefault: true }); // 5/10/15 defaults
      const barra = await createStation(tx, cfg, { name: "Barra" });
      // Distinct thresholds so a per-item mix-up (Barra's item reading Cocina's thresholds, or vice
      // versa) would fail this test rather than passing by coincidence on identical defaults.
      await tx.execute(
        sql`update kitchen_stations set warm_after_minutes = 2, overdue_after_minutes = 4,
            forgotten_after_minutes = 6 where id = ${barra.id}`,
      );
      const soup = await makeProduct(tx, cfg, catalogueId, {}); // → Cocina (default)
      const olives = await makeProduct(tx, cfg, catalogueId, { stationId: barra.id }); // → Barra

      const { id: orderId } = await placeOrderWith(tx, cfg, [line(soup), line(olives)]);
      const items = await courseItemsFor(tx, orderId);
      const soupItem = items.find((i) => i.productId === soup)!;
      const oliveItem = items.find((i) => i.productId === olives)!;

      // Backdate the Barra item past ITS OWN overdue threshold (4) but nowhere near Cocina's (10).
      await tx.execute(
        sql`update ticket_items set queued_at = ${minutesAgo(5)} where id = ${oliveItem.id}`,
      );

      const order = (await listExpoQueue(tx, cfg)).find((o) => o.orderId === orderId)!;
      const outItems = order.courses.flatMap((c) => c.items);
      const soupOut = outItems.find((i) => i.id === soupItem.id)!;
      const oliveOut = outItems.find((i) => i.id === oliveItem.id)!;

      expect(soupOut.thresholds).toEqual({
        warmAfterMinutes: 5,
        overdueAfterMinutes: 10,
        forgottenAfterMinutes: 15,
      });
      expect(soupOut.band).toBe("fresh");
      expect(oliveOut.thresholds).toEqual({
        warmAfterMinutes: 2,
        overdueAfterMinutes: 4,
        forgottenAfterMinutes: 6,
      });
      expect(oliveOut.band).toBe("overdue"); // 5 >= 4 (overdue), < 6 (forgotten)
      expect(typeof oliveOut.queuedAt).toBe("string");
      // Worst-line-wins: the order rolls up to the worse of its two items.
      expect(order.worstBand).toBe("overdue");
    });
  });

  it("drops a served line off the order's worst band (design §3 — ages until it reaches the guest)", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, cfg, { name: "Cocina", isDefault: true }); // 5/10/15 defaults
      const cafe = await makeProduct(tx, cfg, catalogueId, {});
      const agua = await makeProduct(tx, cfg, catalogueId, {});
      const tableId = await makeTable(tx, cfg);
      // `served_at` is writable only while the parent order is OPEN (design H2, ruling R4), so this
      // needs a tab rather than `placeOrderWith`'s settled/placed order.
      const { tabId } = await openTab(tx, cfg, { tableId });
      await addTabRound(tx, cfg, tabId, [line(cafe), line(agua)]);

      const rows = await ticketItemRows(tx, tabId);
      // Backdate line 1 past overdue (10); line 2 stays fresh.
      await tx.execute(
        sql`update ticket_items set queued_at = ${minutesAgo(12)} where id = ${rows[0]!.id}`,
      );

      let order = (await listExpoQueue(tx, cfg)).find((o) => o.orderId === tabId)!;
      expect(order.worstBand).toBe("overdue");

      // Serve the overdue line — it drops off the clock. Line 2 is still unserved but fresh, so the
      // order's worst band clears.
      await markLineServed(tx, cfg, tabId, rows[0]!.lineNo);
      order = (await listExpoQueue(tx, cfg)).find((o) => o.orderId === tabId)!;
      expect(order.worstBand).toBe("fresh");
    });
  });
});

// KDS-3 Task 3 — the pass's two coordination verbs. `bumpCourseReady` is the whole-course "it's all
// plated" bump: {@link advanceTicket}'s set-based shape keyed on COURSE (order + course_id) not station,
// advancing every FIRED, not-yet-ready item across ALL its stations straight to `ready` (skipping HELD
// items and no-op when none match). `markCourseAway` stamps `away_at = now()` on every READY item of the
// course (dispatch what is plated), gated on the course EXISTING (`requireCourse` → course.not_found),
// idempotent via `away_at IS NULL`. PGlite proves the set-based logic, the held-skip and the ready-only
// dispatch — plain SQL a single backend proves; the NODE scoping is real-Postgres's job
// (working-order.pay-and-dispatch.test.ts's `listExpoQueue` node-symmetry case). Every write runs
// through `withTransaction`.
// ---------------------------------------------------------------------------------------------------

/** Fire ONE course of an order across TWO stations — two products in the SAME (earliest, so auto-fired)
 *  course routed to DIFFERENT stations, placed so both items fire and sit `queued`. The cross-station
 *  shape `bumpCourseReady` must sweep in one UPDATE (`listStationQueue` would need two reads to see both). */
async function firedCourseAcrossTwoStations(
  tx: Transaction,
  cfg: TillConfig,
  catalogueId: string,
): Promise<{ orderId: string; courseId: string }> {
  await createStation(tx, cfg, { name: "Cocina", isDefault: true });
  const barra = await createStation(tx, cfg, { name: "Barra" });
  const ent = await createCourse(tx, cfg, { name: "Entrantes", displayOrder: 0 });
  const soup = await makeProduct(tx, cfg, catalogueId, {}); // → Cocina (default)
  const olives = await makeProduct(tx, cfg, catalogueId, { stationId: barra.id }); // → Barra
  await setProductCourse(tx, cfg, soup, ent.id);
  await setProductCourse(tx, cfg, olives, ent.id);
  const { id: orderId } = await placeOrderWith(tx, cfg, [line(soup), line(olives)]);
  return { orderId, courseId: ent.id };
}

describe("bumpCourseReady / markCourseAway (KDS-3 expo/pass coordination verbs)", () => {
  it("bumps a whole course ready across stations, then marks it away", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const { orderId, courseId } = await firedCourseAcrossTwoStations(tx, cfg, catalogueId);

      // Both items start fired + queued, across two stations, under the one course.
      let items = await courseItemsFor(tx, orderId);
      expect(items).toHaveLength(2);
      expect(items.every((i) => i.state === "queued")).toBe(true);
      expect(items.every((i) => i.firedAt !== null)).toBe(true);

      // One set-based bump plates the whole course ready — both stations' items reach `ready`.
      await bumpCourseReady(tx, cfg, orderId, courseId);
      items = await courseItemsFor(tx, orderId);
      expect(items.every((i) => i.state === "ready")).toBe(true);

      // Dispatch the plated course — every ready item goes away.
      await markCourseAway(tx, cfg, orderId, courseId);
      items = await courseItemsFor(tx, orderId);
      expect(items.every((i) => i.awayAt !== null)).toBe(true);
    });
  });

  it("bumpCourseReady skips held items; markCourseAway only aways ready items", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const ent = await createCourse(tx, cfg, { name: "Entrantes", displayOrder: 0 });
      const pri = await createCourse(tx, cfg, { name: "Principales", displayOrder: 1 });
      const starter = await makeProduct(tx, cfg, catalogueId, {});
      const main = await makeProduct(tx, cfg, catalogueId, {});
      await setProductCourse(tx, cfg, starter, ent.id);
      await setProductCourse(tx, cfg, main, pri.id);
      const { id: orderId } = await placeOrderWith(tx, cfg, [line(starter), line(main)]);

      // Principales is HELD (later course, fired_at null). bumpCourseReady on it advances NOTHING — the
      // `fired_at IS NOT NULL` predicate skips held items (deletion-proof: drop it and the held main bumps
      // to `ready`, failing the `queued` assertion below).
      await bumpCourseReady(tx, cfg, orderId, pri.id);
      let items = await courseItemsFor(tx, orderId);
      expect(byLine(items, main).state).toBe("queued"); // held → skipped
      expect(byLine(items, main).firedAt).toBeNull(); // and still held

      // Entrantes IS fired, so bumping it plates its item straight to `ready` (queued → ready in one step)
      // — the OTHER answer, so the held-skip above is a real measurement, not "nothing ever advances".
      await bumpCourseReady(tx, cfg, orderId, ent.id);
      items = await courseItemsFor(tx, orderId);
      expect(byLine(items, starter).state).toBe("ready");

      // markCourseAway dispatches only PLATED (ready) items: Entrantes' item is ready → away.
      await markCourseAway(tx, cfg, orderId, ent.id);
      items = await courseItemsFor(tx, orderId);
      expect(byLine(items, starter).awayAt).not.toBeNull();

      // Now the ready-only guard: fire Principales (so its main is fired, still `queued`) and dispatch it.
      // The main is fired but NOT ready, so it does NOT go away (deletion-proof: drop `state = 'ready'` and
      // the queued main gets `away_at`, failing the assertion below).
      await fireCourse(tx, cfg, orderId, pri.id);
      await markCourseAway(tx, cfg, orderId, pri.id);
      items = await courseItemsFor(tx, orderId);
      expect(byLine(items, main).state).toBe("queued"); // fired but not plated
      expect(byLine(items, main).awayAt).toBeNull(); // only ready items go away
    });
  });

  it("markCourseAway rejects an unknown course with course.not_found (requireCourse existence check)", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const cafe = await makeProduct(tx, cfg, catalogueId, {});
      const { id: orderId } = await placeOrderWith(tx, cfg, [line(cafe)]);

      const missing = randomUUID();
      await expect(markCourseAway(tx, cfg, orderId, missing)).rejects.toMatchObject({
        code: "course.not_found",
        params: { courseId: missing },
      });
    });
  });

  it("markCourseAway is idempotent (already-away untouched); bumpCourseReady no-ops on an unknown course", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const { orderId, courseId } = await firedCourseAcrossTwoStations(tx, cfg, catalogueId);

      // bumpCourseReady on an UNKNOWN course is a no-op (no throw, no rows) — the bulk-bump convenience,
      // unlike markCourseAway which requires the course. The order's items are untouched.
      await bumpCourseReady(tx, cfg, orderId, randomUUID());
      expect((await courseItemsFor(tx, orderId)).every((i) => i.state === "queued")).toBe(true);

      // Plate then dispatch the course; capture each item's away stamp.
      await bumpCourseReady(tx, cfg, orderId, courseId);
      await markCourseAway(tx, cfg, orderId, courseId);
      const first = new Map((await courseItemsFor(tx, orderId)).map((i) => [i.id, i.awayAt]));
      expect([...first.values()].every((a) => a !== null)).toBe(true);

      // Re-dispatch — the `away_at IS NULL` predicate matches nothing already-away, so no stamp moves.
      await markCourseAway(tx, cfg, orderId, courseId);
      const second = new Map((await courseItemsFor(tx, orderId)).map((i) => [i.id, i.awayAt]));
      for (const [id, away] of first) expect(second.get(id)).toBe(away);
    });
  });
});

// KDS-2 A1 — the per-line `courseId` OVERRIDE is screened at the shared ring-time resolver
// (`priceOrderLines`), the ONE course-write path that formerly skipped `requireLiveCourse`. A crafted
// override — malformed, well-formed-but-unknown, a DIFFERENT venue's course in the same database (the
// working_order_lines.course_id FK is by id only, not location-scoped), or a deactivated one —
// is a clean `course.not_found` rather than an opaque 500 (22P02/23503) or a silently-accepted
// cross-venue line. The product DEFAULT (`product.course_id`) is an already-valid stored FK and is NOT
// re-screened (that would reject a legitimately-deactivated default). Exercised through `addTabRound`
// (the round path that threads the override today); the screen lives in `priceOrderLines`, so the order
// paths are covered by the SAME code. PGlite: plain SQL + the by-id FK, no privilege or
// concurrency dimension.
// ---------------------------------------------------------------------------------------------------
describe("voidTabLine extras cascade (FIX 2)", () => {
  /** Attach an extras list whose one product may be picked TWICE, returning the ids the wire needs. A
   *  list that ACCEPTS a tally of two AND an item cap of two, so a doubled pick SUMS to a per-dish
   *  quantity of 2 rather than being dropped, and is valid. */
  async function addMultiExtra(
    tx: Transaction,
    catalogueId: string,
    dishId: string,
    name: string,
  ): Promise<{ listId: string; productId: string }> {
    const offered = await createProduct(tx, {
      catalogueId,
      categoryId: null,
      name,
      pricingUnit: "each",
      unitPrice: "9.99",
      vatClass: "reduced",
    });
    const list = await catalogue.createExtraList(
      tx,
      {
        name: `${name} list`,
        customerName: null,
        kitchenName: null,
        minPicks: 0,
        maxPicks: 2,
        active: true,
        items: [{ productId: offered.id, maxQuantity: 2, preselected: false, price: "0.50" }],
      },
      LOCALE,
    );
    await attachModifierList(tx, dishId, { kind: "extras", id: list.id });
    return { listId: list.id, productId: offered.id };
  }

  /** Open an OPEN order with extras lines and point a fresh table at it → a real tab (`assertAnchoredTabOpen`
   *  needs the `dining_tables.tab_id` back-pointer). Skips firing, so no station is required. */
  async function openExtrasTab(
    tx: Transaction,
    cfg: TillConfig,
    tableId: string,
    lines: { productId: string; quantity: string; extras?: ExtraSelection[] }[],
  ): Promise<string> {
    const id = randomUUID();
    await createOpenOrder(tx, cfg, id, lines, null);
    await tx.execute(sql`update dining_tables set tab_id = ${id} where id = ${tableId}`);
    return id;
  }

  it("voiding a PARENT dish removes its extras children too (no orphan FK 23503)", async () => {
    const { cfg, cafeId, aguaId, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const bacon = await addExtra(tx, catalogueId, cafeId, "Bacon");
      const tableId = await makeTable(tx, cfg);
      // line 1 = café (parent), line 2 = bacon (child), line 3 = agua (plain).
      const tabId = await openExtrasTab(tx, cfg, tableId, [
        {
          productId: cafeId,
          quantity: "1",
          extras: [{ listId: bacon.listId, picks: [{ productId: bacon.productId, quantity: 1 }] }],
        },
        { productId: aguaId, quantity: "1" },
      ]);
      await voidTabLine(tx, cfg, tabId, 1);
      const remaining = await tx
        .select({
          lineNo: workingOrderLines.lineNo,
          productId: workingOrderLines.productId,
          parentLineId: workingOrderLines.parentLineId,
        })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, tabId))
        .orderBy(workingOrderLines.lineNo);
      // Parent (1) AND its child (2) are gone; only the plain agua line (3) survives.
      expect(remaining.map((r) => r.lineNo)).toEqual([3]);
      expect(remaining[0]!.productId).toBe(aguaId);
    });
  });

  it("voiding a CHILD extras line removes only that line (its dish stays)", async () => {
    const { cfg, cafeId, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const bacon = await addExtra(tx, catalogueId, cafeId, "Bacon");
      const tableId = await makeTable(tx, cfg);
      // line 1 = café (parent), line 2 = bacon (child).
      const tabId = await openExtrasTab(tx, cfg, tableId, [
        {
          productId: cafeId,
          quantity: "1",
          extras: [{ listId: bacon.listId, picks: [{ productId: bacon.productId, quantity: 1 }] }],
        },
      ]);
      await voidTabLine(tx, cfg, tabId, 2);
      const remaining = await tx
        .select({
          lineNo: workingOrderLines.lineNo,
          productId: workingOrderLines.productId,
        })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, tabId))
        .orderBy(workingOrderLines.lineNo);
      // Only the dish left; the child is the one that went.
      expect(remaining.map((r) => r.lineNo)).toEqual([1]);
      expect(remaining[0]!.productId).toBe(cafeId);
    });
  });

  it("REFUSES a product picked twice in one list rather than dropping or doubling it", async () => {
    const { cfg, cafeId, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const bacon = await addMultiExtra(tx, catalogueId, cafeId, "Bacon");
      // The same product named twice in one list's picks — reachable via a crafted client. A count
      // belongs in `quantity`, so two entries for one product are a malformed answer and neither
      // entry may be quietly dropped (which would serve and cook an extra unbilled).
      const error = await captureError(() =>
        createOpenOrder(
          tx,
          cfg,
          randomUUID(),
          [
            {
              productId: cafeId,
              quantity: "1",
              extras: [
                {
                  listId: bacon.listId,
                  picks: [
                    { productId: bacon.productId, quantity: 1 },
                    { productId: bacon.productId, quantity: 1 },
                  ],
                },
              ],
            },
          ],
          null,
        ),
      );
      expect(error).toMatchObject({ code: "extras.invalid", params: { field: "productId" } });
    });
  });

  it("prices ONE child at the picked per-dish quantity", async () => {
    const { cfg, cafeId, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const bacon = await addMultiExtra(tx, catalogueId, cafeId, "Bacon"); // maxPicks 2, item cap 2
      const id = randomUUID();
      await createOpenOrder(
        tx,
        cfg,
        id,
        [
          {
            productId: cafeId,
            quantity: "1",
            extras: [
              { listId: bacon.listId, picks: [{ productId: bacon.productId, quantity: 2 }] },
            ],
          },
        ],
        null,
      );
      const lines = await tx
        .select({
          lineNo: workingOrderLines.lineNo,
          parentLineId: workingOrderLines.parentLineId,
          productId: workingOrderLines.productId,
          quantity: workingOrderLines.quantity,
          lineTotal: workingOrderLines.lineTotal,
        })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, id))
        .orderBy(workingOrderLines.lineNo);
      // ONE parent + ONE child at quantity 2 (dish ×1 × pick ×2), 0.50 × 2 = 1.00 gross. Both
      // columns are read straight off the row, so 100 is that gross in cents and 2000 the two
      // picks in thousandths.
      expect(lines).toHaveLength(2);
      expect(lines[0]!.parentLineId).toBeNull();
      expect(lines.filter((l) => l.parentLineId !== null)).toHaveLength(1);
      expect(lines[1]!.productId).toBe(bacon.productId);
      expect(lines[1]!.quantity).toBe(2000);
      expect(lines[1]!.lineTotal).toBe(100);
    });
  });
});

describe("priceOrderLines extras quantities (resolve loop)", () => {
  /** An extras list offering ONE product at 0.50, with a configurable per-list `maxPicks` and
   *  per-item `maxQuantity`. */
  async function addQtyExtra(
    tx: Transaction,
    catalogueId: string,
    dishId: string,
    name: string,
    opts: { maxPicks?: number | null; maxQuantity?: number } = {},
  ): Promise<{ listId: string; productId: string }> {
    return addExtraList(tx, catalogueId, dishId, name, {
      price: "0.50",
      vatClass: "reduced",
      maxPicks: opts.maxPicks === undefined ? null : opts.maxPicks,
      maxQuantity: opts.maxQuantity ?? 1,
    });
  }

  /** An extras list offering TWO products (each 0.50), for the maxPicks-tally cases with distinct
   *  picks. */
  async function addTwoProductList(
    tx: Transaction,
    catalogueId: string,
    dishId: string,
    opts: { maxPicks?: number; maxQuantity?: number } = {},
  ): Promise<{ listId: string; uno: string; dos: string }> {
    const offered = [];
    for (const name of ["Uno", "Dos"]) {
      offered.push(
        await createProduct(tx, {
          catalogueId,
          categoryId: null,
          name,
          pricingUnit: "each",
          unitPrice: "9.99",
          vatClass: "reduced",
        }),
      );
    }
    const list = await catalogue.createExtraList(
      tx,
      {
        name: "Extras list",
        customerName: null,
        kitchenName: null,
        minPicks: 0,
        maxPicks: opts.maxPicks ?? 2,
        active: true,
        items: offered.map((product) => ({
          productId: product.id,
          maxQuantity: opts.maxQuantity ?? 1,
          preselected: false,
          price: "0.50",
        })),
      },
      LOCALE,
    );
    await attachModifierList(tx, dishId, { kind: "extras", id: list.id });
    return { listId: list.id, uno: offered[0]!.id, dos: offered[1]!.id };
  }

  it("prices & persists a pick ×2 on a dish ×3 as a child of combined quantity 6, dish unchanged", async () => {
    const { cfg, cafeId, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const shot = await addQtyExtra(tx, catalogueId, cafeId, "Extra shot", {
        maxPicks: 5,
        maxQuantity: 5,
      });
      const id = randomUUID();
      await createOpenOrder(
        tx,
        cfg,
        id,
        [
          {
            productId: cafeId,
            quantity: "3",
            extras: [{ listId: shot.listId, picks: [{ productId: shot.productId, quantity: 2 }] }],
          },
        ],
        null,
      );
      const lines = await tx
        .select({
          id: workingOrderLines.id,
          productId: workingOrderLines.productId,
          parentLineId: workingOrderLines.parentLineId,
          quantity: workingOrderLines.quantity,
          unitPriceGross: workingOrderLines.unitPriceGross,
          lineTotal: workingOrderLines.lineTotal,
        })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, id))
        .orderBy(workingOrderLines.lineNo);
      expect(lines).toHaveLength(2);
      // Parent dish row is UNCHANGED: its own product, no parent link, quantity still 3.
      expect(lines[0]).toMatchObject({
        productId: cafeId,
        parentLineId: null,
        // Three units, as a count of thousandths off the column.
        quantity: 3000,
      });
      // Child row: combined 3 × 2 = 6, per-unit gross the offer's 0.50, total 0.50 × 6 = 3.00 —
      // read straight off the columns, so 50 and 300 are those amounts as counts of whole cents,
      // and 6000 is the six picks in thousandths.
      expect(lines[1]!.parentLineId).toBe(lines[0]!.id);
      expect(lines[1]!.productId).toBe(shot.productId);
      expect(lines[1]!.quantity).toBe(6000);
      expect(lines[1]!.unitPriceGross).toBe(50);
      expect(lines[1]!.lineTotal).toBe(300);
    });
  });

  it("rejects a pick quantity above the item's maxQuantity", async () => {
    const { cfg, cafeId, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      // Item cap 2, but list maxPicks 5 so a tally of 3 does NOT trip the list cap first — the
      // per-item cap is what must reject it.
      const shot = await addQtyExtra(tx, catalogueId, cafeId, "Extra shot", {
        maxPicks: 5,
        maxQuantity: 2,
      });
      await expect(
        createOpenOrder(
          tx,
          cfg,
          randomUUID(),
          [
            {
              productId: cafeId,
              quantity: "1",
              extras: [
                { listId: shot.listId, picks: [{ productId: shot.productId, quantity: 3 }] },
              ],
            },
          ],
          null,
        ),
      ).rejects.toMatchObject({
        code: "extras.limit_exceeded",
        params: { extraListId: shot.listId },
      });
    });
  });

  it("rejects a pick quantity of 0, a fraction, or none at all", async () => {
    const { cfg, cafeId, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const shot = await addQtyExtra(tx, catalogueId, cafeId, "Extra shot", {
        maxPicks: 5,
        maxQuantity: 5,
      });
      // A count is a whole number of at least one, and it is not optional: an absent count is a
      // malformed answer rather than a silent ×1, so a client cannot leave the server to guess how
      // many of something it is serving.
      for (const pick of [
        { productId: shot.productId, quantity: 0 },
        { productId: shot.productId, quantity: 1.5 },
        { productId: shot.productId },
      ] as { productId: string; quantity: number }[]) {
        await expect(
          createOpenOrder(
            tx,
            cfg,
            randomUUID(),
            [
              {
                productId: cafeId,
                quantity: "1",
                extras: [{ listId: shot.listId, picks: [pick] }],
              },
            ],
            null,
          ),
        ).rejects.toMatchObject({ code: "extras.invalid", params: { field: "quantity" } });
      }
    });
  });

  it("counts a pick's quantity toward maxPicks: one product ×3 in a maxPicks 2 list is refused", async () => {
    const { cfg, cafeId, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      // Item cap 5 so the ×3 passes the per-item cap; the list's maxPicks 2 is what the summed tally
      // (3) must exceed — proving the tally is the SUM of quantities, not the distinct-product count.
      const shot = await addQtyExtra(tx, catalogueId, cafeId, "Extra shot", {
        maxPicks: 2,
        maxQuantity: 5,
      });
      await expect(
        createOpenOrder(
          tx,
          cfg,
          randomUUID(),
          [
            {
              productId: cafeId,
              quantity: "1",
              extras: [
                { listId: shot.listId, picks: [{ productId: shot.productId, quantity: 3 }] },
              ],
            },
          ],
          null,
        ),
      ).rejects.toMatchObject({
        code: "extras.limit_exceeded",
        params: { extraListId: shot.listId },
      });
    });
  });

  it("two distinct products ×1 each fit maxPicks 2, but one taken ×2 tips the summed tally over", async () => {
    const { cfg, cafeId, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const list = await addTwoProductList(tx, catalogueId, cafeId, {
        maxPicks: 2,
        maxQuantity: 5,
      });
      // one ×1 + one ×1 → tally 2 ≤ maxPicks 2 → OK (two child lines).
      const okId = randomUUID();
      await createOpenOrder(
        tx,
        cfg,
        okId,
        [
          {
            productId: cafeId,
            quantity: "1",
            extras: [
              {
                listId: list.listId,
                picks: [
                  { productId: list.uno, quantity: 1 },
                  { productId: list.dos, quantity: 1 },
                ],
              },
            ],
          },
        ],
        null,
      );
      const okLines = await tx
        .select({ parentLineId: workingOrderLines.parentLineId })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, okId));
      expect(okLines.filter((l) => l.parentLineId !== null)).toHaveLength(2);

      // same two products, but uno ×2 → tally 2 + 1 = 3 > maxPicks 2 → refused.
      await expect(
        createOpenOrder(
          tx,
          cfg,
          randomUUID(),
          [
            {
              productId: cafeId,
              quantity: "1",
              extras: [
                {
                  listId: list.listId,
                  picks: [
                    { productId: list.uno, quantity: 2 },
                    { productId: list.dos, quantity: 1 },
                  ],
                },
              ],
            },
          ],
          null,
        ),
      ).rejects.toMatchObject({
        code: "extras.limit_exceeded",
        params: { extraListId: list.listId },
      });
    });
  });

  it("a pick of ×1 on a dish ×2 gives a child of 2", async () => {
    const { cfg, cafeId, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const shot = await addQtyExtra(tx, catalogueId, cafeId, "Extra shot", {
        maxPicks: 1,
        maxQuantity: 1,
      });
      const id = randomUUID();
      await createOpenOrder(
        tx,
        cfg,
        id,
        [
          {
            productId: cafeId,
            quantity: "2",
            extras: [{ listId: shot.listId, picks: [{ productId: shot.productId, quantity: 1 }] }],
          },
        ],
        null,
      );
      const lines = await tx
        .select({
          parentLineId: workingOrderLines.parentLineId,
          productId: workingOrderLines.productId,
          quantity: workingOrderLines.quantity,
          lineTotal: workingOrderLines.lineTotal,
        })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, id))
        .orderBy(workingOrderLines.lineNo);
      expect(lines).toHaveLength(2);
      // Child combined = dish ×2 × pick ×1 = 2; 0.50 × 2 = 1.00. Off the row: 100 whole cents,
      // and 2000 thousandths for the two.
      expect(lines[1]!.productId).toBe(shot.productId);
      expect(lines[1]!.quantity).toBe(2000);
      expect(lines[1]!.lineTotal).toBe(100);
    });
  });
});

describe("priceOrderLines course-override validation (KDS-2 A1)", () => {
  /** Open a fresh empty tab in the venue and return its id — the addTabRound host these cases fire on. */
  async function openEmptyTab(tx: Transaction, cfg: TillConfig): Promise<string> {
    const tableId = await makeTable(tx, cfg);
    const { tabId } = await openTab(tx, cfg, { tableId });
    return tabId;
  }

  it("rejects a malformed (non-uuid) course override with course.not_found", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const cafe = await makeProduct(tx, cfg, catalogueId, {});
      const tabId = await openEmptyTab(tx, cfg);
      await expect(
        addTabRound(tx, cfg, tabId, [{ productId: cafe, quantity: "1", courseId: "not-a-uuid" }]),
      ).rejects.toMatchObject({ code: "course.not_found", params: { courseId: "not-a-uuid" } });
    });
  });

  it("rejects an unknown (well-formed but absent) course override with course.not_found", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const cafe = await makeProduct(tx, cfg, catalogueId, {});
      const tabId = await openEmptyTab(tx, cfg);
      const missing = randomUUID();
      await expect(
        addTabRound(tx, cfg, tabId, [{ productId: cafe, quantity: "1", courseId: missing }]),
      ).rejects.toMatchObject({ code: "course.not_found", params: { courseId: missing } });
    });
  });

  it("rejects a DIFFERENT venue's course of the same tenant with course.not_found", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const cafe = await makeProduct(tx, cfg, catalogueId, {});
      const tabId = await openEmptyTab(tx, cfg);
      // A second venue in the same database, and a course that lives there. The by-id FK on
      // working_order_lines.course_id would ACCEPT it, but requireLiveCourse is
      // location-scoped, so the cross-venue override is refused — the exact silent-accept bug A1 closes.
      // Through the table definition: `invoice_locales` is a JSON array in a text column here, so
      // there is no array constructor to write, and `id` is a `$defaultFn` a raw insert misses.
      const location2Id = randomUUID();
      await tx.insert(locations).values({
        id: location2Id,
        name: "Barra 2",
        invoiceLocales: [LOCALE],
        operationDescription: "Venta en establecimiento",
      });
      const cfg2: TillConfig = { ...cfg, locationId: brandLocationId(location2Id) };
      const foreign = await createCourse(tx, cfg2, { name: "Entrantes", displayOrder: 0 });
      await expect(
        addTabRound(tx, cfg, tabId, [{ productId: cafe, quantity: "1", courseId: foreign.id }]),
      ).rejects.toMatchObject({ code: "course.not_found", params: { courseId: foreign.id } });
    });
  });

  it("rejects a DEACTIVATED course override with course.not_found", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const cafe = await makeProduct(tx, cfg, catalogueId, {});
      const tabId = await openEmptyTab(tx, cfg);
      const dead = await createCourse(tx, cfg, { name: "Entrantes", displayOrder: 0 });
      await deactivateCourse(tx, cfg, dead.id);
      await expect(
        addTabRound(tx, cfg, tabId, [{ productId: cafe, quantity: "1", courseId: dead.id }]),
      ).rejects.toMatchObject({ code: "course.not_found", params: { courseId: dead.id } });
    });
  });

  it("accepts a valid active course override and resolves it (the override wins over the product default)", async () => {
    const { cfg, catalogueId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      // The product DEFAULT differs from the override — proving the override WINS and is snapshotted,
      // and that a legitimate active override is not rejected by the new screen.
      const def = await createCourse(tx, cfg, { name: "Entrantes", displayOrder: 0 });
      const override = await createCourse(tx, cfg, { name: "Principales", displayOrder: 1 });
      const cafe = await makeProduct(tx, cfg, catalogueId, {});
      await setProductCourse(tx, cfg, cafe, def.id);
      const tabId = await openEmptyTab(tx, cfg);
      await addTabRound(tx, cfg, tabId, [
        { productId: cafe, quantity: "1", courseId: override.id },
      ]);
      const items = await courseItemsFor(tx, tabId);
      expect(items).toHaveLength(1);
      expect(items[0]!.courseId).toBe(override.id);
    });
  });
});

// An options answer is frozen onto a dish that declares milk + vegan. The dish's own allergens and its
// own vegan declaration are what the station and expo snapshots show; the answer rides beside them.
it("shows the dish's own allergens and diet beside a frozen options answer", async () => {
  const { cfg, catalogueId } = await setupVenue();
  await withTransaction(db, async (tx) => {
    const station = await createStation(tx, cfg, { name: "Kitchen", isDefault: true });
    const product = await createProduct(tx, {
      catalogueId,
      categoryId: null,
      name: "Coffee",
      pricingUnit: "each",
      unitPrice: "2.00",
      vatClass: "general",
      allergens: { milk: { presence: "contains" } },
      dietaryDeclarations: ["vegan"],
    });
    const milk = await addOptionList(tx, product.id, "Milk", ["Oat"]);
    const { id: orderId } = await placeOrderWith(tx, cfg, [
      {
        productId: product.id,
        quantity: "1",
        options: [{ listId: milk.listId, labelId: milk.labelIds[0]! }],
      },
    ]);
    void orderId;
    const optionSnapshots = [
      {
        listName: { [CONTENT_LANGUAGE]: "Milk list staff" },
        listCustomerName: { [CONTENT_LANGUAGE]: "Milk list customer" },
        listKitchenName: "Milk list kitchen",
        labelName: { [CONTENT_LANGUAGE]: "Oat staff" },
        labelCustomerName: { [CONTENT_LANGUAGE]: "Oat customer" },
        labelKitchenName: "Oat kitchen",
      },
    ];
    const own = { allergens: { milk: { presence: "contains" } }, pending: false };
    const ownDiet = { vegan: "yes", vegetarian: "yes", contains: [] };
    const queue = await listStationQueue(tx, station.id);
    expect(queue[0]!.items[0]!.asServed).toEqual(own);
    expect(queue[0]!.items[0]!.optionSnapshots).toEqual(optionSnapshots);
    expect(queue[0]!.items[0]!.asServedDiet).toEqual(ownDiet);
    const expo = await listExpoQueue(tx, cfg);
    expect(expo[0]!.courses[0]!.items[0]!.asServed).toEqual(own);
    expect(expo[0]!.courses[0]!.items[0]!.optionSnapshots).toEqual(optionSnapshots);
    expect(expo[0]!.courses[0]!.items[0]!.asServedDiet).toEqual(ownDiet);
  });
});

describe("frozen answers through a fractional quantity edit", () => {
  it.each(["menu", "product"])(
    "preserves %s answers and the locked price when a weighed dish's quantity changes",
    async (source) => {
      const { cfg, cafeId, cafeOfferId, zoneId, kgUnitId } = await setupVenue();
      // A WEIGHED dish: the quantity edit below moves a fraction, which is where the decimal
      // arithmetic behind the preserve path is most likely to go wrong. The answer is an OPTIONS one
      // because it makes no child line — an extras pick on a dish sold by weight is refused, by the
      // test below this one.
      const taza = await withTransaction(db, async (tx) => {
        await catalogue.assignProductUnit(tx, cafeId, kgUnitId);
        return addOptionList(tx, cafeId, "Taza", ["Grande"]);
      });
      const options = [{ listId: taza.listId, labelId: taza.labelIds[0]! }];
      const result = await parkOrder({ db }, cfg, {
        id: randomUUID(),
        ...(source === "menu" ? { zoneId } : {}),
        lines: [
          {
            ...(source === "menu" ? { menuItemId: cafeOfferId } : { productId: cafeId }),
            quantity: "0.500",
            options,
          },
        ],
      });
      const held = await getHeldOrder({ db }, cfg, result.id);
      expect(held.lines).toHaveLength(1);
      const frozen = [
        {
          listName: { [CONTENT_LANGUAGE]: "Taza list staff" },
          listCustomerName: { [CONTENT_LANGUAGE]: "Taza list customer" },
          listKitchenName: "Taza list kitchen",
          labelName: { [CONTENT_LANGUAGE]: "Grande staff" },
          labelCustomerName: { [CONTENT_LANGUAGE]: "Grande customer" },
          labelKitchenName: "Grande kitchen",
        },
      ];
      expect(held.lines[0]).toMatchObject({ optionSnapshots: frozen });
      const stored = await db
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, result.id))
        .orderBy(workingOrderLines.lineNo);
      expect(stored).toHaveLength(1);
      const lockedGross = stored[0]!.unitPriceGross;

      // The catalogue moves under the parked order; the locked line must not follow it.
      await db.execute(sql`update products set unit_price = 9900 where id = ${cafeId}`);
      await db.execute(sql`update menu_items set gross_price = 9900 where id = ${cafeOfferId}`);

      await updateHeldOrder({ db }, cfg, result.id, {
        lines: [
          {
            workingOrderLineId: held.lines[0]!.workingOrderLineId,
            ...(source === "menu" ? { menuItemId: cafeOfferId } : { productId: cafeId }),
            quantity: "1.000",
            options,
          },
        ],
      });
      const updated = await db
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, result.id))
        .orderBy(workingOrderLines.lineNo);
      expect(updated).toHaveLength(1);
      expect(updated[0]).toMatchObject({
        // Off the column: 1000 is the edited one unit, as a count of thousandths.
        quantity: 1000,
        unitPriceGross: lockedGross,
        // One unit of the locked gross, so the total is that gross unchanged.
        lineTotal: lockedGross,
      });
      expect(updated[0]!.optionSnapshots).toEqual(frozen);
    },
  );

  it("refuses an extras pick on a menu offer whose dish is sold by weight", async () => {
    const { cfg, cafeId, catalogueId, cafeOfferId, zoneId, kgUnitId } = await setupVenue();
    const bacon = await withTransaction(db, async (tx) => {
      await catalogue.assignProductUnit(tx, cafeId, kgUnitId);
      const attached = await addExtraList(tx, catalogueId, cafeId, "Bacon", { price: "1.00" });
      await catalogue.setMenuItemExtraLists(tx, cafeOfferId, [
        {
          listId: attached.listId,
          items: [{ productId: attached.productId, price: "1.00", available: true }],
        },
      ]);
      return attached;
    });
    // A child is priced at `dishQuantity × pickQuantity`, so half a kilo of dish carrying one extra
    // would bill half an extra. THE OFFER PATH IS THE ONLY ONE THAT REFUSES IT: it reads the dish's
    // pricing unit off the unit the dish carries, while the plain product path reads
    // `products.pricing_unit`, which `assignProductUnit` leaves on `each`. The disagreement is
    // recorded in docs/backlog.md; this pins the half that refuses.
    await expect(
      parkOrder({ db }, cfg, {
        id: randomUUID(),
        zoneId,
        lines: [
          {
            menuItemId: cafeOfferId,
            quantity: "0.500",
            extras: [
              { listId: bacon.listId, picks: [{ productId: bacon.productId, quantity: 1 }] },
            ],
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: "extras.unsupported_product",
      params: { productId: cafeId, pricingUnit: "weight" },
    });
  });
});

it("does not let an omitted payload waive a required extras list the menu offer has emptied", async () => {
  const { cfg, cafeId, catalogueId, cafeOfferId, zoneId } = await setupVenue();
  const bacon = await withTransaction(db, async (tx) => {
    // The list REQUIRES one pick, and the offer withdraws its only product — so the offer publishes a
    // list nothing can satisfy. Sending no answer at all must not waive it.
    const attached = await addExtraList(tx, catalogueId, cafeId, "Bacon", { minPicks: 1 });
    await catalogue.setMenuItemExtraLists(tx, cafeOfferId, [
      {
        listId: attached.listId,
        items: [{ productId: attached.productId, price: null, available: false }],
      },
    ]);
    return attached;
  });
  await expect(
    parkOrder({ db }, cfg, {
      id: randomUUID(),
      zoneId,
      lines: [{ menuItemId: cafeOfferId, quantity: "1" }],
    }),
  ).rejects.toMatchObject({
    code: "extras.limit_exceeded",
    params: { extraListId: bacon.listId },
  });
});

/**
 * Task 7 — the order path for the new model: a dish's OPTIONS answers freeze onto the dish line as
 * `option_snapshots`, and its EXTRAS picks become child lines carrying the picked PRODUCT.
 *
 * Every name in the fixture carries its own text, so a read of the wrong one of the six fails
 * (CLAUDE.md §3).
 */
describe("order path — extras and options", () => {
  interface Seeded {
    cfg: TillConfig;
    dishId: string;
    wineId: string;
    extraListId: string;
    optionListId: string;
    labelId: string;
    defaultLanguage: string;
  }

  /** A 10% dish offering a 21% wine as an extra and one options list that must be answered. */
  async function seedDish(maxPicks: number | null = 1): Promise<Seeded> {
    const { cfg, catalogueId } = await setupVenue();
    return withTransaction(db, async (tx) => {
      const { defaultLanguage } = await catalogue.readContentLanguages(tx, cfg.locale);
      const dish = await createProduct(tx, {
        catalogueId,
        categoryId: null,
        name: "Pizza",
        pricingUnit: "each",
        unitPrice: "10.00",
        vatClass: "reduced",
      });
      const wine = await createProduct(tx, {
        catalogueId,
        categoryId: null,
        name: "Vino staff",
        customerName: { [defaultLanguage]: "Vino customer" },
        kitchenName: "Vino kitchen",
        pricingUnit: "each",
        // The list item's own price outranks this, so a child priced at 3.00 would mean the offer
        // was never read.
        unitPrice: "3.00",
        vatClass: "general",
      });
      const extraList = await catalogue.createExtraList(
        tx,
        {
          name: "Vinos staff",
          customerName: { [defaultLanguage]: "Vinos customer" },
          kitchenName: "Vinos kitchen",
          minPicks: 0,
          maxPicks,
          active: true,
          items: [{ productId: wine.id, maxQuantity: 2, preselected: false, price: "4.50" }],
        },
        cfg.locale,
      );
      const optionList = await catalogue.createOptionList(
        tx,
        {
          name: "Cooked staff",
          customerName: { [defaultLanguage]: "Cooked customer" },
          kitchenName: "Cooked kitchen",
          defaultLabelId: null,
          active: true,
          labels: [
            {
              name: "Rare staff",
              customerName: { [defaultLanguage]: "Rare customer" },
              kitchenName: "Rare kitchen",
              available: true,
            },
          ],
        },
        cfg.locale,
      );
      await catalogue.writeProductModifiers(tx, dish.id, [
        { kind: "extras", id: extraList.id },
        { kind: "options", id: optionList.id },
      ]);
      return {
        cfg,
        dishId: dish.id,
        wineId: wine.id,
        extraListId: extraList.id,
        optionListId: optionList.id,
        labelId: optionList.labels[0]!.id,
        defaultLanguage,
      };
    });
  }

  it("freezes the list's and the chosen label's three names onto the dish line", async () => {
    const seeded = await seedDish();
    const id = randomUUID();
    await parkOrder({ db }, seeded.cfg, {
      id,
      lines: [
        {
          productId: seeded.dishId,
          quantity: "1",
          options: [{ listId: seeded.optionListId, labelId: seeded.labelId }],
        },
      ],
    });
    const lines = await db
      .select({
        lineNo: workingOrderLines.lineNo,
        optionSnapshots: workingOrderLines.optionSnapshots,
      })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.optionSnapshots).toEqual([
      {
        listName: { [seeded.defaultLanguage]: "Cooked staff" },
        listCustomerName: { [seeded.defaultLanguage]: "Cooked customer" },
        listKitchenName: "Cooked kitchen",
        labelName: { [seeded.defaultLanguage]: "Rare staff" },
        labelCustomerName: { [seeded.defaultLanguage]: "Rare customer" },
        labelKitchenName: "Rare kitchen",
      },
    ]);
  });

  it("an extra child line carries product_id and the extra product's OWN vat rate", async () => {
    const seeded = await seedDish();
    const id = randomUUID();
    await parkOrder({ db }, seeded.cfg, {
      id,
      lines: [
        {
          productId: seeded.dishId,
          quantity: "2",
          extras: [
            { listId: seeded.extraListId, picks: [{ productId: seeded.wineId, quantity: 1 }] },
          ],
          options: [{ listId: seeded.optionListId, labelId: seeded.labelId }],
        },
      ],
    });
    const lines = await db
      .select({
        lineNo: workingOrderLines.lineNo,
        parentLineId: workingOrderLines.parentLineId,
        productId: workingOrderLines.productId,
        name: workingOrderLines.name,
        descriptions: workingOrderLines.descriptions,
        kitchenName: workingOrderLines.kitchenName,
        quantity: workingOrderLines.quantity,
        unitPriceGross: workingOrderLines.unitPriceGross,
        vatRate: workingOrderLines.vatRate,
        lineTotal: workingOrderLines.lineTotal,
      })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);
    expect(lines).toHaveLength(2);
    const [dish, child] = lines;
    // `vat_rate` is read straight off the column, so 1000 is the dish's 10% in basis points.
    expect(dish!.vatRate).toBe(1000);
    expect(child!.parentLineId).toBe(
      (
        await db
          .select({ id: workingOrderLines.id })
          .from(workingOrderLines)
          .where(
            and(
              eq(workingOrderLines.workingOrderId, id),
              eq(workingOrderLines.lineNo, dish!.lineNo),
            ),
          )
      )[0]!.id,
    );
    // The child IS the wine, by id — the whole point of the column that replaced
    // `option_group_item_id`.
    expect(child!.productId).toBe(seeded.wineId);
    // The wine's three names, frozen: staff on `name`, customer re-keyed onto the venue's invoice
    // locale, kitchen on `kitchen_name`.
    expect(child!.name).toBe("Vino staff");
    expect(child!.descriptions).toEqual({ [LOCALE]: "Vino customer" });
    expect(child!.kitchenName).toBe("Vino kitchen");
    // The extra PRODUCT's own VAT, never the 10% dish's (spec §3.3, decision 9).
    expect(child!.vatRate).toBe(2100);
    // The list ITEM's price, not the wine's own 3.00; dish ×2 × pick ×1 = 2. All three columns are
    // read straight off the row, each at its own scale: 450 is that 4.50 and 900 the 9.00 total in
    // whole cents, and 2000 is the two picks in thousandths.
    expect(child!.unitPriceGross).toBe(450);
    expect(child!.quantity).toBe(2000);
    expect(child!.lineTotal).toBe(900);
  });

  it("refuses a dish whose options list is left unanswered", async () => {
    const seeded = await seedDish();
    await expect(
      parkOrder({ db }, seeded.cfg, {
        id: randomUUID(),
        lines: [{ productId: seeded.dishId, quantity: "1" }],
      }),
    ).rejects.toMatchObject({
      code: "options.label_required",
      params: { optionListId: seeded.optionListId },
    });
  });

  it("refuses more picks than the extras list allows", async () => {
    const seeded = await seedDish();
    await expect(
      parkOrder({ db }, seeded.cfg, {
        id: randomUUID(),
        lines: [
          {
            productId: seeded.dishId,
            quantity: "1",
            extras: [
              { listId: seeded.extraListId, picks: [{ productId: seeded.wineId, quantity: 2 }] },
            ],
            options: [{ listId: seeded.optionListId, labelId: seeded.labelId }],
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: "extras.limit_exceeded",
      params: { extraListId: seeded.extraListId },
    });
  });
});

/**
 * Which edits `updateHeldOrder` preserves the stored lines for, and which it replaces them for.
 *
 * The reorder cases are the ones that paid for the comparison being order-independent: the order a
 * dish's lists are offered in is a stored position a save re-numbers, so a line parked before a
 * reorder keeps the OLD one while the rebuilt side comes back in the new one, and a comparison
 * pairing the two up position by position reads that as a changed answer and re-prices a
 * quantity-only edit. These two cases reorder through `writeProductModifiers`
 * (`packages/catalogue/src/product-modifiers.ts`), which is one of the three columns that carry
 * that position — `docs/developers/modifiers.md` lists all three.
 */
describe("what a held-order edit preserves and what it replaces", () => {
  it("keeps the line's id and locked price when two options lists change places", async () => {
    const { cfg, zoneId, cafeId, premiumCafeOfferId } = await setupVenue();
    const seeded = await withTransaction(db, async (tx) => {
      const punto = await addOptionList(tx, cafeId, "Punto", ["Solo"]);
      const taza = await addOptionList(tx, cafeId, "Taza", ["Grande"]);
      return { punto, taza };
    });
    const options = [
      { listId: seeded.punto.listId, labelId: seeded.punto.labelIds[0]! },
      { listId: seeded.taza.listId, labelId: seeded.taza.labelIds[0]! },
    ];
    const id = randomUUID();
    await parkOrder({ db }, cfg, {
      id,
      zoneId,
      lines: [{ menuItemId: premiumCafeOfferId, quantity: "1", options }],
    });
    const before = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);
    expect(before).toHaveLength(1);

    // The manager swaps the two lists over, and the menu price moves, so a line that took the
    // replacement path would be visibly re-priced rather than merely re-issued. Replacing the whole
    // set is the point here, so this goes straight to `writeProductModifiers` rather than through
    // `attachModifierList`, which exists to ADD one without disturbing the rest.
    await withTransaction(db, async (tx) => {
      await catalogue.writeProductModifiers(tx, cafeId, [
        { kind: "options", id: seeded.taza.listId },
        { kind: "options", id: seeded.punto.listId },
      ]);
    });
    await db.execute(sql`
      update menu_items set gross_price = 9900 where id = ${premiumCafeOfferId}`);

    await updateHeldOrder({ db }, cfg, id, {
      lines: [
        {
          workingOrderLineId: before[0]!.id,
          menuItemId: premiumCafeOfferId,
          quantity: "2",
          options,
        },
      ],
    });

    const after = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({
      id: before[0]!.id,
      // Two units, as a count of thousandths off the column.
      quantity: 2000,
      // The offer's 3.25 at park time, not the 99.00 it now costs, and twice it for the total —
      // both read straight off the row, so 325 and 650 are those amounts in whole cents.
      unitPriceGross: 325,
      lineTotal: 650,
    });
    expect(after[0]!.optionSnapshots).toEqual(before[0]!.optionSnapshots);
  });

  it("keeps each extras child on its own row when two extras lists change places", async () => {
    const { cfg, cafeId, catalogueId } = await setupVenue();
    const seeded = await withTransaction(db, async (tx) => {
      const bacon = await addExtraList(tx, catalogueId, cafeId, "Bacon", { price: "1.00" });
      const leche = await addExtraList(tx, catalogueId, cafeId, "Leche", {
        price: "0.30",
        maxQuantity: 3,
      });
      return { bacon, leche };
    });
    // The two picks differ, so a child that took the OTHER pick's count lands on a different
    // quantity — which is what makes the dish x picks arithmetic visible here rather than assumed.
    const extras = [
      { listId: seeded.bacon.listId, picks: [{ productId: seeded.bacon.productId, quantity: 1 }] },
      { listId: seeded.leche.listId, picks: [{ productId: seeded.leche.productId, quantity: 3 }] },
    ];
    const id = randomUUID();
    await parkOrder({ db }, cfg, {
      id,
      lines: [{ productId: cafeId, quantity: "1", extras }],
    });
    const before = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);
    expect(before).toHaveLength(3);

    // Replacing the whole set, as above.
    await withTransaction(db, async (tx) => {
      await catalogue.writeProductModifiers(tx, cafeId, [
        { kind: "extras", id: seeded.leche.listId },
        { kind: "extras", id: seeded.bacon.listId },
      ]);
    });
    await db.execute(sql`update products set unit_price = 9900 where id = ${cafeId}`);

    await updateHeldOrder({ db }, cfg, id, {
      lines: [{ workingOrderLineId: before[0]!.id, productId: cafeId, quantity: "2", extras }],
    });

    const after = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);
    // Every row keeps its id and the price it was sold at; only the quantities move, each child
    // following its own dish at dish × picks — so the three-pick child doubles to six.
    expect(
      after.map((line) => [line.id, line.quantity, line.unitPriceGross, line.lineTotal]),
    ).toEqual([
      // The dish at its own 1.50, twice; bacon at 1.00 for two dishes of one pick; milk at 0.30 for
      // two dishes of three picks. Every column is read straight off the row, each at its own
      // scale: the money in whole cents, the quantities in whole thousandths.
      [before[0]!.id, 2000, 150, 300],
      [before[1]!.id, 2000, 100, 200],
      [before[2]!.id, 6000, 30, 180],
    ]);
  });

  it("replaces the line when two lists offering the same product have their picks swapped", async () => {
    const { cfg, cafeId, catalogueId } = await setupVenue();
    // One wine, offered by two of the dish's lists at two prices. A child line records the product
    // it is, its quantity and the price it was sold at — never the list that offered it.
    const seeded = await withTransaction(db, async (tx) => {
      const cheap = await addExtraList(tx, catalogueId, cafeId, "Vino", {
        price: "1.00",
        maxQuantity: 3,
      });
      const dear = await catalogue.createExtraList(
        tx,
        {
          name: "Vino premium list staff",
          customerName: { [CONTENT_LANGUAGE]: "Vino premium list customer" },
          kitchenName: "Vino premium list kitchen",
          minPicks: 0,
          maxPicks: null,
          active: true,
          items: [
            { productId: cheap.productId, maxQuantity: 3, preselected: false, price: "3.00" },
          ],
        },
        LOCALE,
      );
      await attachModifierList(tx, cafeId, { kind: "extras", id: dear.id });
      return { wineId: cheap.productId, cheapListId: cheap.listId, dearListId: dear.id };
    });
    const picks = (cheapQuantity: number, dearQuantity: number) => [
      {
        listId: seeded.cheapListId,
        picks: [{ productId: seeded.wineId, quantity: cheapQuantity }],
      },
      { listId: seeded.dearListId, picks: [{ productId: seeded.wineId, quantity: dearQuantity }] },
    ];
    const id = randomUUID();
    await parkOrder({ db }, cfg, {
      id,
      lines: [{ productId: cafeId, quantity: "1", extras: picks(1, 2) }],
    });
    const before = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);
    // One off the 1.00 list and two off the 3.00 one, in whole cents off the column.
    expect(
      before.filter((line) => line.parentLineId !== null).map((line) => line.lineTotal),
    ).toEqual([100, 600]);

    // The two picks change places: two of the cheap one and one of the dear one, same dish count.
    await updateHeldOrder({ db }, cfg, id, {
      lines: [
        {
          workingOrderLineId: before[0]!.id,
          productId: cafeId,
          quantity: "1",
          extras: picks(2, 1),
        },
      ],
    });

    const after = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);
    expect(
      after.filter((line) => line.parentLineId !== null).map((line) => line.lineTotal),
    ).toEqual([200, 300]);
  });

  it("replaces the line when a pick moves to another list offering the same product", async () => {
    const { cfg, cafeId, catalogueId } = await setupVenue();
    const seeded = await withTransaction(db, async (tx) => {
      const cheap = await addExtraList(tx, catalogueId, cafeId, "Vino", { price: "1.00" });
      const dear = await catalogue.createExtraList(
        tx,
        {
          name: "Vino premium list staff",
          customerName: { [CONTENT_LANGUAGE]: "Vino premium list customer" },
          kitchenName: "Vino premium list kitchen",
          minPicks: 0,
          maxPicks: null,
          active: true,
          items: [
            { productId: cheap.productId, maxQuantity: 3, preselected: false, price: "3.00" },
          ],
        },
        LOCALE,
      );
      await attachModifierList(tx, cafeId, { kind: "extras", id: dear.id });
      return { wineId: cheap.productId, cheapListId: cheap.listId, dearListId: dear.id };
    });
    const id = randomUUID();
    await parkOrder({ db }, cfg, {
      id,
      lines: [
        {
          productId: cafeId,
          quantity: "1",
          extras: [
            { listId: seeded.cheapListId, picks: [{ productId: seeded.wineId, quantity: 1 }] },
          ],
        },
      ],
    });
    const before = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);
    expect(
      before.filter((line) => line.parentLineId !== null).map((line) => line.lineTotal),
    ).toEqual([100]);

    // ONE pick, moved off the 1.00 list onto the 3.00 one. The product and the count are the same,
    // and neither is what changed.
    await updateHeldOrder({ db }, cfg, id, {
      lines: [
        {
          workingOrderLineId: before[0]!.id,
          productId: cafeId,
          quantity: "1",
          extras: [
            { listId: seeded.dearListId, picks: [{ productId: seeded.wineId, quantity: 1 }] },
          ],
        },
      ],
    });

    const after = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);
    expect(
      after.filter((line) => line.parentLineId !== null).map((line) => line.lineTotal),
    ).toEqual([300]);
  });

  it("replaces the line when the answer itself changed, re-pricing it from today's offer", async () => {
    const { cfg, zoneId, cafeId, premiumCafeOfferId } = await setupVenue();
    const punto = await withTransaction(db, async (tx) => {
      return addOptionList(tx, cafeId, "Punto", ["Solo", "Cortado"]);
    });
    const id = randomUUID();
    await parkOrder({ db }, cfg, {
      id,
      zoneId,
      lines: [
        {
          menuItemId: premiumCafeOfferId,
          quantity: "1",
          options: [{ listId: punto.listId, labelId: punto.labelIds[0]! }],
        },
      ],
    });
    const before = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);
    await db.execute(sql`
      update menu_items set gross_price = 9900 where id = ${premiumCafeOfferId}`);

    // Same dish, same quantity, a DIFFERENT label off the same list.
    await updateHeldOrder({ db }, cfg, id, {
      lines: [
        {
          workingOrderLineId: before[0]!.id,
          menuItemId: premiumCafeOfferId,
          quantity: "1",
          options: [{ listId: punto.listId, labelId: punto.labelIds[1]! }],
        },
      ],
    });

    const after = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);
    expect(after[0]!.id).not.toEqual(before[0]!.id);
    // Re-priced from today's offer: 9900 whole cents is that 99.00, off the column.
    expect(after[0]!.unitPriceGross).toEqual(9900);
    expect(after[0]!.optionSnapshots[0]).toMatchObject({
      labelName: { [CONTENT_LANGUAGE]: "Cortado staff" },
    });
  });

  it("refuses an edit whose new answer breaks the list's own rules", async () => {
    const { cfg, cafeId, catalogueId } = await setupVenue();
    const bacon = await withTransaction(db, async (tx) => {
      return addExtraList(tx, catalogueId, cafeId, "Bacon", { price: "1.00" });
    });
    const id = randomUUID();
    await parkOrder({ db }, cfg, {
      id,
      lines: [
        {
          productId: cafeId,
          quantity: "1",
          extras: [{ listId: bacon.listId, picks: [{ productId: bacon.productId, quantity: 1 }] }],
        },
      ],
    });
    const before = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);

    // Two of an item capped at one. The preserve check cannot hold, and what the caller is told
    // comes from the replacement path re-validating the answer — not from the preserve check, which
    // only ever answers "not this edit".
    await expect(
      updateHeldOrder({ db }, cfg, id, {
        lines: [
          {
            workingOrderLineId: before[0]!.id,
            productId: cafeId,
            quantity: "1",
            extras: [
              { listId: bacon.listId, picks: [{ productId: bacon.productId, quantity: 2 }] },
            ],
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: "extras.limit_exceeded",
      params: { extraListId: bacon.listId },
    });
    const after = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);
    expect(after.map((line) => line.id)).toEqual(before.map((line) => line.id));
  });

  /**
   * The settled behaviour, not an oversight: `docs/developers/modifiers.md` carries the reason a
   * names-only snapshot cannot tell a rename from a different answer, and why giving the comparison
   * an id to use would mean putting one on the line.
   */
  it("re-prices a held line when the options list it answered was renamed between the two sends", async () => {
    const { cfg, zoneId, cafeId, premiumCafeOfferId } = await setupVenue();
    const punto = await withTransaction(db, async (tx) => {
      return addOptionList(tx, cafeId, "Punto", ["Solo"]);
    });
    const options = [{ listId: punto.listId, labelId: punto.labelIds[0]! }];
    const id = randomUUID();
    await parkOrder({ db }, cfg, {
      id,
      zoneId,
      lines: [{ menuItemId: premiumCafeOfferId, quantity: "1", options }],
    });
    const before = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);

    await db.execute(
      sql`update option_lists set name = 'Renamed staff' where id = ${punto.listId}`,
    );
    await db.execute(sql`
      update menu_items set gross_price = 9900 where id = ${premiumCafeOfferId}`);

    await updateHeldOrder({ db }, cfg, id, {
      lines: [
        {
          workingOrderLineId: before[0]!.id,
          menuItemId: premiumCafeOfferId,
          quantity: "2",
          options,
        },
      ],
    });

    const after = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);
    expect(after).toHaveLength(1);
    expect(after[0]!.id).not.toEqual(before[0]!.id);
    // Re-priced from today's offer: 9900 whole cents is that 99.00, off the column.
    expect(after[0]!.unitPriceGross).toEqual(9900);
    expect(after[0]!.optionSnapshots[0]).toMatchObject({
      listName: { [CONTENT_LANGUAGE]: "Renamed staff" },
    });
  });

  /**
   * The body a till line sends is the same one an edit sends, so an edit that carries no `options`
   * key is refused exactly as a first order would be — `validateOptionSelections`
   * (`packages/catalogue/src/option-contract.ts`) walks the dish's ACTIVE lists and throws for the
   * first one no answer names, whether the line is new or being changed. That is what a RETRIEVED
   * till line used to send, because the server hands its answers back as six frozen names and no
   * ids.
   *
   * The next case is the control: the same edit body against a dish carrying NO options list, which
   * succeeds — so the refusal below is the options list and not the shape of the edit.
   */
  it("refuses a quantity-only edit that names no answer for an active options list", async () => {
    const { cfg, zoneId, cafeId, premiumCafeOfferId } = await setupVenue();
    const punto = await withTransaction(db, async (tx) => {
      return addOptionList(tx, cafeId, "Punto", ["Solo"]);
    });
    const id = randomUUID();
    await parkOrder({ db }, cfg, {
      id,
      zoneId,
      lines: [
        {
          menuItemId: premiumCafeOfferId,
          quantity: "1",
          options: [{ listId: punto.listId, labelId: punto.labelIds[0]! }],
        },
      ],
    });
    const before = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);

    await expect(
      updateHeldOrder({ db }, cfg, id, {
        lines: [
          {
            workingOrderLineId: before[0]!.id,
            menuItemId: premiumCafeOfferId,
            quantity: "2",
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: "options.label_required",
      params: { optionListId: punto.listId },
    });
  });

  it("accepts the same quantity-only edit on a dish carrying no options list", async () => {
    const { cfg, zoneId, premiumCafeOfferId } = await setupVenue();
    const id = randomUUID();
    await parkOrder({ db }, cfg, {
      id,
      zoneId,
      lines: [{ menuItemId: premiumCafeOfferId, quantity: "1" }],
    });
    const before = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);

    await updateHeldOrder({ db }, cfg, id, {
      lines: [{ workingOrderLineId: before[0]!.id, menuItemId: premiumCafeOfferId, quantity: "2" }],
    });

    const after = await db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);
    expect(after).toHaveLength(1);
    // Two units, as a count of thousandths off the column.
    expect(after[0]).toMatchObject({ id: before[0]!.id, quantity: 2000 });
  });
});
