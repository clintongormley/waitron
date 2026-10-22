import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  lineServiceCancellations,
  orderGroups,
  parties,
  partyTables,
  printJobs,
  serviceCommands,
  sales,
  saleLines,
  tenders,
  ticketItems,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { adjustments } from "@waitron/adjustments";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { readBillEditState } from "./bill-editing.js";
import { splitBill } from "./bill-actions.js";
import { listCounterWaiting, markServed } from "./working-order.js";
import { partyFamily, readFamilyBills } from "./parties.js";
import { combineParties } from "./testing/table-action-fixture.js";
import { payWorkingOrder } from "./testing/whole-payment-fixture.js";
import {
  billWith,
  inTx,
  provisionAdjustmentVenue,
  type AdjustmentVenue,
} from "./testing/adjustment-venue.js";

let venue: AdjustmentVenue;
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionAdjustmentVenue(db);
  },
});

type Line = { name: string; quantity?: string };

interface Table {
  partyId: string;
  billIds: string[];
}

async function pay(billId: string, amount: string) {
  await payWorkingOrder({ db: venue.db, backend: venue.backend, clock: venue.clock }, venue.cfg, {
    id: billId,
    tender: { method: "cash", amount },
    lines: [],
  });
}

async function partyRevision(partyId: string) {
  const [party] = await venue.db.select().from(parties).where(eq(parties.id, partyId));
  return party!.revision;
}

async function topLines(billIds: string[]) {
  return venue.db
    .select()
    .from(workingOrderLines)
    .where(
      and(
        inArray(workingOrderLines.workingOrderId, billIds),
        isNull(workingOrderLines.parentLineId),
      ),
    )
    .orderBy(workingOrderLines.workingOrderId, workingOrderLines.lineNo);
}

/**
 * A table whose first bill holds every line, then each later bill split off it by line number
 * (`moves`, one bill each), then each bill paid with the amount given (null leaves it owing).
 */
async function table(
  lines: Line[],
  release: "hold" | "fire",
  moves: number[][] = [],
  paid: (string | null)[],
): Promise<Table> {
  const p = await billWith(venue, lines, { release });
  const billIds = [p.billId];
  for (const lineNos of moves) {
    const split = await inTx(venue, async (tx) =>
      splitBill(
        tx,
        venue.cfg,
        p.billId,
        lineNos.map((lineNo) => ({
          lineNo,
          quantity: lines[lineNo - 1]!.quantity ?? "1",
        })),
        {
          operatorId: venue.staffId,
          partyId: p.partyId,
          expectedPartyRevision: await partyRevision(p.partyId),
          expectedEdit: await readBillEditState(tx, p.billId),
        },
      ),
    );
    billIds.push(split.billId);
  }
  for (const [index, amount] of paid.entries())
    if (amount !== null) await pay(billIds[index]!, amount);
  return { partyId: p.partyId, billIds };
}

async function bodyFor(t: Table) {
  const bills = await inTx(venue, async (tx) =>
    readFamilyBills(tx, await partyFamily(tx, t.partyId)),
  );
  const expectedEdits = [];
  for (const { id } of bills)
    expectedEdits.push(await inTx(venue, (tx) => readBillEditState(tx, id)));
  expectedEdits.sort((a, b) => a.billId.localeCompare(b.billId));
  return {
    expectedPartyRevision: await partyRevision(t.partyId),
    expectedEdits,
    submissionId: randomUUID(),
  };
}

