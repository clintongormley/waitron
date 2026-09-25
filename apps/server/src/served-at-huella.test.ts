import { describe, expect, it } from "vitest";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import {
  saleLines,
  sales,
  ticketItems,
  withTransaction,
  workingOrderLines,
  workingOrders,
  type Database,
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
  createProduct,
  readProductEditor,
  setMenuItemExtraLists,
  writeProductModifiers,
} from "@waitron/catalogue";
import { VerifactuBackend, registerSif, registrosFacturacion } from "@waitron/fiscal-verifactu";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { hashPassword, hashPin } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import type { VenueRequest, VenueResult } from "@waitron/provisioning";
import { allowMenuInZone, preparationRoutes } from "@waitron/venue-service";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import { deploymentEnvironment } from "./config.js";
import { ALL_MODULES } from "./modules.js";
import type { TillConfig } from "./till-config.js";
import { createTable, createZone, listTables, setTablePlacement } from "./tables.js";
import {
  addTabRound,
  advanceTicketItem,
  fireLines,
  markLineServed,
  openTab,
  type TicketState,
} from "./working-order.js";
import { payWorkingOrder } from "./till-sale.js";
import { offerProducts } from "./testing/zone-offers.js";
import "./errors.js";

// The fiscal firewall (CLAUDE.md §5): our own metadata never enters `computeHuella`. `served_at` is
// a `working_order_lines` field the pay path never reads: `payWorkingOrder` files from the tab's
// STORED locked lines. Two tabs built from the IDENTICAL basket, one with every line served and one
// with none, must file registros with the IDENTICAL huella — each a genuine chained record filed
// through the real pay path.
const LOCALE = "es-ES";

// TWO independent databases, one shop and one fiscal chain in each (see `seedShop`).
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
const suiteB = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

/**
 * A clock FROZEN at one instant, so both pays stamp the SAME `issued_at` — and so the same
 * `FechaExpedicionFactura` and `FechaHoraHusoGenRegistro` reach `computeHuella`. Without it the two
 * huellas would differ for a reason unrelated to what each test varies.
 */
const FROZEN_INSTANT = new Date("2026-07-20T17:20:30.000Z");
function frozenClock(): TrustedClock {
  return {
    now: () => ({
      instant: FROZEN_INSTANT,
      offsetMinutes: 120,
      confident: true,
      confidence: "anchored",
      anchorAgeSeconds: 0,
    }),
    anchor: () => {
      throw new Error("served-at-huella.test: anchor() is not used by recordSale");
    },
    currentAnchor: () => null,
  };
}

const clock: TrustedClock = frozenClock();

/** A fiscal backend bound to ONE shop's database — each database has its own, because the backend
 *  reads and files against the `db` it is constructed with. */
function makeBackend(db: Database): FiscalBackend {
  return new VerifactuBackend({
    clock,
    db,
    environment: deploymentEnvironment(process.env),
    deploymentEnvironment: deploymentEnvironment(process.env),
    resolveClient: () =>
      Promise.reject(new Error("served-at-huella.test: resolveClient must never be called")),
  });
}

