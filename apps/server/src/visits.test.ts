import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
  listAvailableProducts,
} from "@waitron/catalogue";
import {
  billPaymentRefunds,
  captureError,
  diningTables,
  saleLines,
  sales,
  serviceCommands,
  tableServiceStatuses,
  visits,
  visitTables,
  withTransaction,
  workingOrders,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { hashPassword, hashPin } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import type { VenueResult } from "@waitron/provisioning";
import { writeClearingWorkflow } from "@waitron/venue-service";
import {
  MONEY_SCALE,
  locationId as brandLocationId,
  nodeId as brandNodeId,
  decimal,
  seriesId as brandSeriesId,
  sumDecimals,
  tillId as brandTillId,
  toScale,
} from "@waitron/shared";
import { deploymentEnvironment } from "./config.js";
import { ALL_MODULES } from "./modules.js";
import type { TillConfig } from "./till-config.js";
import { createTable } from "./tables.js";
import {
  abandonHeldOrder,
  addTabRound,
  joinTable,
  listTablesWithState,
  mergeTabs,
  moveTab,
  openTab,
  parkOrder,
  splitOffCheck,
  transferLines,
  unjoinTable,
  voidTabLine,
} from "./working-order.js";
import { takeBillPayment } from "./bill-payments.js";
import { payWorkingOrder } from "./till-sale.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";
import {
  checkAndBumpVisit,
  finishTable,
  markCleared,
  readVisitBills,
  runServiceCommand,
  seatTable,
  visitFamily,
} from "./visits.js";
import "./errors.js";

const LOCALE = "es-ES";
const OPERATOR = "cccccccc-0000-4000-8000-000000000001";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

let backend: FiscalBackend;
let clock: TrustedClock;

beforeAll(() => {
  clock = {
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
      throw new Error("visits.test: anchor() is not used by these cases");
    },
    currentAnchor: () => null,
  };
  backend = new VerifactuBackend({
    clock,
    db: suite.db,
    environment: deploymentEnvironment(process.env),
    deploymentEnvironment: deploymentEnvironment(process.env),
    resolveClient: () =>
      Promise.reject(new Error("visits.test: filing a sale never contacts AEAT")),
  });
});

interface Venue {
  cfg: TillConfig;
  tables: ZoneOffers;
  /** The offer selling the product named `name` at a table. */
  item(name: string): string;
  /** A fresh dining table in the tables zone. */
  table(label: string): Promise<string>;
}

const PRICES: Record<string, string> = {
  Burger: "12.00",
  Vino: "30.00",
  Agua: "2.00",
  Flan: "5.00",
  Paella: "20.00",
  Tarta: "15.00",
};

async function setupVenue(): Promise<Venue> {
  const db = suite.db;
  const venue: VenueResult = await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: "60000001K",
        legalName: "Visitas SL",
        location: {
          name: "Sala",
          fiscalTerritory: "ES-common",
          invoiceLocales: [LOCALE],
          operationDescription: "Restaurante",
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
    { db, modules: ALL_MODULES },
  );
  const cfg: TillConfig = {
    tillId: brandTillId(venue.tillId),
    nodeId: brandNodeId(venue.nodeId),
    seriesId: brandSeriesId(venue.seriesIds[0]!),
    locationId: brandLocationId(venue.locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    orderFlow: "prepay",
  };
  const { tables, productIds } = await withTransaction(db, async (tx) => {
    const cat = await createCatalogue(tx, { name: "Carta" });
    const platos = await createCategory(tx, { name: { [LOCALE]: "Platos" } });
    for (const [name, unitPrice] of Object.entries(PRICES)) {
      await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: platos.id,
        name,
        pricingUnit: "each",
        unitPrice,
        vatClass: "general",
      });
    }
    await assignCatalogueToLocation(tx, venue.locationId, cat.id);
    const available = (await listAvailableProducts(tx, cfg.locationId)).products;
    return {
      tables: await offerProducts(tx, cfg, { zone: "tables" }),
      productIds: new Map(available.map((p) => [p.name, p.id])),
    };
  });
  return {
    cfg,
    tables,
    item: (name) => tables.offerFor(productIds.get(name)!),
    table: (label) =>
      withTransaction(db, async (tx) => {
        const { id } = await createTable(tx, cfg, { label, zoneId: tables.zoneId });
        return id;
      }),
  };
}

const inTx = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> => withTransaction(suite.db, fn);

async function seat(
  cfg: TillConfig,
  tableId: string,
  guestCount: number | null = null,
): Promise<{ visitId: string; tabId: string; revision: number }> {
  return inTx((tx) => seatTable(tx, cfg, { tableId, guestCount, operatorId: OPERATOR }));
}

async function order(venue: Venue, tabId: string, ...names: string[]): Promise<void> {
  await inTx((tx) =>
    addTabRound(
      tx,
      venue.cfg,
      tabId,
      names.map((name) => ({ menuItemId: venue.item(name), quantity: "1" })),
    ),
  );
}

async function pay(cfg: TillConfig, orderId: string, amount: string): Promise<void> {
  await payWorkingOrder({ db: suite.db, backend, clock }, cfg, {
    id: orderId,
    lines: [],
    tender: { method: "cash", amount },
  });
}

async function revisionOf(visitId: string): Promise<number> {
  const [row] = await inTx((tx) =>
    tx.select({ revision: visits.revision }).from(visits).where(eq(visits.id, visitId)),
  );
  return row!.revision;
}

/** The visit a table belongs to, while it belongs to one. */
async function visitForTable(
  tx: Transaction,
  tableId: string,
): Promise<{ visitId: string; revision: number } | null> {
  const [row] = await tx
    .select({ visitId: visits.id, revision: visits.revision })
    .from(visitTables)
    .innerJoin(visits, eq(visits.id, visitTables.visitId))
    .where(and(eq(visitTables.tableId, tableId), isNull(visitTables.leftAt)));
  return row ?? null;
}

async function visitRow(visitId: string) {
  const [row] = await inTx((tx) => tx.select().from(visits).where(eq(visits.id, visitId)));
  return row!;
}

async function membershipsOf(visitId: string) {
  return inTx((tx) => tx.select().from(visitTables).where(eq(visitTables.visitId, visitId)));
}

async function tableRow(tableId: string) {
  const [row] = await inTx((tx) =>
    tx.select().from(diningTables).where(eq(diningTables.id, tableId)),
  );
  return row!;
}

async function statusOf(orderId: string): Promise<string> {
  const [row] = await inTx((tx) =>
    tx
      .select({ status: workingOrders.status })
      .from(workingOrders)
      .where(eq(workingOrders.id, orderId)),
  );
  return row!.status;
}

async function giveStatus(tableIds: string[]): Promise<string> {
  return inTx(async (tx) => {
    const [status] = await tx
      .insert(tableServiceStatuses)
      .values({ label: `Postre ${randomUUID()}`, color: "#ef4444" })
      .returning({ id: tableServiceStatuses.id });
    for (const id of tableIds) {
      await tx.update(diningTables).set({ statusId: status!.id }).where(eq(diningTables.id, id));
    }
    return status!.id;
  });
}

/** What a tab path is sent on a visit's tab: the revision the caller read, and who acts. */
async function cmd(
  visitId: string,
): Promise<{ expectedVisitRevision: number; operatorId: string }> {
  return { expectedVisitRevision: await revisionOf(visitId), operatorId: OPERATOR };
}

async function join(
  cfg: TillConfig,
  visitId: string,
  tabId: string,
  tableId: string,
): Promise<void> {
  const command = await cmd(visitId);
  await inTx((tx) => joinTable(tx, cfg, tabId, tableId, command));
}

async function split(
  cfg: TillConfig,
  visitId: string,
  tabId: string,
  lineNos: number[],
): Promise<string> {
  const command = await cmd(visitId);
  const { checkId } = await inTx((tx) =>
    splitOffCheck(
      tx,
      cfg,
      tabId,
      lineNos.map((lineNo) => ({ lineNo })),
      command,
    ),
  );
  return checkId;
}

/** Merges visit `from`'s tab into `into`'s, as the till's merge does. */
async function merge(
  cfg: TillConfig,
  into: { visitId: string; tabId: string },
  from: { visitId: string; tabId: string },
  freeSourceTable = false,
): Promise<void> {
  const expectedVisitRevision = await revisionOf(into.visitId);
  const expectedSourceVisitRevision = await revisionOf(from.visitId);
  await inTx((tx) =>
    mergeTabs(tx, cfg, into.tabId, from.tabId, {
      freeSourceTable,
      expectedVisitRevision,
      expectedSourceVisitRevision,
      operatorId: OPERATOR,
    }),
  );
}

async function visitIdOf(orderId: string): Promise<string | null> {
  const [row] = await inTx((tx) =>
    tx
      .select({ visitId: workingOrders.visitId })
      .from(workingOrders)
      .where(eq(workingOrders.id, orderId)),
  );
  return row!.visitId;
}

async function floorRow(cfg: TillConfig, tableId: string) {
  const rows = await inTx((tx) => listTablesWithState(tx, cfg));
  return rows.find((row) => row.id === tableId)!;
}

/**
 * A bill that is placed but unpaid. By direct write: today no path places a bill that belongs to a
 * table's party — a split check takes the tab's `table_tab` mode, which files nothing at placing —
 * so this stands in for the invoice-first flow of plan Task 14. Collecting it is the matching
 * `placed → settled` write.
 */
async function placeByHand(orderId: string): Promise<void> {
  await inTx((tx) =>
    tx.update(workingOrders).set({ status: "placed" }).where(eq(workingOrders.id, orderId)),
  );
}

async function collectByHand(orderId: string): Promise<void> {
  await inTx((tx) =>
    tx
      .update(workingOrders)
      .set({ status: "settled", settledAt: new Date().toISOString() })
      .where(eq(workingOrders.id, orderId)),
  );
}

function total(bills: { outstanding: string }[]): string {
  return toScale(sumDecimals(bills.map((bill) => decimal(bill.outstanding))), MONEY_SCALE);
}

describe("seating", () => {
  it("opens a visit, one membership and a tab on the visit", async () => {
    const venue = await setupVenue();
    const mesa4 = await venue.table("Mesa 4");

    const seated = await seat(venue.cfg, mesa4, 3);

    expect(seated.revision).toBe(0);
    expect(await visitRow(seated.visitId)).toMatchObject({
      state: "open",
      guestCount: 3,
      openedBy: OPERATOR,
      revision: 0,
    });
    const memberships = await membershipsOf(seated.visitId);
    expect(memberships).toHaveLength(1);
    expect(memberships[0]).toMatchObject({ tableId: mesa4, leftAt: null });
    expect((await tableRow(mesa4)).tabId).toBe(seated.tabId);
    const [tab] = await inTx((tx) =>
      tx.select().from(workingOrders).where(eq(workingOrders.id, seated.tabId)),
    );
    expect(tab).toMatchObject({ status: "open", visitId: seated.visitId });
    expect(await inTx((tx) => visitForTable(tx, mesa4))).toEqual({
      visitId: seated.visitId,
      revision: 0,
    });
  });

  it("records no guest count when none is given", async () => {
    const venue = await setupVenue();
    const seated = await seat(venue.cfg, await venue.table("Mesa 4"), null);
    expect((await visitRow(seated.visitId)).guestCount).toBeNull();
  });

  it("refuses seating an occupied table with the occupied-table code, and opens no second visit", async () => {
    const venue = await setupVenue();
    const mesa4 = await venue.table("Mesa 4");
    await seat(venue.cfg, mesa4, 3);

    const error = await captureError(() => seat(venue.cfg, mesa4, 2));

    expect(error).toMatchObject({ code: "tab.already_open", params: { tableId: mesa4 } });
    expect(await inTx((tx) => tx.select().from(visits))).toHaveLength(1);
  });

  it("gives no visit for a table nobody is seated at", async () => {
    const venue = await setupVenue();
    expect(await inTx((tx) => visitForTable(tx, randomUUID()))).toBeNull();
    expect(await inTx((tx) => visitForTable(tx, "not-an-id"))).toBeNull();
    const mesa4 = await venue.table("Mesa 4");
    expect(await inTx((tx) => visitForTable(tx, mesa4))).toBeNull();
  });
});

