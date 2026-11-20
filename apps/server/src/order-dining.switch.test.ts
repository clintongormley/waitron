import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createAdjustmentReason } from "@waitron/adjustments";
import {
  floorZones,
  parties,
  sales,
  withTransaction,
  workingOrders,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { decimal, type Dining, type DiningPolicy } from "@waitron/shared";
import {
  configureZone,
  createDepartment,
  departments,
  setDepartmentSalePolicyField,
  writePartyAllergy,
} from "@waitron/venue-service";
import { offerMenuThroughZone } from "@waitron/venue-service/testing/zone-menus.js";
import { applyAdjustment } from "./adjustments-apply.js";
import { splitTable } from "./table-actions.js";
import { readBillEditState } from "./bill-editing.js";
import type { BillEditExpected } from "./order-drafts.js";
import { seatTable } from "./parties.js";
import { billActionBody, splitBill } from "./testing/bill-action-fixture.js";
import {
  cashPayment,
  inTx,
  partyRevisionOf,
  provisionBillVenue,
  send,
  seatedWith,
  type BillVenue,
} from "./testing/bill-venue.js";
import { saveDraftForTest } from "./testing/draft-command-fixture.js";
import { joinTables } from "./testing/table-action-fixture.js";
import { openGroupedCounterOrder, writeGroupedLines } from "./testing/grouped-counter-order.js";
import { createTable } from "./testing/live-table.js";
import { seedTakeawayProducts } from "./testing/takeaway-menu.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";
import { parkOrder, splitUnitsWithinOrder } from "./working-order.js";

// Staff switch an order between eaten here and takeaway until it is sent or paid, and dishes move
// only between orders sold the same way (A1522). The cola is `reduced` (1000) served here and
// `general` (2100) taken away; the cheese board `reduced` here and `super_reduced` (400) taken away.
let venue: BillVenue;
let counter: ZoneOffers;
let tables: ZoneOffers;
let menu: Awaited<ReturnType<typeof seedTakeawayProducts>>;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    await withTransaction(db, async (tx) => {
      menu = await seedTakeawayProducts(tx);
      counter = await offerProducts(tx, venue.cfg);
      tables = await offerProducts(tx, venue.cfg, { zone: "tables" });
    });
  },
});

async function departmentsSell(dining: DiningPolicy): Promise<void> {
  await inTx(venue, async (tx) => {
    for (const { id } of await tx.select({ id: departments.id }).from(departments)) {
      await setDepartmentSalePolicyField(tx, id, "dining", dining);
      await setDepartmentSalePolicyField(tx, id, "diningStartsAs", "eat_in");
    }
  });
}

beforeEach(() => departmentsSell("till_choice"));

const setDining = (tx: Transaction, orderId: string, dining: Dining) =>
  tx.update(workingOrders).set({ dining }).where(eq(workingOrders.id, orderId));

/** A counter order parked with one of each product, eaten here. */
async function parked(...productIds: string[]): Promise<string> {
  const id = randomUUID();
  await parkOrder({ db: venue.db }, venue.cfg, {
    id,
    lines: productIds.map((productId) => ({
      menuItemId: counter.offerFor(productId),
      quantity: "1",
    })),
    zoneId: counter.zoneId,
    operatorId: venue.operatorId,
  });
  return id;
}

/** A party's bill at a fresh table, its lines written unsent (nothing fired), eaten here. */
async function unsentTab(
  lines: { productId: string; quantity?: string }[],
): Promise<{ partyId: string; tabId: string }> {
  return inTx(venue, async (tx) => {
    const table = await createTable(tx, venue.cfg, {
      label: `T-${randomUUID().slice(0, 8)}`,
      zoneId: tables.zoneId,
    });
    const { partyId, tabId } = await seatTable(tx, venue.cfg, {
      tableId: table.id,
      guestCount: null,
      operatorId: venue.operatorId,
    });
    await writePartyAllergy(tx, partyId, { answer: "none", guests: [] }, venue.operatorId);
    await writeGroupedLines(
      tx,
      venue.cfg,
      tabId,
      lines.map(({ productId, quantity }) => ({
        menuItemId: tables.offerFor(productId),
        quantity: quantity ?? "1",
      })),
    );
    return { partyId, tabId };
  });
}

