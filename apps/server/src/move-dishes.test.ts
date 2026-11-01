import { randomUUID } from "node:crypto";
import { asc, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createExtraList, createProduct, writeProductModifiers } from "@waitron/catalogue";
import {
  billPaymentRefunds,
  billPayments,
  parties,
  printJobs,
  products,
  ticketItems,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createPrinter } from "@waitron/printing";
import { decimalToCents } from "@waitron/shared";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { SQL_VARIABLE_LIMIT } from "@waitron/store";
import { kitchenNoteKey, readKitchenNotes, writeKitchenNote } from "@waitron/venue-service";
import { moveDishes, splitBill, transferItems } from "./testing/bill-action-fixture.js";
import { readBillEditState } from "./bill-editing.js";
import type { BillEditExpected } from "./order-drafts.js";
import { insertPartyBill, partyRevision } from "./parties.js";
import { saveDraft } from "./order-drafts.js";
import { recallToDraft } from "./draft-recall.js";
import { setChangesAfterSending } from "./testing/changes-after-sending.js";
import { VENUE_SERVICE } from "./modules.js";
import { placeGroups } from "./testing/group-submit-fixture.js";
import { addTabRound } from "./testing/order-writer-fixture.js";
import { cancelReasonId } from "./testing/cancel-line.js";
import { cancelItem } from "./line-cancel.js";
import { readCancellationContext } from "./line-cancel-context.js";
import { takeBillPayment } from "./testing/bill-payment-fixture.js";
import { numbersOf } from "./testing/bill-identities.js";
import {
  OPERATOR,
  cashContribution,
  commandFor,
  counterOrder,
  inTx,
  paymentsOf,
  seatWithNoAllergies as seat,
  setupPartyVenue,
  type PartyVenue,
} from "./testing/party-venue.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";
import { readLineCancellations } from "./line-service-state.js";
import { advanceTicketItem, storedOrderTotal } from "./working-order.js";
import { attachPrinterToStation } from "./station-printers.js";
import { printedLines } from "./testing/decode-ticket.js";
import "./errors.js";

let v: PartyVenue;
let offers: ZoneOffers;
let ids: { burger: string; cheese: string; toppings: string; ham: string };

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    v = await setupPartyVenue(db);
    ids = await inTx(v, async (tx) => {
      const [burgerRow] = await tx
        .select({ catalogueId: products.catalogueId, categoryId: products.categoryId })
        .from(products)
        .where(eq(products.id, v.productId("Burger")));
      const product = (name: string, pricingUnit: "each" | "weight", unitPrice: string) =>
        createProduct(tx, {
          catalogueId: burgerRow!.catalogueId,
          categoryId: burgerRow!.categoryId,
          name,
          customerName: { [v.cfg.locale]: `${name} (customer)` },
          kitchenName: name.toUpperCase(),
          pricingUnit,
          unitPrice,
          vatClass: "general",
        });
      const cheese = (await product("Cheese", "each", "1.00")).id;
      const ham = (await product("Ham", "weight", "24.90")).id;
      const toppings = (
        await createExtraList(
          tx,
          {
            name: "Toppings",
            customerName: null,
            kitchenName: null,
            minPicks: 0,
            maxPicks: null,
            active: true,
            items: [{ productId: cheese, maxQuantity: 2, preselected: false, price: null }],
          },
          v.cfg.locale,
        )
      ).id;
      const burger = v.productId("Burger");
      await writeProductModifiers(tx, burger, [{ kind: "extras", id: toppings }]);
      offers = await offerProducts(tx, v.cfg, { zone: "tables" });
      return { burger, cheese, toppings, ham };
    });
  },
});

type Line = { productId: string; quantity: string; cheese?: number };

const lines = (wanted: Line[]) =>
  offers.toOfferLines(
    wanted.map((line) => ({
      productId: line.productId,
      quantity: line.quantity,
      ...(line.cheese === undefined
        ? {}
        : {
            extras: [
              { listId: ids.toppings, picks: [{ productId: ids.cheese, quantity: line.cheese }] },
            ],
          }),
    })),
  );

const dish = (name: string, quantity = "1"): Line => ({ productId: v.productId(name), quantity });

let tableNumber = 0;

/**
 * A seated party whose Bill 1 holds `bill1` sent as one group (released as `release`), and an empty
 * Bill 2.
 */
async function party(bill1: Line[], release: "fire" | "hold" = "fire", bill2Lines: Line[] = []) {
  const tableId = await v.table(`Move ${++tableNumber}`);
  const seated = await seat(v, tableId);
  await inTx(v, (tx) =>
    placeGroups(tx, v.cfg, seated.partyId, {
      groups: [{ lines: lines(bill1), release }],
      operatorId: OPERATOR,
      billId: seated.tabId,
    }),
  );
  const bill2 = await inTx(v, (tx) => insertPartyBill(tx, v.cfg, seated.partyId));
  if (bill2Lines.length > 0)
    await inTx(v, (tx) =>
      placeGroups(tx, v.cfg, seated.partyId, {
        groups: [{ lines: lines(bill2Lines), release: "fire" }],
        operatorId: OPERATOR,
        billId: bill2,
      }),
    );
  return { partyId: seated.partyId, bill1: seated.tabId, bill2 };
}

/** The bill's lines in line order: dishes and their extras. */
function rowsOf(billId: string) {
  return v.db
    .select({
      id: workingOrderLines.id,
      lineNo: workingOrderLines.lineNo,
      name: workingOrderLines.name,
      quantity: workingOrderLines.quantity,
      parentLineId: workingOrderLines.parentLineId,
      groupId: workingOrderLines.groupId,
      sentAt: workingOrderLines.sentAt,
      servedQuantity: workingOrderLines.servedQuantity,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, billId))
    .orderBy(asc(workingOrderLines.lineNo));
}

async function dishIds(billId: string, name?: string): Promise<string[]> {
  return (await rowsOf(billId))
    .filter((row) => row.parentLineId === null && (name === undefined || row.name === name))
    .map((row) => row.id);
}

function ticketsOf(billId: string) {
  return v.db
    .select({ id: ticketItems.id, lineId: ticketItems.workingOrderLineId })
    .from(ticketItems)
    .where(eq(ticketItems.workingOrderId, billId))
    .orderBy(asc(ticketItems.id));
}

