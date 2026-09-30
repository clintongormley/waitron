import { randomUUID } from "node:crypto";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
  updateProduct,
} from "@waitron/catalogue";
import {
  diningTables,
  kitchenStations,
  orderGroups,
  parties,
  partyTables,
  ticketItems,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPin, persons } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  listPreparationRoutes,
  updatePreparationRoute,
  writeClearingWorkflow,
  writeReleaseReminderMinutes,
} from "@waitron/venue-service";
import { requestBill } from "./bill-request.js";
import { createStation } from "./kitchen.js";
import { moveBill } from "./move-bill.js";
import { saveDraft } from "./order-drafts.js";
import { fireGroup, placeGroups, snoozeReminder } from "./order-groups.js";
import { finishTable } from "./parties.js";
import { joinTables } from "./table-actions.js";
import {
  cashContribution,
  commandFor,
  floorRow,
  inTx,
  nameParty,
  OPERATOR,
  order,
  orderForParty,
  pay,
  revisionOf,
  seat,
  setupPartyVenue,
  split,
  type PartyVenue,
} from "./testing/party-venue.js";
import { serveLine } from "./testing/serve-line.js";
import { offerProducts } from "./testing/zone-offers.js";
import {
  addTabRound,
  advanceTicketItem,
  listHeldOrders,
  markServed,
  listTablesWithState,
} from "./working-order.js";
import "./errors.js";

// The floor's attention signals (service spec §1; plan Task 10): several on one table at once, each
// read over the party's family, and the counter's tab list carrying the kitchen's two.
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

/** A bar station, at display position 1 unless another is given, after the venue's own "Cocina", taking every Caña. */
async function withBar(v: PartyVenue, displayOrder = 1): Promise<string> {
  return inTx(v, async (tx) => {
    const { id } = await createStation(tx, v.cfg, { name: "Barra", displayOrder });
    const route = (await listPreparationRoutes(tx, v.cfg)).find(
      (candidate) => candidate.productId === v.productId("Caña") && candidate.zoneId === null,
    )!;
    await updatePreparationRoute(tx, v.cfg, route.id, {
      productId: v.productId("Caña"),
      target: { kind: "station", stationId: id },
    });
    return id;
  });
}

/** The station the venue ships with. */
async function cocina(v: PartyVenue): Promise<string> {
  return inTx(v, async (tx) => {
    const [row] = await tx
      .select({ id: kitchenStations.id })
      .from(kitchenStations)
      .where(eq(kitchenStations.name, "Cocina"));
    return row!.id;
  });
}

/** Every fired ticket item of the bill's lines named `name`, bumped to ready as a station does. */
async function makeReady(v: PartyVenue, billId: string, name: string): Promise<void> {
  await inTx(v, async (tx) => {
    const items = await tx
      .select({ id: ticketItems.id, state: ticketItems.state })
      .from(ticketItems)
      .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
      .where(
        and(
          eq(ticketItems.workingOrderId, billId),
          eq(workingOrderLines.name, name),
          isNotNull(ticketItems.firedAt),
        ),
      );
    for (const item of items) {
      if (item.state === "queued") await advanceTicketItem(tx, v.cfg, item.id, "preparing");
      if (item.state !== "ready") await advanceTicketItem(tx, v.cfg, item.id, "ready");
    }
  });
}

/** The bill's ticket items queued `minutes` ago, as though the kitchen had them that long. */
async function queuedAgo(v: PartyVenue, billId: string, minutes: number): Promise<void> {
  const at = new Date(Date.now() - minutes * 60_000).toISOString();
  await inTx(v, (tx) =>
    tx.update(ticketItems).set({ queuedAt: at }).where(eq(ticketItems.workingOrderId, billId)),
  );
}

async function holdGroup(v: PartyVenue, partyId: string, ...names: string[]): Promise<string> {
  const placed = await inTx(v, (tx) =>
    placeGroups(tx, v.cfg, partyId, {
      groups: [
        {
          lines: names.map((name) => ({ menuItemId: v.item(name), quantity: "1" })),
          release: "hold",
        },
      ],
      operatorId: OPERATOR,
    }),
  );
  return placed.groups[0]!.id;
}

async function command(v: PartyVenue, partyId: string) {
  return { submissionId: randomUUID(), ...(await commandFor(v, partyId)) };
}