async function orderOf(id: string): Promise<{ dining: Dining; revision: number }> {
  const [row] = await inTx(venue, (tx) =>
    tx
      .select({ dining: workingOrders.dining, revision: workingOrders.revision })
      .from(workingOrders)
      .where(eq(workingOrders.id, id)),
  );
  return row!;
}

const editOf = (id: string) => inTx(venue, (tx) => readBillEditState(tx, id));

async function switchTo(
  id: string,
  dining: Dining,
  opts: { revision?: number; expectedEdit?: BillEditExpected | null; cookie?: string } = {},
) {
  return send(venue.app, opts.cookie ?? venue.cookie, "PUT", `/api/working-orders/${id}/dining`, {
    dining,
    revision: opts.revision ?? (await orderOf(id)).revision,
    expectedEdit: opts.expectedEdit ?? null,
  });
}

/** Each filed line's rate in basis points, in line order. */
function filedRates(workingOrderId: string): number[] {
  return venue.db
    .all<{ vat_rate: number }>(
      sql`select sl.vat_rate from sale_lines sl
          join sales s on s.id = sl.sale_id
          where s.working_order_id = ${workingOrderId}
          order by s.rowid, sl.line_no`,
    )
    .map((row) => row.vat_rate);
}

function salesOf(workingOrderId: string): number {
  return venue.db.all<{ id: string }>(
    sql`select id from ${sales} where working_order_id = ${workingOrderId}`,
  ).length;
}

/** Each line's two classes, keyed by line number. */
function classesOf(workingOrderId: string) {
  return venue.db.all<{
    id: string;
    line_no: number;
    vat_class: string;
    takeaway_vat_class: string;
  }>(
    sql`select id, line_no, vat_class, takeaway_vat_class from working_order_lines
        where working_order_id = ${workingOrderId} order by line_no`,
  );
}

