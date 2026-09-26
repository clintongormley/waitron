// The domain outcomes of un-joining a table and settling a tab, single-threaded.
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  diningTables,
  locations,
  printJobs,
  tableServiceStatuses,
  ticketItems,
  tills,
  withTransaction,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { seedKitchenStation, seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
  readContentLanguages,
} from "@waitron/catalogue";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  thousandthsToDecimal,
  tillId as brandTillId,
} from "@waitron/shared";
import type { TillConfig } from "./till-config.js";
import { createTable, setTableStatus } from "./tables.js";
import {
  addTabRound,
  advanceTicketItem,
  createOpenOrder,
  joinTable,
  listExpoQueue,
  listStationQueue,
  markLineServed,
  openTab,
  splitOffCheck,
  priceStoredOrder,
  sendLines,
  transferLines,
  unjoinTable,
  updateOrderLine,
  voidTabLine,
} from "./working-order.js";
import { createCourse } from "./kitchen.js";
import { createPrinter } from "@waitron/printing";
import { attachPrinterToStation } from "./station-printers.js";
import { printedLines } from "./testing/decode-ticket.js";
import { readReceiptOrder } from "./receipt-order.js";
import { seedLegacySellingUnits } from "./testing/seed-units.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";
import "./errors.js";

// What this suite proves: the check being table-less, and the line partition — plain row state. The
// FISCAL filing (exactly-one-registro per check, desglose, contiguity) is the split-bill fiscal
// suite's.
const LOCALE = "es-ES";
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});

interface Seeded {
  cfg: TillConfig;
  /** "Agua" — each, 1.50 gross, general(21%). */
  aguaId: string;
  /** "Jamón" — WEIGHT, 24.90/kg gross, reduced(10%). */
  jamonId: string;
  tableId: string;
  tableId2: string;
  /** An ACTIVE `table_service_statuses` row, so a test can give a table a non-null manual status. */
  activeStatusId: string;
}

async function setupVenue(): Promise<Seeded> {
  await seedTenant(db);
  await seedLegacySellingUnits(db);
  // Through the table definitions rather than raw SQL: `invoice_locales` is a JSON array in a text
  // column on this engine (`labelList`, packages/db/src/schema/columns.ts), so there is no array
  // constructor to write, and `id` is a `$defaultFn` a raw insert would never reach.
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
  const cfg: TillConfig = {
    tillId: brandTillId(tillId),
    nodeId: brandNodeId(nodeId),
    seriesId: brandSeriesId(randomUUID()),
    locationId: brandLocationId(locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    orderFlow: "prepay",
  };
  const seeded = await withTransaction(db, async (tx) => {
    const cat = await createCatalogue(tx, { name: "Carta" });
    const bebidas = await createCategory(tx, { name: { en: "Bebidas" } });
    const agua = await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: bebidas.id,
      name: "Agua",
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
    });
    const jamon = await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: bebidas.id,
      name: "Jamón",
      pricingUnit: "weight",
      unitPrice: "24.90",
      vatClass: "reduced",
    });
    await assignCatalogueToLocation(tx, locationId, cat.id);
    const offers = await offerProducts(tx, cfg, { zone: "tables" });
    offersByCfg.set(cfg, offers);
    const t1 = await createTable(tx, cfg, { label: "T1", zoneId: offers.zoneId });
    const t2 = await createTable(tx, cfg, { label: "T2", zoneId: offers.zoneId });
    // Through the table definition: `id` and `created_at` are `$defaultFn` generators, which a raw
    // insert never reaches.
    const activeStatusId = randomUUID();
    await tx
      .insert(tableServiceStatuses)
      .values({ id: activeStatusId, label: "Bill requested", color: "#ef4444" });
    return {
      aguaId: agua.id,
      jamonId: jamon.id,
      tableId: t1.id,
      tableId2: t2.id,
      activeStatusId,
    };
  });
  return { cfg, ...seeded };
}

/** Each venue's offers in its tables zone, keyed by the venue's config so call sites pass only `cfg`. */
const offersByCfg = new WeakMap<TillConfig, ZoneOffers>();

/** `openTab`, selling each line through the venue's offer for its product. */
function openTabWith(
  tx: Transaction,
  cfg: TillConfig,
  req: { tableId: string; lines?: { productId: string; quantity: string }[] },
) {
  return openTab(tx, cfg, {
    tableId: req.tableId,
    lines: offersByCfg.get(cfg)!.toOfferLines(req.lines ?? []),
  });
}

function asApp<T>(cfg: TillConfig, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  void cfg;
  return withTransaction(db, async (tx) => {
    return fn(tx);
  });
}

