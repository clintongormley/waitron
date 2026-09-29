import { randomUUID } from "node:crypto";
import { asc, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { listAvailableProducts } from "@waitron/catalogue";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  billPayments,
  captureError,
  printJobs,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { loginWithPin } from "@waitron/identity";
import { createPrinter } from "@waitron/printing";
import { mergeBills, requireUntouched, splitBill, transferItems } from "./bill-actions.js";
import { takeBillPayment } from "./bill-payments.js";
import { placeGroups } from "./order-groups.js";
import { refundBillPayment } from "./bill-refunds.js";
import { attachPrinterToStation } from "./station-printers.js";
import { printedLines } from "./testing/decode-ticket.js";
import { mergeTabs, moveTab, parkOrder } from "./working-order.js";
import {
  OPERATOR,
  activeTablesOf,
  billRow,
  commandFor,
  inTx,
  linesOf,
  nameParty,
  order,
  orderForParty,
  partyRow,
  pay,
  placeByHand,
  revisionOf,
  seat,
  setupPartyVenue,
  tableRow,
  type PartyVenue,
} from "./testing/party-venue.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";
import "./errors.js";

// Split, merge and transfer between a party's bills (table actions plan, Task 5; spec §7, §9, §15).
// `resetPerTest: false`: the venue is provisioned once in `setup`, and each case seats its own tables.
let v: PartyVenue;
let counter: ZoneOffers;
let productIds: Map<string, string>;
let adminId: string;
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    v = await setupPartyVenue(db);
    const made = await inTx(v, async (tx) => ({
      counter: await offerProducts(tx, v.cfg, { zone: "counter" }),
      products: (await listAvailableProducts(tx, v.cfg.locationId)).products,
    }));
    counter = made.counter;
    productIds = new Map(made.products.map((p) => [p.name, p.id]));
    // Agua is handed over at the bar, so a held Agua has no kitchen ticket at all: only its group
    // says it is held.
    db.run(sql`
      update preparation_routes set station_id = null, no_preparation = 1
      where product_id = ${productIds.get("Agua")!}`);
    const [admin] = db.all<{ id: string }>(sql`select id from persons where role = 'admin'`);
    adminId = admin!.id;
  },
});

async function splitOff(partyId: string, billId: string, lineNos: number[]): Promise<string> {
  const command = await commandFor(v, partyId);
  const { billId: made } = await inTx(v, (tx) =>
    splitBill(
      tx,
      v.cfg,
      billId,
      lineNos.map((lineNo) => ({ lineNo })),
      command,
    ),
  );
  return made;
}

async function merge(partyId: string, intoBillId: string, fromBillId: string): Promise<void> {
  const command = await commandFor(v, partyId);
  await inTx(v, (tx) => mergeBills(tx, v.cfg, intoBillId, fromBillId, command));
}

async function transfer(
  partyId: string,
  fromBillId: string,
  toBillId: string,
  lineNos: number[],
): Promise<void> {
  const command = await commandFor(v, partyId);
  await inTx(v, (tx) =>
    transferItems(
      tx,
      v.cfg,
      fromBillId,
      toBillId,
      lineNos.map((lineNo) => ({ lineNo })),
      command,
    ),
  );
}

/** Every stored column of the bill's lines, in line order. */
async function lineRows(billId: string) {
  return inTx(v, (tx) =>
    tx
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, billId))
      .orderBy(asc(workingOrderLines.lineNo)),
  );
}

async function paymentsOf(billId: string) {
  return inTx(v, (tx) =>
    tx
      .select()
      .from(billPayments)
      .where(eq(billPayments.workingOrderId, billId))
      .orderBy(asc(billPayments.createdAt)),
  );
}

/** The party, its tables and each bill's row, lines and payments: what an action may change. */
async function snapshot(partyId: string, billIds: string[]) {
  const bills = [];
  for (const id of billIds) {
    bills.push({
      row: await billRow(v, id),
      lines: await lineRows(id),
      payments: await paymentsOf(id),
    });
  }
  return { party: await partyRow(v, partyId), tables: await activeTablesOf(v, partyId), bills };
}

/** A cash contribution of `amount` towards the bill: the bill is then partly paid. */
async function contribute(billId: string, amount: string): Promise<string> {
  const result = await takeBillPayment(
    { db: v.db, backend: v.backend, clock: v.clock },
    v.cfg,
    billId,
    {
      submissionId: randomUUID(),
      kind: "contribution",
      amount,
      method: "cash",
      tendered: amount,
      applied: amount,
      tip: "0.00",
    },
    OPERATOR,
  );
  return result.payment.id;
}

/** A party at a fresh table whose main bill holds a Burger and whose second bill holds a Vino. */
async function twoBills(label: string): Promise<{ partyId: string; main: string; second: string }> {
  const { partyId, tabId } = await seat(v, await v.table(label));
  await orderForParty(v, partyId, ["Burger", "Vino"]);
  const second = await splitOff(partyId, tabId, [2]);
  return { partyId, main: tabId, second };
}

