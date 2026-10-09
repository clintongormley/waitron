import { configureZone, createDepartment, setRoutingCell } from "@waitron/venue-service";
import { randomUUID } from "node:crypto";
import { asc, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  captureError,
  diningTables,
  floorZones,
  ticketItems,
  workingOrderLines,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { writeClearingWorkflow } from "@waitron/venue-service";
import { mergeBills, splitBill } from "./bill-actions.js";
import { VENUE_SERVICE } from "./modules.js";
import { moveBill, type MoveBillOptions, type MoveTarget } from "./move-bill.js";
import { createCourse } from "./kitchen.js";
import { bumpGroupReady, markGroupAway, placeGroups } from "./order-groups.js";
import { finishTable } from "./parties.js";
import { moveGuests } from "./table-actions.js";
import { createTable, deactivateTable } from "./tables.js";
import {
  addTabRound,
  createOpenOrder,
  listHeldOrders,
  markServed,
  parkOrder,
  placeOrder,
} from "./working-order.js";
import { offerProducts } from "./testing/zone-offers.js";
import {
  OPERATOR,
  activeTablesOf,
  billRow,
  cashContribution,
  commandFor,
  counterOrder,
  inTx,
  linesOf,
  nameParty,
  order,
  orderForParty,
  partyAt,
  partyRow,
  pay,
  paymentsOf,
  placeByHand,
  pricedInZone,
  revisionOf,
  seat,
  setupPartyVenue,
  tableRow,
  zoneOf,
  type PartyVenue,
} from "./testing/party-venue.js";
import "./errors.js";

// Move a bill to another party, a table or the counter (table actions plan, Task 7; spec §7, §8,
// §9, §15). `resetPerTest: false`: the venue is provisioned once, and each case seats its own tables.
let v: PartyVenue;
/** A counter zone whose orders are invoiced when placed. */
let ticketThenPayZone: string;
/** A second zone of dining tables. */
let terrazaZone: string;
/** Caña at 3.50, offered in the counter zone only; everywhere else it sells at 3.00. */
let counterCaña: string;
/** The tables zone's own department. */
let comedorDepartment: string;

async function zoneNamed(
  tx: Transaction,
  name: string,
  serviceMode: "ticket_then_pay" | "table_tab",
): Promise<string> {
  const [zone] = await tx
    .insert(floorZones)
    .values({ locationId: v.cfg.locationId, name })
    .returning({ id: floorZones.id });
  return (await offerProducts(tx, v.cfg, { zone: { zoneId: zone!.id }, serviceMode })).zoneId;
}

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    v = await setupPartyVenue(db);
    // The tables zone in a department of its own, so a menu priced for the counter's department
    // is not served at the tables.
    await inTx(v, async (tx) => {
      const department = await createDepartment(tx, v.cfg, {
        name: "Comedor",
        defaultServiceMode: "table_tab",
      });
      await configureZone(tx, v.cfg, { zoneId: v.tables.zoneId, departmentId: department.id });
      await offerProducts(tx, v.cfg, { zone: "tables" });
      comedorDepartment = department.id;
    });
    ticketThenPayZone = await inTx(v, (tx) => zoneNamed(tx, "Barra factura", "ticket_then_pay"));
    terrazaZone = await inTx(v, (tx) => zoneNamed(tx, "Terraza", "table_tab"));
    counterCaña = await pricedInZone(v, v.counter.zoneId, "Caña", "3.50");
    // Agua is handed over at the bar, so it is never sent to the kitchen.
    await inTx(v, (tx) =>
      setRoutingCell(
        tx,
        v.cfg,
        { row: { kind: "product", productId: v.productId("Agua") }, zoneId: null },
        { kind: "no_preparation" },
      ),
    );
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

/** The kitchen's items for the bill's lines, in line order. */
async function ticketsOf(billId: string) {
  return inTx(v, (tx) =>
    tx
      .select({
        lineId: ticketItems.workingOrderLineId,
        state: ticketItems.state,
        firedAt: ticketItems.firedAt,
        awayAt: ticketItems.awayAt,
      })
      .from(ticketItems)
      .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
      .where(eq(ticketItems.workingOrderId, billId))
      .orderBy(asc(workingOrderLines.lineNo)),
  );
}

/** The parties, their tables, the tables' rows and each bill's row, lines, payments and zone. */
async function snapshot(partyIds: string[], billIds: string[], tableIds: string[] = []) {
  const read = [];
  for (const id of partyIds) {
    read.push({ party: await partyRow(v, id), tables: await activeTablesOf(v, id) });
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
  const tables = [];
  for (const id of tableIds) tables.push(await tableRow(v, id));
  return { parties: read, bills, tables };
}

/** The id of the party's last group: where a bill of sent dishes arriving in it lands (Task 9). */
function lastGroupOf(partyId: string): string {
  const [row] = v.db.all<{ id: string }>(
    sql`select id from order_groups where party_id = ${partyId} order by position desc limit 1`,
  );
  return row!.id;
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

/** Sends each group as `placeGroups` does, in one transaction: dish names per group. */
async function orderGroups(
  partyId: string,
  groups: { names: string[]; release: "fire" | "hold" }[],
): Promise<void> {
  await inTx(v, (tx) =>
    placeGroups(tx, v.cfg, partyId, {
      groups: groups.map((group) => ({
        lines: group.names.map((name) => ({ menuItemId: v.item(name), quantity: "1" })),
        release: group.release,
      })),
      operatorId: OPERATOR,
    }),
  );
}

/** A counter order in the invoice-first zone, placed, so its invoice is already issued. */
async function placedCounterOrder(...names: string[]): Promise<string> {
  const id = randomUUID();
  const deps = { db: v.db, backend: v.backend, clock: v.clock };
  await parkOrder(deps, v.cfg, {
    id,
    zoneId: ticketThenPayZone,
    lines: names.map((name) => ({ menuItemId: v.item(name), quantity: "1" })),
    operatorId: OPERATOR,
  });
  await placeOrder(deps, v.cfg, id, OPERATOR);
  return id;
}

function registroCount(billId: string): number {
  const [row] = v.db.all<{ count: number }>(sql`
    select count(*) as count from registros_facturacion r
    join sales s on s.id = r.sale_id
    where s.working_order_id = ${billId}`);
  return row!.count;
}

describe("move a bill to another party (after Split a table, or guests joining)", () => {
  it("keeps its id, its lines' prices and VAT class, and lands as a separate bill when it has been paid towards", async () => {
    const mesa4 = await v.table("Mesa 4");
    const mesa7 = await v.table("Mesa 7");
    const ana = await seat(v, mesa4);
    const luis = await seat(v, mesa7);
    await order(v, ana.tabId, "Burger", "Vino");
    const checkId = await splitOff(ana.partyId, ana.tabId, [2]);
    await cashContribution(v, checkId, "10.00"); // partly paid: stays separate
    const linesBefore = await linesOf(v, checkId);

    const result = await move(checkId, { tableId: mesa7 });

    expect(result).toEqual({ partyId: luis.partyId, billId: checkId, merged: false });
    const row = await billRow(v, checkId);
    expect(row.partyId).toBe(luis.partyId);
    expect(row.status).toBe("open");
    expect(await linesOf(v, checkId)).toEqual(
      linesBefore.map((l) => ({ ...l, groupId: lastGroupOf(luis.partyId) })),
    );
    expect(linesBefore.map((l) => [l.name, l.unitPriceGross, l.vatClass])).toEqual([
      ["Vino", 3000, "general"],
    ]);
    expect(await paymentsOf(v, checkId)).toHaveLength(1);
    expect((await partyRow(v, luis.partyId)).mainBillId).toBe(luis.tabId);
    expect((await partyRow(v, ana.partyId)).mainBillId).toBe(ana.tabId);
    expect(await activeTablesOf(v, ana.partyId)).toEqual([mesa4]);
    expect(await activeTablesOf(v, luis.partyId)).toEqual([mesa7]);
  });

  it("merges into the receiving main bill by default when both are untouched", async () => {
    const ana = await seat(v, await v.table("Mesa 5"));
    const luis = await seat(v, await v.table("Mesa 8"));
    await order(v, ana.tabId, "Burger", "Vino");
    await order(v, luis.tabId, "Agua");
    const checkId = await splitOff(ana.partyId, ana.tabId, [2]);

    const result = await move(checkId, { tableId: (await activeTablesOf(v, luis.partyId))[0]! });

    expect(result).toEqual({ partyId: luis.partyId, billId: luis.tabId, merged: true });
    expect((await linesOf(v, luis.tabId)).map((l) => l.name)).toEqual(["Agua", "Vino"]);
    expect((await billRow(v, checkId)).status).toBe("abandoned");
    expect((await partyRow(v, luis.partyId)).mainBillId).toBe(luis.tabId);
  });

  it("keeps it separate when asked, even when both are untouched", async () => {
    const ana = await seat(v, await v.table("Mesa 6"));
    const luis = await seat(v, await v.table("Mesa 9"));
    await order(v, ana.tabId, "Burger", "Vino");
    await order(v, luis.tabId, "Agua");
    const checkId = await splitOff(ana.partyId, ana.tabId, [2]);

    const result = await move(
      checkId,
      { tableId: (await activeTablesOf(v, luis.partyId))[0]! },
      { bills: "separate" },
    );

    expect(result).toEqual({ partyId: luis.partyId, billId: checkId, merged: false });
    expect((await billRow(v, checkId)).status).toBe("open");
    expect((await billRow(v, checkId)).partyId).toBe(luis.partyId);
    expect((await linesOf(v, luis.tabId)).map((l) => l.name)).toEqual(["Agua"]);
    expect((await partyRow(v, luis.partyId)).mainBillId).toBe(luis.tabId);
  });

  it("keeps it separate when the receiving main bill has been paid towards", async () => {
    const mesa = await v.table("Mesa 10");
    const ana = await seat(v, await v.table("Mesa 11"));
    const luis = await seat(v, mesa);
    await order(v, ana.tabId, "Burger", "Vino");
    await order(v, luis.tabId, "Paella");
    await cashContribution(v, luis.tabId, "5.00");
    const checkId = await splitOff(ana.partyId, ana.tabId, [2]);

    const result = await move(checkId, { tableId: mesa });

    expect(result).toEqual({ partyId: luis.partyId, billId: checkId, merged: false });
    expect((await billRow(v, checkId)).status).toBe("open");
    expect((await linesOf(v, luis.tabId)).map((l) => l.name)).toEqual(["Paella"]);
  });

  it("gives a bill that has no service zone the receiving party's", async () => {
    const mesa = await v.table("Mesa 12");
    const bare = await inTx(v, (tx) => createTable(tx, v.cfg, { label: "Mesa sin zona" }));
    const ana = await seat(v, bare.id);
    const luis = await seat(v, mesa);
    expect(await zoneOf(v, ana.tabId)).toBeNull();

    await move(ana.tabId, { tableId: mesa }, { bills: "separate" });
    await orderForParty(v, luis.partyId, ["Flan"], ana.tabId);

    expect(await zoneOf(v, ana.tabId)).toBe(v.tables.zoneId);
    expect((await linesOf(v, ana.tabId)).map((l) => [l.name, l.unitPriceGross])).toEqual([
      ["Flan", 500],
    ]);
    expect((await partyRow(v, ana.partyId)).mainBillId).toBeNull();
  });

  // Two service modes send a dish at different times, so a move merges only bills of one service
  // mode, and never refuses because two bills' modes differ.
  it("keeps both bills when the receiving main bill is in another service mode, though both are untouched", async () => {
    const mesa = await v.table("Mesa modos 2");
    const ana = await seat(v, await v.table("Mesa modos 1"));
    const luis = await seat(v, mesa);
    await order(v, ana.tabId, "Burger", "Vino");
    await order(v, luis.tabId, "Agua");
    // Stands in for the old tab move, which leaves one party's bills in two service modes.
    await inTx(v, (tx) =>
      VENUE_SERVICE.retargetOrderContext(tx, v.cfg, luis.tabId, v.counter.zoneId),
    );
    const checkId = await splitOff(ana.partyId, ana.tabId, [2]);

    const result = await move(checkId, { tableId: mesa });

    expect(result).toEqual({ partyId: luis.partyId, billId: checkId, merged: false });
    expect((await billRow(v, checkId)).status).toBe("open");
    expect((await billRow(v, checkId)).partyId).toBe(luis.partyId);
    expect((await linesOf(v, luis.tabId)).map((l) => l.name)).toEqual(["Agua"]);
    expect((await linesOf(v, checkId)).map((l) => l.name)).toEqual(["Vino"]);
    expect((await partyRow(v, luis.partyId)).mainBillId).toBe(luis.tabId);
    expect(await zoneOf(v, checkId)).toBe(v.tables.zoneId);
    expect(await zoneOf(v, luis.tabId)).toBe(v.counter.zoneId);
  });
});

describe("what a move refuses, changing nothing", () => {
  /** Ana (main bill: Burger; second bill: Vino) and Luis, each at a fresh table. */
  async function twoParties(label: string) {
    const anaTable = await v.table(`${label} A`);
    const luisTable = await v.table(`${label} L`);
    const ana = await seat(v, anaTable);
    const luis = await seat(v, luisTable);
    await order(v, ana.tabId, "Burger", "Vino");
    await order(v, luis.tabId, "Paella");
    const second = await splitOff(ana.partyId, ana.tabId, [2]);
    return { ana, luis, anaTable, luisTable, second };
  }

  async function refused(
    parties: { ana: { partyId: string; tabId: string }; luis: { partyId: string; tabId: string } },
    billIds: string[],
    act: () => Promise<unknown>,
    tableIds: string[] = [],
  ) {
    const partyIds = [parties.ana.partyId, parties.luis.partyId];
    const bills = [parties.ana.tabId, parties.luis.tabId, ...billIds];
    const before = await snapshot(partyIds, bills, tableIds);
    const error = await captureError(act);
    expect(await snapshot(partyIds, bills, tableIds)).toEqual(before);
    return error;
  }

  it("refuses a paid bill", async () => {
    const p = await twoParties("Mesa pagada");
    await pay(v, p.second, "30.00");

    const error = await refused(p, [p.second], () => move(p.second, { tableId: p.luisTable }));

    expect(error).toMatchObject({ code: "bill.paid", params: { workingOrderId: p.second } });
  });

  it("refuses a bill merged away, and one that does not exist, as not open", async () => {
    const p = await twoParties("Mesa abandonada");
    const command = await commandFor(v, p.ana.partyId);
    await inTx(v, (tx) => mergeBills(tx, v.cfg, p.ana.tabId, p.second, command));
    const missing = randomUUID();

    const abandoned = await refused(p, [p.second], () => move(p.second, { tableId: p.luisTable }));
    const absent = await refused(p, [], () =>
      inTx(v, (tx) =>
        moveBill(
          tx,
          v.cfg,
          missing,
          { tableId: p.luisTable },
          { bills: "merge", operatorId: OPERATOR },
        ),
      ),
    );

    expect(abandoned).toMatchObject({ code: "tab.not_open", params: { tabId: p.second } });
    expect(absent).toMatchObject({ code: "tab.not_open", params: { tabId: missing } });
  });

  it.each(["open", "presented"] as const)(
    "refuses the main bill while the party holds another %s bill",
    async (how) => {
      const p = await twoParties(`Mesa principal ${how}`);
      if (how === "presented") await placeByHand(v, p.second);

      const error = await refused(p, [p.second], () =>
        move(p.ana.tabId, { counter: { zoneId: v.counter.zoneId } }),
      );

      expect(error).toMatchObject({
        code: "party.main_bill_stays",
        params: { partyId: p.ana.partyId },
      });
    },
  );

  it("refuses a table the bill's own party holds", async () => {
    const p = await twoParties("Mesa propia");

    const error = await refused(p, [p.second], () => move(p.second, { tableId: p.anaTable }));

    expect(error).toMatchObject({
      code: "table.already_in_party",
      params: { tableId: p.anaTable },
    });
  });

  it("refuses a table that needs clearing", async () => {
    const p = await twoParties("Mesa por recoger");
    const dirty = await v.table("Mesa por recoger D");
    // Stands in for a party having left it with the venue's clearing setting on.
    await inTx(v, (tx) =>
      tx
        .update(diningTables)
        .set({ needsClearingSince: new Date().toISOString() })
        .where(eq(diningTables.id, dirty)),
    );

    const error = await refused(p, [p.second], () => move(p.second, { tableId: dirty }), [dirty]);

    expect(error).toMatchObject({ code: "table.needs_clearing", params: { tableId: dirty } });
  });

  it("refuses a table taken out of use, and one that does not exist", async () => {
    const p = await twoParties("Mesa fuera");
    const retired = await v.table("Mesa fuera R");
    await inTx(v, (tx) => deactivateTable(tx, v.cfg, retired));
    const missing = randomUUID();

    const inactive = await refused(p, [p.second], () => move(p.second, { tableId: retired }), [
      retired,
    ]);
    const absent = await refused(p, [p.second], () => move(p.second, { tableId: missing }));

    expect(inactive).toMatchObject({ code: "table.inactive", params: { tableId: retired } });
    expect(absent).toMatchObject({ code: "table.not_found", params: { tableId: missing } });
  });

  it("refuses a free table in a zone that seats no one, as seating does", async () => {
    const p = await twoParties("Mesa barra");
    const barra = await v.table("Barra 9", v.counter.zoneId);

    const error = await refused(p, [p.second], () => move(p.second, { tableId: barra }), [barra]);

    expect(error).toMatchObject({
      code: "service_zone.mode_incompatible",
      params: { zoneId: v.counter.zoneId, expected: "table_tab" },
    });
    expect(await partyAt(v, barra)).toBeNull();
  });

  it("refuses a counter order sent to the counter", async () => {
    const p = await twoParties("Mesa mostrador");
    const orderId = await counterOrder(v, "Flan");

    const error = await refused(p, [orderId], () =>
      move(orderId, { counter: { zoneId: v.counter.zoneId } }),
    );

    expect(error).toMatchObject({ code: "management.request_invalid", params: { field: "to" } });
  });

  it("refuses a party's bill sent without either party's revision", async () => {
    const p = await twoParties("Mesa sin revision");

    const own = await refused(p, [p.second], () =>
      move(p.second, { tableId: p.luisTable }, { expectedPartyRevision: undefined }),
    );
    const other = await refused(p, [p.second], () =>
      move(p.second, { tableId: p.luisTable }, { expectedOtherPartyRevision: undefined }),
    );

    expect(own).toMatchObject({
      code: "management.request_invalid",
      params: { field: "expectedPartyRevision" },
    });
    expect(other).toMatchObject({
      code: "management.request_invalid",
      params: { field: "expectedOtherPartyRevision" },
    });
  });

  it("refuses a stale revision of either party", async () => {
    const p = await twoParties("Mesa vieja");
    const anaRead = await revisionOf(v, p.ana.partyId);
    const luisRead = await revisionOf(v, p.luis.partyId);
    await nameParty(v, p.ana.partyId, "Ana");
    await nameParty(v, p.luis.partyId, "Luis");

    const own = await refused(p, [p.second], () =>
      move(p.second, { tableId: p.luisTable }, { expectedPartyRevision: anaRead }),
    );
    const other = await refused(p, [p.second], () =>
      move(p.second, { tableId: p.luisTable }, { expectedOtherPartyRevision: luisRead }),
    );

    expect(own).toMatchObject({
      code: "party.out_of_date",
      params: { partyId: p.ana.partyId, revision: anaRead + 1 },
    });
    expect(other).toMatchObject({
      code: "party.out_of_date",
      params: { partyId: p.luis.partyId, revision: luisRead + 1 },
    });
  });

  it("refuses a request naming a party the bill is not in", async () => {
    const p = await twoParties("Mesa otra");

    const error = await refused(p, [p.second], () =>
      move(p.second, { tableId: p.luisTable }, { partyId: p.luis.partyId }),
    );

    expect(error).toMatchObject({
      code: "party.out_of_date",
      params: { partyId: p.luis.partyId, revision: await revisionOf(v, p.luis.partyId) },
    });
  });

  it("refuses a request read against a party another has since replaced at the table, though its revision matches", async () => {
    const p = await twoParties("Mesa extraña");
    const stale: MoveBillOptions = {
      bills: "merge",
      partyId: p.ana.partyId,
      expectedPartyRevision: await revisionOf(v, p.ana.partyId),
      otherPartyId: p.luis.partyId,
      expectedOtherPartyRevision: await revisionOf(v, p.luis.partyId),
      operatorId: OPERATOR,
    };
    const elsewhere = await v.table("Mesa extraña X");
    const leaving = await commandFor(v, p.luis.partyId);
    await inTx(v, (tx) =>
      moveGuests(tx, v.cfg, p.luis.partyId, elsewhere, { ...leaving, bills: "merge" }),
    );
    const stranger = await seat(v, p.luisTable);
    await order(v, stranger.tabId, "Tarta");
    // The probe: without this the stale revision would be refused whichever party it named.
    expect(await revisionOf(v, stranger.partyId)).toBe(stale.expectedOtherPartyRevision);

    const error = await refused(
      p,
      [p.second, stranger.tabId],
      () => inTx(v, (tx) => moveBill(tx, v.cfg, p.second, { tableId: p.luisTable }, stale)),
      [p.luisTable, elsewhere],
    );

    expect(error).toMatchObject({
      code: "party.out_of_date",
      params: { partyId: p.luis.partyId, revision: await revisionOf(v, p.luis.partyId) },
    });
    expect((await linesOf(v, stranger.tabId)).map((l) => l.name)).toEqual(["Tarta"]);
  });

  it("refuses a request read against a party that has since left the table free", async () => {
    const p = await twoParties("Mesa vaciada");
    const stale: MoveBillOptions = {
      bills: "merge",
      partyId: p.ana.partyId,
      expectedPartyRevision: await revisionOf(v, p.ana.partyId),
      otherPartyId: p.luis.partyId,
      expectedOtherPartyRevision: await revisionOf(v, p.luis.partyId),
      operatorId: OPERATOR,
    };
    const elsewhere = await v.table("Mesa vaciada X");
    const leaving = await commandFor(v, p.luis.partyId);
    await inTx(v, (tx) =>
      moveGuests(tx, v.cfg, p.luis.partyId, elsewhere, { ...leaving, bills: "merge" }),
    );
    expect(await partyAt(v, p.luisTable)).toBeNull();

    const error = await refused(
      p,
      [p.second],
      () => inTx(v, (tx) => moveBill(tx, v.cfg, p.second, { tableId: p.luisTable }, stale)),
      [p.luisTable, elsewhere],
    );

    expect(error).toMatchObject({
      code: "party.out_of_date",
      params: { partyId: p.luis.partyId, revision: await revisionOf(v, p.luis.partyId) },
    });
  });

  it("refuses another party's revision sent without naming that party", async () => {
    const p = await twoParties("Mesa sin nombre");

    const error = await refused(p, [p.second], () =>
      move(p.second, { tableId: p.luisTable }, { otherPartyId: undefined }),
    );

    expect(error).toMatchObject({
      code: "management.request_invalid",
      params: { field: "otherPartyId" },
    });
  });

  it("refuses a table read free that a party now holds, as out of date for that party", async () => {
    const p = await twoParties("Mesa leída libre");

    const error = await refused(p, [p.second], () =>
      move(
        p.second,
        { tableId: p.luisTable },
        { otherPartyId: null, expectedOtherPartyRevision: undefined },
      ),
    );

    expect(error).toMatchObject({
      code: "party.out_of_date",
      params: { partyId: p.luis.partyId, revision: await revisionOf(v, p.luis.partyId) },
    });
  });

  it("refuses a table read free sent with another party's revision", async () => {
    const p = await twoParties("Mesa libre con revisión");
    const free = await v.table("Mesa libre con revisión X");

    const error = await refused(
      p,
      [p.second],
      () =>
        move(p.second, { tableId: free }, { otherPartyId: null, expectedOtherPartyRevision: 3 }),
      [free],
    );

    expect(error).toMatchObject({
      code: "management.request_invalid",
      params: { field: "otherPartyId" },
    });
  });

  it("refuses a bill holding a dish held for the kitchen", async () => {
    const anaTable = await v.table("Mesa retenida A");
    const ana = await seat(v, anaTable);
    const luis = await seat(v, await v.table("Mesa retenida L"));
    await orderGroups(ana.partyId, [
      { names: ["Burger"], release: "fire" },
      { names: ["Flan"], release: "hold" },
    ]);

    const error = await refused({ ana, luis }, [], () =>
      move(ana.tabId, { counter: { zoneId: v.counter.zoneId } }),
    );

    expect(error).toMatchObject({
      code: "group.held_leaves_party",
      params: { tabId: ana.tabId, lineNo: 2 },
    });
  });
});

describe("the main bill", () => {
  it("moves the party's only unpaid bill, which is main, and the party's next order makes a new one", async () => {
    const mesa = await v.table("Mesa ultima");
    const ana = await seat(v, mesa);
    await order(v, ana.tabId, "Burger", "Vino");
    const paid = await splitOff(ana.partyId, ana.tabId, [2]);
    await pay(v, paid, "30.00");

    const result = await move(ana.tabId, { counter: { zoneId: v.counter.zoneId } });

    expect(result).toEqual({ partyId: null, billId: ana.tabId, merged: false });
    expect((await partyRow(v, ana.partyId)).mainBillId).toBeNull();
    expect(await activeTablesOf(v, ana.partyId)).toEqual([mesa]);
    const { tabId } = await orderForParty(v, ana.partyId, ["Flan"]);
    expect(tabId).not.toBe(ana.tabId);
    expect((await partyRow(v, ana.partyId)).mainBillId).toBe(tabId);
    expect((await billRow(v, tabId)).partyId).toBe(ana.partyId);
    expect((await linesOf(v, ana.tabId)).map((l) => l.name)).toEqual(["Burger"]);
  });
});

describe("kitchen groups when a bill leaves its party", () => {
  it("takes sent dishes out of their group into one of the receiving party's, keeping their preparation and service state", async () => {
    const ana = await seat(v, await v.table("Mesa grupo A"));
    const luisTable = await v.table("Mesa grupo L");
    await seat(v, luisTable);
    await orderGroups(ana.partyId, [{ names: ["Burger", "Vino"], release: "fire" }]);
    const second = await splitOff(ana.partyId, ana.tabId, [2]);
    const [vino] = await lineRows(second);
    const args = async () => ({
      submissionId: randomUUID(),
      expectedPartyRevision: await revisionOf(v, ana.partyId),
      operatorId: OPERATOR,
    });
    const readyArgs = await args();
    await inTx(v, (tx) => bumpGroupReady(tx, v.cfg, ana.partyId, vino!.groupId!, readyArgs));
    const awayArgs = await args();
    await inTx(v, (tx) => markGroupAway(tx, v.cfg, ana.partyId, vino!.groupId!, awayArgs));
    const servedArgs = await args();
    await inTx(v, (tx) =>
      markServed(tx, v.cfg, ana.partyId, [{ lineId: vino!.id, quantity: "1" }], servedArgs),
    );
    const linesBefore = await lineRows(second);
    const ticketsBefore = await ticketsOf(second);
    expect(linesBefore[0]!.groupId).not.toBeNull();
    expect(linesBefore[0]!.servedQuantity).toBe(1000);
    expect(ticketsBefore).toEqual([
      { lineId: vino!.id, state: "ready", firedAt: expect.any(String), awayAt: expect.any(String) },
    ]);

    await move(second, { tableId: luisTable }, { bills: "separate" });

    const groupId = lastGroupOf((await partyAt(v, luisTable))!);
    expect(await lineRows(second)).toEqual(linesBefore.map((line) => ({ ...line, groupId })));
    expect(await ticketsOf(second)).toEqual(ticketsBefore);
  });
});

describe("move a bill to a free table (A81, from a party)", () => {
  it("opens a new unnamed party there, with the bill as its main bill in that table's zone", async () => {
    const mesa = await v.table("Mesa libre A");
    const terraza = await v.table("Terraza libre", terrazaZone);
    const ana = await seat(v, mesa);
    await order(v, ana.tabId, "Burger", "Vino");
    const second = await splitOff(ana.partyId, ana.tabId, [2]);

    const result = await move(second, { tableId: terraza });

    expect(result.merged).toBe(false);
    expect(result.billId).toBe(second);
    expect(result.partyId).not.toBe(ana.partyId);
    const made = await partyRow(v, result.partyId!);
    expect({ name: made.name, state: made.state, mainBillId: made.mainBillId }).toEqual({
      name: null,
      state: "open",
      mainBillId: second,
    });
    expect(await activeTablesOf(v, result.partyId!)).toEqual([terraza]);
    expect(await partyAt(v, terraza)).toBe(result.partyId);
    expect((await billRow(v, second)).partyId).toBe(result.partyId);
    expect(await zoneOf(v, second)).toBe(terrazaZone);
    expect(await activeTablesOf(v, ana.partyId)).toEqual([mesa]);
    expect((await partyRow(v, ana.partyId)).mainBillId).toBe(ana.tabId);
  });
});

describe("move a bill to a free table with no service zone", () => {
  it("opens a new party there, and the bill keeps the zone it had", async () => {
    const ana = await seat(v, await v.table("Mesa libre B"));
    const bare = await inTx(v, (tx) => createTable(tx, v.cfg, { label: "Mesa libre sin zona" }));
    await order(v, ana.tabId, "Burger", "Vino");
    const second = await splitOff(ana.partyId, ana.tabId, [2]);

    const result = await move(second, { tableId: bare.id });

    expect(await partyAt(v, bare.id)).toBe(result.partyId);
    expect((await partyRow(v, result.partyId!)).mainBillId).toBe(second);
    expect(await zoneOf(v, second)).toBe(v.tables.zoneId);
  });
});

describe("move a bill to the counter (A82)", () => {
  it("leaves the party, is labelled with the party's display name, and is listed at the counter in the zone sent", async () => {
    const mesa = await v.table("Mesa C4");
    const ana = await seat(v, mesa);
    await order(v, ana.tabId, "Burger", "Vino");
    const second = await splitOff(ana.partyId, ana.tabId, [2]);
    await nameParty(v, ana.partyId, "Ana");

    const result = await move(second, { counter: { zoneId: v.counter.zoneId } });

    expect(result).toEqual({ partyId: null, billId: second, merged: false });
    const row = await billRow(v, second);
    expect({ partyId: row.partyId, label: row.label, status: row.status }).toEqual({
      partyId: null,
      label: "Ana",
      status: "open",
    });
    const held = await listHeldOrders({ db: v.db }, v.cfg);
    expect(held.find((h) => h.id === second)).toMatchObject({ label: "Ana", itemCount: 1 });
    expect(await zoneOf(v, second)).toBe(v.counter.zoneId);
    expect((await partyRow(v, ana.partyId)).mainBillId).toBe(ana.tabId);
    expect(await activeTablesOf(v, ana.partyId)).toEqual([mesa]);
  });

  it("names the party's tables when the party has no name, and keeps the zone when none is sent", async () => {
    const ana = await seat(v, await v.table("Mesa C5"));
    await order(v, ana.tabId, "Burger", "Vino");
    const second = await splitOff(ana.partyId, ana.tabId, [2]);

    await move(second, { counter: { zoneId: null } });

    expect((await billRow(v, second)).label).toBe("Mesa C5");
    expect(await zoneOf(v, second)).toBe(v.tables.zoneId);
  });
});

describe("move a counter order into a party", () => {
  it("merges a parked counter order into the party's main bill when both are untouched", async () => {
    const mesa = await v.table("Mesa D1");
    const ana = await seat(v, mesa);
    await order(v, ana.tabId, "Burger");
    const orderId = await counterOrder(v, "Tarta");

    const result = await move(orderId, { tableId: mesa });

    expect(result).toEqual({ partyId: ana.partyId, billId: ana.tabId, merged: true });
    expect((await linesOf(v, ana.tabId)).map((l) => l.name)).toEqual(["Burger", "Tarta"]);
    expect((await billRow(v, orderId)).status).toBe("abandoned");
    expect((await partyRow(v, ana.partyId)).mainBillId).toBe(ana.tabId);
  });

  it("keeps it a separate bill of the party when asked, no longer delivered to a table", async () => {
    const mesa = await v.table("Mesa D2");
    const barra = await v.table("Barra D2", v.counter.zoneId);
    const ana = await seat(v, mesa);
    await order(v, ana.tabId, "Burger");
    const orderId = randomUUID();
    // Through `createOpenOrder`, which is where a sale's `deliveryTableId` is written.
    await inTx(v, (tx) =>
      createOpenOrder(
        tx,
        v.cfg,
        orderId,
        [{ menuItemId: v.counterItem("Tarta"), quantity: "1" }],
        null,
        { deliveryTableId: barra, creditedTo: OPERATOR },
      ),
    );
    expect((await billRow(v, orderId)).deliveryTableId).toBe(barra);

    const result = await move(orderId, { tableId: mesa }, { bills: "separate" });

    expect(result).toEqual({ partyId: ana.partyId, billId: orderId, merged: false });
    const row = await billRow(v, orderId);
    expect({
      partyId: row.partyId,
      deliveryTableId: row.deliveryTableId,
      status: row.status,
    }).toEqual({ partyId: ana.partyId, deliveryTableId: null, status: "open" });
    expect((await linesOf(v, ana.tabId)).map((l) => l.name)).toEqual(["Burger"]);
    expect((await partyRow(v, ana.partyId)).mainBillId).toBe(ana.tabId);
    expect(await zoneOf(v, orderId)).toBe(v.tables.zoneId);
  });

  it("seats a counter order at a free table as a new party's main bill", async () => {
    const mesa = await v.table("Mesa D3");
    const orderId = await counterOrder(v, "Tarta");

    const result = await move(orderId, { tableId: mesa });

    expect(result.billId).toBe(orderId);
    expect(result.merged).toBe(false);
    expect(await partyAt(v, mesa)).toBe(result.partyId);
    expect((await partyRow(v, result.partyId!)).mainBillId).toBe(orderId);
    expect((await billRow(v, orderId)).partyId).toBe(result.partyId);
    expect(await zoneOf(v, orderId)).toBe(v.tables.zoneId);
  });
});

describe("the service area of a moved bill", () => {
  it("keeps an item's price and VAT class, and prices what is added later from the receiving zone", async () => {
    const mesa = await v.table("Mesa zona");
    const ana = await seat(v, mesa);
    await order(v, ana.tabId, "Caña");
    const orderId = randomUUID();
    await parkOrder({ db: v.db }, v.cfg, {
      id: orderId,
      zoneId: v.counter.zoneId,
      lines: [{ menuItemId: counterCaña, quantity: "1" }],
      operatorId: OPERATOR,
    });
    // The fixture: one dish, two prices in two zones.
    expect((await linesOf(v, orderId)).map((l) => [l.unitPriceGross, l.vatClass])).toEqual([
      [350, "general"],
    ]);
    expect((await linesOf(v, ana.tabId)).map((l) => l.unitPriceGross)).toEqual([300]);

    await move(orderId, { tableId: mesa }, { bills: "separate" });
    await orderForParty(v, ana.partyId, ["Caña"], orderId);

    expect((await linesOf(v, orderId)).map((l) => [l.name, l.unitPriceGross, l.vatClass])).toEqual([
      ["Caña", 350, "general"],
      ["Caña", 300, "general"],
    ]);
    expect(await zoneOf(v, orderId)).toBe(v.tables.zoneId);
    // The counter's own offer is no longer served on it.
    const counterOffer = await captureError(() =>
      inTx(v, (tx) =>
        placeGroups(tx, v.cfg, ana.partyId, {
          groups: [{ lines: [{ menuItemId: counterCaña, quantity: "1" }], release: "fire" }],
          operatorId: OPERATOR,
          billId: orderId,
        }),
      ),
    );
    expect(counterOffer).toMatchObject({ code: "service_zone.offer_not_allowed" });
    expect(await linesOf(v, orderId)).toHaveLength(2);
  });

  it("gives a presented bill the table's zone, keeps its status and lines, and it takes no order", async () => {
    const mesa = await v.table("Mesa presentada");
    const ana = await seat(v, mesa);
    await order(v, ana.tabId, "Burger");
    const placed = await placedCounterOrder("Tarta");
    const linesBefore = await lineRows(placed);
    const before = await inTx(v, (tx) => VENUE_SERVICE.findOrderContext(tx, v.cfg, placed));
    expect(before!.serviceMode).toBe("prepay");
    expect(before!.departmentId).not.toBe(comedorDepartment);

    const result = await move(placed, { tableId: mesa });

    expect(result).toEqual({ partyId: ana.partyId, billId: placed, merged: false });
    const row = await billRow(v, placed);
    expect({ partyId: row.partyId, status: row.status }).toEqual({
      partyId: ana.partyId,
      status: "placed",
    });
    expect(await inTx(v, (tx) => VENUE_SERVICE.findOrderContext(tx, v.cfg, placed))).toEqual({
      zoneId: v.tables.zoneId,
      departmentId: comedorDepartment,
      serviceMode: "table_tab",
    });
    expect(await lineRows(placed)).toEqual(
      linesBefore.map((line) => ({ ...line, groupId: lastGroupOf(ana.partyId) })),
    );
    const error = await captureError(() => orderForParty(v, ana.partyId, ["Flan"], placed));
    expect(error).toMatchObject({ code: "bill.presented", params: { workingOrderId: placed } });
    expect(await lineRows(placed)).toEqual(
      linesBefore.map((line) => ({ ...line, groupId: lastGroupOf(ana.partyId) })),
    );
    expect((await partyRow(v, ana.partyId)).mainBillId).toBe(ana.tabId);
  });
});

describe("the dishes of an open bill moved between service modes", () => {
  it("sends a pay-first counter order's dish when it joins a party as a separate bill, as a round is sent", async () => {
    const mesa = await v.table("Mesa envío 1");
    const ana = await seat(v, mesa);
    await order(v, ana.tabId, "Burger");
    const orderId = await counterOrder(v, "Tarta");
    expect(await ticketsOf(orderId)).toEqual([]);

    await move(orderId, { tableId: mesa }, { bills: "separate" });

    const sent = await ticketsOf(orderId);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.firedAt).not.toBeNull();
    expect((await lineRows(orderId))[0]!.sentAt).not.toBeNull();

    await orderForParty(v, ana.partyId, ["Flan"], orderId);
    await cashContribution(v, orderId, "20.00");

    expect((await billRow(v, orderId)).status).toBe("settled");
    expect(registroCount(orderId)).toBe(1);
    const after = await ticketsOf(orderId);
    expect(after).toHaveLength(2);
    expect(after[0]).toEqual(sent[0]);
  });

  it("sends a pay-first counter order's dish when it merges into the party's main bill", async () => {
    const mesa = await v.table("Mesa envío 2");
    const ana = await seat(v, mesa);
    await order(v, ana.tabId, "Burger");
    const orderId = await counterOrder(v, "Tarta");

    const result = await move(orderId, { tableId: mesa });

    expect(result).toEqual({ partyId: ana.partyId, billId: ana.tabId, merged: true });
    const tickets = await ticketsOf(ana.tabId);
    expect(tickets).toHaveLength(2);
    expect(tickets.every((ticket) => ticket.firedAt !== null)).toBe(true);
  });

  it("sends a pay-first counter order's dish when it is seated at a free table", async () => {
    const orderId = await counterOrder(v, "Tarta");

    await move(orderId, { tableId: await v.table("Mesa envío 3") });

    const tickets = await ticketsOf(orderId);
    expect(tickets).toHaveLength(1);
    expect(tickets[0]!.firedAt).not.toBeNull();
  });

  it("sends an invoice-first counter order's dish when it joins a party before it is placed", async () => {
    const mesa = await v.table("Mesa envío 5");
    await seat(v, mesa);
    const orderId = randomUUID();
    await parkOrder({ db: v.db }, v.cfg, {
      id: orderId,
      zoneId: ticketThenPayZone,
      lines: [{ menuItemId: v.item("Tarta"), quantity: "1" }],
      operatorId: OPERATOR,
    });

    await move(orderId, { tableId: mesa }, { bills: "separate" });

    const tickets = await ticketsOf(orderId);
    expect(tickets).toHaveLength(1);
    expect(tickets[0]!.firedAt).not.toBeNull();
  });

  it("leaves a counter order's dish for its payment to send when it keeps its pay-first zone at a table with no zone", async () => {
    const bare = await inTx(v, (tx) => createTable(tx, v.cfg, { label: "Mesa envío sin zona" }));
    const orderId = await counterOrder(v, "Tarta");

    await move(orderId, { tableId: bare.id });
    const atMove = await ticketsOf(orderId);
    await cashContribution(v, orderId, "15.00");

    expect(await zoneOf(v, orderId)).toBe(v.counter.zoneId);
    expect(atMove).toEqual([]);
    expect((await billRow(v, orderId)).status).toBe("settled");
    const tickets = await ticketsOf(orderId);
    expect(tickets).toHaveLength(1);
    expect(tickets[0]!.firedAt).not.toBeNull();
  });

  /** An unsent Tarta parked in a ticket_then_pay counter zone, then moved to a party at a table
   *  with no zone, so the bill keeps the counter zone; and `walkUp`, the same dish parked in the
   *  same zone with no party, whose payment shows the dish could have been sent. */
  async function partyBillInTicketZone(name: string) {
    const ticketZone = await inTx(v, async (tx) => {
      const [zone] = await tx
        .insert(floorZones)
        .values({ locationId: v.cfg.locationId, name: `Barra ${name}` })
        .returning({ id: floorZones.id });
      // Offering Tarta here writes no prep-station rule; the suite's other rules remain.
      const offered = await offerProducts(tx, v.cfg, {
        zone: { zoneId: zone!.id },
        serviceMode: "ticket_then_pay",
        productIds: [v.productId("Tarta")],
      });
      await tx.execute(sql`
        update zone_sale_policies set paid_when = 'ticket_then_pay'
        where zone_id = ${offered.zoneId}`);
      return offered;
    });
    const [orderId, walkUp] = [randomUUID(), randomUUID()];
    for (const id of [orderId, walkUp]) {
      await parkOrder({ db: v.db }, v.cfg, {
        id,
        zoneId: ticketZone.zoneId,
        lines: [{ menuItemId: ticketZone.offerFor(v.productId("Tarta")), quantity: "1" }],
        operatorId: OPERATOR,
      });
    }
    const bare = await inTx(v, (tx) => createTable(tx, v.cfg, { label: `Mesa ${name}` }));

    await move(orderId, { tableId: bare.id });
    return { orderId, walkUp, zoneId: ticketZone.zoneId };
  }

  async function expectSentOnce(billId: string) {
    expect((await billRow(v, billId)).status).toBe("settled");
    const tickets = await ticketsOf(billId);
    expect(tickets).toHaveLength(1);
    expect(tickets[0]!.firedAt).not.toBeNull();
  }

  it("sends nothing when it pays a party's bill that keeps its send-before-payment counter zone at a table with no zone", async () => {
    const { orderId, walkUp, zoneId } = await partyBillInTicketZone("ticket sin zona");
    expect(await zoneOf(v, orderId)).toBe(zoneId);
    expect((await billRow(v, orderId)).partyId).not.toBeNull();
    expect(await ticketsOf(orderId)).toEqual([]);
    await cashContribution(v, orderId, "15.00");
    await cashContribution(v, walkUp, "15.00");

    expect((await billRow(v, orderId)).status).toBe("settled");
    expect(await ticketsOf(orderId)).toEqual([]);
    await expectSentOnce(walkUp);
  });

  it("sends nothing when it pays, in full at the till, a party's bill that keeps its ticket_then_pay counter zone at a table with no zone", async () => {
    const { orderId, walkUp, zoneId } = await partyBillInTicketZone("ticket sin zona, pago entero");
    expect(await zoneOf(v, orderId)).toBe(zoneId);
    expect((await billRow(v, orderId)).partyId).not.toBeNull();

    await pay(v, orderId, "15.00");
    await pay(v, walkUp, "15.00");

    expect((await billRow(v, orderId)).status).toBe("settled");
    expect(await ticketsOf(orderId)).toEqual([]);
    await expectSentOnce(walkUp);
  });

  it("does not send a table bill's sent dish again when it is paid at a pay-first counter", async () => {
    const ana = await seat(v, await v.table("Mesa envío 4"));
    await order(v, ana.tabId, "Burger");
    const sent = await ticketsOf(ana.tabId);

    await move(ana.tabId, { counter: { zoneId: v.counter.zoneId } });
    await cashContribution(v, ana.tabId, "12.00");

    expect((await billRow(v, ana.tabId)).status).toBe("settled");
    expect(registroCount(ana.tabId)).toBe(1);
    expect(await ticketsOf(ana.tabId)).toEqual(sent);
  });

  it("refuses product.unavailable, changing nothing, when a pay-first counter order's dish has sold out before it joins a table-service party", async () => {
    const mesa = await v.table("Mesa agotado 1");
    const ana = await seat(v, mesa);
    await order(v, ana.tabId, "Burger");
    const orderId = await counterOrder(v, "Tarta", "Paella");
    const paella = v.productId("Paella");
    v.db.run(sql`update products set available = 0 where id = ${paella}`);
    try {
      const before = await snapshot([ana.partyId], [orderId, ana.tabId], [mesa]);

      await expect(move(orderId, { tableId: mesa }, { bills: "separate" })).rejects.toMatchObject({
        code: "product.unavailable",
        params: { productId: paella },
      });

      expect(await snapshot([ana.partyId], [orderId, ana.tabId], [mesa])).toEqual(before);
      expect(await ticketsOf(orderId)).toEqual([]);
    } finally {
      v.db.run(sql`update products set available = 1 where id = ${paella}`);
    }
  });

  it("leaves a table bill's no-preparation dish waiting in a later course unsent when it moves to another table-service party", async () => {
    const [entrantes, postres] = await inTx(v, async (tx) => [
      (await createCourse(tx, v.cfg, { name: "Entrantes envío", displayOrder: 1 })).id,
      (await createCourse(tx, v.cfg, { name: "Postres envío", displayOrder: 2 })).id,
    ]);
    const ana = await seat(v, await v.table("Mesa curso 1"));
    const mesa = await v.table("Mesa curso 2");
    await seat(v, mesa);
    await inTx(v, (tx) =>
      addTabRound(tx, v.cfg, ana.tabId, [
        { menuItemId: v.item("Agua"), quantity: "1", courseId: entrantes },
        { menuItemId: v.item("Agua"), quantity: "1", courseId: postres },
      ]),
    );
    const [first, waiting] = await lineRows(ana.tabId);
    expect(first!.sentAt).not.toBeNull();
    expect(waiting!.sentAt).toBeNull();

    await move(ana.tabId, { tableId: mesa }, { bills: "separate" });

    expect((await lineRows(ana.tabId))[1]!.sentAt).toBeNull();
  });
});

describe("a presented party bill leaves its party", () => {
  /** Ana's second bill, Vino and Flan fired as one group, then presented. */
  async function presentedSplit(label: string) {
    const ana = await seat(v, await v.table(`${label} A`));
    await orderGroups(ana.partyId, [{ names: ["Burger", "Vino", "Flan"], release: "fire" }]);
    const second = await splitOff(ana.partyId, ana.tabId, [2, 3]);
    await placeByHand(v, second);
    const lines = await lineRows(second);
    expect(lines.map((l) => l.groupId)).toEqual([expect.any(String), expect.any(String)]);
    return { ana, second, lines, tickets: await ticketsOf(second) };
  }

  it("keeps it presented, with every line's contents, at another party, taking that party's zone", async () => {
    const { second, lines, tickets } = await presentedSplit("Mesa presentada 2");
    const luisTable = await v.table("Terraza presentada 2", terrazaZone);
    const luis = await seat(v, luisTable);

    const result = await move(second, { tableId: luisTable });

    expect(result).toEqual({ partyId: luis.partyId, billId: second, merged: false });
    expect((await billRow(v, second)).status).toBe("placed");
    const groupId = lastGroupOf(luis.partyId);
    expect(await lineRows(second)).toEqual(lines.map((line) => ({ ...line, groupId })));
    expect(await ticketsOf(second)).toEqual(tickets);
    expect(await zoneOf(v, second)).toBe(terrazaZone);
    expect((await partyRow(v, luis.partyId)).mainBillId).toBe(luis.tabId);
  });

  it("opens a new party at a free table with no main bill, since a presented bill takes no orders", async () => {
    const { second, lines } = await presentedSplit("Mesa presentada 4");
    const libre = await v.table("Mesa presentada 4 libre");

    const result = await move(second, { tableId: libre });

    expect(result.billId).toBe(second);
    expect(await partyAt(v, libre)).toBe(result.partyId);
    expect((await partyRow(v, result.partyId!)).mainBillId).toBeNull();
    expect((await billRow(v, second)).status).toBe("placed");
    const groupId = lastGroupOf(result.partyId!);
    expect(await lineRows(second)).toEqual(lines.map((line) => ({ ...line, groupId })));
    const { tabId } = await orderForParty(v, result.partyId!, ["Flan"]);
    expect(tabId).not.toBe(second);
    expect((await partyRow(v, result.partyId!)).mainBillId).toBe(tabId);
  });

  it("moves a presented bill's revision on, to another party, a free table or the counter", async () => {
    const toParty = await presentedSplit("Mesa presentada 5");
    const luisTable = await v.table("Mesa presentada 5 L");
    await seat(v, luisTable);
    const toFree = await presentedSplit("Mesa presentada 6");
    const toCounter = await presentedSplit("Mesa presentada 7");
    const before = [
      (await billRow(v, toParty.second)).revision,
      (await billRow(v, toFree.second)).revision,
      (await billRow(v, toCounter.second)).revision,
    ];

    await move(toParty.second, { tableId: luisTable });
    await move(toFree.second, { tableId: await v.table("Mesa presentada 6 libre") });
    await move(toCounter.second, { counter: { zoneId: null } });

    const after = [
      await billRow(v, toParty.second),
      await billRow(v, toFree.second),
      await billRow(v, toCounter.second),
    ];
    expect(after.map((row) => row.status)).toEqual(["placed", "placed", "placed"]);
    expect(after.map((row) => row.revision)).toEqual(before.map((revision) => revision + 1));
  });

  it("keeps its label, frozen when it was presented, when it goes to the counter", async () => {
    const { ana, second, lines, tickets } = await presentedSplit("Mesa presentada 3");
    const label = (await billRow(v, second)).label;
    await nameParty(v, ana.partyId, "Ana");

    const result = await move(second, { counter: { zoneId: v.counter.zoneId } });

    expect(result).toEqual({ partyId: null, billId: second, merged: false });
    const row = await billRow(v, second);
    expect({ partyId: row.partyId, label: row.label, status: row.status }).toEqual({
      partyId: null,
      label,
      status: "placed",
    });
    expect(label).toBe("Mesa presentada 3 A");
    expect(await lineRows(second)).toEqual(lines.map((line) => ({ ...line, groupId: null })));
    expect(await ticketsOf(second)).toEqual(tickets);
    expect(await zoneOf(v, second)).toBe(v.tables.zoneId);
  });
});

describe("MOVED notices", () => {
  /** Ana's main bill (Paella, sent) and second bill (Burger and Vino sent, Agua never sent). */
  async function sentSplit(label: string) {
    const ana = await seat(v, await v.table(`${label} A`));
    await order(v, ana.tabId, "Paella", "Burger", "Vino", "Agua");
    const second = await splitOff(ana.partyId, ana.tabId, [2, 3, 4]);
    expect((await ticketsOf(second)).map((t) => t.firedAt !== null)).toEqual([true, true]);
    expect((await ticketsOf(ana.tabId)).map((t) => t.firedAt !== null)).toEqual([true]);
    return { ana, second, mainNotices: noticesOn([ana.tabId]) };
  }

  it("tells the kitchen of each sent dish of a bill moved to another party, naming its tables", async () => {
    const { ana, second, mainNotices } = await sentSplit("Mesa aviso 1");
    const luisTable = await v.table("Mesa aviso 7");
    await seat(v, luisTable);

    await move(second, { tableId: luisTable }, { bills: "separate" });

    expect(noticesOn([second])).toEqual([
      { working_order_id: second, kind: "moved", line_name: "BURG", moved_to: "Mesa aviso 7" },
      { working_order_id: second, kind: "moved", line_name: "TINTO", moved_to: "Mesa aviso 7" },
    ]);
    expect(noticesOn([ana.tabId])).toEqual(mainNotices);
  });

  it("tells the kitchen of each sent dish of a bill moved to the counter, though its label reads the same", async () => {
    const { ana, second, mainNotices } = await sentSplit("Mesa aviso 2");

    await move(second, { counter: { zoneId: v.counter.zoneId } });

    expect((await billRow(v, second)).label).toBe("Mesa aviso 2 A");
    expect(noticesOn([second])).toEqual([
      { working_order_id: second, kind: "moved", line_name: "BURG", moved_to: "Mesa aviso 2 A" },
      { working_order_id: second, kind: "moved", line_name: "TINTO", moved_to: "Mesa aviso 2 A" },
    ]);
    expect(noticesOn([ana.tabId])).toEqual(mainNotices);
  });

  it("tells the kitchen once of each sent dish of a bill merged into another party's main bill", async () => {
    const { ana, second, mainNotices } = await sentSplit("Mesa aviso 4");
    const luisTable = await v.table("Mesa aviso 8");
    const luis = await seat(v, luisTable);
    await order(v, luis.tabId, "Paella");
    const luisNotices = noticesOn([luis.tabId]);

    const result = await move(second, { tableId: luisTable });

    expect(result).toEqual({ partyId: luis.partyId, billId: luis.tabId, merged: true });
    expect(noticesOn([second, luis.tabId])).toEqual([
      ...luisNotices,
      { working_order_id: luis.tabId, kind: "moved", line_name: "BURG", moved_to: "Mesa aviso 8" },
      { working_order_id: luis.tabId, kind: "moved", line_name: "TINTO", moved_to: "Mesa aviso 8" },
    ]);
    expect(noticesOn([ana.tabId])).toEqual(mainNotices);
  });

  it("tells the kitchen of each sent dish of a placed counter order moved into a party", async () => {
    const mesa = await v.table("Mesa aviso 3");
    const ana = await seat(v, mesa);
    await order(v, ana.tabId, "Paella");
    const mainNotices = noticesOn([ana.tabId]);
    const placed = await placedCounterOrder("Burger", "Vino");
    expect((await ticketsOf(placed)).map((t) => t.firedAt !== null)).toEqual([true, true]);

    await move(placed, { tableId: mesa });

    expect(noticesOn([placed])).toEqual([
      { working_order_id: placed, kind: "moved", line_name: "BURG", moved_to: "Mesa aviso 3" },
      { working_order_id: placed, kind: "moved", line_name: "TINTO", moved_to: "Mesa aviso 3" },
    ]);
    expect(noticesOn([ana.tabId])).toEqual(mainNotices);
  });
});

describe("two tills at once", () => {
  async function splitAtTwoTables(label: string) {
    const luisTable = await v.table(`${label} L`);
    const ana = await seat(v, await v.table(`${label} A`));
    const luis = await seat(v, luisTable);
    await order(v, ana.tabId, "Burger", "Vino");
    await order(v, luis.tabId, "Paella");
    const second = await splitOff(ana.partyId, ana.tabId, [2]);
    return { ana, luis, luisTable, second };
  }

  for (const first of ["move", "merge"] as const) {
    it(`refuses the second of a move to another party and a merge back (${first} first)`, async () => {
      const { ana, luis, luisTable, second } = await splitAtTwoTables(`Mesa dos ${first}`);
      const anaRead = await revisionOf(v, ana.partyId);
      const luisRead = await revisionOf(v, luis.partyId);
      const moveIt = () =>
        inTx(v, (tx) =>
          moveBill(
            tx,
            v.cfg,
            second,
            { tableId: luisTable },
            {
              bills: "separate",
              expectedPartyRevision: anaRead,
              otherPartyId: luis.partyId,
              expectedOtherPartyRevision: luisRead,
              operatorId: OPERATOR,
            },
          ),
        );
      const mergeIt = () =>
        inTx(v, (tx) =>
          mergeBills(tx, v.cfg, ana.tabId, second, {
            expectedPartyRevision: anaRead,
            operatorId: OPERATOR,
          }),
        );
      const [winner, loser] = first === "move" ? [moveIt, mergeIt] : [mergeIt, moveIt];

      await winner();
      const bills = [ana.tabId, luis.tabId, second];
      const afterFirst = await snapshot([ana.partyId, luis.partyId], bills);
      const error = await captureError(loser);

      expect(error).toMatchObject({
        code: "party.out_of_date",
        params: { partyId: ana.partyId, revision: anaRead + 1 },
      });
      expect(await snapshot([ana.partyId, luis.partyId], bills)).toEqual(afterFirst);
      const row = await billRow(v, second);
      if (first === "move") expect(row.partyId).toBe(luis.partyId);
      else expect(row.status).toBe("abandoned");
    });
  }

  for (const first of ["A", "B"] as const) {
    it(`refuses the second till's move of a counter order it read with no party (till ${first} first)`, async () => {
      const anaTable = await v.table(`Mesa barra ${first} A`);
      const luisTable = await v.table(`Mesa barra ${first} L`);
      const ana = await seat(v, anaTable);
      const luis = await seat(v, luisTable);
      const orderId = await counterOrder(v, "Tarta");
      const read = [await revisionOf(v, ana.partyId), await revisionOf(v, luis.partyId)];
      const tillMoves = (tableId: string, otherPartyId: string, otherRevision: number) => () =>
        inTx(v, (tx) =>
          moveBill(
            tx,
            v.cfg,
            orderId,
            { tableId },
            {
              bills: "separate",
              partyId: null,
              otherPartyId,
              expectedOtherPartyRevision: otherRevision,
              operatorId: OPERATOR,
            },
          ),
        );
      const tillA = tillMoves(anaTable, ana.partyId, read[0]!);
      const tillB = tillMoves(luisTable, luis.partyId, read[1]!);
      const [winner, loser, winnerParty] =
        first === "A" ? [tillA, tillB, ana.partyId] : [tillB, tillA, luis.partyId];

      await winner();
      const bills = [ana.tabId, luis.tabId, orderId];
      const afterFirst = await snapshot([ana.partyId, luis.partyId], bills);
      const error = await captureError(loser);

      expect(error).toMatchObject({
        code: "party.out_of_date",
        params: { partyId: winnerParty, revision: await revisionOf(v, winnerParty) },
      });
      expect(await snapshot([ana.partyId, luis.partyId], bills)).toEqual(afterFirst);
      expect((await billRow(v, orderId)).partyId).toBe(winnerParty);
    });

    it(`refuses the second till's move of a party's bill that the first took to the counter or another party (till ${first} first)`, async () => {
      const { ana, luis, luisTable, second } = await splitAtTwoTables(`Mesa vuelta ${first}`);
      const read = {
        partyId: ana.partyId,
        expectedPartyRevision: await revisionOf(v, ana.partyId),
        operatorId: OPERATOR,
      };
      const luisRead = await revisionOf(v, luis.partyId);
      const toCounter = () =>
        inTx(v, (tx) =>
          moveBill(tx, v.cfg, second, { counter: { zoneId: null } }, { ...read, bills: "merge" }),
        );
      const toLuis = () =>
        inTx(v, (tx) =>
          moveBill(
            tx,
            v.cfg,
            second,
            { tableId: luisTable },
            {
              ...read,
              bills: "separate",
              otherPartyId: luis.partyId,
              expectedOtherPartyRevision: luisRead,
            },
          ),
        );
      const [winner, loser] = first === "A" ? [toCounter, toLuis] : [toLuis, toCounter];

      await winner();
      const bills = [ana.tabId, luis.tabId, second];
      const afterFirst = await snapshot([ana.partyId, luis.partyId], bills);
      const error = await captureError(loser);

      expect(error).toMatchObject({
        code: "party.out_of_date",
        params: { partyId: ana.partyId, revision: await revisionOf(v, ana.partyId) },
      });
      expect(await snapshot([ana.partyId, luis.partyId], bills)).toEqual(afterFirst);
      expect((await billRow(v, second)).partyId).toBe(first === "A" ? null : luis.partyId);
    });
  }

  for (const first of ["move", "payment"] as const) {
    it(`lets a payment of the receiving party's main bill and the move both succeed (${first} first)`, async () => {
      const { ana, luis, luisTable, second } = await splitAtTwoTables(`Mesa cobro ${first}`);
      const options: MoveBillOptions = {
        bills: "separate",
        expectedPartyRevision: await revisionOf(v, ana.partyId),
        otherPartyId: luis.partyId,
        expectedOtherPartyRevision: await revisionOf(v, luis.partyId),
        operatorId: OPERATOR,
      };
      const moveIt = () =>
        inTx(v, (tx) => moveBill(tx, v.cfg, second, { tableId: luisTable }, options));
      const payIt = () => pay(v, luis.tabId, "20.00");

      if (first === "move") {
        await moveIt();
        await payIt();
      } else {
        await payIt();
        await moveIt();
      }

      expect((await billRow(v, luis.tabId)).status).toBe("settled");
      expect(registroCount(luis.tabId)).toBe(1);
      const row = await billRow(v, second);
      expect({ partyId: row.partyId, status: row.status }).toEqual({
        partyId: luis.partyId,
        status: "open",
      });
      expect((await linesOf(v, second)).map((l) => l.name)).toEqual(["Vino"]);
    });
  }
});

describe("the guests take their only unpaid bill to the counter (Review Focus 2)", () => {
  it("lets the party finish, its tables follow the clearing setting, and the counter bill is paid once", async () => {
    const mesa = await v.table("Mesa se van");
    const ana = await seat(v, mesa);
    await order(v, ana.tabId, "Burger");
    await move(ana.tabId, { counter: { zoneId: v.counter.zoneId } });
    const expectedPartyRevision = await revisionOf(v, ana.partyId);

    await inTx(v, (tx) => writeClearingWorkflow(tx, true));
    try {
      await inTx(v, (tx) =>
        finishTable(tx, { partyId: ana.partyId, expectedPartyRevision, operatorId: OPERATOR }),
      );
    } finally {
      await inTx(v, (tx) => writeClearingWorkflow(tx, false));
    }

    expect((await partyRow(v, ana.partyId)).state).toBe("closed");
    expect(await partyAt(v, mesa)).toBeNull();
    expect((await tableRow(v, mesa)).needsClearingSince).not.toBeNull();
    expect((await billRow(v, ana.tabId)).status).toBe("open");

    await pay(v, ana.tabId, "12.00");

    expect((await billRow(v, ana.tabId)).status).toBe("settled");
    expect(v.db.all(sql`select id from sales where working_order_id = ${ana.tabId}`)).toHaveLength(
      1,
    );
    expect(registroCount(ana.tabId)).toBe(1);
  });
});