/** The kitchen's items for the lines, with the bill and station each sits on. */
function kitchenOf(lineIds: readonly string[]) {
  return v.db
    .all<{
      id: string;
      lineId: string;
      billId: string;
      stationId: string;
      state: string;
    }>(
      sql`select id, working_order_line_id as lineId, working_order_id as billId, station_id as stationId, state from ticket_items order by id`,
    )
    .filter((item) => lineIds.includes(item.lineId));
}

function revisionOf(billId: string): number {
  return v.db.all<{ revision: number }>(
    sql`select revision from working_orders where id = ${billId}`,
  )[0]!.revision;
}

function bindings(lineIds: readonly string[]) {
  return v.db
    .all<{
      line: string;
      portion: string;
    }>(sql`select working_order_line_id as line, portion_id as portion from working_line_portions`)
    .filter((row) => lineIds.includes(row.line))
    .sort((a, b) => a.line.localeCompare(b.line));
}

function movedEvents(portionIds: readonly string[]) {
  return v.db
    .all<{
      portion_id: string;
      kind: string;
      from_order_id: string;
      to_order_id: string | null;
      actor_id: string | null;
    }>(
      sql`select portion_id, kind, from_order_id, to_order_id, actor_id from order_portion_events order by rowid`,
    )
    .filter((event) => portionIds.includes(event.portion_id));
}

async function editsOf(...billIds: string[]): Promise<BillEditExpected[]> {
  return inTx(v, async (tx) => {
    const edits: BillEditExpected[] = [];
    for (const id of [...billIds].sort()) edits.push(await readBillEditState(tx, id));
    return edits;
  });
}

/**
 * What the till sends with a move: the operator, the party's revision when there is a party, and
 * the editor state of each bill the move names.
 */
type MoveAsk = Parameters<typeof moveDishes>[5] & { expectedEdits: BillEditExpected[] };

/** What the till sends a move with, read now: the party's revision and the bills' editors. */
async function readMove(
  partyId: string | null,
  from: string,
  to: string | null,
  operatorId = OPERATOR,
): Promise<MoveAsk> {
  const command =
    partyId === null ? { operatorId } : { ...(await commandFor(v, partyId)), operatorId };
  return {
    ...command,
    ...(partyId === null ? {} : { partyId }),
    expectedEdits: await editsOf(from, ...(to === null ? [] : [to])),
  };
}

function sendMove(from: string, to: string | null, lineIds: readonly string[], ask: MoveAsk) {
  return inTx(v, (tx) => moveDishes(tx, v.cfg, from, to, lineIds, ask));
}

/** Moves `lineIds` from `from` to `to` (a new bill when null) under the party's current revision. */
async function move(
  partyId: string | null,
  from: string,
  to: string | null,
  lineIds: readonly string[],
) {
  return sendMove(from, to, lineIds, await readMove(partyId, from, to));
}

/** The bill's stored total, in cents. */
async function total(billId: string): Promise<number> {
  return decimalToCents(await inTx(v, (tx) => storedOrderTotal(tx, billId)));
}

/** An item payment in cash for the dish lines named. */
async function payItems(billId: string, lineNos: number[], amount: string): Promise<void> {
  await takeBillPayment(
    { db: v.db, backend: v.backend, clock: v.clock },
    v.cfg,
    billId,
    {
      submissionId: randomUUID(),
      kind: "items",
      lines: lineNos.map((lineNo) => ({ lineNo })),
      method: "cash",
      tendered: amount,
      applied: amount,
      tip: "0.00",
    },
    v.operator,
  );
}

