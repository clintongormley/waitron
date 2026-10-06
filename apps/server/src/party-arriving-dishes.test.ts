import { randomUUID } from "node:crypto";
import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  floorZones,
  kitchenStations,
  orderGroupEvents,
  orderGroups,
  printJobs,
  ticketItems,
  workingOrderLines,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { createPrinter } from "@waitron/printing";
import { writePrintHeldWork } from "@waitron/venue-service";
import { splitBill } from "./bill-actions.js";
import { createCourse, removeCourse } from "./kitchen.js";
import { moveBill, type MoveBillOptions, type MoveTarget } from "./move-bill.js";
import {
  bumpGroupReady,
  fireGroup,
  groupArrivingDishes,
  readCurrentOrders,
} from "./order-groups.js";
import { attachPrinterToStation } from "./station-printers.js";
import { joinTables, splitTable } from "./table-actions.js";
import { addTabRound, fireCourse, listExpoQueue, parkOrder, placeOrder } from "./working-order.js";
import { printedLines } from "./testing/decode-ticket.js";
import { offerProducts } from "./testing/zone-offers.js";
import {
  OPERATOR,
  billRow,
  commandFor,
  counterOrder,
  inTx,
  nextMillisecond,
  order,
  orderForParty,
  partyAt,
  revisionOf,
  seat,
  setupPartyVenue,
  type PartyVenue,
} from "./testing/party-venue.js";
import "./errors.js";

const MOVER = "cccccccc-0000-4000-8000-000000000002";
const FIRER = "cccccccc-0000-4000-8000-000000000003";

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

// Dishes that arrive in a party by Move a bill or Split a table get a kitchen group, so the pass
// can mark them and the waiter can release what is unsent (table actions plan, Task 9; A96, P16).
let v: PartyVenue;
/** A counter zone whose orders are invoiced when placed. */
let invoiceFirstZone: string;
let entrantes: string;
let principales: string;
let postres: string;

// `resetPerTest: false`: the venue is provisioned once, and each case seats its own tables.
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    v = await setupPartyVenue(db);
    invoiceFirstZone = await inTx(v, async (tx) => {
      const [zone] = await tx
        .insert(floorZones)
        .values({ locationId: v.cfg.locationId, name: "Barra factura" })
        .returning({ id: floorZones.id });
      return (
        await offerProducts(tx, v.cfg, {
          zone: { zoneId: zone!.id },
          serviceMode: "ticket_then_pay",
        })
      ).zoneId;
    });
    [entrantes, principales, postres] = await inTx(v, async (tx) => [
      (await createCourse(tx, v.cfg, { name: "Entrantes", displayOrder: 1 })).id,
      (await createCourse(tx, v.cfg, { name: "Principales", displayOrder: 2 })).id,
      (await createCourse(tx, v.cfg, { name: "Postres", displayOrder: 3 })).id,
    ]);
  },
});

async function move(billId: string, to: MoveTarget, opts: Partial<MoveBillOptions> = {}) {
  const own = (await billRow(v, billId)).partyId;
  const target = "tableId" in to ? await partyAt(v, to.tableId) : null;
  const options: MoveBillOptions = {
    bills: "merge",
    operatorId: OPERATOR,
    ...(own === null ? {} : { expectedPartyRevision: await revisionOf(v, own) }),
    ...(target === null || target === own
      ? {}
      : { otherPartyId: target, expectedOtherPartyRevision: await revisionOf(v, target) }),
    ...opts,
  };
  return inTx(v, (tx) => moveBill(tx, v.cfg, billId, to, options));
}

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

