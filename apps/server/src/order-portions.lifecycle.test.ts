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
import { readBillEditState } from "./bill-editing.js";
import { recallToDraft } from "./draft-recall.js";
import { cancelItem } from "./line-cancel.js";
import { readCancellationContext } from "./line-cancel-context.js";
import { VENUE_SERVICE } from "./modules.js";
import { saveDraft, splitDraft, type BillEditExpected } from "./order-drafts.js";
import type { PortionRef } from "./order-portions.js";
import { partyRevision, seatTable } from "./parties.js";
import { inTx, provisionBillVenue, type BillVenue } from "./testing/bill-venue.js";
import { cancelLine, cancelReasonId } from "./testing/cancel-line.js";
import { setChangesAfterSending } from "./testing/changes-after-sending.js";
import { createTable } from "./testing/live-table.js";
import { addPortionRound } from "./testing/portion-bill.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";
import { advanceTicketItem, updateHeldOrder, type TabRoundLine } from "./working-order.js";

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

async function bothEdits(p: Fixture): Promise<BillEditExpected[]> {
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