describe("A803 move dishes: the moves that succeed", () => {
  it("A803 move dishes: moves two of four identical Cañas to a new bill, Bill 3, holding exactly those two lines with their portions and ticket items", async () => {
    const p = await party([dish("Caña", "4")]);
    const cañas = await dishIds(p.bill1, "Caña");
    expect(cañas).toHaveLength(4);
    const moving = cañas.slice(0, 2);
    const boundBefore = bindings(moving);
    expect(boundBefore).toHaveLength(2);
    const tickets = (await ticketsOf(p.bill1)).filter((item) => moving.includes(item.lineId!));
    expect(tickets).toHaveLength(2);

    const { billId } = await move(p.partyId, p.bill1, null, moving);

    expect(await numbersOf(v, p.partyId)).toEqual([
      [p.bill1, 1, null],
      [p.bill2, 2, null],
      [billId, 3, null],
    ]);
    expect(await dishIds(billId)).toEqual(moving);
    expect(await dishIds(p.bill1)).toEqual(cañas.slice(2));
    expect(bindings(moving)).toEqual(boundBefore);
    expect(await ticketsOf(billId)).toEqual(tickets);
  });

  it("A803 move dishes: moves one of two sent Burgers with cheese to Bill 2, its cheese and kitchen state going with it and one moved event naming Bill 1 to Bill 2", async () => {
    const p = await party([{ ...dish("Burger", "2"), cheese: 1 }]);
    const before = await rowsOf(p.bill1);
    const [first] = await dishIds(p.bill1, "Burger");
    const family = before.filter((row) => row.id === first || row.parentLineId === first);
    expect(family.map((row) => row.name)).toEqual(["Burger", "Cheese"]);
    const [binding] = bindings([first!]);
    const [ticket] = kitchenOf([first!]);
    await inTx(v, (tx) => advanceTicketItem(tx, v.cfg, ticket!.id, "preparing"));
    const kitchen = kitchenOf(family.map((row) => row.id));
    expect(kitchen.map((item) => [item.lineId, item.state])).toEqual([[first, "preparing"]]);
    const revisions = [revisionOf(p.bill1), revisionOf(p.bill2)];

    await move(p.partyId, p.bill1, p.bill2, [first!]);

    expect(kitchenOf(family.map((row) => row.id))).toEqual(
      kitchen.map((item) => ({ ...item, billId: p.bill2 })),
    );
    expect([revisionOf(p.bill1), revisionOf(p.bill2)]).toEqual(revisions.map((r) => r + 1));
    const after = await rowsOf(p.bill2);
    // Line numbers are the destination's own; everything else is the line as it left.
    const withoutNumber = (rows: typeof after) =>
      rows.map((row) =>
        Object.fromEntries(Object.entries(row).filter(([key]) => key !== "lineNo")),
      );
    expect(withoutNumber(after)).toEqual(withoutNumber(family));
    expect((await rowsOf(p.bill1)).map((row) => row.name)).toEqual(["Burger", "Cheese"]);
    expect(movedEvents([binding!.portion])).toEqual([
      {
        portion_id: binding!.portion,
        kind: "moved",
        from_order_id: p.bill1,
        to_order_id: p.bill2,
        actor_id: OPERATOR,
      },
    ]);
  });

  it("A803 move dishes: moves a whole 0.350 kg Ham portion", async () => {
    const p = await party([{ productId: ids.ham, quantity: "0.350" }, dish("Caña")]);
    const [ham] = await dishIds(p.bill1, "Ham");
    const [binding] = bindings([ham!]);
    expect(binding).toBeDefined();

    await move(p.partyId, p.bill1, p.bill2, [ham!]);

    expect((await rowsOf(p.bill2)).map((row) => [row.id, row.quantity])).toEqual([[ham, 350]]);
    expect(bindings([ham!])).toEqual([binding]);
  });

  it("A803 move dishes: after a €10 contribution on Bill 1 (€30), its unpaid €12 Burger moves to Bill 2 and the payment stays on Bill 1", async () => {
    const p = await party([dish("Burger"), dish("Tarta"), dish("Caña")]);
    expect(await total(p.bill1)).toBe(3000);
    const paymentId = await cashContribution(v, p.bill1, "10.00");
    const [burger] = await dishIds(p.bill1, "Burger");

    await move(p.partyId, p.bill1, p.bill2, [burger!]);

    expect(await dishIds(p.bill2)).toEqual([burger]);
    expect(await total(p.bill1)).toBe(1800);
    expect(await total(p.bill2)).toBe(1200);
    expect((await paymentsOf(v, p.bill1)).map((payment) => payment.id)).toEqual([paymentId]);
    expect(await paymentsOf(v, p.bill2)).toEqual([]);
  });

  it("A803 move dishes: after an item payment for one Caña, the unpaid Cañas move and the paid one stays", async () => {
    const p = await party([dish("Caña", "3")]);
    const cañas = await dishIds(p.bill1, "Caña");
    const lineNos = (await rowsOf(p.bill1)).map((row) => row.lineNo);
    await payItems(p.bill1, [lineNos[0]!], "3.00");

    await move(p.partyId, p.bill1, p.bill2, cañas.slice(1));

    expect(await dishIds(p.bill1)).toEqual(cañas.slice(0, 1));
    expect(await dishIds(p.bill2)).toEqual(cañas.slice(1));
  });

  it("A803 move dishes: onto Bill 2 holding a €5 contribution, the Caña moves, Bill 2 owes more and its payment is unchanged", async () => {
    const p = await party([dish("Caña"), dish("Burger")], "fire", [dish("Vino")]);
    const paymentId = await cashContribution(v, p.bill2, "5.00");
    const before = await total(p.bill2);
    const [caña] = await dishIds(p.bill1, "Caña");
    const payments = await paymentsOf(v, p.bill2);

    await move(p.partyId, p.bill1, p.bill2, [caña!]);

    expect(await dishIds(p.bill2, "Caña")).toEqual([caña]);
    expect(await total(p.bill2)).toBe(before + 300);
    expect(await paymentsOf(v, p.bill2)).toEqual(payments);
    expect(payments.map((payment) => payment.id)).toEqual([paymentId]);
  });

  it("A803 move dishes: onto Bill 2 whose Vino is paid by item, the Caña moves and the Vino stays paid", async () => {
    const p = await party([dish("Caña"), dish("Burger")], "fire", [dish("Vino"), dish("Agua")]);
    const [vino] = await rowsOf(p.bill2);
    await payItems(p.bill2, [vino!.lineNo], "30.00");
    const payments = await paymentsOf(v, p.bill2);
    const [caña] = await dishIds(p.bill1, "Caña");

    await move(p.partyId, p.bill1, p.bill2, [caña!]);

    expect(await dishIds(p.bill2, "Caña")).toEqual([caña]);
    expect(await paymentsOf(v, p.bill2)).toEqual(payments);
  });

  it("A803 move dishes: Bill 1 totals €52.00 with €40.00 received; moving €12.00 leaves €40.00, which is allowed", async () => {
    const p = await party([dish("Vino"), dish("Burger"), dish("Agua"), dish("Flan"), dish("Caña")]);
    expect(await total(p.bill1)).toBe(5200);
    await cashContribution(v, p.bill1, "40.00");
    const [burger] = await dishIds(p.bill1, "Burger");

    await move(p.partyId, p.bill1, p.bill2, [burger!]);

    expect(await total(p.bill1)).toBe(4000);
    expect(await dishIds(p.bill2)).toEqual([burger]);
  });

  it("A803 move dishes: a dish in a held group moves to another bill of the party and stays in its group", async () => {
    const p = await party([dish("Paella"), dish("Flan")], "hold");
    const [paella] = await dishIds(p.bill1, "Paella");
    const group = (await rowsOf(p.bill1)).find((row) => row.id === paella)!.groupId;
    expect(group).not.toBeNull();

    await move(p.partyId, p.bill1, p.bill2, [paella!]);

    expect((await rowsOf(p.bill2)).map((row) => [row.id, row.groupId])).toEqual([[paella, group]]);
  });

  it("A803 move dishes: with the Paella recalled into a draft, the Flan beside it on the bill moves and the Paella stays", async () => {
    const p = await party([dish("Paella"), dish("Flan")], "hold");
    const [paella] = await dishIds(p.bill1, "Paella");
    const [flan] = await dishIds(p.bill1, "Flan");
    await recallIntoDraft(p.partyId, p.bill1, paella!);

    await sendMove(
      p.bill1,
      p.bill2,
      [flan!],
      await readMove(p.partyId, p.bill1, p.bill2, adminId()),
    );

    expect(await dishIds(p.bill1)).toEqual([paella]);
    expect(await dishIds(p.bill2)).toEqual([flan]);
  });

  it("A803 move dishes: a bill with no party moves to a new counter order and copies its kitchen note", async () => {
    const id = await counterOrder(v, "Burger", "Flan");
    await inTx(v, (tx) => writeKitchenNote(tx, { workingOrderId: id }, 0, "All together"));
    const [burger] = await dishIds(id, "Burger");

    const { billId } = await move(null, id, null, [burger!]);

    const [made] = await v.db
      .select({ partyId: workingOrders.partyId, status: workingOrders.status })
      .from(workingOrders)
      .where(eq(workingOrders.id, billId));
    expect(made).toEqual({ partyId: null, status: "open" });
    expect(await dishIds(billId)).toEqual([burger]);
    const note = await inTx(v, async (tx) =>
      (await readKitchenNotes(tx, [{ workingOrderId: billId }])).get(
        kitchenNoteKey({ workingOrderId: billId }),
      ),
    );
    expect(note?.note).toBe("All together");
  });

  it("A803 move dishes: a Burger cancelled with its charge kept moves with its cancellation", async () => {
    const p = await party([dish("Burger"), dish("Flan")]);
    const [burger] = await dishIds(p.bill1, "Burger");
    const [ticket] = await v.db
      .select({ id: ticketItems.id })
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderLineId, burger!));
    await inTx(v, (tx) => advanceTicketItem(tx, v.cfg, ticket!.id, "preparing"));
    const [bill] = await v.db
      .select({ revision: workingOrders.revision })
      .from(workingOrders)
      .where(eq(workingOrders.id, p.bill1));
    await inTx(v, async (tx) =>
      cancelItem(
        tx,
        v.cfg,
        p.partyId,
        burger!,
        {
          submissionId: randomUUID(),
          quantity: "1",
          outcome: "keep_charge",
          reasonId: await cancelReasonId(tx),
          expectedPartyRevision: await partyRevision(tx, p.partyId),
          expectedBillRevision: bill!.revision,
          expectedEdit: await readBillEditState(tx, p.bill1),
          expectedContext: await readCancellationContext(tx, p.partyId, burger!),
        },
        v.db.all<{ id: string }>(sql`select id from persons where role = 'admin'`)[0]!.id,
      ),
    );
    const kept = await inTx(v, (tx) => readLineCancellations(tx, [burger!]));
    expect(kept.get(burger!)).toBeDefined();
    const before = { bill1: await total(p.bill1), bill2: await total(p.bill2) };

    await move(p.partyId, p.bill1, p.bill2, [burger!]);

    expect(await dishIds(p.bill2)).toEqual([burger]);
    expect(await inTx(v, (tx) => readLineCancellations(tx, [burger!]))).toEqual(kept);
    const moved = before.bill1 - (await total(p.bill1));
    expect(moved).toBeGreaterThan(0);
    expect((await total(p.bill2)) - before.bill2).toBe(moved);
  });
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Columns that differ between two twins made one after the other: times and venue-wide order numbers. */
const UNTWINNED_COLUMN = /_at$|^(at|order_number|sent_order_number)$/;
/** Tables whose rows are mapped first, in this order, so their ids get the same names in each twin. */
const FIRST_TABLES = [
  "working_orders",
  "working_order_lines",
  "ticket_items",
  "working_line_portions",
];