type Touch = "presented" | "partly paid" | "paid";

const TOUCHED_CODE: Record<Touch, string> = {
  presented: "bill.presented",
  "partly paid": "bill.payments_received",
  paid: "bill.paid",
};

/** Present, partly pay or pay the bill; `total` is what it owes. */
async function touch(billId: string, how: Touch, total: string): Promise<void> {
  if (how === "presented") await placeByHand(v, billId);
  else if (how === "partly paid") await contribute(billId, "5.00");
  else await pay(v, billId, total);
}

/** An open counter order of no party, from the counter zone's offers. */
async function counterOrder(...names: string[]): Promise<string> {
  const id = randomUUID();
  await parkOrder({ db: v.db }, v.cfg, {
    id,
    zoneId: counter.zoneId,
    lines: names.map((name) => ({
      menuItemId: counter.offerFor(productIds.get(name)!),
      quantity: "1",
    })),
  });
  return id;
}

describe("split a bill", () => {
  it("puts the chosen items on a new bill of the same party, from a bill no table points at", async () => {
    const mesa4 = await v.table("Mesa 4");
    const { partyId, tabId } = await seat(v, mesa4);
    await order(v, tabId, "Burger", "Vino", "Agua");
    const first = await splitOff(partyId, tabId, [2, 3]);

    const second = await splitOff(partyId, first, [2]);

    expect((await billRow(v, second)).partyId).toBe(partyId);
    expect((await linesOf(v, first)).map((l) => l.name)).toEqual(["Vino"]);
    expect(
      (await linesOf(v, second)).map((l) => ({
        name: l.name,
        price: l.unitPriceGross,
        vat: l.vatClass,
      })),
    ).toEqual([{ name: "Agua", price: 200, vat: "general" }]);
    expect((await partyRow(v, partyId)).mainBillId).toBe(tabId);
    expect(await activeTablesOf(v, partyId)).toEqual([mesa4]);
  });

  it("refuses a presented bill, changing nothing", async () => {
    const { partyId, tabId } = await seat(v, await v.table("Mesa 5"));
    await order(v, tabId, "Burger", "Vino");
    const checkId = await splitOff(partyId, tabId, [2]);
    await placeByHand(v, checkId);
    const before = await snapshot(partyId, [tabId, checkId]);

    const error = await captureError(() => splitOff(partyId, checkId, [1]));

    expect(error).toMatchObject({ code: "bill.presented", params: { workingOrderId: checkId } });
    expect(await snapshot(partyId, [tabId, checkId])).toEqual(before);
  });

  it("keeps an item already paid for where it is", async () => {
    const { partyId, tabId } = await seat(v, await v.table("Mesa 6"));
    await order(v, tabId, "Burger", "Vino");
    await takeBillPayment(
      { db: v.db, backend: v.backend, clock: v.clock },
      v.cfg,
      tabId,
      {
        submissionId: randomUUID(),
        kind: "items",
        lines: [{ lineNo: 1 }],
        method: "cash",
        tendered: "12.00",
        applied: "12.00",
        tip: "0.00",
      },
      OPERATOR,
    );
    const before = await snapshot(partyId, [tabId]);

    const error = await captureError(() => splitOff(partyId, tabId, [1]));

    expect(error).toMatchObject({
      code: "bill.line_paid",
      params: { workingOrderId: tabId, lineNo: 1 },
    });
    expect(await snapshot(partyId, [tabId])).toEqual(before);
  });

  it("splits the unpaid items off a partly paid bill, leaving its payment where it is", async () => {
    const { partyId, tabId } = await seat(v, await v.table("Mesa 6b"));
    await order(v, tabId, "Burger", "Vino");
    await contribute(tabId, "5.00");

    const made = await splitOff(partyId, tabId, [2]);

    expect((await linesOf(v, made)).map((l) => l.name)).toEqual(["Vino"]);
    expect((await paymentsOf(tabId)).map((p) => p.applied)).toEqual([500]);
    expect(await paymentsOf(made)).toEqual([]);
  });

  it("refuses a split leaving less on the bill than it has received, changing nothing", async () => {
    const { partyId, tabId } = await seat(v, await v.table("Mesa 6c"));
    await order(v, tabId, "Burger", "Vino");
    await contribute(tabId, "20.00");
    const before = await snapshot(partyId, [tabId]);
    const billsBefore = v.db.all(sql`select id from working_orders order by id`);

    // The Burger (12.00) left behind is less than the 20.00 received.
    const error = await captureError(() => splitOff(partyId, tabId, [2]));

    expect(error).toMatchObject({
      code: "bill.received_exceeds_total",
      params: { workingOrderId: tabId },
    });
    expect(await snapshot(partyId, [tabId])).toEqual(before);
    expect(v.db.all(sql`select id from working_orders order by id`)).toEqual(billsBefore);
  });

  it("refuses a dish held for the kitchen, changing nothing", async () => {
    const { partyId, tabId } = await seat(v, await v.table("Mesa 7"));
    await inTx(v, (tx) =>
      orderGroups(tx, partyId, [
        { names: ["Burger"], release: "fire" },
        { names: ["Flan"], release: "hold" },
      ]),
    );
    const before = await snapshot(partyId, [tabId]);

    const error = await captureError(() => splitOff(partyId, tabId, [2]));

    expect(error).toMatchObject({
      code: "tab.split_held_line",
      params: { tabId, lineNo: 2 },
    });
    expect(await snapshot(partyId, [tabId])).toEqual(before);
  });

  it("refuses a dish in a held group that the kitchen has no ticket for, changing nothing", async () => {
    const { partyId, tabId } = await seat(v, await v.table("Mesa 8"));
    await inTx(v, (tx) =>
      orderGroups(tx, partyId, [
        { names: ["Burger"], release: "fire" },
        { names: ["Agua"], release: "hold" },
      ]),
    );
    const before = await snapshot(partyId, [tabId]);

    const error = await captureError(() => splitOff(partyId, tabId, [2]));

    expect(error).toMatchObject({
      code: "tab.split_held_line",
      params: { tabId, lineNo: 2 },
    });
    expect(await snapshot(partyId, [tabId])).toEqual(before);
  });

  it("refuses a paid bill, changing nothing", async () => {
    const { partyId, tabId } = await seat(v, await v.table("Mesa 9"));
    await order(v, tabId, "Burger");
    await pay(v, tabId, "12.00");
    const before = await snapshot(partyId, [tabId]);

    const error = await captureError(() => splitOff(partyId, tabId, [1]));

    expect(error).toMatchObject({ code: "bill.paid", params: { workingOrderId: tabId } });
    expect(await snapshot(partyId, [tabId])).toEqual(before);
  });

  it("refuses an empty batch, changing nothing", async () => {
    const { partyId, tabId } = await seat(v, await v.table("Mesa 10"));
    await order(v, tabId, "Burger");
    const before = await snapshot(partyId, [tabId]);

    const error = await captureError(() => splitOff(partyId, tabId, []));

    expect(error).toMatchObject({ code: "sale.empty_basket" });
    expect(await snapshot(partyId, [tabId])).toEqual(before);
  });

  it("refuses a stale party revision, changing nothing", async () => {
    const { partyId, tabId } = await seat(v, await v.table("Mesa 11"));
    await order(v, tabId, "Burger", "Vino");
    const stale = await commandFor(v, partyId);
    await nameParty(v, partyId, "Ana");
    const before = await snapshot(partyId, [tabId]);

    const error = await captureError(() =>
      inTx(v, (tx) => splitBill(tx, v.cfg, tabId, [{ lineNo: 2 }], stale)),
    );

    expect(error).toMatchObject({
      code: "party.out_of_date",
      params: { partyId, revision: stale.expectedPartyRevision + 1 },
    });
    expect(await snapshot(partyId, [tabId])).toEqual(before);
  });

  it("refuses a bill merged away, or one that does not exist, as not open", async () => {
    const { partyId, main, second } = await twoBills("Mesa 12");
    await merge(partyId, main, second);
    const missing = randomUUID();
    const before = await snapshot(partyId, [main, second]);

    const mergedAway = await captureError(() => splitOff(partyId, second, [1]));
    const absent = await captureError(() => splitOff(partyId, missing, [1]));

    expect(mergedAway).toMatchObject({ code: "tab.not_open", params: { tabId: second } });
    expect(absent).toMatchObject({ code: "tab.not_open", params: { tabId: missing } });
    expect(await snapshot(partyId, [main, second])).toEqual(before);
  });

  it("refuses a request naming a party that does not exist as not open", async () => {
    const { partyId, main } = await twoBills("Mesa 13");
    const read = await commandFor(v, partyId);
    const unknown = randomUUID();
    const before = await snapshot(partyId, [main]);

    const error = await captureError(() =>
      inTx(v, (tx) => splitBill(tx, v.cfg, main, [{ lineNo: 1 }], { ...read, partyId: unknown })),
    );

    expect(error).toMatchObject({ code: "party.not_open", params: { partyId: unknown } });
    expect(await snapshot(partyId, [main])).toEqual(before);
  });

  it("splits a counter order onto a new counter order of no party", async () => {
    const orderId = await counterOrder("Burger", "Vino");

    const { billId } = await inTx(v, (tx) =>
      splitBill(tx, v.cfg, orderId, [{ lineNo: 2 }], { operatorId: OPERATOR }),
    );

    const made = await billRow(v, billId);
    expect({ partyId: made.partyId, status: made.status }).toEqual({
      partyId: null,
      status: "open",
    });
    expect(
      (await linesOf(v, billId)).map((l) => ({ name: l.name, price: l.unitPriceGross })),
    ).toEqual([{ name: "Vino", price: 3000 }]);
    expect((await linesOf(v, orderId)).map((l) => l.name)).toEqual(["Burger"]);
  });
});

