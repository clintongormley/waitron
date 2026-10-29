import { setImmediate as yieldTurn } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { createExtraList, createProduct, writeProductModifiers } from "@waitron/catalogue";
import {
  locationCatalogues,
  parties,
  ticketItems,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { afterEach, describe, expect, it } from "vitest";
import { mergeCheckedBills, splitBill, transferItems } from "./bill-actions.js";
import { readBillEditState, readPartyBillIds } from "./bill-editing.js";
import { recallToDraft } from "./draft-recall.js";
import { cancelItem } from "./line-cancel.js";
import { readCancellationContext } from "./line-cancel-context.js";
import { VENUE_SERVICE } from "./modules.js";
import { moveBill } from "./move-bill.js";
import { saveDraft, splitDraft, submitDraft, type BillEditExpected } from "./order-drafts.js";
import { expandPortionRows, registerPortions, type PortionRef } from "./order-portions.js";
import { partyRevision, seatTable } from "./parties.js";
import { inTx, provisionBillVenue, send, type BillVenue } from "./testing/bill-venue.js";
import { cancelLine, cancelReasonId } from "./testing/cancel-line.js";
import { setChangesAfterSending } from "./testing/changes-after-sending.js";
import { createTable } from "./testing/live-table.js";
import { addPortionRound } from "./testing/portion-bill.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";
import {
  advanceTicketItem,
  insertTabRound,
  parkOrder,
  priceTabRound,
  readTabLines,
  storedOrderTotal,
  updateHeldOrder,
  type TabRoundLine,
} from "./working-order.js";

afterEach(() => yieldTurn());

let venue: BillVenue;
let offers: ZoneOffers;
let ids: { burger: string; cheese: string; toppings: string };

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    ids = await inTx(venue, async (tx) => {
      const [catalogue] = await tx
        .select({ id: locationCatalogues.catalogueId })
        .from(locationCatalogues)
        .where(eq(locationCatalogues.locationId, venue.cfg.locationId));
      const product = async (name: string, price: string) =>
        (
          await createProduct(tx, {
            catalogueId: catalogue!.id,
            categoryId: null,
            name,
            customerName: { [venue.cfg.locale]: `${name} (customer)` },
            kitchenName: name.toUpperCase(),
            pricingUnit: "each",
            unitPrice: price,
            vatClass: "reduced",
          })
        ).id;
      const burger = await product("Burger", "9.50");
      const cheese = await product("Cheese", "1.00");
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
          venue.cfg.locale,
        )
      ).id;
      await writeProductModifiers(tx, burger, [{ kind: "extras", id: toppings }]);
      offers = await offerProducts(tx, venue.cfg, {
        zone: { zoneId: venue.zoneId },
        orderStart: "table",
      });
      return { burger, cheese, toppings };
    });
  },
});

const burgersWithCheese = (quantity: string): TabRoundLine[] =>
  offers.toOfferLines([
    {
      productId: ids.burger,
      quantity,
      extras: [{ listId: ids.toppings, picks: [{ productId: ids.cheese, quantity: 1 }] }],
    },
  ]);

/** A seated party whose first bill holds two sent burgers with cheese as portions, and an empty
 * second bill. */