/** The text that differs between twins: the table's name, order numbers and a slip's time. */
function untwinned(text: string): string {
  return text
    .replace(/Move \d+/g, "<table>")
    .replace(/Pedido .*/, "Pedido <number>")
    .replace(/#\d+/g, "#<number>")
    .replace(/^\d\d:\d\d$/, "<time>");
}

/**
 * Every row of every table that names one of `billIds` or the id of another row taken, with ids
 * renamed in the order they first appear and the untwinned columns dropped.
 */
function rowsNaming(billIds: readonly string[]) {
  const tables = v.db
    .all<{ name: string }>(
      sql`select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name`,
    )
    .map(({ name }) => name);
  const contents = new Map(
    tables.map((name) => [
      name,
      v.db.all<Record<string, unknown>>(sql`select * from ${sql.identifier(name)} order by rowid`),
    ]),
  );
  const known = new Set(billIds);
  const names = (row: Record<string, unknown>) =>
    Object.values(row).some((value) => typeof value === "string" && known.has(value));
  for (let grown = true; grown;) {
    grown = false;
    for (const rows of contents.values()) {
      for (const row of rows)
        if (typeof row.id === "string" && !known.has(row.id) && names(row)) {
          known.add(row.id);
          grown = true;
        }
    }
  }
  const renamed = new Map<string, string>();
  const rename = (value: unknown) => {
    if (typeof value !== "string") return value;
    if (!UUID.test(value)) return untwinned(value);
    if (!renamed.has(value)) renamed.set(value, `id${renamed.size}`);
    return renamed.get(value);
  };
  const ordered = [...FIRST_TABLES, ...tables.filter((name) => !FIRST_TABLES.includes(name))];
  const out: Record<string, unknown[]> = {};
  for (const name of ordered) {
    const rows = contents
      .get(name)!
      .filter(names)
      .map((row) =>
        Object.fromEntries(
          Object.entries(row)
            .filter(([column]) => !UNTWINNED_COLUMN.test(column))
            .map(([column, value]) => [column, rename(value)]),
        ),
      );
    if (rows.length === 0) continue;
    if (!FIRST_TABLES.includes(name))
      rows.sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)));
    out[name] = rows;
  }
  return out;
}

/** A new printer at every station the bill's kitchen items go to. */
async function printerFor(billId: string): Promise<string> {
  const stations = v.db.all<{ stationId: string }>(
    sql`select distinct station_id as stationId from ticket_items where working_order_id = ${billId}`,
  );
  expect(stations.length).toBeGreaterThan(0);
  return inTx(v, async (tx) => {
    const { id } = await createPrinter(
      tx,
      { locationId: v.cfg.locationId },
      { name: `Kitchen ${randomUUID()}`, transport: "cloud_poll", pollId: `poll-${randomUUID()}` },
    );
    for (const { stationId } of stations)
      await attachPrinterToStation(tx, { locationId: v.cfg.locationId, stationId, printerId: id });
    return id;
  });
}