describe("switching an order's way of selling", () => {
  it("switches a fresh counter order to takeaway and moves its revision on", async () => {
    const id = await parked(menu.cola);
    const before = await orderOf(id);
    expect(before.dining).toBe("eat_in");

    const switched = await switchTo(id, "takeaway");

    expect(switched.status).toBe(200);
    expect(switched.json).toEqual({ revision: before.revision + 1 });
    expect(await orderOf(id)).toEqual({ dining: "takeaway", revision: before.revision + 1 });
  });

  it("refuses an order that does not exist", async () => {
    const id = randomUUID();
    const switched = await switchTo(id, "takeaway", { revision: 0 });
    expect(switched.status).toBe(404);
    expect(switched.json).toEqual({
      code: "working_order.not_found",
      params: { workingOrderId: id },
    });
  });

  it("refuses a stale revision, changing nothing", async () => {
    const id = await parked(menu.cola);
    const before = await orderOf(id);

    const switched = await switchTo(id, "takeaway", { revision: before.revision + 1 });

    expect(switched.status).toBe(409);
    expect(switched.json).toEqual({
      code: "working_order.out_of_date",
      params: { workingOrderId: id, revision: before.revision },
    });
    expect(await orderOf(id)).toEqual(before);
  });

  it("refuses once the order's dishes are sent", async () => {
    const { tabId } = await seatedWith(venue, "Croquettes");
    expect(
      venue.db.all(
        sql`select sent_at from working_order_lines where working_order_id = ${tabId} and sent_at is not null`,
      ),
    ).toHaveLength(1);
    const before = await orderOf(tabId);

    const switched = await switchTo(tabId, "takeaway", { expectedEdit: await editOf(tabId) });

    expect(switched.status).toBe(409);
    expect(switched.json).toEqual({ code: "order.dining_locked", params: { reason: "sent" } });
    expect(await orderOf(tabId)).toEqual(before);
  });

  it("is fixed by the first payment, and the rest is paid and filed at the same rates", async () => {
    const { tabId } = await unsentTab([{ productId: menu.cola }, { productId: menu.cheeseBoard }]);
    const toTakeaway = await switchTo(tabId, "takeaway", { expectedEdit: await editOf(tabId) });
    expect(toTakeaway.status).toBe(200);
    const path = `/api/working-orders/${tabId}/payments`;
    const pay = (lineNo: number, amount: string) =>
      send(venue.app, venue.cookie, "POST", path, {
        submissionId: randomUUID(),
        kind: "items",
        lines: [{ lineNo }],
        method: "cash",
        tendered: amount,
        applied: amount,
        tip: "0.00",
      });
    const first = await pay(1, "1.80");
    expect([first.status, first.json.invoice]).toEqual([200, undefined]);
    const before = await orderOf(tabId);

    const back = await switchTo(tabId, "eat_in", { expectedEdit: await editOf(tabId) });

    expect(back.status).toBe(409);
    expect(back.json).toEqual({ code: "order.dining_locked", params: { reason: "paid" } });
    expect(await orderOf(tabId)).toEqual(before);
    const second = await pay(2, "4.00");
    expect(second.status).toBe(200);
    expect(filedRates(tabId)).toEqual([2100, 400]);
  });

  it("refuses in a department fixed one way", async () => {
    await departmentsSell("eat_in");
    const id = await parked(menu.cola);
    const before = await orderOf(id);

    const switched = await switchTo(id, "takeaway");

    expect(switched.status).toBe(409);
    expect(switched.json).toEqual({ code: "order.dining_fixed", params: { dining: "eat_in" } });
    expect(await orderOf(id)).toEqual(before);
  });

  it("refuses in a region without takeaway VAT, whatever the department says", async () => {
    const id = await parked(menu.cola);
    const before = await orderOf(id);
    const [taxpayer] = venue.db.all<{ country: string }>(sql`select country from taxpayer`);
    venue.db.run(sql`update taxpayer set country = 'GB'`);
    try {
      const switched = await switchTo(id, "takeaway");
      expect(switched.status).toBe(409);
      expect(switched.json).toEqual({
        code: "order.dining_fixed",
        params: { dining: "eat_in" },
      });
    } finally {
      venue.db.run(sql`update taxpayer set country = ${taxpayer!.country}`);
    }
    expect(await orderOf(id)).toEqual(before);
  });

  it("refuses a table bill another waiter is editing", async () => {
    const { partyId, tabId } = await unsentTab([{ productId: menu.cola }]);
    await inTx(venue, (tx) =>
      saveDraftForTest(tx, venue.cfg, partyId, venue.adminId, {
        billId: tabId,
        draftId: null,
        revision: 0,
        lines: [{ menuItemId: tables.offerFor(menu.cheeseBoard), quantity: "1" }],
      }),
    );
    const before = await orderOf(tabId);

    const switched = await switchTo(tabId, "takeaway", { expectedEdit: await editOf(tabId) });

    expect(switched.status).toBe(409);
    expect(switched.json).toMatchObject({ code: "draft.taken_over" });
    expect(await orderOf(tabId)).toEqual(before);
  });

  it("refuses a pay sent by a till that still shows the order eaten here after another switched it", async () => {
    const id = await parked(menu.cola);
    const shown = await send(venue.app, venue.cookie, "GET", `/api/working-orders/${id}`);
    expect(shown.json).toMatchObject({ dining: "eat_in", diningChoice: "open" });
    const beforeSwitch = await editOf(id);
    const switched = await switchTo(id, "takeaway", { cookie: venue.cookie2 });
    expect(switched.status).toBe(200);

    const payment = (expectedEdit: Awaited<ReturnType<typeof editOf>>, dining: Dining) =>
      send(venue.app, venue.cookie, "POST", `/api/working-orders/${id}/payments`, {
        submissionId: randomUUID(),
        expectedEdit,
        dining,
        kind: "share",
        shareOf: 1,
        method: "card",
        entry: "reader",
        applied: "1.80",
        tip: "0.00",
      });
    const paid = await payment(beforeSwitch, "eat_in");

    expect(paid.status).toBe(409);
    expect(paid.json).toEqual({
      code: "working_order.out_of_date",
      params: { workingOrderId: id, revision: (await orderOf(id)).revision },
    });
    expect(salesOf(id)).toBe(0);

    const repaid = await payment(await editOf(id), "takeaway");

    expect(repaid.status).toBe(200);
    expect(salesOf(id)).toBe(1);
    expect(filedRates(id)).toEqual([2100]);
  });

  it("changes nothing, not even the revision, when asked for the way the order already has", async () => {
    const id = await parked(menu.cola);
    const before = await orderOf(id);

    const same = await switchTo(id, "eat_in");

    expect(same.status).toBe(200);
    expect(same.json).toEqual({ revision: before.revision });
    expect(await orderOf(id)).toEqual(before);
  });

  it("answers a request for the way a sent order already has without refusing it", async () => {
    const { tabId } = await seatedWith(venue, "Croquettes");
    const before = await orderOf(tabId);

    const same = await switchTo(tabId, "eat_in", { expectedEdit: await editOf(tabId) });

    expect(same.status).toBe(200);
    expect(same.json).toEqual({ revision: before.revision });
    expect(await orderOf(tabId)).toEqual(before);
  });

  it("decides by the order's own department, as the till's read does, when its zone moves", async () => {
    const id = await parked(menu.cola);
    await withCounterIn("eat_in", async () => {
      const shown = await send(venue.app, venue.cookie, "GET", `/api/working-orders/${id}`);
      expect(shown.json).toMatchObject({ dining: "eat_in", diningChoice: "open" });

      const switched = await switchTo(id, "takeaway");

      expect(switched.status).toBe(200);
      expect((await orderOf(id)).dining).toBe("takeaway");
    });
  });
});