describe("receipt order grouping", () => {
  it("uses a detached order's label and number, including an absent label", async () => {
    const { cfg } = await setupVenue();
    for (const label of ["Blue umbrella", null]) {
      await asApp(cfg, async (tx) => {
        const id = randomUUID();
        const { orderNumber } = await createOpenOrder(tx, cfg, id, [], label);
        expect(await readReceiptOrder(tx, cfg, id)).toEqual({ orderLabel: label, orderNumber });
      });
    }
  });

  it("uses a delivery table and prefers a seated table when both exist", async () => {
    const { cfg, tableId, tableId2 } = await setupVenue();
    await asApp(cfg, async (tx) => {
      const id = randomUUID();
      const { orderNumber } = await createOpenOrder(tx, cfg, id, [], "Operator label", {
        deliveryTableId: tableId,
      });
      expect(await readReceiptOrder(tx, cfg, id)).toEqual({ orderLabel: "T1", orderNumber });
      await tx.update(diningTables).set({ tabId: id }).where(eq(diningTables.id, tableId2));
      expect(await readReceiptOrder(tx, cfg, id)).toEqual({ orderLabel: "T2", orderNumber });
    });
  });

  it("uses the same table for a joined tab regardless of query order", async () => {
    const { cfg, tableId, tableId2 } = await setupVenue();
    const { tabId, orderNumber } = await asApp(cfg, (tx) => openTabWith(tx, cfg, { tableId }));
    await asApp(cfg, (tx) => joinTable(tx, cfg, tabId, tableId2));
    expect(await asApp(cfg, (tx) => readReceiptOrder(tx, cfg, tabId))).toEqual({
      orderLabel: tableId < tableId2 ? "T1" : "T2",
      orderNumber,
    });
  });

  it("refuses a missing order", async () => {
    const { cfg } = await setupVenue();
    const missing = randomUUID();
    await expect(asApp(cfg, (tx) => readReceiptOrder(tx, cfg, missing))).rejects.toMatchObject({
      code: "working_order.not_found",
      params: { workingOrderId: missing },
    });
  });
});

describe("splitOffCheck", () => {
  it("spins selected items into a NEW open check that no table points at (detached)", async () => {
    const { cfg, aguaId, jamonId, tableId } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) =>
      openTabWith(tx, cfg, {
        tableId,
        lines: [
          { productId: aguaId, quantity: "3" },
          { productId: jamonId, quantity: "0.300" },
        ],
      }),
    );

    // Move 1 of the 3 aguas (partial split of line 1) + the whole jamón (line 2) onto a check.
    const { checkId } = await asApp(cfg, (tx) =>
      splitOffCheck(tx, cfg, tabId, [{ lineNo: 1, quantity: "1" }, { lineNo: 2 }]),
    );

    const state = await asApp(cfg, async (tx) => {
      const [check] = await tx
        .select({
          status: workingOrders.status,
          label: workingOrders.label,
          nodeId: workingOrders.nodeId,
          tillId: workingOrders.tillId,
        })
        .from(workingOrders)
        .where(eq(workingOrders.id, checkId));
      const checkLines = await tx
        .select({
          productId: workingOrderLines.productId,
          quantity: workingOrderLines.quantity,
        })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, checkId))
        .orderBy(workingOrderLines.lineNo);
      const originLines = await tx
        .select({
          lineNo: workingOrderLines.lineNo,
          productId: workingOrderLines.productId,
          quantity: workingOrderLines.quantity,
        })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, tabId))
        .orderBy(workingOrderLines.lineNo);
      const anchoring = await tx
        .select({ id: diningTables.id })
        .from(diningTables)
        .where(eq(diningTables.tabId, checkId));
      return { check, checkLines, originLines, anchoring };
    });

    expect(state.check?.status).toBe("open");
    expect(state.check?.label).toBe("T1");
    // Inherits the origin's node/till (createOpenOrder stamps them from cfg).
    expect(state.check?.nodeId).toBe(cfg.nodeId);
    expect(state.check?.tillId).toBe(cfg.tillId);
    // A check is a payment unit, NOT a seat: no dining_tables row points at it.
    expect(state.anchoring).toEqual([]);
    // WHOLE lines are moved first, THEN partial splits — not the transfers-array order.
    // Read straight off the column, so each quantity is a count of whole THOUSANDTHS: 300 is the
    // 0.300 kg of jamón and 1000 is one agua.
    expect(state.checkLines).toEqual([
      { productId: jamonId, quantity: 300 },
      { productId: aguaId, quantity: 1000 },
    ]);
    // …and the origin holds only the remainder (quantity conserved: 3 − 1 = 2 aguas; jamón moved whole).
    expect(state.originLines).toEqual([{ lineNo: 1, productId: aguaId, quantity: 2000 }]);
  });

  it("refuses to split off a check from a non-open tab (tab.not_open)", async () => {
    const { cfg } = await setupVenue();
    const MISSING = "00000000-0000-0000-0000-000000000000";
    await expect(
      asApp(cfg, (tx) => splitOffCheck(tx, cfg, MISSING, [{ lineNo: 1 }])),
    ).rejects.toMatchObject({ code: "tab.not_open" });
  });

  it("refuses a DETACHED CHECK as the split origin (tab.not_open) — origin must be an open TAB", async () => {
    // A detached check — a table-LESS open order minted BY a prior split — is a payment unit, not a
    // seat: no `dining_tables.tab_id` points at it, so it fails closed to `tab.not_open`.
    const { cfg, aguaId, tableId } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) =>
      openTabWith(tx, cfg, { tableId, lines: [{ productId: aguaId, quantity: "3" }] }),
    );
    // Mint a real detached check off the tab, then try to split off IT — its checkId is a table-less
    // open order.
    const { checkId } = await asApp(cfg, (tx) =>
      splitOffCheck(tx, cfg, tabId, [{ lineNo: 1, quantity: "1" }]),
    );
    await expect(
      asApp(cfg, (tx) => splitOffCheck(tx, cfg, checkId, [{ lineNo: 1 }])),
    ).rejects.toMatchObject({ code: "tab.not_open" });
  });

  it("rejects a batch repeating a lineNo (tab.transfer_duplicate_line), minting nothing and conserving quantity", async () => {
    const { cfg, aguaId, tableId } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) =>
      openTabWith(tx, cfg, { tableId, lines: [{ productId: aguaId, quantity: "3" }] }),
    );
    // Two partial "1"s off the SAME line 1 would make 4 aguas from an original 3. Refused UP FRONT,
    // before the check is minted.
    await expect(
      asApp(cfg, (tx) =>
        splitOffCheck(tx, cfg, tabId, [
          { lineNo: 1, quantity: "1" },
          { lineNo: 1, quantity: "1" },
        ]),
      ),
    ).rejects.toMatchObject({ code: "tab.transfer_duplicate_line" });

    const state = await asApp(cfg, async (tx) => {
      const originLines = await tx
        .select({
          lineNo: workingOrderLines.lineNo,
          productId: workingOrderLines.productId,
          quantity: workingOrderLines.quantity,
        })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, tabId))
        .orderBy(workingOrderLines.lineNo);
      const orders = await tx.select({ id: workingOrders.id }).from(workingOrders);
      return { originLines, orderCount: orders.length };
    });
    // Origin untouched — still the whole agua×3, quantity conserved (NOT split down to two). Read
    // straight off the column, so 3000 is those three units as a count of thousandths.
    expect(state.originLines).toEqual([{ lineNo: 1, productId: aguaId, quantity: 3000 }]);
    // No stray check minted — only the origin tab exists.
    expect(state.orderCount).toBe(1);
  });

  it("inherits TS-4's move guards (tab.transfer_quantity_invalid, tab.line_not_found)", async () => {
    const { cfg, aguaId, tableId } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) =>
      openTabWith(tx, cfg, { tableId, lines: [{ productId: aguaId, quantity: "2" }] }),
    );
    await expect(
      asApp(cfg, (tx) => splitOffCheck(tx, cfg, tabId, [{ lineNo: 1, quantity: "5" }])),
    ).rejects.toMatchObject({ code: "tab.transfer_quantity_invalid" });
    await expect(
      asApp(cfg, (tx) => splitOffCheck(tx, cfg, tabId, [{ lineNo: 99 }])),
    ).rejects.toMatchObject({ code: "tab.line_not_found" });
  });

  it("refuses an EMPTY transfers array (sale.empty_basket), minting nothing", async () => {
    const { cfg, aguaId, tableId } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) =>
      openTabWith(tx, cfg, { tableId, lines: [{ productId: aguaId, quantity: "3" }] }),
    );
    // Refused before anything is minted, or the call would leave an orphan check: a table-less
    // `open` working order with zero lines and a consumed order_number.
    await expect(asApp(cfg, (tx) => splitOffCheck(tx, cfg, tabId, []))).rejects.toMatchObject({
      code: "sale.empty_basket",
    });

    const state = await asApp(cfg, async (tx) => {
      const originLines = await tx
        .select({
          lineNo: workingOrderLines.lineNo,
          productId: workingOrderLines.productId,
          quantity: workingOrderLines.quantity,
        })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, tabId))
        .orderBy(workingOrderLines.lineNo);
      const orders = await tx.select({ id: workingOrders.id }).from(workingOrders);
      return { originLines, orderCount: orders.length };
    });
    // Origin untouched — still the whole agua×3, as a count of thousandths off the column.
    expect(state.originLines).toEqual([{ lineNo: 1, productId: aguaId, quantity: 3000 }]);
    // No orphan check minted — only the origin tab exists.
    expect(state.orderCount).toBe(1);
  });
});