/** What the printer has been sent, decoded, oldest first. */
async function printedOn(printerId: string): Promise<string[][]> {
  const jobs = await inTx(v, (tx) =>
    tx
      .select({ payload: printJobs.payload })
      .from(printJobs)
      .where(eq(printJobs.printerId, printerId))
      .orderBy(sql`rowid`),
  );
  return jobs.map((job) => printedLines(job.payload).map(untwinned));
}

/** The jobs each of two twin actions sends the printer, one after the other. */
async function printedBy(
  printerId: string,
  first: () => Promise<unknown>,
  second: () => Promise<unknown>,
) {
  const before = (await printedOn(printerId)).length;
  await first();
  const between = (await printedOn(printerId)).length;
  await second();
  const jobs = await printedOn(printerId);
  return { first: jobs.slice(before, between), second: jobs.slice(between) };
}

/** What a move leaves on the two bills, with the ids that differ between two twin parties mapped. */
async function outcome(p: { bill1: string; bill2?: string }, to: string) {
  const names = new Map<string, string>([
    [p.bill1, "source"],
    [to, "destination"],
  ]);
  const rename = (id: string | null) => (id === null ? null : (names.get(id) ?? "other"));
  const bill = async (billId: string) => {
    const rows = await rowsOf(billId);
    const lineNoOf = new Map(rows.map((row) => [row.id, row.lineNo]));
    const portions = new Map(
      bindings(rows.map((row) => row.id)).map((row) => [row.line, row.portion]),
    );
    return {
      total: await total(billId),
      lines: rows.map((row) => ({
        lineNo: row.lineNo,
        name: row.name,
        quantity: row.quantity,
        parent: row.parentLineId === null ? null : lineNoOf.get(row.parentLineId),
        grouped: row.groupId !== null,
        sent: row.sentAt !== null,
        servedQuantity: row.servedQuantity,
        bound: portions.has(row.id),
      })),
      tickets: (await ticketsOf(billId))
        .map((item) => lineNoOf.get(item.lineId!)!)
        .sort((x, y) => x - y),
      events: movedEvents([...portions.values()]).map((event) => ({
        kind: event.kind,
        from: rename(event.from_order_id),
        to: rename(event.to_order_id),
      })),
      notices: v.db
        .all<{
          working_order_id: string;
          kind: string;
          line_name: string;
          quantity: string;
        }>(
          sql`select working_order_id, kind, line_name, quantity from kitchen_notices where working_order_id = ${billId} order by rowid`,
        )
        .map((notice) => ({ ...notice, working_order_id: rename(notice.working_order_id) })),
    };
  };
  return {
    source: await bill(p.bill1),
    destination: await bill(to),
    rows: rowsNaming([...new Set([p.bill1, ...(p.bill2 === undefined ? [] : [p.bill2]), to])]),
  };
}

describe("A803 move dishes: the same rows as the pickers it replaces", () => {
  const twinOrder = (): Line[] => [
    { ...dish("Burger"), cheese: 1 },
    dish("Caña", "2"),
    dish("Flan"),
  ];

  it("A803 move dishes: to an existing bill writes the same rows as Transfer items of the same whole lines", async () => {
    const a = await party(twinOrder());
    const b = await party(twinOrder());
    // A dish the kitchen holds outside a held group: Transfer items takes it, Split by item does not.
    for (const twin of [a, b])
      await inTx(v, (tx) =>
        addTabRound(tx, v.cfg, twin.bill1, [
          { menuItemId: v.item("Tarta"), quantity: "1", hold: true },
        ]),
      );
    const pick = async (billId: string) => {
      const dishes = await dishIds(billId);
      return [...dishes.slice(0, 2), dishes.at(-1)!];
    };
    const lineNos = (await rowsOf(a.bill1))
      .filter((row) => row.parentLineId === null)
      .filter((_, index, dishes) => index < 2 || index === dishes.length - 1)
      .map((row) => ({ lineNo: row.lineNo }));
    expect(lineNos).toHaveLength(3);
    const transfer = {
      ...(await commandFor(v, a.partyId)),
      expectedEdits: await editsOf(a.bill1, a.bill2),
    };
    const printed = await printedBy(
      await printerFor(a.bill1),
      () => inTx(v, (tx) => transferItems(tx, v.cfg, a.bill1, a.bill2, lineNos, transfer)),
      async () => move(b.partyId, b.bill1, b.bill2, await pick(b.bill1)),
    );

    expect(await outcome(b, b.bill2)).toEqual(await outcome(a, a.bill2));
    expect(printed.first.length).toBeGreaterThan(0);
    expect(printed.second).toEqual(printed.first);
  });

  it("A803 move dishes: to a new bill writes the same rows as Split by item of the same whole lines", async () => {
    const a = await party(twinOrder());
    const b = await party(twinOrder());
    const lineNos = (await rowsOf(a.bill1))
      .filter((row) => row.parentLineId === null)
      .slice(0, 2)
      .map((row) => ({ lineNo: row.lineNo }));
    const command = await commandFor(v, a.partyId);
    let split = { billId: "" };
    let moved = { billId: "" };
    const printed = await printedBy(
      await printerFor(a.bill1),
      async () => {
        split = await inTx(v, async (tx) =>
          splitBill(tx, v.cfg, a.bill1, lineNos, {
            ...command,
            expectedEdit: await readBillEditState(tx, a.bill1),
          }),
        );
      },
      async () => {
        moved = await move(b.partyId, b.bill1, null, (await dishIds(b.bill1)).slice(0, 2));
      },
    );

    expect(await outcome(b, moved.billId)).toEqual(await outcome(a, split.billId));
    expect(printed.first.length).toBeGreaterThan(0);
    expect(printed.second).toEqual(printed.first);
  });

  it("A803 move dishes: from a bill with no party to a new one writes the same rows as Split by item", async () => {
    const a = await counterOrder(v, "Burger", "Flan");
    const b = await counterOrder(v, "Burger", "Flan");
    for (const id of [a, b])
      await inTx(v, (tx) => writeKitchenNote(tx, { workingOrderId: id }, 0, "All together"));
    // These counter orders send nothing to a kitchen station, so there is no slip to compare.
    expect(
      v.db.all(sql`select id from ticket_items where working_order_id in (${a}, ${b})`),
    ).toEqual([]);
    const [burger] = await dishIds(a, "Burger");
    const lineNo = await lineNoOf(a, burger!);
    const split = await inTx(v, async (tx) =>
      splitBill(tx, v.cfg, a, [{ lineNo }], {
        operatorId: OPERATOR,
        expectedEdit: await readBillEditState(tx, a),
      }),
    );
    const moved = await move(null, b, null, await dishIds(b, "Burger"));

    expect(await outcome({ bill1: b }, moved.billId)).toEqual(
      await outcome({ bill1: a }, split.billId),
    );
  });
});