/**
 * Run `body` with the counter zone moved to a new department selling `dining` and offering the
 * counter's menu, then move the zone back.
 */
async function withCounterIn(dining: DiningPolicy, body: () => Promise<void>): Promise<void> {
  const [zone] = await inTx(venue, (tx) =>
    tx
      .select({ departmentId: floorZones.departmentId })
      .from(floorZones)
      .where(eq(floorZones.id, counter.zoneId)),
  );
  const moved = await inTx(venue, (tx) =>
    createDepartment(tx, { name: `Moved ${randomUUID().slice(0, 8)}` }),
  );
  await inTx(venue, (tx) => setDepartmentSalePolicyField(tx, moved.id, "dining", dining));
  await inTx(venue, async (tx) => {
    await configureZone(tx, { zoneId: counter.zoneId, departmentId: moved.id });
    await offerMenuThroughZone(tx, counter.zoneId, counter.menuId);
  });
  try {
    await body();
  } finally {
    await inTx(venue, (tx) =>
      configureZone(tx, { zoneId: counter.zoneId, departmentId: zone!.departmentId! }),
    );
  }
}

describe("moving dishes between a party's bills", () => {
  /** A party whose main bill keeps the cola (line 1) and whose second bill has the cheese board. */
  async function twoBills(): Promise<{ main: string; second: string }> {
    const { partyId, tabId } = await unsentTab([
      { productId: menu.cola },
      { productId: menu.cheeseBoard },
    ]);
    const second = await inTx(venue, async (tx) => {
      const [party] = await tx
        .select({ revision: parties.revision })
        .from(parties)
        .where(eq(parties.id, partyId));
      return (
        await splitBill(tx, venue.cfg, tabId, [{ lineNo: 2 }], {
          expectedPartyRevision: party!.revision,
          operatorId: venue.operatorId,
        })
      ).billId;
    });
    return { main: tabId, second };
  }

  const post = async (path: string, body: Record<string, unknown>) => {
    const expectedPartyRevision = await partyRevisionOf(venue, path.split("/")[3]!);
    return send(
      venue.app,
      venue.cookie,
      "POST",
      path,
      await inTx(venue, (tx) => billActionBody(tx, path, { expectedPartyRevision, ...body })),
    );
  };

  const firstLineId = (billId: string) => classesOf(billId)[0]!.id;

  it("refuses merging a takeaway bill into one eaten here", async () => {
    const { main, second } = await twoBills();
    expect(
      (await switchTo(second, "takeaway", { expectedEdit: await editOf(second) })).status,
    ).toBe(200);

    const merged = await post(`/api/bills/${main}/merge`, { fromBillId: second });

    expect(merged.status).toBe(409);
    expect(merged.json).toEqual({
      code: "order.dining_differs",
      params: { fromOrderId: second, toOrderId: main },
    });
    expect(classesOf(second)).toHaveLength(1);
  });

  it("refuses moving a dish from a bill eaten here to a takeaway one", async () => {
    const { main, second } = await twoBills();
    expect(
      (await switchTo(second, "takeaway", { expectedEdit: await editOf(second) })).status,
    ).toBe(200);

    const moved = await post(`/api/bills/${main}/move-dishes`, {
      toBillId: second,
      lineIds: [firstLineId(main)],
    });

    expect(moved.status).toBe(409);
    expect(moved.json).toEqual({
      code: "order.dining_differs",
      params: { fromOrderId: main, toOrderId: second },
    });
    expect(classesOf(main)).toHaveLength(1);
  });

  it("moves and merges between two takeaway bills, each line keeping both its classes", async () => {
    const { main, second } = await twoBills();
    for (const bill of [main, second]) {
      expect((await switchTo(bill, "takeaway", { expectedEdit: await editOf(bill) })).status).toBe(
        200,
      );
    }
    const [cola] = classesOf(main);

    const moved = await post(`/api/bills/${main}/move-dishes`, {
      toBillId: second,
      lineIds: [cola!.id],
    });
    expect(moved.status).toBe(200);
    const merged = await post(`/api/bills/${main}/merge`, { fromBillId: second });
    expect(merged.status).toBe(204);

    expect(
      classesOf(main).map(({ id, vat_class, takeaway_vat_class }) => ({
        id,
        vat_class,
        takeaway_vat_class,
      })),
    ).toEqual(
      expect.arrayContaining([
        { id: cola!.id, vat_class: "reduced", takeaway_vat_class: "general" },
        expect.objectContaining({ vat_class: "reduced", takeaway_vat_class: "super_reduced" }),
      ]),
    );
  });
});