describe("related bills", () => {
  it("lists the tab and a check split from it, with what each still owes", async () => {
    const venue = await setupVenue();
    const mesa4 = await venue.table("Mesa 4");
    const { visitId, tabId } = await seat(venue.cfg, mesa4, 2);
    await order(venue, tabId, "Burger", "Vino", "Agua");
    const checkId = await split(venue.cfg, visitId, tabId, [2]);

    expect(await visitIdOf(checkId)).toBe(visitId);
    const before = await inTx((tx) => readVisitBills(tx, visitId));
    expect(before).toEqual([
      {
        workingOrderId: tabId,
        visitId,
        label: null,
        status: "open",
        total: "14.00",
        outstanding: "14.00",
        receiptAvailable: false,
      },
      {
        workingOrderId: checkId,
        visitId,
        // `splitOffCheck` names a check after its table.
        label: "Mesa 4",
        status: "open",
        total: "30.00",
        outstanding: "30.00",
        receiptAvailable: false,
      },
    ]);
    expect(total(before)).toBe("44.00");
    expect((await floorRow(venue.cfg, mesa4)).visit).toMatchObject({
      id: visitId,
      outstanding: "44.00",
      billCount: 2,
    });

    await pay(venue.cfg, tabId, "14.00");

    const after = await inTx((tx) => readVisitBills(tx, visitId));
    expect(after.find((bill) => bill.workingOrderId === tabId)).toMatchObject({
      status: "settled",
      total: "14.00",
      outstanding: "0.00",
      receiptAvailable: true,
    });
    expect(total(after)).toBe("30.00");
    expect((await visitRow(visitId)).state).toBe("open");
    expect(await inTx((tx) => visitForTable(tx, mesa4))).toMatchObject({ visitId });
    const floor = await floorRow(venue.cfg, mesa4);
    expect(floor.state).toBe("open-tab");
    expect(floor.visit).toMatchObject({ id: visitId, state: "open", outstanding: "30.00" });
  });

  it("lists nothing for a visit with no bills", async () => {
    const lone = await inTx(async (tx) => {
      const [row] = await tx.insert(visits).values({ openedBy: OPERATOR }).returning();
      return row!.id;
    });
    expect(await inTx((tx) => readVisitBills(tx, lone))).toEqual([]);
  });

  it("lists an abandoned bill as owing nothing", async () => {
    const venue = await setupVenue();
    const { visitId, tabId } = await seat(venue.cfg, await venue.table("Mesa 4"));
    await inTx((tx) =>
      tx.update(workingOrders).set({ status: "abandoned" }).where(eq(workingOrders.id, tabId)),
    );
    expect(await inTx((tx) => readVisitBills(tx, visitId))).toEqual([
      expect.objectContaining({ status: "abandoned", total: "0.00", outstanding: "0.00" }),
    ]);
  });
});

describe("finish table", () => {
  it("is refused while a check is unpaid, and changes nothing", async () => {
    const venue = await setupVenue();
    const mesa4 = await venue.table("Mesa 4");
    const { visitId, tabId } = await seat(venue.cfg, mesa4, 2);
    await order(venue, tabId, "Burger", "Vino", "Agua");
    const checkId = await split(venue.cfg, visitId, tabId, [2]);
    await pay(venue.cfg, tabId, "14.00");

    const error = await captureError(() =>
      inTx((tx) => finishTable(tx, { visitId, expectedVisitRevision: 1, operatorId: OPERATOR })),
    );

    expect(error).toMatchObject({ code: "visit.bill_outstanding", params: { visitId } });
    expect(await visitRow(visitId)).toMatchObject({ state: "open", revision: 1, closedAt: null });
    expect((await membershipsOf(visitId))[0]!.leftAt).toBeNull();
    expect(await statusOf(checkId)).toBe("open");
  });

  it("closes the visit and its membership, frees the table and clears its status once everything is paid", async () => {
    const venue = await setupVenue();
    const mesa4 = await venue.table("Mesa 4");
    const { visitId, tabId } = await seat(venue.cfg, mesa4, 2);
    await order(venue, tabId, "Burger", "Vino", "Agua");
    const checkId = await split(venue.cfg, visitId, tabId, [2]);
    await pay(venue.cfg, tabId, "14.00");
    await pay(venue.cfg, checkId, "30.00");
    await giveStatus([mesa4]);

    const result = await inTx((tx) =>
      finishTable(tx, { visitId, expectedVisitRevision: 1, operatorId: OPERATOR }),
    );

    expect(result).toEqual({ state: "closed" });
    const closed = await visitRow(visitId);
    expect(closed).toMatchObject({ state: "closed", closedBy: OPERATOR, revision: 2 });
    expect(closed.closedAt).not.toBeNull();
    expect((await membershipsOf(visitId))[0]!.leftAt).not.toBeNull();
    expect(await tableRow(mesa4)).toMatchObject({ tabId: null, statusId: null });
    expect(await inTx((tx) => visitForTable(tx, mesa4))).toBeNull();
  });

  it("abandons an empty open tab rather than counting it as owed", async () => {
    const venue = await setupVenue();
    const mesa4 = await venue.table("Mesa 4");
    const { visitId, tabId } = await seat(venue.cfg, mesa4);

    expect(
      await inTx((tx) =>
        finishTable(tx, { visitId, expectedVisitRevision: 0, operatorId: OPERATOR }),
      ),
    ).toEqual({ state: "closed" });
    expect(await statusOf(tabId)).toBe("abandoned");
  });

  it("is refused with a stale visit revision, and changes nothing", async () => {
    const venue = await setupVenue();
    const { visitId } = await seat(venue.cfg, await venue.table("Mesa 4"));
    await inTx((tx) => checkAndBumpVisit(tx, visitId, 0, "open"));

    const error = await captureError(() =>
      inTx((tx) => finishTable(tx, { visitId, expectedVisitRevision: 0, operatorId: OPERATOR })),
    );

    expect(error).toMatchObject({ code: "visit.out_of_date", params: { visitId, revision: 1 } });
    expect(await visitRow(visitId)).toMatchObject({ state: "open", revision: 1 });
  });

  it("is refused for a visit that is not open, or does not exist", async () => {
    const venue = await setupVenue();
    const { visitId } = await seat(venue.cfg, await venue.table("Mesa 4"));
    await inTx((tx) =>
      finishTable(tx, { visitId, expectedVisitRevision: 0, operatorId: OPERATOR }),
    );

    const again = await captureError(() =>
      inTx((tx) => finishTable(tx, { visitId, expectedVisitRevision: 1, operatorId: OPERATOR })),
    );
    expect(again).toMatchObject({ code: "visit.not_open", params: { visitId } });
    const unknown = randomUUID();
    const absent = await captureError(() =>
      inTx((tx) =>
        finishTable(tx, {
          visitId: unknown,
          expectedVisitRevision: 0,
          operatorId: OPERATOR,
        }),
      ),
    );
    expect(absent).toMatchObject({ code: "visit.not_open", params: { visitId: unknown } });
  });

  it("answers a visit that is not open as not open, even when the revision sent is stale too", async () => {
    const venue = await setupVenue();
    const { visitId } = await seat(venue.cfg, await venue.table("Mesa 4"));
    await inTx((tx) =>
      finishTable(tx, { visitId, expectedVisitRevision: 0, operatorId: OPERATOR }),
    );

    const error = await captureError(() =>
      inTx((tx) => finishTable(tx, { visitId, expectedVisitRevision: 0, operatorId: OPERATOR })),
    );

    expect(error).toMatchObject({ code: "visit.not_open", params: { visitId } });
  });

  it("closes a visit that no longer holds any table", async () => {
    const venue = await setupVenue();
    const mesa4 = await venue.table("Mesa 4");
    const { visitId } = await seat(venue.cfg, mesa4);
    await inTx((tx) =>
      tx
        .update(visitTables)
        .set({ leftAt: new Date().toISOString() })
        .where(eq(visitTables.visitId, visitId)),
    );

    expect(
      await inTx((tx) =>
        finishTable(tx, { visitId, expectedVisitRevision: 0, operatorId: OPERATOR }),
      ),
    ).toEqual({ state: "closed" });
  });

  it("frees every table of a joined party and clears each one's status", async () => {
    const venue = await setupVenue();
    const mesa4 = await venue.table("Mesa 4");
    const mesa5 = await venue.table("Mesa 5");
    const { visitId, tabId } = await seat(venue.cfg, mesa4);
    await join(venue.cfg, visitId, tabId, mesa5);
    await giveStatus([mesa4, mesa5]);

    await inTx((tx) =>
      finishTable(tx, { visitId, expectedVisitRevision: 1, operatorId: OPERATOR }),
    );

    for (const table of [mesa4, mesa5]) {
      expect(await tableRow(table)).toMatchObject({ tabId: null, statusId: null });
      expect(await inTx((tx) => visitForTable(tx, table))).toBeNull();
    }
    expect((await membershipsOf(visitId)).every((m) => m.leftAt !== null)).toBe(true);
  });
});