/** Every row of every table, in insertion order: what a refused move must leave as it was. */
function allRows() {
  const tables = v.db.all<{ name: string }>(
    sql`select name from sqlite_master where type = 'table' order by name`,
  );
  return Object.fromEntries(
    tables.map(({ name }) => [
      name,
      v.db.all(sql`select * from ${sql.identifier(name)} order by rowid`),
    ]),
  );
}

async function refused(run: () => Promise<unknown>, code: string, params?: unknown) {
  const before = allRows();
  await expect(run()).rejects.toMatchObject(params === undefined ? { code } : { code, params });
  expect(allRows()).toEqual(before);
}

const adminId = () =>
  v.db.all<{ id: string }>(sql`select id from persons where role = 'admin'`)[0]!.id;

/** The administrator recalls the held dish into a draft of its bill. */
async function recallIntoDraft(partyId: string, billId: string, lineId: string) {
  const command = await commandFor(v, partyId);
  await inTx(v, async (tx) => {
    await setChangesAfterSending(tx, "held-or-waiting");
    return recallToDraft(tx, v.cfg, partyId, lineId, {
      ...command,
      operatorId: adminId(),
      expectedEdit: await readBillEditState(tx, billId),
      submissionId: randomUUID(),
    });
  });
}

/** `operatorId`'s saved, unsent Tarta on the bill: that person is now its editor. */
async function saveTarta(partyId: string, billId: string, operatorId: string) {
  const expectedEdit = await inTx(v, (tx) => readBillEditState(tx, billId));
  return inTx(v, (tx) =>
    saveDraft(tx, v.cfg, partyId, operatorId, {
      billId,
      draftId: expectedEdit.draftId,
      revision: expectedEdit.draftRevision ?? 0,
      expectedEdit,
      lines: [{ menuItemId: v.item("Tarta"), quantity: "1" }],
    }),
  );
}

function setStatus(billId: string, status: "placed" | "settled" | "abandoned") {
  return inTx(v, (tx) =>
    tx
      .update(workingOrders)
      .set({ status, ...(status === "settled" ? { settledAt: new Date().toISOString() } : {}) })
      .where(eq(workingOrders.id, billId)),
  );
}

async function lineNoOf(billId: string, lineId: string): Promise<number> {
  return (await rowsOf(billId)).find((row) => row.id === lineId)!.lineNo;
}