async function fixture() {
  return inTx(venue, async (tx) => {
    const table = await createTable(tx, venue.cfg, {
      label: `Life-${randomUUID().slice(0, 8)}`,
      zoneId: venue.zoneId,
    });
    const seated = await seatTable(tx, venue.cfg, {
      tableId: table.id,
      operatorId: venue.operatorId,
      guestCount: 2,
    });
    const [other] = await tx
      .insert(workingOrders)
      .values({
        source: "dashboard",
        orderNumber: 2,
        partyId: seated.partyId,
        locationId: venue.cfg.locationId,
      })
      .returning();
    await VENUE_SERVICE.recordOrderContext(tx, venue.cfg, other!.id, venue.zoneId);
    await VENUE_SERVICE.writePartyAllergy(
      tx,
      seated.partyId,
      { answer: "none", guests: [] },
      venue.operatorId,
    );
    const portions = await addPortionRound(tx, venue.cfg, seated.tabId, burgersWithCheese("2"), {
      fire: true,
    });
    return { partyId: seated.partyId, billId: seated.tabId, otherId: other!.id, portions };
  });
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

function linesOf(billId: string) {
  return venue.db
    .select({
      id: workingOrderLines.id,
      lineNo: workingOrderLines.lineNo,
      parentLineId: workingOrderLines.parentLineId,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, billId))
    .orderBy(workingOrderLines.lineNo);
}

function ticketItemsOf(billId: string) {
  return venue.db
    .select({ id: ticketItems.id, lineId: ticketItems.workingOrderLineId })
    .from(ticketItems)
    .where(eq(ticketItems.workingOrderId, billId))
    .orderBy(ticketItems.id);
}

function eventsOf(portions: readonly PortionRef[]) {
  const wanted = new Set(portions.map((portion) => portion.portionId));
  return venue.db
    .all<{
      portion_id: string;
      kind: string;
      from_order_id: string;
      to_order_id: string | null;
      actor_id: string | null;
    }>(
      sql`select portion_id, kind, from_order_id, to_order_id, actor_id from order_portion_events order by rowid`,
    )
    .filter((event) => wanted.has(event.portion_id));
}

function bindingOf(lineId: string) {
  return venue.db.all<{ portion_id: string }>(
    sql`select portion_id from working_line_portions where working_order_line_id = ${lineId}`,
  );
}

function registryHas(portionId: string): boolean {
  return venue.db.all(sql`select id from order_portions where id = ${portionId}`).length === 1;
}

/** Every row of the portion tables, in insertion order. */
function portionTables() {
  return Object.fromEntries(
    ["order_portions", "working_line_portions", "order_portion_events"].map((name) => [
      name,
      venue.db.all(sql`select * from ${sql.identifier(name)} order by rowid`),
    ]),
  );
}

const edit = (billId: string) => inTx(venue, (tx) => readBillEditState(tx, billId));

async function command(p: Fixture) {
  const [row] = await venue.db.select().from(parties).where(eq(parties.id, p.partyId));
  return { partyId: p.partyId, expectedPartyRevision: row!.revision, operatorId: venue.adminId };
}

async function bothEdits(p: Pick<Fixture, "billId" | "otherId">): Promise<BillEditExpected[]> {
  return [await edit(p.billId), await edit(p.otherId)].sort((a, b) =>
    a.billId.localeCompare(b.billId),
  );
}

function transferFirst(p: Fixture, expectedEdits: BillEditExpected[]) {
  return command(p).then((ask) =>
    inTx(venue, (tx) =>
      transferItems(tx, venue.cfg, p.billId, p.otherId, [{ lineNo: 1 }], {
        ...ask,
        expectedEdits,
      }),
    ),
  );
}

describe("A803 portion lifecycle: moves", () => {
  it("a transferred portion keeps its line, ticket item and extra ids and records one moved event naming the operator", async () => {
    const p = await fixture();
    const [first] = p.portions;
    const before = await linesOf(p.billId);
    const firstFamily = before.filter(
      (line) => line.id === first!.lineId || line.parentLineId === first!.lineId,
    );
    expect(firstFamily).toHaveLength(2);
    const tickets = (await ticketItemsOf(p.billId)).filter((item) =>
      firstFamily.some((line) => line.id === item.lineId),
    );
    expect(tickets).not.toEqual([]);

    await transferFirst(p, await bothEdits(p));

    const moved = await linesOf(p.otherId);
    expect(moved.map((line) => line.id).sort()).toEqual(firstFamily.map((line) => line.id).sort());
    expect(await ticketItemsOf(p.otherId)).toEqual(
      [...tickets].sort((a, b) => a.id.localeCompare(b.id)),
    );
    expect(bindingOf(first!.lineId)).toEqual([{ portion_id: first!.portionId }]);
    expect(eventsOf(p.portions)).toEqual([
      {
        portion_id: first!.portionId,
        kind: "moved",
        from_order_id: p.billId,
        to_order_id: p.otherId,
        actor_id: venue.adminId,
      },
    ]);
  });

  it("a merge records a moved event with its operator for each portion", async () => {
    const p = await fixture();
    const expectedEdits = await bothEdits(p);
    await inTx(venue, (tx) =>
      mergeCheckedBills(tx, venue.cfg, p.partyId, p.otherId, p.billId, {
        operatorId: venue.adminId,
        expectedEdits,
      }),
    );
    expect(eventsOf(p.portions)).toEqual(
      p.portions.map((portion) => ({
        portion_id: portion.portionId,
        kind: "moved",
        from_order_id: p.billId,
        to_order_id: p.otherId,
        actor_id: venue.adminId,
      })),
    );
  });

  it("a bill split records a moved event with its operator", async () => {
    const p = await fixture();
    const [first] = p.portions;
    const ask = { ...(await command(p)), expectedEdit: await edit(p.billId) };
    const result = await inTx(venue, (tx) =>
      splitBill(tx, venue.cfg, p.billId, [{ lineNo: 1 }], ask),
    );
    expect(eventsOf(p.portions)).toEqual([
      {
        portion_id: first!.portionId,
        kind: "moved",
        from_order_id: p.billId,
        to_order_id: result.billId,
        actor_id: venue.adminId,
      },
    ]);
  });

  it("a draft split records a moved event with its operator for the recalled portion", async () => {
    const p = await fixture();
    const [first] = p.portions;
    const recalled = await inTx(venue, async (tx) => {
      await setChangesAfterSending(tx, "held-or-waiting");
      return recallToDraft(tx, venue.cfg, p.partyId, first!.lineId, {
        ...(await command(p)),
        expectedEdit: await readBillEditState(tx, p.billId),
        submissionId: randomUUID(),
      });
    });
    const draft = recalled.draft!;
    const result = await inTx(venue, async (tx) =>
      splitDraft(tx, venue.cfg, p.partyId, draft.id, {
        ...(await command(p)),
        expectedEdit: await readBillEditState(tx, p.billId),
        submissionId: randomUUID(),
        lineIds: draft.lines.map((line) => line.id),
      }),
    );
    expect(eventsOf(p.portions)).toEqual([
      {
        portion_id: first!.portionId,
        kind: "moved",
        from_order_id: p.billId,
        to_order_id: result.billId,
        actor_id: venue.adminId,
      },
    ]);
  });

  it("a transfer refused for a stale editor leaves registry, binding and event rows exactly as before", async () => {
    const p = await fixture();
    const stale = await bothEdits(p);
    // A save after the request read the source bill makes its expectation stale.
    const expectedEdit = await edit(p.billId);
    await inTx(venue, (tx) =>
      saveDraft(tx, venue.cfg, p.partyId, venue.adminId, {
        billId: p.billId,
        draftId: expectedEdit.draftId,
        revision: expectedEdit.draftRevision ?? 0,
        expectedEdit,
        lines: burgersWithCheese("1"),
      }),
    );
    const before = portionTables();
    await expect(transferFirst(p, stale)).rejects.toMatchObject({ code: "draft.out_of_date" });
    expect(portionTables()).toEqual(before);
  });
});

describe("A803 portion lifecycle: cancellations", () => {
  it("removing a portion with its charge records a cancelled event, drops its binding and keeps its registry row", async () => {
    const p = await fixture();
    const [first, second] = p.portions;
    await inTx(venue, (tx) => cancelLine(tx, venue.cfg, p.billId, 1, undefined, venue.adminId));
    expect((await linesOf(p.billId)).some((line) => line.id === first!.lineId)).toBe(false);
    expect(bindingOf(first!.lineId)).toEqual([]);
    expect(registryHas(first!.portionId)).toBe(true);
    expect(bindingOf(second!.lineId)).toEqual([{ portion_id: second!.portionId }]);
    expect(eventsOf(p.portions)).toEqual([
      {
        portion_id: first!.portionId,
        kind: "cancelled",
        from_order_id: p.billId,
        to_order_id: null,
        actor_id: venue.adminId,
      },
    ]);
  });

  it("cancelling a portion's extra leaves the dish bound and records no event", async () => {
    const p = await fixture();
    const [first] = p.portions;
    const cheese = (await linesOf(p.billId)).find((line) => line.parentLineId === first!.lineId);
    await inTx(venue, (tx) =>
      cancelLine(tx, venue.cfg, p.billId, cheese!.lineNo, undefined, venue.adminId),
    );
    expect((await linesOf(p.billId)).some((line) => line.id === cheese!.id)).toBe(false);
    expect(bindingOf(first!.lineId)).toEqual([{ portion_id: first!.portionId }]);
    expect(eventsOf(p.portions)).toEqual([]);
  });

  it("a saved edit that leaves a portion out records a cancelled event and drops its binding", async () => {
    const p = await fixture();
    const [first, second] = p.portions;
    const [order] = await venue.db
      .select({ revision: workingOrders.revision })
      .from(workingOrders)
      .where(eq(workingOrders.id, p.billId));
    await updateHeldOrder({ db: venue.db }, venue.cfg, p.billId, {
      operatorId: venue.adminId,
      expectedEdit: await edit(p.billId),
      revision: order!.revision,
      lines: [
        {
          workingOrderLineId: second!.lineId,
          ...burgersWithCheese("1")[0]!,
        },
      ],
    });
    expect(bindingOf(first!.lineId)).toEqual([]);
    expect(registryHas(first!.portionId)).toBe(true);
    expect(bindingOf(second!.lineId)).toEqual([{ portion_id: second!.portionId }]);
    expect(eventsOf(p.portions)).toEqual([
      {
        portion_id: first!.portionId,
        kind: "cancelled",
        from_order_id: p.billId,
        to_order_id: null,
        actor_id: venue.adminId,
      },
    ]);
  });

  it("a keep-charge cancellation records no event and keeps the binding", async () => {
    const p = await fixture();
    const [first] = p.portions;
    const [ticket] = await venue.db
      .select()
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderLineId, first!.lineId));
    await inTx(venue, (tx) => advanceTicketItem(tx, venue.cfg, ticket!.id, "preparing"));
    const [bill] = await venue.db
      .select({ revision: workingOrders.revision })
      .from(workingOrders)
      .where(eq(workingOrders.id, p.billId));
    await inTx(venue, async (tx) =>
      cancelItem(
        tx,
        venue.cfg,
        p.partyId,
        first!.lineId,
        {
          submissionId: randomUUID(),
          quantity: "1",
          outcome: "keep_charge",
          reasonId: await cancelReasonId(tx),
          expectedPartyRevision: await partyRevision(tx, p.partyId),
          expectedBillRevision: bill!.revision,
          expectedEdit: await readBillEditState(tx, p.billId),
          expectedContext: await readCancellationContext(tx, p.partyId, first!.lineId),
        },
        venue.adminId,
      ),
    );
    expect(bindingOf(first!.lineId)).toEqual([{ portion_id: first!.portionId }]);
    expect(eventsOf(p.portions)).toEqual([]);
  });
});

