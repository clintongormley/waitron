import { ticketItemsWithBill } from "./testing/ticket-items-with-bill.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  kitchenStations,
  parties,
  ticketItems,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { readScopedPassBoard, type PassScope } from "./pass-board.js";
import type { PassBoard } from "./pass-card.js";
import { boardCards, boardItems, EVERY } from "./testing/pass-board-probe.js";
import {
  advanceTicketItem,
  handOverOrder,
  listStationQueue,
  markServed,
  unmarkServed,
} from "./working-order.js";
import { openDishCount } from "./station-closing.js";
import { setStationsWaitForPass } from "./testing/pass-waiting.js";
import {
  commandFor,
  counterOrder,
  inTx,
  OPERATOR,
  pay,
  seatWithNoAllergies,
  setupPartyVenue,
  type PartyVenue,
} from "./testing/party-venue.js";
import { placeGroupedRound, placeGroups } from "./testing/group-submit-fixture.js";
import { combineParties } from "./testing/table-action-fixture.js";
import { finishTable } from "./testing/party-close-fixture.js";
import { billWith, provisionAdjustmentVenue } from "./testing/adjustment-venue.js";
import { readBillEditState } from "./bill-editing.js";
import { readCancellationContext } from "./line-cancel-context.js";
import { cancelItem } from "./line-cancel.js";
import { payWorkingOrder } from "./testing/whole-payment-fixture.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

const counts = (board: PassBoard) =>
  boardItems(board, { inView: true }).map(({ id, qty }) => ({ id, qty }));

describe.each(["table", "counter"] as const)("A773 no dispatch projection: %s", (service) => {
  // The pass monitor's and the expo board's routes both read the board without release ids.
  it.each(["pass", "monitor and expo"] as const)(
    "keeps the %s read identical across reads, with no Away fields",
    async (reader) => {
      const work =
        service === "table"
          ? await tableWork()
          : await (async () => {
              const v = await setupPartyVenue(suite.db);
              const id = await counterOrder(v, "Burger");
              await pay(v, id, "12.00");
              const [item] = await inTx(v, (tx) =>
                ticketItemsWithBill(tx).where(eq(workingOrderLines.workingOrderId, id)),
              );
              await inTx(v, async (tx) => {
                await advanceTicketItem(tx, item!.id, "preparing");
                await advanceTicketItem(tx, item!.id, "ready");
              });
              return { v, item: item! };
            })();
      const { v, item } = work;
      const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now());
      try {
        const read = () =>
          inTx(v, (tx) => readScopedPassBoard(tx, EVERY, { release: reader === "pass" }));
        const before = await read();
        expect(counts(before)).toEqual([{ id: item.id, qty: "1.000" }]);
        expect(boardItems(before).map((dish) => dish.state)).toEqual(["ready"]);
        expect(boardCards(before)).toHaveLength(1);
        for (const card of boardCards(before)) {
          expect(card).not.toHaveProperty("away");
          for (const dish of card.items) expect(dish).not.toHaveProperty("awayAt");
        }
        const stored = await inTx(v, async (tx) => ({
          ticket: await tx.select().from(ticketItems).where(eq(ticketItems.id, item.id)),
        }));
        expect(await read()).toEqual(before);
        expect(
          await inTx(v, async (tx) => ({
            ticket: await tx.select().from(ticketItems).where(eq(ticketItems.id, item.id)),
          })),
        ).toEqual(stored);
      } finally {
        clock.mockRestore();
      }
    },
  );
});

async function boards(v: Pick<PartyVenue, "db" | "cfg">, scope: PassScope = EVERY) {
  return inTx(v, async (tx) => {
    const screen = await readScopedPassBoard(tx, scope);
    const monitor = await readScopedPassBoard(tx, scope, { release: false });
    return { screen: counts(screen), monitor: counts(monitor) };
  });
}