describe("needs clearing", () => {
  it("leaves every table of the party needing clearing until Mark cleared", async () => {
    const venue = await setupVenue();
    await inTx((tx) => writeClearingWorkflow(tx, true));
    const mesa4 = await venue.table("Mesa 4");
    const mesa5 = await venue.table("Mesa 5");
    const { visitId, tabId } = await seat(venue.cfg, mesa4);
    await join(venue.cfg, visitId, tabId, mesa5);
    await giveStatus([mesa4, mesa5]);

    const result = await inTx((tx) =>
      finishTable(tx, { visitId, expectedVisitRevision: 1, operatorId: OPERATOR }),
    );

    expect(result).toEqual({ state: "needs_clearing" });
    expect(await visitRow(visitId)).toMatchObject({ state: "needs_clearing", revision: 2 });
    for (const table of [mesa4, mesa5]) {
      expect((await tableRow(table)).statusId).toBeNull();
      expect(await inTx((tx) => visitForTable(tx, table))).toEqual({ visitId, revision: 2 });
      expect(await captureError(() => seat(venue.cfg, table))).toMatchObject({
        code: "tab.already_open",
      });
      const floor = await floorRow(venue.cfg, table);
      expect(floor.state).toBe("open-tab");
      expect(floor.visit).toMatchObject({ id: visitId, state: "needs_clearing" });
    }

    await inTx((tx) => markCleared(tx, { visitId, expectedVisitRevision: 2 }));

    expect(await visitRow(visitId)).toMatchObject({ state: "closed", revision: 3 });
    expect((await membershipsOf(visitId)).every((m) => m.leftAt !== null)).toBe(true);
    for (const table of [mesa4, mesa5]) {
      expect(await inTx((tx) => visitForTable(tx, table))).toBeNull();
      const next = await seat(venue.cfg, table);
      expect(next.visitId).not.toBe(visitId);
    }
  });

  it("refuses a tab opened straight onto a table that needs clearing, as the till's free-table route and a booking still do", async () => {
    const venue = await setupVenue();
    await inTx((tx) => writeClearingWorkflow(tx, true));
    const mesa4 = await venue.table("Mesa 4");
    const { visitId } = await seat(venue.cfg, mesa4);
    await inTx((tx) =>
      finishTable(tx, { visitId, expectedVisitRevision: 0, operatorId: OPERATOR }),
    );

    expect(
      await captureError(() => inTx((tx) => openTab(tx, venue.cfg, { tableId: mesa4 }))),
    ).toMatchObject({ code: "tab.already_open", params: { tableId: mesa4 } });
  });

  it("frees the table at once when the venue does not use it", async () => {
    const venue = await setupVenue();
    const mesa4 = await venue.table("Mesa 4");
    const { visitId } = await seat(venue.cfg, mesa4);
    expect(
      await inTx((tx) =>
        finishTable(tx, { visitId, expectedVisitRevision: 0, operatorId: OPERATOR }),
      ),
    ).toEqual({ state: "closed" });
    expect(await inTx((tx) => visitForTable(tx, mesa4))).toBeNull();
  });

  it("refuses Mark cleared on a visit not needing clearing, and with a stale revision", async () => {
    const venue = await setupVenue();
    await inTx((tx) => writeClearingWorkflow(tx, true));
    const { visitId } = await seat(venue.cfg, await venue.table("Mesa 4"));

    expect(
      await captureError(() =>
        inTx((tx) => markCleared(tx, { visitId, expectedVisitRevision: 0 })),
      ),
    ).toMatchObject({ code: "visit.not_open", params: { visitId } });
    expect(
      await captureError(() =>
        inTx((tx) => markCleared(tx, { visitId, expectedVisitRevision: 5 })),
      ),
    ).toMatchObject({ code: "visit.not_open", params: { visitId } });

    await inTx((tx) =>
      finishTable(tx, { visitId, expectedVisitRevision: 0, operatorId: OPERATOR }),
    );
    expect(
      await captureError(() =>
        inTx((tx) => markCleared(tx, { visitId, expectedVisitRevision: 0 })),
      ),
    ).toMatchObject({ code: "visit.out_of_date", params: { visitId, revision: 1 } });
    expect((await visitRow(visitId)).state).toBe("needs_clearing");
  });
});

describe("the next party", () => {
  it("starts a new visit whose bills list is empty", async () => {
    const venue = await setupVenue();
    const mesa4 = await venue.table("Mesa 4");
    const first = await seat(venue.cfg, mesa4, 2);
    await order(venue, first.tabId, "Burger");
    await pay(venue.cfg, first.tabId, "12.00");
    await inTx((tx) =>
      finishTable(tx, {
        visitId: first.visitId,
        expectedVisitRevision: 0,
        operatorId: OPERATOR,
      }),
    );

    const next = await seat(venue.cfg, mesa4, 4);

    expect(next.visitId).not.toBe(first.visitId);
    const bills = await inTx((tx) => readVisitBills(tx, next.visitId));
    expect(bills.map((bill) => bill.workingOrderId)).toEqual([next.tabId]);
    expect(bills[0]).toMatchObject({ status: "open", total: "0.00" });
  });
});

async function saleLinesOf(orderId: string) {
  return inTx((tx) =>
    tx
      .select({ line: saleLines })
      .from(saleLines)
      .innerJoin(sales, eq(sales.id, saleLines.saleId))
      .where(eq(sales.workingOrderId, orderId))
      .orderBy(saleLines.lineNo),
  );
}

describe("pay, then order dessert", () => {
  it("opens a new tab on the same visit and leaves the earlier sale untouched", async () => {
    const venue = await setupVenue();
    const mesa4 = await venue.table("Mesa 4");
    const { visitId, tabId } = await seat(venue.cfg, mesa4, 2);
    await order(venue, tabId, "Burger", "Vino");
    const checkId = await split(venue.cfg, visitId, tabId, [2]);
    await pay(venue.cfg, tabId, "12.00");
    await pay(venue.cfg, checkId, "30.00");
    const soldBefore = await saleLinesOf(tabId);
    expect(soldBefore).toHaveLength(1);
    expect((await visitRow(visitId)).state).toBe("open");
    const revisionBefore = await revisionOf(visitId);

    const { tabId: dessertTab } = await inTx((tx) =>
      addTabRound(tx, venue.cfg, tabId, [{ menuItemId: venue.item("Flan"), quantity: "1" }]),
    );

    expect(dessertTab).not.toBe(tabId);
    expect(await revisionOf(visitId)).toBe(revisionBefore + 1);
    expect(await visitIdOf(dessertTab)).toBe(visitId);
    expect(await statusOf(dessertTab)).toBe("open");
    expect((await tableRow(mesa4)).tabId).toBe(dessertTab);
    expect(await statusOf(tabId)).toBe("settled");
    expect(await saleLinesOf(tabId)).toEqual(soldBefore);
    const bills = await inTx((tx) => readVisitBills(tx, visitId));
    expect(bills.map((bill) => [bill.workingOrderId, bill.total, bill.outstanding])).toEqual([
      [tabId, "12.00", "0.00"],
      [checkId, "30.00", "0.00"],
      [dessertTab, "5.00", "5.00"],
    ]);
    const floor = await floorRow(venue.cfg, mesa4);
    expect(floor).toMatchObject({ state: "open-tab", hasOpenTab: true, tabId: dessertTab });
  });

  it("names the settled tab as the table's tab until the next round opens one", async () => {
    const venue = await setupVenue();
    const mesa4 = await venue.table("Mesa 4");
    const { visitId, tabId } = await seat(venue.cfg, mesa4, 2);
    await order(venue, tabId, "Burger");
    await pay(venue.cfg, tabId, "12.00");

    const floor = await floorRow(venue.cfg, mesa4);

    expect(floor).toMatchObject({ state: "open-tab", hasOpenTab: false, tabId });
    expect(floor.tabTotal).toBeUndefined();
    expect(floor.visit).toEqual({
      id: visitId,
      revision: 0,
      guestCount: 2,
      state: "open",
      outstanding: "0.00",
      billCount: 1,
      tableIds: [mesa4],
      unsentDrafts: [],
    });
  });

  it("refuses a round sent to a settled tab the party has already moved on from, or to a settled check", async () => {
    const venue = await setupVenue();
    const mesa4 = await venue.table("Mesa 4");
    const { visitId, tabId } = await seat(venue.cfg, mesa4);
    await order(venue, tabId, "Burger", "Vino");
    const checkId = await split(venue.cfg, visitId, tabId, [2]);
    await pay(venue.cfg, tabId, "12.00");
    await pay(venue.cfg, checkId, "30.00");
    const { tabId: dessertTab } = await inTx((tx) =>
      addTabRound(tx, venue.cfg, tabId, [{ menuItemId: venue.item("Flan"), quantity: "1" }]),
    );

    for (const stale of [tabId, checkId]) {
      expect(
        await captureError(() =>
          inTx((tx) =>
            addTabRound(tx, venue.cfg, stale, [{ menuItemId: venue.item("Agua"), quantity: "1" }]),
          ),
        ),
      ).toMatchObject({ code: "tab.not_open", params: { tabId: stale } });
    }
    expect((await tableRow(mesa4)).tabId).toBe(dessertTab);
    expect(await inTx((tx) => readVisitBills(tx, visitId))).toHaveLength(3);
  });

  it("refuses a round sent to the settled tab of a finished party", async () => {
    const venue = await setupVenue();
    await inTx((tx) => writeClearingWorkflow(tx, true));
    const mesa4 = await venue.table("Mesa 4");
    const { visitId, tabId } = await seat(venue.cfg, mesa4);
    await order(venue, tabId, "Burger");
    await pay(venue.cfg, tabId, "12.00");
    await inTx((tx) =>
      finishTable(tx, { visitId, expectedVisitRevision: 0, operatorId: OPERATOR }),
    );

    expect(
      await captureError(() =>
        inTx((tx) =>
          addTabRound(tx, venue.cfg, tabId, [{ menuItemId: venue.item("Flan"), quantity: "1" }]),
        ),
      ),
    ).toMatchObject({ code: "tab.not_open", params: { tabId } });
  });

  it("keeps the party seated when its tab is abandoned, and the next round opens a new tab", async () => {
    const venue = await setupVenue();
    const mesa4 = await venue.table("Mesa 4");
    const { visitId, tabId } = await seat(venue.cfg, mesa4);
    await order(venue, tabId, "Burger");

    await abandonHeldOrder({ db: suite.db }, venue.cfg, tabId);

    expect((await visitRow(visitId)).state).toBe("open");
    expect(await inTx((tx) => visitForTable(tx, mesa4))).toMatchObject({ visitId });
    expect((await floorRow(venue.cfg, mesa4)).state).toBe("open-tab");
    const { tabId: next } = await inTx((tx) =>
      addTabRound(tx, venue.cfg, tabId, [{ menuItemId: venue.item("Flan"), quantity: "1" }]),
    );
    expect(await visitIdOf(next)).toBe(visitId);
    expect((await tableRow(mesa4)).tabId).toBe(next);
    expect((await floorRow(venue.cfg, mesa4)).visit).toMatchObject({
      billCount: 1,
      outstanding: "5.00",
    });
  });
});