/** Sends each group as `placeGroups` does, in one transaction: dish names per group. */
async function orderGroups(
  tx: Transaction,
  partyId: string,
  groups: { names: string[]; release: "fire" | "hold" }[],
): Promise<void> {
  await placeGroups(tx, v.cfg, partyId, {
    groups: groups.map((group) => ({
      lines: group.names.map((name) => ({ menuItemId: v.item(name), quantity: "1" })),
      release: group.release,
    })),
    operatorId: OPERATOR,
  });
}

describe("merge bills", () => {
  it("moves every line onto the bill merged into, keeping its group and credit, and abandons the other", async () => {
    const mesa = await v.table("Mesa 20");
    const { partyId, tabId } = await seat(v, mesa);
    await orderForParty(v, partyId, ["Burger", "Vino"]);
    const second = await splitOff(partyId, tabId, [2]);
    const [vino] = await lineRows(second);
    const tablesBefore = await activeTablesOf(v, partyId);
    const revision = await revisionOf(v, partyId);

    await merge(partyId, tabId, second);

    const lines = await lineRows(tabId);
    expect(
      lines.map((l) => ({
        name: l.name,
        price: l.unitPriceGross,
        vat: l.vatClass,
        groupId: l.groupId,
        creditedTo: l.creditedTo,
      })),
    ).toEqual([
      {
        name: "Burger",
        price: 1200,
        vat: "general",
        groupId: vino!.groupId,
        creditedTo: OPERATOR,
      },
      { name: "Vino", price: 3000, vat: "general", groupId: vino!.groupId, creditedTo: OPERATOR },
    ]);
    expect(vino!.groupId).not.toBeNull();
    expect(lines[1]!.id).toBe(vino!.id);
    expect(await lineRows(second)).toEqual([]);
    expect((await billRow(v, second)).status).toBe("abandoned");
    expect((await billRow(v, tabId)).status).toBe("open");
    expect(await activeTablesOf(v, partyId)).toEqual(tablesBefore);
    expect(tablesBefore).toEqual([mesa]);
    const party = await partyRow(v, partyId);
    expect({ mainBillId: party.mainBillId, revision: party.revision }).toEqual({
      mainBillId: tabId,
      revision: revision + 1,
    });
    expect(await paymentsOf(tabId)).toEqual([]);
    expect(await paymentsOf(second)).toEqual([]);
  });

  it("makes the bill merged into the main bill when the main bill is merged away", async () => {
    const { partyId, main, second } = await twoBills("Mesa 21");

    await merge(partyId, second, main);

    expect((await partyRow(v, partyId)).mainBillId).toBe(second);
    expect((await billRow(v, main)).status).toBe("abandoned");
    expect((await linesOf(v, second)).map((l) => l.name)).toEqual(["Vino", "Burger"]);
  });

  it("files one record, for both bills' items, when the bill merged into is paid, and none for the other", async () => {
    const { partyId, main, second } = await twoBills("Mesa 60");
    const filed = (billId: string) =>
      v.db.all(sql`
        select importe_total as total from registros_facturacion
        where sale_id in (select id from sales where working_order_id = ${billId})`);

    await merge(partyId, main, second);
    await pay(v, main, "42.00");

    // Burger 12.00 and the Vino 30.00 merged in.
    expect(filed(main)).toEqual([{ total: "42.00" }]);
    expect(filed(second)).toEqual([]);
    expect((await billRow(v, second)).status).toBe("abandoned");
  });

  const SIDES = ["from", "into"] as const;
  const TOUCHES: Touch[] = ["presented", "partly paid", "paid"];
  const EACH_SIDE = SIDES.flatMap((side) => TOUCHES.map((how) => [side, how] as const));

  it.each(EACH_SIDE)("refuses a merge whose %s bill is %s, changing nothing", async (side, how) => {
    const { partyId, main, second } = await twoBills(`Mesa merge ${side} ${how}`);
    // The Vino bill is touched; it is `from` or `into` as the case says.
    await touch(second, how, "30.00");
    const [into, from] = side === "from" ? [main, second] : [second, main];
    const before = await snapshot(partyId, [main, second]);

    const error = await captureError(() => merge(partyId, into, from));

    expect(error).toMatchObject({
      code: TOUCHED_CODE[how],
      params: { workingOrderId: second },
    });
    expect(await snapshot(partyId, [main, second])).toEqual(before);
  });

  it("refuses a bill whose only payment was given back in full", async () => {
    const { partyId, main, second } = await twoBills("Mesa 22");
    const paymentId = await contribute(second, "5.00");
    const session = await inTx(v, (tx) =>
      loginWithPin(tx, { tillId: v.cfg.tillId, personId: adminId, pin: "1234" }),
    );
    await refundBillPayment(
      { db: v.db, clock: v.clock },
      v.cfg,
      second,
      paymentId,
      { submissionId: randomUUID(), appliedAmount: "5.00", tipAmount: "0.00", reason: "error" },
      { personId: adminId, sessionId: session.id },
    );
    const before = await snapshot(partyId, [main, second]);

    const error = await captureError(() => merge(partyId, main, second));

    expect(error).toMatchObject({
      code: "bill.payments_received",
      params: { workingOrderId: second },
    });
    expect(await snapshot(partyId, [main, second])).toEqual(before);
  });

  it("refuses bills of two parties, changing neither", async () => {
    const a = await twoBills("Mesa 23");
    const b = await twoBills("Mesa 24");
    const beforeA = await snapshot(a.partyId, [a.main]);
    const beforeB = await snapshot(b.partyId, [b.main]);

    const error = await captureError(() => merge(a.partyId, a.main, b.main));

    expect(error).toMatchObject({ code: "bill.other_party", params: { workingOrderId: b.main } });
    expect(await snapshot(a.partyId, [a.main])).toEqual(beforeA);
    expect(await snapshot(b.partyId, [b.main])).toEqual(beforeB);
  });

  it("refuses a party bill and a counter order, either way round", async () => {
    const { partyId, main } = await twoBills("Mesa 25");
    const counterId = await counterOrder("Flan");
    const before = await snapshot(partyId, [main, counterId]);

    const intoParty = await captureError(() => merge(partyId, main, counterId));
    const intoCounter = await captureError(() =>
      inTx(v, (tx) => mergeBills(tx, v.cfg, counterId, main, { operatorId: OPERATOR })),
    );

    expect(intoParty).toMatchObject({
      code: "bill.other_party",
      params: { workingOrderId: counterId },
    });
    expect(intoCounter).toMatchObject({
      code: "bill.other_party",
      params: { workingOrderId: main },
    });
    expect(await snapshot(partyId, [main, counterId])).toEqual(before);
  });

  it("refuses a bill merged into itself, changing nothing", async () => {
    const { partyId, main } = await twoBills("Mesa 26");
    const before = await snapshot(partyId, [main]);

    const error = await captureError(() => merge(partyId, main, main));

    expect(error).toMatchObject({ code: "tab.merge_self", params: { tabId: main } });
    expect(await snapshot(partyId, [main])).toEqual(before);
  });

  it("refuses a bill that does not exist as not open, changing nothing", async () => {
    const { partyId, main } = await twoBills("Mesa 27");
    const missing = randomUUID();
    const before = await snapshot(partyId, [main]);

    const error = await captureError(() => merge(partyId, main, missing));

    expect(error).toMatchObject({ code: "tab.not_open", params: { tabId: missing } });
    expect(await snapshot(partyId, [main])).toEqual(before);
  });

  it("points a table of the party that showed the merged-away bill at the surviving one, keeping it in the party", async () => {
    const { partyId, main, second } = await twoBills("Mesa 28");
    const terraza = await v.table("Terraza 28");
    // The old tab move takes the second bill to a table of its own, which joins the party.
    const sent = await commandFor(v, partyId);
    await inTx(v, (tx) => moveTab(tx, v.cfg, second, terraza, sent));
    expect((await tableRow(v, terraza)).tabId).toBe(second);
    const tables = await activeTablesOf(v, partyId);

    await merge(partyId, main, second);

    expect((await tableRow(v, terraza)).tabId).toBe(main);
    expect(await activeTablesOf(v, partyId)).toEqual(tables);
    expect(tables).toContain(terraza);
  });
});