describe("A803 move dishes refuses, and changes nothing", () => {
  it("A803 move dishes refuses: a paid Caña named with an unpaid one is bill.line_paid naming it", async () => {
    const p = await party([dish("Caña", "2")]);
    const [paid, unpaid] = await dishIds(p.bill1);
    await payItems(p.bill1, [await lineNoOf(p.bill1, paid!)], "3.00");
    await refused(() => move(p.partyId, p.bill1, p.bill2, [unpaid!, paid!]), "bill.line_paid", {
      workingOrderId: p.bill1,
      lineNo: await lineNoOf(p.bill1, paid!),
    });
  });

  it("A803 move dishes refuses: €52.00 with €40.01 received; moving €12.00 is bill.received_exceeds_total by 0.01", async () => {
    const p = await party([dish("Vino"), dish("Burger"), dish("Agua"), dish("Flan"), dish("Caña")]);
    await cashContribution(v, p.bill1, "40.01");
    const [burger] = await dishIds(p.bill1, "Burger");
    await refused(
      () => move(p.partyId, p.bill1, p.bill2, [burger!]),
      "bill.received_exceeds_total",
      { workingOrderId: p.bill1, excess: "0.01" },
    );
  });

  it("A803 move dishes refuses: a card payment of the whole bill under way on the source is order.payment_in_flight", async () => {
    const p = await party([dish("Caña", "2")]);
    const [caña] = await dishIds(p.bill1);
    v.db.run(
      sql`update working_orders set payment_attempt_at = '2026-11-01T10:00:00.000Z' where id = ${p.bill1}`,
    );
    await refused(() => move(p.partyId, p.bill1, p.bill2, [caña!]), "order.payment_in_flight", {
      workingOrderId: p.bill1,
    });
  });

  it("A803 move dishes refuses: a card payment of the whole bill under way on the destination is order.payment_in_flight naming it", async () => {
    const p = await party([dish("Caña", "2")]);
    const [caña] = await dishIds(p.bill1);
    v.db.run(
      sql`update working_orders set payment_attempt_at = '2026-11-01T10:00:00.000Z' where id = ${p.bill2}`,
    );
    await refused(() => move(p.partyId, p.bill1, p.bill2, [caña!]), "order.payment_in_flight", {
      workingOrderId: p.bill2,
    });
  });

  it("A803 move dishes refuses: a card contribution still at the reader on the source is order.payment_in_flight", async () => {
    const p = await party([dish("Caña", "2"), dish("Vino")]);
    const [caña] = await dishIds(p.bill1);
    await inTx(v, (tx) =>
      tx.insert(billPayments).values({
        workingOrderId: p.bill1,
        submissionId: randomUUID(),
        fingerprint: "pending card",
        kind: "contribution",
        method: "card",
        applied: 500,
        state: "pending",
        requestedBy: OPERATOR,
        source: v.cfg.origin.source,
        deviceId: v.cfg.origin.deviceId,
      }),
    );
    await refused(() => move(p.partyId, p.bill1, p.bill2, [caña!]), "order.payment_in_flight", {
      workingOrderId: p.bill1,
    });
  });

  it("A803 move dishes refuses: a card refund in progress on the source is bill.refund_in_progress", async () => {
    const p = await party([dish("Caña", "2"), dish("Vino")]);
    const paymentId = await cashContribution(v, p.bill1, "5.00");
    const [caña] = await dishIds(p.bill1);
    await inTx(v, (tx) =>
      tx.insert(billPaymentRefunds).values({
        billPaymentId: paymentId,
        submissionId: randomUUID(),
        fingerprint: "pending refund",
        appliedAmount: 500,
        reason: "error",
        authorizedBy: adminId(),
        requestedBy: adminId(),
        source: v.cfg.origin.source,
        deviceId: v.cfg.origin.deviceId,
        state: "pending",
      }),
    );
    await refused(() => move(p.partyId, p.bill1, p.bill2, [caña!]), "bill.refund_in_progress", {
      workingOrderId: p.bill1,
    });
  });

  it.each([
    ["placed", "bill.presented", (id: string) => ({ workingOrderId: id })],
    ["settled", "bill.paid", (id: string) => ({ workingOrderId: id })],
    ["abandoned", "tab.not_open", (id: string) => ({ tabId: id })],
  ] as const)("A803 move dishes refuses: a destination %s is %s", async (status, code, params) => {
    const p = await party([dish("Caña")]);
    const [caña] = await dishIds(p.bill1);
    const ask = await readMove(p.partyId, p.bill1, p.bill2);
    await setStatus(p.bill2, status);
    await refused(() => sendMove(p.bill1, p.bill2, [caña!], ask), code, params(p.bill2));
  });

  it.each([
    ["placed", "bill.presented", (id: string) => ({ workingOrderId: id })],
    ["settled", "bill.paid", (id: string) => ({ workingOrderId: id })],
    ["abandoned", "tab.not_open", (id: string) => ({ tabId: id })],
  ] as const)("A803 move dishes refuses: a source %s is %s", async (status, code, params) => {
    const p = await party([dish("Caña")]);
    const [caña] = await dishIds(p.bill1);
    const ask = await readMove(p.partyId, p.bill1, p.bill2);
    await setStatus(p.bill1, status);
    await refused(() => sendMove(p.bill1, p.bill2, [caña!], ask), code, params(p.bill1));
  });

  it("A803 move dishes refuses: another party's bill is bill.other_party", async () => {
    const p = await party([dish("Caña")]);
    const other = await party([dish("Flan")]);
    const [caña] = await dishIds(p.bill1);
    const ask = await readMove(p.partyId, p.bill1, other.bill2);
    await refused(() => sendMove(p.bill1, other.bill2, [caña!], ask), "bill.other_party", {
      workingOrderId: other.bill2,
    });
  });

  it("A803 move dishes refuses: from a bill with no party, another existing bill is bill.other_party", async () => {
    const from = await counterOrder(v, "Burger", "Flan");
    const to = await counterOrder(v, "Flan");
    const [burger] = await dishIds(from, "Burger");
    await refused(() => move(null, from, to, [burger!]), "bill.other_party", {
      workingOrderId: to,
    });
  });

  it("A803 move dishes refuses: a destination served another way is service_zone.mode_incompatible", async () => {
    const p = await party([dish("Caña")]);
    const [caña] = await dishIds(p.bill1);
    await inTx(v, (tx) => VENUE_SERVICE.retargetOrderContext(tx, v.cfg, p.bill2, v.counter.zoneId));
    await refused(
      () => move(p.partyId, p.bill1, p.bill2, [caña!]),
      "service_zone.mode_incompatible",
    );
  });

  it("A803 move dishes refuses: the source as its own destination is tab.transfer_self", async () => {
    const p = await party([dish("Caña")]);
    const [caña] = await dishIds(p.bill1);
    await refused(() => move(p.partyId, p.bill1, p.bill1, [caña!]), "tab.transfer_self", {
      tabId: p.bill1,
    });
  });

  it("A803 move dishes refuses: an id not on the source is tab.line_not_found naming it, and no line of the source with its number moves", async () => {
    // Bill 2's first dish is its line 1, and Bill 1 has a line 1 too: a check that found the id on
    // any bill and moved by its number would move Bill 1's line 1 instead.
    const p = await party([dish("Caña")], "fire", [dish("Flan")]);
    const [foreign] = await dishIds(p.bill2);
    expect(await lineNoOf(p.bill2, foreign!)).toBe(1);
    expect((await rowsOf(p.bill1))[0]!.lineNo).toBe(1);
    const third = await inTx(v, (tx) => insertPartyBill(tx, v.cfg, p.partyId));
    await refused(() => move(p.partyId, p.bill1, third, [foreign!]), "tab.line_not_found", {
      tabId: p.bill1,
      lineId: foreign,
    });
  });

  it("A803 move dishes refuses: an extra's id is tab.transfer_modifier_line", async () => {
    const p = await party([{ ...dish("Burger"), cheese: 1 }]);
    const cheese = (await rowsOf(p.bill1)).find((row) => row.parentLineId !== null)!;
    await refused(
      () => move(p.partyId, p.bill1, p.bill2, [cheese.id]),
      "tab.transfer_modifier_line",
      { tabId: p.bill1, lineNo: cheese.lineNo },
    );
  });

  it("A803 move dishes refuses: the same id twice is tab.transfer_duplicate_line", async () => {
    const p = await party([dish("Caña")]);
    const [caña] = await dishIds(p.bill1);
    await refused(
      () => move(p.partyId, p.bill1, p.bill2, [caña!, caña!]),
      "tab.transfer_duplicate_line",
      { tabId: p.bill1, lineNo: await lineNoOf(p.bill1, caña!) },
    );
  });

  it("A803 move dishes refuses: one id named more times than a statement can bind is tab.transfer_duplicate_line", async () => {
    const p = await party([dish("Caña")]);
    const [caña] = await dishIds(p.bill1);
    await refused(
      () => move(p.partyId, p.bill1, p.bill2, Array<string>(SQL_VARIABLE_LIMIT + 1).fill(caña!)),
      "tab.transfer_duplicate_line",
      { tabId: p.bill1, lineNo: await lineNoOf(p.bill1, caña!) },
    );
  });

  it("A803 move dishes refuses: no dish is sale.empty_basket", async () => {
    const p = await party([dish("Caña")]);
    await refused(() => move(p.partyId, p.bill1, p.bill2, []), "sale.empty_basket");
  });

  it("A803 move dishes refuses: a dish recalled into a draft is draft.out_of_date", async () => {
    const p = await party([dish("Paella"), dish("Flan")], "hold");
    const [paella] = await dishIds(p.bill1, "Paella");
    await recallIntoDraft(p.partyId, p.bill1, paella!);
    const ask = await readMove(p.partyId, p.bill1, p.bill2, adminId());
    await refused(() => sendMove(p.bill1, p.bill2, [paella!], ask), "draft.out_of_date", {
      billId: p.bill1,
    });
  });

  it("A803 move dishes refuses: to a new bill, a dish the kitchen holds outside a held group is tab.split_held_line", async () => {
    const p = await party([dish("Caña")]);
    await inTx(v, (tx) =>
      addTabRound(tx, v.cfg, p.bill1, [{ menuItemId: v.item("Tarta"), quantity: "1", hold: true }]),
    );
    const tarta = (await dishIds(p.bill1)).at(-1)!;
    await refused(() => move(p.partyId, p.bill1, null, [tarta]), "tab.split_held_line", {
      tabId: p.bill1,
      lineNo: await lineNoOf(p.bill1, tarta),
    });
  });

  it("A803 move dishes refuses: another person's unsent dishes on the destination are draft.taken_over naming them", async () => {
    const p = await party([dish("Caña")]);
    const [caña] = await dishIds(p.bill1);
    await saveTarta(p.partyId, p.bill2, adminId());
    const [edit] = await editsOf(p.bill2);
    await refused(() => move(p.partyId, p.bill1, p.bill2, [caña!]), "draft.taken_over", {
      billId: p.bill2,
      ownerId: adminId(),
      edit,
    });
  });

  it("A803 move dishes refuses: a stale editor version on the source is draft.out_of_date", async () => {
    const p = await party([dish("Caña")]);
    const [caña] = await dishIds(p.bill1);
    const ask = await readMove(p.partyId, p.bill1, p.bill2, adminId());
    await saveTarta(p.partyId, p.bill1, adminId());
    await refused(() => sendMove(p.bill1, p.bill2, [caña!], ask), "draft.out_of_date", {
      billId: p.bill1,
    });
  });

  it("A803 move dishes refuses: a stale party revision is party.out_of_date", async () => {
    const p = await party([dish("Caña")]);
    const [caña] = await dishIds(p.bill1);
    const ask = await readMove(p.partyId, p.bill1, p.bill2);
    await inTx(v, (tx) =>
      tx
        .update(parties)
        .set({ revision: sql`${parties.revision} + 1` })
        .where(eq(parties.id, p.partyId)),
    );
    await refused(() => sendMove(p.bill1, p.bill2, [caña!], ask), "party.out_of_date", {
      partyId: p.partyId,
    });
  });
});