describe("joined tables (Mesa 4 and Mesa 5)", () => {
  async function joined() {
    const venue = await setupVenue();
    const mesa4 = await venue.table("Mesa 4");
    const mesa5 = await venue.table("Mesa 5");
    const seated = await seat(venue.cfg, mesa4, 6);
    await join(venue.cfg, seated.visitId, seated.tabId, mesa5);
    return { venue, mesa4, mesa5, ...seated };
  }

  it("gives both tables one visit, and refuses seating the joined table", async () => {
    const { venue, mesa4, mesa5, visitId, tabId } = await joined();

    const memberships = await membershipsOf(visitId);
    expect(memberships.map((m) => [m.tableId, m.leftAt])).toEqual(
      expect.arrayContaining([
        [mesa4, null],
        [mesa5, null],
      ]),
    );
    expect(memberships).toHaveLength(2);
    expect(await inTx((tx) => visitForTable(tx, mesa4))).toEqual({ visitId, revision: 1 });
    expect(await inTx((tx) => visitForTable(tx, mesa5))).toEqual({ visitId, revision: 1 });
    expect((await tableRow(mesa5)).tabId).toBe(tabId);

    expect(await captureError(() => seat(venue.cfg, mesa5))).toMatchObject({
      code: "tab.already_open",
    });
    expect(await inTx((tx) => tx.select().from(visits))).toHaveLength(1);
    for (const table of [mesa4, mesa5]) {
      expect((await floorRow(venue.cfg, table)).visit).toMatchObject({
        id: visitId,
        tableIds: expect.arrayContaining([mesa4, mesa5]),
      });
    }
  });

  it("keeps both tables seated after payment, and a dessert round lands on the same visit for both", async () => {
    const { venue, mesa4, mesa5, visitId, tabId } = await joined();
    await order(venue, tabId, "Burger");
    await pay(venue.cfg, tabId, "12.00");

    for (const table of [mesa4, mesa5]) {
      expect((await floorRow(venue.cfg, table)).state).toBe("open-tab");
    }

    const { tabId: dessertTab } = await inTx((tx) =>
      addTabRound(tx, venue.cfg, tabId, [{ menuItemId: venue.item("Flan"), quantity: "1" }]),
    );

    for (const table of [mesa4, mesa5]) {
      expect((await tableRow(table)).tabId).toBe(dessertTab);
      expect(await inTx((tx) => visitForTable(tx, table))).toMatchObject({ visitId });
    }
    expect(await visitIdOf(dessertTab)).toBe(visitId);
  });

  it("lets the next party at either table see no earlier bill once the party finishes", async () => {
    const { venue, mesa4, mesa5, visitId, tabId } = await joined();
    await order(venue, tabId, "Burger");
    await pay(venue.cfg, tabId, "12.00");
    await inTx((tx) =>
      finishTable(tx, { visitId, expectedVisitRevision: 1, operatorId: OPERATOR }),
    );

    for (const table of [mesa4, mesa5]) {
      expect((await floorRow(venue.cfg, table)).state).toBe("free");
      const next = await seat(venue.cfg, table);
      const bills = await inTx((tx) => readVisitBills(tx, next.visitId));
      expect(bills.map((bill) => bill.workingOrderId)).toEqual([next.tabId]);
    }
  });

  it("gives an unjoined table with items exactly one new visit holding them, and the party keeps the rest", async () => {
    const { venue, mesa4, mesa5, visitId, tabId } = await joined();
    await order(venue, tabId, "Burger", "Vino", "Agua");
    const command = await cmd(visitId);

    const { tabId: mesa5Tab } = await inTx((tx) =>
      unjoinTable(tx, venue.cfg, tabId, mesa5, [{ lineNo: 2 }, { lineNo: 3 }], command),
    );

    const all = await inTx((tx) => tx.select().from(visits));
    expect(all).toHaveLength(2);
    const fresh = all.find((visit) => visit.id !== visitId)!;
    expect(fresh).toMatchObject({ state: "open", openedBy: OPERATOR, guestCount: null });
    expect(await visitIdOf(mesa5Tab!)).toBe(fresh.id);
    expect(await inTx((tx) => visitForTable(tx, mesa5))).toMatchObject({ visitId: fresh.id });
    expect(await inTx((tx) => visitForTable(tx, mesa4))).toMatchObject({ visitId });
    expect((await inTx((tx) => readVisitBills(tx, fresh.id))).map((bill) => bill.total)).toEqual([
      "32.00",
    ]);
    expect((await inTx((tx) => readVisitBills(tx, visitId))).map((bill) => bill.total)).toEqual([
      "12.00",
    ]);
    const memberships = await membershipsOf(visitId);
    expect(memberships.find((m) => m.tableId === mesa5)!.leftAt).not.toBeNull();
    expect(memberships.find((m) => m.tableId === mesa4)!.leftAt).toBeNull();
  });

  it("moves the party from both tables to Mesa 7 on the same visit", async () => {
    const { venue, mesa4, mesa5, visitId, tabId } = await joined();
    const mesa7 = await venue.table("Mesa 7");
    const command = await cmd(visitId);

    await inTx((tx) => moveTab(tx, venue.cfg, tabId, mesa7, command));

    const memberships = await membershipsOf(visitId);
    expect(memberships.filter((m) => m.leftAt === null).map((m) => m.tableId)).toEqual([mesa7]);
    expect(memberships).toHaveLength(3);
    expect(await inTx((tx) => visitForTable(tx, mesa7))).toMatchObject({ visitId });
    for (const table of [mesa4, mesa5]) {
      expect(await inTx((tx) => visitForTable(tx, table))).toBeNull();
      expect((await floorRow(venue.cfg, table)).state).toBe("free");
    }
    expect((await tableRow(mesa7)).tabId).toBe(tabId);
  });
});

describe("a paid party (paying changes no table of the party)", () => {
  async function paid() {
    const venue = await setupVenue();
    const mesa4 = await venue.table("Mesa 4");
    const seated = await seat(venue.cfg, mesa4, 2);
    await order(venue, seated.tabId, "Burger");
    await pay(venue.cfg, seated.tabId, "12.00");
    return { venue, mesa4, ...seated };
  }

  it("moves from Mesa 4 to Mesa 7 on the same visit, leaving the settled tab as it was", async () => {
    const { venue, mesa4, visitId, tabId } = await paid();
    const mesa7 = await venue.table("Mesa 7");
    const command = await cmd(visitId);
    const [settledBefore] = await inTx((tx) =>
      tx.select().from(workingOrders).where(eq(workingOrders.id, tabId)),
    );

    await inTx((tx) => moveTab(tx, venue.cfg, tabId, mesa7, command));

    expect(await inTx((tx) => visitForTable(tx, mesa4))).toBeNull();
    expect((await floorRow(venue.cfg, mesa4)).state).toBe("free");
    expect(await inTx((tx) => visitForTable(tx, mesa7))).toEqual({
      visitId,
      revision: command.expectedVisitRevision + 1,
    });
    expect((await tableRow(mesa7)).tabId).toBe(tabId);
    const [settledAfter] = await inTx((tx) =>
      tx.select().from(workingOrders).where(eq(workingOrders.id, tabId)),
    );
    expect(settledAfter).toEqual(settledBefore);
  });

  it("joins Mesa 5, and the next round opens the party's next tab on both tables", async () => {
    const { venue, mesa4, visitId, tabId } = await paid();
    const mesa5 = await venue.table("Mesa 5");
    const command = await cmd(visitId);

    await inTx((tx) => joinTable(tx, venue.cfg, tabId, mesa5, command));

    for (const table of [mesa4, mesa5]) {
      expect(await inTx((tx) => visitForTable(tx, table))).toEqual({
        visitId,
        revision: command.expectedVisitRevision + 1,
      });
      expect((await tableRow(table)).tabId).toBe(tabId);
    }
    const { tabId: dessertTab } = await inTx((tx) =>
      addTabRound(tx, venue.cfg, tabId, [{ menuItemId: venue.item("Flan"), quantity: "1" }]),
    );
    expect(await visitIdOf(dessertTab)).toBe(visitId);
    for (const table of [mesa4, mesa5]) {
      expect((await tableRow(table)).tabId).toBe(dessertTab);
    }
  });

  it("refuses moving or joining with a settled tab the party has moved on from", async () => {
    const { venue, visitId, tabId } = await paid();
    await order(venue, tabId, "Flan");
    const mesa7 = await venue.table("Mesa 7");
    const command = await cmd(visitId);

    for (const run of [
      (tx: Transaction) => moveTab(tx, venue.cfg, tabId, mesa7, command),
      (tx: Transaction) => joinTable(tx, venue.cfg, tabId, mesa7, command),
    ]) {
      expect(await captureError(() => inTx(run))).toMatchObject({
        code: "tab.not_open",
        params: { tabId },
      });
    }
  });

  it("still refuses merging or transferring with a settled tab", async () => {
    const { venue, visitId, tabId } = await paid();
    const other = await seat(venue.cfg, await venue.table("Mesa 6"));
    await order(venue, other.tabId, "Flan");
    const revisions = {
      expectedVisitRevision: await revisionOf(visitId),
      expectedSourceVisitRevision: await revisionOf(other.visitId),
      operatorId: OPERATOR,
    };

    expect(
      await captureError(() =>
        inTx((tx) =>
          mergeTabs(tx, venue.cfg, tabId, other.tabId, { freeSourceTable: true, ...revisions }),
        ),
      ),
    ).toMatchObject({ code: "tab.not_open" });
    expect(
      await captureError(() =>
        inTx((tx) => transferLines(tx, venue.cfg, other.tabId, tabId, [{ lineNo: 1 }], revisions)),
      ),
    ).toMatchObject({ code: "tab.not_open" });
  });
});

/**
 * A parked counter order would give Mesa 5 a way to the party's paid check without Mesa 5 belonging
 * to the party; each step of that path is refused, so the check stays with its own party.
 */
describe("a paid check a counter order cannot bring to a table outside its party", () => {
  async function paidCheckAfterRefusals(
    mesa5Party: "has left the party" | "belongs to another party",
  ) {
    const venue = await setupVenue();
    const mesa4 = await venue.table("Mesa 4");
    const mesa5 = await venue.table("Mesa 5");
    const { visitId, tabId } = await seat(venue.cfg, mesa4);
    await order(venue, tabId, "Burger", "Vino");
    const checkId = await split(venue.cfg, visitId, tabId, [2]);

    const parkedId = randomUUID();
    await parkOrder({ db: suite.db }, venue.cfg, {
      id: parkedId,
      lines: [{ menuItemId: venue.item("Agua"), quantity: "1" }],
      zoneId: venue.tables.zoneId,
    });
    let otherVisitId: string | null = null;
    let mesa5TabId: string | null = null;
    if (mesa5Party === "has left the party") {
      await join(venue.cfg, visitId, tabId, mesa5);
      const command = await cmd(visitId);
      await inTx((tx) => unjoinTable(tx, venue.cfg, tabId, mesa5, undefined, command));
      expect(
        await captureError(() => inTx((tx) => joinTable(tx, venue.cfg, parkedId, mesa5))),
      ).toMatchObject({ code: "tab.not_table_tab", params: { tabId: parkedId } });
    } else {
      const other = await seat(venue.cfg, mesa5);
      otherVisitId = other.visitId;
      mesa5TabId = other.tabId;
      const expectedSourceVisitRevision = await revisionOf(other.visitId);
      expect(
        await captureError(() =>
          inTx((tx) =>
            mergeTabs(tx, venue.cfg, parkedId, other.tabId, {
              freeSourceTable: false,
              expectedSourceVisitRevision,
              operatorId: OPERATOR,
            }),
          ),
        ),
      ).toMatchObject({ code: "tab.not_table_tab", params: { tabId: parkedId } });
      expect(await statusOf(other.tabId)).toBe("open");
      expect(await revisionOf(other.visitId)).toBe(expectedSourceVisitRevision);
    }
    const command = await cmd(visitId);
    expect(
      await captureError(() =>
        inTx((tx) =>
          mergeTabs(tx, venue.cfg, checkId, parkedId, { freeSourceTable: false, ...command }),
        ),
      ),
    ).toMatchObject({ code: "tab.not_table_tab", params: { tabId: parkedId } });
    expect(await statusOf(parkedId)).toBe("open");
    expect(await revisionOf(visitId)).toBe(command.expectedVisitRevision);
    await pay(venue.cfg, checkId, "30.00");

    expect(await statusOf(checkId)).toBe("settled");
    expect((await tableRow(mesa4)).tabId).toBe(tabId);
    expect((await tableRow(mesa5)).tabId).toBe(mesa5TabId);
    const mesa5Visit = await inTx((tx) => visitForTable(tx, mesa5));
    expect(mesa5Visit?.visitId ?? null).toBe(otherVisitId);
    return { venue, mesa5, mesa5TabId, visitId, checkId };
  }

  for (const mesa5Party of ["has left the party", "belongs to another party"] as const) {
    describe(`when Mesa 5 ${mesa5Party}`, () => {
      it("refuses a round sent to the check, and opens no next tab", async () => {
        const { venue, mesa5, mesa5TabId, visitId, checkId } =
          await paidCheckAfterRefusals(mesa5Party);
        const bills = await inTx((tx) => readVisitBills(tx, visitId));

        expect(
          await captureError(() =>
            inTx((tx) =>
              addTabRound(tx, venue.cfg, checkId, [
                { menuItemId: venue.item("Flan"), quantity: "1" },
              ]),
            ),
          ),
        ).toMatchObject({ code: "tab.not_open", params: { tabId: checkId } });
        expect(await inTx((tx) => readVisitBills(tx, visitId))).toEqual(bills);
        expect((await tableRow(mesa5)).tabId).toBe(mesa5TabId);
      });

      it("refuses moving the check to a free table, or joining one to it", async () => {
        const { venue, mesa5, mesa5TabId, visitId, checkId } =
          await paidCheckAfterRefusals(mesa5Party);
        const mesa7 = await venue.table("Mesa 7");
        const command = await cmd(visitId);

        for (const run of [
          (tx: Transaction) => moveTab(tx, venue.cfg, checkId, mesa7, command),
          (tx: Transaction) => joinTable(tx, venue.cfg, checkId, mesa7, command),
        ]) {
          expect(await captureError(() => inTx(run))).toMatchObject({
            code: "tab.not_open",
            params: { tabId: checkId },
          });
        }
        expect((await tableRow(mesa5)).tabId).toBe(mesa5TabId);
        expect((await tableRow(mesa7)).tabId).toBeNull();
      });
    });
  }
});