describe("transfer items", () => {
  it("moves the chosen items, keeping price, VAT class, group and credit, and moves the revision on by one", async () => {
    const mesa = await v.table("Mesa 30");
    const { partyId, tabId } = await seat(v, mesa);
    await orderForParty(v, partyId, ["Burger", "Vino", "Paella"]);
    const second = await splitOff(partyId, tabId, [2]);
    const [burger] = await lineRows(tabId);
    const revision = await revisionOf(v, partyId);

    await transfer(partyId, tabId, second, [1]);

    expect((await linesOf(v, tabId)).map((l) => l.name)).toEqual(["Paella"]);
    const moved = (await lineRows(second)).find((l) => l.id === burger!.id)!;
    expect({
      name: moved.name,
      price: moved.unitPriceGross,
      vat: moved.vatClass,
      groupId: moved.groupId,
      creditedTo: moved.creditedTo,
    }).toEqual({
      name: "Burger",
      price: 1200,
      vat: "general",
      groupId: burger!.groupId,
      creditedTo: OPERATOR,
    });
    expect(burger!.groupId).not.toBeNull();
    expect((await linesOf(v, second)).map((l) => l.name)).toEqual(["Vino", "Burger"]);
    const party = await partyRow(v, partyId);
    expect({ revision: party.revision, mainBillId: party.mainBillId }).toEqual({
      revision: revision + 1,
      mainBillId: tabId,
    });
    expect(await activeTablesOf(v, partyId)).toEqual([mesa]);
  });

  const SIDES = ["from", "to"] as const;
  const TOUCHES: Touch[] = ["presented", "partly paid", "paid"];
  const EACH_SIDE = SIDES.flatMap((side) => TOUCHES.map((how) => [side, how] as const));

  it.each(EACH_SIDE)(
    "refuses a transfer whose %s bill is %s, changing nothing",
    async (side, how) => {
      const { partyId, main, second } = await twoBills(`Mesa transfer ${side} ${how}`);
      await touch(second, how, "30.00");
      const [from, to] = side === "from" ? [second, main] : [main, second];
      const before = await snapshot(partyId, [main, second]);

      const error = await captureError(() => transfer(partyId, from, to, [1]));

      expect(error).toMatchObject({
        code: TOUCHED_CODE[how],
        params: { workingOrderId: second },
      });
      expect(await snapshot(partyId, [main, second])).toEqual(before);
    },
  );

  it("refuses bills of two parties, changing neither", async () => {
    const a = await twoBills("Mesa 31");
    const b = await twoBills("Mesa 32");
    const beforeA = await snapshot(a.partyId, [a.main]);
    const beforeB = await snapshot(b.partyId, [b.main]);

    const error = await captureError(() => transfer(a.partyId, a.main, b.main, [1]));

    expect(error).toMatchObject({ code: "bill.other_party", params: { workingOrderId: b.main } });
    expect(await snapshot(a.partyId, [a.main])).toEqual(beforeA);
    expect(await snapshot(b.partyId, [b.main])).toEqual(beforeB);
  });

  it("refuses a transfer to the same bill, changing nothing", async () => {
    const { partyId, main } = await twoBills("Mesa 33");
    const before = await snapshot(partyId, [main]);

    const error = await captureError(() => transfer(partyId, main, main, [1]));

    expect(error).toMatchObject({ code: "tab.transfer_self", params: { tabId: main } });
    expect(await snapshot(partyId, [main])).toEqual(before);
  });
});

