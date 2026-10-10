import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  captureError,
  diningTables,
  floorZones,
  orderGroups,
  partyTables,
  tableServiceStatuses,
  ticketItems,
  workingOrderLines,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { writeClearingWorkflow } from "@waitron/venue-service";
import { splitBill } from "./bill-actions.js";
import { readDrafts, saveDraft } from "./order-drafts.js";
import { placeGroups } from "./order-groups.js";
import { VENUE_SERVICE } from "./modules.js";
import { finishTable, readPartyBills, setPartyName } from "./parties.js";
import { deactivateTable } from "./tables.js";
import { listExpoQueue } from "./working-order.js";
import {
  combineParties,
  joinTables,
  moveGuests,
  splitTable,
  type TableActionOptions,
} from "./table-actions.js";
import { offerProducts } from "./testing/zone-offers.js";
import {
  OPERATOR,
  activeTablesOf,
  billRow,
  cashContribution,
  inTx,
  linesOf,
  nextMillisecond,
  order,
  orderForParty,
  partyAt,
  partyRow,
  pay,
  paymentsOf,
  placeByHand,
  revisionOf,
  seat,
  setupPartyVenue,
  tableRow,
  zoneOf,
  type PartyVenue,
  floorRow,
} from "./testing/party-venue.js";
import "./errors.js";

// Move guests, join tables and split a table (table actions plan, Task 8; spec §6, §8, §15).
// `resetPerTest: false`: the venue is provisioned once, and each case seats its own tables.
let v: PartyVenue;
/** A second zone of dining tables. */
let terrazaZone: string;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    v = await setupPartyVenue(db);
    terrazaZone = await inTx(v, async (tx) => {
      const [zone] = await tx
        .insert(floorZones)
        .values({ locationId: v.cfg.locationId, name: "Terraza" })
        .returning({ id: floorZones.id });
      return (await offerProducts(tx, v.cfg, { zone: { zoneId: zone!.id }, orderStart: "table" }))
        .zoneId;
    });
  },
});

async function act<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return inTx(v, fn);
}

async function opts(
  partyId: string,
  other?: string,
  bills: "merge" | "separate" = "merge",
): Promise<TableActionOptions> {
  return {
    bills,
    expectedPartyRevision: await revisionOf(v, partyId),
    ...(other === undefined
      ? {}
      : { otherPartyId: other, expectedOtherPartyRevision: await revisionOf(v, other) }),
    operatorId: OPERATOR,
  };
}

/** What Split a table is sent: the party's revision as read now, and who acts. */
async function cmd(partyId: string) {
  return { expectedPartyRevision: await revisionOf(v, partyId), operatorId: OPERATOR };
}

/** Fresh tables labelled `<prefix> <n>` for each n, in the tables zone. */
async function tables(prefix: string, ...numbers: number[]): Promise<string[]> {
  const ids = [];
  for (const n of numbers) ids.push(await v.table(`${prefix} ${n}`));
  return ids;
}

/** Joins a free table to the party, as the till's Join tables does. */
async function joinFree(partyId: string, tableId: string): Promise<void> {
  await nextMillisecond();
  const joining = await opts(partyId);
  await act((tx) => joinTables(tx, v.cfg, partyId, tableId, joining));
}