async function askForBill(v: PartyVenue, partyId: string): Promise<string> {
  const args = await command(v, partyId);
  const answer = await inTx(v, (tx) => requestBill(tx, partyId, true, args));
  return answer.billRequestedAt!;
}

async function billRequestedAt(v: PartyVenue, partyId: string): Promise<string | null> {
  const [row] = await inTx(v, (tx) =>
    tx.select({ at: parties.billRequestedAt }).from(parties).where(eq(parties.id, partyId)),
  );
  return row!.at;
}

async function remindAtOf(v: PartyVenue, groupId: string): Promise<string> {
  const [row] = await inTx(v, (tx) =>
    tx.select({ at: orderGroups.remindAt }).from(orderGroups).where(eq(orderGroups.id, groupId)),
  );
  return row!.at!;
}

async function person(v: PartyVenue, displayName: string): Promise<string> {
  const [row] = await inTx(v, (tx) =>
    tx
      .insert(persons)
      .values({ displayName, pinHash: hashPin("4321"), role: "staff" })
      .returning({ id: persons.id }),
  );
  return row!.id;
}

/** The line of the bill numbered `lineNo`. */
async function lineId(v: PartyVenue, billId: string, lineNo: number): Promise<string> {
  const [row] = await inTx(v, (tx) =>
    tx
      .select({ id: workingOrderLines.id })
      .from(workingOrderLines)
      .where(
        and(eq(workingOrderLines.workingOrderId, billId), eq(workingOrderLines.lineNo, lineNo)),
      ),
  );
  return row!.id;
}