describe("requireUntouched", () => {
  it("refuses a bill that does not exist, one holding a payment, and passes an untouched one", async () => {
    const { main, second } = await twoBills("Mesa untouched");
    await contribute(main, "5.00");
    const missing = randomUUID();

    expect(await captureError(() => inTx(v, (tx) => requireUntouched(tx, missing)))).toMatchObject({
      code: "tab.not_open",
      params: { tabId: missing },
    });
    expect(await captureError(() => inTx(v, (tx) => requireUntouched(tx, main)))).toMatchObject({
      code: "bill.payments_received",
    });
    await inTx(v, (tx) => requireUntouched(tx, second));
  });
});

describe("bills of two service modes", () => {
  /**
   * A party whose main bill (Agua) the old tab move has taken to a counter table, so it is `prepay`,
   * while its second bill (Burger, already fired to the kitchen) stays `table_tab`.
   */
  async function mixedModes(label: string) {
    const { partyId, tabId: prepay } = await seat(v, await v.table(label));
    await orderForParty(v, partyId, ["Agua", "Burger"]);
    const tableTab = await splitOff(partyId, prepay, [2]);
    const counterTable = await v.table(`${label} counter`, counter.zoneId);
    const sent = await commandFor(v, partyId);
    await inTx(v, (tx) => moveTab(tx, v.cfg, prepay, counterTable, sent));
    const modes = v.db.all<{ id: string; mode: string }>(sql`
      select working_order_id as id, service_mode as mode from order_service_contexts
      where working_order_id in (${prepay}, ${tableTab}) order by service_mode`);
    expect(modes).toEqual([
      { id: prepay, mode: "prepay" },
      { id: tableTab, mode: "table_tab" },
    ]);
    return { partyId, prepay, tableTab };
  }

  const CASES = [
    ["merge", "into the prepay bill"],
    ["merge", "into the table bill"],
    ["transfer", "onto the prepay bill"],
    ["transfer", "onto the table bill"],
  ] as const;

  it.each(CASES)("refuses a %s %s, changing neither bill", async (verb, direction) => {
    const { partyId, prepay, tableTab } = await mixedModes(`Mesa modes ${verb} ${direction}`);
    const [to, from] = direction.includes("prepay") ? [prepay, tableTab] : [tableTab, prepay];
    const before = await snapshot(partyId, [prepay, tableTab]);

    const error = await captureError(() =>
      verb === "merge" ? merge(partyId, to, from) : transfer(partyId, from, to, [1]),
    );

    const [expected, actual] = to === prepay ? ["table_tab", "prepay"] : ["prepay", "table_tab"];
    expect(error).toMatchObject({
      code: "service_zone.mode_incompatible",
      params: { expected, actual },
    });
    expect(await snapshot(partyId, [prepay, tableTab])).toEqual(before);
  });
});