async function tableWork(quantity = "1", shape?: "grouped") {
  const v = await setupPartyVenue(suite.db);
  const party = await seatWithNoAllergies(v, await v.table("Lifetime table"));
  const group = { lines: [{ menuItemId: v.item("Burger"), quantity }], release: "fire" as const };
  await inTx(v, (tx) =>
    shape === "grouped"
      ? placeGroupedRound(tx, v.cfg, party, group, OPERATOR)
      : placeGroups(tx, v.cfg, party.partyId, {
          billId: party.tabId,
          operatorId: OPERATOR,
          groups: [group],
        }),
  );
  const [item] = await inTx(v, (tx) =>
    ticketItemsWithBill(tx).where(eq(workingOrderLines.workingOrderId, party.tabId)),
  );
  await inTx(v, async (tx) => {
    await advanceTicketItem(tx, item!.id, "preparing");
    await advanceTicketItem(tx, item!.id, "ready");
  });
  return { v, party, item: item! };
}

describe("A773 lifetime", () => {
  it("shows only the remaining quantity, restores it on Undo and keeps the original ready time", async () => {
    const { v, party, item } = await tableWork("2", "grouped");
    await pay(v, party.tabId, "24.00");
    const ticketBefore = await inTx(
      v,
      async (tx) => (await tx.select().from(ticketItems).where(eq(ticketItems.id, item.id)))[0]!,
    );
    const serve = async (quantity: string, undo = false) => {
      const command = { ...(await commandFor(v, party.partyId)), submissionId: randomUUID() };
      return inTx(v, async (tx) => {
        await (undo ? unmarkServed : markServed)(
          tx,
          v.cfg,
          party.partyId,
          [{ lineId: item.workingOrderLineId, quantity }],
          command,
        );
      });
    };
    await serve("1");
    const one = [{ id: item.id, qty: "1.000" }];
    expect(await boards(v)).toEqual({ screen: one, monitor: one });
    await serve("1", true);
    const two = [{ id: item.id, qty: "2.000" }];
    expect(await boards(v)).toEqual({ screen: two, monitor: two });
    expect(
      await inTx(
        v,
        async (tx) => (await tx.select().from(ticketItems).where(eq(ticketItems.id, item.id)))[0],
      ),
    ).toEqual(ticketBefore);
    expect(ticketBefore.readyAt).not.toBeNull();
    await serve("2");
    expect(await boards(v)).toEqual({ screen: [], monitor: [] });
  });

  it("removes unserved ready food when the paid party finishes", async () => {
    const { v, party, item } = await tableWork();
    await pay(v, party.tabId, "12.00");
    expect(await boards(v)).toEqual({
      screen: [{ id: item.id, qty: "1.000" }],
      monitor: [{ id: item.id, qty: "1.000" }],
    });
    const command = await commandFor(v, party.partyId);
    await inTx(v, (tx) => finishTable(tx, { partyId: party.partyId, ...command }));
    expect(
      await inTx(v, (tx) => tx.select().from(ticketItems).where(eq(ticketItems.id, item.id))),
    ).toHaveLength(1);
    expect(await boards(v)).toEqual({ screen: [], monitor: [] });
  });

  it("keeps a paid merged family's dish until its surviving party finishes, through two merges", async () => {
    const { v, party, item } = await tableWork();
    await pay(v, party.tabId, "12.00");
    const second = await seatWithNoAllergies(v, await v.table("Second table"));
    const third = await seatWithNoAllergies(v, await v.table("Third table"));
    for (const [from, into] of [
      [party.partyId, second.partyId],
      [second.partyId, third.partyId],
    ]) {
      await inTx(v, (tx) =>
        combineParties(tx, v.cfg, {
          from: from!,
          into: into!,
          tables: "join",
          operatorId: OPERATOR,
        }),
      );
    }
    const [bill] = await inTx(v, (tx) =>
      tx.select().from(workingOrders).where(eq(workingOrders.id, party.tabId)),
    );
    expect(bill!.partyId).toBe(party.partyId);
    const [closed] = await inTx(v, (tx) =>
      tx.select().from(parties).where(eq(parties.id, party.partyId)),
    );
    expect(closed!.state).toBe("closed");
    const expected = [{ id: item.id, qty: "1.000" }];
    expect(await boards(v)).toEqual({ screen: expected, monitor: expected });
    const command = await commandFor(v, third.partyId);
    await inTx(v, (tx) => finishTable(tx, { partyId: third.partyId, ...command }));
    expect(await boards(v)).toEqual({ screen: [], monitor: [] });
  });

  it("keeps paid counter food until collection, with explicit every-zone and no-zone reads", async () => {
    const v = await setupPartyVenue(suite.db);
    const id = await counterOrder(v, "Burger");
    await pay(v, id, "12.00");
    const [item] = await inTx(v, (tx) =>
      ticketItemsWithBill(tx).where(eq(workingOrderLines.workingOrderId, id)),
    );
    await inTx(v, async (tx) => {
      await advanceTicketItem(tx, item!.id, "preparing");
      await advanceTicketItem(tx, item!.id, "ready");
    });
    const expected = [{ id: item!.id, qty: "1.000" }];
    expect(await boards(v)).toEqual({ screen: expected, monitor: expected });
    expect(await boards(v, { stationIds: null, zoneIds: [] })).toEqual({ screen: [], monitor: [] });
    expect(await boards(v, { stationIds: null, zoneIds: [v.counter.zoneId] })).toEqual({
      screen: expected,
      monitor: expected,
    });
    await inTx(v, (tx) => handOverOrder(tx, v.cfg, id));
    expect(await boards(v)).toEqual({ screen: [], monitor: [] });
  });

  it("a dish with no recorded zone is visible only under every-zone scope", async () => {
    const v = await setupPartyVenue(suite.db);
    const id = await counterOrder(v, "Burger");
    await pay(v, id, "12.00");
    const [item] = await inTx(v, (tx) =>
      ticketItemsWithBill(tx).where(eq(workingOrderLines.workingOrderId, id)),
    );
    await inTx(v, async (tx) => {
      await tx.execute(sql`delete from order_service_contexts where working_order_id = ${id}`);
    });
    const expected = [{ id: item!.id, qty: "1.000" }];
    expect(await boards(v)).toEqual({ screen: expected, monitor: expected });
    expect(await boards(v, { stationIds: [item!.stationId], zoneIds: [v.counter.zoneId] })).toEqual(
      { screen: [], monitor: [] },
    );
    expect(await boards(v, { stationIds: [], zoneIds: null })).toEqual({ screen: [], monitor: [] });
  });

  it("subtracts serving after service cancellation without cancelling the same quantity twice", async () => {
    const v = await provisionAdjustmentVenue(suite.db);
    const order = await billWith(v, [{ name: "Pizza", quantity: "3", olives: 2 }], {
      shape: "grouped",
    });
    await payWorkingOrder(
      { admission: testTradingAdmission(), db: v.db, backend: v.backend, clock: v.clock },
      v.cfg,
      {
        id: order.billId,
        tender: { method: "cash", amount: "36.00" },
        lines: [],
      },
    );
    const rows = await inTx(v, (tx) =>
      tx
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, order.billId))
        .orderBy(workingOrderLines.lineNo),
    );
    const parent = rows.find((row) => row.parentLineId === null)!;
    const command = await commandFor(v, order.partyId);
    await inTx(v, async (tx) => {
      const [bill] = await tx
        .select()
        .from(workingOrders)
        .where(eq(workingOrders.id, order.billId));
      await cancelItem(
        tx,
        v.cfg,
        order.partyId,
        parent.id,
        {
          admission: testTradingAdmission(),
          expectedEdit: await readBillEditState(tx, order.billId),
          expectedContext: await readCancellationContext(tx, order.partyId, parent.id),
          expectedPartyRevision: command.expectedPartyRevision,
          expectedBillRevision: bill!.revision,
          submissionId: randomUUID(),
          quantity: "1",
          outcome: "keep_charge",
          reasonId: v.reasonId.houseVoid,
        },
        v.staffId,
      );
    });
    const next = await commandFor(v, order.partyId);
    await inTx(v, (tx) =>
      markServed(tx, v.cfg, order.partyId, [{ lineId: parent.id, quantity: "1" }], {
        ...next,
        operatorId: v.staffId,
        submissionId: randomUUID(),
      }),
    );
    const [ticket] = await inTx(v, (tx) =>
      tx.select().from(ticketItems).where(eq(ticketItems.workingOrderLineId, parent.id)),
    );
    expect(ticket!.quantity).toBe(2000);
    const expected = [{ id: ticket!.id, qty: "1.000" }];
    expect(await boards(v)).toEqual({ screen: expected, monitor: expected });
    const after = await inTx(v, (tx) =>
      tx
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, order.billId))
        .orderBy(workingOrderLines.lineNo),
    );
    expect(
      after.map(({ id, quantity, unitPriceGross, lineTotal }) => ({
        id,
        quantity,
        unitPriceGross,
        lineTotal,
      })),
    ).toEqual(
      rows.map(({ id, quantity, unitPriceGross, lineTotal }) => ({
        id,
        quantity,
        unitPriceGross,
        lineTotal,
      })),
    );
  });
});