describe("unjoinTable", () => {
  it("with items: anchors a NEW open tab to the detached table and moves the items onto it", async () => {
    const { cfg, aguaId, tableId, tableId2 } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) =>
      openTabWith(tx, cfg, { tableId, lines: [{ productId: aguaId, quantity: "2" }] }),
    );
    await asApp(cfg, (tx) => joinTable(tx, cfg, tabId, tableId2)); // both tables now point at tabId

    const { tabId: newTabId } = await asApp(cfg, (tx) =>
      unjoinTable(tx, cfg, tabId, tableId2, [{ lineNo: 1, quantity: "1" }]),
    );

    const state = await asApp(cfg, async (tx) => {
      const [detached] = await tx
        .select({ tabId: diningTables.tabId })
        .from(diningTables)
        .where(eq(diningTables.id, tableId2));
      const [stillJoined] = await tx
        .select({ tabId: diningTables.tabId })
        .from(diningTables)
        .where(eq(diningTables.id, tableId));
      const [newTab] = await tx
        .select({ status: workingOrders.status })
        .from(workingOrders)
        .where(eq(workingOrders.id, newTabId!));
      const newTabLines = await tx
        .select({ productId: workingOrderLines.productId, quantity: workingOrderLines.quantity })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, newTabId!));
      return { detached, stillJoined, newTab, newTabLines };
    });

    expect(newTabId).toBeDefined();
    expect(state.detached?.tabId).toBe(newTabId); // the table now runs its OWN bill (re-anchored)
    expect(state.stillJoined?.tabId).toBe(tabId); // the origin table is unaffected
    expect(state.newTab?.status).toBe("open");
    // One agua, read off the column as a count of thousandths.
    expect(state.newTabLines).toEqual([{ productId: aguaId, quantity: 1000 }]);
  });

  it("with items: refuses to un-join a table that SOLELY anchors its tab (table.not_shared), minting nothing", async () => {
    const { cfg, aguaId, tableId } = await setupVenue();
    // An ordinary single-table tab: tableId is the ONLY table pointing at tabId (no join). A WITH-items
    // un-join has no join to split off, so it must reject honestly rather than repoint the table away and
    // let transferLines' back-pointer check throw a misleading tab.not_open on the now-anchorless tab.
    const { tabId } = await asApp(cfg, (tx) =>
      openTabWith(tx, cfg, { tableId, lines: [{ productId: aguaId, quantity: "2" }] }),
    );

    await expect(
      asApp(cfg, (tx) => unjoinTable(tx, cfg, tabId, tableId, [{ lineNo: 1, quantity: "1" }])),
    ).rejects.toMatchObject({ code: "table.not_shared" });

    // Nothing minted, nothing moved: tableId still anchors tabId, and no second open working order exists.
    const state = await asApp(cfg, async (tx) => {
      const [anchor] = await tx
        .select({ tabId: diningTables.tabId })
        .from(diningTables)
        .where(eq(diningTables.id, tableId));
      const [{ count }] = await tx
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(workingOrders)
        .where(eq(workingOrders.status, "open"));
      return { anchor, count };
    });
    expect(state.anchor?.tabId).toBe(tabId); // unchanged — the guard threw before the repoint
    expect(state.count).toBe(1); // only the original tab's order exists; no new tab was created
  });

  it("without items: frees the table (tab_id → NULL) and clears its TS-2 status", async () => {
    const { cfg, aguaId, tableId, tableId2, activeStatusId } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) =>
      openTabWith(tx, cfg, { tableId, lines: [{ productId: aguaId, quantity: "1" }] }),
    );
    await asApp(cfg, (tx) => joinTable(tx, cfg, tabId, tableId2));
    // Give the joined table a NON-NULL manual status FIRST, so the post-unjoin null assertion below can
    // tell "unjoinTable cleared it" apart from "it was never set". joinTable sets only tab_id and never a
    // status, so without this the clear would be untested.
    await asApp(cfg, (tx) => setTableStatus(tx, cfg, tableId2, activeStatusId));
    const [before] = await asApp(cfg, (tx) =>
      tx
        .select({ statusId: diningTables.statusId })
        .from(diningTables)
        .where(eq(diningTables.id, tableId2)),
    );
    expect(before?.statusId).toBe(activeStatusId); // pre-condition: the status IS set going in.

    const result = await asApp(cfg, (tx) => unjoinTable(tx, cfg, tabId, tableId2));

    const [row] = await asApp(cfg, (tx) =>
      tx
        .select({ tabId: diningTables.tabId, statusId: diningTables.statusId })
        .from(diningTables)
        .where(eq(diningTables.id, tableId2)),
    );
    expect(result).toEqual({});
    expect(row?.tabId).toBeNull();
    expect(row?.statusId).toBeNull(); // turnover: the manual status clears
  });

  it("refuses to un-join a table that isn't part of the tab (table.not_joined)", async () => {
    const { cfg, aguaId, tableId, tableId2 } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) =>
      openTabWith(tx, cfg, { tableId, lines: [{ productId: aguaId, quantity: "1" }] }),
    );
    // tableId2 is FREE (never joined) → not part of tabId.
    await expect(asApp(cfg, (tx) => unjoinTable(tx, cfg, tabId, tableId2))).rejects.toMatchObject({
      code: "table.not_joined",
    });
  });

  it("refuses to un-join from a tab whose shared order is no longer open (tab.not_open)", async () => {
    const { cfg, aguaId, tableId, tableId2 } = await setupVenue();
    const { tabId } = await asApp(cfg, (tx) =>
      openTabWith(tx, cfg, { tableId, lines: [{ productId: aguaId, quantity: "1" }] }),
    );
    await asApp(cfg, (tx) => joinTable(tx, cfg, tabId, tableId2));
    // Abandon the shared order WITHOUT clearing the tables' tab_id — a STALE pointer, exactly the state
    // openTab documents (a settled/abandoned tab leaves its tables pointing at it). tableId2.tab_id still
    // equals tabId, so it passes the table.not_joined guard and reaches the shared-tab open check.
    await db.execute(sql`update working_orders set status = 'abandoned' where id = ${tabId}`);
    await expect(asApp(cfg, (tx) => unjoinTable(tx, cfg, tabId, tableId2))).rejects.toMatchObject({
      code: "tab.not_open",
    });
  });
});