describe("sent work moved between a party's bills at two of its tables", () => {
  /** A new printer at the one station the bill's sent work went to. */
  async function printerFor(billId: string): Promise<string> {
    const stations = v.db.all<{ stationId: string }>(sql`
      select distinct station_id as stationId from ticket_items where working_order_id = ${billId}`);
    expect(stations).toHaveLength(1);
    return inTx(v, async (tx) => {
      const { id } = await createPrinter(
        tx,
        { locationId: v.cfg.locationId },
        {
          name: `P-${randomUUID().slice(0, 8)}`,
          transport: "cloud_poll",
          pollId: `poll-${randomUUID()}`,
        },
      );
      await attachPrinterToStation(tx, { stationId: stations[0]!.stationId, printerId: id });
      return id;
    });
  }

  async function printedBy(printerId: string): Promise<string[][]> {
    const jobs = await inTx(v, (tx) =>
      tx
        .select({ payload: printJobs.payload })
        .from(printJobs)
        .where(eq(printJobs.printerId, printerId))
        .orderBy(sql`rowid`),
    );
    return jobs.map((job) => printedLines(job.payload));
  }

  function noticesOn(billIds: string[]) {
    return v.db.all(sql`
      select working_order_id, kind, line_name, quantity, moved_to from kitchen_notices
      where working_order_id in (${sql.join(
        billIds.map((id) => sql`${id}`),
        sql`, `,
      )})
      order by rowid`);
  }

  /**
   * A party at `label` whose main bill has `burgers` Burgers sent to the kitchen and whose second
   * bill, a sent Vino, the old tab move has taken to a second table of the party. The printer is at
   * the station of `watched`'s work from before that move.
   */
  async function atTwoTables(label: string, burgers: string, watched: "main" | "second") {
    const { partyId, tabId: main } = await seat(v, await v.table(label));
    await inTx(v, (tx) =>
      placeGroups(tx, v.cfg, partyId, {
        groups: [
          {
            lines: [
              { menuItemId: v.item("Burger"), quantity: burgers },
              { menuItemId: v.item("Vino"), quantity: "1" },
            ],
            release: "fire",
          },
        ],
        operatorId: OPERATOR,
      }),
    );
    const second = await splitOff(partyId, main, [2]);
    const printerId = await printerFor(watched === "main" ? main : second);
    const terraza = await v.table(`Terraza ${label}`);
    const sent = await commandFor(v, partyId);
    await inTx(v, (tx) => moveTab(tx, v.cfg, second, terraza, sent));
    // The control: this printer does print the MOVED slips the tab move makes.
    const control = await printedBy(printerId);
    expect(control.length).toBeGreaterThan(0);
    expect(new Set(control.map((slip) => slip[0]))).toEqual(new Set(["*** MOVED ***"]));
    return { partyId, main, second, printerId };
  }

  it("tells the kitchen nothing of a merge, whose bills share the party's tables", async () => {
    const { partyId, main, second, printerId } = await atTwoTables("Mesa 50", "1", "second");
    const printed = await printedBy(printerId);
    const notices = noticesOn([main, second]);

    await merge(partyId, main, second);

    expect((await linesOf(v, main)).map((l) => l.name)).toEqual(["Burger", "Vino"]);
    expect(await printedBy(printerId)).toEqual(printed);
    expect(noticesOn([main, second])).toEqual(notices);
  });

  it("tells the kitchen nothing of part of a sent line transferred, whose bills share the party's tables", async () => {
    const { partyId, main, second, printerId } = await atTwoTables("Mesa 51", "2", "main");
    const printed = await printedBy(printerId);
    const notices = noticesOn([main, second]);
    const command = await commandFor(v, partyId);

    await inTx(v, (tx) =>
      transferItems(tx, v.cfg, main, second, [{ lineNo: 1, quantity: "1" }], command),
    );

    expect((await lineRows(second)).map((l) => [l.name, l.quantity])).toEqual([
      ["Vino", 1000],
      ["Burger", 1000],
    ]);
    expect(await printedBy(printerId)).toEqual(printed);
    expect(noticesOn([main, second])).toEqual(notices);
  });
});

