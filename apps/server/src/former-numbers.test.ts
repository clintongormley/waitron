import { readBillEditState } from "./bill-editing.js";
import { updateHeldOrder, placeOrder } from "./testing/order-writer-fixture.js";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { setRoutingCell } from "@waitron/venue-service";
import { createAdjustmentReason } from "@waitron/adjustments";
import { workingOrderLines, workingOrders } from "@waitron/db";
import { persons } from "@waitron/identity";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { applyAdjustment } from "./adjustments-apply.js";
import { mergeBills, splitBill, transferItems } from "./testing/bill-action-fixture.js";
import { readFormerNumbers } from "./former-numbers.js";
import { createStation } from "./kitchen.js";
import { setMadeHereStations } from "./made-here.js";

import { placeGroups } from "./testing/group-submit-fixture.js";
import { listPassMonitor, listPassScreen } from "./pass-board.js";
import {
  OPERATOR,
  billRow,
  commandFor,
  counterOrder,
  inTx,
  seat,
  setupPartyVenue,
  type PartyVenue,
} from "./testing/party-venue.js";
import {
  fireLines,
  listCounterWaiting,
  listExpoQueue,
  listHeldOrders,
  listStationQueues,
} from "./working-order.js";
import "./errors.js";

let v: PartyVenue;
/** Burger is cooked at the Plancha, Paella at the Arroces; the Vino is poured at the Barra. */
const stations = { plancha: "", arroces: "", barra: "" };
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    v = await setupPartyVenue(db);
    await inTx(v, async (tx) => {
      for (const [key, name, dish] of [
        ["plancha", "Plancha", "Burger"],
        ["arroces", "Arroces", "Paella"],
        ["barra", "Barra", "Vino"],
      ] as const) {
        const { id } = await createStation(tx, v.cfg, { name });
        stations[key] = id;
        await setRoutingCell(
          tx,
          v.cfg,
          { row: { kind: "product", productId: v.productId(dish) }, zoneId: null },
          { kind: "station", stationId: id },
        );
      }
      await setMadeHereStations(tx, v.cfg, v.cfg.origin.deviceId, [stations.barra]);
    });
  },
});

/** Sends the dishes to `billId` as one fired group, from a device that makes the Vino on the spot. */
async function send(partyId: string, billId: string, ...names: string[]) {
  await inTx(v, (tx) =>
    placeGroups(tx, { ...v.cfg, sendingDeviceId: v.cfg.origin.deviceId }, partyId, {
      groups: [
        {
          lines: names.map((name) => ({ menuItemId: v.item(name), quantity: "1" })),
          release: "fire",
        },
      ],
      operatorId: OPERATOR,
      billId,
    }),
  );
}

/** A party at a fresh table with `count` bills, each made by splitting off an unsent Agua. */
async function party(label: string, count: number): Promise<{ partyId: string; bills: string[] }> {
  const { partyId, tabId } = await seat(v, await v.table(label));
  const bills = [tabId];
  for (let i = 1; i < count; i++) {
    await updateHeldOrder({ db: v.db }, v.cfg, tabId, {
      revision: (await billRow(v, tabId)).revision,
      lines: [{ menuItemId: v.item("Agua"), quantity: "1" }],
      operatorId: OPERATOR,
    });
    const command = await commandFor(v, partyId);
    const { billId } = await inTx(v, async (tx) =>
      splitBill(tx, v.cfg, tabId, [{ lineNo: await lastLine(tabId) }], command),
    );
    bills.push(billId);
  }
  return { partyId, bills };
}

async function lastLine(billId: string): Promise<number> {
  const [{ lineNo }] = await v.db.all<{ lineNo: number }>(
    sql`select max(line_no) as lineNo from working_order_lines where working_order_id = ${billId}`,
  );
  return lineNo;
}

function lineOf(billId: string, name: string): number {
  const [row] = v.db.all<{ lineNo: number }>(sql`
    select line_no as lineNo from working_order_lines
    where working_order_id = ${billId} and name = ${name}`);
  return row!.lineNo;
}

async function numberOf(billId: string): Promise<number> {
  return (await billRow(v, billId)).orderNumber;
}

async function merge(partyId: string, intoBillId: string, fromBillId: string) {
  const command = await commandFor(v, partyId);
  await inTx(v, (tx) => mergeBills(tx, v.cfg, intoBillId, fromBillId, command));
}

async function transfer(partyId: string, fromBillId: string, toBillId: string, name: string) {
  const command = await commandFor(v, partyId);
  await inTx(v, (tx) =>
    transferItems(tx, v.cfg, fromBillId, toBillId, [{ lineNo: lineOf(fromBillId, name) }], command),
  );
}

