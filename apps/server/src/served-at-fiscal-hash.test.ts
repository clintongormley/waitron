import { testTradingAdmission } from "./testing/trading-admission.js";
import { addTabRound } from "./testing/order-writer-fixture.js";
import { seedFixtureSif as registerSif } from "@waitron/fiscal-verifactu/test/sif-fixture.js";
import { describe, expect, it } from "vitest";
import { and, eq, isNotNull } from "drizzle-orm";
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
  assignMenuToVenue,
  createMenu,
  createCategory,
  createExtraList,
  addProductToMenu,
  createProduct,
  readProductEditor,
  writeProductModifiers,
} from "@waitron/menu";
import { VerifactuBackend, verifactuRecords } from "@waitron/fiscal-verifactu";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { hashPassword, hashPin } from "@waitron/identity";
import { applyHistoricalTestVenue as applyVenue } from "@waitron/provisioning/testing/allocated-venue";
import { planVenue } from "@waitron/provisioning";
import type { VenueRequest, VenueResult } from "@waitron/provisioning";

import { offerMenuThroughZone } from "@waitron/venue-service/testing/zone-menus.js";
import { nodeId as brandNodeId } from "@waitron/shared";
import { deploymentEnvironment } from "./config.js";
import { ALL_MODULES } from "./modules.js";
import type { DeviceRequestConfig } from "./trading-context.js";

import { createTable } from "./testing/live-table.js";
import { advanceTicketItem, fireLines, type TicketState } from "./working-order.js";
import { paySavedBillInCash } from "./testing/bill-payment-fixture.js";
import { offerProducts } from "./testing/zone-offers.js";
import { publishWorkingMenu } from "./testing/publish-menu.js";
import { fireAll, openPartyTab, serveLine } from "./testing/serve-line.js";
import "./errors.js";
import { nifWithControlLetter } from "@waitron/fiscal-verifactu/src/testing/seed.js";
import { counterFixtureOperator, deviceRequestCfg } from "./testing/session-device.js";
import type { TradingContext } from "./trading-context.js";

// The fiscal firewall (CLAUDE.md §5): our own metadata never enters `computeHuella`. `served_at` is
// a `working_order_lines` field the pay path never reads: bill payment files from the tab's
// STORED locked lines. Two tabs built from the IDENTICAL basket, one with every line served and one
// with none, must file records with the IDENTICAL huella — each a genuine chained record filed
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
      throw new Error("served-at-fiscal-hash.test: anchor() is not used by recordSale");
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
  });
}

let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return nifWithControlLetter(80_000_000 + nifCounter);
}

function venueRequest(nif: string): VenueRequest {
  return {
    country: "ES",
    taxId: nif,
    legalName: "Deli Test SL",
    name: "Sala principal",
    fiscalTerritory: "ES-common",
    invoiceLocales: [LOCALE],
    addressLine1: "Calle Mayor 1",
    addressLine2: null,
    postalCode: "28013",
    city: "Madrid",
    province: "Madrid",
    timeZone: "Europe/Madrid",
    dayCutover: "05:00",
    seriesCode: "A",
    correctiveSeriesCode: "R",
    admin: {
      displayName: "Administrator",
      pinHash: hashPin("1234"),
      passwordHash: hashPassword("dashPass123"),
      email: "owner@example.test",
    },
  };
}

function tillConfigFromVenue(venue: VenueResult): TradingContext {
  return {
    nodeId: brandNodeId(venue.nodeId),
    locale: LOCALE,
    simplifiedInvoiceLimit: null,
  };
}

interface Shop {
  db: Database;
  backend: FiscalBackend;
  cfg: DeviceRequestConfig;
  waterId: string;
  coffeeId: string;
  waterMenuItemId: string;
  coffeeMenuItemId: string;
  menuId: string;
  categoryId: string;
  tableId: string;
}