describe("A803 move dishes race: the second of two writes is refused, changing nothing", () => {
  it("A803 move dishes race: an item payment for the Burger commits first; the move naming it is bill.line_paid", async () => {
    const p = await party([dish("Burger"), dish("Flan")]);
    const [burger] = await dishIds(p.bill1, "Burger");
    const ask = await readMove(p.partyId, p.bill1, p.bill2);
    await payItems(p.bill1, [await lineNoOf(p.bill1, burger!)], "12.00");
    await refused(() => sendMove(p.bill1, p.bill2, [burger!], ask), "bill.line_paid", {
      workingOrderId: p.bill1,
    });
  });

  it("A803 move dishes race: a €40 contribution commits first; the move that would now break the floor is bill.received_exceeds_total", async () => {
    const p = await party([dish("Vino"), dish("Burger"), dish("Agua")]);
    const [vino] = await dishIds(p.bill1, "Vino");
    const ask = await readMove(p.partyId, p.bill1, p.bill2);
    await cashContribution(v, p.bill1, "40.00");
    await refused(() => sendMove(p.bill1, p.bill2, [vino!], ask), "bill.received_exceeds_total", {
      workingOrderId: p.bill1,
      excess: "26.00",
    });
  });

  it("A803 move dishes race: Bill 2 is taken by another person first; the move is draft.taken_over", async () => {
    const p = await party([dish("Caña")]);
    const [caña] = await dishIds(p.bill1);
    const ask = await readMove(p.partyId, p.bill1, p.bill2);
    await saveTarta(p.partyId, p.bill2, adminId());
    await refused(() => sendMove(p.bill1, p.bill2, [caña!], ask), "draft.taken_over", {
      billId: p.bill2,
      ownerId: adminId(),
    });
  });

  it("A803 move dishes race: two moves from one read; the second is party.out_of_date and one new bill exists", async () => {
    const p = await party([dish("Caña", "2")]);
    const [first, second] = await dishIds(p.bill1);
    const ask = await readMove(p.partyId, p.bill1, null);
    await sendMove(p.bill1, null, [first!], ask);
    await refused(() => sendMove(p.bill1, null, [second!], ask), "party.out_of_date", {
      partyId: p.partyId,
    });
    expect(await numbersOf(v, p.partyId)).toHaveLength(3);
  });

  it("A803 move dishes race: a resend of a successful move, its reply lost, is party.out_of_date and makes no second bill or notice", async () => {
    const p = await party([dish("Caña", "2")]);
    const [first] = await dishIds(p.bill1);
    const ask = await readMove(p.partyId, p.bill1, null);
    await sendMove(p.bill1, null, [first!], ask);
    await refused(() => sendMove(p.bill1, null, [first!], ask), "party.out_of_date", {
      partyId: p.partyId,
    });
  });

  it("A803 move dishes race: on a bill with no party, a resend of a successful move to a new bill is tab.line_not_found naming the first moved id", async () => {
    const id = await counterOrder(v, "Burger", "Flan");
    const [burger] = await dishIds(id, "Burger");
    const ask = await readMove(null, id, null);
    await sendMove(id, null, [burger!], ask);
    await refused(() => sendMove(id, null, [burger!], ask), "tab.line_not_found", {
      tabId: id,
      lineId: burger,
    });
  });
});