/** The party's groups, by position. */
async function groupsOf(partyId: string) {
  return inTx(v, (tx) =>
    tx
      .select({
        id: orderGroups.id,
        position: orderGroups.position,
        state: orderGroups.state,
        firedAt: orderGroups.firedAt,
        firedBy: orderGroups.firedBy,
        submittedBy: orderGroups.submittedBy,
      })
      .from(orderGroups)
      .where(eq(orderGroups.partyId, partyId))
      .orderBy(asc(orderGroups.position)),
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

/** The bill's kitchen items with `fired_at` set. */
async function firedTicketsOf(billId: string) {
  return inTx(v, (tx) =>
    tx
      .select({ lineId: ticketItems.workingOrderLineId, state: ticketItems.state })
      .from(ticketItems)
      .where(and(eq(ticketItems.workingOrderId, billId), isNotNull(ticketItems.firedAt))),
  );
}

async function eventsOf(groupId: string) {
  return inTx(v, (tx) =>
    tx
      .select({
        partyId: orderGroupEvents.partyId,
        kind: orderGroupEvents.kind,
        actorId: orderGroupEvents.actorId,
        detail: orderGroupEvents.detail,
      })
      .from(orderGroupEvents)
      .where(eq(orderGroupEvents.groupId, groupId)),
  );
}

async function command(partyId: string) {
  return {
    submissionId: randomUUID(),
    expectedPartyRevision: await revisionOf(v, partyId),
    operatorId: OPERATOR,
  };
}

/** A table bill of a new party at `label`: Burger for the first course, sent, and Flan for dessert, waiting. */
async function coursedBill(label: string) {
  const ana = await seat(v, await v.table(label));
  await inTx(v, (tx) =>
    addTabRound(tx, v.cfg, ana.tabId, [
      { menuItemId: v.item("Burger"), quantity: "1", courseId: entrantes },
      { menuItemId: v.item("Flan"), quantity: "1", courseId: postres },
    ]),
  );
  return ana;
}

describe("dishes arriving in a party (A96, P16)", () => {
  it("puts a moved bill's sent dishes in one new fired group, after the receiving party's last group", async () => {
    const [m4, m7] = [await v.table("Mesa 4"), await v.table("Mesa 7")];
    const ana = await seat(v, m4);
    const luis = await seat(v, m7);
    await orderForParty(v, ana.partyId, ["Burger", "Vino"]);
    const b2 = await splitOff(ana.partyId, ana.tabId, [2]);
    await orderForParty(v, luis.partyId, ["Agua"]);
    const groupsBefore = await groupsOf(luis.partyId);

    await move(b2, { tableId: m7 }, { bills: "separate" });

    const groups = await groupsOf(luis.partyId);
    expect(groups.slice(0, -1)).toEqual(groupsBefore);
    expect(groups.at(-1)).toMatchObject({
      state: "fired",
      position: groupsBefore.length + 1,
      firedAt: expect.any(String),
      firedBy: OPERATOR,
      submittedBy: OPERATOR,
    });
    const made = groups.at(-1)!.id;
    expect((await lineRows(b2)).map((l) => l.groupId)).toEqual([made]);
    expect(await eventsOf(made)).toEqual([
      {
        partyId: luis.partyId,
        kind: "lines_moved",
        actorId: OPERATOR,
        detail: { workingOrderId: b2, arrived: true },
      },
    ]);
  });

  it("dates a moved bill's fired group from its earliest kitchen firing and names whoever fired that dish's group in the party it left", async () => {
    const [m4, m7] = [await v.table("Hora 4"), await v.table("Hora 7")];
    const ana = await seat(v, m4);
    const luis = await seat(v, m7);
    await orderForParty(v, ana.partyId, ["Burger", "Vino"]);
    await orderForParty(v, ana.partyId, ["Paella"]);
    const b2 = await splitOff(ana.partyId, ana.tabId, [2, 3]);
    const [vino, paella] = await lineRows(b2);
    // The later line fired first, so neither the first line nor the latest firing is the answer;
    // the first line's sent time is earlier still, so a sent time must not outrank a kitchen item.
    const earliest = minutesAgo(25);
    await inTx(v, async (tx) => {
      for (const [line, firedAt, sentAt] of [
        [vino!, minutesAgo(12), minutesAgo(40)],
        [paella!, earliest, minutesAgo(5)],
      ] as const) {
        await tx
          .update(ticketItems)
          .set({ firedAt })
          .where(eq(ticketItems.workingOrderLineId, line.id));
        await tx.update(workingOrderLines).set({ sentAt }).where(eq(workingOrderLines.id, line.id));
      }
      await tx
        .update(orderGroups)
        .set({ firedBy: FIRER })
        .where(eq(orderGroups.id, paella!.groupId!));
    });

    await move(b2, { tableId: m7 }, { bills: "separate", operatorId: MOVER });

    const made = (await groupsOf(luis.partyId)).at(-1)!;
    expect(made).toMatchObject({
      state: "fired",
      firedAt: earliest,
      firedBy: FIRER,
      submittedBy: MOVER,
    });
    const current = await inTx(v, (tx) => readCurrentOrders(tx, luis.partyId));
    expect(current.groups.find((g) => g.id === made.id)).toMatchObject({
      firedAt: earliest,
      sentAt: earliest,
    });
  });

  it("dates an arriving fired group from a dish's sent time where the dish has no kitchen item, and names the mover when that dish records no firer", async () => {
    const ana = await seat(v, await v.table("Hora 5"));
    const luis = await seat(v, await v.table("Hora 8"));
    await order(v, ana.tabId, "Burger");
    const [burger] = await lineRows(ana.tabId);
    const sent = minutesAgo(30);
    await inTx(v, async (tx) => {
      await tx
        .update(ticketItems)
        .set({ firedAt: minutesAgo(10) })
        .where(eq(ticketItems.workingOrderLineId, burger!.id));
      await tx
        .insert(workingOrderLines)
        .values({ ...burger!, id: randomUUID(), lineNo: 2, sentAt: sent });
    });

    // Only the later-fired dish records who fired it.
    const made = await inTx(v, (tx: Transaction) =>
      groupArrivingDishes(tx, luis.partyId, ana.tabId, MOVER, new Map([[burger!.id, FIRER]])),
    );

    const [group] = await groupsOf(luis.partyId);
    expect(group).toMatchObject({
      id: made.fired,
      state: "fired",
      firedAt: sent,
      firedBy: MOVER,
    });
  });

  it("lets the pass mark a moved bill's dishes ready through their new group", async () => {
    const [m4, m7] = [await v.table("Pase 4"), await v.table("Pase 7")];
    const ana = await seat(v, m4);
    const luis = await seat(v, m7);
    await orderForParty(v, ana.partyId, ["Burger", "Vino"]);
    const b2 = await splitOff(ana.partyId, ana.tabId, [2]);

    await move(b2, { tableId: m7 }, { bills: "separate" });

    const made = (await groupsOf(luis.partyId)).at(-1)!.id;
    const board = await inTx(v, (tx) => listExpoQueue(tx, v.cfg));
    const entry = board.find((o) => o.orderId === b2);
    expect(entry?.groups.map((g) => g.groupId)).toEqual([made]);
    const ready = await command(luis.partyId);
    await inTx(v, (tx) => bumpGroupReady(tx, v.cfg, luis.partyId, made, ready));
    expect(await firedTicketsOf(b2)).toEqual([{ lineId: expect.any(String), state: "ready" }]);
  });

  it("puts sent dishes in a fired group and a dish waiting for its course in a held group, which the waiter then releases", async () => {
    const ana = await coursedBill("Curso 1");
    const mesa = await v.table("Curso 2");
    const luis = await seat(v, mesa);
    const [burger, flan] = await lineRows(ana.tabId);
    expect(await firedTicketsOf(ana.tabId)).toEqual([{ lineId: burger!.id, state: "queued" }]);

    await move(ana.tabId, { tableId: mesa }, { bills: "separate" });

    const [fired, held] = await groupsOf(luis.partyId);
    expect(fired).toMatchObject({ state: "fired", position: 1 });
    expect(held).toMatchObject({ state: "held", position: 2, firedAt: null, firedBy: null });
    expect((await lineRows(ana.tabId)).map((l) => [l.id, l.groupId])).toEqual([
      [burger!.id, fired!.id],
      [flan!.id, held!.id],
    ]);
    expect(await eventsOf(held!.id)).toEqual([
      {
        partyId: luis.partyId,
        kind: "lines_moved",
        actorId: OPERATOR,
        detail: { workingOrderId: ana.tabId, arrived: true },
      },
    ]);
    expect(await firedTicketsOf(ana.tabId)).toHaveLength(1);

    const fire = await command(luis.partyId);
    await inTx(v, (tx) => fireGroup(tx, v.cfg, luis.partyId, held!.id, fire));

    expect(await firedTicketsOf(ana.tabId)).toHaveLength(2);
  });

  it("holds a moved bill's waiting dishes course by course, so firing one course sends none of a later one", async () => {
    const ana = await seat(v, await v.table("Cursos 1"));
    await inTx(v, (tx) =>
      addTabRound(tx, v.cfg, ana.tabId, [
        { menuItemId: v.item("Burger"), quantity: "1", courseId: entrantes },
        { menuItemId: v.item("Flan"), quantity: "1", courseId: postres },
        { menuItemId: v.item("Tarta"), quantity: "1", courseId: principales },
      ]),
    );
    const mesa = await v.table("Cursos 2");
    const luis = await seat(v, mesa);
    const [burger, flan, tarta] = await lineRows(ana.tabId);
    expect(await firedTicketsOf(ana.tabId)).toEqual([{ lineId: burger!.id, state: "queued" }]);

    await move(ana.tabId, { tableId: mesa }, { bills: "separate" });

    const groups = await groupsOf(luis.partyId);
    expect(groups.map((g) => [g.state, g.position])).toEqual([
      ["fired", 1],
      ["held", 2],
      ["held", 3],
    ]);
    const [fired, heldPrincipales, heldPostres] = groups;
    expect((await lineRows(ana.tabId)).map((l) => [l.id, l.groupId])).toEqual([
      [burger!.id, fired!.id],
      [flan!.id, heldPostres!.id],
      [tarta!.id, heldPrincipales!.id],
    ]);
    for (const held of [heldPrincipales!, heldPostres!]) {
      expect(await eventsOf(held.id)).toEqual([
        {
          partyId: luis.partyId,
          kind: "lines_moved",
          actorId: OPERATOR,
          detail: { workingOrderId: ana.tabId, arrived: true },
        },
      ]);
    }

    await inTx(v, (tx) => fireCourse(tx, v.cfg, ana.tabId, principales, OPERATOR));

    expect((await firedTicketsOf(ana.tabId)).map((t) => t.lineId).sort()).toEqual(
      [burger!.id, tarta!.id].sort(),
    );
  });

  it("files a moved bill's waiting dish with no course in its earliest waiting course's held group", async () => {
    const ana = await seat(v, await v.table("Sin curso 1"));
    await inTx(v, (tx) =>
      addTabRound(tx, v.cfg, ana.tabId, [
        { menuItemId: v.item("Burger"), quantity: "1", courseId: entrantes },
        { menuItemId: v.item("Flan"), quantity: "1", courseId: postres },
        { menuItemId: v.item("Burger"), quantity: "1", hold: true },
        { menuItemId: v.item("Tarta"), quantity: "1", courseId: principales },
      ]),
    );
    const mesa = await v.table("Sin curso 2");
    const luis = await seat(v, mesa);
    const [burger, flan, loose, tarta] = await lineRows(ana.tabId);
    expect([loose!.courseId, loose!.sentAt]).toEqual([null, null]);

    await move(ana.tabId, { tableId: mesa }, { bills: "separate" });

    const groups = await groupsOf(luis.partyId);
    expect(groups.map((g) => [g.state, g.position])).toEqual([
      ["fired", 1],
      ["held", 2],
      ["held", 3],
    ]);
    const [fired, heldPrincipales, heldPostres] = groups;
    expect((await lineRows(ana.tabId)).map((l) => [l.id, l.groupId])).toEqual([
      [burger!.id, fired!.id],
      [flan!.id, heldPostres!.id],
      [loose!.id, heldPrincipales!.id],
      [tarta!.id, heldPrincipales!.id],
    ]);

    await inTx(v, (tx) => fireCourse(tx, v.cfg, ana.tabId, postres, OPERATOR));

    expect((await firedTicketsOf(ana.tabId)).map((t) => t.lineId).sort()).toEqual(
      [burger!.id, flan!.id].sort(),
    );

    await inTx(v, (tx) => fireCourse(tx, v.cfg, ana.tabId, principales, OPERATOR));

    expect((await firedTicketsOf(ana.tabId)).map((t) => t.lineId).sort()).toEqual(
      [burger!.id, flan!.id, loose!.id, tarta!.id].sort(),
    );
  });

  it("keeps a moved bill's waiting dishes with no course in one held group when no waiting dish has a course", async () => {
    const ana = await seat(v, await v.table("Sin curso 3"));
    await inTx(v, (tx) =>
      addTabRound(tx, v.cfg, ana.tabId, [
        { menuItemId: v.item("Burger"), quantity: "1", courseId: entrantes },
        { menuItemId: v.item("Burger"), quantity: "1", hold: true },
        { menuItemId: v.item("Flan"), quantity: "1", hold: true },
      ]),
    );
    const mesa = await v.table("Sin curso 4");
    const luis = await seat(v, mesa);
    const [burger, loose, flan] = await lineRows(ana.tabId);

    await move(ana.tabId, { tableId: mesa }, { bills: "separate" });

    const groups = await groupsOf(luis.partyId);
    expect(groups.map((g) => [g.state, g.position])).toEqual([
      ["fired", 1],
      ["held", 2],
    ]);
    expect((await lineRows(ana.tabId)).map((l) => [l.id, l.groupId])).toEqual([
      [burger!.id, groups[0]!.id],
      [loose!.id, groups[1]!.id],
      [flan!.id, groups[1]!.id],
    ]);
  });

  it("files a moved bill's waiting dish with no course under the earliest ACTIVE waiting course, passing over an earlier inactive one", async () => {
    const retired = await inTx(
      v,
      async (tx) => (await createCourse(tx, v.cfg, { name: "Segundos", displayOrder: 2 })).id,
    );
    const ana = await seat(v, await v.table("Sin curso 5"));
    try {
      await inTx(v, (tx) =>
        addTabRound(tx, v.cfg, ana.tabId, [
          { menuItemId: v.item("Burger"), quantity: "1", courseId: entrantes },
          { menuItemId: v.item("Tarta"), quantity: "1", courseId: retired },
          { menuItemId: v.item("Flan"), quantity: "1", courseId: postres },
          { menuItemId: v.item("Burger"), quantity: "1", hold: true },
        ]),
      );
    } finally {
      // The venue is shared by the whole file.
      await inTx(v, (tx) => removeCourse(tx, v.cfg, retired));
    }
    const mesa = await v.table("Sin curso 6");
    const luis = await seat(v, mesa);
    const [burger, tarta, flan, loose] = await lineRows(ana.tabId);

    await move(ana.tabId, { tableId: mesa }, { bills: "separate" });

    const groups = await groupsOf(luis.partyId);
    expect(groups.map((g) => [g.state, g.position])).toEqual([
      ["fired", 1],
      ["held", 2],
      ["held", 3],
    ]);
    const [fired, heldRetired, heldPostres] = groups;
    expect((await lineRows(ana.tabId)).map((l) => [l.id, l.groupId])).toEqual([
      [burger!.id, fired!.id],
      [tarta!.id, heldRetired!.id],
      [flan!.id, heldPostres!.id],
      [loose!.id, heldPostres!.id],
    ]);

    await inTx(v, (tx) => fireCourse(tx, v.cfg, ana.tabId, postres, OPERATOR));

    expect((await firedTicketsOf(ana.tabId)).map((t) => t.lineId).sort()).toEqual(
      [burger!.id, flan!.id, loose!.id].sort(),
    );
  });

  it("files a moved bill's waiting dish with no course under the earliest of its waiting courses when none of them is active, leaving the later one its own held group", async () => {
    const [terceros, cuartos] = await inTx(v, async (tx) => [
      (await createCourse(tx, v.cfg, { name: "Terceros", displayOrder: 2 })).id,
      (await createCourse(tx, v.cfg, { name: "Cuartos", displayOrder: 4 })).id,
    ]);
    const ana = await seat(v, await v.table("Sin curso 7"));
    try {
      await inTx(v, (tx) =>
        addTabRound(tx, v.cfg, ana.tabId, [
          { menuItemId: v.item("Burger"), quantity: "1", courseId: entrantes },
          { menuItemId: v.item("Tarta"), quantity: "1", courseId: terceros },
          { menuItemId: v.item("Flan"), quantity: "1", courseId: cuartos },
          { menuItemId: v.item("Burger"), quantity: "1", hold: true },
        ]),
      );
    } finally {
      // The venue is shared by the whole file.
      await inTx(v, async (tx) => {
        await removeCourse(tx, v.cfg, terceros);
        await removeCourse(tx, v.cfg, cuartos);
      });
    }
    const mesa = await v.table("Sin curso 8");
    const luis = await seat(v, mesa);
    const [burger, tarta, flan, loose] = await lineRows(ana.tabId);

    await move(ana.tabId, { tableId: mesa }, { bills: "separate" });

    const groups = await groupsOf(luis.partyId);
    expect(groups.map((g) => [g.state, g.position])).toEqual([
      ["fired", 1],
      ["held", 2],
      ["held", 3],
    ]);
    const [fired, heldTerceros, heldCuartos] = groups;
    expect((await lineRows(ana.tabId)).map((l) => [l.id, l.groupId])).toEqual([
      [burger!.id, fired!.id],
      [tarta!.id, heldTerceros!.id],
      [flan!.id, heldCuartos!.id],
      [loose!.id, heldTerceros!.id],
    ]);
  });

  it("puts an open counter order's dishes, sent to the kitchen at the move, in one new fired group", async () => {
    const mesa = await v.table("Mostrador 1");
    const ana = await seat(v, mesa);
    const counter = await counterOrder(v, "Caña", "Tarta");
    expect(await firedTicketsOf(counter)).toEqual([]);

    await move(counter, { tableId: mesa }, { bills: "separate" });

    const groups = await groupsOf(ana.partyId);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ state: "fired", position: 1 });
    expect((await lineRows(counter)).map((l) => l.groupId)).toEqual([groups[0]!.id, groups[0]!.id]);
    expect(await firedTicketsOf(counter)).toHaveLength(2);
  });

  it("gives a placed counter order moved into a party one fired group, leaving it placed and every other line value as it was", async () => {
    const mesa = await v.table("Factura 1");
    const ana = await seat(v, mesa);
    const id = randomUUID();
    const deps = { db: v.db, backend: v.backend, clock: v.clock };
    await parkOrder(deps, v.cfg, {
      id,
      zoneId: invoiceFirstZone,
      lines: ["Burger", "Vino"].map((name) => ({ menuItemId: v.item(name), quantity: "1" })),
      operatorId: OPERATOR,
    });
    await placeOrder(deps, v.cfg, id, OPERATOR);
    const before = await lineRows(id);
    expect(before.every((l) => l.sentAt !== null && l.groupId === null)).toBe(true);

    await move(id, { tableId: mesa }, { bills: "separate" });

    const [group] = await groupsOf(ana.partyId);
    expect(group).toMatchObject({ state: "fired", position: 1 });
    expect((await billRow(v, id)).status).toBe("placed");
    expect(await lineRows(id)).toEqual(before.map((l) => ({ ...l, groupId: group!.id })));
    const entry = (await inTx(v, (tx) => listExpoQueue(tx, v.cfg))).find((o) => o.orderId === id);
    expect(entry?.groups.map((g) => g.groupId)).toEqual([group!.id]);
  });

  it("gives a bill moved to a free table its new party's first group", async () => {
    const ana = await coursedBill("Libre 1");
    const libre = await v.table("Libre 2");
    await orderForParty(v, ana.partyId, ["Agua"]);
    const b2 = await splitOff(ana.partyId, ana.tabId, [1]);

    const result = await move(b2, { tableId: libre });

    const groups = await groupsOf(result.partyId!);
    expect(groups.map((g) => [g.state, g.position])).toEqual([["fired", 1]]);
    expect((await lineRows(b2)).map((l) => l.groupId)).toEqual([groups[0]!.id]);
  });

  it("names whoever fired a dish's group in the party it left, not the mover, when its bill moves to a free table", async () => {
    const ana = await seat(v, await v.table("Libre 3"));
    const libre = await v.table("Libre 4");
    await orderForParty(v, ana.partyId, ["Burger", "Vino"]);
    const b2 = await splitOff(ana.partyId, ana.tabId, [2]);
    const [vino] = await lineRows(b2);
    await inTx(v, (tx) =>
      tx.update(orderGroups).set({ firedBy: FIRER }).where(eq(orderGroups.id, vino!.groupId!)),
    );

    const result = await move(b2, { tableId: libre }, { operatorId: MOVER });

    expect(await groupsOf(result.partyId!)).toEqual([
      expect.objectContaining({ state: "fired", firedBy: FIRER, submittedBy: MOVER }),
    ]);
  });

  it("puts the chosen bill's sent dishes in ONE fired group at position 1 of the party Split a table starts, fired by whoever fired their group", async () => {
    const [m4, m5] = [await v.table("Separar 4"), await v.table("Separar 5")];
    const ana = await seat(v, m4);
    await nextMillisecond();
    const joining = { ...(await commandFor(v, ana.partyId)), bills: "merge" as const };
    await inTx(v, (tx) => joinTables(tx, v.cfg, ana.partyId, m5, joining));
    await orderForParty(v, ana.partyId, ["Burger", "Vino", "Flan"]);
    const b2 = await splitOff(ana.partyId, ana.tabId, [2, 3]);

    const splitting = { ...(await commandFor(v, ana.partyId)), operatorId: MOVER };
    const result = await inTx(v, (tx) => splitTable(tx, v.cfg, ana.partyId, m5, b2, splitting));

    const groups = await groupsOf(result.partyId);
    expect(groups.map((g) => [g.state, g.position, g.firedBy, g.submittedBy])).toEqual([
      ["fired", 1, OPERATOR, MOVER],
    ]);
    expect((await lineRows(b2)).map((l) => l.groupId)).toEqual([groups[0]!.id, groups[0]!.id]);
  });

  it("groups a counter order merged into the main bill, and leaves the main bill's own lines as they were", async () => {
    const mesa = await v.table("Fusion 1");
    const ana = await seat(v, mesa);
    await orderForParty(v, ana.partyId, ["Burger"]);
    await order(v, ana.tabId, "Vino");
    const [burger, vino] = await lineRows(ana.tabId);
    const [own] = await groupsOf(ana.partyId);
    expect([burger!.groupId, vino!.groupId]).toEqual([own!.id, null]);
    const counter = await counterOrder(v, "Tarta");

    const result = await move(counter, { tableId: mesa });

    expect(result).toEqual({ partyId: ana.partyId, billId: ana.tabId, merged: true });
    const groups = await groupsOf(ana.partyId);
    expect(groups.map((g) => [g.id === own!.id, g.state, g.position])).toEqual([
      [true, "fired", 1],
      [false, "fired", 2],
    ]);
    expect((await lineRows(ana.tabId)).map((l) => [l.name, l.groupId])).toEqual([
      ["Burger", own!.id],
      ["Vino", null],
      ["Tarta", groups[1]!.id],
    ]);
  });

  it("lets a dish's kitchen item decide whether it arrived released, and its sent time decide only for a dish with none", async () => {
    const ana = await seat(v, await v.table("Enviado 1"));
    const mesa = await v.table("Enviado 2");
    const luis = await seat(v, mesa);
    await order(v, ana.tabId, "Burger");
    const [burger] = await lineRows(ana.tabId);
    expect(burger!.sentAt).not.toBeNull();
    // The dish's kitchen item held while the dish reads as sent; the other dishes have no kitchen
    // item, one sent, one not, and one not and waiting for dessert.
    await inTx(v, async (tx) => {
      await tx
        .update(ticketItems)
        .set({ firedAt: null })
        .where(eq(ticketItems.workingOrderLineId, burger!.id));
      await tx.insert(workingOrderLines).values([
        { ...burger!, id: randomUUID(), lineNo: 2 },
        { ...burger!, id: randomUUID(), lineNo: 3, sentAt: null },
        { ...burger!, id: randomUUID(), lineNo: 4, sentAt: null, courseId: postres },
      ]);
    });

    const made = await inTx(v, (tx: Transaction) =>
      groupArrivingDishes(tx, luis.partyId, ana.tabId, OPERATOR, new Map()),
    );

    const groups = await groupsOf(luis.partyId);
    expect(groups.map((g) => [g.id, g.state])).toEqual([
      [made.fired, "fired"],
      [made.held[0], "held"],
    ]);
    expect((await lineRows(ana.tabId)).map((l) => [l.lineNo, l.groupId])).toEqual([
      [1, made.held[0]],
      [2, made.fired],
      [3, made.held[0]],
      [4, made.held[0]],
    ]);
  });

  it("gives an extras line its dish's group", async () => {
    const ana = await seat(v, await v.table("Extra 1"));
    const mesa = await v.table("Extra 2");
    const luis = await seat(v, mesa);
    await order(v, ana.tabId, "Burger");
    const [burger] = await lineRows(ana.tabId);
    // An extras line is a line whose `parent_line_id` names its dish. This one reads as unsent while
    // its dish is sent, so read on its own it would be held.
    await inTx(v, (tx) =>
      tx.insert(workingOrderLines).values({
        ...burger!,
        id: randomUUID(),
        lineNo: 2,
        parentLineId: burger!.id,
        sentAt: null,
      }),
    );

    await move(ana.tabId, { tableId: mesa }, { bills: "separate" });

    const groups = await groupsOf(luis.partyId);
    expect(groups.map((g) => g.state)).toEqual(["fired"]);
    expect((await lineRows(ana.tabId)).map((l) => l.groupId)).toEqual([
      groups[0]!.id,
      groups[0]!.id,
    ]);
  });

  it("makes no group, records nothing and leaves the revision for a bill whose every dish already has one", async () => {
    const ana = await seat(v, await v.table("Nada 1"));
    await orderForParty(v, ana.partyId, ["Burger", "Vino"]);
    const groupsBefore = await groupsOf(ana.partyId);
    const linesBefore = await lineRows(ana.tabId);
    const revision = await revisionOf(v, ana.partyId);
    const [{ events }] = v.db.all<{ events: number }>(
      sql`select count(*) as events from order_group_events where party_id = ${ana.partyId}`,
    );

    const made = await inTx(v, (tx: Transaction) =>
      groupArrivingDishes(tx, ana.partyId, ana.tabId, OPERATOR, new Map()),
    );

    expect(made).toEqual({ fired: null, held: [] });
    expect(await groupsOf(ana.partyId)).toEqual(groupsBefore);
    expect(await lineRows(ana.tabId)).toEqual(linesBefore);
    expect(await revisionOf(v, ana.partyId)).toBe(revision);
    expect(
      v.db.all<{ events: number }>(
        sql`select count(*) as events from order_group_events where party_id = ${ana.partyId}`,
      ),
    ).toEqual([{ events }]);
  });

  it("gives a bill leaving for the counter no group", async () => {
    const ana = await coursedBill("Barra 1");
    await orderForParty(v, ana.partyId, ["Agua"]);
    const b2 = await splitOff(ana.partyId, ana.tabId, [1]);

    await move(b2, { counter: { zoneId: null } });

    expect((await lineRows(b2)).map((l) => l.groupId)).toEqual([null]);
  });
});