describe("splitting a table with loose dishes", () => {
  /** A party seated at a fresh table in the tables zone, its bill holding a cola and a cheese
   * board unsent, joined to a second fresh table. */
  async function joinedParty(): Promise<{ partyId: string; tabId: string; second: string }> {
    const { partyId, tabId } = await unsentTab([
      { productId: menu.cola },
      { productId: menu.cheeseBoard },
    ]);
    const second = await inTx(venue, async (tx) => {
      const table = await createTable(tx, venue.cfg, {
        label: `T-${randomUUID().slice(0, 8)}`,
        zoneId: tables.zoneId,
      });
      await joinTables(tx, venue.cfg, partyId, table.id, {
        expectedPartyRevision: await partyRevision(tx, partyId),
        operatorId: venue.operatorId,
      });
      return table.id;
    });
    return { partyId, tabId, second };
  }

  async function partyRevision(tx: Transaction, partyId: string): Promise<number> {
    const [party] = await tx
      .select({ revision: parties.revision })
      .from(parties)
      .where(eq(parties.id, partyId));
    return party!.revision;
  }

  async function splitLoose(
    partyId: string,
    tableId: string,
    loose: { billId: string; lineIds: string[] }[],
  ) {
    return inTx(venue, async (tx) => {
      const expectedEdits = [];
      for (const billId of [...new Set(loose.map((entry) => entry.billId))].sort())
        expectedEdits.push(await readBillEditState(tx, billId));
      return splitTable(
        tx,
        venue.cfg,
        partyId,
        tableId,
        { wholeBillIds: [], loose },
        {
          expectedPartyRevision: await partyRevision(tx, partyId),
          operatorId: venue.operatorId,
          expectedEdits,
        },
      );
    });
  }

  it("puts a takeaway bill's loose dishes on a new takeaway bill, filed at the takeaway rate", async () => {
    const { partyId, tabId, second } = await joinedParty();
    expect((await switchTo(tabId, "takeaway", { expectedEdit: await editOf(tabId) })).status).toBe(
      200,
    );
    const [cola] = classesOf(tabId);

    const result = await splitLoose(partyId, second, [{ billId: tabId, lineIds: [cola!.id] }]);

    const newBill = result.billIds[0]!;
    expect((await orderOf(newBill)).dining).toBe("takeaway");
    expect(classesOf(newBill).map((row) => row.id)).toEqual([cola!.id]);
    const paid = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${newBill}/payments`,
      {
        submissionId: randomUUID(),
        kind: "items",
        lines: [{ lineNo: classesOf(newBill)[0]!.line_no }],
        method: "cash",
        tendered: "1.80",
        applied: "1.80",
        tip: "0.00",
      },
    );
    expect(paid.status).toBe(200);
    expect(filedRates(newBill)).toEqual([2100]);
  });

  it("refuses loose dishes from two bills sold different ways, moving nothing", async () => {
    const { partyId, tabId, second } = await joinedParty();
    const eatenHere = await inTx(
      venue,
      async (tx) =>
        (
          await splitBill(tx, venue.cfg, tabId, [{ lineNo: 2 }], {
            expectedPartyRevision: await partyRevision(tx, partyId),
            operatorId: venue.operatorId,
          })
        ).billId,
    );
    expect((await switchTo(tabId, "takeaway", { expectedEdit: await editOf(tabId) })).status).toBe(
      200,
    );
    const before = [classesOf(tabId), classesOf(eatenHere)];

    await expect(
      splitLoose(partyId, second, [
        { billId: tabId, lineIds: [classesOf(tabId)[0]!.id] },
        { billId: eatenHere, lineIds: [classesOf(eatenHere)[0]!.id] },
      ]),
    ).rejects.toMatchObject({
      code: "order.dining_differs",
      params: { fromOrderId: eatenHere },
    });
    expect([classesOf(tabId), classesOf(eatenHere)]).toEqual(before);
  });
});

describe("the part of a line cut off within its order", () => {
  /** A takeaway counter order holding three colas on one line. */
  async function threeColas(): Promise<string> {
    const id = randomUUID();
    await inTx(venue, async (tx) => {
      await openGroupedCounterOrder(tx, venue.cfg, id, [], { zoneId: counter.zoneId });
      await setDining(tx, id, "takeaway");
      await writeGroupedLines(tx, venue.cfg, id, [
        { menuItemId: counter.offerFor(menu.cola), quantity: "3" },
      ]);
    });
    expect(classesOf(id)).toHaveLength(1);
    return id;
  }

  async function payWhole(id: string): Promise<void> {
    const sold = await cashPayment(venue, venue.cookie, id, "10.00");
    expect(sold.status).toBe(200);
  }

  function expectEveryRowLikeItsSource(id: string, sourceId: string): void {
    const rows = classesOf(id);
    expect(rows.length).toBeGreaterThan(1);
    const source = rows.find((row) => row.id === sourceId)!;
    for (const row of rows) {
      expect([row.vat_class, row.takeaway_vat_class]).toEqual([
        source.vat_class,
        source.takeaway_vat_class,
      ]);
    }
    expect(source.takeaway_vat_class).toBe("general");
  }

  it("keeps the takeaway class on a discounted cola", async () => {
    const id = await threeColas();
    const [source] = classesOf(id);
    const { revision } = await orderOf(id);
    await inTx(venue, async (tx) => {
      const reason = await createAdjustmentReason(tx, {
        name: `Loyalty ${randomUUID()}`,
        names: { en: "Loyalty", es: "Fidelidad" },
        kind: "comp",
        actions: ["discount_amount"],
        maxPercentBp: null,
        maxAmount: null,
        noteRequired: false,
      });
      await applyAdjustment(
        tx,
        venue.cfg,
        {
          admission: testTradingAdmission(),
          expectedEdit: null,
          orderId: id,
          submissionId: randomUUID(),
          expectedRevision: revision,
          lineId: source!.id,
          reasonId: reason.id,
          action: "discount_amount",
          quantity: "1",
          amount: decimal("0.10"),
          note: null,
          operatorId: venue.adminId,
        },
        venue.cfg.locale,
      );
    });
    expectEveryRowLikeItsSource(id, source!.id);

    await payWhole(id);

    expect(filedRates(id).every((rate) => rate === 2100)).toBe(true);
    expect(filedRates(id).length).toBeGreaterThan(1);
  });

  it("keeps the takeaway class on a cola split into single units", async () => {
    const id = await threeColas();
    const [source] = classesOf(id);
    await inTx(venue, (tx) => splitUnitsWithinOrder(tx, venue.cfg, id, 1));
    expectEveryRowLikeItsSource(id, source!.id);

    await payWhole(id);

    expect(filedRates(id).every((rate) => rate === 2100)).toBe(true);
    expect(filedRates(id).length).toBeGreaterThan(1);
  });
});