describe("a split check moved to another table", () => {
  /** Mesa 4 (visit V, tab A: Burger), with the Vino split to check C and C moved to Mesa 7. */
  async function checkMoved() {
    const venue = await setupVenue();
    const mesa4 = await venue.table("Mesa 4");
    const mesa7 = await venue.table("Mesa 7");
    const { visitId, tabId } = await seat(venue.cfg, mesa4);
    await order(venue, tabId, "Burger", "Vino");
    const checkId = await split(venue.cfg, visitId, tabId, [2]);
    const command = await cmd(visitId);
    await inTx((tx) => moveTab(tx, venue.cfg, checkId, mesa7, command));
    return { venue, mesa4, mesa7, visitId, tabId, checkId };
  }

  it("keeps Mesa 4 on the party's tab and seats the check at Mesa 7 on the same visit", async () => {
    const { mesa4, mesa7, visitId, tabId, checkId } = await checkMoved();

    expect(await inTx((tx) => visitForTable(tx, mesa4))).toMatchObject({ visitId });
    expect((await tableRow(mesa4)).tabId).toBe(tabId);
    expect(await inTx((tx) => visitForTable(tx, mesa7))).toMatchObject({ visitId });
    expect((await tableRow(mesa7)).tabId).toBe(checkId);
    const active = (await membershipsOf(visitId)).filter((m) => m.leftAt === null);
    expect(active.map((m) => m.tableId)).toEqual([mesa4, mesa7]);
  });

  it("keeps Mesa 4 occupied once the tab is paid, and Finish frees both once every bill is", async () => {
    const { venue, mesa4, mesa7, visitId, tabId, checkId } = await checkMoved();

    await pay(venue.cfg, tabId, "12.00");
    expect(await floorRow(venue.cfg, mesa4)).toMatchObject({
      state: "open-tab",
      visit: { id: visitId, outstanding: "30.00" },
    });

    await pay(venue.cfg, checkId, "30.00");
    const expectedVisitRevision = await revisionOf(visitId);
    await inTx((tx) => finishTable(tx, { visitId, expectedVisitRevision, operatorId: OPERATOR }));
    for (const table of [mesa4, mesa7]) {
      expect((await floorRow(venue.cfg, table)).state).toBe("free");
    }
  });

  it("points only Mesa 4 at the next tab when a round follows the paid tab", async () => {
    const { venue, mesa4, mesa7, visitId, tabId, checkId } = await checkMoved();
    await pay(venue.cfg, tabId, "12.00");

    const { tabId: dessertTab } = await inTx((tx) =>
      addTabRound(tx, venue.cfg, tabId, [{ menuItemId: venue.item("Flan"), quantity: "1" }]),
    );

    expect(await visitIdOf(dessertTab)).toBe(visitId);
    expect((await tableRow(mesa4)).tabId).toBe(dessertTab);
    expect((await tableRow(mesa7)).tabId).toBe(checkId);
  });

  it("frees Mesa 7 when it is unjoined from the check, and the party keeps Mesa 4", async () => {
    const { venue, mesa4, mesa7, visitId, checkId } = await checkMoved();
    const command = await cmd(visitId);

    await inTx((tx) => unjoinTable(tx, venue.cfg, checkId, mesa7, undefined, command));

    expect(await inTx((tx) => visitForTable(tx, mesa7))).toBeNull();
    expect(await inTx((tx) => visitForTable(tx, mesa4))).toMatchObject({ visitId });
  });

  it("joins a table to a split check on the check's party, leaving the tab's table alone", async () => {
    const venue = await setupVenue();
    const mesa4 = await venue.table("Mesa 4");
    const mesa8 = await venue.table("Mesa 8");
    const { visitId, tabId } = await seat(venue.cfg, mesa4);
    await order(venue, tabId, "Burger", "Vino");
    const checkId = await split(venue.cfg, visitId, tabId, [2]);
    const command = await cmd(visitId);

    await inTx((tx) => joinTable(tx, venue.cfg, checkId, mesa8, command));

    expect(await inTx((tx) => visitForTable(tx, mesa8))).toMatchObject({ visitId });
    expect((await tableRow(mesa8)).tabId).toBe(checkId);
    expect(await inTx((tx) => visitForTable(tx, mesa4))).toMatchObject({ visitId });
    expect((await tableRow(mesa4)).tabId).toBe(tabId);
  });
});

describe("unjoin without items", () => {
  it("ends the table's membership and frees it for a fresh visit", async () => {
    const venue = await setupVenue();
    const mesa4 = await venue.table("Mesa 4");
    const mesa5 = await venue.table("Mesa 5");
    const { visitId, tabId } = await seat(venue.cfg, mesa4);
    await join(venue.cfg, visitId, tabId, mesa5);
    const command = await cmd(visitId);

    expect(
      await inTx((tx) => unjoinTable(tx, venue.cfg, tabId, mesa5, undefined, command)),
    ).toEqual({});

    expect(await inTx((tx) => visitForTable(tx, mesa5))).toBeNull();
    expect((await tableRow(mesa5)).tabId).toBeNull();
    expect((await floorRow(venue.cfg, mesa5)).visit).toBeNull();
    expect(await inTx((tx) => tx.select().from(visits))).toHaveLength(1);
    const next = await seat(venue.cfg, mesa5);
    expect(next.visitId).not.toBe(visitId);
    expect(await inTx((tx) => visitForTable(tx, mesa4))).toMatchObject({ visitId });
  });
});

describe("unjoin the party's only table", () => {
  it("is refused as not shared, and the party keeps the table", async () => {
    const venue = await setupVenue();
    const mesa4 = await venue.table("Mesa 4");
    const { visitId, tabId } = await seat(venue.cfg, mesa4);
    const command = await cmd(visitId);

    expect(
      await captureError(() =>
        inTx((tx) => unjoinTable(tx, venue.cfg, tabId, mesa4, undefined, command)),
      ),
    ).toMatchObject({ code: "table.not_shared", params: { tableId: mesa4, tabId } });

    expect(await inTx((tx) => visitForTable(tx, mesa4))).toMatchObject({ visitId });
    expect((await tableRow(mesa4)).tabId).toBe(tabId);
  });
});

describe("occupied destinations", () => {
  async function busyTables() {
    const venue = await setupVenue();
    await inTx((tx) => writeClearingWorkflow(tx, true));
    const cleaning = await venue.table("Mesa 1");
    const finished = await seat(venue.cfg, cleaning);
    await inTx((tx) =>
      finishTable(tx, {
        visitId: finished.visitId,
        expectedVisitRevision: 0,
        operatorId: OPERATOR,
      }),
    );
    const other = await seat(venue.cfg, await venue.table("Mesa 2"));
    const joinedElsewhere = await venue.table("Mesa 3");
    await join(venue.cfg, other.visitId, other.tabId, joinedElsewhere);
    // The joined table's pointer is taken off, so only its membership says it is occupied.
    await inTx((tx) =>
      tx.update(diningTables).set({ tabId: null }).where(eq(diningTables.id, joinedElsewhere)),
    );
    const party = await seat(venue.cfg, await venue.table("Mesa 4"));
    return { venue, cleaning, joinedElsewhere, party };
  }

  it("refuses joining a table that needs clearing or belongs to another visit", async () => {
    const { venue, cleaning, joinedElsewhere, party } = await busyTables();
    for (const tableId of [cleaning, joinedElsewhere]) {
      const command = await cmd(party.visitId);
      expect(
        await captureError(() =>
          inTx((tx) => joinTable(tx, venue.cfg, party.tabId, tableId, command)),
        ),
      ).toMatchObject({ code: "table.occupied", params: { tableId } });
    }
    expect(await membershipsOf(party.visitId)).toHaveLength(1);
    expect(await revisionOf(party.visitId)).toBe(0);
  });

  it("refuses moving a party onto a table that needs clearing or belongs to another visit", async () => {
    const { venue, cleaning, joinedElsewhere, party } = await busyTables();
    for (const tableId of [cleaning, joinedElsewhere]) {
      const command = await cmd(party.visitId);
      expect(
        await captureError(() =>
          inTx((tx) => moveTab(tx, venue.cfg, party.tabId, tableId, command)),
        ),
      ).toMatchObject({ code: "table.occupied", params: { tableId } });
    }
    expect((await membershipsOf(party.visitId)).map((m) => m.leftAt)).toEqual([null]);
  });
});