/**
 * Provision a shop in ITS OWN database, register its node's SIF under the SHARED issuer NIF,
 * seed an IDENTICAL two-product menu, and create one dining table.
 *
 * The huella hashes the AEAT identity fields that `verifactu_records_identidad_uq` makes unique, so the two
 * records a test compares must share them — which only separate databases allow. The shared issuer
 * NIF keeps `IDEmisorFactura` identical. Each shop files its first record in its own database.
 * The NumeroInstalacion is not hashed, so it cannot move the huella.
 */
async function seedShop(db: Database, issuerNif: string): Promise<Shop> {
  const venue = await applyVenue(planVenue(venueRequest(nextNif()), ALL_MODULES), {
    db,
    modules: ALL_MODULES,
  });

  const cfg = await deviceRequestCfg(db, tillConfigFromVenue(venue));
  await withTransaction(db, (tx) =>
    registerSif(tx, {
      nodeId: cfg.nodeId,
      nif: issuerNif,
      idSistemaInformatico: "W1",
    }),
  );
  const seeded = await withTransaction(db, async (tx) => {
    const cat = await createMenu(tx, { name: "Delicatessen" });
    const drinks = await createCategory(tx, { name: "Bebidas" });
    const water = await createProduct(tx, {
      categoryId: drinks.id,
      name: "Agua mineral",
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
    });
    const coffee = await createProduct(tx, {
      categoryId: drinks.id,
      name: "Café solo",
      pricingUnit: "each",
      unitPrice: "2.00",
      vatClass: "general",
    });
    await assignMenuToVenue(tx, cat.id);
    const waterMenuItem = await addProductToMenu(tx, {
      menuId: cat.id,
      productId: water.id,
      grossPrice: "1.50",
    });
    const coffeeMenuItem = await addProductToMenu(tx, {
      menuId: cat.id,
      productId: coffee.id,
      grossPrice: "2.00",
    });
    // The table sits in a table_tab zone offering this menu, with a route per product to the
    // venue's default station.
    const { zoneId } = await offerProducts(tx, { zone: "tables" });
    await offerMenuThroughZone(tx, zoneId, cat.id);
    await publishWorkingMenu(tx, cat.id);
    const table = await createTable(tx, { label: "T1", zoneId });
    return {
      waterId: water.id,
      coffeeId: coffee.id,
      waterMenuItemId: waterMenuItem.id,
      coffeeMenuItemId: coffeeMenuItem.id,
      menuId: cat.id,
      categoryId: drinks.id,
      tableId: table.id,
    };
  });
  return { db, backend: makeBackend(db), cfg, ...seeded };
}

/**
 * Open the identical two-line tab, optionally serve EVERY line, then pay it through the real pay
 * path with the FROZEN clock, returning the filed huella (record #1 at sequence 1).
 */