async function post(partyId: string, body: unknown) {
  const response = await venue.app.request(`/api/parties/${partyId}/finish`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: venue.cookie.staff },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

/** The finish body with `collect` naming every bill the refusal lists, as the till builds it. */
async function collect(partyId: string, body: Awaited<ReturnType<typeof bodyFor>>) {
  const refusal = await post(partyId, { ...body, submissionId: undefined });
  expect(refusal.body).toMatchObject({ error: { code: "party.unserved_dishes" } });
  const dishes = (
    refusal.body as { error: { params: { dishes: { billId: string; billRevision: number }[] } } }
  ).error.params.dishes;
  const bills = new Map(dishes.map((dish) => [dish.billId, dish.billRevision]));
  return {
    ...body,
    collect: {
      bills: [...bills]
        .map(([billId, expectedBillRevision]) => ({ billId, expectedBillRevision }))
        .sort((a, b) => a.billId.localeCompare(b.billId)),
    },
  };
}

async function snapshot(t: Table) {
  const billIds = t.billIds;
  return {
    party: await venue.db.select().from(parties).where(eq(parties.id, t.partyId)),
    tables: await venue.db.select().from(partyTables).where(eq(partyTables.partyId, t.partyId)),
    bills: await venue.db
      .select()
      .from(workingOrders)
      .where(inArray(workingOrders.id, billIds))
      .orderBy(workingOrders.id),
    groups: await venue.db.select().from(orderGroups).orderBy(orderGroups.id),
    tickets: await venue.db
      .select()
      .from(ticketItems)
      .where(inArray(ticketItems.workingOrderId, billIds))
      .orderBy(ticketItems.id),
    lines: await venue.db
      .select()
      .from(workingOrderLines)
      .where(inArray(workingOrderLines.workingOrderId, billIds))
      .orderBy(workingOrderLines.id),
    cancellations: await venue.db
      .select()
      .from(lineServiceCancellations)
      .orderBy(lineServiceCancellations.lineId),
    adjustments: await venue.db.select().from(adjustments).orderBy(adjustments.id),
    commands: await venue.db.select().from(serviceCommands).orderBy(serviceCommands.id),
    jobs: await venue.db.select().from(printJobs).orderBy(printJobs.id),
    sales: await venue.db.select().from(sales).orderBy(sales.id),
    saleLines: await venue.db.select().from(saleLines).orderBy(saleLines.id),
    tenders: await venue.db.select().from(tenders).orderBy(tenders.id),
  };
}

async function billRow(billId: string) {
  const [bill] = await venue.db.select().from(workingOrders).where(eq(workingOrders.id, billId));
  return bill!;
}

async function serveAll(t: Table, billId: string) {
  const lines = await topLines([billId]);
  await inTx(venue, async (tx) =>
    markServed(
      tx,
      venue.cfg,
      t.partyId,
      lines.map((line) => ({ lineId: line.id, quantity: (line.quantity / 1000).toFixed(3) })),
      {
        expectedPartyRevision: await partyRevision(t.partyId),
        operatorId: venue.staffId,
        submissionId: randomUUID(),
      },
    ),
  );
}

describe("finishing a table by sending the food still to come to the counter", () => {
  it("moves the paid bill with food to come to the counter and finishes the table", async () => {
    const t = await table([{ name: "Burger", quantity: "2" }], "fire", [], ["24.00"]);
    const body = await collect(t.partyId, await bodyFor(t));
    const before = await snapshot(t);

    expect(await post(t.partyId, body)).toEqual({ status: 200, body: { state: "closed" } });

    const after = await snapshot(t);
    expect(after.party[0]?.state).toBe("closed");
    expect(after.tables.every((row) => row.leftAt !== null)).toBe(true);
    expect(after.bills[0]).toMatchObject({
      partyId: null,
      revision: before.bills[0]!.revision,
      label: before.bills[0]!.label,
    });
    expect(after.adjustments).toEqual(before.adjustments);
    expect(after.cancellations).toEqual(before.cancellations);
    expect(after.sales).toEqual(before.sales);
    expect(after.saleLines).toEqual(before.saleLines);
    expect(after.tenders).toEqual(before.tenders);
  });

  it("fires a held dish on the way", async () => {
    const t = await table([{ name: "Burger", quantity: "2" }], "hold", [], ["24.00"]);
    const body = await collect(t.partyId, await bodyFor(t));

    expect(await post(t.partyId, body)).toEqual({ status: 200, body: { state: "closed" } });

    const after = await snapshot(t);
    expect(after.bills[0]!.partyId).toBeNull();
    expect(after.tickets.length).toBeGreaterThan(0);
    expect(after.tickets.every((item) => item.firedAt !== null)).toBe(true);
    const groups = after.groups.filter((group) => group.partyId === t.partyId);
    expect(groups.map((group) => group.state)).toEqual(["fired"]);
  });

  it("moves only the bills with food to come", async () => {
    const t = await table(
      [{ name: "Burger" }, { name: "Water" }],
      "fire",
      [[2]],
      ["12.00", "2.00"],
    );
    await serveAll(t, t.billIds[1]!);
    const body = await collect(t.partyId, await bodyFor(t));
    expect(body.collect.bills.map((bill) => bill.billId)).toEqual([t.billIds[0]]);

    expect(await post(t.partyId, body)).toEqual({ status: 200, body: { state: "closed" } });

    expect((await billRow(t.billIds[0]!)).partyId).toBeNull();
    expect((await billRow(t.billIds[1]!)).partyId).toBe(t.partyId);
  });

  it("moves a merged-in party's paid bill", async () => {
    const t = await table([{ name: "Burger" }], "fire", [], ["12.00"]);
    const other = await table([{ name: "Burger" }], "fire", [], ["12.00"]);
    await inTx(venue, (tx) =>
      combineParties(tx, venue.cfg, {
        from: other.partyId,
        into: t.partyId,
        bills: "separate",
        tables: "join",
        operatorId: venue.staffId,
      }),
    );
    const body = await collect(t.partyId, await bodyFor(t));
    expect(body.collect.bills.map((bill) => bill.billId).sort()).toEqual(
      [t.billIds[0], other.billIds[0]].sort(),
    );

    expect(await post(t.partyId, body)).toEqual({ status: 200, body: { state: "closed" } });

    expect((await billRow(t.billIds[0]!)).partyId).toBeNull();
    expect((await billRow(other.billIds[0]!)).partyId).toBeNull();
    expect((await snapshot(t)).party[0]?.state).toBe("closed");
  });

  it("refuses a set changed since it was read without moving anything", async () => {
    const t = await table(
      [{ name: "Burger" }, { name: "Water" }],
      "fire",
      [[2]],
      ["12.00", "2.00"],
    );
    const body = await collect(t.partyId, await bodyFor(t));
    expect(body.collect.bills).toHaveLength(2);
    await serveAll(t, t.billIds[1]!);
    const fresh = { ...body, expectedPartyRevision: await partyRevision(t.partyId) };
    const before = await snapshot(t);

    const answer = await post(t.partyId, fresh);

    expect(answer.status).toBe(409);
    expect(answer.body).toMatchObject({ error: { code: "party.unserved_dishes" } });
    expect(await snapshot(t)).toEqual(before);
  });

  it.each(["revision", "extra", "missing"] as const)(
    "refuses a collection with a %s bill without moving anything",
    async (fault) => {
      const t = await table(
        [{ name: "Burger" }, { name: "Water" }],
        "fire",
        [[2]],
        ["12.00", "2.00"],
      );
      const body = await collect(t.partyId, await bodyFor(t));
      if (fault === "revision") body.collect.bills[0]!.expectedBillRevision += 1;
      if (fault === "extra")
        body.collect.bills.push({ billId: randomUUID(), expectedBillRevision: 0 });
      if (fault === "missing") body.collect.bills.pop();
      const before = await snapshot(t);

      const answer = await post(t.partyId, body);

      expect(answer.status).toBe(409);
      expect(answer.body).toMatchObject({ error: { code: "party.unserved_dishes" } });
      expect(await snapshot(t)).toEqual(before);
    },
  );

  it("replays the same collection", async () => {
    const t = await table([{ name: "Burger" }], "fire", [], ["12.00"]);
    const body = await collect(t.partyId, await bodyFor(t));
    const answer = await post(t.partyId, body);
    expect(answer).toEqual({ status: 200, body: { state: "closed" } });
    const after = await snapshot(t);

    expect(await post(t.partyId, body)).toEqual(answer);
    expect(await snapshot(t)).toEqual(after);
  });

  it("refuses the same submission with other bills", async () => {
    const t = await table(
      [{ name: "Burger" }, { name: "Water" }],
      "fire",
      [[2]],
      ["12.00", "2.00"],
    );
    const body = await collect(t.partyId, await bodyFor(t));
    expect(await post(t.partyId, body)).toEqual({ status: 200, body: { state: "closed" } });
    const after = await snapshot(t);

    const answer = await post(t.partyId, {
      ...body,
      collect: { bills: body.collect.bills.slice(0, 1) },
    });

    expect(answer.status).toBe(409);
    expect(answer.body).toMatchObject({ error: { code: "submission.id_reused" } });
    expect(await snapshot(t)).toEqual(after);
  });

  it("fingerprints the bills by value, not by the order they were sent", async () => {
    const t = await table(
      [{ name: "Burger" }, { name: "Water" }],
      "fire",
      [[2]],
      ["12.00", "2.00"],
    );
    const body = await collect(t.partyId, await bodyFor(t));
    const answer = await post(t.partyId, body);
    expect(answer).toEqual({ status: 200, body: { state: "closed" } });

    expect(
      await post(t.partyId, { ...body, collect: { bills: [...body.collect.bills].reverse() } }),
    ).toEqual(answer);
  });

  it.each([
    ["collect", (body: Record<string, unknown>) => ({ ...body, cancellations: [] })],
    [
      "approver",
      (body: Record<string, unknown>) => ({
        ...body,
        approver: { personId: randomUUID(), pin: "1234" },
      }),
    ],
    ["submissionId", (body: Record<string, unknown>) => ({ ...body, submissionId: undefined })],
    ["collect", (body: Record<string, unknown>) => ({ ...body, collect: { bills: [] } })],
    [
      "collect",
      (body: Record<string, unknown>) => {
        const bills = (body.collect as { bills: unknown[] }).bills;
        return { ...body, collect: { bills: [bills[0], bills[0]] } };
      },
    ],
    ["collect", (body: Record<string, unknown>) => ({ ...body, collect: [] })],
    [
      "billId",
      (body: Record<string, unknown>) => ({
        ...body,
        collect: { bills: [{ billId: "nope", expectedBillRevision: 0 }] },
      }),
    ],
  ])("refuses a collection in the wrong shape, naming %s", async (field, change) => {
    const t = await table([{ name: "Burger" }], "fire", [], ["12.00"]);
    const body = await collect(t.partyId, await bodyFor(t));
    const before = await snapshot(t);

    const answer = await post(t.partyId, change(body));

    expect(answer.status).toBe(400);
    expect(answer.body).toMatchObject({
      error: { code: "management.request_invalid", params: { field } },
    });
    expect(await snapshot(t)).toEqual(before);
  });

  it("keeps the outstanding bill refusal first", async () => {
    const t = await table([{ name: "Burger" }], "fire", [], [null]);
    const body = {
      ...(await bodyFor(t)),
      collect: { bills: [{ billId: t.billIds[0]!, expectedBillRevision: 0 }] },
    };
    const before = await snapshot(t);

    expect(await post(t.partyId, body)).toMatchObject({
      status: 409,
      body: { error: { code: "party.bill_outstanding" } },
    });
    expect(await snapshot(t)).toEqual(before);
  });

  it("leaves a bill whose food to come has no kitchen ticket with the party", async () => {
    const t = await table(
      [{ name: "Burger" }, { name: "Coffee" }],
      "fire",
      [[2]],
      ["12.00", "1.50"],
    );
    // Coffee is routed to no preparation, so its bill has nothing for a kitchen to send.
    expect(await snapshot({ ...t, billIds: [t.billIds[1]!] })).toMatchObject({ tickets: [] });
    const body = await collect(t.partyId, await bodyFor(t));
    expect(body.collect.bills).toHaveLength(2);

    expect(await post(t.partyId, body)).toEqual({ status: 200, body: { state: "closed" } });

    expect((await billRow(t.billIds[0]!)).partyId).toBeNull();
    expect((await billRow(t.billIds[1]!)).partyId).toBe(t.partyId);
    const waiting = await listCounterWaiting({ db: venue.db }, venue.cfg);
    expect(waiting.map((order) => order.id)).toContain(t.billIds[0]);
    expect(waiting.map((order) => order.id)).not.toContain(t.billIds[1]);
  });

  it("refuses a collection with no kitchen work", async () => {
    const t = await table([{ name: "Coffee" }], "fire", [], ["1.50"]);
    const body = await collect(t.partyId, await bodyFor(t));
    const before = await snapshot(t);

    const answer = await post(t.partyId, body);

    expect(answer.status).toBe(400);
    expect(answer.body).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "collect" } },
    });
    expect(await snapshot(t)).toEqual(before);
  });
});