async function giveStatus(tableIds: string[]): Promise<string> {
  return act(async (tx) => {
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

async function needsClearing(tableId: string): Promise<void> {
  await act((tx) =>
    tx
      .update(diningTables)
      .set({ needsClearingSince: new Date().toISOString() })
      .where(eq(diningTables.id, tableId)),
  );
}

/** Runs `fn` with the venue's clearing setting on, and puts it back off. */
async function withClearing<T>(fn: () => Promise<T>): Promise<T> {
  await act((tx) => writeClearingWorkflow(tx, true));
  try {
    return await fn();
  } finally {
    await act((tx) => writeClearingWorkflow(tx, false));
  }
}

async function splitOff(partyId: string, billId: string, lineNos: number[]): Promise<string> {
  const command = await cmd(partyId);
  const { billId: made } = await act((tx) =>
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

/** Sends each group as `placeGroups` does, in one transaction, to `billId` when given. */
async function sendGroups(
  partyId: string,
  groups: { names: string[]; release: "fire" | "hold" }[],
  billId?: string,
): Promise<void> {
  await act((tx) =>
    placeGroups(tx, v.cfg, partyId, {
      groups: groups.map((group) => ({
        lines: group.names.map((name) => ({ menuItemId: v.item(name), quantity: "1" })),
        release: group.release,
      })),
      operatorId: OPERATOR,
      ...(billId === undefined ? {} : { billId }),
    }),
  );
}

/** Every stored column of the bill's lines, in line order. */
async function lineRows(billId: string) {
  return act((tx) =>
    tx
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, billId))
      .orderBy(asc(workingOrderLines.lineNo)),
  );
}

/** The kitchen's items for the bill's lines, in line order. */
async function ticketsOf(billId: string) {
  return act((tx) =>
    tx
      .select({
        lineId: ticketItems.workingOrderLineId,
        state: ticketItems.state,
        firedAt: ticketItems.firedAt,
      })
      .from(ticketItems)
      .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
      .where(eq(ticketItems.workingOrderId, billId))
      .orderBy(asc(workingOrderLines.lineNo)),
  );
}

/** The party's kitchen groups in position order. */
async function groupsOf(partyId: string) {
  return act((tx) =>
    tx
      .select({ id: orderGroups.id, state: orderGroups.state, position: orderGroups.position })
      .from(orderGroups)
      .where(eq(orderGroups.partyId, partyId))
      .orderBy(asc(orderGroups.position)),
  );
}

/** The parties, their tables, the tables' rows and each bill's row, lines, payments and zone. */
async function snapshot(partyIds: string[], billIds: string[], tableIds: string[] = []) {
  const read = [];
  for (const id of partyIds) {
    read.push({
      party: await partyRow(v, id),
      tables: await activeTablesOf(v, id),
      groups: await groupsOf(id),
    });
  }
  const bills = [];
  for (const id of billIds) {
    bills.push({
      row: await billRow(v, id),
      lines: await lineRows(id),
      payments: await paymentsOf(v, id),
      zone: await zoneOf(v, id),
    });
  }
  const rows = [];
  for (const id of tableIds) rows.push(await tableRow(v, id));
  return { parties: read, bills, tables: rows };
}

/** Runs `fn`, expecting a refusal that leaves the named parties, bills and tables as they were. */
async function refused(
  partyIds: string[],
  billIds: string[],
  tableIds: string[],
  fn: () => Promise<unknown>,
) {
  const before = await snapshot(partyIds, billIds, tableIds);
  const error = await captureError(fn);
  expect(await snapshot(partyIds, billIds, tableIds)).toEqual(before);
  return error;
}

function noticesOn(billIds: string[]) {
  return v.db.all<{ working_order_id: string; kind: string; line_name: string; moved_to: string }>(
    sql`
      select working_order_id, kind, line_name, moved_to from kitchen_notices
      where working_order_id in (${sql.join(
        billIds.map((id) => sql`${id}`),
        sql`, `,
      )})
      order by rowid`,
  );
}

describe("move guests", () => {
  it("moves the party off all its tables to a free one, and the tables left behind need clearing", async () => {
    await withClearing(async () => {
      const [m4, m5, m9] = await tables("Mesa", 4, 5, 9);
      const ana = await seat(v, m4);
      await joinFree(ana.partyId, m5);
      await giveStatus([m4, m5, m9]);

      const moving = await opts(ana.partyId);
      const result = await act((tx) => moveGuests(tx, v.cfg, ana.partyId, m9, moving));

      expect(result).toEqual({ partyId: ana.partyId, mainBillId: ana.tabId, merged: false });
      expect(await activeTablesOf(v, ana.partyId)).toEqual([m9]);
      for (const left of [m4, m5]) {
        const row = await tableRow(v, left);
        expect(row.needsClearingSince).not.toBeNull();
        expect(row.statusId).toBeNull();
      }
      expect(await tableRow(v, m9)).toMatchObject({
        statusId: null,
        needsClearingSince: null,
      });
      expect((await billRow(v, ana.tabId)).partyId).toBe(ana.partyId);
      expect(await partyRow(v, ana.partyId)).toMatchObject({
        state: "open",
        mainBillId: ana.tabId,
        revision: moving.expectedPartyRevision + 1,
      });
    });
  });

  it("leaves the tables behind free when the venue's clearing setting is off", async () => {
    const [m4, m9] = await tables("Libre", 4, 9);
    const ana = await seat(v, m4);

    const moving = await opts(ana.partyId);
    await act((tx) => moveGuests(tx, v.cfg, ana.partyId, m9, moving));

    expect(await tableRow(v, m4)).toMatchObject({ needsClearingSince: null, statusId: null });
    expect(await partyAt(v, m4)).toBeNull();
    expect(await activeTablesOf(v, ana.partyId)).toEqual([m9]);
  });

  it("gives the party's open and presented bills a free table's zone when it is in another zone", async () => {
    const [m4] = await tables("Zona", 4);
    const terraza = await v.table("Zona T1", terrazaZone);
    const ana = await seat(v, m4);
    await order(v, ana.tabId, "Burger");
    const second = await splitOff(ana.partyId, ana.tabId, [1]);
    await placeByHand(v, second);

    const moving = await opts(ana.partyId);
    await act((tx) => moveGuests(tx, v.cfg, ana.partyId, terraza, moving));

    expect(await zoneOf(v, ana.tabId)).toBe(terrazaZone);
    expect(await zoneOf(v, second)).toBe(terrazaZone);
    expect((await billRow(v, second)).status).toBe("placed");
  });

  it("combines the party into the party at a held table, which keeps its name and main bill", async () => {
    const [m4, m7] = await tables("Uno", 4, 7);
    const ana = await seat(v, m4);
    const luis = await seat(v, m7);
    await act((tx) =>
      setPartyName(tx, {
        partyId: luis.partyId,
        name: "Luis",
        expectedPartyRevision: luis.revision,
      }),
    );
    await order(v, ana.tabId, "Burger");
    await order(v, luis.tabId, "Agua");
    await giveStatus([m4, m7]);

    const moving = await opts(ana.partyId, luis.partyId);
    const result = await act((tx) => moveGuests(tx, v.cfg, ana.partyId, m7, moving));

    expect(result).toEqual({ partyId: luis.partyId, mainBillId: luis.tabId, merged: true });
    expect((await linesOf(v, luis.tabId)).map((l) => l.name)).toEqual(["Agua", "Burger"]);
    expect((await billRow(v, ana.tabId)).status).toBe("abandoned");
    expect(await partyRow(v, ana.partyId)).toMatchObject({
      state: "closed",
      mergedIntoPartyId: luis.partyId,
      closedBy: OPERATOR,
    });
    expect(await partyRow(v, luis.partyId)).toMatchObject({
      name: "Luis",
      mainBillId: luis.tabId,
      revision: moving.expectedOtherPartyRevision! + 1,
    });
    expect(await activeTablesOf(v, luis.partyId)).toEqual([m7]);
    expect(await activeTablesOf(v, ana.partyId)).toEqual([]);
    expect((await tableRow(v, m4)).statusId).toBeNull();
    expect((await tableRow(v, m7)).statusId).not.toBeNull();
  });

  it("keeps both main bills when asked, and the receiving one stays main", async () => {
    const [m4, m7] = await tables("Dos", 4, 7);
    const ana = await seat(v, m4);
    const luis = await seat(v, m7);
    await order(v, ana.tabId, "Burger");
    await order(v, luis.tabId, "Agua");

    const moving = await opts(ana.partyId, luis.partyId, "separate");
    const result = await act((tx) => moveGuests(tx, v.cfg, ana.partyId, m7, moving));

    expect(result).toEqual({ partyId: luis.partyId, mainBillId: luis.tabId, merged: false });
    expect(await billRow(v, ana.tabId)).toMatchObject({ status: "open", partyId: luis.partyId });
    expect((await linesOf(v, ana.tabId)).map((l) => l.name)).toEqual(["Burger"]);
    expect((await linesOf(v, luis.tabId)).map((l) => l.name)).toEqual(["Agua"]);
    expect((await partyRow(v, luis.partyId)).mainBillId).toBe(luis.tabId);
  });

  it("keeps the main bills separate when the moving one has been paid towards", async () => {
    const [m4, m7] = await tables("Tres", 4, 7);
    const ana = await seat(v, m4);
    const luis = await seat(v, m7);
    await order(v, ana.tabId, "Burger");
    await order(v, luis.tabId, "Agua");
    await cashContribution(v, ana.tabId, "5.00");

    const moving = await opts(ana.partyId, luis.partyId);
    const result = await act((tx) => moveGuests(tx, v.cfg, ana.partyId, m7, moving));

    expect(result).toEqual({ partyId: luis.partyId, mainBillId: luis.tabId, merged: false });
    expect(await billRow(v, ana.tabId)).toMatchObject({ status: "open", partyId: luis.partyId });
    expect(await paymentsOf(v, ana.tabId)).toHaveLength(1);
    expect((await linesOf(v, luis.tabId)).map((l) => l.name)).toEqual(["Agua"]);
  });

  it("keeps the main bills separate when their service modes differ, though both are untouched", async () => {
    const [m4, m7] = await tables("Modos", 4, 7);
    const ana = await seat(v, m4);
    const luis = await seat(v, m7);
    await order(v, ana.tabId, "Burger");
    await order(v, luis.tabId, "Agua");
    // Stands in for the old tab move, which leaves one party's bills in two service modes.
    await act((tx) => VENUE_SERVICE.retargetOrderContext(tx, v.cfg, luis.tabId, v.counter.zoneId));

    const moving = await opts(ana.partyId, luis.partyId);
    const result = await act((tx) => moveGuests(tx, v.cfg, ana.partyId, m7, moving));

    expect(result).toEqual({ partyId: luis.partyId, mainBillId: luis.tabId, merged: false });
    expect(await billRow(v, ana.tabId)).toMatchObject({ status: "open", partyId: luis.partyId });
  });

  it("gives the moving party's open and presented bills the receiving party's zone when it sits in another", async () => {
    const [m4] = await tables("Area", 4);
    const terraza = await v.table("Area T7", terrazaZone);
    const ana = await seat(v, m4);
    const luis = await seat(v, terraza);
    await order(v, ana.tabId, "Burger", "Agua");
    const presented = await splitOff(ana.partyId, ana.tabId, [2]);
    await placeByHand(v, presented);

    const moving = await opts(ana.partyId, luis.partyId, "separate");
    await act((tx) => moveGuests(tx, v.cfg, ana.partyId, terraza, moving));

    expect(await zoneOf(v, ana.tabId)).toBe(terrazaZone);
    expect(await linesOf(v, ana.tabId)).toMatchObject([
      { name: "Burger", unitPriceGross: 1200, vatClass: "general" },
    ]);
    expect(await zoneOf(v, presented)).toBe(terrazaZone);
    expect(await billRow(v, presented)).toMatchObject({ status: "placed", partyId: luis.partyId });
  });

  it("moves to one of the party's own tables while it holds two: the other leaves and needs clearing", async () => {
    await withClearing(async () => {
      const [m4, m5] = await tables("Propia", 4, 5);
      const ana = await seat(v, m4);
      await joinFree(ana.partyId, m5);

      const moving = await opts(ana.partyId);
      const result = await act((tx) => moveGuests(tx, v.cfg, ana.partyId, m5, moving));

      expect(result).toEqual({ partyId: ana.partyId, mainBillId: ana.tabId, merged: false });
      expect(await activeTablesOf(v, ana.partyId)).toEqual([m5]);
      expect((await tableRow(v, m4)).needsClearingSince).not.toBeNull();
      expect((await tableRow(v, m5)).needsClearingSince).toBeNull();
    });
  });

  describe("what it refuses, changing nothing", () => {
    it("refuses a table that needs clearing", async () => {
      const [m4, dirty] = await tables("Sucia", 4, 9);
      const ana = await seat(v, m4);
      await needsClearing(dirty);
      const moving = await opts(ana.partyId);

      const error = await refused([ana.partyId], [ana.tabId], [m4, dirty], () =>
        act((tx) => moveGuests(tx, v.cfg, ana.partyId, dirty, moving)),
      );

      expect(error).toMatchObject({ code: "table.needs_clearing", params: { tableId: dirty } });
    });

    it("refuses the party's own only table", async () => {
      const [m4] = await tables("Sola", 4);
      const ana = await seat(v, m4);
      const moving = await opts(ana.partyId);

      const error = await refused([ana.partyId], [ana.tabId], [m4], () =>
        act((tx) => moveGuests(tx, v.cfg, ana.partyId, m4, moving)),
      );

      expect(error).toMatchObject({ code: "table.already_in_party", params: { tableId: m4 } });
    });

    it("refuses a table taken out of use, and one that does not exist", async () => {
      const [m4, retired] = await tables("Retirada", 4, 9);
      const ana = await seat(v, m4);
      await act((tx) => deactivateTable(tx, v.cfg, retired));
      const missing = randomUUID();
      const moving = await opts(ana.partyId);

      const inactive = await refused([ana.partyId], [ana.tabId], [m4, retired], () =>
        act((tx) => moveGuests(tx, v.cfg, ana.partyId, retired, moving)),
      );
      const absent = await refused([ana.partyId], [ana.tabId], [m4], () =>
        act((tx) => moveGuests(tx, v.cfg, ana.partyId, missing, moving)),
      );

      expect(inactive).toMatchObject({ code: "table.inactive", params: { tableId: retired } });
      expect(absent).toMatchObject({ code: "table.not_found", params: { tableId: missing } });
    });

    it("refuses a free table in a zone that seats no one, as seating does", async () => {
      const [m4] = await tables("Barra", 4);
      const barra = await v.table("Barra B9", v.counter.zoneId);
      const ana = await seat(v, m4);
      const moving = await opts(ana.partyId);

      const error = await refused([ana.partyId], [ana.tabId], [m4, barra], () =>
        act((tx) => moveGuests(tx, v.cfg, ana.partyId, barra, moving)),
      );

      expect(error).toMatchObject({
        code: "service_zone.mode_incompatible",
        params: { zoneId: v.counter.zoneId, expected: "table_tab" },
      });
      expect(await partyAt(v, barra)).toBeNull();
    });

    it("refuses a stale revision of the party at the table", async () => {
      const [m4, m7] = await tables("Vieja", 4, 7);
      const ana = await seat(v, m4);
      const luis = await seat(v, m7);
      const moving = await opts(ana.partyId, luis.partyId);
      await act((tx) =>
        setPartyName(tx, {
          partyId: luis.partyId,
          name: "Luis",
          expectedPartyRevision: moving.expectedOtherPartyRevision!,
        }),
      );

      const error = await refused(
        [ana.partyId, luis.partyId],
        [ana.tabId, luis.tabId],
        [m4, m7],
        () => act((tx) => moveGuests(tx, v.cfg, ana.partyId, m7, moving)),
      );

      expect(error).toMatchObject({
        code: "party.out_of_date",
        params: { partyId: luis.partyId, revision: moving.expectedOtherPartyRevision! + 1 },
      });
    });

    it("refuses a table another party holds when the request carries no revision for it", async () => {
      const [m4, m7] = await tables("Sin", 4, 7);
      const ana = await seat(v, m4);
      const luis = await seat(v, m7);
      const moving = await opts(ana.partyId);

      const error = await refused(
        [ana.partyId, luis.partyId],
        [ana.tabId, luis.tabId],
        [m4, m7],
        () => act((tx) => moveGuests(tx, v.cfg, ana.partyId, m7, moving)),
      );

      expect(error).toMatchObject({
        code: "management.request_invalid",
        params: { field: "expectedOtherPartyRevision" },
      });
    });
  });
});

/** What the floor shows of a table's bills. */
async function floorFigures(tableId: string) {
  const row = await floorRow(v, tableId);
  return {
    state: row.state,
    hasOpenTab: row.hasOpenTab,
    tabLineCount: row.tabLineCount,
    tabTotal: row.tabTotal,
    pendingToServe: row.pendingToServe,
  };
}

describe("the floor reads the bills of the party holding the table", () => {
  it("shows a table the party has left free, with no bill, and the table it moved to with its bill", async () => {
    const [m4, m9] = await tables("Suelo dejada", 4, 9);
    const ana = await seat(v, m4);
    await order(v, ana.tabId, "Burger");
    const moving = await opts(ana.partyId);

    await act((tx) => moveGuests(tx, v.cfg, ana.partyId, m9, moving));

    expect(await activeTablesOf(v, ana.partyId)).toEqual([m9]);
    expect(await floorFigures(m4)).toEqual({
      state: "free",
      hasOpenTab: false,
      tabLineCount: undefined,
      tabTotal: undefined,
      pendingToServe: 0,
    });
    expect(await floorFigures(m9)).toEqual({
      state: "open-tab",
      hasOpenTab: true,
      tabLineCount: 1,
      tabTotal: "12.00",
      pendingToServe: 1,
    });
  });

  it("counts a presented bill's dishes still to serve, but not toward the open bill, its lines or its total", async () => {
    const [m4] = await tables("Suelo presentada", 4);
    const ana = await seat(v, m4);
    await order(v, ana.tabId, "Burger", "Vino");
    const presented = await splitOff(ana.partyId, ana.tabId, [2]);
    await placeByHand(v, presented);
    expect((await billRow(v, presented)).status).toBe("placed");

    expect(await floorFigures(m4)).toEqual({
      state: "open-tab",
      hasOpenTab: true,
      tabLineCount: 1,
      tabTotal: "12.00",
      pendingToServe: 2,
    });

    await placeByHand(v, ana.tabId);

    expect(await floorFigures(m4)).toEqual({
      state: "open-tab",
      hasOpenTab: false,
      tabLineCount: undefined,
      tabTotal: undefined,
      pendingToServe: 2,
    });
  });

  it("adds a party's open bills together, and shows every table of the party the same figures", async () => {
    const [m4, m5] = await tables("Suelo suma", 4, 5);
    const ana = await seat(v, m4);
    await joinFree(ana.partyId, m5);
    await order(v, ana.tabId, "Burger", "Vino");
    const second = await splitOff(ana.partyId, ana.tabId, [2]);
    expect((await billRow(v, second)).status).toBe("open");

    const figures = {
      state: "open-tab",
      hasOpenTab: true,
      tabLineCount: 2,
      tabTotal: "42.00",
      pendingToServe: 2,
    };
    expect(await floorFigures(m4)).toEqual(figures);
    expect(await floorFigures(m5)).toEqual(figures);
  });
});

describe("the main bill when parties combine", () => {
  it("makes the incoming main bill main when the receiving one is presented", async () => {
    const [m4, m7] = await tables("Principal", 4, 7);
    const ana = await seat(v, m4);
    const luis = await seat(v, m7);
    await order(v, ana.tabId, "Burger");
    await order(v, luis.tabId, "Agua");
    await placeByHand(v, luis.tabId);

    const moving = await opts(ana.partyId, luis.partyId);
    const result = await act((tx) => moveGuests(tx, v.cfg, ana.partyId, m7, moving));

    expect(result).toEqual({ partyId: luis.partyId, mainBillId: ana.tabId, merged: false });
    expect((await partyRow(v, luis.partyId)).mainBillId).toBe(ana.tabId);
    expect(await billRow(v, ana.tabId)).toMatchObject({ status: "open", partyId: luis.partyId });
    expect(await billRow(v, luis.tabId)).toMatchObject({ status: "placed", partyId: luis.partyId });
  });

  for (const receiving of ["presented", "paid"] as const) {
    it(`leaves the combined party with no main bill when the receiving one is ${receiving} and the incoming one presented`, async () => {
      const [m4, m7] = await tables(`Ninguna ${receiving}`, 4, 7);
      const ana = await seat(v, m4);
      const luis = await seat(v, m7);
      await order(v, ana.tabId, "Burger");
      await order(v, luis.tabId, "Agua");
      await placeByHand(v, ana.tabId);
      if (receiving === "presented") await placeByHand(v, luis.tabId);
      else await pay(v, luis.tabId, "2.00");

      const moving = await opts(ana.partyId, luis.partyId);
      const result = await act((tx) => moveGuests(tx, v.cfg, ana.partyId, m7, moving));

      expect(result).toEqual({ partyId: luis.partyId, mainBillId: null, merged: false });
      expect((await partyRow(v, luis.partyId)).mainBillId).toBeNull();
      expect(await billRow(v, ana.tabId)).toMatchObject({
        status: "placed",
        partyId: luis.partyId,
      });
      const { tabId } = await orderForParty(v, luis.partyId, ["Flan"]);
      expect([ana.tabId, luis.tabId]).not.toContain(tabId);
      expect((await partyRow(v, luis.partyId)).mainBillId).toBe(tabId);
      expect((await billRow(v, tabId)).partyId).toBe(luis.partyId);
    });
  }
});

describe("a paid bill stays on its original party", () => {
  it("while the open one moves, and the combined party finishes only once that is paid", async () => {
    const [m4, m7] = await tables("Pagada", 4, 7);
    const ana = await seat(v, m4);
    const luis = await seat(v, m7);
    await order(v, ana.tabId, "Burger", "Vino");
    const second = await splitOff(ana.partyId, ana.tabId, [2]);
    await pay(v, ana.tabId, "12.00");

    const moving = await opts(ana.partyId, luis.partyId);
    await act((tx) => moveGuests(tx, v.cfg, ana.partyId, m7, moving));

    expect(await billRow(v, ana.tabId)).toMatchObject({
      status: "settled",
      partyId: ana.partyId,
    });
    expect(noticesOn([ana.tabId, second])).toEqual([
      { working_order_id: ana.tabId, kind: "moved", line_name: "BURG", moved_to: "Pagada 7" },
      { working_order_id: second, kind: "moved", line_name: "TINTO", moved_to: "Pagada 7" },
    ]);
    expect(await billRow(v, second)).toMatchObject({ status: "open", partyId: luis.partyId });
    const bills = await act((tx) => readPartyBills(tx, luis.partyId));
    expect(bills.map((bill) => [bill.workingOrderId, bill.partyId, bill.status])).toEqual([
      [ana.tabId, ana.partyId, "settled"],
      [luis.tabId, luis.partyId, "open"],
      [second, luis.partyId, "open"],
    ]);

    const finishing = await cmd(luis.partyId);
    const early = await refused([luis.partyId], [second, luis.tabId], [m7], () =>
      act((tx) => finishTable(tx, { partyId: luis.partyId, ...finishing })),
    );
    expect(early).toMatchObject({
      code: "party.bill_outstanding",
      params: { partyId: luis.partyId },
    });

    await pay(v, second, "30.00");
    const finish = await cmd(luis.partyId);
    await act((tx) => finishTable(tx, { partyId: luis.partyId, ...finish }));
    expect((await partyRow(v, luis.partyId)).state).toBe("closed");
  });
});

describe("MOVED notices for a paid bill left on a party combined away", () => {
  /** The paid bill's stored row, lines and payments, which combining its party must not change. */
  async function paidBill(billId: string) {
    return {
      row: await billRow(v, billId),
      lines: await lineRows(billId),
      payments: await paymentsOf(v, billId),
    };
  }

  it("tells the kitchen where a paid bill's sent dish went when its guests move to a held table", async () => {
    const [m4, m7] = await tables("PagoM", 4, 7);
    const ana = await seat(v, m4);
    const luis = await seat(v, m7);
    await order(v, ana.tabId, "Burger");
    await pay(v, ana.tabId, "12.00");
    const paid = await paidBill(ana.tabId);
    expect(paid.row).toMatchObject({ status: "settled", partyId: ana.partyId, label: "PagoM 4" });

    const moving = await opts(ana.partyId, luis.partyId);
    await act((tx) => moveGuests(tx, v.cfg, ana.partyId, m7, moving));

    expect((await partyRow(v, ana.partyId)).mergedIntoPartyId).toBe(luis.partyId);
    expect(noticesOn([ana.tabId])).toEqual([
      { working_order_id: ana.tabId, kind: "moved", line_name: "BURG", moved_to: "PagoM 7" },
    ]);
    const onPass = (await act((tx) => listExpoQueue(tx, v.cfg))).find(
      (entry) => entry.orderId === ana.tabId,
    );
    expect(onPass?.tableLabel).toBe("PagoM 7");
    expect(await paidBill(ana.tabId)).toEqual(paid);
  });

  it("tells the kitchen where a paid bill's sent dish went when its table joins another party", async () => {
    const [m4, m7] = await tables("PagoJ", 4, 7);
    const ana = await seat(v, m4);
    const luis = await seat(v, m7);
    await order(v, ana.tabId, "Burger");
    await pay(v, ana.tabId, "12.00");
    const paid = await paidBill(ana.tabId);

    await nextMillisecond();
    const joining = await opts(luis.partyId, ana.partyId);
    await act((tx) => joinTables(tx, v.cfg, luis.partyId, m4, joining));

    expect((await partyRow(v, ana.partyId)).mergedIntoPartyId).toBe(luis.partyId);
    expect(noticesOn([ana.tabId])).toEqual([
      { working_order_id: ana.tabId, kind: "moved", line_name: "BURG", moved_to: "PagoJ 7, 4" },
    ]);
    expect(await paidBill(ana.tabId)).toEqual(paid);
  });

  it("names the tables the guests went to, not the label the bill was paid under", async () => {
    const [m4, m5, m7] = await tables("PagoE", 4, 5, 7);
    const ana = await seat(v, m4);
    const luis = await seat(v, m7);
    await order(v, ana.tabId, "Burger");
    await pay(v, ana.tabId, "12.00");
    const toFive = await opts(ana.partyId);
    await act((tx) => moveGuests(tx, v.cfg, ana.partyId, m5, toFive));
    const earlier = noticesOn([ana.tabId]);
    const paid = await paidBill(ana.tabId);
    // The bill still carries the label it was paid under, though its guests now sit at 5.
    expect(paid.row.label).toBe("PagoE 4");

    const moving = await opts(ana.partyId, luis.partyId);
    await act((tx) => moveGuests(tx, v.cfg, ana.partyId, m7, moving));

    expect(noticesOn([ana.tabId])).toEqual([
      ...earlier,
      { working_order_id: ana.tabId, kind: "moved", line_name: "BURG", moved_to: "PagoE 7" },
    ]);
    expect(await paidBill(ana.tabId)).toEqual(paid);
  });

  it("tells the kitchen again when the party that took the guests moves on", async () => {
    const [m4, m7, m9] = await tables("PagoL", 4, 7, 9);
    const ana = await seat(v, m4);
    const luis = await seat(v, m7);
    await order(v, ana.tabId, "Burger");
    await pay(v, ana.tabId, "12.00");
    const moving = await opts(ana.partyId, luis.partyId);
    await act((tx) => moveGuests(tx, v.cfg, ana.partyId, m7, moving));
    const earlier = noticesOn([ana.tabId]);
    const paid = await paidBill(ana.tabId);

    const onward = await opts(luis.partyId);
    await act((tx) => moveGuests(tx, v.cfg, luis.partyId, m9, onward));

    expect(noticesOn([ana.tabId])).toEqual([
      ...earlier,
      { working_order_id: ana.tabId, kind: "moved", line_name: "BURG", moved_to: "PagoL 9" },
    ]);
    expect(await paidBill(ana.tabId)).toEqual(paid);
  });

  it("tells the kitchen when the party that took the guests joins a table and splits it off again", async () => {
    const [m4, m7, m9] = await tables("PagoS", 4, 7, 9);
    const ana = await seat(v, m4);
    const luis = await seat(v, m7);
    await order(v, ana.tabId, "Burger");
    await pay(v, ana.tabId, "12.00");
    const moving = await opts(ana.partyId, luis.partyId);
    await act((tx) => moveGuests(tx, v.cfg, ana.partyId, m7, moving));
    const earlier = noticesOn([ana.tabId]);
    const paid = await paidBill(ana.tabId);

    await joinFree(luis.partyId, m9);
    const splitting = await cmd(luis.partyId);
    await act((tx) => splitTable(tx, v.cfg, luis.partyId, m9, null, splitting));

    expect(noticesOn([ana.tabId])).toEqual([
      ...earlier,
      { working_order_id: ana.tabId, kind: "moved", line_name: "BURG", moved_to: "PagoS 7, 9" },
      { working_order_id: ana.tabId, kind: "moved", line_name: "BURG", moved_to: "PagoS 7" },
    ]);
    expect(await paidBill(ana.tabId)).toEqual(paid);
  });

  it("follows two merges to the party still seated", async () => {
    const [m3, m4, m7, m9] = await tables("PagoC", 3, 4, 7, 9);
    const eva = await seat(v, m3);
    const ana = await seat(v, m4);
    const luis = await seat(v, m7);
    await order(v, eva.tabId, "Burger");
    await pay(v, eva.tabId, "12.00");
    const first = await opts(eva.partyId, ana.partyId);
    await act((tx) => moveGuests(tx, v.cfg, eva.partyId, m4, first));
    const second = await opts(ana.partyId, luis.partyId);
    await act((tx) => moveGuests(tx, v.cfg, ana.partyId, m7, second));
    const earlier = noticesOn([eva.tabId]);
    const paid = await paidBill(eva.tabId);

    const onward = await opts(luis.partyId);
    await act((tx) => moveGuests(tx, v.cfg, luis.partyId, m9, onward));

    expect(earlier).toEqual([
      { working_order_id: eva.tabId, kind: "moved", line_name: "BURG", moved_to: "PagoC 4" },
      { working_order_id: eva.tabId, kind: "moved", line_name: "BURG", moved_to: "PagoC 7" },
    ]);
    expect(noticesOn([eva.tabId])).toEqual([
      ...earlier,
      { working_order_id: eva.tabId, kind: "moved", line_name: "BURG", moved_to: "PagoC 9" },
    ]);
    expect((await paidBill(eva.tabId)).row.partyId).toBe(eva.partyId);
    expect(await paidBill(eva.tabId)).toEqual(paid);
  });
});

describe("kitchen groups when parties combine", () => {
  it("gives the incoming party's groups, held and fired, to the receiving party after its last, in their own order and state", async () => {
    const [m4, m7] = await tables("Grupos", 4, 7);
    const ana = await seat(v, m4);
    const luis = await seat(v, m7);
    await sendGroups(luis.partyId, [{ names: ["Agua"], release: "fire" }]);
    await sendGroups(ana.partyId, [
      { names: ["Burger"], release: "fire" },
      { names: ["Flan"], release: "hold" },
    ]);
    const luisGroups = await groupsOf(luis.partyId);
    const anaGroups = await groupsOf(ana.partyId);
    const anaLines = await linesOf(v, ana.tabId);
    expect(anaGroups.map((group) => group.state)).toEqual(["fired", "held"]);

    const moving = await opts(ana.partyId, luis.partyId, "separate");
    await act((tx) => moveGuests(tx, v.cfg, ana.partyId, m7, moving));

    const last = luisGroups.at(-1)!.position;
    expect(await groupsOf(luis.partyId)).toEqual([
      ...luisGroups,
      { id: anaGroups[0]!.id, state: "fired", position: last + 1 },
      { id: anaGroups[1]!.id, state: "held", position: last + 2 },
    ]);
    expect(await groupsOf(ana.partyId)).toEqual([]);
    expect(await linesOf(v, ana.tabId)).toEqual(anaLines);
    expect(anaLines[1]!.groupId).toBe(anaGroups[1]!.id);
  });
});

describe("drafts when parties combine", () => {
  it("adds the operator's draft on the moving party to their draft on the receiving one", async () => {
    const [m4, m7] = await tables("Borrador", 4, 7);
    const ana = await seat(v, m4);
    const luis = await seat(v, m7);
    for (const [partyId, dish] of [
      [ana.partyId, "Flan"],
      [luis.partyId, "Agua"],
    ] as const) {
      await act((tx) =>
        saveDraft(tx, v.cfg, partyId, OPERATOR, {
          draftId: null,
          revision: 0,
          lines: [{ menuItemId: v.item(dish), quantity: "1" }],
        }),
      );
    }

    const moving = await opts(ana.partyId, luis.partyId);
    await act((tx) => moveGuests(tx, v.cfg, ana.partyId, m7, moving));

    const drafts = await act((tx) => readDrafts(tx, v.cfg, luis.partyId));
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.lines.map((line) => line.menuItemId).sort()).toEqual(
      [v.item("Agua"), v.item("Flan")].sort(),
    );
  });
});

describe("join tables", () => {
  it("joins a free table: both tables stay, and neither's status changes", async () => {
    const [m4, m5] = await tables("Junta", 4, 5);
    const ana = await seat(v, m4);
    const status = await giveStatus([m4, m5]);
    await nextMillisecond();

    const joining = await opts(ana.partyId);
    const result = await act((tx) => joinTables(tx, v.cfg, ana.partyId, m5, joining));

    expect(result).toEqual({ partyId: ana.partyId, mainBillId: ana.tabId, merged: false });
    expect(await activeTablesOf(v, ana.partyId)).toEqual([m4, m5]);
    expect((await tableRow(v, m4)).statusId).toBe(status);
    expect((await tableRow(v, m5)).statusId).toBe(status);
    expect((await partyRow(v, ana.partyId)).revision).toBe(joining.expectedPartyRevision + 1);
  });

  it("gives the tables it brings in join times in the order they joined the other party", async () => {
    const [m4, m7, m8, m9] = await tables("Orden", 4, 7, 8, 9);
    const ana = await seat(v, m4);
    const luis = await seat(v, m7);
    await joinFree(luis.partyId, m8);
    await joinFree(luis.partyId, m9);

    const joining = await opts(ana.partyId, luis.partyId);
    await act((tx) => joinTables(tx, v.cfg, ana.partyId, m8, joining));

    const joinedAt = async (tableId: string) =>
      (
        await act((tx) =>
          tx
            .select({ joinedAt: partyTables.joinedAt })
            .from(partyTables)
            .where(and(eq(partyTables.partyId, ana.partyId), eq(partyTables.tableId, tableId))),
        )
      )[0]!.joinedAt;
    const times = [await joinedAt(m4), await joinedAt(m7), await joinedAt(m8), await joinedAt(m9)];
    expect(times).toEqual([...times].sort());
    expect(new Set(times).size).toBe(times.length);
    expect(await activeTablesOf(v, ana.partyId)).toEqual([m4, m7, m8, m9]);
  });

  it("combines the party at a held table into this one, with all of its tables", async () => {
    const [m4, m7, m8] = await tables("Juntar", 4, 7, 8);
    const ana = await seat(v, m4);
    const luis = await seat(v, m7);
    await joinFree(luis.partyId, m8);
    await order(v, ana.tabId, "Burger");
    await order(v, luis.tabId, "Agua");
    const status = await giveStatus([m7, m8]);

    const joining = await opts(ana.partyId, luis.partyId);
    const result = await act((tx) => joinTables(tx, v.cfg, ana.partyId, m7, joining));

    expect(result).toEqual({ partyId: ana.partyId, mainBillId: ana.tabId, merged: true });
    expect(await activeTablesOf(v, ana.partyId)).toEqual([m4, m7, m8]);
    expect(await activeTablesOf(v, luis.partyId)).toEqual([]);
    expect(await partyRow(v, luis.partyId)).toMatchObject({
      state: "closed",
      mergedIntoPartyId: ana.partyId,
    });
    expect((await linesOf(v, ana.tabId)).map((l) => l.name)).toEqual(["Burger", "Agua"]);
    expect((await billRow(v, luis.tabId)).status).toBe("abandoned");
    for (const joined of [m7, m8]) {
      expect(await tableRow(v, joined)).toMatchObject({
        statusId: status,
        needsClearingSince: null,
      });
    }
  });

  it("keeps the bills separate when asked", async () => {
    const [m4, m7] = await tables("Aparte", 4, 7);
    const ana = await seat(v, m4);
    const luis = await seat(v, m7);
    await order(v, ana.tabId, "Burger");
    await order(v, luis.tabId, "Agua");

    const joining = await opts(ana.partyId, luis.partyId, "separate");
    const result = await act((tx) => joinTables(tx, v.cfg, ana.partyId, m7, joining));

    expect(result).toEqual({ partyId: ana.partyId, mainBillId: ana.tabId, merged: false });
    expect(await billRow(v, luis.tabId)).toMatchObject({ status: "open", partyId: ana.partyId });
    expect((await partyRow(v, ana.partyId)).mainBillId).toBe(ana.tabId);
  });

  describe("what it refuses, changing nothing", () => {
    it("refuses a table in another zone", async () => {
      const [m4] = await tables("Otra zona", 4);
      const terraza = await v.table("Otra zona T5", terrazaZone);
      const held = await v.table("Otra zona T6", terrazaZone);
      const ana = await seat(v, m4);
      const luis = await seat(v, held);
      const joiningFree = await opts(ana.partyId);
      const joining = await opts(ana.partyId, luis.partyId);

      const free = await refused([ana.partyId], [ana.tabId], [m4, terraza], () =>
        act((tx) => joinTables(tx, v.cfg, ana.partyId, terraza, joiningFree)),
      );
      const other = await refused(
        [ana.partyId, luis.partyId],
        [ana.tabId, luis.tabId],
        [m4, held],
        () => act((tx) => joinTables(tx, v.cfg, ana.partyId, held, joining)),
      );

      for (const [error, tableZone] of [
        [free, terrazaZone],
        [other, terrazaZone],
      ] as const) {
        expect(error).toMatchObject({
          code: "service_zone.join_mismatch",
          params: { orderZoneId: v.tables.zoneId, tableZoneId: tableZone },
        });
      }
    });

    it("refuses a table the party holds", async () => {
      const [m4, m5] = await tables("Tiene", 4, 5);
      const ana = await seat(v, m4);
      await joinFree(ana.partyId, m5);
      const joining = await opts(ana.partyId);

      const error = await refused([ana.partyId], [ana.tabId], [m4, m5], () =>
        act((tx) => joinTables(tx, v.cfg, ana.partyId, m5, joining)),
      );

      expect(error).toMatchObject({ code: "table.already_in_party", params: { tableId: m5 } });
    });

    it("refuses a table that needs clearing", async () => {
      const [m4, dirty] = await tables("Recoger", 4, 5);
      const ana = await seat(v, m4);
      await needsClearing(dirty);
      const joining = await opts(ana.partyId);

      const error = await refused([ana.partyId], [ana.tabId], [m4, dirty], () =>
        act((tx) => joinTables(tx, v.cfg, ana.partyId, dirty, joining)),
      );

      expect(error).toMatchObject({ code: "table.needs_clearing", params: { tableId: dirty } });
    });
  });
});

describe("split a table", () => {
  /** Ana at `<prefix> 4` and `<prefix> 5`, her main bill (Burger) and a split bill B2 (Vino). */
  async function anaAtTwo(prefix: string) {
    const [m4, m5] = await tables(prefix, 4, 5);
    const ana = await seat(v, m4);
    await joinFree(ana.partyId, m5);
    await order(v, ana.tabId, "Burger", "Vino");
    const b2 = await splitOff(ana.partyId, ana.tabId, [2]);
    return { ana, m4, m5, b2 };
  }

  it("starts a new unnamed party on the table with the chosen bill as its main", async () => {
    const { ana, m4, m5, b2 } = await anaAtTwo("Separa");
    const status = await giveStatus([m5]);

    const splitting = await cmd(ana.partyId);
    const result = await act((tx) => splitTable(tx, v.cfg, ana.partyId, m5, b2, splitting));

    expect(result.partyId).not.toBe(ana.partyId);
    expect(result).toEqual({ partyId: result.partyId, mainBillId: b2 });
    expect(await partyRow(v, result.partyId)).toMatchObject({
      name: null,
      state: "open",
      mainBillId: b2,
    });
    expect(await activeTablesOf(v, result.partyId)).toEqual([m5]);
    expect(await billRow(v, b2)).toMatchObject({ partyId: result.partyId, status: "open" });
    expect((await tableRow(v, m5)).statusId).toBe(status);
    expect(await activeTablesOf(v, ana.partyId)).toEqual([m4]);
    expect(await partyRow(v, ana.partyId)).toMatchObject({
      mainBillId: ana.tabId,
      revision: splitting.expectedPartyRevision + 1,
    });
    expect(await zoneOf(v, b2)).toBe(v.tables.zoneId);
  });

  it("gives the new party a new, empty main bill at once when no bill is chosen", async () => {
    const { ana, m5 } = await anaAtTwo("Vacia");

    const splitting = await cmd(ana.partyId);
    const result = await act((tx) => splitTable(tx, v.cfg, ana.partyId, m5, null, splitting));

    expect(result.mainBillId).not.toBeNull();
    const main = await billRow(v, result.mainBillId!);
    expect(main).toMatchObject({ partyId: result.partyId, status: "open" });
    expect(await linesOf(v, main.id)).toEqual([]);
    expect((await partyRow(v, result.partyId)).mainBillId).toBe(main.id);
    expect(await zoneOf(v, main.id)).toBe(v.tables.zoneId);
  });

  it("moves a presented bill, still placed with its lines unchanged but for their group, and the new party has no main bill", async () => {
    const [m4, m5] = await tables("Presentada", 4, 5);
    const ana = await seat(v, m4);
    await joinFree(ana.partyId, m5);
    await sendGroups(ana.partyId, [{ names: ["Burger", "Vino", "Flan"], release: "fire" }]);
    const b2 = await splitOff(ana.partyId, ana.tabId, [2, 3]);
    await placeByHand(v, b2);
    const lines = await lineRows(b2);
    const tickets = await ticketsOf(b2);
    expect(lines.map((line) => line.groupId)).toEqual([expect.any(String), expect.any(String)]);

    const splitting = await cmd(ana.partyId);
    const result = await act((tx) => splitTable(tx, v.cfg, ana.partyId, m5, b2, splitting));

    expect(result.mainBillId).toBeNull();
    expect(await billRow(v, b2)).toMatchObject({ status: "placed", partyId: result.partyId });
    const [arrived] = await groupsOf(result.partyId);
    expect(await lineRows(b2)).toEqual(lines.map((line) => ({ ...line, groupId: arrived!.id })));
    expect(await ticketsOf(b2)).toEqual(tickets);
    expect((await partyRow(v, result.partyId)).mainBillId).toBeNull();
    const { tabId } = await orderForParty(v, result.partyId, ["Agua"]);
    expect(tabId).not.toBe(b2);
    expect((await partyRow(v, result.partyId)).mainBillId).toBe(tabId);
  });

  it("takes sent dishes out of their group into one of the new party's, keeping their ticket state", async () => {
    const [m4, m5] = await tables("Enviada", 4, 5);
    const ana = await seat(v, m4);
    await joinFree(ana.partyId, m5);
    await sendGroups(ana.partyId, [{ names: ["Burger", "Vino"], release: "fire" }]);
    const b2 = await splitOff(ana.partyId, ana.tabId, [2]);
    const lines = await lineRows(b2);
    const tickets = await ticketsOf(b2);
    expect(lines[0]!.groupId).not.toBeNull();
    expect(tickets[0]!.firedAt).not.toBeNull();

    const splitting = await cmd(ana.partyId);
    const result = await act((tx) => splitTable(tx, v.cfg, ana.partyId, m5, b2, splitting));

    const [arrived] = await groupsOf(result.partyId);
    expect(await lineRows(b2)).toEqual(lines.map((line) => ({ ...line, groupId: arrived!.id })));
    expect(await ticketsOf(b2)).toEqual(tickets);
  });

  describe("what it refuses, changing nothing", () => {
    it("refuses the main bill", async () => {
      const { ana, m4, m5, b2 } = await anaAtTwo("Principal S");
      const splitting = await cmd(ana.partyId);

      const error = await refused([ana.partyId], [ana.tabId, b2], [m4, m5], () =>
        act((tx) => splitTable(tx, v.cfg, ana.partyId, m5, ana.tabId, splitting)),
      );

      expect(error).toMatchObject({
        code: "party.main_bill_stays",
        params: { partyId: ana.partyId },
      });
    });

    it("refuses the party's only table", async () => {
      const [m4] = await tables("Unica", 4);
      const ana = await seat(v, m4);
      const splitting = await cmd(ana.partyId);

      const error = await refused([ana.partyId], [ana.tabId], [m4], () =>
        act((tx) => splitTable(tx, v.cfg, ana.partyId, m4, null, splitting)),
      );

      expect(error).toMatchObject({
        code: "table.not_shared",
        params: { tableId: m4, partyId: ana.partyId },
      });
    });

    it("refuses a table not in the party", async () => {
      const { ana, m4, m5, b2 } = await anaAtTwo("Fuera");
      const [elsewhere] = await tables("Fuera otra", 9);
      const splitting = await cmd(ana.partyId);

      const error = await refused([ana.partyId], [ana.tabId, b2], [m4, m5, elsewhere], () =>
        act((tx) => splitTable(tx, v.cfg, ana.partyId, elsewhere, b2, splitting)),
      );

      expect(error).toMatchObject({
        code: "table.not_joined",
        params: { tableId: elsewhere, partyId: ana.partyId },
      });
    });

    it("refuses a paid bill", async () => {
      const { ana, m4, m5, b2 } = await anaAtTwo("Cobrada");
      await pay(v, b2, "30.00");
      const splitting = await cmd(ana.partyId);

      const error = await refused([ana.partyId], [ana.tabId, b2], [m4, m5], () =>
        act((tx) => splitTable(tx, v.cfg, ana.partyId, m5, b2, splitting)),
      );

      expect(error).toMatchObject({ code: "bill.paid", params: { workingOrderId: b2 } });
    });

    it("refuses another party's bill", async () => {
      const { ana, m4, m5, b2 } = await anaAtTwo("Ajena");
      const [m7] = await tables("Ajena otra", 7);
      const luis = await seat(v, m7);
      const splitting = await cmd(ana.partyId);

      const error = await refused(
        [ana.partyId, luis.partyId],
        [ana.tabId, b2, luis.tabId],
        [m4, m5],
        () => act((tx) => splitTable(tx, v.cfg, ana.partyId, m5, luis.tabId, splitting)),
      );

      expect(error).toMatchObject({
        code: "bill.other_party",
        params: { workingOrderId: luis.tabId },
      });
    });

    it("refuses an abandoned bill, and one that does not exist, as not open", async () => {
      const { ana, m4, m5, b2 } = await anaAtTwo("Abandonada");
      const b3 = await splitOff(ana.partyId, ana.tabId, [1]);
      v.db.run(sql`update working_orders set status = 'abandoned' where id = ${b3}`);
      const missing = randomUUID();
      const splitting = await cmd(ana.partyId);

      const abandoned = await refused([ana.partyId], [ana.tabId, b2, b3], [m4, m5], () =>
        act((tx) => splitTable(tx, v.cfg, ana.partyId, m5, b3, splitting)),
      );
      const absent = await refused([ana.partyId], [ana.tabId, b2], [m4, m5], () =>
        act((tx) => splitTable(tx, v.cfg, ana.partyId, m5, missing, splitting)),
      );

      expect(abandoned).toMatchObject({ code: "tab.not_open", params: { tabId: b3 } });
      expect(absent).toMatchObject({ code: "tab.not_open", params: { tabId: missing } });
    });

    it("refuses a bill holding a dish held for the kitchen, leaving the table's status (Review Focus 4)", async () => {
      const { ana, m4, m5, b2 } = await anaAtTwo("Retenida");
      await giveStatus([m5]);
      await sendGroups(ana.partyId, [{ names: ["Flan"], release: "hold" }], b2);
      const splitting = await cmd(ana.partyId);

      const error = await refused([ana.partyId], [ana.tabId, b2], [m4, m5], () =>
        act((tx) => splitTable(tx, v.cfg, ana.partyId, m5, b2, splitting)),
      );

      expect(error).toMatchObject({
        code: "group.held_leaves_party",
        params: { tabId: b2, lineNo: 2 },
      });
      expect((await tableRow(v, m5)).statusId).not.toBeNull();
    });
  });
});

describe("MOVED notices after a table action", () => {
  it("tells the kitchen of the sent dishes on every bill of a party that joins a table, and nothing of another party's", async () => {
    const [m4, m5, m7] = await tables("AvisoJ", 4, 5, 7);
    const ana = await seat(v, m4);
    const luis = await seat(v, m7);
    await order(v, ana.tabId, "Paella", "Burger");
    const b2 = await splitOff(ana.partyId, ana.tabId, [2]);
    await order(v, luis.tabId, "Tarta");
    const luisNotices = noticesOn([luis.tabId]);

    await joinFree(ana.partyId, m5);

    expect(noticesOn([ana.tabId, b2])).toEqual([
      { working_order_id: ana.tabId, kind: "moved", line_name: "PAELLA", moved_to: "AvisoJ 4, 5" },
      { working_order_id: b2, kind: "moved", line_name: "BURG", moved_to: "AvisoJ 4, 5" },
    ]);
    expect(noticesOn([luis.tabId])).toEqual(luisNotices);
  });

  it("tells the kitchen of the split bill's dishes at the split table, and the party's other dishes at what it keeps", async () => {
    const [m4, m5] = await tables("AvisoS", 4, 5);
    const ana = await seat(v, m4);
    await joinFree(ana.partyId, m5);
    await order(v, ana.tabId, "Paella", "Burger");
    const b2 = await splitOff(ana.partyId, ana.tabId, [2]);
    const earlier = noticesOn([ana.tabId, b2]);

    const splitting = await cmd(ana.partyId);
    await act((tx) => splitTable(tx, v.cfg, ana.partyId, m5, b2, splitting));

    expect(noticesOn([ana.tabId, b2])).toEqual([
      ...earlier,
      { working_order_id: ana.tabId, kind: "moved", line_name: "PAELLA", moved_to: "AvisoS 4" },
      { working_order_id: b2, kind: "moved", line_name: "BURG", moved_to: "AvisoS 5" },
    ]);
  });

  it("tells the kitchen once of a sent dish merged away when parties combine", async () => {
    const [m4, m7] = await tables("AvisoM", 4, 7);
    const ana = await seat(v, m4);
    const luis = await seat(v, m7);
    await order(v, ana.tabId, "Burger");
    await order(v, luis.tabId, "Tarta");
    const luisNotices = noticesOn([luis.tabId]);

    const moving = await opts(ana.partyId, luis.partyId);
    const result = await act((tx) => moveGuests(tx, v.cfg, ana.partyId, m7, moving));

    expect(result.merged).toBe(true);
    expect((await billRow(v, ana.tabId)).status).toBe("abandoned");
    expect(noticesOn([ana.tabId, luis.tabId])).toEqual([
      ...luisNotices,
      { working_order_id: luis.tabId, kind: "moved", line_name: "BURG", moved_to: "AvisoM 7" },
    ]);
  });
});

describe("two tills at once", () => {
  for (const first of ["move", "join"] as const) {
    it(`refuses the second of a move and a join of one party (${first} first)`, async () => {
      const [m4, m6, m9] = await tables(`Dos tills ${first}`, 4, 6, 9);
      const ana = await seat(v, m4);
      const read = await opts(ana.partyId);
      await nextMillisecond();
      const moveIt = () => act((tx) => moveGuests(tx, v.cfg, ana.partyId, m9, read));
      const joinIt = () => act((tx) => joinTables(tx, v.cfg, ana.partyId, m6, read));
      const [winner, loser] = first === "move" ? [moveIt, joinIt] : [joinIt, moveIt];

      await winner();
      const error = await refused([ana.partyId], [ana.tabId], [m4, m6, m9], loser);

      expect(error).toMatchObject({
        code: "party.out_of_date",
        params: { partyId: ana.partyId, revision: read.expectedPartyRevision + 1 },
      });
      expect(await activeTablesOf(v, ana.partyId)).toEqual(first === "move" ? [m9] : [m4, m6]);
    });
  }

  for (const first of ["move", "split"] as const) {
    it(`refuses the second of a move into a party and a split of that party's table (${first} first)`, async () => {
      const [m4, m7, m8] = await tables(`Dos parties ${first}`, 4, 7, 8);
      const ana = await seat(v, m4);
      const luis = await seat(v, m7);
      await joinFree(luis.partyId, m8);
      const moving = await opts(ana.partyId, luis.partyId);
      const splitting = await cmd(luis.partyId);
      const moveIt = () => act((tx) => moveGuests(tx, v.cfg, ana.partyId, m7, moving));
      const splitIt = () => act((tx) => splitTable(tx, v.cfg, luis.partyId, m8, null, splitting));
      const [winner, loser] = first === "move" ? [moveIt, splitIt] : [splitIt, moveIt];

      await winner();
      const error = await refused(
        [ana.partyId, luis.partyId],
        [ana.tabId, luis.tabId],
        [m4, m7, m8],
        loser,
      );

      expect(error).toMatchObject({
        code: "party.out_of_date",
        params: { partyId: luis.partyId, revision: splitting.expectedPartyRevision + 1 },
      });
    });
  }
});

describe("a request read against a party that has since left the target table", () => {
  for (const [name, act_] of [
    ["move guests", moveGuests],
    ["join tables", joinTables],
  ] as const) {
    it(`${name}: refuses it when another party now holds the table, though its revision matches`, async () => {
      const [m4, m7, m9] = await tables(`Extraña ${name}`, 4, 7, 9);
      const source = await seat(v, m4);
      const target = await seat(v, m7);
      await order(v, source.tabId, "Burger");
      const stale = await opts(source.partyId, target.partyId);
      const leaving = await opts(target.partyId);
      await act((tx) => moveGuests(tx, v.cfg, target.partyId, m9, leaving));
      const stranger = await seat(v, m7);
      await order(v, stranger.tabId, "Tarta");
      // The probe: without this the stale revision would be refused whichever party it named.
      expect(await revisionOf(v, stranger.partyId)).toBe(stale.expectedOtherPartyRevision);

      const error = await refused(
        [source.partyId, target.partyId, stranger.partyId],
        [source.tabId, target.tabId, stranger.tabId],
        [m4, m7, m9],
        () => act((tx) => act_(tx, v.cfg, source.partyId, m7, stale)),
      );

      expect(error).toMatchObject({
        code: "party.out_of_date",
        params: { partyId: target.partyId, revision: await revisionOf(v, target.partyId) },
      });
      expect((await linesOf(v, stranger.tabId)).map((l) => l.name)).toEqual(["Tarta"]);
    });

    it(`${name}: refuses it when the table is now free`, async () => {
      const [m4, m7, m9] = await tables(`Vacía ${name}`, 4, 7, 9);
      const source = await seat(v, m4);
      const target = await seat(v, m7);
      const stale = await opts(source.partyId, target.partyId);
      const leaving = await opts(target.partyId);
      await act((tx) => moveGuests(tx, v.cfg, target.partyId, m9, leaving));
      expect(await partyAt(v, m7)).toBeNull();

      const error = await refused(
        [source.partyId, target.partyId],
        [source.tabId, target.tabId],
        [m4, m7, m9],
        () => act((tx) => act_(tx, v.cfg, source.partyId, m7, stale)),
      );

      expect(error).toMatchObject({
        code: "party.out_of_date",
        params: { partyId: target.partyId, revision: await revisionOf(v, target.partyId) },
      });
    });

    it(`${name}: refuses another party's revision sent without naming that party`, async () => {
      const [m4, m7] = await tables(`Sin nombre ${name}`, 4, 7);
      const source = await seat(v, m4);
      const target = await seat(v, m7);
      const { otherPartyId, ...unnamed } = await opts(source.partyId, target.partyId);
      expect(otherPartyId).toBe(target.partyId);

      const error = await refused(
        [source.partyId, target.partyId],
        [source.tabId, target.tabId],
        [m4, m7],
        () => act((tx) => act_(tx, v.cfg, source.partyId, m7, unnamed)),
      );

      expect(error).toMatchObject({
        code: "management.request_invalid",
        params: { field: "otherPartyId" },
      });
    });

    it(`${name}: refuses a table read free that a party now holds, as out of date for that party`, async () => {
      const [m4, m7] = await tables(`Leída libre ${name}`, 4, 7);
      const source = await seat(v, m4);
      const target = await seat(v, m7);
      const readFree = { ...(await opts(source.partyId)), otherPartyId: null };

      const error = await refused(
        [source.partyId, target.partyId],
        [source.tabId, target.tabId],
        [m4, m7],
        () => act((tx) => act_(tx, v.cfg, source.partyId, m7, readFree)),
      );

      expect(error).toMatchObject({
        code: "party.out_of_date",
        params: { partyId: target.partyId, revision: await revisionOf(v, target.partyId) },
      });
    });

    it(`${name}: refuses a table read free sent with another party's revision`, async () => {
      const [m4, m7] = await tables(`Libre con revisión ${name}`, 4, 7);
      const source = await seat(v, m4);
      const contradictory = {
        ...(await opts(source.partyId)),
        otherPartyId: null,
        expectedOtherPartyRevision: 3,
      };

      const error = await refused([source.partyId], [source.tabId], [m4, m7], () =>
        act((tx) => act_(tx, v.cfg, source.partyId, m7, contradictory)),
      );

      expect(error).toMatchObject({
        code: "management.request_invalid",
        params: { field: "otherPartyId" },
      });
    });
  }
});

describe("a party combined into another (Review Focus 3)", () => {
  it("refuses every action on it as not open, even one sent with a stale revision", async () => {
    const [m4, m7, m8, m9] = await tables("Cerrada", 4, 7, 8, 9);
    const ana = await seat(v, m4);
    const luis = await seat(v, m7);
    const stale = await opts(ana.partyId);
    const moving = await opts(ana.partyId, luis.partyId);
    await act((tx) => moveGuests(tx, v.cfg, ana.partyId, m7, moving));
    const current = await opts(ana.partyId);

    for (const sent of [current, stale]) {
      const attempts: (() => Promise<unknown>)[] = [
        () => act((tx) => moveGuests(tx, v.cfg, ana.partyId, m9, sent)),
        () => act((tx) => joinTables(tx, v.cfg, ana.partyId, m8, sent)),
        () => act((tx) => splitTable(tx, v.cfg, ana.partyId, m4, null, sent)),
        () =>
          act((tx) =>
            setPartyName(tx, {
              partyId: ana.partyId,
              name: "Ana",
              expectedPartyRevision: sent.expectedPartyRevision,
            }),
          ),
      ];
      for (const attempt of attempts) {
        const error = await refused(
          [ana.partyId, luis.partyId],
          [ana.tabId, luis.tabId],
          [m4, m7, m8, m9],
          attempt,
        );
        expect(error).toMatchObject({ code: "party.not_open", params: { partyId: ana.partyId } });
      }
    }
  });
});

describe("combineParties", () => {
  it("answers each bill it merged away with the bill it merged into", async () => {
    const [m4, m7] = await tables("Combina", 4, 7);
    const ana = await seat(v, m4);
    const luis = await seat(v, m7);
    await nextMillisecond();

    const result = await act((tx) =>
      combineParties(tx, v.cfg, {
        from: ana.partyId,
        into: luis.partyId,
        bills: "merge",
        tables: "join",
        operatorId: OPERATOR,
      }),
    );

    expect(result).toEqual({
      merged: true,
      mainBillId: luis.tabId,
      mergedInto: new Map([[ana.tabId, luis.tabId]]),
    });
    expect(await activeTablesOf(v, luis.partyId)).toEqual([m7, m4]);
  });
});