async function openServeAndPay(
  shop: Shop,
  serveEveryLine: boolean,
  options: { fire?: boolean } = {},
): Promise<{ tabId: string; huella: string }> {
  const { db, backend, cfg, waterMenuItemId, coffeeMenuItemId, tableId } = shop;
  const { tabId } = await withTransaction(db, async (tx) => {
    return openPartyTab(tx, cfg, {
      tableId,
      lines: [
        { menuItemId: waterMenuItemId, quantity: "1" },
        { menuItemId: coffeeMenuItemId, quantity: "1" },
      ],
    });
  });

  // Only work the waiter has asked for can be served. Both tabs of a comparison are fired, so
  // `served_at` stays the one difference between them.
  if (options.fire) {
    await withTransaction(db, (tx) => fireAll(tx, cfg, tabId));
  }
  if (serveEveryLine) {
    await withTransaction(db, async (tx) => {
      await serveLine(tx, cfg, tabId, 1);
      await serveLine(tx, cfg, tabId, 2);
    });
  }

  await paySavedBillInCash(
    { admission: testTradingAdmission(), db, backend, clock },
    cfg,
    await counterFixtureOperator(db, cfg.origin.deviceId),
    tabId,
    "10.00",
  );

  const huella = await withTransaction(db, async (tx) => {
    const rows = await tx
      .select({ huella: verifactuRecords.huella, secuencia: verifactuRecords.secuencia })
      .from(verifactuRecords)
      .where(eq(verifactuRecords.nodeId, cfg.nodeId));
    expect(rows).toHaveLength(1); // exactly record #1 on this shop's fresh chain
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
    // Same issuer NIF, basket, chain position and frozen clock: `served_at` is the ONLY difference.
    const issuerNif = nextNif();
    const shopServed = await seedShop(suite.db, issuerNif);
    const shopUnserved = await seedShop(suiteB.db, issuerNif);

    const served = await openServeAndPay(shopServed, true, { fire: true }); // every line served
    const unserved = await openServeAndPay(shopUnserved, false, { fire: true }); // no line served

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
 * Open the identical two-line tab, fire its lines to the kitchen, advance every item to `ready`,
 * stamp the order's `collected_at`, then pay it through the real pay path with the FROZEN clock,
 * returning the filed huella (record #1 at sequence 1).
 *
 * `collected_at` is stamped by a direct UPDATE. This case files through bill payment, as in the
 * sibling tests.
 */
async function openKitchenLifecycleAndPay(shop: Shop): Promise<{ tabId: string; huella: string }> {
  const { db, backend, cfg, waterMenuItemId, coffeeMenuItemId, tableId } = shop;
  const { tabId } = await withTransaction(db, async (tx) => {
    return openPartyTab(tx, cfg, {
      tableId,
      lines: [
        { menuItemId: waterMenuItemId, quantity: "1" },
        { menuItemId: coffeeMenuItemId, quantity: "1" },
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
        quantity: workingOrderLines.quantity,
      })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, tabId))
      .orderBy(workingOrderLines.lineNo);
    await fireLines(tx, cfg, tabId, lines);
    const items = await tx
      .select({ id: ticketItems.id })
      .from(ticketItems)
      .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
      .where(eq(workingOrderLines.workingOrderId, tabId));
    for (const item of items) {
      await advanceTicketItem(tx, item.id, "preparing");
      await advanceTicketItem(tx, item.id, "ready");
    }
    // The order-level customer-handover marker, set before the pay files.
    await tx
      .update(workingOrders)
      .set({ collectedAt: FROZEN_INSTANT.toISOString() })
      .where(eq(workingOrders.id, tabId));
  });

  await paySavedBillInCash(
    { admission: testTradingAdmission(), db, backend, clock },
    cfg,
    await counterFixtureOperator(db, cfg.origin.deviceId),
    tabId,
    "10.00",
  );

  const huella = await withTransaction(db, async (tx) => {
    const rows = await tx
      .select({ huella: verifactuRecords.huella, secuencia: verifactuRecords.secuencia })
      .from(verifactuRecords)
      .where(eq(verifactuRecords.nodeId, cfg.nodeId));
    expect(rows).toHaveLength(1); // exactly record #1 on this shop's fresh chain
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
      .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
      .where(eq(workingOrderLines.workingOrderId, tabId));
    const [order] = await tx
      .select({ collectedAt: workingOrders.collectedAt })
      .from(workingOrders)
      .where(eq(workingOrders.id, tabId));
    return { ticketStates: items.map((i) => i.state), collectedAt: order!.collectedAt };
  });
}

// The KDS fields — `ticket_items` and `working_orders.collected_at` — are off the fiscal path:
// Bill payment files from the tab's stored lines. Two shops file the IDENTICAL basket,
// one whose order ran the full kitchen lifecycle and one filed plain, and must file the IDENTICAL
// huella.
describe("KDS state (ticket items + collected_at) is not part of the huella", () => {
  it("files an IDENTICAL huella whether the order ran the full kitchen lifecycle or was filed plain — no KDS field enters the fiscal record", async () => {
    // Same issuer NIF, basket, chain position and frozen clock: the order's KDS state is the ONLY
    // difference.
    const issuerNif = nextNif();
    const shopKitchen = await seedShop(suite.db, issuerNif);
    const shopPlain = await seedShop(suiteB.db, issuerNif);

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
 * Offer a ONE-item extras list on this shop's `water` product and return the list's id with the
 * offered product's. The picked product's fiscal-bearing fields — names, the offer's price and the
 * VAT class — are the constants below, so only `overlay`'s allergen declaration varies between
 * shops.
 */
const EXTRA_PRODUCT_NAME = "Panecillo";
const EXTRA_PRICE = "0.50";
const EXTRA_VAT_CLASS = "general" as const;

type OverlayAllergens = import("@waitron/shared").ProductAllergens;

async function attachExtra(
  shop: Shop,
  overlay: { allergens: OverlayAllergens | null },
): Promise<{ listId: string; productId: string }> {
  return withTransaction(shop.db, async (tx) => {
    const breadRoll = await createProduct(tx, {
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
          { productId: breadRoll.id, maxQuantity: 1, preselected: false, price: EXTRA_PRICE },
        ],
      },
      shop.cfg.locale,
    );
    await writeProductModifiers(tx, shop.waterId, [{ kind: "extras", id: list.id }]);

    await publishWorkingMenu(tx, shop.menuId);
    return { productId: breadRoll.id, listId: list.id };
  });
}

/**
 * Open a two-line tab — `water` WITH the extra picked (a parent row + one child row) plus a plain
 * `coffee` — then pay it through the real pay path with the FROZEN clock, returning the filed huella
 * (record #1 at sequence 1).
 */
async function openWithExtraAndPay(
  shop: Shop,
  extra: { listId: string; productId: string },
): Promise<{ tabId: string; huella: string }> {
  const { db, backend, cfg, waterMenuItemId, coffeeMenuItemId, tableId } = shop;
  // `openTab` takes only plain lines; `addTabRound` is the path that accepts `extras`.
  const { tabId } = await withTransaction(db, async (tx) => {
    return openPartyTab(tx, cfg, { tableId });
  });
  await withTransaction(db, async (tx) => {
    await addTabRound(tx, cfg, tabId, [
      {
        menuItemId: waterMenuItemId,
        quantity: "1",
        extras: [{ listId: extra.listId, picks: [{ productId: extra.productId, quantity: 1 }] }],
      },
      { menuItemId: coffeeMenuItemId, quantity: "1" },
    ]);
  });

  await paySavedBillInCash(
    { admission: testTradingAdmission(), db, backend, clock },
    cfg,
    await counterFixtureOperator(db, cfg.origin.deviceId),
    tabId,
    "10.00",
  );

  const huella = await withTransaction(db, async (tx) => {
    const rows = await tx
      .select({ huella: verifactuRecords.huella, secuencia: verifactuRecords.secuencia })
      .from(verifactuRecords)
      .where(eq(verifactuRecords.nodeId, cfg.nodeId));
    expect(rows).toHaveLength(1); // exactly record #1 on this shop's fresh chain
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

// An extra product's allergen declaration is a menu field the sale path never freezes onto a
// line (`buildLineExtras` in modifier-selection.ts copies no allergen field). Two shops file the
// IDENTICAL basket and extra, one extra declaring an allergen and one none, and must file the
// IDENTICAL huella.
describe("an extra's allergen declaration is not part of the huella", () => {
  it("files an IDENTICAL huella whether the picked extra declares an allergen or none — the declaration never enters the fiscal record", async () => {
    // Same issuer NIF, basket, picked extra (name/price/vat), chain position and frozen clock: the
    // extra's allergen DECLARATION is the ONLY difference.
    const issuerNif = nextNif();
    const shopOverlay = await seedShop(suite.db, issuerNif);
    const shopPlain = await seedShop(suiteB.db, issuerNif);

    // Only the menu allergen declaration differs; the child sale lines are identical.
    const overlayExtra = await attachExtra(shopOverlay, {
      allergens: { gluten: { kinds: ["wheat"] } },
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
    expect(overlayAdd).toEqual({ gluten: { kinds: ["wheat"] } });
    expect(plainAdd).toBeNull();

    // Second self-check: the extra was GENUINELY filed as a child `sale_lines` row on both sales,
    // or the huella equality would hold vacuously.
    expect(await filedChildLineCount(shopOverlay, overlay.tabId)).toBe(1);
    expect(await filedChildLineCount(shopPlain, plain.tabId)).toBe(1);
  });
});
