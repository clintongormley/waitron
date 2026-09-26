import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
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
  captureError,
  diningTables,
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
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import { deploymentEnvironment } from "./config.js";
import { ALL_MODULES } from "./modules.js";
import type { TillConfig } from "./till-config.js";
import { createTable } from "./tables.js";
import { addTabRound, openTab, splitOffCheck } from "./working-order.js";
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
  visitForTable,
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

/**
 * A second table joined to the party as `joinTable` will make it one (plan Task 2b): a membership
 * of the visit and the table pointing at the visit's tab.
 */
async function joinByHand(visitId: string, tabId: string, tableId: string): Promise<void> {
  await inTx(async (tx) => {
    await tx.insert(visitTables).values({ visitId, tableId });
    await tx.update(diningTables).set({ tabId }).where(eq(diningTables.id, tableId));
  });
}

/** Puts a bill on a visit, as `splitOffCheck` will for a check (plan Task 2b). */
async function onVisit(orderId: string, visitId: string): Promise<void> {
  await inTx((tx) =>
    tx.update(workingOrders).set({ visitId }).where(eq(workingOrders.id, orderId)),
  );
}

/**
 * Merges visit `from` into `into` as `mergeTabs` will (plan Task 2b, D2): `from` closes with
 * `merged_into_visit_id`, and its memberships end.
 */
