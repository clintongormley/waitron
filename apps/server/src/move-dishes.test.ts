import { randomUUID } from "node:crypto";
import { asc, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createExtraList, createProduct, writeProductModifiers } from "@waitron/catalogue";
import { products, ticketItems, workingOrderLines, workingOrders } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { decimalToCents } from "@waitron/shared";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { kitchenNoteKey, readKitchenNotes, writeKitchenNote } from "@waitron/venue-service";
import { moveDishes, splitBill, transferItems } from "./testing/bill-action-fixture.js";
import { readBillEditState } from "./bill-editing.js";
import type { BillEditExpected } from "./order-drafts.js";
import { insertPartyBill, partyRevision } from "./parties.js";
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
import "./errors.js";

// Move dishes… (A803 slice 4a, Task 2): whole dish lines to another bill of the party or a new bill.
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
async function party(bill1: Line[], release: "fire" | "hold" = "fire") {
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

/** Moves `lineIds` from `from` to `to` (a new bill when null) under the party's current revision. */
async function move(
  partyId: string | null,
  from: string,
  to: string | null,
  lineIds: readonly string[],
) {
  const command = partyId === null ? { operatorId: OPERATOR } : await commandFor(v, partyId);
  const expectedEdits = await editsOf(from, ...(to === null ? [] : [to]));
  return inTx(v, (tx) =>
    moveDishes(tx, v.cfg, from, to, lineIds, {
      ...command,
      ...(partyId === null ? {} : { partyId }),
      expectedEdits,
    }),
  );
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

    await move(p.partyId, p.bill1, p.bill2, [first!]);

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

/** What a move leaves on the two bills, with the ids that differ between two twin parties mapped. */
async function outcome(p: { bill1: string }, to: string) {
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
  return { source: await bill(p.bill1), destination: await bill(to) };
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
    await inTx(v, (tx) => transferItems(tx, v.cfg, a.bill1, a.bill2, lineNos, transfer));
    await move(b.partyId, b.bill1, b.bill2, await pick(b.bill1));

    expect(await outcome(b, b.bill2)).toEqual(await outcome(a, a.bill2));
  });

  it("A803 move dishes: to a new bill writes the same rows as Split by item of the same whole lines", async () => {
    const a = await party(twinOrder());
    const b = await party(twinOrder());
    const lineNos = (await rowsOf(a.bill1))
      .filter((row) => row.parentLineId === null)
      .slice(0, 2)
      .map((row) => ({ lineNo: row.lineNo }));
    const command = await commandFor(v, a.partyId);
    const split = await inTx(v, async (tx) =>
      splitBill(tx, v.cfg, a.bill1, lineNos, {
        ...command,
        expectedEdit: await readBillEditState(tx, a.bill1),
      }),
    );
    const moved = await move(b.partyId, b.bill1, null, (await dishIds(b.bill1)).slice(0, 2));

    expect(await outcome(b, moved.billId)).toEqual(await outcome(a, split.billId));
  });
});