it("retains the frozen options answers and the frozen names when a dish quantity is split onto a check", async () => {
  const { cfg, aguaId, tableId } = await setupVenue();
  await asApp(cfg, async (tx) => {
    const { tabId } = await openTabWith(tx, cfg, {
      tableId,
      lines: [{ productId: aguaId, quantity: "3" }],
    });
    // A frozen options answer is keyed by CONTENT language, which is what the order path widens the
    // list's and label's plain staff names under (`buildLineExtras`, modifier-selection.ts).
    const { defaultLanguage } = await readContentLanguages(tx, cfg.locale);
    const optionSnapshots = [
      {
        listName: { [defaultLanguage]: "Milk" },
        listCustomerName: { [defaultLanguage]: "Your milk" },
        listKitchenName: "MILK",
        labelName: { [defaultLanguage]: "Oat" },
        labelCustomerName: { [defaultLanguage]: "Oat drink" },
        labelKitchenName: "OAT",
      },
    ];
    // Frozen names the seeded product does not itself carry, so the split has something to lose:
    // the destination line must inherit every per-unit value, never re-read the catalogue.
    const names = {
      variantName: "Con gas",
      variantDescriptions: { [LOCALE]: "Con gas" },
      variantKitchenName: "GAS",
      kitchenName: "BAR",
    };
    await tx
      .update(workingOrderLines)
      .set({ optionSnapshots, ...names })
      .where(eq(workingOrderLines.workingOrderId, tabId));
    const { checkId } = await splitOffCheck(tx, cfg, tabId, [{ lineNo: 1, quantity: "1" }]);
    const source = await priceStoredOrder(tx, tabId);
    const check = await priceStoredOrder(tx, checkId);
    const answersOn = async (orderId: string) =>
      (
        await tx
          .select({ optionSnapshots: workingOrderLines.optionSnapshots })
          .from(workingOrderLines)
          .where(eq(workingOrderLines.workingOrderId, orderId))
      ).map((row) => row.optionSnapshots);
    expect(await answersOn(tabId)).toEqual([optionSnapshots]);
    expect(await answersOn(checkId)).toEqual([optionSnapshots]);
    expect(check.lines[0]).toMatchObject({ name: "Agua", ...names });
    expect(source.lines[0]).toMatchObject({ name: "Agua", ...names });
    expect(source.lines[0]!.quantity).toBe("2.000");
    expect(check.lines[0]!.quantity).toBe("1.000");
    expect(source.total).toBe("3.00");
    expect(check.total).toBe("1.50");
  });
});