describe("A803 portion grouping: the bill line read", () => {
  it("says portion: true only on a dish line bound to a whole, unmeasured portion", async () => {
    const p = await fixture();
    const [first] = p.portions;
    const { unbound, measured } = await inTx(venue, async (tx) => {
      const plain = await priceTabRound(tx, venue.cfg, p.billId, burgersWithCheese("1"), "checked");
      await insertTabRound(tx, venue.cfg, plain, plain.rows);
      const weighed = await priceTabRound(
        tx,
        venue.cfg,
        p.billId,
        burgersWithCheese("1"),
        "checked",
      );
      const out = expandPortionRows(
        weighed.rows,
        weighed.lineContexts,
        weighed.rows.map(() => false),
        weighed.rows[0]!.lineNo,
      );
      await insertTabRound(tx, venue.cfg, { ...weighed, lineContexts: out.lineContexts }, out.rows);
      await registerPortions(tx, out.portions);
      return { unbound: plain.rows[0]!.lineNo, measured: out.rows[0]!.lineNo };
    });
    const lines = await inTx(venue, (tx) => readTabLines(tx, venue.cfg, p.billId));
    const portion = (lineNo: number) => lines.find((line) => line.lineNo === lineNo)!.portion;
    const extraOf = (lineNo: number) => lines.find((line) => line.parentLineNo === lineNo)!.portion;
    const firstNo = lines.find((line) => line.id === first!.lineId)!.lineNo;
    expect({
      bound: portion(firstNo),
      extra: extraOf(firstNo),
      measured: portion(measured),
      unbound: portion(unbound),
      unboundExtra: extraOf(unbound),
    }).toEqual({ bound: true, extra: false, measured: false, unbound: false, unboundExtra: false });
  });
});