describe("the floor's attention signals", () => {
  it("asks a just-seated party for its order, until a draft exists", async () => {
    const v = await setupPartyVenue(suite.db);
    const lucia = await person(v, "Lucía");
    const quiet = await seat(v, await v.table("Mesa 1"));
    const drafting = await seat(v, await v.table("Mesa 3"));

    expect((await floorRow(v, await tableOf(v, quiet.partyId))).signals).toEqual([
      { kind: "take_order" },
    ]);

    // A draft holding no line yet is enough to say someone is taking the order.
    await inTx(v, (tx) =>
      saveDraft(tx, v.cfg, quiet.partyId, lucia, { draftId: null, revision: 0, lines: [] }),
    );
    await inTx(v, (tx) =>
      saveDraft(tx, v.cfg, drafting.partyId, lucia, {
        draftId: null,
        revision: 0,
        lines: [draftLine(v, "Burger")],
      }),
    );

    expect((await floorRow(v, await tableOf(v, quiet.partyId))).signals).toEqual([]);
    expect((await floorRow(v, await tableOf(v, drafting.partyId))).signals).toEqual([
      { kind: "unsent_draft", ownerNames: ["Lucía"] },
    ]);
  });

  it("stops asking for the order once a line is on a bill", async () => {
    const v = await setupPartyVenue(suite.db);
    const tableId = await v.table("Mesa 1");
    const { tabId } = await seat(v, tableId);
    await order(v, tabId, "Agua");

    expect((await floorRow(v, tableId)).signals).toEqual([]);
  });

  it("shows Mesa 2's ready drinks, its due held group and its bill request together; paying clears only the request, serving clears the drinks", async () => {
    const v = await setupPartyVenue(suite.db);
    const bar = await withBar(v);
    await inTx(v, (tx) => writeReleaseReminderMinutes(tx, 10));
    const mesa2 = await v.table("Mesa 2");
    const { partyId, tabId } = await seat(v, mesa2);
    await order(v, tabId, "Caña", "Caña", "Caña");
    const mains = await holdGroup(v, partyId, "Burger");
    const snooze = await command(v, partyId);
    await inTx(v, (tx) => snoozeReminder(tx, v.cfg, partyId, mains, 5, snooze));
    await makeReady(v, tabId, "Caña");
    const requestedAt = await askForBill(v, partyId);

    expect((await floorRow(v, mesa2)).signals).toEqual([
      { kind: "ready", byStation: [{ stationId: bar, stationName: "Barra", count: 3 }] },
      { kind: "release_due", groupId: mains, dueAt: await remindAtOf(v, mains) },
      { kind: "bill_requested", requestedAt },
    ]);

    const fire = await command(v, partyId);
    await inTx(v, (tx) => fireGroup(tx, v.cfg, partyId, mains, fire));
    await pay(v, tabId, "21.00");

    // Paid, but the drinks still wait at the bar.
    expect((await floorRow(v, mesa2)).signals).toEqual([
      { kind: "ready", byStation: [{ stationId: bar, stationName: "Barra", count: 3 }] },
    ]);
    expect(await billRequestedAt(v, partyId)).toBeNull();

    for (const lineNo of [1, 2, 3]) {
      await inTx(v, (tx) => serveLine(tx, v.cfg, tabId, lineNo));
    }

    expect((await floorRow(v, mesa2)).signals).toEqual([]);
  });

  it("counts each station's ready dishes in units per table, and serving takes them off", async () => {
    const v = await setupPartyVenue(suite.db);
    const bar = await withBar(v);
    const kitchen = await cocina(v);
    const mesa2 = await v.table("Mesa 2");
    const mesa8 = await v.table("Mesa 8");
    const two = await seat(v, mesa2);
    const eight = await seat(v, mesa8);
    await inTx(v, (tx) =>
      addTabRound(tx, v.cfg, two.tabId, [
        { menuItemId: v.item("Caña"), quantity: "2" },
        { menuItemId: v.item("Caña"), quantity: "1" },
        { menuItemId: v.item("Burger"), quantity: "1" },
      ]),
    );
    await order(v, eight.tabId, "Caña");
    for (const [billId, name] of [
      [two.tabId, "Caña"],
      [two.tabId, "Burger"],
      [eight.tabId, "Caña"],
    ] as const) {
      await makeReady(v, billId, name);
    }

    expect((await floorRow(v, mesa2)).signals).toEqual([
      {
        kind: "ready",
        byStation: [
          { stationId: kitchen, stationName: "Cocina", count: 1 },
          { stationId: bar, stationName: "Barra", count: 3 },
        ],
      },
    ]);
    expect((await floorRow(v, mesa8)).signals).toEqual([
      { kind: "ready", byStation: [{ stationId: bar, stationName: "Barra", count: 1 }] },
    ]);

    // One of the two cañas on line 1 goes out.
    const line1 = await lineId(v, two.tabId, 1);
    const serve = await command(v, two.partyId);
    await inTx(v, (tx) =>
      markServed(tx, v.cfg, two.partyId, [{ lineId: line1, quantity: "1" }], serve),
    );
    expect((await floorRow(v, mesa2)).signals).toEqual([
      {
        kind: "ready",
        byStation: [
          { stationId: kitchen, stationName: "Cocina", count: 1 },
          { stationId: bar, stationName: "Barra", count: 2 },
        ],
      },
    ]);

    await inTx(v, (tx) => serveLine(tx, v.cfg, two.tabId, 1));
    await inTx(v, (tx) => serveLine(tx, v.cfg, two.tabId, 2));

    expect((await floorRow(v, mesa2)).signals).toEqual([
      { kind: "ready", byStation: [{ stationId: kitchen, stationName: "Cocina", count: 1 }] },
    ]);
    expect((await floorRow(v, mesa8)).signals).toEqual([
      { kind: "ready", byStation: [{ stationId: bar, stationName: "Barra", count: 1 }] },
    ]);
  });

  it("counts a weighed dish as one, and puts stations at one position in name order", async () => {
    const v = await setupPartyVenue(suite.db);
    const bar = await withBar(v, 0);
    const kitchen = await cocina(v);
    const pulpo = await inTx(v, async (tx) => {
      const menu = await createCatalogue(tx, { name: "Pesados" });
      const category = await createCategory(tx, { name: { "es-ES": "Raciones" } });
      const product = await createProduct(tx, {
        catalogueId: menu.id,
        categoryId: category.id,
        name: "Pulpo",
        customerName: { "es-ES": "Pulpo a la gallega" },
        kitchenName: "PULPO",
        pricingUnit: "weight",
        unitPrice: "40.00",
        vatClass: "general",
      });
      await assignCatalogueToLocation(tx, v.cfg.locationId, menu.id);
      return (await offerProducts(tx, v.cfg, { zone: "tables" })).offerFor(product.id);
    });
    const mesa2 = await v.table("Mesa 2");
    const { tabId } = await seat(v, mesa2);
    await inTx(v, (tx) =>
      addTabRound(tx, v.cfg, tabId, [
        { menuItemId: pulpo, quantity: "0.350" },
        { menuItemId: v.item("Caña"), quantity: "1" },
      ]),
    );
    await makeReady(v, tabId, "Pulpo");
    await makeReady(v, tabId, "Caña");

    expect((await floorRow(v, mesa2)).signals).toEqual([
      {
        kind: "ready",
        byStation: [
          { stationId: bar, stationName: "Barra", count: 1 },
          { stationId: kitchen, stationName: "Cocina", count: 1 },
        ],
      },
    ]);
  });

  it("warns of a long wait by the worst band over fired dishes still to serve", async () => {
    const v = await setupPartyVenue(suite.db);
    const mesa2 = await v.table("Mesa 2");
    const { tabId } = await seat(v, mesa2);
    await order(v, tabId, "Burger");

    await queuedAgo(v, tabId, 6);
    expect((await floorRow(v, mesa2)).signals).toEqual([{ kind: "long_wait", band: "warm" }]);

    await queuedAgo(v, tabId, 20);
    expect((await floorRow(v, mesa2)).signals).toEqual([{ kind: "long_wait", band: "forgotten" }]);

    await inTx(v, (tx) => serveLine(tx, v.cfg, tabId, 1));
    expect((await floorRow(v, mesa2)).signals).toEqual([]);
  });

  it("does not count a held dish as waiting, however long ago it was taken", async () => {
    const v = await setupPartyVenue(suite.db);
    const mesa2 = await v.table("Mesa 2");
    const { partyId, tabId } = await seat(v, mesa2);
    await holdGroup(v, partyId, "Burger");
    await queuedAgo(v, tabId, 20);
    const row = await floorRow(v, mesa2);

    expect(row.signals).toEqual([]);
  });

  it("names the held group and the staff name of a dish that became unavailable in it, cancels nothing, and clears once it is available again", async () => {
    const v = await setupPartyVenue(suite.db);
    const mesa2 = await v.table("Mesa 2");
    const { partyId, tabId } = await seat(v, mesa2);
    // A dish in a fired group that became unavailable is already committed work: no signal for it.
    await orderForParty(v, partyId, ["Agua"], tabId);
    const mains = await holdGroup(v, partyId, "Burger", "Paella");
    const setAvailable = (name: string, available: boolean) =>
      inTx(v, (tx) => updateProduct(tx, v.productId(name), { available }));

    await setAvailable("Burger", false);
    await setAvailable("Agua", false);

    expect((await floorRow(v, mesa2)).signals).toEqual([
      { kind: "held_unavailable", groupId: mains, lineNames: ["Burger"] },
    ]);
    const [group] = await inTx(v, (tx) =>
      tx.select({ state: orderGroups.state }).from(orderGroups).where(eq(orderGroups.id, mains)),
    );
    expect(group!.state).toBe("held");
    const held = await inTx(v, (tx) =>
      tx
        .select({ name: workingOrderLines.name })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.groupId, mains))
        .orderBy(workingOrderLines.lineNo),
    );
    expect(held.map((line) => line.name)).toEqual(["Burger", "Paella"]);

    await setAvailable("Burger", true);

    expect((await floorRow(v, mesa2)).signals).toEqual([]);
  });

  it("gives joined tables the party's signals, and reads the bills a merged-in party kept", async () => {
    const v = await setupPartyVenue(suite.db);
    const bar = await withBar(v);
    const mesa2 = await v.table("Mesa 2");
    const mesa8 = await v.table("Mesa 8");
    const into = await seat(v, mesa2);
    const from = await seat(v, mesa8);
    // Mesa 8 paid for its caña, which is still at the bar when the parties join.
    await order(v, from.tabId, "Caña");
    await pay(v, from.tabId, "3.00");
    await makeReady(v, from.tabId, "Caña");
    await order(v, into.tabId, "Agua");
    const joining = {
      ...(await commandFor(v, into.partyId)),
      bills: "separate" as const,
      otherPartyId: from.partyId,
      expectedOtherPartyRevision: await revisionOf(v, from.partyId),
    };
    await inTx(v, (tx) => joinTables(tx, v.cfg, into.partyId, mesa8, joining));
    expect((await billsOn(v, from.partyId)).map((bill) => bill.status)).toEqual(["settled"]);

    const expected = [
      { kind: "ready", byStation: [{ stationId: bar, stationName: "Barra", count: 1 }] },
    ];
    expect((await floorRow(v, mesa2)).signals).toEqual(expected);
    expect((await floorRow(v, mesa8)).signals).toEqual(expected);
    // The floor's own figures count the kept bill's caña too, beside the party's own agua.
    for (const tableId of [mesa2, mesa8]) {
      expect(await floorRow(v, tableId)).toMatchObject({ pendingToServe: 2, readyToServe: 1 });
    }
  });

  it("keeps a paid bill's dishes in the floor's figures until they are served", async () => {
    const v = await setupPartyVenue(suite.db);
    const mesa2 = await v.table("Mesa 2");
    const { tabId } = await seat(v, mesa2);
    await order(v, tabId, "Caña", "Agua");
    await makeReady(v, tabId, "Caña");
    await pay(v, tabId, "5.00");

    expect(await floorRow(v, mesa2)).toMatchObject({
      hasOpenTab: false,
      pendingToServe: 2,
      readyToServe: 1,
    });

    await inTx(v, (tx) => serveLine(tx, v.cfg, tabId, 1));
    await inTx(v, (tx) => serveLine(tx, v.cfg, tabId, 2));

    expect(await floorRow(v, mesa2)).toMatchObject({ pendingToServe: 0, readyToServe: 0 });
  });

  it("shows a table that needs clearing, with no party at it", async () => {
    const v = await setupPartyVenue(suite.db);
    await inTx(v, (tx) => writeClearingWorkflow(tx, true));
    const mesa2 = await v.table("Mesa 2");
    const { partyId } = await seat(v, mesa2);
    const finish = { partyId, ...(await commandFor(v, partyId)) };
    await inTx(v, (tx) => finishTable(tx, finish));
    const row = await floorRow(v, mesa2);

    expect(row.signals).toEqual([
      { kind: "needs_clearing", since: (await tableNeedsClearingSince(v, mesa2))! },
    ]);
    expect(row.party).toBeNull();
  });

  it("reads every kind of fact once for the whole floor, not once per table", async () => {
    const v = await setupPartyVenue(suite.db);
    const bar = await withBar(v);
    await inTx(v, (tx) => writeReleaseReminderMinutes(tx, 10));
    const lucia = await person(v, "Lucía");
    const seatBusyTable = async (label: string) => {
      const { partyId, tabId } = await seat(v, await v.table(label));
      await order(v, tabId, "Caña");
      await makeReady(v, tabId, "Caña");
      await holdGroup(v, partyId, "Burger");
      await askForBill(v, partyId);
      await inTx(v, (tx) =>
        saveDraft(tx, v.cfg, partyId, lucia, {
          draftId: null,
          revision: 0,
          lines: [draftLine(v, "Agua")],
        }),
      );
    };
    await seatBusyTable("Mesa 1");
    const statements = async () => {
      const prepare = vi.spyOn(DatabaseSync.prototype, "prepare");
      try {
        const rows = await inTx(v, (tx) => listTablesWithState(tx, v.cfg));
        return { count: prepare.mock.calls.length, rows };
      } finally {
        prepare.mockRestore();
      }
    };
    const one = await statements();
    await seatBusyTable("Mesa 2");
    await seatBusyTable("Mesa 3");
    const three = await statements();

    for (const row of three.rows) {
      expect(row.signals.map((signal) => signal.kind)).toEqual([
        "unsent_draft",
        "ready",
        "bill_requested",
      ]);
    }
    expect(three.rows[0]!.signals[1]).toEqual({
      kind: "ready",
      byStation: [{ stationId: bar, stationName: "Barra", count: 1 }],
    });
    expect(three.count).toBe(one.count);
  });
});