describe("stale moves", () => {
  /** Two parties, Mesa 4 (with three items) and Mesa 6 (one), and a free Mesa 5 and Mesa 7. */
  async function twoParties() {
    const venue = await setupVenue();
    const mesa4 = await venue.table("Mesa 4");
    const mesa5 = await venue.table("Mesa 5");
    const mesa6 = await venue.table("Mesa 6");
    const mesa7 = await venue.table("Mesa 7");
    const a = await seat(venue.cfg, mesa4);
    await order(venue, a.tabId, "Burger", "Vino", "Agua");
    const b = await seat(venue.cfg, mesa6);
    await order(venue, b.tabId, "Flan");
    return { venue, mesa4, mesa5, mesa6, mesa7, a, b };
  }

  type Parties = Awaited<ReturnType<typeof twoParties>>;

  /** What any of the six tab paths could change. */
  async function snapshot(p: Parties) {
    return inTx(async (tx) => ({
      tables: await tx.select().from(diningTables),
      memberships: await tx.select().from(visitTables),
      visits: await tx.select().from(visits),
      orders: await tx.select().from(workingOrders),
      bills: await readVisitBills(tx, p.a.visitId),
    }));
  }

  const PATHS: {
    name: string;
    run: (p: Parties, tx: Transaction, stale: { a: number; b: number }) => Promise<unknown>;
  }[] = [
    {
      name: "move",
      run: (p, tx, stale) =>
        moveTab(tx, p.venue.cfg, p.a.tabId, p.mesa7, {
          expectedVisitRevision: stale.a,
          operatorId: OPERATOR,
        }),
    },
    {
      name: "join",
      run: (p, tx, stale) =>
        joinTable(tx, p.venue.cfg, p.a.tabId, p.mesa5, {
          expectedVisitRevision: stale.a,
          operatorId: OPERATOR,
        }),
    },
    {
      name: "merge",
      run: (p, tx, stale) =>
        mergeTabs(tx, p.venue.cfg, p.a.tabId, p.b.tabId, {
          freeSourceTable: true,
          expectedVisitRevision: stale.a,
          expectedSourceVisitRevision: stale.b,
          operatorId: OPERATOR,
        }),
    },
    {
      name: "transfer",
      run: (p, tx, stale) =>
        transferLines(tx, p.venue.cfg, p.a.tabId, p.b.tabId, [{ lineNo: 1 }], {
          expectedVisitRevision: stale.b,
          expectedSourceVisitRevision: stale.a,
          operatorId: OPERATOR,
        }),
    },
    {
      name: "split",
      run: (p, tx, stale) =>
        splitOffCheck(tx, p.venue.cfg, p.a.tabId, [{ lineNo: 1 }], {
          expectedVisitRevision: stale.a,
          operatorId: OPERATOR,
        }),
    },
    {
      name: "unjoin",
      run: (p, tx, stale) =>
        unjoinTable(tx, p.venue.cfg, p.a.tabId, p.mesa5, [{ lineNo: 1 }], {
          expectedVisitRevision: stale.a,
          operatorId: OPERATOR,
        }),
    },
  ];

  it.each(PATHS)(
    "$name is refused when another device has changed the party since, and the rolled-back command leaves every table, party and bill as it was",
    async ({ name, run }) => {
      const p = await twoParties();
      if (name === "unjoin") await join(p.venue.cfg, p.a.visitId, p.a.tabId, p.mesa5);
      const current = { a: await revisionOf(p.a.visitId), b: await revisionOf(p.b.visitId) };
      await inTx((tx) => checkAndBumpVisit(tx, p.a.visitId, current.a, "open"));
      const before = await snapshot(p);

      const error = await captureError(() => inTx((tx) => run(p, tx, current)));

      expect(error).toMatchObject({
        code: "visit.out_of_date",
        params: { visitId: p.a.visitId, revision: current.a + 1 },
      });
      expect(await snapshot(p)).toEqual(before);
    },
  );

  it.each(PATHS.filter(({ name }) => name === "merge" || name === "transfer"))(
    "$name is refused when the other party has changed since, and the rolled-back command leaves every table, party and bill as it was",
    async ({ run }) => {
      const p = await twoParties();
      const current = { a: await revisionOf(p.a.visitId), b: await revisionOf(p.b.visitId) };
      await inTx((tx) => checkAndBumpVisit(tx, p.b.visitId, current.b, "open"));
      const before = await snapshot(p);

      const error = await captureError(() => inTx((tx) => run(p, tx, current)));

      expect(error).toMatchObject({
        code: "visit.out_of_date",
        params: { visitId: p.b.visitId, revision: current.b + 1 },
      });
      expect(await snapshot(p)).toEqual(before);
    },
  );

  it.each(PATHS)("$name bumps every visit it changes", async ({ name, run }) => {
    const p = await twoParties();
    if (name === "unjoin") await join(p.venue.cfg, p.a.visitId, p.a.tabId, p.mesa5);
    const current = { a: await revisionOf(p.a.visitId), b: await revisionOf(p.b.visitId) };

    await inTx((tx) => run(p, tx, current));

    expect(await revisionOf(p.a.visitId)).toBe(current.a + 1);
    const crossesVisits = name === "merge" || name === "transfer";
    expect(await revisionOf(p.b.visitId)).toBe(current.b + (crossesVisits ? 1 : 0));
  });

  it.each(PATHS)(
    "$name is refused on a party that is no longer open, before its revision moves in the same transaction",
    async ({ name, run }) => {
      const p = await twoParties();
      if (name === "unjoin") await join(p.venue.cfg, p.a.visitId, p.a.tabId, p.mesa5);
      const current = { a: await revisionOf(p.a.visitId), b: await revisionOf(p.b.visitId) };
      // Only a direct write leaves an open tab on a visit that has left `open`.
      await inTx((tx) =>
        tx
          .update(visits)
          .set({ state: "needs_clearing", closedAt: new Date().toISOString() })
          .where(eq(visits.id, p.a.visitId)),
      );

      const { error, revisionAtRefusal } = await inTx(async (tx) => {
        const refused = await captureError(() => run(p, tx, current));
        const [row] = await tx
          .select({ revision: visits.revision })
          .from(visits)
          .where(eq(visits.id, p.a.visitId));
        return { error: refused, revisionAtRefusal: row!.revision };
      });

      expect(error).toMatchObject({ code: "visit.not_open", params: { visitId: p.a.visitId } });
      expect(revisionAtRefusal).toBe(current.a);
    },
  );

  it("refuses a path on a party's tab sent without the party's revision", async () => {
    const p = await twoParties();
    const error = await captureError(() =>
      inTx((tx) => moveTab(tx, p.venue.cfg, p.a.tabId, p.mesa7)),
    );
    expect(error).toMatchObject({
      code: "management.request_invalid",
      params: { field: "expectedVisitRevision" },
    });
  });

  it("refuses a merge between two parties sent without the absorbed party's revision", async () => {
    const p = await twoParties();
    const error = await captureError(() =>
      inTx((tx) =>
        mergeTabs(tx, p.venue.cfg, p.a.tabId, p.b.tabId, {
          freeSourceTable: true,
          expectedVisitRevision: 0,
          operatorId: OPERATOR,
        }),
      ),
    );
    expect(error).toMatchObject({
      code: "management.request_invalid",
      params: { field: "expectedSourceVisitRevision" },
    });
    expect(await revisionOf(p.a.visitId)).toBe(0);
  });
});