/** A default kitchen station, with each product's route re-pointed at it, so a round fires there. */
async function withKitchen(cfg: TillConfig): Promise<string> {
  const stationId = await seedKitchenStation(db, { locationId: cfg.locationId });
  const offers = await asApp(cfg, (tx) => offerProducts(tx, cfg, { zone: "tables" }));
  offersByCfg.set(cfg, offers);
  return stationId;
}

/** Each line of an order in `line_no` order, with its ticket item, if any. */
async function linesWithTickets(orderId: string) {
  return db
    .select({
      id: workingOrderLines.id,
      quantity: workingOrderLines.quantity,
      sentAt: workingOrderLines.sentAt,
      servedAt: workingOrderLines.servedAt,
      courseId: workingOrderLines.courseId,
      note: workingOrderLines.note,
      extraListId: workingOrderLines.extraListId,
      ticketId: ticketItems.id,
      ticketOrderId: ticketItems.workingOrderId,
      ticketQuantity: ticketItems.quantity,
      ticketState: ticketItems.state,
    })
    .from(workingOrderLines)
    .leftJoin(ticketItems, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .where(eq(workingOrderLines.workingOrderId, orderId))
    .orderBy(workingOrderLines.lineNo);
}

/** Every column of a line's ticket item, or `undefined` when it has none. */
async function ticketOf(lineId: string) {
  const [row] = await db
    .select()
    .from(ticketItems)
    .where(eq(ticketItems.workingOrderLineId, lineId));
  return row;
}

async function revisionOf(orderId: string): Promise<number> {
  const [row] = await db
    .select({ revision: workingOrders.revision })
    .from(workingOrders)
    .where(eq(workingOrders.id, orderId));
  return row!.revision;
}

/** A cloud-poll printer attached to the station, so a fire or a correction there prints. */
async function printerAt(cfg: TillConfig, stationId: string): Promise<string> {
  return asApp(cfg, async (tx) => {
    const { id } = await createPrinter(
      tx,
      { locationId: cfg.locationId },
      {
        name: `P-${randomUUID().slice(0, 8)}`,
        transport: "cloud_poll",
        pollId: `poll-${randomUUID()}`,
      },
    );
    await attachPrinterToStation(tx, { stationId, printerId: id });
    return id;
  });
}

/** What each job enqueued for the printer prints, oldest first. */
async function printedBy(printerId: string): Promise<string[][]> {
  const jobs = await db
    .select({ payload: printJobs.payload })
    .from(printJobs)
    .where(eq(printJobs.printerId, printerId))
    .orderBy(sql`rowid`);
  return jobs.map((job) => printedLines(job.payload));
}

/** The kitchen notices recorded against the orders, oldest first. */
async function noticesOn(...orderIds: string[]) {
  const { rows } = await db.execute<{ working_order_id: string; kind: string; quantity: number }>(
    sql`select working_order_id, kind, quantity from kitchen_notices
      where working_order_id in (${sql.join(
        orderIds.map((id) => sql`${id}`),
        sql`, `,
      )})
      order by rowid`,
  );
  return rows.map((row) => ({
    orderId: row.working_order_id,
    kind: row.kind,
    quantity: row.quantity,
  }));
}

/** Each order at the station, with the quantities its items ask for. */
async function queueAt(cfg: TillConfig, stationId: string) {
  const groups = await asApp(cfg, (tx) => listStationQueue(tx, stationId));
  return Object.fromEntries(
    groups.map((group) => [group.orderId, group.items.map((item) => item.quantity)]),
  );
}

/** A tab at each of the venue's two tables, the first holding one round of Agua. */
async function twoTabs(
  seeded: Seeded,
  round: { quantity: string; hold?: boolean },
): Promise<{ from: string; to: string }> {
  const { cfg, aguaId, tableId, tableId2 } = seeded;
  const { tabId: from } = await asApp(cfg, (tx) => openTabWith(tx, cfg, { tableId }));
  const { tabId: to } = await asApp(cfg, (tx) => openTabWith(tx, cfg, { tableId: tableId2 }));
  await asApp(cfg, (tx) =>
    addTabRound(tx, cfg, from, [
      {
        menuItemId: offersByCfg.get(cfg)!.offerFor(aguaId),
        quantity: round.quantity,
        ...(round.hold === true ? { hold: true } : {}),
      },
    ]),
  );
  return { from, to };
}

/**
 * The owner's decision of 2026-09-26, overturning plan D10 where they conflict: a partial split gives
 * the moved row its own ticket item, copied from the original, whose own quantity drops by the part
 * moved; a line the kitchen has started may be split; and the split tells the kitchen nothing.
 */
describe("splitting a line the kitchen has", () => {
  it("gives the split row a ticket of its own, copied from the original, and takes the part moved off the original's", async () => {
    const { cfg, aguaId, tableId } = await setupVenue();
    const stationId = await withKitchen(cfg);
    const course = await asApp(cfg, (tx) =>
      createCourse(tx, cfg, { name: "Principales", displayOrder: 1 }),
    );
    const { tabId } = await asApp(cfg, (tx) => openTabWith(tx, cfg, { tableId }));
    await asApp(cfg, (tx) =>
      addTabRound(tx, cfg, tabId, [
        {
          menuItemId: offersByCfg.get(cfg)!.offerFor(aguaId),
          quantity: "3",
          courseId: course.id,
          note: "sin hielo",
        },
      ]),
    );
    await asApp(cfg, (tx) => markLineServed(tx, cfg, tabId, 1));
    const [before] = await linesWithTickets(tabId);
    const original = (await ticketOf(before!.id))!;
    expect(original).toMatchObject({ quantity: 3000, courseId: course.id, note: "sin hielo" });
    expect(original.firedAt).not.toBeNull();

    const { checkId } = await asApp(cfg, (tx) =>
      splitOffCheck(tx, cfg, tabId, [{ lineNo: 1, quantity: "1" }]),
    );

    const [source] = await linesWithTickets(tabId);
    const [split] = await linesWithTickets(checkId);
    expect(source!.sentAt).not.toBeNull();
    expect(source!.servedAt).not.toBeNull();
    expect(split).toMatchObject({
      quantity: 1000,
      sentAt: source!.sentAt,
      servedAt: source!.servedAt,
      courseId: course.id,
      note: "sin hielo",
      extraListId: null,
    });
    expect(await ticketOf(source!.id)).toEqual({ ...original, quantity: 2000 });
    expect(split!.ticketId).not.toBeNull();
    expect(split!.ticketId).not.toBe(original.id);
    expect(await ticketOf(split!.id)).toEqual({
      ...original,
      id: split!.ticketId,
      workingOrderId: checkId,
      workingOrderLineId: split!.id,
      quantity: 1000,
    });
    // The station still makes the three it was asked for, now as two rows.
    expect(await queueAt(cfg, stationId)).toEqual({
      [tabId]: [thousandthsToDecimal(2000)],
      [checkId]: [thousandthsToDecimal(1000)],
    });
  });

  it("takes the part moved off the line's quantity where the original ticket states none", async () => {
    const { cfg, aguaId, tableId } = await setupVenue();
    await withKitchen(cfg);
    const { tabId } = await asApp(cfg, (tx) => openTabWith(tx, cfg, { tableId }));
    await asApp(cfg, (tx) =>
      addTabRound(tx, cfg, tabId, [
        { menuItemId: offersByCfg.get(cfg)!.offerFor(aguaId), quantity: "3" },
      ]),
    );
    const [line] = await linesWithTickets(tabId);
    // As every ticket item written before the column was.
    await db.update(ticketItems).set({ quantity: null }).where(eq(ticketItems.id, line!.ticketId!));

    const { checkId } = await asApp(cfg, (tx) =>
      splitOffCheck(tx, cfg, tabId, [{ lineNo: 1, quantity: "1" }]),
    );

    expect((await linesWithTickets(tabId))[0]).toMatchObject({ ticketQuantity: 2000 });
    expect((await linesWithTickets(checkId))[0]).toMatchObject({ ticketQuantity: 1000 });
  });

  it.each(["preparing", "ready"] as const)(
    "splits a %s line, the split row's ticket in the same state, and still refuses an edit of either row",
    async (state) => {
      const { cfg, aguaId, tableId } = await setupVenue();
      await withKitchen(cfg);
      const { tabId } = await asApp(cfg, (tx) => openTabWith(tx, cfg, { tableId }));
      await asApp(cfg, (tx) =>
        addTabRound(tx, cfg, tabId, [
          { menuItemId: offersByCfg.get(cfg)!.offerFor(aguaId), quantity: "2" },
        ]),
      );
      const [line] = await linesWithTickets(tabId);
      await asApp(cfg, (tx) => advanceTicketItem(tx, cfg, line!.ticketId!, "preparing"));
      if (state === "ready") {
        await asApp(cfg, (tx) => advanceTicketItem(tx, cfg, line!.ticketId!, "ready"));
      }
      const original = (await ticketOf(line!.id))!;

      const { checkId } = await asApp(cfg, (tx) =>
        splitOffCheck(tx, cfg, tabId, [{ lineNo: 1, quantity: "1" }]),
      );

      const [source] = await linesWithTickets(tabId);
      const [split] = await linesWithTickets(checkId);
      expect(source).toMatchObject({ quantity: 1000, ticketQuantity: 1000, ticketState: state });
      expect(await ticketOf(split!.id)).toEqual({
        ...original,
        id: split!.ticketId,
        workingOrderId: checkId,
        workingOrderLineId: split!.id,
        quantity: 1000,
      });
      for (const [orderId, ticketItemId] of [
        [tabId, source!.ticketId],
        [checkId, split!.ticketId],
      ] as const) {
        const revision = await revisionOf(orderId);
        await expect(
          asApp(cfg, (tx) => updateOrderLine(tx, cfg, orderId, 1, { note: "otra" }, revision)),
        ).rejects.toMatchObject({ code: "ticket.already_started", params: { ticketItemId } });
      }
    },
  );

  it("moves a whole line the kitchen has started with its ticket", async () => {
    const { cfg, aguaId, tableId } = await setupVenue();
    await withKitchen(cfg);
    const { tabId } = await asApp(cfg, (tx) => openTabWith(tx, cfg, { tableId }));
    await asApp(cfg, (tx) =>
      addTabRound(tx, cfg, tabId, [
        { menuItemId: offersByCfg.get(cfg)!.offerFor(aguaId), quantity: "2" },
      ]),
    );
    const [line] = await linesWithTickets(tabId);
    await asApp(cfg, (tx) => advanceTicketItem(tx, cfg, line!.ticketId!, "preparing"));

    const { checkId } = await asApp(cfg, (tx) => splitOffCheck(tx, cfg, tabId, [{ lineNo: 1 }]));

    expect(await linesWithTickets(tabId)).toEqual([]);
    expect((await linesWithTickets(checkId))[0]).toMatchObject({
      id: line!.id,
      quantity: 2000,
      ticketId: line!.ticketId,
      ticketOrderId: checkId,
      ticketState: "preparing",
    });
  });

  it("tells the kitchen nothing: no notice and no print job", async () => {
    const seeded = await setupVenue();
    const { cfg } = seeded;
    const stationId = await withKitchen(cfg);
    const printerId = await printerAt(cfg, stationId);
    const { from, to } = await twoTabs(seeded, { quantity: "4" });
    const [line] = await linesWithTickets(from);
    const printed = await printedBy(printerId);
    expect(printed).toHaveLength(1);

    await asApp(cfg, (tx) => transferLines(tx, cfg, from, to, [{ lineNo: 1, quantity: "1" }]));
    await asApp(cfg, (tx) => advanceTicketItem(tx, cfg, line!.ticketId!, "preparing"));
    const { checkId } = await asApp(cfg, (tx) =>
      splitOffCheck(tx, cfg, from, [{ lineNo: 1, quantity: "1" }]),
    );

    expect(await printedBy(printerId)).toEqual(printed);
    expect(await noticesOn(from, to, checkId)).toEqual([]);
    expect(await queueAt(cfg, stationId)).toEqual({
      [from]: [thousandthsToDecimal(2000)],
      [to]: [thousandthsToDecimal(1000)],
      [checkId]: [thousandthsToDecimal(1000)],
    });
  });

  it("voids the part moved to another tab at the kitchen, leaving the original's", async () => {
    const seeded = await setupVenue();
    const { cfg } = seeded;
    const stationId = await withKitchen(cfg);
    const printerId = await printerAt(cfg, stationId);
    const { from, to } = await twoTabs(seeded, { quantity: "2" });
    await asApp(cfg, (tx) => transferLines(tx, cfg, from, to, [{ lineNo: 1, quantity: "1" }]));

    await asApp(cfg, (tx) => voidTabLine(tx, cfg, to, 1));

    expect(await noticesOn(from, to)).toEqual([{ orderId: to, kind: "void", quantity: 1000 }]);
    const slip = (await printedBy(printerId)).at(-1)!;
    expect(slip).toContain("*** VOID ***");
    expect(slip).toContain("1.000 ea x Agua");
    expect(await queueAt(cfg, stationId)).toEqual({ [from]: [thousandthsToDecimal(1000)] });
  });

  it("voids only what the original row still asks for, leaving the part moved to another tab", async () => {
    const seeded = await setupVenue();
    const { cfg } = seeded;
    const stationId = await withKitchen(cfg);
    const { from, to } = await twoTabs(seeded, { quantity: "2" });
    await asApp(cfg, (tx) => transferLines(tx, cfg, from, to, [{ lineNo: 1, quantity: "1" }]));

    await asApp(cfg, (tx) => voidTabLine(tx, cfg, from, 1));

    expect(await noticesOn(from, to)).toEqual([{ orderId: from, kind: "void", quantity: 1000 }]);
    expect((await linesWithTickets(to))[0]).toMatchObject({ ticketQuantity: 1000 });
    expect(await queueAt(cfg, stationId)).toEqual({ [to]: [thousandthsToDecimal(1000)] });
  });

  it("splits a held line so each tab's Send fires its own part", async () => {
    const seeded = await setupVenue();
    const { cfg } = seeded;
    const stationId = await withKitchen(cfg);
    const printerId = await printerAt(cfg, stationId);
    const { from, to } = await twoTabs(seeded, { quantity: "2", hold: true });
    await asApp(cfg, (tx) => transferLines(tx, cfg, from, to, [{ lineNo: 1, quantity: "1" }]));
    expect(await printedBy(printerId)).toEqual([]);

    await asApp(cfg, (tx) => sendLines(tx, cfg, to, []));

    const [moved] = await linesWithTickets(to);
    expect(moved!.sentAt).not.toBeNull();
    expect((await ticketOf(moved!.id))!.firedAt).not.toBeNull();
    const [kept] = await linesWithTickets(from);
    expect(kept!.sentAt).toBeNull();
    expect((await ticketOf(kept!.id))!.firedAt).toBeNull();
    expect(await printedBy(printerId)).toHaveLength(1);
    expect((await printedBy(printerId))[0]).toContain("1.000 ea x Agua");

    await asApp(cfg, (tx) => sendLines(tx, cfg, from, []));

    expect((await linesWithTickets(from))[0]!.sentAt).not.toBeNull();
    expect(await ticketOf(kept!.id)).toMatchObject({ quantity: 1000 });
    expect((await ticketOf(kept!.id))!.firedAt).not.toBeNull();
    const printed = await printedBy(printerId);
    expect(printed).toHaveLength(2);
    expect(printed[1]).toContain("1.000 ea x Agua");
    expect(printed[1]).not.toContain("2.000 ea x Agua");
  });

  it("names the origin's table on the slip voiding the part moved to a check", async () => {
    const { cfg, aguaId, tableId } = await setupVenue();
    const stationId = await withKitchen(cfg);
    const printerId = await printerAt(cfg, stationId);
    const { tabId } = await asApp(cfg, (tx) => openTabWith(tx, cfg, { tableId }));
    await asApp(cfg, (tx) =>
      addTabRound(tx, cfg, tabId, [
        { menuItemId: offersByCfg.get(cfg)!.offerFor(aguaId), quantity: "3" },
      ]),
    );
    const [ticket] = await printedBy(printerId);
    expect(ticket).toContain("T1");
    const { checkId } = await asApp(cfg, (tx) =>
      splitOffCheck(tx, cfg, tabId, [{ lineNo: 1, quantity: "2" }]),
    );
    const revision = await revisionOf(checkId);

    await asApp(cfg, (tx) => updateOrderLine(tx, cfg, checkId, 1, { quantity: "1" }, revision));

    const slip = (await printedBy(printerId)).at(-1)!;
    expect(slip).toContain("*** VOID ***");
    expect(slip).toContain("T1");
    expect(slip).toContain("1.000 ea x Agua");
    expect(await noticesOn(checkId)).toEqual([{ orderId: checkId, kind: "void", quantity: 1000 }]);
  });

  it("names the origin's table for the check on the pass board", async () => {
    const { cfg, aguaId, tableId } = await setupVenue();
    await withKitchen(cfg);
    const { tabId } = await asApp(cfg, (tx) => openTabWith(tx, cfg, { tableId }));
    await asApp(cfg, (tx) =>
      addTabRound(tx, cfg, tabId, [
        { menuItemId: offersByCfg.get(cfg)!.offerFor(aguaId), quantity: "2" },
      ]),
    );
    const { checkId } = await asApp(cfg, (tx) =>
      splitOffCheck(tx, cfg, tabId, [{ lineNo: 1, quantity: "1" }]),
    );
    // A table pointing at the order wins over the order's own label.
    await db.update(workingOrders).set({ label: "Terraza" }).where(eq(workingOrders.id, tabId));

    const board = await asApp(cfg, (tx) => listExpoQueue(tx, cfg));

    expect(Object.fromEntries(board.map((order) => [order.orderId, order.tableLabel]))).toEqual({
      [tabId]: "T1",
      [checkId]: "T1",
    });
  });

  it("splits a line the kitchen does not have without making a ticket", async () => {
    const { cfg, aguaId, tableId } = await setupVenue();
    await withKitchen(cfg);
    const { tabId } = await asApp(cfg, (tx) =>
      openTabWith(tx, cfg, { tableId, lines: [{ productId: aguaId, quantity: "3" }] }),
    );

    const { checkId } = await asApp(cfg, (tx) =>
      splitOffCheck(tx, cfg, tabId, [{ lineNo: 1, quantity: "1" }]),
    );

    expect(await linesWithTickets(tabId)).toMatchObject([{ quantity: 2000, ticketId: null }]);
    expect(await linesWithTickets(checkId)).toMatchObject([{ quantity: 1000, ticketId: null }]);
  });
});

/**
 * A check is paid straight after the split and cannot be sent (`sendLines` refuses anything but a
 * tab), so held kitchen work never goes onto one.
 */
describe("splitting held kitchen work onto a check", () => {
  it.each([
    ["whole", undefined],
    ["part", "1"],
  ] as const)(
    "refuses to move a held line (%s) onto a check, moving nothing, and still splits a fired one",
    async (_, quantity) => {
      const { cfg, aguaId, tableId } = await setupVenue();
      await withKitchen(cfg);
      const offer = offersByCfg.get(cfg)!.offerFor(aguaId);
      const { tabId } = await asApp(cfg, (tx) => openTabWith(tx, cfg, { tableId }));
      await asApp(cfg, (tx) => addTabRound(tx, cfg, tabId, [{ menuItemId: offer, quantity: "2" }]));
      await asApp(cfg, (tx) =>
        addTabRound(tx, cfg, tabId, [{ menuItemId: offer, quantity: "3", hold: true }]),
      );
      const before = await linesWithTickets(tabId);
      const orderCount = async () =>
        (await db.select({ id: workingOrders.id }).from(workingOrders)).length;
      const ordersBefore = await orderCount();

      await expect(
        asApp(cfg, (tx) =>
          splitOffCheck(tx, cfg, tabId, [
            { lineNo: 1 },
            quantity === undefined ? { lineNo: 2 } : { lineNo: 2, quantity },
          ]),
        ),
      ).rejects.toMatchObject({ code: "tab.split_held_line", params: { tabId, lineNo: 2 } });

      expect(await linesWithTickets(tabId)).toEqual(before);
      expect(await orderCount()).toBe(ordersBefore);

      const { checkId } = await asApp(cfg, (tx) =>
        splitOffCheck(tx, cfg, tabId, [{ lineNo: 1, quantity: "1" }]),
      );
      expect(await linesWithTickets(checkId)).toMatchObject([
        { quantity: 1000, ticketQuantity: 1000 },
      ]);
    },
  );
});