describe("the counter's tab list", () => {
  it("shows a counter tab without a table, labelled Ana, with its ready and long-wait signals", async () => {
    const v = await setupPartyVenue(suite.db);
    const bar = await withBar(v);
    const mesa5 = await v.table("Mesa 5");
    const { partyId, tabId } = await seat(v, mesa5);
    await nameParty(v, partyId, "Ana");
    await order(v, tabId, "Burger", "Caña");
    const counterBill = await split(v, partyId, tabId, [2]);
    const moving = { ...(await commandFor(v, partyId)), bills: "separate" as const, partyId };
    await inTx(v, (tx) =>
      moveBill(tx, v.cfg, counterBill, { counter: { zoneId: v.counter.zoneId } }, moving),
    );
    await makeReady(v, counterBill, "Caña");
    await queuedAgo(v, counterBill, 20);

    const listed = await listHeldOrders({ db: v.db }, v.cfg);
    const ana = listed.find((row) => row.id === counterBill)!;

    expect(ana).toMatchObject({ label: "Ana", partyId: null });
    expect(ana.signals).toEqual([
      { kind: "ready", byStation: [{ stationId: bar, stationName: "Barra", count: 1 }] },
      { kind: "long_wait", band: "forgotten" },
    ]);
    expect(listed.find((row) => row.id === tabId)!.signals).toEqual([]);
  });
});