/** Cancels the whole of the bill's line of `name`, as the till's cancel does. */
async function cancelLine(billId: string, name: string) {
  await inTx(v, async (tx) => {
    const [operator] = await tx
      .insert(persons)
      .values({ displayName: `Cancels ${randomUUID()}`, role: "manager" })
      .returning({ id: persons.id });
    const reason = await createAdjustmentReason(tx, {
      name: `Mistake ${randomUUID()}`,
      names: { en: "Mistake", es: "Error" },
      actions: ["cancel"],
      maxPercentBp: null,
      maxAmount: null,
      applyRole: "staff",
      approverRole: "staff",
      noteRequired: false,
    });
    const [line] = await tx
      .select({ id: workingOrderLines.id })
      .from(workingOrderLines)
      .where(and(eq(workingOrderLines.workingOrderId, billId), eq(workingOrderLines.name, name)));
    const [bill] = await tx
      .select({ revision: workingOrders.revision })
      .from(workingOrders)
      .where(eq(workingOrders.id, billId));
    await applyAdjustment(
      tx,
      v.cfg,
      {
        expectedEdit: await readBillEditState(tx, billId),
        orderId: billId,
        submissionId: randomUUID(),
        expectedRevision: bill!.revision,
        lineId: line!.id,
        reasonId: reason.id,
        action: "cancel",
        note: null,
        operatorId: operator!.id,
      },
      v.cfg.locale,
    );
  });
}

async function expoOrder(billId: string) {
  return (await inTx(v, (tx) => listExpoQueue(tx, v.cfg))).find((o) => o.orderId === billId);
}

async function stationGroup(station: keyof typeof stations, billId: string) {
  const queues = await inTx(v, (tx) => listStationQueues(tx, [stations[station]]));
  return queues.get(stations[station])!.find((group) => group.orderId === billId);
}

describe("the numbers an order's sent dishes were sent under, on the kitchen reads", () => {
  it("after Merge bills, the expo board and both stations show the merged bill's number, and the merged bill is gone", async () => {
    const { partyId, bills } = await party("Mesa 91", 2);
    const [b27, b28] = bills as [string, string];
    await send(partyId, b27, "Paella");
    await send(partyId, b28, "Burger");
    const n28 = await numberOf(b28);

    await merge(partyId, b27, b28);

    expect(await expoOrder(b27)).toMatchObject({ formerNumbers: [n28] });
    expect(await expoOrder(b28)).toBeUndefined();
    expect(await stationGroup("plancha", b27)).toMatchObject({ formerNumbers: [n28] });
    // The Arroces never had a dish from 28: the list is the whole bill's.
    expect(await stationGroup("arroces", b27)).toMatchObject({ formerNumbers: [n28] });
  });

  it("after two merges, lists both numbers lowest first", async () => {
    const { partyId, bills } = await party("Mesa 92", 3);
    const [b27, b28, b30] = bills as [string, string, string];
    await send(partyId, b27, "Paella");
    // 30's dish is sent before 28's, so its kitchen item is written first.
    await send(partyId, b30, "Burger");
    await send(partyId, b28, "Burger");
    const n28 = await numberOf(b28);
    const n30 = await numberOf(b30);

    await merge(partyId, b28, b30);
    await merge(partyId, b27, b28);

    expect(await expoOrder(b27)).toMatchObject({ formerNumbers: [n28, n30] });
    expect(await stationGroup("plancha", b27)).toMatchObject({ formerNumbers: [n28, n30] });
  });

  it("leaves the key out on an order that never merged, and leaves out an order's own number", async () => {
    const { partyId, bills } = await party("Mesa 93", 2);
    const [b27, b28] = bills as [string, string];
    await send(partyId, b27, "Paella");
    await send(partyId, b28, "Burger");
    const n27 = await numberOf(b27);
    const n28 = await numberOf(b28);
    expect(await expoOrder(b27)).not.toHaveProperty("formerNumbers");
    expect(await stationGroup("arroces", b27)).not.toHaveProperty("formerNumbers");
    expect(await expoOrder(b28)).not.toHaveProperty("formerNumbers");

    await transfer(partyId, b28, b27, "Burger");
    expect(await expoOrder(b27)).toMatchObject({ formerNumbers: [n28] });
    // The Burger comes back to 28 still sent under 28.
    await transfer(partyId, b27, b28, "Burger");

    expect(await expoOrder(b27)).not.toHaveProperty("formerNumbers");
    expect(await expoOrder(b28)).not.toHaveProperty("formerNumbers");

    await transfer(partyId, b27, b28, "Paella");
    expect(await expoOrder(b28)).toMatchObject({ formerNumbers: [n27] });
    expect(await stationGroup("plancha", b28)).toMatchObject({ formerNumbers: [n27] });
  });

  it("leaves out a made-here drink, which no kitchen paper or screen showed", async () => {
    const { partyId, bills } = await party("Mesa 96", 2);
    const [b27, b28] = bills as [string, string];
    await send(partyId, b27, "Paella");
    await send(partyId, b28, "Vino");

    await merge(partyId, b27, b28);

    expect(await expoOrder(b27)).not.toHaveProperty("formerNumbers");
    expect(await stationGroup("arroces", b27)).not.toHaveProperty("formerNumbers");
  });

  it("drops a moved dish's number once the dish is cancelled", async () => {
    const { partyId, bills } = await party("Mesa 97", 2);
    const [b27, b28] = bills as [string, string];
    await send(partyId, b27, "Paella");
    await send(partyId, b28, "Burger");
    const n28 = await numberOf(b28);
    await merge(partyId, b27, b28);
    expect(await expoOrder(b27)).toMatchObject({ formerNumbers: [n28] });

    await cancelLine(b27, "Burger");

    expect(await expoOrder(b27)).not.toHaveProperty("formerNumbers");
    expect(await stationGroup("arroces", b27)).not.toHaveProperty("formerNumbers");
  });

  it("is carried by a device's pass screen and pass monitor", async () => {
    const { partyId, bills } = await party("Mesa 94", 2);
    const [b27, b28] = bills as [string, string];
    await send(partyId, b27, "Paella");
    await send(partyId, b28, "Burger");
    const n28 = await numberOf(b28);
    await merge(partyId, b27, b28);
    const scope = { stationIds: null, zoneIds: null };

    const screen = await inTx(v, (tx) => listPassScreen(tx, v.cfg, randomUUID(), scope));
    const monitor = await inTx(v, (tx) => listPassMonitor(tx, v.cfg, scope));

    expect(screen.orders.find((o) => o.orderId === b27)).toMatchObject({ formerNumbers: [n28] });
    expect(monitor.orders.find((o) => o.orderId === b27)).toMatchObject({ formerNumbers: [n28] });
  });
});