let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(80_000_000 + nifCounter).padStart(8, "0")}K`;
}

function venueRequest(nif: string): VenueRequest {
  return {
    country: "ES",
    taxId: nif,
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
  };
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
    tipsEnabled: false,
    orderFlow: "prepay",
  };
}

interface Shop {
  db: Database;
  backend: FiscalBackend;
  cfg: TillConfig;
  aguaId: string;
  cafeId: string;
  aguaMenuItemId: string;
  cafeMenuItemId: string;
  menuId: string;
  categoryId: string;
  tableId: string;
}

/**
 * Provision a shop in ITS OWN database, RE-REGISTER its node's SIF under the SHARED emisor NIF,
 * seed an IDENTICAL two-product catalogue, and create one dining table.
 *
 * The huella hashes the AEAT identity fields that `registros_identidad_uq` makes unique, so the two
 * records a test compares must share them — which only separate databases allow. The shared emisor
 * NIF keeps `IDEmisorFactura` identical; re-registering (`registerSif` revokes the old identity,
 * mints a fresh installation number and resets the chain) makes each shop file a first record under
 * it. The NumeroInstalacion is not hashed, so it cannot move the huella.
 */
async function seedShop(db: Database, emisorNif: string): Promise<Shop> {
  const venue = await applyVenue(planVenue(venueRequest(nextNif()), ALL_MODULES), {
    db,
    modules: ALL_MODULES,
  });
  const cfg = tillConfigFromVenue(venue);
  await withTransaction(db, (tx) =>
    registerSif(tx, {
      nodeId: cfg.nodeId,
      nif: emisorNif,
      idSistemaInformatico: "W1",
    }),
  );
  const seeded = await withTransaction(db, async (tx) => {
    const cat = await createCatalogue(tx, { name: "Delicatessen" });
    const bebidas = await createCategory(tx, { name: { [LOCALE]: "Bebidas" } });
    const agua = await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: bebidas.id,
      name: "Agua mineral",
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
    });
    const cafe = await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: bebidas.id,
      name: "Café solo",
      pricingUnit: "each",
      unitPrice: "2.00",
      vatClass: "general",
    });
    await assignCatalogueToLocation(tx, cfg.locationId, cat.id);
    const section = await createMenuSection(tx, {
      menuId: cat.id,
      name: { [LOCALE]: "Bebidas" },
    });
    const aguaMenuItem = await createMenuItem(tx, {
      menuId: cat.id,
      productId: agua.id,
      sectionId: section.id,
      grossPrice: "1.50",
    });
    const cafeMenuItem = await createMenuItem(tx, {
      menuId: cat.id,
      productId: cafe.id,
      sectionId: section.id,
      grossPrice: "2.00",
    });
    // The table sits in a table_tab zone offering this menu, with a route per product to the
    // venue's default station.
    const { zoneId } = await offerProducts(tx, cfg, { zone: "tables" });
    await allowMenuInZone(tx, cfg, zoneId, cat.id);
    const table = await createTable(tx, cfg, { label: "T1", zoneId });
    return {
      aguaId: agua.id,
      cafeId: cafe.id,
      aguaMenuItemId: aguaMenuItem.id,
      cafeMenuItemId: cafeMenuItem.id,
      menuId: cat.id,
      categoryId: bebidas.id,
      tableId: table.id,
    };
  });
  return { db, backend: makeBackend(db), cfg, ...seeded };
}

/**
 * Open the identical two-line tab, optionally serve EVERY line, then pay it through the real pay
 * path with the FROZEN clock, returning the filed huella (registro #1 at secuencia 1).
 */
async function openServeAndPay(
  shop: Shop,
  serveEveryLine: boolean,
): Promise<{ tabId: string; huella: string }> {
  const { db, backend, cfg, aguaMenuItemId, cafeMenuItemId, tableId } = shop;
  const { tabId } = await withTransaction(db, async (tx) => {
    return openTab(tx, cfg, {
      tableId,
      lines: [
        { menuItemId: aguaMenuItemId, quantity: "1" },
        { menuItemId: cafeMenuItemId, quantity: "1" },
      ],
    });
  });

  if (serveEveryLine) {
    await withTransaction(db, async (tx) => {
      await markLineServed(tx, cfg, tabId, 1);
      await markLineServed(tx, cfg, tabId, 2);
    });
  }

  await payWorkingOrder({ db, backend, clock }, cfg, {
    id: tabId,
    lines: [],
    tender: { method: "cash", amount: "10.00" },
  });

  const huella = await withTransaction(db, async (tx) => {
    const rows = await tx
      .select({ huella: registrosFacturacion.huella, secuencia: registrosFacturacion.secuencia })
      .from(registrosFacturacion)
      .where(eq(registrosFacturacion.nodeId, cfg.nodeId));
    expect(rows).toHaveLength(1); // exactly registro #1 on this shop's fresh chain
    expect(rows[0]!.secuencia).toBe(1);
    return rows[0]!.huella;
  });
  return { tabId, huella };
}

/** `served_at` per line, in line_no order — the field this test differs between the two tabs. */
async function servedAtByLine(shop: Shop, tabId: string): Promise<(string | null)[]> {
  return withTransaction(shop.db, async (tx) => {
    const rows = await tx
      .select({ lineNo: workingOrderLines.lineNo, servedAt: workingOrderLines.servedAt })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, tabId))
      .orderBy(workingOrderLines.lineNo);
    return rows.map((r) => r.servedAt);
  });
}

describe("served_at is not part of the huella", () => {
  it("files an IDENTICAL huella whether every line was served or none — served_at never enters the fiscal record", async () => {
    // Same emisor NIF, basket, chain position and frozen clock: `served_at` is the ONLY difference.
    const emisorNif = nextNif();
    const shopServed = await seedShop(suite.db, emisorNif);
    const shopUnserved = await seedShop(suiteB.db, emisorNif);

    const served = await openServeAndPay(shopServed, true); // every line served
    const unserved = await openServeAndPay(shopUnserved, false); // no line served

    // A FAILURE means `served_at` leaked into the filed record: fix the leak, never the test.
    expect(served.huella).toBe(unserved.huella);
    // Not a trivial pass: a real uppercase-hex SHA-256 digest, so "both null/empty → equal" cannot
    // masquerade as the invariant holding.
    expect(served.huella).toMatch(/^[0-9A-F]{64}$/);

    // Self-check: the two tabs GENUINELY differ in `served_at`, or this test compares nothing.
    const servedTimes = await servedAtByLine(shopServed, served.tabId);
    const unservedTimes = await servedAtByLine(shopUnserved, unserved.tabId);
    expect(servedTimes).toHaveLength(2);
    expect(servedTimes.every((t) => t !== null)).toBe(true);
    expect(unservedTimes).toHaveLength(2);
    expect(unservedTimes.every((t) => t === null)).toBe(true);
  });
});

/**
 * Place this shop's table on the floor-plan canvas (`setTablePlacement` needs a live zone) with
 * concrete, non-trivial values the self-check can pin.
 */
async function placeTable(shop: Shop): Promise<void> {
  await withTransaction(shop.db, async (tx) => {
    const zone = await createZone(tx, shop.cfg, { name: "Terraza" });
    const department = await tx.execute<{ department_id: string }>(sql`
      select department_id
      from zone_service_policies
      where location_id = ${shop.cfg.locationId}
      limit 1`);
    // The default-menu key is checked at each statement and `zone_menus` points back at the policy:
    // insert the policy with a null default, then `zone_menus`, then name the default
    // (`zoneServicePolicies` in `packages/venue-service/src/schema/service.ts`).
    await tx.execute(sql`
      insert into zone_service_policies
        (location_id, zone_id, department_id, service_mode, default_menu_id)
      values (
        ${shop.cfg.locationId}, ${zone.id},
        ${department.rows[0]!.department_id}, 'table_tab', null
      )`);
    await tx.execute(sql`
      insert into zone_menus (zone_id, menu_id)
      values (${zone.id}, ${shop.menuId})`);
    await tx.execute(sql`
      update zone_service_policies set default_menu_id = ${shop.menuId}
      where zone_id = ${zone.id}`);
    // Through the table definition: `preparationRoutes.id`
    // (`packages/venue-service/src/schema/service.ts`) is a `$defaultFn` generator, which a raw
    // statement never reaches.
    await tx.insert(preparationRoutes).values({
      locationId: shop.cfg.locationId,
      categoryId: shop.categoryId,
      stationId: null,
      noPreparation: true,
    });
    await setTablePlacement(tx, shop.cfg, shop.tableId, {
      zoneId: zone.id,
      posX: 500,
      posY: 250,
      shape: "square",
      rotation: 15,
    });
  });
}

/** A table's four placement columns — `null` on every one for an unplaced walk-up table. */
interface Placement {
  posX: number | null;
  posY: number | null;
  shape: string | null;
  rotation: number | null;
}

/** This shop's table's placement, read back through the real `listTables` projection. */
async function placementOf(shop: Shop): Promise<Placement> {
  return withTransaction(shop.db, async (tx) => {
    const table = (await listTables(tx, shop.cfg)).find((t) => t.id === shop.tableId);
    expect(table).toBeDefined();
    return {
      posX: table!.posX,
      posY: table!.posY,
      shape: table!.shape,
      rotation: table!.rotation,
    };
  });
}

// Placement (`pos_x`/`pos_y`/`shape`/`rotation`) lives on `dining_tables`, which the pay path never
// reads. Two shops file the IDENTICAL basket, one from a PLACED table and one from an unplaced
// walk-up, and must file the IDENTICAL huella.
describe("table placement is not part of the huella", () => {
  it("files an IDENTICAL huella whether the table is placed on the floor plan or a walk-up — placement never enters the fiscal record", async () => {
    // Same emisor NIF, basket, chain position and frozen clock: table PLACEMENT is the ONLY
    // difference.
    const emisorNif = nextNif();
    const shopPlaced = await seedShop(suite.db, emisorNif);
    const shopWalkup = await seedShop(suiteB.db, emisorNif);

    // Place shopPlaced's table on the canvas; shopWalkup's table stays unplaced (a walk-up).
    await placeTable(shopPlaced);

    // Neither tab served, so serving cannot confound.
    const placed = await openServeAndPay(shopPlaced, false);
    const walkup = await openServeAndPay(shopWalkup, false);

    // A FAILURE means a placement field leaked into the filed record: fix the leak, never the test.
    expect(placed.huella).toBe(walkup.huella);
    // Not a trivial pass: a real uppercase-hex SHA-256 digest, so "both null/empty → equal" cannot
    // masquerade as the invariant holding.
    expect(placed.huella).toMatch(/^[0-9A-F]{64}$/);

    // Self-check: the two tables GENUINELY differ in placement, or this test compares nothing.
    const placedPlacement = await placementOf(shopPlaced);
    const walkupPlacement = await placementOf(shopWalkup);
    expect(placedPlacement).toEqual({ posX: 500, posY: 250, shape: "square", rotation: 15 });
    expect(walkupPlacement).toEqual({ posX: null, posY: null, shape: null, rotation: null });
  });
});

/**
 * Open the identical two-line tab, fire its lines to the kitchen, advance every item to `ready`,
 * stamp the order's `collected_at`, then pay it through the real pay path with the FROZEN clock,
 * returning the filed huella (registro #1 at secuencia 1).
 *
 * `collected_at` is stamped by a direct UPDATE rather than `collectOrder`, which would file through
 * a different settle path: the filing path stays `payWorkingOrder`, as in the sibling tests.
 */
async function openKitchenLifecycleAndPay(shop: Shop): Promise<{ tabId: string; huella: string }> {
  const { db, backend, cfg, aguaMenuItemId, cafeMenuItemId, tableId } = shop;
  const { tabId } = await withTransaction(db, async (tx) => {
    return openTab(tx, cfg, {
      tableId,
      lines: [
        { menuItemId: aguaMenuItemId, quantity: "1" },
        { menuItemId: cafeMenuItemId, quantity: "1" },
      ],
    });
  });

  await withTransaction(db, async (tx) => {
    // Fire the tab's two stored lines to the kitchen (each routed to the seeded default station), then
    // walk each ticket item queued→preparing→ready.
    const lines = await tx
      .select({
        id: workingOrderLines.id,
        productId: workingOrderLines.productId,
        courseId: workingOrderLines.courseId,
        parentLineId: workingOrderLines.parentLineId,
        note: workingOrderLines.note,
      })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, tabId))
      .orderBy(workingOrderLines.lineNo);
    await fireLines(tx, cfg, tabId, lines);
    const items = await tx
      .select({ id: ticketItems.id })
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderId, tabId));
    for (const item of items) {
      await advanceTicketItem(tx, cfg, item.id, "preparing");
      await advanceTicketItem(tx, cfg, item.id, "ready");
    }
    // The order-level customer-handover marker, set before the pay files.
    await tx
      .update(workingOrders)
      .set({ collectedAt: FROZEN_INSTANT.toISOString() })
      .where(eq(workingOrders.id, tabId));
  });

  await payWorkingOrder({ db, backend, clock }, cfg, {
    id: tabId,
    lines: [],
    tender: { method: "cash", amount: "10.00" },
  });

  const huella = await withTransaction(db, async (tx) => {
    const rows = await tx
      .select({ huella: registrosFacturacion.huella, secuencia: registrosFacturacion.secuencia })
      .from(registrosFacturacion)
      .where(eq(registrosFacturacion.nodeId, cfg.nodeId));
    expect(rows).toHaveLength(1); // exactly registro #1 on this shop's fresh chain
    expect(rows[0]!.secuencia).toBe(1);
    return rows[0]!.huella;
  });
  return { tabId, huella };
}

/** An order's ticket-item states (empty when never fired) and its `collected_at`. */
interface KdsState {
  ticketStates: TicketState[];
  collectedAt: string | null;
}

async function kdsStateOf(shop: Shop, tabId: string): Promise<KdsState> {
  return withTransaction(shop.db, async (tx) => {
    const items = await tx
      .select({ state: ticketItems.state })
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderId, tabId));
    const [order] = await tx
      .select({ collectedAt: workingOrders.collectedAt })
      .from(workingOrders)
      .where(eq(workingOrders.id, tabId));
    return { ticketStates: items.map((i) => i.state), collectedAt: order!.collectedAt };
  });
}

// The KDS fields — `ticket_items` and `working_orders.collected_at` — are off the fiscal path:
// `payWorkingOrder` files from the tab's STORED locked lines. Two shops file the IDENTICAL basket,
// one whose order ran the full kitchen lifecycle and one filed plain, and must file the IDENTICAL
// huella.
describe("KDS state (ticket items + collected_at) is not part of the huella", () => {
  it("files an IDENTICAL huella whether the order ran the full kitchen lifecycle or was filed plain — no KDS field enters the fiscal record", async () => {
    // Same emisor NIF, basket, chain position and frozen clock: the order's KDS state is the ONLY
    // difference.
    const emisorNif = nextNif();
    const shopKitchen = await seedShop(suite.db, emisorNif);
    const shopPlain = await seedShop(suiteB.db, emisorNif);

    const kitchen = await openKitchenLifecycleAndPay(shopKitchen); // fired → ready → collected
    const plain = await openServeAndPay(shopPlain, false); // never fired; not collected

    // A FAILURE means a KDS field leaked into the filed record: fix the leak, never the test.
    expect(kitchen.huella).toBe(plain.huella);
    // Not a trivial pass: a real uppercase-hex SHA-256 digest, so "both null/empty → equal" cannot
    // masquerade as the invariant holding.
    expect(kitchen.huella).toMatch(/^[0-9A-F]{64}$/);

    // Self-check: the two orders GENUINELY differ in KDS state, or this test compares nothing.
    const kitchenState = await kdsStateOf(shopKitchen, kitchen.tabId);
    const plainState = await kdsStateOf(shopPlain, plain.tabId);
    expect(kitchenState.ticketStates).toEqual(["ready", "ready"]);
    expect(kitchenState.collectedAt).not.toBeNull();
    expect(plainState.ticketStates).toEqual([]);
    expect(plainState.collectedAt).toBeNull();

    // Negative control: the self-check above discriminates, rather than passing vacuously.
    expect(() => expect(plainState.ticketStates).toEqual(["ready", "ready"])).toThrow();
    expect(() => expect(kitchenState.ticketStates).toEqual([])).toThrow();
    expect(() => expect(plainState.collectedAt).not.toBeNull()).toThrow();
  });
});

/**
 * Offer a ONE-item extras list on this shop's `agua` product and return the list's id with the
 * offered product's. The picked product's fiscal-bearing fields — names, the offer's price and the
 * VAT class — are the constants below, so only `overlay`'s allergen declaration varies between
 * shops.
 */
const EXTRA_PRODUCT_NAME = "Panecillo";
const EXTRA_PRICE = "0.50";
const EXTRA_VAT_CLASS = "general" as const;

type OverlayAllergens = Record<string, { presence: "contains" | "may_contain"; source?: string }>;

async function attachExtra(
  shop: Shop,
  overlay: { allergens: OverlayAllergens | null },
): Promise<{ listId: string; productId: string }> {
  return withTransaction(shop.db, async (tx) => {
    const panecillo = await createProduct(tx, {
      catalogueId: shop.menuId,
      categoryId: null,
      name: EXTRA_PRODUCT_NAME,
      pricingUnit: "each",
      unitPrice: EXTRA_PRICE,
      vatClass: EXTRA_VAT_CLASS,
      ...(overlay.allergens === null ? {} : { allergens: overlay.allergens }),
    });
    const list = await createExtraList(
      tx,
      {
        name: "Pan",
        customerName: null,
        kitchenName: null,
        minPicks: 0,
        maxPicks: 1,
        active: true,
        items: [
          { productId: panecillo.id, maxQuantity: 1, preselected: false, price: EXTRA_PRICE },
        ],
      },
      shop.cfg.locale,
    );
    await writeProductModifiers(tx, shop.aguaId, [{ kind: "extras", id: list.id }]);
    // An offer carries only the extras lists published on it.
    await setMenuItemExtraLists(tx, shop.aguaMenuItemId, [{ listId: list.id, items: [] }]);
    return { productId: panecillo.id, listId: list.id };
  });
}

/**
 * Open a two-line tab — `agua` WITH the extra picked (a parent row + one child row) plus a plain
 * `cafe` — then pay it through the real pay path with the FROZEN clock, returning the filed huella
 * (registro #1 at secuencia 1).
 */
async function openWithExtraAndPay(
  shop: Shop,
  extra: { listId: string; productId: string },
): Promise<{ tabId: string; huella: string }> {
  const { db, backend, cfg, aguaMenuItemId, cafeMenuItemId, tableId } = shop;
  // `openTab` takes only plain lines; `addTabRound` is the path that accepts `extras`.
  const { tabId } = await withTransaction(db, async (tx) => {
    return openTab(tx, cfg, { tableId });
  });
  await withTransaction(db, async (tx) => {
    await addTabRound(tx, cfg, tabId, [
      {
        menuItemId: aguaMenuItemId,
        quantity: "1",
        extras: [{ listId: extra.listId, picks: [{ productId: extra.productId, quantity: 1 }] }],
      },
      { menuItemId: cafeMenuItemId, quantity: "1" },
    ]);
  });

  await payWorkingOrder({ db, backend, clock }, cfg, {
    id: tabId,
    lines: [],
    tender: { method: "cash", amount: "10.00" },
  });

  const huella = await withTransaction(db, async (tx) => {
    const rows = await tx
      .select({ huella: registrosFacturacion.huella, secuencia: registrosFacturacion.secuencia })
      .from(registrosFacturacion)
      .where(eq(registrosFacturacion.nodeId, cfg.nodeId));
    expect(rows).toHaveLength(1); // exactly registro #1 on this shop's fresh chain
    expect(rows[0]!.secuencia).toBe(1);
    return rows[0]!.huella;
  });
  return { tabId, huella };
}

/** How many child modifier lines were FILED on the sale this tab paid into. */
async function filedChildLineCount(shop: Shop, tabId: string): Promise<number> {
  return withTransaction(shop.db, async (tx) => {
    const rows = await tx
      .select({ id: saleLines.id })
      .from(saleLines)
      .innerJoin(sales, eq(sales.id, saleLines.saleId))
      .where(and(eq(sales.workingOrderId, tabId), isNotNull(saleLines.parentLineId)));
    return rows.length;
  });
}

/** This shop's extra product's allergen declaration, read back through `readProductEditor`. */
async function overlayOf(shop: Shop, productId: string): Promise<OverlayAllergens | null> {
  return withTransaction(shop.db, async (tx) => {
    const product = await readProductEditor(tx, productId);
    return product.allergens;
  });
}

// An extra product's allergen declaration is a catalogue field the sale path never freezes onto a
// line (`buildLineExtras` in modifier-selection.ts copies no allergen field). Two shops file the
// IDENTICAL basket and extra, one extra declaring an allergen and one none, and must file the
// IDENTICAL huella.
describe("an extra's allergen declaration is not part of the huella", () => {
  it("files an IDENTICAL huella whether the picked extra declares an allergen or none — the declaration never enters the fiscal record", async () => {
    // Same emisor NIF, basket, picked extra (name/price/vat), chain position and frozen clock: the
    // extra's allergen DECLARATION is the ONLY difference.
    const emisorNif = nextNif();
    const shopOverlay = await seedShop(suite.db, emisorNif);
    const shopPlain = await seedShop(suiteB.db, emisorNif);

    // Only the catalogue allergen declaration differs; the child sale lines are identical.
    const overlayExtra = await attachExtra(shopOverlay, {
      allergens: { gluten: { presence: "contains" } },
    });
    const plainExtra = await attachExtra(shopPlain, { allergens: null });

    const overlay = await openWithExtraAndPay(shopOverlay, overlayExtra);
    const plain = await openWithExtraAndPay(shopPlain, plainExtra);

    // A FAILURE means an allergen field leaked into the filed record: fix the leak, never the test.
    expect(overlay.huella).toBe(plain.huella);
    // Not a trivial pass: a real uppercase-hex SHA-256 digest, so "both null/empty → equal" cannot
    // masquerade as the invariant holding.
    expect(overlay.huella).toMatch(/^[0-9A-F]{64}$/);

    // Self-check: the two extras GENUINELY differ in declaration, or this test compares nothing.
    const overlayAdd = await overlayOf(shopOverlay, overlayExtra.productId);
    const plainAdd = await overlayOf(shopPlain, plainExtra.productId);
    expect(overlayAdd).toEqual({ gluten: { presence: "contains" } });
    expect(plainAdd).toBeNull();

    // Second self-check: the extra was GENUINELY filed as a child `sale_lines` row on both sales,
    // or the huella equality would hold vacuously.
    expect(await filedChildLineCount(shopOverlay, overlay.tabId)).toBe(1);
    expect(await filedChildLineCount(shopPlain, plain.tabId)).toBe(1);
  });
});