describe("a bill request", () => {
  it("stays while one of two bills is unpaid, and goes when a bill payment settles the other", async () => {
    const v = await setupPartyVenue(suite.db);
    const mesa2 = await v.table("Mesa 2");
    const { partyId, tabId } = await seat(v, mesa2);
    await order(v, tabId, "Burger", "Caña");
    const other = await split(v, partyId, tabId, [2]);
    const requestedAt = await askForBill(v, partyId);

    await pay(v, tabId, "12.00");

    expect(await billRequestedAt(v, partyId)).toBe(requestedAt);
    expect((await floorRow(v, mesa2)).signals).toContainEqual({
      kind: "bill_requested",
      requestedAt,
    });

    await cashContribution(v, other, "3.00");

    expect(await billRequestedAt(v, partyId)).toBeNull();
  });

  it("stays while a merged-in party's bill still owes, until that bill is paid", async () => {
    const v = await setupPartyVenue(suite.db);
    const mesa2 = await v.table("Mesa 2");
    const mesa8 = await v.table("Mesa 8");
    const into = await seat(v, mesa2);
    const from = await seat(v, mesa8);
    await order(v, into.tabId, "Burger", "Agua");
    const stray = await split(v, into.partyId, into.tabId, [2]);
    await order(v, from.tabId, "Caña");
    await pay(v, from.tabId, "3.00");
    const joining = {
      ...(await commandFor(v, into.partyId)),
      bills: "separate" as const,
      otherPartyId: from.partyId,
      expectedOtherPartyRevision: await revisionOf(v, from.partyId),
    };
    await inTx(v, (tx) => joinTables(tx, v.cfg, into.partyId, mesa8, joining));
    // By hand: a merge moves open and presented bills across (P13), so no product path leaves an
    // owing bill on the absorbed party today; D2 says such a bill counts until it is paid.
    await inTx(v, (tx) =>
      tx.update(workingOrders).set({ partyId: from.partyId }).where(eq(workingOrders.id, stray)),
    );
    const requestedAt = await askForBill(v, into.partyId);

    await pay(v, into.tabId, "12.00");

    expect(await billRequestedAt(v, into.partyId)).toBe(requestedAt);
  });
});

async function tableOf(v: PartyVenue, partyId: string): Promise<string> {
  const [row] = await inTx(v, (tx) =>
    tx
      .select({ tableId: partyTables.tableId })
      .from(partyTables)
      .where(and(eq(partyTables.partyId, partyId), isNull(partyTables.leftAt))),
  );
  return row!.tableId;
}

async function tableNeedsClearingSince(v: PartyVenue, tableId: string): Promise<string | null> {
  const [row] = await inTx(v, (tx) =>
    tx
      .select({ since: diningTables.needsClearingSince })
      .from(diningTables)
      .where(eq(diningTables.id, tableId)),
  );
  return row!.since;
}

async function billsOn(v: PartyVenue, partyId: string) {
  return inTx(v, (tx) =>
    tx
      .select({ status: workingOrders.status })
      .from(workingOrders)
      .where(eq(workingOrders.partyId, partyId)),
  );
}

function draftLine(v: PartyVenue, name: string) {
  return {
    menuItemId: v.item(name),
    variantId: null,
    menuVersionId: null,
    options: [],
    extras: [],
    note: null,
    quantity: "1",
    courseId: null,
    noMerge: false,
  };
}