describe("A803 portion lifecycle: end to end through a submitted draft", () => {
  /** A seated party at a fresh table whose first bill holds `quantity` burgers with cheese, sent
   * by submitting the operator's draft, and an empty second bill; the portions in line order. */
  async function submitted(quantity: string) {
    const p = await inTx(venue, async (tx) => {
      const table = await createTable(tx, venue.cfg, {
        label: `Sub-${randomUUID().slice(0, 8)}`,
        zoneId: venue.zoneId,
      });
      const seated = await seatTable(tx, venue.cfg, {
        tableId: table.id,
        operatorId: venue.operatorId,
        guestCount: 2,
      });
      const [other] = await tx
        .insert(workingOrders)
        .values({
          source: "dashboard",
          status: "open",
          nodeId: venue.cfg.nodeId,
          orderNumber: 2,
          partyId: seated.partyId,
          locationId: venue.cfg.locationId,
        })
        .returning();
      await VENUE_SERVICE.recordOrderContext(tx, venue.cfg, other!.id, venue.zoneId);
      await VENUE_SERVICE.writePartyAllergy(
        tx,
        seated.partyId,
        { answer: "none", guests: [] },
        venue.operatorId,
      );
      return {
        partyId: seated.partyId,
        billId: seated.tabId,
        otherId: other!.id,
        tableId: table.id,
      };
    });
    const saved = await inTx(venue, async (tx) =>
      saveDraft(tx, venue.cfg, p.partyId, venue.adminId, {
        billId: p.billId,
        draftId: null,
        revision: 0,
        expectedEdit: await readBillEditState(tx, p.billId),
        lines: burgersWithCheese(quantity),
      }),
    );
    const draft = saved.draft!;
    await inTx(venue, async (tx) =>
      submitDraft(tx, venue.cfg, p.partyId, draft.id, {
        submissionId: randomUUID(),
        expectedPartyRevision: await partyRevision(tx, p.partyId),
        operatorId: venue.adminId,
        expectedEdit: await readBillEditState(tx, p.billId),
        draftRevision: draft.revision,
        groups: [{ lineIds: draft.lines.map((line) => line.id), release: "fire" }],
      }),
    );
    const portions = venue.db.all<{ portionId: string; lineId: string; lineNo: number }>(
      sql`select b.portion_id as portionId, l.id as lineId, l.line_no as lineNo
          from working_order_lines l
          join working_line_portions b on b.working_order_line_id = l.id
          where l.working_order_id = ${p.billId} and l.parent_line_id is null
          order by l.line_no`,
    );
    return { ...p, portions };
  }
  type Submitted = Awaited<ReturnType<typeof submitted>>;

  async function ask(p: { partyId: string }) {
    return inTx(venue, async (tx) => ({
      partyId: p.partyId,
      expectedPartyRevision: await partyRevision(tx, p.partyId),
      operatorId: venue.adminId,
    }));
  }

  async function splitOff(p: Submitted, lineNo: number): Promise<string> {
    const command = { ...(await ask(p)), expectedEdit: await edit(p.billId) };
    return (await inTx(venue, (tx) => splitBill(tx, venue.cfg, p.billId, [{ lineNo }], command)))
      .billId;
  }

  async function payInCash(billId: string): Promise<void> {
    const total = await inTx(venue, (tx) => storedOrderTotal(tx, billId));
    const result = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${billId}/payments`,
      {
        submissionId: randomUUID(),
        kind: "contribution",
        amount: total,
        method: "cash",
        tendered: total,
        applied: total,
        tip: "0.00",
      },
    );
    expect(result.status, JSON.stringify(result.json)).toBe(200);
  }

  /** The bill's filed rows in line order, each with the portions linked to it. */
  function filedRows(billId: string) {
    const rows = venue.db.all<{ id: string; name: string; quantity: number }>(
      sql`select sl.id, sl.name, sl.quantity from sale_lines sl
          join sales s on s.id = sl.sale_id
          where s.working_order_id = ${billId} order by sl.line_no`,
    );
    return rows.map(({ id, ...row }) => ({
      ...row,
      portions: venue.db
        .all<{ portion_id: string }>(
          sql`select portion_id from sale_line_portions where sale_line_id = ${id}
              order by portion_id`,
        )
        .map((link) => link.portion_id),
    }));
  }

  const cents = (amount: string) => Math.round(Number(amount) * 100);

  it("A803 portion lifecycle: moving one of two sent burgers with extras keeps its portion, ticket and extra ids and its kitchen state, both bills' totals add up, and paying for it as an item files it with its cheese", async () => {
    const p = await submitted("2");
    const [first] = p.portions;
    const family = (await linesOf(p.billId)).filter(
      (line) => line.id === first!.lineId || line.parentLineId === first!.lineId,
    );
    expect(family).toHaveLength(2);
    const [ticket] = await venue.db
      .select()
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderLineId, first!.lineId));
    await inTx(venue, (tx) => advanceTicketItem(tx, venue.cfg, ticket!.id, "preparing"));
    const total = await inTx(venue, (tx) => storedOrderTotal(tx, p.billId));

    const command = { ...(await ask(p)), expectedEdits: await bothEdits(p) };
    await inTx(venue, (tx) =>
      transferItems(tx, venue.cfg, p.billId, p.otherId, [{ lineNo: first!.lineNo }], command),
    );

    expect((await linesOf(p.otherId)).map((line) => line.id).sort()).toEqual(
      family.map((line) => line.id).sort(),
    );
    expect(bindingOf(first!.lineId)).toEqual([{ portion_id: first!.portionId }]);
    const [moved] = await venue.db
      .select({ id: ticketItems.id, state: ticketItems.state, billId: ticketItems.workingOrderId })
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderLineId, first!.lineId));
    expect(moved).toEqual({ id: ticket!.id, state: "preparing", billId: p.otherId });
    const [left, other] = await inTx(venue, async (tx) => [
      await storedOrderTotal(tx, p.billId),
      await storedOrderTotal(tx, p.otherId),
    ]);
    expect(cents(left!) + cents(other!)).toBe(cents(total));
    expect(cents(other!)).toBe(cents(total) / 2);

    const burgerNo = (await linesOf(p.otherId)).find((line) => line.id === first!.lineId)!.lineNo;
    const paid = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${p.otherId}/payments`,
      {
        submissionId: randomUUID(),
        kind: "items",
        lines: [{ lineNo: burgerNo }],
        method: "cash",
        tendered: other!,
        applied: other!,
        tip: "0.00",
      },
    );
    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    expect(filedRows(p.otherId)).toEqual([
      { name: "Burger", quantity: 1000, portions: [first!.portionId] },
      { name: "Cheese", quantity: 1000, portions: [first!.portionId] },
    ]);
  });

  it("A803 portion lifecycle: cheese cancelled on one of two burgers, then paid: two dish rows filed, each linked to its own portion, and the cheese left linked to its own burger's", async () => {
    const p = await submitted("2");
    const [first, second] = p.portions;
    const cheese = (await linesOf(p.billId)).find((line) => line.parentLineId === first!.lineId);
    await inTx(venue, (tx) =>
      cancelLine(tx, venue.cfg, p.billId, cheese!.lineNo, undefined, venue.adminId),
    );

    await payInCash(p.billId);

    expect(filedRows(p.billId)).toEqual([
      { name: "Burger", quantity: 1000, portions: [first!.portionId] },
      { name: "Burger", quantity: 1000, portions: [second!.portionId] },
      { name: "Cheese", quantity: 1000, portions: [second!.portionId] },
    ]);
  });

  it("A803 portion lifecycle: three checks split off a submitted bill file contiguous invoice numbers with every sale row linked", async () => {
    const p = await submitted("3");
    const [first, second, third] = p.portions;
    const a = await splitOff(p, first!.lineNo);
    const b = await splitOff(p, second!.lineNo);

    for (const billId of [a, b, p.billId]) await payInCash(billId);

    const issued = venue.db.all<{ bill: string; series: string; number: number }>(
      sql`select working_order_id as bill, series_id as series, invoice_number as number
          from sales where working_order_id in (${a}, ${b}, ${p.billId})
          order by invoice_number`,
    );
    expect(issued.map((sale) => sale.bill)).toEqual([a, b, p.billId]);
    expect(new Set(issued.map((sale) => sale.series)).size).toBe(1);
    expect(issued.map((sale) => sale.number - issued[0]!.number)).toEqual([0, 1, 2]);
    expect([a, b, p.billId].map((billId) => filedRows(billId))).toEqual(
      [first, second, third].map((portion) => [
        { name: "Burger", quantity: 1000, portions: [portion!.portionId] },
        { name: "Cheese", quantity: 1000, portions: [portion!.portionId] },
      ]),
    );
  });

  it("A803 portion lifecycle: a move refused for a stale editor writes no registry, binding, link or event row", async () => {
    const p = await submitted("2");
    const [, second] = p.portions;
    await payInCash(await splitOff(p, second!.lineNo));
    const stale = await edit(p.billId);
    const current = await edit(p.billId);
    await inTx(venue, (tx) =>
      saveDraft(tx, venue.cfg, p.partyId, venue.adminId, {
        billId: p.billId,
        draftId: current.draftId,
        revision: current.draftRevision ?? 0,
        expectedEdit: current,
        lines: burgersWithCheese("1"),
      }),
    );
    const tables = () => ({
      ...portionTables(),
      sale_line_portions: venue.db.all(sql`select * from sale_line_portions order by rowid`),
    });
    const before = tables();
    expect(before.sale_line_portions).not.toEqual([]);

    const command = { ...(await ask(p)), expectedEdit: stale };
    await expect(
      inTx(venue, (tx) =>
        splitBill(tx, venue.cfg, p.billId, [{ lineNo: p.portions[0]!.lineNo }], command),
      ),
    ).rejects.toMatchObject({ code: "draft.out_of_date" });
    expect(tables()).toEqual(before);
  });

  it("A1208 portion lifecycle: a counter order moved to a table holds portions, and one burger leaves with its cheese", async () => {
    const p = await submitted("1");
    const counter = await inTx(venue, (tx) =>
      offerProducts(tx, venue.cfg, { zone: "counter", orderStart: "counter" }),
    );
    const movedId = randomUUID();
    await parkOrder({ db: venue.db }, venue.cfg, {
      id: movedId,
      lines: counter.toOfferLines([
        {
          productId: ids.burger,
          quantity: "2",
          extras: [{ listId: ids.toppings, picks: [{ productId: ids.cheese, quantity: 1 }] }],
        },
      ]),
      zoneId: counter.zoneId,
      operatorId: venue.operatorId,
    });
    await inTx(venue, async (tx) =>
      moveBill(
        tx,
        venue.cfg,
        movedId,
        { tableId: p.tableId },
        {
          expectedEdits: await Promise.all(
            [movedId, ...(await readPartyBillIds(tx, [p.partyId]))]
              .sort()
              .map((billId) => readBillEditState(tx, billId)),
          ),
          bills: "separate",
          partyId: null,
          otherPartyId: p.partyId,
          expectedOtherPartyRevision: await partyRevision(tx, p.partyId),
          operatorId: venue.adminId,
        },
      ),
    );
    expect(
      (await venue.db.select().from(workingOrders).where(eq(workingOrders.id, movedId)))[0],
    ).toMatchObject({ partyId: p.partyId, status: "open" });

    const lines = venue.db.all<{ id: string; lineNo: number; quantity: number; dish: number }>(
      sql`select id, line_no as lineNo, quantity, parent_line_id is null as dish
          from working_order_lines where working_order_id = ${movedId} order by line_no`,
    );
    expect(lines.map((line) => [line.dish, line.quantity])).toEqual([
      [1, 1000],
      [0, 1000],
      [1, 1000],
      [0, 1000],
    ]);
    const [burger1, cheese1, burger2, cheese2] = lines;
    const portion1 = bindingOf(burger1!.id);
    expect(portion1).toHaveLength(1);
    expect(bindingOf(burger2!.id)).toHaveLength(1);
    expect(bindingOf(burger2!.id)).not.toEqual(portion1);
    expect([...bindingOf(cheese1!.id), ...bindingOf(cheese2!.id)]).toEqual([]);

    const expectedEdits = [await edit(movedId), await edit(p.billId)].sort((x, y) =>
      x.billId.localeCompare(y.billId),
    );
    const command = { ...(await ask(p)), expectedEdits };
    const before = (await linesOf(p.billId)).map((line) => line.id);
    await inTx(venue, (tx) =>
      transferItems(tx, venue.cfg, movedId, p.billId, [{ lineNo: burger1!.lineNo }], command),
    );

    expect((await linesOf(movedId)).map((line) => line.id)).toEqual([burger2!.id, cheese2!.id]);
    const arrived = (await linesOf(p.billId)).filter((line) => !before.includes(line.id));
    expect(arrived).toHaveLength(2);
    const [dish, extra] = arrived;
    expect(dish!.parentLineId).toBeNull();
    expect(extra!.parentLineId).toBe(dish!.id);
    expect(bindingOf(dish!.id)).toEqual(portion1);
    expect(
      venue.db.all(
        sql`select name, quantity, line_total as lineTotal from working_order_lines
            where id in (${dish!.id}, ${extra!.id}) order by line_no`,
      ),
    ).toEqual([
      { name: "Burger", quantity: 1000, lineTotal: 950 },
      { name: "Cheese", quantity: 1000, lineTotal: 100 },
    ]);
  });
});