async function mergeByHand(from: string, into: string): Promise<void> {
  await inTx(async (tx) => {
    const now = new Date().toISOString();
    await tx.update(visitTables).set({ leftAt: now }).where(eq(visitTables.visitId, from));
    await tx
      .update(visits)
      .set({ state: "closed", closedAt: now, mergedIntoVisitId: into })
      .where(eq(visits.id, from));
  });
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
  const cents = bills.reduce((sum, bill) => sum + Math.round(Number(bill.outstanding) * 100), 0);
  return (cents / 100).toFixed(2);
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
    const { checkId } = await inTx((tx) => splitOffCheck(tx, venue.cfg, tabId, [{ lineNo: 2 }]));
    await onVisit(checkId, visitId);

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
    const { checkId } = await inTx((tx) => splitOffCheck(tx, venue.cfg, tabId, [{ lineNo: 2 }]));
    await onVisit(checkId, visitId);
    await pay(venue.cfg, tabId, "14.00");

    const error = await captureError(() =>
      inTx((tx) =>
        finishTable(tx, venue.cfg, { visitId, expectedVisitRevision: 0, operatorId: OPERATOR }),
      ),
    );

    expect(error).toMatchObject({ code: "visit.bill_outstanding", params: { visitId } });
    expect(await visitRow(visitId)).toMatchObject({ state: "open", revision: 0, closedAt: null });
    expect((await membershipsOf(visitId))[0]!.leftAt).toBeNull();
    expect(await statusOf(checkId)).toBe("open");
  });

  it("closes the visit and its membership, frees the table and clears its status once everything is paid", async () => {
    const venue = await setupVenue();
    const mesa4 = await venue.table("Mesa 4");
    const { visitId, tabId } = await seat(venue.cfg, mesa4, 2);
    await order(venue, tabId, "Burger", "Vino", "Agua");
    const { checkId } = await inTx((tx) => splitOffCheck(tx, venue.cfg, tabId, [{ lineNo: 2 }]));
    await onVisit(checkId, visitId);
    await pay(venue.cfg, tabId, "14.00");
    await pay(venue.cfg, checkId, "30.00");
    await giveStatus([mesa4]);

    const result = await inTx((tx) =>
      finishTable(tx, venue.cfg, { visitId, expectedVisitRevision: 0, operatorId: OPERATOR }),
    );

    expect(result).toEqual({ state: "closed" });
    const closed = await visitRow(visitId);
    expect(closed).toMatchObject({ state: "closed", closedBy: OPERATOR, revision: 1 });
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
        finishTable(tx, venue.cfg, { visitId, expectedVisitRevision: 0, operatorId: OPERATOR }),
      ),
    ).toEqual({ state: "closed" });
    expect(await statusOf(tabId)).toBe("abandoned");
  });

  it("is refused with a stale visit revision, and changes nothing", async () => {
    const venue = await setupVenue();
    const { visitId } = await seat(venue.cfg, await venue.table("Mesa 4"));
    await inTx((tx) => checkAndBumpVisit(tx, visitId, 0));

    const error = await captureError(() =>
      inTx((tx) =>
        finishTable(tx, venue.cfg, { visitId, expectedVisitRevision: 0, operatorId: OPERATOR }),
      ),
    );

    expect(error).toMatchObject({ code: "visit.out_of_date", params: { visitId, revision: 1 } });
    expect(await visitRow(visitId)).toMatchObject({ state: "open", revision: 1 });
  });

  it("is refused for a visit that is not open, or does not exist", async () => {
    const venue = await setupVenue();
    const { visitId } = await seat(venue.cfg, await venue.table("Mesa 4"));
    await inTx((tx) =>
      finishTable(tx, venue.cfg, { visitId, expectedVisitRevision: 0, operatorId: OPERATOR }),
    );

    const again = await captureError(() =>
      inTx((tx) =>
        finishTable(tx, venue.cfg, { visitId, expectedVisitRevision: 1, operatorId: OPERATOR }),
      ),
    );
    expect(again).toMatchObject({ code: "visit.not_open", params: { visitId } });
    const unknown = randomUUID();
    const absent = await captureError(() =>
      inTx((tx) =>
        finishTable(tx, venue.cfg, {
          visitId: unknown,
          expectedVisitRevision: 0,
          operatorId: OPERATOR,
        }),
      ),
    );
    expect(absent).toMatchObject({ code: "visit.not_open", params: { visitId: unknown } });
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
        finishTable(tx, venue.cfg, { visitId, expectedVisitRevision: 0, operatorId: OPERATOR }),
      ),
    ).toEqual({ state: "closed" });
  });

  it("frees every table of a joined party and clears each one's status", async () => {
    const venue = await setupVenue();
    const mesa4 = await venue.table("Mesa 4");
    const mesa5 = await venue.table("Mesa 5");
    const { visitId, tabId } = await seat(venue.cfg, mesa4);
    await joinByHand(visitId, tabId, mesa5);
    await giveStatus([mesa4, mesa5]);

    await inTx((tx) =>
      finishTable(tx, venue.cfg, { visitId, expectedVisitRevision: 0, operatorId: OPERATOR }),
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
    await joinByHand(visitId, tabId, mesa5);
    await giveStatus([mesa4, mesa5]);

    const result = await inTx((tx) =>
      finishTable(tx, venue.cfg, { visitId, expectedVisitRevision: 0, operatorId: OPERATOR }),
    );

    expect(result).toEqual({ state: "needs_clearing" });
    expect(await visitRow(visitId)).toMatchObject({ state: "needs_clearing", revision: 1 });
    for (const table of [mesa4, mesa5]) {
      expect((await tableRow(table)).statusId).toBeNull();
      expect(await inTx((tx) => visitForTable(tx, table))).toEqual({ visitId, revision: 1 });
      expect(await captureError(() => seat(venue.cfg, table))).toMatchObject({
        code: "tab.already_open",
      });
    }

    await inTx((tx) => markCleared(tx, venue.cfg, { visitId, expectedVisitRevision: 1 }));

    expect(await visitRow(visitId)).toMatchObject({ state: "closed", revision: 2 });
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
      finishTable(tx, venue.cfg, { visitId, expectedVisitRevision: 0, operatorId: OPERATOR }),
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
        finishTable(tx, venue.cfg, { visitId, expectedVisitRevision: 0, operatorId: OPERATOR }),
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
        inTx((tx) => markCleared(tx, venue.cfg, { visitId, expectedVisitRevision: 0 })),
      ),
    ).toMatchObject({ code: "visit.not_open", params: { visitId } });

    await inTx((tx) =>
      finishTable(tx, venue.cfg, { visitId, expectedVisitRevision: 0, operatorId: OPERATOR }),
    );
    expect(
      await captureError(() =>
        inTx((tx) => markCleared(tx, venue.cfg, { visitId, expectedVisitRevision: 0 })),
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
      finishTable(tx, venue.cfg, {
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

describe("merged parties keep their bills", () => {
  /**
   * Mesa 6 (visit S) has a settled €20.00 bill and a placed, unpaid €15.00 one; Mesa 4 (visit T) has
   * an open €30.00 tab. S is merged into T.
   */
  async function mergedParties() {
    const venue = await setupVenue();
    const mesa4 = await venue.table("Mesa 4");
    const mesa6 = await venue.table("Mesa 6");
    const s = await seat(venue.cfg, mesa6);
    await order(venue, s.tabId, "Paella", "Tarta");
    const { checkId: placedId } = await inTx((tx) =>
      splitOffCheck(tx, venue.cfg, s.tabId, [{ lineNo: 2 }]),
    );
    await onVisit(placedId, s.visitId);
    await pay(venue.cfg, s.tabId, "20.00");
    await placeByHand(placedId);
    const t = await seat(venue.cfg, mesa4);
    await order(venue, t.tabId, "Vino");
    await mergeByHand(s.visitId, t.visitId);
    return { venue, mesa4, mesa6, s, t, settledId: s.tabId, placedId };
  }

  it("lists the absorbed party's bills with the surviving visit's, and counts the unpaid one", async () => {
    const { t, s, settledId, placedId } = await mergedParties();

    const bills = await inTx((tx) => readVisitBills(tx, t.visitId));

    expect(
      bills.map((b) => [b.workingOrderId, b.visitId, b.status, b.total, b.outstanding]),
    ).toEqual([
      [settledId, s.visitId, "settled", "20.00", "0.00"],
      [placedId, s.visitId, "placed", "15.00", "15.00"],
      [t.tabId, t.visitId, "open", "30.00", "30.00"],
    ]);
    expect(bills.find((b) => b.workingOrderId === settledId)!.receiptAvailable).toBe(true);
    expect(total(bills)).toBe("45.00");
  });

  it("refuses Finish while the absorbed party's bill is unpaid, and closes once it is collected", async () => {
    const { venue, t, placedId } = await mergedParties();
    await pay(venue.cfg, t.tabId, "30.00");

    const refused = await captureError(() =>
      inTx((tx) =>
        finishTable(tx, venue.cfg, {
          visitId: t.visitId,
          expectedVisitRevision: 0,
          operatorId: OPERATOR,
        }),
      ),
    );
    expect(refused).toMatchObject({ code: "visit.bill_outstanding" });

    await collectByHand(placedId);
    expect(
      await inTx((tx) =>
        finishTable(tx, venue.cfg, {
          visitId: t.visitId,
          expectedVisitRevision: 0,
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
    await mergeByHand(t.visitId, u.visitId);

    expect(await inTx((tx) => visitFamily(tx, u.visitId))).toEqual(
      expect.arrayContaining([u.visitId, t.visitId, s.visitId]),
    );
    expect(await inTx((tx) => visitFamily(tx, u.visitId))).toHaveLength(3);
    const bills = await inTx((tx) => readVisitBills(tx, u.visitId));
    expect(bills.map((b) => b.workingOrderId).sort()).toEqual(
      [settledId, placedId, t.tabId, u.tabId].sort(),
    );
    expect(total(bills)).toBe("50.00");

    await pay(venue.cfg, u.tabId, "5.00");
    await pay(venue.cfg, t.tabId, "30.00");
    expect(
      await captureError(() =>
        inTx((tx) =>
          finishTable(tx, venue.cfg, {
            visitId: u.visitId,
            expectedVisitRevision: 0,
            operatorId: OPERATOR,
          }),
        ),
      ),
    ).toMatchObject({ code: "visit.bill_outstanding" });
    await collectByHand(placedId);
    await inTx((tx) =>
      finishTable(tx, venue.cfg, {
        visitId: u.visitId,
        expectedVisitRevision: 0,
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
    expect(await inTx((tx) => checkAndBumpVisit(tx, visitId, 0))).toBe(1);
    expect(await inTx((tx) => checkAndBumpVisit(tx, visitId, 1))).toBe(2);
    expect(await revisionOf(visitId)).toBe(2);
  });

  it("refuses a stale revision with the current one, and writes nothing", async () => {
    const venue = await setupVenue();
    const { visitId } = await seat(venue.cfg, await venue.table("Mesa 4"));
    await inTx((tx) => checkAndBumpVisit(tx, visitId, 0));
    expect(await captureError(() => inTx((tx) => checkAndBumpVisit(tx, visitId, 0)))).toMatchObject(
      { code: "visit.out_of_date", params: { visitId, revision: 1 } },
    );
    expect(await captureError(() => inTx((tx) => checkAndBumpVisit(tx, visitId, 2)))).toMatchObject(
      { code: "visit.out_of_date" },
    );
    expect(await revisionOf(visitId)).toBe(1);
  });

  it("refuses a visit that does not exist", async () => {
    const unknown = randomUUID();
    expect(await captureError(() => inTx((tx) => checkAndBumpVisit(tx, unknown, 0)))).toMatchObject(
      { code: "visit.not_open", params: { visitId: unknown } },
    );
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