/** Fires every line of a counter order. */
async function fireAll(orderId: string) {
  await inTx(v, async (tx) =>
    fireLines(
      tx,
      v.cfg,
      orderId,
      await tx
        .select({
          id: workingOrderLines.id,
          productId: workingOrderLines.productId,
          courseId: workingOrderLines.courseId,
          parentLineId: workingOrderLines.parentLineId,
          note: workingOrderLines.note,
          quantity: workingOrderLines.quantity,
        })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, orderId)),
    ),
  );
}

describe("the numbers an order's sent dishes were sent under, on the counter reads", () => {
  it("lists a counter order split off a sent one with the number its dishes were sent under", async () => {
    const o40 = await counterOrder(v, "Burger", "Paella");
    await fireAll(o40);
    const n40 = await numberOf(o40);

    const { billId: o41 } = await inTx(v, (tx) =>
      splitBill(tx, v.cfg, o40, [{ lineNo: lineOf(o40, "Burger") }], { operatorId: OPERATOR }),
    );
    const held = await listHeldOrders({ db: v.db }, v.cfg);
    expect(held.find((o) => o.id === o41)).toMatchObject({ formerNumbers: [n40] });
    expect(held.find((o) => o.id === o40)).not.toHaveProperty("formerNumbers");

    await placeOrder({ db: v.db, backend: v.backend, clock: v.clock }, v.cfg, o41, OPERATOR);

    const waiting = await listCounterWaiting({ db: v.db }, v.cfg);
    expect(waiting.find((o) => o.id === o41)).toMatchObject({ formerNumbers: [n40] });
  });

  it("leaves the key out on a held counter order that never split", async () => {
    const id = await counterOrder(v, "Burger");
    await fireAll(id);

    const held = (await listHeldOrders({ db: v.db }, v.cfg)).find((o) => o.id === id);

    expect(held).toBeDefined();
    expect(held).not.toHaveProperty("formerNumbers");
  });
});

describe("readFormerNumbers", () => {
  it("answers no entry for no orders, and one entry for an order named twice", async () => {
    const { partyId, bills } = await party("Mesa 95", 2);
    const [b27, b28] = bills as [string, string];
    await send(partyId, b27, "Paella");
    await transfer(partyId, b27, b28, "Paella");

    expect(await inTx(v, (tx) => readFormerNumbers(tx, []))).toEqual(new Map());
    expect(await inTx(v, (tx) => readFormerNumbers(tx, [b27, b28, b28]))).toEqual(
      new Map([[b28, [await numberOf(b27)]]]),
    );
  });
});