describe("merge (D2)", () => {
  /**
   * Mesa 4 (visit T) has an open tab. Mesa 6 (visit S) has an open tab with a Water, a settled
   * Paella check and an open Tarta check.
   */
  async function parties() {
    const venue = await setupVenue();
    const mesa4 = await venue.table("Mesa 4");
    const mesa6 = await venue.table("Mesa 6");
    const t = await seat(venue.cfg, mesa4);
    await order(venue, t.tabId, "Vino");
    const s = await seat(venue.cfg, mesa6);
    await order(venue, s.tabId, "Paella", "Tarta", "Agua");
    const settledId = await split(venue.cfg, s.visitId, s.tabId, [1]);
    await pay(venue.cfg, settledId, "20.00");
    const openCheckId = await split(venue.cfg, s.visitId, s.tabId, [2]);
    return { venue, mesa4, mesa6, t, s, settledId, openCheckId };
  }

  it("absorbs the other party: its open check follows, its settled bill stays, and it closes", async () => {
    const { venue, t, s, settledId, openCheckId } = await parties();

    await merge(venue.cfg, t, s, true);

    expect(await visitIdOf(openCheckId)).toBe(t.visitId);
    expect(await statusOf(openCheckId)).toBe("open");
    expect(await visitIdOf(settledId)).toBe(s.visitId);
    expect(await visitIdOf(s.tabId)).toBe(s.visitId);
    expect(await statusOf(s.tabId)).toBe("abandoned");
    const absorbed = await visitRow(s.visitId);
    expect(absorbed).toMatchObject({
      state: "closed",
      mergedIntoVisitId: t.visitId,
      closedBy: OPERATOR,
    });
    expect(absorbed.closedAt).not.toBeNull();
    expect((await visitRow(t.visitId)).state).toBe("open");
    const bills = await inTx((tx) => readVisitBills(tx, t.visitId));
    expect(bills.find((bill) => bill.workingOrderId === t.tabId)!.total).toBe("32.00");
  });

  it("frees the absorbed party's table with freeSourceTable, and T keeps its own", async () => {
    const { venue, mesa4, mesa6, t, s } = await parties();

    await merge(venue.cfg, t, s, true);

    expect(await inTx((tx) => visitForTable(tx, mesa6))).toBeNull();
    expect(await tableRow(mesa6)).toMatchObject({ tabId: null, statusId: null });
    expect((await floorRow(venue.cfg, mesa6)).state).toBe("free");
    expect(await inTx((tx) => visitForTable(tx, mesa4))).toMatchObject({ visitId: t.visitId });
    expect((await membershipsOf(s.visitId)).every((m) => m.leftAt !== null)).toBe(true);
  });

  it("moves the absorbed party's tables to T without freeSourceTable, keeping their status", async () => {
    const { venue, mesa4, mesa6, t, s } = await parties();
    const mesa9 = await venue.table("Mesa 9");
    await join(venue.cfg, s.visitId, s.tabId, mesa9);
    const statusId = await giveStatus([mesa6, mesa9]);

    await merge(venue.cfg, t, s, false);

    for (const table of [mesa4, mesa6, mesa9]) {
      expect(await inTx((tx) => visitForTable(tx, table))).toMatchObject({ visitId: t.visitId });
      expect((await tableRow(table)).tabId).toBe(t.tabId);
    }
    for (const table of [mesa6, mesa9]) {
      expect((await tableRow(table)).statusId).toBe(statusId);
    }
    expect((await membershipsOf(s.visitId)).every((m) => m.leftAt !== null)).toBe(true);
    expect((await floorRow(venue.cfg, mesa6)).visit).toMatchObject({
      id: t.visitId,
      tableIds: expect.arrayContaining([mesa4, mesa6, mesa9]),
    });
  });

  it("refuses merging one party's split check into another party while its tab is open", async () => {
    const { venue, mesa4, mesa6, t, s, openCheckId } = await parties();
    const expectedVisitRevision = await revisionOf(t.visitId);
    const expectedSourceVisitRevision = await revisionOf(s.visitId);

    const error = await captureError(() =>
      inTx((tx) =>
        mergeTabs(tx, venue.cfg, t.tabId, openCheckId, {
          freeSourceTable: false,
          expectedVisitRevision,
          expectedSourceVisitRevision,
          operatorId: OPERATOR,
        }),
      ),
    );

    expect(error).toMatchObject({
      code: "tab.visit_has_other_open_bill",
      params: { tabId: openCheckId },
    });
    expect((await tableRow(mesa4)).tabId).toBe(t.tabId);
    expect((await tableRow(mesa6)).tabId).toBe(s.tabId);
    expect(await statusOf(openCheckId)).toBe("open");
    expect(await visitIdOf(openCheckId)).toBe(s.visitId);
  });

  it("refuses merging a table's bill that belongs to no party into a party's bill", async () => {
    const { venue, mesa4, t } = await parties();
    const mesa8 = await venue.table("Mesa 8");
    const { tabId: noPartyTabId } = await inTx((tx) => openTab(tx, venue.cfg, { tableId: mesa8 }));
    const command = await cmd(t.visitId);

    const error = await captureError(() =>
      inTx((tx) =>
        mergeTabs(tx, venue.cfg, t.tabId, noPartyTabId, { freeSourceTable: false, ...command }),
      ),
    );

    expect(error).toMatchObject({ code: "tab.visit_mismatch", params: { tabId: noPartyTabId } });
    expect(await statusOf(noPartyTabId)).toBe("open");
    expect((await tableRow(mesa8)).tabId).toBe(noPartyTabId);
    expect(await inTx((tx) => visitForTable(tx, mesa8))).toBeNull();
    expect((await tableRow(mesa4)).tabId).toBe(t.tabId);
    expect(await revisionOf(t.visitId)).toBe(command.expectedVisitRevision);
  });

  it("points a party's table at its split check when its tab merges into it without freeing the table", async () => {
    const { venue, mesa6, s, openCheckId } = await parties();
    const command = await cmd(s.visitId);

    await inTx((tx) =>
      mergeTabs(tx, venue.cfg, openCheckId, s.tabId, { freeSourceTable: false, ...command }),
    );

    expect((await tableRow(mesa6)).tabId).toBe(openCheckId);
    expect(await statusOf(s.tabId)).toBe("abandoned");
    expect(await statusOf(openCheckId)).toBe("open");
    expect(await inTx((tx) => visitForTable(tx, mesa6))).toMatchObject({ visitId: s.visitId });
  });

  it("puts a split check at no table back into its party's tab when asked to free the source table", async () => {
    const { venue, mesa6, s, openCheckId } = await parties();
    const memberships = await membershipsOf(s.visitId);
    const command = await cmd(s.visitId);

    await inTx((tx) =>
      mergeTabs(tx, venue.cfg, s.tabId, openCheckId, { freeSourceTable: true, ...command }),
    );

    expect(await statusOf(openCheckId)).toBe("abandoned");
    expect(await statusOf(s.tabId)).toBe("open");
    expect((await tableRow(mesa6)).tabId).toBe(s.tabId);
    expect(await membershipsOf(s.visitId)).toEqual(memberships);
  });

  it("points the absorbed party's tables at T's tab when the merged bill is its check and its tab has settled", async () => {
    const { venue, mesa4, mesa6, t, s, openCheckId } = await parties();
    await pay(venue.cfg, s.tabId, "2.00");
    const statusId = await giveStatus([mesa6]);
    const expectedVisitRevision = await revisionOf(t.visitId);
    const expectedSourceVisitRevision = await revisionOf(s.visitId);

    await inTx((tx) =>
      mergeTabs(tx, venue.cfg, t.tabId, openCheckId, {
        freeSourceTable: false,
        expectedVisitRevision,
        expectedSourceVisitRevision,
        operatorId: OPERATOR,
      }),
    );

    expect(await tableRow(mesa6)).toMatchObject({ tabId: t.tabId, statusId });
    expect(await floorRow(venue.cfg, mesa6)).toMatchObject({ hasOpenTab: true, tabId: t.tabId });
    expect(await inTx((tx) => visitForTable(tx, mesa4))).toMatchObject({ visitId: t.visitId });
    expect((await visitRow(s.visitId)).mergedIntoVisitId).toBe(t.visitId);
  });

  it("frees the absorbed party's tables when the merged bill is its check and its tab has settled", async () => {
    const { venue, mesa6, t, s, openCheckId } = await parties();
    await pay(venue.cfg, s.tabId, "2.00");
    await giveStatus([mesa6]);
    const expectedVisitRevision = await revisionOf(t.visitId);
    const expectedSourceVisitRevision = await revisionOf(s.visitId);

    await inTx((tx) =>
      mergeTabs(tx, venue.cfg, t.tabId, openCheckId, {
        freeSourceTable: true,
        expectedVisitRevision,
        expectedSourceVisitRevision,
        operatorId: OPERATOR,
      }),
    );

    expect(await tableRow(mesa6)).toMatchObject({ tabId: null, statusId: null });
    expect((await floorRow(venue.cfg, mesa6)).state).toBe("free");
  });

  it("refuses a new command on the absorbed party", async () => {
    const { venue, t, s } = await parties();
    await merge(venue.cfg, t, s, true);

    expect(
      await captureError(() =>
        inTx((tx) =>
          runServiceCommand(tx, { kind: "visit", visitId: s.visitId }, randomUUID(), "k", {}, () =>
            Promise.resolve(1),
          ),
        ),
      ),
    ).toMatchObject({ code: "visit.not_open", params: { visitId: s.visitId } });
    const expectedVisitRevision = await revisionOf(s.visitId);
    expect(
      await captureError(() =>
        inTx((tx) =>
          finishTable(tx, {
            visitId: s.visitId,
            expectedVisitRevision,
            operatorId: OPERATOR,
          }),
        ),
      ),
    ).toMatchObject({ code: "visit.not_open" });
  });

  it("merges a check back into its own party's tab without closing the party", async () => {
    const { venue, mesa6, s, openCheckId } = await parties();
    const expectedVisitRevision = await revisionOf(s.visitId);

    await inTx((tx) =>
      mergeTabs(tx, venue.cfg, s.tabId, openCheckId, {
        freeSourceTable: false,
        expectedVisitRevision,
        operatorId: OPERATOR,
      }),
    );

    expect(await visitRow(s.visitId)).toMatchObject({
      state: "open",
      mergedIntoVisitId: null,
      revision: expectedVisitRevision + 1,
    });
    expect(await inTx((tx) => visitForTable(tx, mesa6))).toMatchObject({ visitId: s.visitId });
    expect(await statusOf(openCheckId)).toBe("abandoned");
  });
});

describe("merged parties keep their bills", () => {
  /**
   * Mesa 6 (visit S) has a settled €20.00 check and a placed, unpaid €15.00 one, both split from its
   * now-empty tab; Mesa 4 (visit T) has an open €30.00 tab. S's tab is merged into T's.
   */
  async function mergedParties() {
    const venue = await setupVenue();
    const mesa4 = await venue.table("Mesa 4");
    const mesa6 = await venue.table("Mesa 6");
    const s = await seat(venue.cfg, mesa6);
    await order(venue, s.tabId, "Paella", "Tarta");
    const settledId = await split(venue.cfg, s.visitId, s.tabId, [1]);
    const placedId = await split(venue.cfg, s.visitId, s.tabId, [2]);
    await pay(venue.cfg, settledId, "20.00");
    await placeByHand(placedId);
    const t = await seat(venue.cfg, mesa4);
    await order(venue, t.tabId, "Vino");
    await merge(venue.cfg, t, s);
    return { venue, mesa4, mesa6, s, t, settledId, placedId };
  }

  it("lists the absorbed party's bills with the surviving visit's", async () => {
    const { t, s, settledId, placedId } = await mergedParties();

    const bills = await inTx((tx) => readVisitBills(tx, t.visitId));

    expect(
      bills.map((b) => [b.workingOrderId, b.visitId, b.status, b.total, b.outstanding]),
    ).toEqual([
      [s.tabId, s.visitId, "abandoned", "0.00", "0.00"],
      [settledId, s.visitId, "settled", "20.00", "0.00"],
      [placedId, s.visitId, "placed", "15.00", "15.00"],
      [t.tabId, t.visitId, "open", "30.00", "30.00"],
    ]);
    expect(bills.find((b) => b.workingOrderId === settledId)!.receiptAvailable).toBe(true);
  });

  it("counts the absorbed party's unpaid bill as outstanding, and the floor never shows the table paid", async () => {
    const { venue, mesa4, t } = await mergedParties();

    expect((await floorRow(venue.cfg, mesa4)).visit).toMatchObject({
      id: t.visitId,
      outstanding: "45.00",
    });

    await pay(venue.cfg, t.tabId, "30.00");
    const floor = await floorRow(venue.cfg, mesa4);
    expect(floor.state).toBe("open-tab");
    expect(floor.visit).toMatchObject({ id: t.visitId, outstanding: "15.00" });
  });

  it("refuses Finish while the absorbed party's bill is unpaid, and closes once it is collected", async () => {
    const { venue, t, placedId } = await mergedParties();
    await pay(venue.cfg, t.tabId, "30.00");
    const expectedVisitRevision = await revisionOf(t.visitId);

    const refused = await captureError(() =>
      inTx((tx) =>
        finishTable(tx, {
          visitId: t.visitId,
          expectedVisitRevision,
          operatorId: OPERATOR,
        }),
      ),
    );
    expect(refused).toMatchObject({ code: "visit.bill_outstanding" });

    await collectByHand(placedId);
    expect(
      await inTx((tx) =>
        finishTable(tx, {
          visitId: t.visitId,
          expectedVisitRevision,
          operatorId: OPERATOR,
        }),
      ),
    ).toEqual({ state: "closed" });
  });

  it("follows a chain of merges, and the next party at any of the tables sees none of it", async () => {
    const { venue, mesa4, mesa6, s, t, settledId, placedId } = await mergedParties();
    const mesa8 = await venue.table("Mesa 8");
    const u = await seat(venue.cfg, mesa8);
    await order(venue, u.tabId, "Flan");
    await merge(venue.cfg, u, t);

    expect(await inTx((tx) => visitFamily(tx, u.visitId))).toEqual(
      expect.arrayContaining([u.visitId, t.visitId, s.visitId]),
    );
    expect(await inTx((tx) => visitFamily(tx, u.visitId))).toHaveLength(3);
    const bills = await inTx((tx) => readVisitBills(tx, u.visitId));
    expect(bills.map((b) => b.workingOrderId).sort()).toEqual(
      [s.tabId, settledId, placedId, t.tabId, u.tabId].sort(),
    );
    expect(total(bills)).toBe("50.00");

    await pay(venue.cfg, u.tabId, "35.00");
    expect(
      await captureError(async () => {
        const expectedVisitRevision = await revisionOf(u.visitId);
        return inTx((tx) =>
          finishTable(tx, {
            visitId: u.visitId,
            expectedVisitRevision,
            operatorId: OPERATOR,
          }),
        );
      }),
    ).toMatchObject({ code: "visit.bill_outstanding" });
    await collectByHand(placedId);
    const expectedVisitRevision = await revisionOf(u.visitId);
    await inTx((tx) =>
      finishTable(tx, {
        visitId: u.visitId,
        expectedVisitRevision,
        operatorId: OPERATOR,
      }),
    );

    for (const table of [mesa4, mesa6, mesa8]) {
      const next = await seat(venue.cfg, table);
      const nextBills = await inTx((tx) => readVisitBills(tx, next.visitId));
      expect(nextBills.map((b) => b.workingOrderId)).toEqual([next.tabId]);
    }
  });

  it("gives a visit nothing merged into it as its own family", async () => {
    const { t } = await mergedParties();
    expect(await inTx((tx) => visitFamily(tx, t.visitId))).toHaveLength(2);
    const lone = await inTx(async (tx) => {
      const [row] = await tx.insert(visits).values({ openedBy: OPERATOR }).returning();
      return row!.id;
    });
    expect(await inTx((tx) => visitFamily(tx, lone))).toEqual([lone]);
  });
});