describe("an arriving held group's advance HOLD ticket", () => {
  const TIME = expect.stringMatching(/^\d\d:\d\d$/);
  let printerId: string | undefined;

  async function defaultStation() {
    const [station] = await inTx(v, (tx) =>
      tx
        .select({ id: kitchenStations.id, name: kitchenStations.name })
        .from(kitchenStations)
        .where(
          and(
            eq(kitchenStations.locationId, v.cfg.locationId),
            eq(kitchenStations.isDefault, true),
          ),
        ),
    );
    return station!;
  }

  /** What a ticket for `billId` at table `label` prints under its mark: station, table, bill, time. */
  async function head(label: string, billId: string): Promise<unknown[]> {
    return [
      (await defaultStation()).name,
      label,
      String((await billRow(v, billId)).orderNumber),
      TIME,
    ];
  }

  /** The default station's printer, attached on first use. */
  async function kitchenPrinter(): Promise<string> {
    if (printerId === undefined) {
      const station = await defaultStation();
      printerId = await inTx(v, async (tx) => {
        const { id } = await createPrinter(
          tx,
          { locationId: v.cfg.locationId },
          { name: "Cocina", transport: "cloud_poll", pollId: `poll-${randomUUID()}` },
        );
        await attachPrinterToStation(tx, { stationId: station.id, printerId: id });
        return id;
      });
    }
    return printerId;
  }

  /** Every job the kitchen printer holds, oldest first: its kind and its printed lines. */
  async function jobs() {
    const printer = await kitchenPrinter();
    const rows = await inTx(v, (tx) =>
      tx
        .select({ kind: printJobs.kind, payload: printJobs.payload })
        .from(printJobs)
        .where(eq(printJobs.printerId, printer))
        .orderBy(sql`rowid`),
    );
    return rows.map((row) => ({
      kind: row.kind,
      lines: printedLines(row.payload).filter((text) => text !== ""),
    }));
  }

  const printHeldWork = (on: boolean) => inTx(v, (tx) => writePrintHeldWork(tx, on));

  async function heldGroupOf(partyId: string) {
    const [group] = await inTx(v, (tx) =>
      tx
        .select({ id: orderGroups.id, holdPrintedAt: orderGroups.holdPrintedAt })
        .from(orderGroups)
        .where(and(eq(orderGroups.partyId, partyId), eq(orderGroups.state, "held"))),
    );
    return group!;
  }

  afterEach(() => printHeldWork(false));

  it("with Print held groups in advance on, a moved bill's waiting dish prints a HOLD ticket at the move and a FIRE slip when its group is fired", async () => {
    await printHeldWork(true);
    const ana = await coursedBill("Aviso 1");
    const mesa = await v.table("Aviso 2");
    const luis = await seat(v, mesa);
    const before = (await jobs()).length;

    await move(ana.tabId, { tableId: mesa }, { bills: "separate" });

    const held = await heldGroupOf(luis.partyId);
    const header = await head("Aviso 2", ana.tabId);
    const atMove = (await jobs()).slice(before);
    expect(atMove.filter((job) => job.lines[0] === "*** HOLD ***")).toEqual([
      {
        kind: "document",
        lines: ["*** HOLD ***", ...header, "GROUP 2", "1.000 x FLAN"],
      },
    ]);
    expect(held.holdPrintedAt).not.toBeNull();

    const fired = (await jobs()).length;
    const fire = await command(luis.partyId);
    await inTx(v, (tx) => fireGroup(tx, v.cfg, luis.partyId, held.id, fire));

    expect((await jobs()).slice(fired)).toEqual([
      {
        kind: "document",
        lines: ["*** FIRE ***", ...header, "GROUP 2", "1.000 x FLAN"],
      },
    ]);
  });

  it("names on the HOLD ticket the main bill a moved bill merged into, where its waiting dish now is", async () => {
    await printHeldWork(true);
    const ana = await coursedBill("Aviso 7");
    const mesa = await v.table("Aviso 8");
    const luis = await seat(v, mesa);
    const before = (await jobs()).length;

    const result = await move(ana.tabId, { tableId: mesa }, { bills: "merge" });

    expect(result).toMatchObject({ billId: luis.tabId, merged: true });
    const holds = (await jobs()).slice(before).filter((job) => job.lines[0] === "*** HOLD ***");
    expect(holds).toEqual([
      {
        kind: "document",
        lines: ["*** HOLD ***", ...(await head("Aviso 8", luis.tabId)), "GROUP 2", "1.000 x FLAN"],
      },
    ]);
  });

  it("with Print held groups in advance off, a moved bill's waiting dish prints nothing at the move and an ordinary ticket when its group is fired", async () => {
    const ana = await coursedBill("Aviso 3");
    const mesa = await v.table("Aviso 4");
    const luis = await seat(v, mesa);
    const before = (await jobs()).length;

    await move(ana.tabId, { tableId: mesa }, { bills: "separate" });

    const held = await heldGroupOf(luis.partyId);
    expect(
      (await jobs()).slice(before).filter((job) => job.lines.some((text) => text.includes("FLAN"))),
    ).toEqual([]);
    expect(held.holdPrintedAt).toBeNull();

    const fired = (await jobs()).length;
    const fire = await command(luis.partyId);
    await inTx(v, (tx) => fireGroup(tx, v.cfg, luis.partyId, held.id, fire));

    const atFire = (await jobs()).slice(fired);
    expect(atFire).toEqual([{ kind: "document", lines: expect.arrayContaining(["1.000 x FLAN"]) }]);
    expect(atFire[0]!.lines[0]).not.toMatch(/\*\*\*/);
  });

  it("with Print held groups in advance on, a waiting dish on the bill Split a table takes prints a HOLD ticket", async () => {
    await printHeldWork(true);
    const [m4, m5] = [await v.table("Aviso 5"), await v.table("Aviso 6")];
    const ana = await seat(v, m4);
    await nextMillisecond();
    const joining = { ...(await commandFor(v, ana.partyId)), bills: "merge" as const };
    await inTx(v, (tx) => joinTables(tx, v.cfg, ana.partyId, m5, joining));
    await orderForParty(v, ana.partyId, ["Burger", "Vino"]);
    const b2 = await splitOff(ana.partyId, ana.tabId, [2]);
    await inTx(v, (tx) =>
      addTabRound(tx, v.cfg, b2, [
        { menuItemId: v.item("Burger"), quantity: "1", courseId: entrantes },
        { menuItemId: v.item("Flan"), quantity: "1", courseId: postres },
      ]),
    );
    const before = (await jobs()).length;

    const splitting = await commandFor(v, ana.partyId);
    const result = await inTx(v, (tx) => splitTable(tx, v.cfg, ana.partyId, m5, b2, splitting));

    const held = await heldGroupOf(result.partyId);
    expect((await jobs()).slice(before).filter((job) => job.lines[0] === "*** HOLD ***")).toEqual([
      {
        kind: "document",
        lines: ["*** HOLD ***", ...(await head("Aviso 6", b2)), "GROUP 2", "1.000 x FLAN"],
      },
    ]);
    expect(held.holdPrintedAt).not.toBeNull();
  });
});