describe("two tills at once", () => {
  /** A party with three bills: B1 (main) Burger; B2 Vino and Flan; B3 Paella. */
  async function threeBills(label: string) {
    const { partyId, tabId } = await seat(v, await v.table(label));
    await orderForParty(v, partyId, ["Burger", "Vino", "Paella"]);
    const b2 = await splitOff(partyId, tabId, [2]);
    const b3 = await splitOff(partyId, tabId, [3]);
    await orderForParty(v, partyId, ["Flan"], b2);
    return { partyId, b1: tabId, b2, b3 };
  }

  for (const first of ["merge", "transfer"] as const) {
    it(`refuses the second of a merge of B2 into B1 and a transfer from B2 to B3 (${first} first)`, async () => {
      const { partyId, b1, b2, b3 } = await threeBills(`Mesa 40 ${first}`);
      const read = await commandFor(v, partyId);
      const mergeB2 = () => inTx(v, (tx) => mergeBills(tx, v.cfg, b1, b2, read));
      const transferB2 = () =>
        inTx(v, (tx) => transferItems(tx, v.cfg, b2, b3, [{ lineNo: 2 }], read));
      const [winner, loser] = first === "merge" ? [mergeB2, transferB2] : [transferB2, mergeB2];

      await winner();
      const afterFirst = await snapshot(partyId, [b1, b2, b3]);
      const error = await captureError(loser);

      expect(error).toMatchObject({
        code: "party.out_of_date",
        params: { partyId, revision: read.expectedPartyRevision + 1 },
      });
      expect(await snapshot(partyId, [b1, b2, b3])).toEqual(afterFirst);
      if (first === "merge") expect((await billRow(v, b2)).status).toBe("abandoned");
    });
  }

  for (const first of ["merge", "split"] as const) {
    it(`refuses the second of a split of B1 and a merge of B1 into B3 (${first} first)`, async () => {
      const { partyId, b1, b2, b3 } = await threeBills(`Mesa 41 ${first}`);
      const read = await commandFor(v, partyId);
      const mergeB1 = () => inTx(v, (tx) => mergeBills(tx, v.cfg, b3, b1, read));
      const splitB1 = () => inTx(v, (tx) => splitBill(tx, v.cfg, b1, [{ lineNo: 1 }], read));
      const [winner, loser] = first === "merge" ? [mergeB1, splitB1] : [splitB1, mergeB1];

      await winner();
      const afterFirst = await snapshot(partyId, [b1, b2, b3]);
      const error = await captureError(loser);

      expect(error).toMatchObject({
        code: "party.out_of_date",
        params: { partyId, revision: read.expectedPartyRevision + 1 },
      });
      expect(await snapshot(partyId, [b1, b2, b3])).toEqual(afterFirst);
      if (first === "merge") expect((await billRow(v, b1)).status).toBe("abandoned");
    });
  }

  it("refuses a request naming a party the path bill has left, even when its revision matches the bill's party now", async () => {
    const one = await twoBills("Mesa 42");
    const other = await seat(v, await v.table("Mesa 43"));
    await order(v, other.tabId, "Paella");
    // The old tab merge absorbs party one into the other, taking its open second bill with it.
    const sent = {
      expectedPartyRevision: await revisionOf(v, other.partyId),
      expectedSourcePartyRevision: await revisionOf(v, one.partyId),
      operatorId: OPERATOR,
    };
    await inTx(v, (tx) =>
      mergeTabs(tx, v.cfg, other.tabId, one.main, { freeSourceTable: false, ...sent }),
    );
    expect((await billRow(v, one.second)).partyId).toBe(other.partyId);
    const command = {
      expectedPartyRevision: await revisionOf(v, other.partyId),
      partyId: one.partyId,
      operatorId: OPERATOR,
    };
    const before = await snapshot(other.partyId, [other.tabId, one.second]);

    const error = await captureError(() =>
      inTx(v, (tx) => transferItems(tx, v.cfg, one.second, other.tabId, [{ lineNo: 1 }], command)),
    );

    expect(error).toMatchObject({
      code: "party.out_of_date",
      params: { partyId: one.partyId, revision: await revisionOf(v, one.partyId) },
    });
    expect(await snapshot(other.partyId, [other.tabId, one.second])).toEqual(before);
    // The control: the same revision, naming the bill's party now, is accepted.
    await inTx(v, (tx) =>
      transferItems(tx, v.cfg, one.second, other.tabId, [{ lineNo: 1 }], {
        ...command,
        partyId: other.partyId,
      }),
    );
    expect((await linesOf(v, other.tabId)).map((l) => l.name)).toContain("Vino");
  });

  it("refuses a request naming the party a bill has left for the counter", async () => {
    const { partyId, second } = await twoBills("Mesa 44");
    const read = await commandFor(v, partyId);
    // Stands in for moving the bill to the counter, which no route does yet.
    await inTx(v, (tx) =>
      tx.update(workingOrders).set({ partyId: null }).where(eq(workingOrders.id, second)),
    );
    const before = await snapshot(partyId, [second]);

    const error = await captureError(() =>
      inTx(v, (tx) => splitBill(tx, v.cfg, second, [{ lineNo: 1 }], { ...read, partyId })),
    );

    expect(error).toMatchObject({
      code: "party.out_of_date",
      params: { partyId, revision: read.expectedPartyRevision },
    });
    expect(await snapshot(partyId, [second])).toEqual(before);
  });
});
