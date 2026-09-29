import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  billPaymentRefunds,
  billPayments,
  captureError,
  diningTables,
  serviceCommands,
  tableServiceStatuses,
  parties,
  partyTables,
  workingOrders,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { writeClearingWorkflow } from "@waitron/venue-service";
import { MONEY_SCALE, decimal, sumDecimals, toScale } from "@waitron/shared";
import type { TillConfig } from "./till-config.js";
import {
  addTabRound,
  joinTable,
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
import {
  OPERATOR,
  activeTablesOf,
  commandFor,
  floorRow,
  inTx,
  order,
  orderForParty,
  partyRow,
  pay,
  placeByHand,
  revisionOf,
  seat,
  setupPartyVenue,
  split,
  statusOf,
  tableRow,
  type PartyVenue,
} from "./testing/party-venue.js";
import {
  checkAndBumpParty,
  finishTable,
  markTableCleared,
  readPartyBills,
  runServiceCommand,
  partyFamily,
} from "./parties.js";
import "./errors.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

/** The party a table belongs to, while it belongs to one. */
async function partyForTable(
  tx: Transaction,
  tableId: string,
): Promise<{ partyId: string; revision: number } | null> {
  const [row] = await tx
    .select({ partyId: parties.id, revision: parties.revision })
    .from(partyTables)
    .innerJoin(parties, eq(parties.id, partyTables.partyId))
    .where(and(eq(partyTables.tableId, tableId), isNull(partyTables.leftAt)));
  return row ?? null;
}

async function membershipsOf(partyId: string) {
  return inTx(suite, (tx) => tx.select().from(partyTables).where(eq(partyTables.partyId, partyId)));
}

async function giveStatus(tableIds: string[]): Promise<string> {
  return inTx(suite, async (tx) => {
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

async function join(
  cfg: TillConfig,
  partyId: string,
  tabId: string,
  tableId: string,
): Promise<void> {
  const command = await commandFor(suite, partyId);
  await inTx(suite, (tx) => joinTable(tx, cfg, tabId, tableId, command));
}

/** Merges party `from`'s tab into `into`'s, as the till's merge does. */
async function merge(
  cfg: TillConfig,
  into: { partyId: string; tabId: string },
  from: { partyId: string; tabId: string },
  freeSourceTable = false,
): Promise<void> {
  const expectedPartyRevision = await revisionOf(suite, into.partyId);
  const expectedSourcePartyRevision = await revisionOf(suite, from.partyId);
  await inTx(suite, (tx) =>
    mergeTabs(tx, cfg, into.tabId, from.tabId, {
      freeSourceTable,
      expectedPartyRevision,
      expectedSourcePartyRevision,
      operatorId: OPERATOR,
    }),
  );
}

async function partyIdOf(orderId: string): Promise<string | null> {
  const [row] = await inTx(suite, (tx) =>
    tx
      .select({ partyId: workingOrders.partyId })
      .from(workingOrders)
      .where(eq(workingOrders.id, orderId)),
  );
  return row!.partyId;
}

async function collectByHand(orderId: string): Promise<void> {
  await inTx(suite, (tx) =>
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
  it("opens a party, one membership and a tab on the party", async () => {
    const venue = await setupPartyVenue(suite.db);
    const mesa4 = await venue.table("Mesa 4");

    const seated = await seat(venue, mesa4, 3);

    expect(seated.revision).toBe(0);
    expect(await partyRow(suite, seated.partyId)).toMatchObject({
      state: "open",
      guestCount: 3,
      openedBy: OPERATOR,
      revision: 0,
    });
    const memberships = await membershipsOf(seated.partyId);
    expect(memberships).toHaveLength(1);
    expect(memberships[0]).toMatchObject({ tableId: mesa4, leftAt: null });
    expect((await tableRow(suite, mesa4)).tabId).toBe(seated.tabId);
    const [tab] = await inTx(suite, (tx) =>
      tx.select().from(workingOrders).where(eq(workingOrders.id, seated.tabId)),
    );
    expect(tab).toMatchObject({ status: "open", partyId: seated.partyId });
    expect(await inTx(suite, (tx) => partyForTable(tx, mesa4))).toEqual({
      partyId: seated.partyId,
      revision: 0,
    });
  });

  it("records no guest count when none is given", async () => {
    const venue = await setupPartyVenue(suite.db);
    const seated = await seat(venue, await venue.table("Mesa 4"), null);
    expect((await partyRow(suite, seated.partyId)).guestCount).toBeNull();
  });

  it("refuses seating an occupied table with the occupied-table code, and opens no second party", async () => {
    const venue = await setupPartyVenue(suite.db);
    const mesa4 = await venue.table("Mesa 4");
    await seat(venue, mesa4, 3);

    const error = await captureError(() => seat(venue, mesa4, 2));

    expect(error).toMatchObject({ code: "tab.already_open", params: { tableId: mesa4 } });
    expect(await inTx(suite, (tx) => tx.select().from(parties))).toHaveLength(1);
  });

  it("gives no party for a table nobody is seated at", async () => {
    const venue = await setupPartyVenue(suite.db);
    expect(await inTx(suite, (tx) => partyForTable(tx, randomUUID()))).toBeNull();
    expect(await inTx(suite, (tx) => partyForTable(tx, "not-an-id"))).toBeNull();
    const mesa4 = await venue.table("Mesa 4");
    expect(await inTx(suite, (tx) => partyForTable(tx, mesa4))).toBeNull();
  });
});

describe("related bills", () => {
  it("lists the tab and a check split from it, with what each still owes", async () => {
    const venue = await setupPartyVenue(suite.db);
    const mesa4 = await venue.table("Mesa 4");
    const { partyId, tabId } = await seat(venue, mesa4, 2);
    await order(venue, tabId, "Burger", "Vino", "Agua");
    const checkId = await split(venue, partyId, tabId, [2]);

    expect(await partyIdOf(checkId)).toBe(partyId);
    const before = await inTx(suite, (tx) => readPartyBills(tx, partyId));
    expect(before).toEqual([
      {
        workingOrderId: tabId,
        partyId,
        label: null,
        status: "open",
        total: "14.00",
        outstanding: "14.00",
        hasPayments: false,
        receiptAvailable: false,
      },
      {
        workingOrderId: checkId,
        partyId,
        // `splitOffCheck` names a check after its table.
        label: "Mesa 4",
        status: "open",
        total: "30.00",
        outstanding: "30.00",
        hasPayments: false,
        receiptAvailable: false,
      },
    ]);
    expect(total(before)).toBe("44.00");
    expect((await floorRow(venue, mesa4)).party).toMatchObject({
      id: partyId,
      outstanding: "44.00",
      billCount: 2,
    });

    await pay(venue, tabId, "14.00");

    const after = await inTx(suite, (tx) => readPartyBills(tx, partyId));
    expect(after.find((bill) => bill.workingOrderId === tabId)).toMatchObject({
      status: "settled",
      total: "14.00",
      outstanding: "0.00",
      receiptAvailable: true,
    });
    expect(total(after)).toBe("30.00");
    expect((await partyRow(suite, partyId)).state).toBe("open");
    expect(await inTx(suite, (tx) => partyForTable(tx, mesa4))).toMatchObject({ partyId });
    const floor = await floorRow(venue, mesa4);
    expect(floor.state).toBe("open-tab");
    expect(floor.party).toMatchObject({ id: partyId, state: "open", outstanding: "30.00" });
  });

  it("lists nothing for a party with no bills", async () => {
    const lone = await inTx(suite, async (tx) => {
      const [row] = await tx.insert(parties).values({ openedBy: OPERATOR }).returning();
      return row!.id;
    });
    expect(await inTx(suite, (tx) => readPartyBills(tx, lone))).toEqual([]);
  });

  it("lists an abandoned bill as owing nothing", async () => {
    const venue = await setupPartyVenue(suite.db);
    const { partyId, tabId } = await seat(venue, await venue.table("Mesa 4"));
    await inTx(suite, (tx) =>
      tx.update(workingOrders).set({ status: "abandoned" }).where(eq(workingOrders.id, tabId)),
    );
    expect(await inTx(suite, (tx) => readPartyBills(tx, partyId))).toEqual([
      expect.objectContaining({ status: "abandoned", total: "0.00", outstanding: "0.00" }),
    ]);
  });
});

describe("finish table", () => {
  it("is refused while a check is unpaid, and changes nothing", async () => {
    const venue = await setupPartyVenue(suite.db);
    const mesa4 = await venue.table("Mesa 4");
    const { partyId, tabId } = await seat(venue, mesa4, 2);
    await order(venue, tabId, "Burger", "Vino", "Agua");
    const checkId = await split(venue, partyId, tabId, [2]);
    await pay(venue, tabId, "14.00");

    const error = await captureError(() =>
      inTx(suite, (tx) =>
        finishTable(tx, { partyId, expectedPartyRevision: 1, operatorId: OPERATOR }),
      ),
    );

    expect(error).toMatchObject({ code: "party.bill_outstanding", params: { partyId } });
    expect(await partyRow(suite, partyId)).toMatchObject({
      state: "open",
      revision: 1,
      closedAt: null,
    });
    expect((await membershipsOf(partyId))[0]!.leftAt).toBeNull();
    expect(await statusOf(suite, checkId)).toBe("open");
  });

  it("closes the party and its membership, frees the table and clears its status once everything is paid", async () => {
    const venue = await setupPartyVenue(suite.db);
    const mesa4 = await venue.table("Mesa 4");
    const { partyId, tabId } = await seat(venue, mesa4, 2);
    await order(venue, tabId, "Burger", "Vino", "Agua");
    const checkId = await split(venue, partyId, tabId, [2]);
    await pay(venue, tabId, "14.00");
    await pay(venue, checkId, "30.00");
    await giveStatus([mesa4]);

    const result = await inTx(suite, (tx) =>
      finishTable(tx, { partyId, expectedPartyRevision: 1, operatorId: OPERATOR }),
    );

    expect(result).toEqual({ state: "closed" });
    const closed = await partyRow(suite, partyId);
    expect(closed).toMatchObject({ state: "closed", closedBy: OPERATOR, revision: 2 });
    expect(closed.closedAt).not.toBeNull();
    expect((await membershipsOf(partyId))[0]!.leftAt).not.toBeNull();
    expect(await tableRow(suite, mesa4)).toMatchObject({ tabId: null, statusId: null });
    expect(await inTx(suite, (tx) => partyForTable(tx, mesa4))).toBeNull();
  });

  it("abandons an empty open tab rather than counting it as owed", async () => {
    const venue = await setupPartyVenue(suite.db);
    const mesa4 = await venue.table("Mesa 4");
    const { partyId, tabId } = await seat(venue, mesa4);

    expect(
      await inTx(suite, (tx) =>
        finishTable(tx, { partyId, expectedPartyRevision: 0, operatorId: OPERATOR }),
      ),
    ).toEqual({ state: "closed" });
    expect(await statusOf(suite, tabId)).toBe("abandoned");
  });

  it("is refused with a stale party revision, and changes nothing", async () => {
    const venue = await setupPartyVenue(suite.db);
    const { partyId } = await seat(venue, await venue.table("Mesa 4"));
    await inTx(suite, (tx) => checkAndBumpParty(tx, partyId, 0, "open"));

    const error = await captureError(() =>
      inTx(suite, (tx) =>
        finishTable(tx, { partyId, expectedPartyRevision: 0, operatorId: OPERATOR }),
      ),
    );

    expect(error).toMatchObject({ code: "party.out_of_date", params: { partyId, revision: 1 } });
    expect(await partyRow(suite, partyId)).toMatchObject({ state: "open", revision: 1 });
  });

  it("is refused for a party that is not open, or does not exist", async () => {
    const venue = await setupPartyVenue(suite.db);
    const { partyId } = await seat(venue, await venue.table("Mesa 4"));
    await inTx(suite, (tx) =>
      finishTable(tx, { partyId, expectedPartyRevision: 0, operatorId: OPERATOR }),
    );

    const again = await captureError(() =>
      inTx(suite, (tx) =>
        finishTable(tx, { partyId, expectedPartyRevision: 1, operatorId: OPERATOR }),
      ),
    );
    expect(again).toMatchObject({ code: "party.not_open", params: { partyId } });
    const unknown = randomUUID();
    const absent = await captureError(() =>
      inTx(suite, (tx) =>
        finishTable(tx, {
          partyId: unknown,
          expectedPartyRevision: 0,
          operatorId: OPERATOR,
        }),
      ),
    );
    expect(absent).toMatchObject({ code: "party.not_open", params: { partyId: unknown } });
  });

  it("answers a party that is not open as not open, even when the revision sent is stale too", async () => {
    const venue = await setupPartyVenue(suite.db);
    const { partyId } = await seat(venue, await venue.table("Mesa 4"));
    await inTx(suite, (tx) =>
      finishTable(tx, { partyId, expectedPartyRevision: 0, operatorId: OPERATOR }),
    );

    const error = await captureError(() =>
      inTx(suite, (tx) =>
        finishTable(tx, { partyId, expectedPartyRevision: 0, operatorId: OPERATOR }),
      ),
    );

    expect(error).toMatchObject({ code: "party.not_open", params: { partyId } });
  });

  it("closes a party that no longer holds any table", async () => {
    const venue = await setupPartyVenue(suite.db);
    const mesa4 = await venue.table("Mesa 4");
    const { partyId } = await seat(venue, mesa4);
    await inTx(suite, (tx) =>
      tx
        .update(partyTables)
        .set({ leftAt: new Date().toISOString() })
        .where(eq(partyTables.partyId, partyId)),
    );

    expect(
      await inTx(suite, (tx) =>
        finishTable(tx, { partyId, expectedPartyRevision: 0, operatorId: OPERATOR }),
      ),
    ).toEqual({ state: "closed" });
  });

  it("frees every table of a joined party and clears each one's status", async () => {
    const venue = await setupPartyVenue(suite.db);
    const mesa4 = await venue.table("Mesa 4");
    const mesa5 = await venue.table("Mesa 5");
    const { partyId, tabId } = await seat(venue, mesa4);
    await join(venue.cfg, partyId, tabId, mesa5);
    await giveStatus([mesa4, mesa5]);

    await inTx(suite, (tx) =>
      finishTable(tx, { partyId, expectedPartyRevision: 1, operatorId: OPERATOR }),
    );

    for (const table of [mesa4, mesa5]) {
      expect(await tableRow(suite, table)).toMatchObject({ tabId: null, statusId: null });
      expect(await inTx(suite, (tx) => partyForTable(tx, table))).toBeNull();
    }
    expect((await membershipsOf(partyId)).every((m) => m.leftAt !== null)).toBe(true);
  });
});

describe("a table needs clearing, not its party (P8, P9)", () => {
  let v: PartyVenue;
  beforeEach(async () => {
    v = await setupPartyVenue(suite.db);
  });
  // Every revision is read BEFORE the transaction opens: a read through `inTx` inside a running
  // body asks for the write lock it holds, which the queue refuses.
  async function finish(partyId: string) {
    const expectedPartyRevision = await revisionOf(v, partyId);
    return inTx(v, (tx) =>
      finishTable(tx, { partyId, expectedPartyRevision, operatorId: OPERATOR }),
    );
  }
  async function condition(tableId: string) {
    return (await floorRow(v, tableId)).condition;
  }
  async function partyCount(): Promise<number> {
    return (await inTx(v, (tx) => tx.select({ id: parties.id }).from(parties))).length;
  }

  it("closes the party at Finish and leaves each of its tables needing clearing, with no party on them", async () => {
    await inTx(v, (tx) => writeClearingWorkflow(tx, true));
    const mesa4 = await v.table("Mesa 4c");
    const mesa5 = await v.table("Mesa 5c");
    const { partyId, tabId } = await seat(v, mesa4);
    await join(v.cfg, partyId, tabId, mesa5);

    expect(await finish(partyId)).toEqual({ state: "closed" });

    expect(await partyRow(v, partyId)).toMatchObject({ state: "closed", closedBy: OPERATOR });
    expect(await activeTablesOf(v, partyId)).toEqual([]);
    for (const table of [mesa4, mesa5]) {
      expect(await tableRow(v, table)).toMatchObject({ tabId: null, statusId: null });
      expect((await tableRow(v, table)).needsClearingSince).not.toBeNull();
      expect(await condition(table)).toBe("needs_clearing");
      expect((await floorRow(v, table)).party).toBeNull();
    }
  });

  it("refuses seating a table that needs clearing until it is cleared, one table at a time", async () => {
    await inTx(v, (tx) => writeClearingWorkflow(tx, true));
    const mesa6 = await v.table("Mesa 6c");
    const mesa7 = await v.table("Mesa 7c");
    const { partyId, tabId } = await seat(v, mesa6);
    await join(v.cfg, partyId, tabId, mesa7);
    await finish(partyId);
    const partiesBefore = await partyCount();

    const refused = await captureError(() => seat(v, mesa6));
    expect(refused).toMatchObject({ code: "table.needs_clearing", params: { tableId: mesa6 } });
    expect(await partyCount()).toBe(partiesBefore);
    expect(await condition(mesa6)).toBe("needs_clearing");

    await inTx(v, (tx) => markTableCleared(tx, mesa6));
    expect(await condition(mesa6)).toBe("free");
    expect((await tableRow(v, mesa6)).needsClearingSince).toBeNull();
    expect(await condition(mesa7)).toBe("needs_clearing");
    await seat(v, mesa6);
    expect(await condition(mesa6)).toBe("held");
  });

  it("refuses a tab opened straight onto a table that needs clearing, as the till's free-table route and a booking do", async () => {
    await inTx(v, (tx) => writeClearingWorkflow(tx, true));
    const mesa4 = await v.table("Mesa 4c");
    const { partyId } = await seat(v, mesa4);
    await finish(partyId);

    expect(
      await captureError(() => inTx(v, (tx) => openTab(tx, v.cfg, { tableId: mesa4 }))),
    ).toMatchObject({ code: "table.needs_clearing", params: { tableId: mesa4 } });
    expect(await tableRow(v, mesa4)).toMatchObject({ tabId: null });
    expect(await condition(mesa4)).toBe("needs_clearing");
  });

  it("frees the tables at once when the venue's clearing setting is off (P8)", async () => {
    await inTx(v, (tx) => writeClearingWorkflow(tx, false));
    const mesa8 = await v.table("Mesa 8c");
    const { partyId } = await seat(v, mesa8);
    expect(await finish(partyId)).toEqual({ state: "closed" });
    expect(await condition(mesa8)).toBe("free");
    expect((await tableRow(v, mesa8)).needsClearingSince).toBeNull();
  });

  it("frees the tables at once in a venue with no service settings row", async () => {
    const mesa8 = await v.table("Mesa 8c");
    const { partyId } = await seat(v, mesa8);
    await finish(partyId);
    expect(await condition(mesa8)).toBe("free");
  });

  it("clears a table that does not need clearing without complaint, and changes nothing", async () => {
    const mesa9 = await v.table("Mesa 9c");
    const mesa11 = await v.table("Mesa 11c");
    const { partyId, revision } = await seat(v, mesa9);
    await inTx(v, (tx) => markTableCleared(tx, mesa9));
    await inTx(v, (tx) => markTableCleared(tx, mesa11));
    expect(await condition(mesa9)).toBe("held");
    expect(await condition(mesa11)).toBe("free");
    expect(await revisionOf(v, partyId)).toBe(revision);
  });

  it("refuses clearing a table that does not exist", async () => {
    const unknown = randomUUID();
    expect(await captureError(() => inTx(v, (tx) => markTableCleared(tx, unknown)))).toMatchObject({
      code: "table.not_found",
      params: { tableId: unknown },
    });
  });

  it("clears the table's manual status at Finish, as today", async () => {
    await inTx(v, (tx) => writeClearingWorkflow(tx, true));
    const mesa10 = await v.table("Mesa 10c");
    const { partyId } = await seat(v, mesa10);
    await giveStatus([mesa10]);
    await finish(partyId);
    expect((await tableRow(v, mesa10)).statusId).toBeNull();
  });
});

describe("the next party", () => {
  it("starts a new party whose bills list is empty", async () => {
    const venue = await setupPartyVenue(suite.db);
    const mesa4 = await venue.table("Mesa 4");
    const first = await seat(venue, mesa4, 2);
    await order(venue, first.tabId, "Burger");
    await pay(venue, first.tabId, "12.00");
    await inTx(suite, (tx) =>
      finishTable(tx, {
        partyId: first.partyId,
        expectedPartyRevision: 0,
        operatorId: OPERATOR,
      }),
    );

    const next = await seat(venue, mesa4, 4);

    expect(next.partyId).not.toBe(first.partyId);
    const bills = await inTx(suite, (tx) => readPartyBills(tx, next.partyId));
    expect(bills.map((bill) => bill.workingOrderId)).toEqual([next.tabId]);
    expect(bills[0]).toMatchObject({ status: "open", total: "0.00" });
  });
});

describe("joined tables (Mesa 4 and Mesa 5)", () => {
  async function joined() {
    const venue = await setupPartyVenue(suite.db);
    const mesa4 = await venue.table("Mesa 4");
    const mesa5 = await venue.table("Mesa 5");
    const seated = await seat(venue, mesa4, 6);
    await join(venue.cfg, seated.partyId, seated.tabId, mesa5);
    return { venue, mesa4, mesa5, ...seated };
  }

  it("gives both tables one party, and refuses seating the joined table", async () => {
    const { venue, mesa4, mesa5, partyId, tabId } = await joined();

    const memberships = await membershipsOf(partyId);
    expect(memberships.map((m) => [m.tableId, m.leftAt])).toEqual(
      expect.arrayContaining([
        [mesa4, null],
        [mesa5, null],
      ]),
    );
    expect(memberships).toHaveLength(2);
    expect(await inTx(suite, (tx) => partyForTable(tx, mesa4))).toEqual({ partyId, revision: 1 });
    expect(await inTx(suite, (tx) => partyForTable(tx, mesa5))).toEqual({ partyId, revision: 1 });
    expect((await tableRow(suite, mesa5)).tabId).toBe(tabId);

    expect(await captureError(() => seat(venue, mesa5))).toMatchObject({
      code: "tab.already_open",
    });
    expect(await inTx(suite, (tx) => tx.select().from(parties))).toHaveLength(1);
    for (const table of [mesa4, mesa5]) {
      expect((await floorRow(venue, table)).party).toMatchObject({
        id: partyId,
        tableIds: expect.arrayContaining([mesa4, mesa5]),
      });
    }
  });

  it("keeps both tables seated after payment, and a dessert round lands on the same party for both", async () => {
    const { venue, mesa4, mesa5, partyId, tabId } = await joined();
    await order(venue, tabId, "Burger");
    await pay(venue, tabId, "12.00");

    for (const table of [mesa4, mesa5]) {
      expect((await floorRow(venue, table)).state).toBe("open-tab");
    }

    const { tabId: dessertTab } = await orderForParty(venue, partyId, ["Flan"]);

    for (const table of [mesa4, mesa5]) {
      expect((await tableRow(suite, table)).tabId).toBe(dessertTab);
      expect(await inTx(suite, (tx) => partyForTable(tx, table))).toMatchObject({ partyId });
    }
    expect(await partyIdOf(dessertTab)).toBe(partyId);
  });

  it("lets the next party at either table see no earlier bill once the party finishes", async () => {
    const { venue, mesa4, mesa5, partyId, tabId } = await joined();
    await order(venue, tabId, "Burger");
    await pay(venue, tabId, "12.00");
    await inTx(suite, (tx) =>
      finishTable(tx, { partyId, expectedPartyRevision: 1, operatorId: OPERATOR }),
    );

    for (const table of [mesa4, mesa5]) {
      expect((await floorRow(venue, table)).state).toBe("free");
      const next = await seat(venue, table);
      const bills = await inTx(suite, (tx) => readPartyBills(tx, next.partyId));
      expect(bills.map((bill) => bill.workingOrderId)).toEqual([next.tabId]);
    }
  });

  it("gives an unjoined table with items exactly one new party holding them, and the party keeps the rest", async () => {
    const { venue, mesa4, mesa5, partyId, tabId } = await joined();
    await order(venue, tabId, "Burger", "Vino", "Agua");
    const command = await commandFor(suite, partyId);

    const { tabId: mesa5Tab } = await inTx(suite, (tx) =>
      unjoinTable(tx, venue.cfg, tabId, mesa5, [{ lineNo: 2 }, { lineNo: 3 }], command),
    );

    const all = await inTx(suite, (tx) => tx.select().from(parties));
    expect(all).toHaveLength(2);
    const fresh = all.find((party) => party.id !== partyId)!;
    expect(fresh).toMatchObject({ state: "open", openedBy: OPERATOR, guestCount: null });
    expect(await partyIdOf(mesa5Tab!)).toBe(fresh.id);
    expect(await inTx(suite, (tx) => partyForTable(tx, mesa5))).toMatchObject({
      partyId: fresh.id,
    });
    expect(await inTx(suite, (tx) => partyForTable(tx, mesa4))).toMatchObject({ partyId });
    expect(
      (await inTx(suite, (tx) => readPartyBills(tx, fresh.id))).map((bill) => bill.total),
    ).toEqual(["32.00"]);
    expect(
      (await inTx(suite, (tx) => readPartyBills(tx, partyId))).map((bill) => bill.total),
    ).toEqual(["12.00"]);
    const memberships = await membershipsOf(partyId);
    expect(memberships.find((m) => m.tableId === mesa5)!.leftAt).not.toBeNull();
    expect(memberships.find((m) => m.tableId === mesa4)!.leftAt).toBeNull();
  });

  it("keeps both tables in the party when a split check at no table is merged back into the tab", async () => {
    const { venue, mesa4, mesa5, partyId, tabId } = await joined();
    await order(venue, tabId, "Burger", "Vino");
    const checkId = await split(venue, partyId, tabId, [2]);
    const command = await commandFor(suite, partyId);

    await inTx(suite, (tx) =>
      mergeTabs(tx, venue.cfg, tabId, checkId, { freeSourceTable: true, ...command }),
    );

    for (const table of [mesa4, mesa5]) {
      expect((await tableRow(suite, table)).tabId).toBe(tabId);
      expect(await inTx(suite, (tx) => partyForTable(tx, table))).toMatchObject({ partyId });
    }
    expect(await statusOf(suite, checkId)).toBe("abandoned");
  });

  it("moves the party from both tables to Mesa 7 on the same party", async () => {
    const { venue, mesa4, mesa5, partyId, tabId } = await joined();
    const mesa7 = await venue.table("Mesa 7");
    const command = await commandFor(suite, partyId);

    await inTx(suite, (tx) => moveTab(tx, venue.cfg, tabId, mesa7, command));

    const memberships = await membershipsOf(partyId);
    expect(memberships.filter((m) => m.leftAt === null).map((m) => m.tableId)).toEqual([mesa7]);
    expect(memberships).toHaveLength(3);
    expect(await inTx(suite, (tx) => partyForTable(tx, mesa7))).toMatchObject({ partyId });
    for (const table of [mesa4, mesa5]) {
      expect(await inTx(suite, (tx) => partyForTable(tx, table))).toBeNull();
      expect((await floorRow(venue, table)).state).toBe("free");
    }
    expect((await tableRow(suite, mesa7)).tabId).toBe(tabId);
  });
});

describe("a paid party (paying changes no table of the party)", () => {
  async function paid() {
    const venue = await setupPartyVenue(suite.db);
    const mesa4 = await venue.table("Mesa 4");
    const seated = await seat(venue, mesa4, 2);
    await order(venue, seated.tabId, "Burger");
    await pay(venue, seated.tabId, "12.00");
    return { venue, mesa4, ...seated };
  }

  it("moves from Mesa 4 to Mesa 7 on the same party, leaving the settled tab as it was", async () => {
    const { venue, mesa4, partyId, tabId } = await paid();
    const mesa7 = await venue.table("Mesa 7");
    const command = await commandFor(suite, partyId);
    const [settledBefore] = await inTx(suite, (tx) =>
      tx.select().from(workingOrders).where(eq(workingOrders.id, tabId)),
    );

    await inTx(suite, (tx) => moveTab(tx, venue.cfg, tabId, mesa7, command));

    expect(await inTx(suite, (tx) => partyForTable(tx, mesa4))).toBeNull();
    expect((await floorRow(venue, mesa4)).state).toBe("free");
    expect(await inTx(suite, (tx) => partyForTable(tx, mesa7))).toEqual({
      partyId,
      revision: command.expectedPartyRevision + 1,
    });
    expect((await tableRow(suite, mesa7)).tabId).toBe(tabId);
    const [settledAfter] = await inTx(suite, (tx) =>
      tx.select().from(workingOrders).where(eq(workingOrders.id, tabId)),
    );
    expect(settledAfter).toEqual(settledBefore);
  });

  it("joins Mesa 5, and the next round opens the party's next tab on both tables", async () => {
    const { venue, mesa4, partyId, tabId } = await paid();
    const mesa5 = await venue.table("Mesa 5");
    const command = await commandFor(suite, partyId);

    await inTx(suite, (tx) => joinTable(tx, venue.cfg, tabId, mesa5, command));

    for (const table of [mesa4, mesa5]) {
      expect(await inTx(suite, (tx) => partyForTable(tx, table))).toEqual({
        partyId,
        revision: command.expectedPartyRevision + 1,
      });
      expect((await tableRow(suite, table)).tabId).toBe(tabId);
    }
    const { tabId: dessertTab } = await orderForParty(venue, partyId, ["Flan"]);
    expect(await partyIdOf(dessertTab)).toBe(partyId);
    for (const table of [mesa4, mesa5]) {
      expect((await tableRow(suite, table)).tabId).toBe(dessertTab);
    }
  });

  it("refuses moving or joining with a settled tab the party has moved on from", async () => {
    const { venue, partyId, tabId } = await paid();
    await orderForParty(venue, partyId, ["Flan"]);
    const mesa7 = await venue.table("Mesa 7");
    const command = await commandFor(suite, partyId);

    for (const run of [
      (tx: Transaction) => moveTab(tx, venue.cfg, tabId, mesa7, command),
      (tx: Transaction) => joinTable(tx, venue.cfg, tabId, mesa7, command),
    ]) {
      expect(await captureError(() => inTx(suite, run))).toMatchObject({
        code: "tab.not_open",
        params: { tabId },
      });
    }
  });

  it("still refuses merging or transferring with a settled tab", async () => {
    const { venue, partyId, tabId } = await paid();
    const other = await seat(venue, await venue.table("Mesa 6"));
    await order(venue, other.tabId, "Flan");
    const revisions = {
      expectedPartyRevision: await revisionOf(suite, partyId),
      expectedSourcePartyRevision: await revisionOf(suite, other.partyId),
      operatorId: OPERATOR,
    };

    expect(
      await captureError(() =>
        inTx(suite, (tx) =>
          mergeTabs(tx, venue.cfg, tabId, other.tabId, { freeSourceTable: true, ...revisions }),
        ),
      ),
    ).toMatchObject({ code: "tab.not_open" });
    expect(
      await captureError(() =>
        inTx(suite, (tx) =>
          transferLines(tx, venue.cfg, other.tabId, tabId, [{ lineNo: 1 }], revisions),
        ),
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
    const venue = await setupPartyVenue(suite.db);
    const mesa4 = await venue.table("Mesa 4");
    const mesa5 = await venue.table("Mesa 5");
    const { partyId, tabId } = await seat(venue, mesa4);
    await order(venue, tabId, "Burger", "Vino");
    const checkId = await split(venue, partyId, tabId, [2]);

    const parkedId = randomUUID();
    await parkOrder({ db: suite.db }, venue.cfg, {
      id: parkedId,
      lines: [{ menuItemId: venue.item("Agua"), quantity: "1" }],
      zoneId: venue.tables.zoneId,
    });
    let otherPartyId: string | null = null;
    let mesa5TabId: string | null = null;
    if (mesa5Party === "has left the party") {
      await join(venue.cfg, partyId, tabId, mesa5);
      const command = await commandFor(suite, partyId);
      await inTx(suite, (tx) => unjoinTable(tx, venue.cfg, tabId, mesa5, undefined, command));
      expect(
        await captureError(() => inTx(suite, (tx) => joinTable(tx, venue.cfg, parkedId, mesa5))),
      ).toMatchObject({ code: "tab.not_table_tab", params: { tabId: parkedId } });
    } else {
      const other = await seat(venue, mesa5);
      otherPartyId = other.partyId;
      mesa5TabId = other.tabId;
      const expectedSourcePartyRevision = await revisionOf(suite, other.partyId);
      expect(
        await captureError(() =>
          inTx(suite, (tx) =>
            mergeTabs(tx, venue.cfg, parkedId, other.tabId, {
              freeSourceTable: false,
              expectedSourcePartyRevision,
              operatorId: OPERATOR,
            }),
          ),
        ),
      ).toMatchObject({ code: "tab.not_table_tab", params: { tabId: parkedId } });
      expect(await statusOf(suite, other.tabId)).toBe("open");
      expect(await revisionOf(suite, other.partyId)).toBe(expectedSourcePartyRevision);
    }
    const command = await commandFor(suite, partyId);
    expect(
      await captureError(() =>
        inTx(suite, (tx) =>
          mergeTabs(tx, venue.cfg, checkId, parkedId, { freeSourceTable: false, ...command }),
        ),
      ),
    ).toMatchObject({ code: "tab.not_table_tab", params: { tabId: parkedId } });
    expect(await statusOf(suite, parkedId)).toBe("open");
    expect(await revisionOf(suite, partyId)).toBe(command.expectedPartyRevision);
    await pay(venue, checkId, "30.00");

    expect(await statusOf(suite, checkId)).toBe("settled");
    expect((await tableRow(suite, mesa4)).tabId).toBe(tabId);
    expect((await tableRow(suite, mesa5)).tabId).toBe(mesa5TabId);
    const mesa5Seated = await inTx(suite, (tx) => partyForTable(tx, mesa5));
    expect(mesa5Seated?.partyId ?? null).toBe(otherPartyId);
    return { venue, mesa5, mesa5TabId, partyId, checkId };
  }

  for (const mesa5Party of ["has left the party", "belongs to another party"] as const) {
    describe(`when Mesa 5 ${mesa5Party}`, () => {
      it("refuses a round sent to the check, and opens no next tab", async () => {
        const { venue, mesa5, mesa5TabId, partyId, checkId } =
          await paidCheckAfterRefusals(mesa5Party);
        const bills = await inTx(suite, (tx) => readPartyBills(tx, partyId));

        expect(
          await captureError(() =>
            inTx(suite, (tx) =>
              addTabRound(tx, venue.cfg, checkId, [
                { menuItemId: venue.item("Flan"), quantity: "1" },
              ]),
            ),
          ),
        ).toMatchObject({ code: "tab.not_open", params: { tabId: checkId } });
        expect(await inTx(suite, (tx) => readPartyBills(tx, partyId))).toEqual(bills);
        expect((await tableRow(suite, mesa5)).tabId).toBe(mesa5TabId);
      });

      it("refuses moving the check to a free table, or joining one to it", async () => {
        const { venue, mesa5, mesa5TabId, partyId, checkId } =
          await paidCheckAfterRefusals(mesa5Party);
        const mesa7 = await venue.table("Mesa 7");
        const command = await commandFor(suite, partyId);

        for (const run of [
          (tx: Transaction) => moveTab(tx, venue.cfg, checkId, mesa7, command),
          (tx: Transaction) => joinTable(tx, venue.cfg, checkId, mesa7, command),
        ]) {
          expect(await captureError(() => inTx(suite, run))).toMatchObject({
            code: "tab.not_open",
            params: { tabId: checkId },
          });
        }
        expect((await tableRow(suite, mesa5)).tabId).toBe(mesa5TabId);
        expect((await tableRow(suite, mesa7)).tabId).toBeNull();
      });
    });
  }
});

describe("a split check moved to another table", () => {
  /** Mesa 4 (party V, tab A: Burger), with the Vino split to check C and C moved to Mesa 7. */
  async function checkMoved() {
    const venue = await setupPartyVenue(suite.db);
    const mesa4 = await venue.table("Mesa 4");
    const mesa7 = await venue.table("Mesa 7");
    const { partyId, tabId } = await seat(venue, mesa4);
    await order(venue, tabId, "Burger", "Vino");
    const checkId = await split(venue, partyId, tabId, [2]);
    const command = await commandFor(suite, partyId);
    await inTx(suite, (tx) => moveTab(tx, venue.cfg, checkId, mesa7, command));
    return { venue, mesa4, mesa7, partyId, tabId, checkId };
  }

  it("keeps Mesa 4 on the party's tab and seats the check at Mesa 7 on the same party", async () => {
    const { mesa4, mesa7, partyId, tabId, checkId } = await checkMoved();

    expect(await inTx(suite, (tx) => partyForTable(tx, mesa4))).toMatchObject({ partyId });
    expect((await tableRow(suite, mesa4)).tabId).toBe(tabId);
    expect(await inTx(suite, (tx) => partyForTable(tx, mesa7))).toMatchObject({ partyId });
    expect((await tableRow(suite, mesa7)).tabId).toBe(checkId);
    const active = (await membershipsOf(partyId)).filter((m) => m.leftAt === null);
    expect(active.map((m) => m.tableId)).toEqual([mesa4, mesa7]);
  });

  it("keeps Mesa 4 occupied once the tab is paid, and Finish frees both once every bill is", async () => {
    const { venue, mesa4, mesa7, partyId, tabId, checkId } = await checkMoved();

    await pay(venue, tabId, "12.00");
    expect(await floorRow(venue, mesa4)).toMatchObject({
      state: "open-tab",
      party: { id: partyId, outstanding: "30.00" },
    });

    await pay(venue, checkId, "30.00");
    const expectedPartyRevision = await revisionOf(suite, partyId);
    await inTx(suite, (tx) =>
      finishTable(tx, { partyId, expectedPartyRevision, operatorId: OPERATOR }),
    );
    for (const table of [mesa4, mesa7]) {
      expect((await floorRow(venue, table)).state).toBe("free");
    }
  });

  it("points only Mesa 4 at the next tab when a round follows the paid tab", async () => {
    const { venue, mesa4, mesa7, partyId, tabId, checkId } = await checkMoved();
    await pay(venue, tabId, "12.00");

    const { tabId: dessertTab } = await orderForParty(venue, partyId, ["Flan"]);

    expect(await partyIdOf(dessertTab)).toBe(partyId);
    expect((await tableRow(suite, mesa4)).tabId).toBe(dessertTab);
    expect((await tableRow(suite, mesa7)).tabId).toBe(checkId);
  });

  it("frees Mesa 7 and takes it out of the party when the check is merged back into the tab", async () => {
    const { venue, mesa4, mesa7, partyId, tabId, checkId } = await checkMoved();
    const command = await commandFor(suite, partyId);

    await inTx(suite, (tx) =>
      mergeTabs(tx, venue.cfg, tabId, checkId, { freeSourceTable: true, ...command }),
    );

    expect(await tableRow(suite, mesa7)).toMatchObject({ tabId: null, statusId: null });
    expect(await inTx(suite, (tx) => partyForTable(tx, mesa7))).toBeNull();
    expect((await floorRow(venue, mesa7)).state).toBe("free");
    expect(await statusOf(suite, checkId)).toBe("abandoned");
    expect((await tableRow(suite, mesa4)).tabId).toBe(tabId);
    const active = (await membershipsOf(partyId)).filter((m) => m.leftAt === null);
    expect(active.map((m) => m.tableId)).toEqual([mesa4]);
    expect((await partyRow(suite, partyId)).state).toBe("open");
    const bills = await inTx(suite, (tx) => readPartyBills(tx, partyId));
    expect(bills.find((bill) => bill.workingOrderId === tabId)!.total).toBe("42.00");
    expect((await seat(venue, mesa7)).partyId).not.toBe(partyId);
  });

  it("frees Mesa 4 and takes it out of the party when the tab is merged into the check at Mesa 7", async () => {
    const { venue, mesa4, mesa7, partyId, tabId, checkId } = await checkMoved();
    const command = await commandFor(suite, partyId);

    await inTx(suite, (tx) =>
      mergeTabs(tx, venue.cfg, checkId, tabId, { freeSourceTable: true, ...command }),
    );

    expect(await tableRow(suite, mesa4)).toMatchObject({ tabId: null, statusId: null });
    expect(await inTx(suite, (tx) => partyForTable(tx, mesa4))).toBeNull();
    expect(await statusOf(suite, tabId)).toBe("abandoned");
    expect((await tableRow(suite, mesa7)).tabId).toBe(checkId);
    const active = (await membershipsOf(partyId)).filter((m) => m.leftAt === null);
    expect(active.map((m) => m.tableId)).toEqual([mesa7]);
  });

  it("frees Mesa 7 when it is unjoined from the check, and the party keeps Mesa 4", async () => {
    const { venue, mesa4, mesa7, partyId, checkId } = await checkMoved();
    const command = await commandFor(suite, partyId);

    await inTx(suite, (tx) => unjoinTable(tx, venue.cfg, checkId, mesa7, undefined, command));

    expect(await inTx(suite, (tx) => partyForTable(tx, mesa7))).toBeNull();
    expect(await inTx(suite, (tx) => partyForTable(tx, mesa4))).toMatchObject({ partyId });
  });

  it("joins a table to a split check on the check's party, leaving the tab's table alone", async () => {
    const venue = await setupPartyVenue(suite.db);
    const mesa4 = await venue.table("Mesa 4");
    const mesa8 = await venue.table("Mesa 8");
    const { partyId, tabId } = await seat(venue, mesa4);
    await order(venue, tabId, "Burger", "Vino");
    const checkId = await split(venue, partyId, tabId, [2]);
    const command = await commandFor(suite, partyId);

    await inTx(suite, (tx) => joinTable(tx, venue.cfg, checkId, mesa8, command));

    expect(await inTx(suite, (tx) => partyForTable(tx, mesa8))).toMatchObject({ partyId });
    expect((await tableRow(suite, mesa8)).tabId).toBe(checkId);
    expect(await inTx(suite, (tx) => partyForTable(tx, mesa4))).toMatchObject({ partyId });
    expect((await tableRow(suite, mesa4)).tabId).toBe(tabId);
  });

  it("frees a table joined to a split check, and takes it out of the party, when the check is merged back", async () => {
    const venue = await setupPartyVenue(suite.db);
    const mesa4 = await venue.table("Mesa 4");
    const mesa8 = await venue.table("Mesa 8");
    const { partyId, tabId } = await seat(venue, mesa4);
    await order(venue, tabId, "Burger", "Vino");
    const checkId = await split(venue, partyId, tabId, [2]);
    await join(venue.cfg, partyId, checkId, mesa8);
    const command = await commandFor(suite, partyId);

    await inTx(suite, (tx) =>
      mergeTabs(tx, venue.cfg, tabId, checkId, { freeSourceTable: true, ...command }),
    );

    expect(await tableRow(suite, mesa8)).toMatchObject({ tabId: null, statusId: null });
    expect(await inTx(suite, (tx) => partyForTable(tx, mesa8))).toBeNull();
    expect((await tableRow(suite, mesa4)).tabId).toBe(tabId);
    expect(await inTx(suite, (tx) => partyForTable(tx, mesa4))).toMatchObject({ partyId });
  });
});

describe("a merge that would free every table the party holds", () => {
  /** A party at `tableNames` whose tab holds the Burger and whose split check at no table the Vino. */
  async function partyWithCheck(...tableNames: string[]) {
    const venue = await setupPartyVenue(suite.db);
    const tableIds: string[] = [];
    for (const name of tableNames) tableIds.push(await venue.table(name));
    const { partyId, tabId } = await seat(venue, tableIds[0]!);
    for (const tableId of tableIds.slice(1)) await join(venue.cfg, partyId, tabId, tableId);
    await order(venue, tabId, "Burger", "Vino");
    const checkId = await split(venue, partyId, tabId, [2]);
    return { venue, tableIds, partyId, tabId, checkId };
  }
  type Party = Awaited<ReturnType<typeof partyWithCheck>>;

  function mergeTabIntoCheck(
    p: Party,
    sent: { expectedPartyRevision?: number; operatorId: string },
  ): Promise<unknown> {
    return captureError(() =>
      inTx(suite, (tx) =>
        mergeTabs(tx, p.venue.cfg, p.checkId, p.tabId, { freeSourceTable: true, ...sent }),
      ),
    );
  }

  /** Each table's bill and party, and each bill's state and total. */
  async function readBack(p: Party) {
    const tables = [];
    for (const tableId of p.tableIds) {
      tables.push({
        tabId: (await tableRow(suite, tableId)).tabId,
        party: await inTx(suite, (tx) => partyForTable(tx, tableId)),
      });
    }
    const bills = await inTx(suite, (tx) => readPartyBills(tx, p.partyId));
    return {
      tables,
      states: [await statusOf(suite, p.tabId), await statusOf(suite, p.checkId)],
      totals: bills.map((bill) => [bill.workingOrderId, bill.total]),
    };
  }

  function unchanged(p: Party, revision: number) {
    return {
      tables: p.tableIds.map(() => ({
        tabId: p.tabId,
        party: { partyId: p.partyId, revision },
      })),
      states: ["open", "open"],
      totals: [
        [p.tabId, "12.00"],
        [p.checkId, "30.00"],
      ],
    };
  }

  it("is refused for the party's tab merged into its check at no table, and changes nothing", async () => {
    const p = await partyWithCheck("Mesa 4");
    const command = await commandFor(suite, p.partyId);

    const error = await mergeTabIntoCheck(p, command);

    expect(error).toMatchObject({ code: "tab.merge_leaves_no_table", params: { tabId: p.tabId } });
    expect(await readBack(p)).toEqual(unchanged(p, command.expectedPartyRevision));
  });

  it("is refused when the tab covers both of a party's joined tables, and changes nothing", async () => {
    const p = await partyWithCheck("Mesa 4", "Mesa 5");
    const command = await commandFor(suite, p.partyId);

    const error = await mergeTabIntoCheck(p, command);

    expect(error).toMatchObject({ code: "tab.merge_leaves_no_table", params: { tabId: p.tabId } });
    expect(await readBack(p)).toEqual(unchanged(p, command.expectedPartyRevision));
  });

  it("is refused as out of date when another device has changed the party since, and changes nothing", async () => {
    const p = await partyWithCheck("Mesa 4");
    const stale = await commandFor(suite, p.partyId);
    await inTx(suite, (tx) =>
      checkAndBumpParty(tx, p.partyId, stale.expectedPartyRevision, "open"),
    );

    const error = await mergeTabIntoCheck(p, stale);

    expect(error).toMatchObject({
      code: "party.out_of_date",
      params: { partyId: p.partyId, revision: stale.expectedPartyRevision + 1 },
    });
    expect(await readBack(p)).toEqual(unchanged(p, stale.expectedPartyRevision + 1));
  });

  it("is refused as an invalid request when sent without the party's revision, and changes nothing", async () => {
    const p = await partyWithCheck("Mesa 4");
    const revision = await revisionOf(suite, p.partyId);

    const error = await mergeTabIntoCheck(p, { operatorId: OPERATOR });

    expect(error).toMatchObject({
      code: "management.request_invalid",
      params: { field: "expectedPartyRevision" },
    });
    expect(await readBack(p)).toEqual(unchanged(p, revision));
  });
});

describe("unjoin without items", () => {
  it("ends the table's membership and frees it for a fresh party", async () => {
    const venue = await setupPartyVenue(suite.db);
    const mesa4 = await venue.table("Mesa 4");
    const mesa5 = await venue.table("Mesa 5");
    const { partyId, tabId } = await seat(venue, mesa4);
    await join(venue.cfg, partyId, tabId, mesa5);
    const command = await commandFor(suite, partyId);

    expect(
      await inTx(suite, (tx) => unjoinTable(tx, venue.cfg, tabId, mesa5, undefined, command)),
    ).toEqual({});

    expect(await inTx(suite, (tx) => partyForTable(tx, mesa5))).toBeNull();
    expect((await tableRow(suite, mesa5)).tabId).toBeNull();
    expect((await floorRow(venue, mesa5)).party).toBeNull();
    expect(await inTx(suite, (tx) => tx.select().from(parties))).toHaveLength(1);
    const next = await seat(venue, mesa5);
    expect(next.partyId).not.toBe(partyId);
    expect(await inTx(suite, (tx) => partyForTable(tx, mesa4))).toMatchObject({ partyId });
  });
});

describe("unjoin the party's only table", () => {
  it("is refused as not shared, and the party keeps the table", async () => {
    const venue = await setupPartyVenue(suite.db);
    const mesa4 = await venue.table("Mesa 4");
    const { partyId, tabId } = await seat(venue, mesa4);
    const command = await commandFor(suite, partyId);

    expect(
      await captureError(() =>
        inTx(suite, (tx) => unjoinTable(tx, venue.cfg, tabId, mesa4, undefined, command)),
      ),
    ).toMatchObject({ code: "table.not_shared", params: { tableId: mesa4, tabId } });

    expect(await inTx(suite, (tx) => partyForTable(tx, mesa4))).toMatchObject({ partyId });
    expect((await tableRow(suite, mesa4)).tabId).toBe(tabId);
  });
});

describe("occupied destinations", () => {
  async function busyTables() {
    const venue = await setupPartyVenue(suite.db);
    await inTx(suite, (tx) => writeClearingWorkflow(tx, true));
    const uncleared = await venue.table("Mesa 1");
    const finished = await seat(venue, uncleared);
    await inTx(suite, (tx) =>
      finishTable(tx, {
        partyId: finished.partyId,
        expectedPartyRevision: 0,
        operatorId: OPERATOR,
      }),
    );
    const other = await seat(venue, await venue.table("Mesa 2"));
    const joinedElsewhere = await venue.table("Mesa 3");
    await join(venue.cfg, other.partyId, other.tabId, joinedElsewhere);
    // The joined table's pointer is taken off, so only its membership says it is occupied.
    await inTx(suite, (tx) =>
      tx.update(diningTables).set({ tabId: null }).where(eq(diningTables.id, joinedElsewhere)),
    );
    const party = await seat(venue, await venue.table("Mesa 4"));
    return { venue, uncleared, joinedElsewhere, party };
  }

  it("refuses joining a table that needs clearing or belongs to another party", async () => {
    const { venue, uncleared, joinedElsewhere, party } = await busyTables();
    for (const [tableId, code] of [
      [uncleared, "table.needs_clearing"],
      [joinedElsewhere, "table.occupied"],
    ] as const) {
      const command = await commandFor(suite, party.partyId);
      expect(
        await captureError(() =>
          inTx(suite, (tx) => joinTable(tx, venue.cfg, party.tabId, tableId, command)),
        ),
      ).toMatchObject({ code, params: { tableId } });
    }
    expect(await membershipsOf(party.partyId)).toHaveLength(1);
    expect(await revisionOf(suite, party.partyId)).toBe(0);
  });

  it("refuses moving a party onto a table that needs clearing or belongs to another party", async () => {
    const { venue, uncleared, joinedElsewhere, party } = await busyTables();
    for (const [tableId, code] of [
      [uncleared, "table.needs_clearing"],
      [joinedElsewhere, "table.occupied"],
    ] as const) {
      const command = await commandFor(suite, party.partyId);
      expect(
        await captureError(() =>
          inTx(suite, (tx) => moveTab(tx, venue.cfg, party.tabId, tableId, command)),
        ),
      ).toMatchObject({ code, params: { tableId } });
    }
    expect((await membershipsOf(party.partyId)).map((m) => m.leftAt)).toEqual([null]);
  });
});

describe("stale moves", () => {
  /** Two parties, Mesa 4 (with three items) and Mesa 6 (one), and a free Mesa 5 and Mesa 7. */
  async function twoParties() {
    const venue = await setupPartyVenue(suite.db);
    const mesa4 = await venue.table("Mesa 4");
    const mesa5 = await venue.table("Mesa 5");
    const mesa6 = await venue.table("Mesa 6");
    const mesa7 = await venue.table("Mesa 7");
    const a = await seat(venue, mesa4);
    await order(venue, a.tabId, "Burger", "Vino", "Agua");
    const b = await seat(venue, mesa6);
    await order(venue, b.tabId, "Flan");
    return { venue, mesa4, mesa5, mesa6, mesa7, a, b };
  }

  type Parties = Awaited<ReturnType<typeof twoParties>>;

  /** What any of the six tab paths could change. */
  async function snapshot(p: Parties) {
    return inTx(suite, async (tx) => ({
      tables: await tx.select().from(diningTables),
      memberships: await tx.select().from(partyTables),
      parties: await tx.select().from(parties),
      orders: await tx.select().from(workingOrders),
      bills: await readPartyBills(tx, p.a.partyId),
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
          expectedPartyRevision: stale.a,
          operatorId: OPERATOR,
        }),
    },
    {
      name: "join",
      run: (p, tx, stale) =>
        joinTable(tx, p.venue.cfg, p.a.tabId, p.mesa5, {
          expectedPartyRevision: stale.a,
          operatorId: OPERATOR,
        }),
    },
    {
      name: "merge",
      run: (p, tx, stale) =>
        mergeTabs(tx, p.venue.cfg, p.a.tabId, p.b.tabId, {
          freeSourceTable: true,
          expectedPartyRevision: stale.a,
          expectedSourcePartyRevision: stale.b,
          operatorId: OPERATOR,
        }),
    },
    {
      name: "transfer",
      run: (p, tx, stale) =>
        transferLines(tx, p.venue.cfg, p.a.tabId, p.b.tabId, [{ lineNo: 1 }], {
          expectedPartyRevision: stale.b,
          expectedSourcePartyRevision: stale.a,
          operatorId: OPERATOR,
        }),
    },
    {
      name: "split",
      run: (p, tx, stale) =>
        splitOffCheck(tx, p.venue.cfg, p.a.tabId, [{ lineNo: 1 }], {
          expectedPartyRevision: stale.a,
          operatorId: OPERATOR,
        }),
    },
    {
      name: "unjoin",
      run: (p, tx, stale) =>
        unjoinTable(tx, p.venue.cfg, p.a.tabId, p.mesa5, [{ lineNo: 1 }], {
          expectedPartyRevision: stale.a,
          operatorId: OPERATOR,
        }),
    },
  ];

  it.each(PATHS)(
    "$name is refused when another device has changed the party since, and the rolled-back command leaves every table, party and bill as it was",
    async ({ name, run }) => {
      const p = await twoParties();
      if (name === "unjoin") await join(p.venue.cfg, p.a.partyId, p.a.tabId, p.mesa5);
      const current = {
        a: await revisionOf(suite, p.a.partyId),
        b: await revisionOf(suite, p.b.partyId),
      };
      await inTx(suite, (tx) => checkAndBumpParty(tx, p.a.partyId, current.a, "open"));
      const before = await snapshot(p);

      const error = await captureError(() => inTx(suite, (tx) => run(p, tx, current)));

      expect(error).toMatchObject({
        code: "party.out_of_date",
        params: { partyId: p.a.partyId, revision: current.a + 1 },
      });
      expect(await snapshot(p)).toEqual(before);
    },
  );

  it.each(PATHS.filter(({ name }) => name === "merge" || name === "transfer"))(
    "$name is refused when the other party has changed since, and the rolled-back command leaves every table, party and bill as it was",
    async ({ run }) => {
      const p = await twoParties();
      const current = {
        a: await revisionOf(suite, p.a.partyId),
        b: await revisionOf(suite, p.b.partyId),
      };
      await inTx(suite, (tx) => checkAndBumpParty(tx, p.b.partyId, current.b, "open"));
      const before = await snapshot(p);

      const error = await captureError(() => inTx(suite, (tx) => run(p, tx, current)));

      expect(error).toMatchObject({
        code: "party.out_of_date",
        params: { partyId: p.b.partyId, revision: current.b + 1 },
      });
      expect(await snapshot(p)).toEqual(before);
    },
  );

  it.each(PATHS)("$name bumps every party it changes", async ({ name, run }) => {
    const p = await twoParties();
    if (name === "unjoin") await join(p.venue.cfg, p.a.partyId, p.a.tabId, p.mesa5);
    const current = {
      a: await revisionOf(suite, p.a.partyId),
      b: await revisionOf(suite, p.b.partyId),
    };

    await inTx(suite, (tx) => run(p, tx, current));

    expect(await revisionOf(suite, p.a.partyId)).toBe(current.a + 1);
    const crossesParties = name === "merge" || name === "transfer";
    expect(await revisionOf(suite, p.b.partyId)).toBe(current.b + (crossesParties ? 1 : 0));
  });

  it.each(PATHS)(
    "$name is refused on a party that is no longer open, before its revision moves in the same transaction",
    async ({ name, run }) => {
      const p = await twoParties();
      if (name === "unjoin") await join(p.venue.cfg, p.a.partyId, p.a.tabId, p.mesa5);
      const current = {
        a: await revisionOf(suite, p.a.partyId),
        b: await revisionOf(suite, p.b.partyId),
      };
      // Only a direct write leaves an open tab on a party that has left `open`.
      await inTx(suite, (tx) =>
        tx
          .update(parties)
          .set({ state: "needs_clearing", closedAt: new Date().toISOString() })
          .where(eq(parties.id, p.a.partyId)),
      );

      const { error, revisionAtRefusal } = await inTx(suite, async (tx) => {
        const refused = await captureError(() => run(p, tx, current));
        const [row] = await tx
          .select({ revision: parties.revision })
          .from(parties)
          .where(eq(parties.id, p.a.partyId));
        return { error: refused, revisionAtRefusal: row!.revision };
      });

      expect(error).toMatchObject({ code: "party.not_open", params: { partyId: p.a.partyId } });
      expect(revisionAtRefusal).toBe(current.a);
    },
  );

  it("refuses a path on a party's tab sent without the party's revision", async () => {
    const p = await twoParties();
    const error = await captureError(() =>
      inTx(suite, (tx) => moveTab(tx, p.venue.cfg, p.a.tabId, p.mesa7)),
    );
    expect(error).toMatchObject({
      code: "management.request_invalid",
      params: { field: "expectedPartyRevision" },
    });
  });

  it("refuses a merge between two parties sent without the absorbed party's revision", async () => {
    const p = await twoParties();
    const error = await captureError(() =>
      inTx(suite, (tx) =>
        mergeTabs(tx, p.venue.cfg, p.a.tabId, p.b.tabId, {
          freeSourceTable: true,
          expectedPartyRevision: 0,
          operatorId: OPERATOR,
        }),
      ),
    );
    expect(error).toMatchObject({
      code: "management.request_invalid",
      params: { field: "expectedSourcePartyRevision" },
    });
    expect(await revisionOf(suite, p.a.partyId)).toBe(0);
  });
});

describe("merge (D2)", () => {
  /**
   * Mesa 4 (party T) has an open tab. Mesa 6 (party S) has an open tab with a Water, a settled
   * Paella check and an open Tarta check.
   */
  async function mergePair() {
    const venue = await setupPartyVenue(suite.db);
    const mesa4 = await venue.table("Mesa 4");
    const mesa6 = await venue.table("Mesa 6");
    const t = await seat(venue, mesa4);
    await order(venue, t.tabId, "Vino");
    const s = await seat(venue, mesa6);
    await order(venue, s.tabId, "Paella", "Tarta", "Agua");
    const settledId = await split(venue, s.partyId, s.tabId, [1]);
    await pay(venue, settledId, "20.00");
    const openCheckId = await split(venue, s.partyId, s.tabId, [2]);
    return { venue, mesa4, mesa6, t, s, settledId, openCheckId };
  }

  it("absorbs the other party: its open check follows, its settled bill stays, and it closes", async () => {
    const { venue, t, s, settledId, openCheckId } = await mergePair();

    await merge(venue.cfg, t, s, true);

    expect(await partyIdOf(openCheckId)).toBe(t.partyId);
    expect(await statusOf(suite, openCheckId)).toBe("open");
    expect(await partyIdOf(settledId)).toBe(s.partyId);
    expect(await partyIdOf(s.tabId)).toBe(s.partyId);
    expect(await statusOf(suite, s.tabId)).toBe("abandoned");
    const absorbed = await partyRow(suite, s.partyId);
    expect(absorbed).toMatchObject({
      state: "closed",
      mergedIntoPartyId: t.partyId,
      closedBy: OPERATOR,
    });
    expect(absorbed.closedAt).not.toBeNull();
    expect((await partyRow(suite, t.partyId)).state).toBe("open");
    const bills = await inTx(suite, (tx) => readPartyBills(tx, t.partyId));
    expect(bills.find((bill) => bill.workingOrderId === t.tabId)!.total).toBe("32.00");
  });

  it("frees the absorbed party's table with freeSourceTable, and T keeps its own", async () => {
    const { venue, mesa4, mesa6, t, s } = await mergePair();

    await merge(venue.cfg, t, s, true);

    expect(await inTx(suite, (tx) => partyForTable(tx, mesa6))).toBeNull();
    expect(await tableRow(suite, mesa6)).toMatchObject({ tabId: null, statusId: null });
    expect((await floorRow(venue, mesa6)).state).toBe("free");
    expect(await inTx(suite, (tx) => partyForTable(tx, mesa4))).toMatchObject({
      partyId: t.partyId,
    });
    expect((await membershipsOf(s.partyId)).every((m) => m.leftAt !== null)).toBe(true);
  });

  it("moves the absorbed party's tables to T without freeSourceTable, keeping their status", async () => {
    const { venue, mesa4, mesa6, t, s } = await mergePair();
    const mesa9 = await venue.table("Mesa 9");
    await join(venue.cfg, s.partyId, s.tabId, mesa9);
    const statusId = await giveStatus([mesa6, mesa9]);

    await merge(venue.cfg, t, s, false);

    for (const table of [mesa4, mesa6, mesa9]) {
      expect(await inTx(suite, (tx) => partyForTable(tx, table))).toMatchObject({
        partyId: t.partyId,
      });
      expect((await tableRow(suite, table)).tabId).toBe(t.tabId);
    }
    for (const table of [mesa6, mesa9]) {
      expect((await tableRow(suite, table)).statusId).toBe(statusId);
    }
    expect((await membershipsOf(s.partyId)).every((m) => m.leftAt !== null)).toBe(true);
    expect((await floorRow(venue, mesa6)).party).toMatchObject({
      id: t.partyId,
      tableIds: expect.arrayContaining([mesa4, mesa6, mesa9]),
    });
  });

  it("refuses merging one party's split check into another party while its tab is open", async () => {
    const { venue, mesa4, mesa6, t, s, openCheckId } = await mergePair();
    const expectedPartyRevision = await revisionOf(suite, t.partyId);
    const expectedSourcePartyRevision = await revisionOf(suite, s.partyId);

    const error = await captureError(() =>
      inTx(suite, (tx) =>
        mergeTabs(tx, venue.cfg, t.tabId, openCheckId, {
          freeSourceTable: false,
          expectedPartyRevision,
          expectedSourcePartyRevision,
          operatorId: OPERATOR,
        }),
      ),
    );

    expect(error).toMatchObject({
      code: "tab.party_has_other_open_bill",
      params: { tabId: openCheckId },
    });
    expect((await tableRow(suite, mesa4)).tabId).toBe(t.tabId);
    expect((await tableRow(suite, mesa6)).tabId).toBe(s.tabId);
    expect(await statusOf(suite, openCheckId)).toBe("open");
    expect(await partyIdOf(openCheckId)).toBe(s.partyId);
  });

  it("refuses merging a table's bill that belongs to no party into a party's bill", async () => {
    const { venue, mesa4, t } = await mergePair();
    const mesa8 = await venue.table("Mesa 8");
    const { tabId: noPartyTabId } = await inTx(suite, (tx) =>
      openTab(tx, venue.cfg, { tableId: mesa8 }),
    );
    const command = await commandFor(suite, t.partyId);

    const error = await captureError(() =>
      inTx(suite, (tx) =>
        mergeTabs(tx, venue.cfg, t.tabId, noPartyTabId, { freeSourceTable: false, ...command }),
      ),
    );

    expect(error).toMatchObject({ code: "tab.party_mismatch", params: { tabId: noPartyTabId } });
    expect(await statusOf(suite, noPartyTabId)).toBe("open");
    expect((await tableRow(suite, mesa8)).tabId).toBe(noPartyTabId);
    expect(await inTx(suite, (tx) => partyForTable(tx, mesa8))).toBeNull();
    expect((await tableRow(suite, mesa4)).tabId).toBe(t.tabId);
    expect(await revisionOf(suite, t.partyId)).toBe(command.expectedPartyRevision);
  });

  it("points a party's table at its split check when its tab merges into it without freeing the table", async () => {
    const { venue, mesa6, s, openCheckId } = await mergePair();
    const command = await commandFor(suite, s.partyId);

    await inTx(suite, (tx) =>
      mergeTabs(tx, venue.cfg, openCheckId, s.tabId, { freeSourceTable: false, ...command }),
    );

    expect((await tableRow(suite, mesa6)).tabId).toBe(openCheckId);
    expect(await statusOf(suite, s.tabId)).toBe("abandoned");
    expect(await statusOf(suite, openCheckId)).toBe("open");
    expect(await inTx(suite, (tx) => partyForTable(tx, mesa6))).toMatchObject({
      partyId: s.partyId,
    });
  });

  it("puts a split check at no table back into its party's tab when asked to free the source table", async () => {
    const { venue, mesa6, s, openCheckId } = await mergePair();
    const memberships = await membershipsOf(s.partyId);
    const command = await commandFor(suite, s.partyId);

    await inTx(suite, (tx) =>
      mergeTabs(tx, venue.cfg, s.tabId, openCheckId, { freeSourceTable: true, ...command }),
    );

    expect(await statusOf(suite, openCheckId)).toBe("abandoned");
    expect(await statusOf(suite, s.tabId)).toBe("open");
    expect((await tableRow(suite, mesa6)).tabId).toBe(s.tabId);
    expect(await membershipsOf(s.partyId)).toEqual(memberships);
  });

  it("points the absorbed party's tables at T's tab when the merged bill is its check and its tab has settled", async () => {
    const { venue, mesa4, mesa6, t, s, openCheckId } = await mergePair();
    await pay(venue, s.tabId, "2.00");
    const statusId = await giveStatus([mesa6]);
    const expectedPartyRevision = await revisionOf(suite, t.partyId);
    const expectedSourcePartyRevision = await revisionOf(suite, s.partyId);

    await inTx(suite, (tx) =>
      mergeTabs(tx, venue.cfg, t.tabId, openCheckId, {
        freeSourceTable: false,
        expectedPartyRevision,
        expectedSourcePartyRevision,
        operatorId: OPERATOR,
      }),
    );

    expect(await tableRow(suite, mesa6)).toMatchObject({ tabId: t.tabId, statusId });
    expect(await floorRow(venue, mesa6)).toMatchObject({ hasOpenTab: true, tabId: t.tabId });
    expect(await inTx(suite, (tx) => partyForTable(tx, mesa4))).toMatchObject({
      partyId: t.partyId,
    });
    expect((await partyRow(suite, s.partyId)).mergedIntoPartyId).toBe(t.partyId);
  });

  it("frees the absorbed party's tables when the merged bill is its check and its tab has settled", async () => {
    const { venue, mesa6, t, s, openCheckId } = await mergePair();
    await pay(venue, s.tabId, "2.00");
    await giveStatus([mesa6]);
    const expectedPartyRevision = await revisionOf(suite, t.partyId);
    const expectedSourcePartyRevision = await revisionOf(suite, s.partyId);

    await inTx(suite, (tx) =>
      mergeTabs(tx, venue.cfg, t.tabId, openCheckId, {
        freeSourceTable: true,
        expectedPartyRevision,
        expectedSourcePartyRevision,
        operatorId: OPERATOR,
      }),
    );

    expect(await tableRow(suite, mesa6)).toMatchObject({ tabId: null, statusId: null });
    expect((await floorRow(venue, mesa6)).state).toBe("free");
  });

  it("refuses a new command on the absorbed party", async () => {
    const { venue, t, s } = await mergePair();
    await merge(venue.cfg, t, s, true);

    expect(
      await captureError(() =>
        inTx(suite, (tx) =>
          runServiceCommand(tx, { kind: "visit", partyId: s.partyId }, randomUUID(), "k", {}, () =>
            Promise.resolve(1),
          ),
        ),
      ),
    ).toMatchObject({ code: "party.not_open", params: { partyId: s.partyId } });
    const expectedPartyRevision = await revisionOf(suite, s.partyId);
    expect(
      await captureError(() =>
        inTx(suite, (tx) =>
          finishTable(tx, {
            partyId: s.partyId,
            expectedPartyRevision,
            operatorId: OPERATOR,
          }),
        ),
      ),
    ).toMatchObject({ code: "party.not_open" });
  });

  it("merges a check back into its own party's tab without closing the party", async () => {
    const { venue, mesa6, s, openCheckId } = await mergePair();
    const expectedPartyRevision = await revisionOf(suite, s.partyId);

    await inTx(suite, (tx) =>
      mergeTabs(tx, venue.cfg, s.tabId, openCheckId, {
        freeSourceTable: false,
        expectedPartyRevision,
        operatorId: OPERATOR,
      }),
    );

    expect(await partyRow(suite, s.partyId)).toMatchObject({
      state: "open",
      mergedIntoPartyId: null,
      revision: expectedPartyRevision + 1,
    });
    expect(await inTx(suite, (tx) => partyForTable(tx, mesa6))).toMatchObject({
      partyId: s.partyId,
    });
    expect(await statusOf(suite, openCheckId)).toBe("abandoned");
  });
});

describe("merged parties keep their bills", () => {
  /**
   * Mesa 6 (party S) has a settled €20.00 check and a placed, unpaid €15.00 one, both split from its
   * now-empty tab; Mesa 4 (party T) has an open €30.00 tab. S's tab is merged into T's.
   */
  async function mergedParties() {
    const venue = await setupPartyVenue(suite.db);
    const mesa4 = await venue.table("Mesa 4");
    const mesa6 = await venue.table("Mesa 6");
    const s = await seat(venue, mesa6);
    await order(venue, s.tabId, "Paella", "Tarta");
    const settledId = await split(venue, s.partyId, s.tabId, [1]);
    const placedId = await split(venue, s.partyId, s.tabId, [2]);
    await pay(venue, settledId, "20.00");
    await placeByHand(suite, placedId);
    const t = await seat(venue, mesa4);
    await order(venue, t.tabId, "Vino");
    await merge(venue.cfg, t, s);
    return { venue, mesa4, mesa6, s, t, settledId, placedId };
  }

  it("lists the absorbed party's bills with the surviving party's", async () => {
    const { t, s, settledId, placedId } = await mergedParties();

    const bills = await inTx(suite, (tx) => readPartyBills(tx, t.partyId));

    expect(
      bills.map((b) => [b.workingOrderId, b.partyId, b.status, b.total, b.outstanding]),
    ).toEqual([
      [s.tabId, s.partyId, "abandoned", "0.00", "0.00"],
      [settledId, s.partyId, "settled", "20.00", "0.00"],
      [placedId, s.partyId, "placed", "15.00", "15.00"],
      [t.tabId, t.partyId, "open", "30.00", "30.00"],
    ]);
    expect(bills.find((b) => b.workingOrderId === settledId)!.receiptAvailable).toBe(true);
  });

  it("counts the absorbed party's unpaid bill as outstanding, and the floor never shows the table paid", async () => {
    const { venue, mesa4, t } = await mergedParties();

    expect((await floorRow(venue, mesa4)).party).toMatchObject({
      id: t.partyId,
      outstanding: "45.00",
    });

    await pay(venue, t.tabId, "30.00");
    const floor = await floorRow(venue, mesa4);
    expect(floor.state).toBe("open-tab");
    expect(floor.party).toMatchObject({ id: t.partyId, outstanding: "15.00" });
  });

  it("refuses Finish while the absorbed party's bill is unpaid, and closes once it is collected", async () => {
    const { venue, t, placedId } = await mergedParties();
    await pay(venue, t.tabId, "30.00");
    const expectedPartyRevision = await revisionOf(suite, t.partyId);

    const refused = await captureError(() =>
      inTx(suite, (tx) =>
        finishTable(tx, {
          partyId: t.partyId,
          expectedPartyRevision,
          operatorId: OPERATOR,
        }),
      ),
    );
    expect(refused).toMatchObject({ code: "party.bill_outstanding" });

    await collectByHand(placedId);
    expect(
      await inTx(suite, (tx) =>
        finishTable(tx, {
          partyId: t.partyId,
          expectedPartyRevision,
          operatorId: OPERATOR,
        }),
      ),
    ).toEqual({ state: "closed" });
  });

  it("follows a chain of merges, and the next party at any of the tables sees none of it", async () => {
    const { venue, mesa4, mesa6, s, t, settledId, placedId } = await mergedParties();
    const mesa8 = await venue.table("Mesa 8");
    const u = await seat(venue, mesa8);
    await order(venue, u.tabId, "Flan");
    await merge(venue.cfg, u, t);

    expect(await inTx(suite, (tx) => partyFamily(tx, u.partyId))).toEqual(
      expect.arrayContaining([u.partyId, t.partyId, s.partyId]),
    );
    expect(await inTx(suite, (tx) => partyFamily(tx, u.partyId))).toHaveLength(3);
    const bills = await inTx(suite, (tx) => readPartyBills(tx, u.partyId));
    expect(bills.map((b) => b.workingOrderId).sort()).toEqual(
      [s.tabId, settledId, placedId, t.tabId, u.tabId].sort(),
    );
    expect(total(bills)).toBe("50.00");

    await pay(venue, u.tabId, "35.00");
    expect(
      await captureError(async () => {
        const expectedPartyRevision = await revisionOf(suite, u.partyId);
        return inTx(suite, (tx) =>
          finishTable(tx, {
            partyId: u.partyId,
            expectedPartyRevision,
            operatorId: OPERATOR,
          }),
        );
      }),
    ).toMatchObject({ code: "party.bill_outstanding" });
    await collectByHand(placedId);
    const expectedPartyRevision = await revisionOf(suite, u.partyId);
    await inTx(suite, (tx) =>
      finishTable(tx, {
        partyId: u.partyId,
        expectedPartyRevision,
        operatorId: OPERATOR,
      }),
    );

    for (const table of [mesa4, mesa6, mesa8]) {
      const next = await seat(venue, table);
      const nextBills = await inTx(suite, (tx) => readPartyBills(tx, next.partyId));
      expect(nextBills.map((b) => b.workingOrderId)).toEqual([next.tabId]);
    }
  });

  it("gives a party nothing merged into it as its own family", async () => {
    const { t } = await mergedParties();
    expect(await inTx(suite, (tx) => partyFamily(tx, t.partyId))).toHaveLength(2);
    const lone = await inTx(suite, async (tx) => {
      const [row] = await tx.insert(parties).values({ openedBy: OPERATOR }).returning();
      return row!.id;
    });
    expect(await inTx(suite, (tx) => partyFamily(tx, lone))).toEqual([lone]);
  });
});

describe("checkAndBumpParty", () => {
  it("bumps a party whose revision matches, and returns the new one", async () => {
    const venue = await setupPartyVenue(suite.db);
    const { partyId } = await seat(venue, await venue.table("Mesa 4"));
    expect(await inTx(suite, (tx) => checkAndBumpParty(tx, partyId, 0, "open"))).toBe(1);
    expect(await inTx(suite, (tx) => checkAndBumpParty(tx, partyId, 1, "open"))).toBe(2);
    expect(await revisionOf(suite, partyId)).toBe(2);
  });

  it("refuses a stale revision with the current one, and writes nothing", async () => {
    const venue = await setupPartyVenue(suite.db);
    const { partyId } = await seat(venue, await venue.table("Mesa 4"));
    await inTx(suite, (tx) => checkAndBumpParty(tx, partyId, 0, "open"));
    expect(
      await captureError(() => inTx(suite, (tx) => checkAndBumpParty(tx, partyId, 0, "open"))),
    ).toMatchObject({ code: "party.out_of_date", params: { partyId, revision: 1 } });
    expect(
      await captureError(() => inTx(suite, (tx) => checkAndBumpParty(tx, partyId, 2, "open"))),
    ).toMatchObject({ code: "party.out_of_date" });
    expect(await revisionOf(suite, partyId)).toBe(1);
  });

  it("refuses a party that does not exist", async () => {
    const unknown = randomUUID();
    expect(
      await captureError(() => inTx(suite, (tx) => checkAndBumpParty(tx, unknown, 0, "open"))),
    ).toMatchObject({ code: "party.not_open", params: { partyId: unknown } });
  });
});

describe("runServiceCommand", () => {
  async function openParty(): Promise<string> {
    return inTx(suite, async (tx) => {
      const [row] = await tx.insert(parties).values({ openedBy: OPERATOR }).returning();
      return row!.id;
    });
  }

  function counting<R>(result: R) {
    const calls = { count: 0 };
    return { calls, run: async () => ((calls.count += 1), result) };
  }

  const body = { groupId: "g-1", lineIds: ["a", "b"], expectedPartyRevision: 3 };

  it("runs a new command once and records its result", async () => {
    const partyId = await openParty();
    const { calls, run } = counting({ fired: 2 });

    const result = await inTx(suite, (tx) =>
      runServiceCommand(tx, { kind: "visit", partyId }, "sub-1", "group.fire", body, run),
    );

    expect(result).toEqual({ fired: 2 });
    expect(calls.count).toBe(1);
    const rows = await inTx(suite, (tx) => tx.select().from(serviceCommands));
    expect(rows).toEqual([
      expect.objectContaining({
        scopeKind: "visit",
        scopeId: partyId,
        submissionId: "sub-1",
        kind: "group.fire",
        result: { value: { fired: 2 } },
      }),
    ]);
    expect(rows[0]!.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("replays the recorded result for the same id, kind and arguments without running", async () => {
    const partyId = await openParty();
    const first = counting({ fired: 2 });
    await inTx(suite, (tx) =>
      runServiceCommand(tx, { kind: "visit", partyId }, "sub-1", "group.fire", body, first.run),
    );
    const second = counting({ fired: 99 });

    const replay = await inTx(suite, (tx) =>
      runServiceCommand(
        tx,
        { kind: "visit", partyId },
        "sub-1",
        "group.fire",
        // The same arguments in another key order, with a re-read revision and the id itself.
        {
          lineIds: ["a", "b"],
          groupId: "g-1",
          expectedPartyRevision: 7,
          draftRevision: 4,
          expectedRevision: 2,
          submissionId: "sub-1",
        },
        second.run,
      ),
    );

    expect(replay).toEqual({ fired: 2 });
    expect(second.calls.count).toBe(0);
    expect(await inTx(suite, (tx) => tx.select().from(serviceCommands))).toHaveLength(1);
  });

  it.each([
    ["another body", "group.fire", { ...body, lineIds: ["a"] }],
    ["another path id", "group.fire", { ...body, groupId: "g-2" }],
    ["another kind", "group.reorder", body],
    ["a nested value in another order", "group.fire", { ...body, lineIds: ["b", "a"] }],
  ])("refuses the same id with %s, and runs nothing", async (_, kind, args) => {
    const partyId = await openParty();
    await inTx(suite, (tx) =>
      runServiceCommand(tx, { kind: "visit", partyId }, "sub-1", "group.fire", body, async () => 1),
    );
    const other = counting(2);

    const error = await captureError(() =>
      inTx(suite, (tx) =>
        runServiceCommand(tx, { kind: "visit", partyId }, "sub-1", kind, args, other.run),
      ),
    );

    expect(error).toMatchObject({
      code: "submission.id_reused",
      params: { submissionId: "sub-1" },
    });
    expect(other.calls.count).toBe(0);
    expect(await inTx(suite, (tx) => tx.select().from(serviceCommands))).toHaveLength(1);
  });

  it("treats the same id in another scope as a separate command", async () => {
    const partyA = await openParty();
    const partyB = await openParty();
    const bill = randomUUID();
    const counter = counting("ran");

    for (const scope of [
      { kind: "visit" as const, partyId: partyA },
      { kind: "visit" as const, partyId: partyB },
      { kind: "bill" as const, workingOrderId: bill },
    ]) {
      await inTx(suite, (tx) =>
        runServiceCommand(tx, scope, "sub-1", "group.fire", body, counter.run),
      );
    }

    expect(counter.calls.count).toBe(3);
    expect(await inTx(suite, (tx) => tx.select().from(serviceCommands))).toHaveLength(3);
  });

  it("canonicalises nested keys, so objects in another key order are the same command", async () => {
    const bill = randomUUID();
    const first = counting("once");
    const scope = { kind: "bill" as const, workingOrderId: bill };
    await inTx(suite, (tx) =>
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
      await inTx(suite, (tx) =>
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
    await inTx(suite, (tx) =>
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
      await inTx(suite, (tx) =>
        runServiceCommand(tx, scope, "sub-1", "serve", { lines: [null] }, async () => "twice"),
      ),
    ).toBe("once");
  });

  it("replays a command that returned nothing as nothing", async () => {
    const scope = { kind: "bill" as const, workingOrderId: randomUUID() };
    await inTx(suite, (tx) =>
      runServiceCommand(tx, scope, "sub-1", "serve", {}, async () => undefined),
    );
    expect(
      await inTx(suite, (tx) =>
        runServiceCommand(tx, scope, "sub-1", "serve", {}, async () => "ran"),
      ),
    ).toBeUndefined();
  });

  it("refuses a new command on a party that is not open, and still replays one recorded before", async () => {
    const partyId = await openParty();
    const scope = { kind: "visit" as const, partyId };
    await inTx(suite, (tx) =>
      runServiceCommand(tx, scope, "sub-1", "group.fire", body, async () => "fired"),
    );
    await inTx(suite, (tx) =>
      tx
        .update(parties)
        .set({ state: "closed", closedAt: new Date().toISOString() })
        .where(eq(parties.id, partyId)),
    );
    const late = counting("late");

    expect(
      await captureError(() =>
        inTx(suite, (tx) => runServiceCommand(tx, scope, "sub-2", "group.fire", body, late.run)),
      ),
    ).toMatchObject({ code: "party.not_open", params: { partyId } });
    expect(late.calls.count).toBe(0);
    expect(
      await inTx(suite, (tx) =>
        runServiceCommand(tx, scope, "sub-1", "group.fire", body, late.run),
      ),
    ).toBe("fired");
  });

  it("records nothing when the command itself fails", async () => {
    const scope = { kind: "bill" as const, workingOrderId: randomUUID() };
    await captureError(() =>
      inTx(suite, (tx) =>
        runServiceCommand(tx, scope, "sub-1", "serve", {}, async () => {
          throw new Error("refused");
        }),
      ),
    );
    expect(await inTx(suite, (tx) => tx.select().from(serviceCommands))).toHaveLength(0);
  });
});

describe("money received against a bill before its invoice", () => {
  /** A cash contribution of `applied`, with `tip` of the change left as a tip. */
  async function contribute(
    venue: PartyVenue,
    billId: string,
    applied: string,
    tip = "0.00",
  ): Promise<string> {
    const tendered = toScale(sumDecimals([decimal(applied), decimal(tip)]), MONEY_SCALE);
    const result = await takeBillPayment(
      { db: venue.db, backend: venue.backend, clock: venue.clock },
      { ...venue.cfg, tipsEnabled: true },
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
    await inTx(suite, (tx) =>
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
    const venue = await setupPartyVenue(suite.db);
    const mesa4 = await venue.table("Mesa 4");
    const { partyId, tabId } = await seat(venue, mesa4, 2);
    await order(venue, tabId, "Burger", "Vino");

    await contribute(venue, tabId, "20.00");

    expect(await inTx(suite, (tx) => readPartyBills(tx, partyId))).toMatchObject([
      { workingOrderId: tabId, total: "42.00", outstanding: "22.00" },
    ]);
    expect((await floorRow(venue, mesa4)).party).toMatchObject({ outstanding: "22.00" });
  });

  it("says which bills hold a payment: one received, or a card's still pending, but not one that failed", async () => {
    const venue = await setupPartyVenue(suite.db);
    const mesa4 = await venue.table("Mesa 4");
    const { partyId, tabId } = await seat(venue, mesa4, 2);
    await order(venue, tabId, "Burger", "Vino", "Agua");
    const pendingId = await split(venue, partyId, tabId, [2]);
    const failedId = await split(venue, partyId, tabId, [3]);
    await contribute(venue, tabId, "5.00");
    const card = (billId: string, state: "pending" | "failed") =>
      inTx(suite, (tx) =>
        tx.insert(billPayments).values({
          workingOrderId: billId,
          submissionId: randomUUID(),
          fingerprint: "f",
          kind: "contribution",
          method: "card",
          applied: 1000,
          state,
          ...(state === "failed" ? { failedAt: new Date().toISOString() } : {}),
          requestedBy: OPERATOR,
          tillId: venue.cfg.tillId,
        }),
      );
    await card(pendingId, "pending");
    await card(failedId, "failed");

    const bills = await inTx(suite, (tx) => readPartyBills(tx, partyId));

    expect(bills.map((bill) => [bill.workingOrderId, bill.hasPayments])).toEqual([
      [tabId, true],
      [pendingId, true],
      [failedId, false],
    ]);
    expect(bills.find((bill) => bill.workingOrderId === pendingId)).toMatchObject({
      total: "30.00",
      outstanding: "30.00",
    });
  });

  it("will not abandon an emptied bill that still holds a tip, and finishes once it is given back", async () => {
    const venue = await setupPartyVenue(suite.db);
    const { partyId, tabId } = await seat(venue, await venue.table("Mesa 4"));
    await order(venue, tabId, "Vino");
    const paymentId = await contribute(venue, tabId, "10.00", "5.00");
    await refund(venue.cfg, paymentId, 1000, 0);
    await inTx(suite, (tx) => voidTabLine(tx, venue.cfg, tabId, 1));

    const seen = (await partyRow(suite, partyId)).revision;
    const error = await captureError(() =>
      inTx(suite, (tx) =>
        finishTable(tx, { partyId, expectedPartyRevision: seen, operatorId: OPERATOR }),
      ),
    );

    expect(error).toMatchObject({
      code: "bill.payments_received",
      params: { workingOrderId: tabId },
    });
    expect(await statusOf(suite, tabId)).toBe("open");
    expect((await partyRow(suite, partyId)).state).toBe("open");

    await refund(venue.cfg, paymentId, 0, 500);
    const revision = (await partyRow(suite, partyId)).revision;
    await inTx(suite, (tx) =>
      finishTable(tx, { partyId, expectedPartyRevision: revision, operatorId: OPERATOR }),
    );
    expect(await statusOf(suite, tabId)).toBe("abandoned");
  });
});