describe("checkAndBumpVisit", () => {
  it("bumps a visit whose revision matches, and returns the new one", async () => {
    const venue = await setupVenue();
    const { visitId } = await seat(venue.cfg, await venue.table("Mesa 4"));
    expect(await inTx((tx) => checkAndBumpVisit(tx, visitId, 0, "open"))).toBe(1);
    expect(await inTx((tx) => checkAndBumpVisit(tx, visitId, 1, "open"))).toBe(2);
    expect(await revisionOf(visitId)).toBe(2);
  });

  it("refuses a stale revision with the current one, and writes nothing", async () => {
    const venue = await setupVenue();
    const { visitId } = await seat(venue.cfg, await venue.table("Mesa 4"));
    await inTx((tx) => checkAndBumpVisit(tx, visitId, 0, "open"));
    expect(
      await captureError(() => inTx((tx) => checkAndBumpVisit(tx, visitId, 0, "open"))),
    ).toMatchObject({ code: "visit.out_of_date", params: { visitId, revision: 1 } });
    expect(
      await captureError(() => inTx((tx) => checkAndBumpVisit(tx, visitId, 2, "open"))),
    ).toMatchObject({ code: "visit.out_of_date" });
    expect(await revisionOf(visitId)).toBe(1);
  });

  it("refuses a visit that does not exist", async () => {
    const unknown = randomUUID();
    expect(
      await captureError(() => inTx((tx) => checkAndBumpVisit(tx, unknown, 0, "open"))),
    ).toMatchObject({ code: "visit.not_open", params: { visitId: unknown } });
  });
});

describe("runServiceCommand", () => {
  async function openVisit(): Promise<string> {
    return inTx(async (tx) => {
      const [row] = await tx.insert(visits).values({ openedBy: OPERATOR }).returning();
      return row!.id;
    });
  }

  function counting<R>(result: R) {
    const calls = { count: 0 };
    return { calls, run: async () => ((calls.count += 1), result) };
  }

  const body = { groupId: "g-1", lineIds: ["a", "b"], expectedVisitRevision: 3 };

  it("runs a new command once and records its result", async () => {
    const visitId = await openVisit();
    const { calls, run } = counting({ fired: 2 });

    const result = await inTx((tx) =>
      runServiceCommand(tx, { kind: "visit", visitId }, "sub-1", "group.fire", body, run),
    );

    expect(result).toEqual({ fired: 2 });
    expect(calls.count).toBe(1);
    const rows = await inTx((tx) => tx.select().from(serviceCommands));
    expect(rows).toEqual([
      expect.objectContaining({
        scopeKind: "visit",
        scopeId: visitId,
        submissionId: "sub-1",
        kind: "group.fire",
        result: { value: { fired: 2 } },
      }),
    ]);
    expect(rows[0]!.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("replays the recorded result for the same id, kind and arguments without running", async () => {
    const visitId = await openVisit();
    const first = counting({ fired: 2 });
    await inTx((tx) =>
      runServiceCommand(tx, { kind: "visit", visitId }, "sub-1", "group.fire", body, first.run),
    );
    const second = counting({ fired: 99 });

    const replay = await inTx((tx) =>
      runServiceCommand(
        tx,
        { kind: "visit", visitId },
        "sub-1",
        "group.fire",
        // The same arguments in another key order, with a re-read revision and the id itself.
        {
          lineIds: ["a", "b"],
          groupId: "g-1",
          expectedVisitRevision: 7,
          draftRevision: 4,
          expectedRevision: 2,
          submissionId: "sub-1",
        },
        second.run,
      ),
    );

    expect(replay).toEqual({ fired: 2 });
    expect(second.calls.count).toBe(0);
    expect(await inTx((tx) => tx.select().from(serviceCommands))).toHaveLength(1);
  });

  it.each([
    ["another body", "group.fire", { ...body, lineIds: ["a"] }],
    ["another path id", "group.fire", { ...body, groupId: "g-2" }],
    ["another kind", "group.reorder", body],
    ["a nested value in another order", "group.fire", { ...body, lineIds: ["b", "a"] }],
  ])("refuses the same id with %s, and runs nothing", async (_, kind, args) => {
    const visitId = await openVisit();
    await inTx((tx) =>
      runServiceCommand(tx, { kind: "visit", visitId }, "sub-1", "group.fire", body, async () => 1),
    );
    const other = counting(2);

    const error = await captureError(() =>
      inTx((tx) =>
        runServiceCommand(tx, { kind: "visit", visitId }, "sub-1", kind, args, other.run),
      ),
    );

    expect(error).toMatchObject({
      code: "submission.id_reused",
      params: { submissionId: "sub-1" },
    });
    expect(other.calls.count).toBe(0);
    expect(await inTx((tx) => tx.select().from(serviceCommands))).toHaveLength(1);
  });

  it("treats the same id in another scope as a separate command", async () => {
    const visitA = await openVisit();
    const visitB = await openVisit();
    const bill = randomUUID();
    const counter = counting("ran");

    for (const scope of [
      { kind: "visit" as const, visitId: visitA },
      { kind: "visit" as const, visitId: visitB },
      { kind: "bill" as const, workingOrderId: bill },
    ]) {
      await inTx((tx) => runServiceCommand(tx, scope, "sub-1", "group.fire", body, counter.run));
    }

    expect(counter.calls.count).toBe(3);
    expect(await inTx((tx) => tx.select().from(serviceCommands))).toHaveLength(3);
  });

  it("canonicalises nested keys, so objects in another key order are the same command", async () => {
    const bill = randomUUID();
    const first = counting("once");
    const scope = { kind: "bill" as const, workingOrderId: bill };
    await inTx((tx) =>
      runServiceCommand(
        tx,
        scope,
        "sub-1",
        "adjust",
        { line: { a: 1, b: [2, { c: 3, d: 4 }] } },
        first.run,
      ),
    );
    const second = counting("twice");
    expect(
      await inTx((tx) =>
        runServiceCommand(
          tx,
          scope,
          "sub-1",
          "adjust",
          { line: { b: [2, { d: 4, c: 3 }], a: 1 } },
          second.run,
        ),
      ),
    ).toBe("once");
    expect(second.calls.count).toBe(0);
  });

  it("reads a missing array entry as null and a missing key as absent, as JSON does", async () => {
    const scope = { kind: "bill" as const, workingOrderId: randomUUID() };
    await inTx((tx) =>
      runServiceCommand(
        tx,
        scope,
        "sub-1",
        "serve",
        { lines: [undefined], note: undefined },
        async () => "once",
      ),
    );
    expect(
      await inTx((tx) =>
        runServiceCommand(tx, scope, "sub-1", "serve", { lines: [null] }, async () => "twice"),
      ),
    ).toBe("once");
  });

  it("replays a command that returned nothing as nothing", async () => {
    const scope = { kind: "bill" as const, workingOrderId: randomUUID() };
    await inTx((tx) => runServiceCommand(tx, scope, "sub-1", "serve", {}, async () => undefined));
    expect(
      await inTx((tx) => runServiceCommand(tx, scope, "sub-1", "serve", {}, async () => "ran")),
    ).toBeUndefined();
  });

  it("refuses a new command on a visit that is not open, and still replays one recorded before", async () => {
    const visitId = await openVisit();
    const scope = { kind: "visit" as const, visitId };
    await inTx((tx) =>
      runServiceCommand(tx, scope, "sub-1", "group.fire", body, async () => "fired"),
    );
    await inTx((tx) =>
      tx
        .update(visits)
        .set({ state: "closed", closedAt: new Date().toISOString() })
        .where(eq(visits.id, visitId)),
    );
    const late = counting("late");

    expect(
      await captureError(() =>
        inTx((tx) => runServiceCommand(tx, scope, "sub-2", "group.fire", body, late.run)),
      ),
    ).toMatchObject({ code: "visit.not_open", params: { visitId } });
    expect(late.calls.count).toBe(0);
    expect(
      await inTx((tx) => runServiceCommand(tx, scope, "sub-1", "group.fire", body, late.run)),
    ).toBe("fired");
  });

  it("records nothing when the command itself fails", async () => {
    const scope = { kind: "bill" as const, workingOrderId: randomUUID() };
    await captureError(() =>
      inTx((tx) =>
        runServiceCommand(tx, scope, "sub-1", "serve", {}, async () => {
          throw new Error("refused");
        }),
      ),
    );
    expect(await inTx((tx) => tx.select().from(serviceCommands))).toHaveLength(0);
  });
});

describe("money received against a bill before its invoice", () => {
  /** A cash contribution of `applied`, with `tip` of the change left as a tip. */
  async function contribute(
    cfg: TillConfig,
    billId: string,
    applied: string,
    tip = "0.00",
  ): Promise<string> {
    const tendered = toScale(sumDecimals([decimal(applied), decimal(tip)]), MONEY_SCALE);
    const result = await takeBillPayment(
      { db: suite.db, backend, clock },
      { ...cfg, tipsEnabled: true },
      billId,
      {
        submissionId: randomUUID(),
        kind: "contribution",
        amount: applied,
        method: "cash",
        tendered,
        addedTip: tip,
        applied,
        tip,
      },
      OPERATOR,
    );
    return result.payment.id;
  }

  /** A completed cash refund of `applied` and `tip` cents, as a refund of the payment leaves it. */
  async function refund(
    cfg: TillConfig,
    paymentId: string,
    applied: number,
    tip: number,
  ): Promise<void> {
    await inTx((tx) =>
      tx.insert(billPaymentRefunds).values({
        billPaymentId: paymentId,
        submissionId: randomUUID(),
        fingerprint: "f",
        appliedAmount: applied,
        tipAmount: tip,
        reason: "error",
        authorizedBy: OPERATOR,
        requestedBy: OPERATOR,
        tillId: cfg.tillId,
        state: "completed",
        completedAt: new Date().toISOString(),
      }),
    );
  }

  it("counts a contribution off what the bill and the party still owe", async () => {
    const venue = await setupVenue();
    const mesa4 = await venue.table("Mesa 4");
    const { visitId, tabId } = await seat(venue.cfg, mesa4, 2);
    await order(venue, tabId, "Burger", "Vino");

    await contribute(venue.cfg, tabId, "20.00");

    expect(await inTx((tx) => readVisitBills(tx, visitId))).toMatchObject([
      { workingOrderId: tabId, total: "42.00", outstanding: "22.00" },
    ]);
    expect((await floorRow(venue.cfg, mesa4)).visit).toMatchObject({ outstanding: "22.00" });
  });

  it("will not abandon an emptied bill that still holds a tip, and finishes once it is given back", async () => {
    const venue = await setupVenue();
    const { visitId, tabId } = await seat(venue.cfg, await venue.table("Mesa 4"));
    await order(venue, tabId, "Vino");
    const paymentId = await contribute(venue.cfg, tabId, "10.00", "5.00");
    await refund(venue.cfg, paymentId, 1000, 0);
    await inTx((tx) => voidTabLine(tx, venue.cfg, tabId, 1));

    const seen = (await visitRow(visitId)).revision;
    const error = await captureError(() =>
      inTx((tx) => finishTable(tx, { visitId, expectedVisitRevision: seen, operatorId: OPERATOR })),
    );

    expect(error).toMatchObject({
      code: "bill.payments_received",
      params: { workingOrderId: tabId },
    });
    expect(await statusOf(tabId)).toBe("open");
    expect((await visitRow(visitId)).state).toBe("open");

    await refund(venue.cfg, paymentId, 0, 500);
    const revision = (await visitRow(visitId)).revision;
    await inTx((tx) =>
      finishTable(tx, { visitId, expectedVisitRevision: revision, operatorId: OPERATOR }),
    );
    expect(await statusOf(tabId)).toBe("abandoned");
  });
});