describe("a dish the waiter serves leaves the station's screen, as it leaves the pass", () => {
  async function sentAndServed(options: {
    quantity: string;
    served: string;
    waitsForPass: boolean;
  }) {
    const v = await setupPartyVenue(suite.db);
    if (options.waitsForPass)
      await inTx(v, async (tx) => {
        const stations = await tx.select({ id: kitchenStations.id }).from(kitchenStations);
        await setStationsWaitForPass(
          tx,
          true,
          stations.map((station) => station.id),
        );
      });
    const party = await seatWithNoAllergies(v, await v.table("Served table"));
    const group = {
      lines: [{ menuItemId: v.item("Burger"), quantity: options.quantity }],
      release: "fire" as const,
    };
    await inTx(v, (tx) => placeGroupedRound(tx, v.cfg, party, group, OPERATOR));
    const [item, ...others] = await inTx(v, (tx) =>
      ticketItemsWithBill(tx).where(eq(workingOrderLines.workingOrderId, party.tabId)),
    );
    expect(others).toEqual([]);
    expect(item).toMatchObject(
      options.waitsForPass
        ? { passControlled: true, requestedAt: expect.any(String), firedAt: null }
        : { passControlled: false, firedAt: expect.any(String) },
    );
    const command = { ...(await commandFor(v, party.partyId)), submissionId: randomUUID() };
    await inTx(v, (tx) =>
      markServed(
        tx,
        v.cfg,
        party.partyId,
        [{ lineId: item!.workingOrderLineId, quantity: options.served }],
        command,
      ),
    );
    const queue = await inTx(v, (tx) => listStationQueue(tx, item!.stationId));
    return {
      station: queue.flatMap((order) =>
        order.items.map(({ name, phase, quantity }) => ({ name, phase, quantity })),
      ),
      pass: counts(await inTx(v, (tx) => readScopedPassBoard(tx, EVERY))),
      openDishes: await inTx(v, (tx) => openDishCount(tx, item!.stationId)),
      itemId: item!.id,
    };
  }

  it("takes a dish the cook never touched off the station when it is served", async () => {
    const read = await sentAndServed({ quantity: "1", served: "1", waitsForPass: false });
    expect(read.pass).toEqual([]);
    expect(read.openDishes).toBe(0);
    expect(read.station).toEqual([]);
  });

  it("takes a dish still waiting for the pass off the station when it is served", async () => {
    const read = await sentAndServed({ quantity: "1", served: "1", waitsForPass: true });
    expect(read.pass).toEqual([]);
    expect(read.openDishes).toBe(0);
    expect(read.station).toEqual([]);
  });

  it("keeps a part-served dish on the station with only what is left, as the pass does", async () => {
    const read = await sentAndServed({ quantity: "3", served: "1", waitsForPass: false });
    expect(read.pass).toEqual([{ id: read.itemId, qty: "2.000" }]);
    expect(read.openDishes).toBe(1);
    expect(read.station).toEqual([{ name: "BURG", phase: "waiting", quantity: "2.000" }]);
  });
});
