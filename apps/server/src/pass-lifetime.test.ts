import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { parties, passItemMarks, ticketItems, workingOrderLines, workingOrders } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { listPassMonitor, listPassScreen, type PassScope } from "./pass-board.js";
import {
  advanceTicketItem,
  handOverOrder,
  listExpoQueue,
  markServed,
  unmarkServed,
  type ExpoOrder,
} from "./working-order.js";
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
import { placeGroups } from "./testing/group-submit-fixture.js";
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
const EVERY: PassScope = { stationIds: null, zoneIds: null };

const items = (orders: ExpoOrder[]) =>
  orders.flatMap((order) => [...order.courses, ...order.groups].flatMap((part) => part.items));
const counts = (orders: ExpoOrder[]) => items(orders).map(({ id, qty }) => ({ id, qty }));

describe.each(["table", "counter"] as const)("A773 no dispatch projection: %s", (service) => {
  it.each(["expo", "pass", "monitor"] as const)(
    "keeps the %s read identical after legacy Away and Done stamps",
    async (reader) => {
      const work =
        service === "table"
          ? await tableWork()
          : await (async () => {
              const v = await setupPartyVenue(suite.db);
              const id = await counterOrder(v, "Burger");
              await pay(v, id, "12.00");
              const [item] = await inTx(v, (tx) =>
                tx.select().from(ticketItems).where(eq(ticketItems.workingOrderId, id)),
              );
              await inTx(v, async (tx) => {
                await advanceTicketItem(tx, v.cfg, item!.id, "preparing");
                await advanceTicketItem(tx, v.cfg, item!.id, "ready");
              });
              return { v, item: item! };
            })();
      const { v, item } = work;
      const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now());
      try {
        const read = () =>
          inTx(v, async (tx) => {
            if (reader === "expo") return listExpoQueue(tx, v.cfg);
            if (reader === "pass") {
              return (await listPassScreen(tx, v.cfg, v.cfg.origin.deviceId, EVERY)).orders;
            }
            return (await listPassMonitor(tx, v.cfg, EVERY)).orders;
          });
        const before = await read();
        expect(counts(before)).toEqual([{ id: item.id, qty: "1.000" }]);
        expect(items(before).map((dish) => dish.state)).toEqual(["ready"]);
        for (const order of before) {
          expect(order[service === "table" ? "groups" : "courses"]).toHaveLength(1);
          for (const section of [...order.groups, ...order.courses]) {
            expect(section).not.toHaveProperty("away");
            for (const dish of section.items) expect(dish).not.toHaveProperty("awayAt");
          }
        }
        await inTx(v, async (tx) => {
          await tx
            .update(ticketItems)
            .set({ awayAt: "2026-10-20T12:00:00.000Z" })
            .where(eq(ticketItems.id, item.id));
          await tx.insert(passItemMarks).values({
            deviceId: v.cfg.origin.deviceId,
            ticketItemId: item.id,
            doneAt: "2026-10-20T12:00:00.000Z",
            doneByPersonId: OPERATOR,
          });
        });
        const stored = await inTx(v, async (tx) => ({
          ticket: await tx.select().from(ticketItems).where(eq(ticketItems.id, item.id)),
          marks: await tx.select().from(passItemMarks),
        }));
        expect(await read()).toEqual(before);
        expect(
          await inTx(v, async (tx) => ({
            ticket: await tx.select().from(ticketItems).where(eq(ticketItems.id, item.id)),
            marks: await tx.select().from(passItemMarks),
          })),
        ).toEqual(stored);
      } finally {
        clock.mockRestore();
      }
    },
  );
});

async function boards(
  v: Pick<PartyVenue, "db" | "cfg">,
  scope = EVERY,
  deviceId = v.cfg.origin.deviceId,
) {
  return inTx(v, async (tx) => ({
    screen: counts((await listPassScreen(tx, v.cfg, deviceId, scope)).orders),
    monitor: counts((await listPassMonitor(tx, v.cfg, scope)).orders),
  }));
}

async function tableWork(quantity = "1") {
  const v = await setupPartyVenue(suite.db);
  const party = await seatWithNoAllergies(v, await v.table("Lifetime table"));
  await inTx(v, (tx) =>
    placeGroups(tx, v.cfg, party.partyId, {
      billId: party.tabId,
      operatorId: OPERATOR,
      groups: [{ lines: [{ menuItemId: v.item("Burger"), quantity }], release: "fire" }],
    }),
  );
  const [item] = await inTx(v, (tx) =>
    tx.select().from(ticketItems).where(eq(ticketItems.workingOrderId, party.tabId)),
  );
  await inTx(v, async (tx) => {
    await advanceTicketItem(tx, v.cfg, item!.id, "preparing");
    await advanceTicketItem(tx, v.cfg, item!.id, "ready");
  });
  return { v, party, item: item! };
}

describe("A773 lifetime", () => {
  it("keeps a ready paid dish on both boards despite legacy Away and device Done marks", async () => {
    const { v, party, item } = await tableWork();
    await pay(v, party.tabId, "12.00");
    const expected = [{ id: item.id, qty: "1.000" }];
    expect(await boards(v)).toEqual({ screen: expected, monitor: expected });
    await inTx(v, async (tx) => {
      await tx.insert(passItemMarks).values({
        deviceId: v.cfg.origin.deviceId,
        ticketItemId: item.id,
        doneAt: new Date().toISOString(),
        doneByPersonId: OPERATOR,
      });
      await tx
        .update(ticketItems)
        .set({ awayAt: new Date().toISOString() })
        .where(eq(ticketItems.id, item.id));
    });
    expect(await boards(v)).toEqual({ screen: expected, monitor: expected });
    expect(counts(await inTx(v, (tx) => listExpoQueue(tx, v.cfg)))).toEqual(expected);
  });

  it("shows only the remaining quantity, restores it on Undo and keeps the original ready time", async () => {
    const { v, party, item } = await tableWork("2");
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
    expect(counts(await inTx(v, (tx) => listExpoQueue(tx, v.cfg)))).toEqual([]);
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
    expect(counts(await inTx(v, (tx) => listExpoQueue(tx, v.cfg)))).toEqual([]);
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
          bills: "separate",
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
      tx.select().from(ticketItems).where(eq(ticketItems.workingOrderId, id)),
    );
    await inTx(v, async (tx) => {
      await advanceTicketItem(tx, v.cfg, item!.id, "preparing");
      await advanceTicketItem(tx, v.cfg, item!.id, "ready");
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
      tx.select().from(ticketItems).where(eq(ticketItems.workingOrderId, id)),
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
    const order = await billWith(v, [{ name: "Pizza", quantity: "3", olives: 2 }]);
    await payWorkingOrder({ db: v.db, backend: v.backend, clock: v.clock }, v.cfg, {
      id: order.billId,
      tender: { method: "cash", amount: "36.00" },
      lines: [],
    });
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
