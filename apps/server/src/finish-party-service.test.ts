import { testTradingAdmission } from "./testing/trading-admission.js";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  lineServiceCancellations,
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
  withTransaction,
} from "@waitron/db";
import { adjustments } from "@waitron/adjustments";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { readBillEditState } from "./bill-editing.js";
import { advanceTicketItem, markServed } from "./working-order.js";
import { readCancellationContext } from "./line-cancel-context.js";
import { fireGroup } from "./order-groups.js";
import { printedLines } from "./testing/decode-ticket.js";
import { setStationsWaitForPass } from "./testing/pass-waiting.js";
import { combineParties } from "./testing/table-action-fixture.js";
import {
  watchDerivationsAndLock,
  watchedDerivationCount,
  watchedOrder,
} from "./testing/watched-scrypt.js";

vi.mock("node:crypto", async (importOriginal) =>
  (await import("./testing/watched-scrypt.js")).watchedCrypto(await importOriginal()),
);
afterEach(async () => {
  await watchedOrder();
  vi.restoreAllMocks();
});
import { payWorkingOrder } from "./testing/whole-payment-fixture.js";
import {
  billWith,
  inTx,
  placeGrouped,
  provisionAdjustmentVenue,
  rowsOf,
  type AdjustmentVenue,
  PINS,
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

async function fixture(paid = true, release: "hold" | "fire" = "hold", extras = false) {
  const p = await billWith(
    venue,
    [
      extras ? { name: "Pizza", quantity: "2", olives: 2 } : { name: "Burger", quantity: "2" },
      { name: "Water" },
    ],
    { release, shape: "grouped" },
  );
  if (paid)
    await payWorkingOrder(
      {
        admission: testTradingAdmission(),
        db: venue.db,
        backend: venue.backend,
        clock: venue.clock,
      },
      venue.cfg,
      {
        id: p.billId,
        tender: { method: "cash", amount: "26.00" },
        lines: [],
      },
    );
  const [party] = await venue.db.select().from(parties).where(eq(parties.id, p.partyId));
  return {
    ...p,
    lines: await rowsOf(venue, p.billId),
    body: {
      expectedPartyRevision: party!.revision,
      expectedEdits: [await inTx(venue, (tx) => readBillEditState(tx, p.billId))],
      submissionId: randomUUID(),
    },
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

async function post(p: Fixture, body: unknown = p.body, cookie = venue.cookie.staff) {
  const response = await venue.app.request(`/api/parties/${p.partyId}/finish`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function snapshot(p: Fixture) {
  return {
    party: await venue.db.select().from(parties).where(eq(parties.id, p.partyId)),
    tables: await venue.db.select().from(partyTables).where(eq(partyTables.partyId, p.partyId)),
    bill: await venue.db.select().from(workingOrders).where(eq(workingOrders.id, p.billId)),
    tickets: await venue.db
      .select()
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderId, p.billId)),
    lines: await venue.db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, p.billId)),
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

async function confirm(p: Fixture) {
  const [bill] = await venue.db.select().from(workingOrders).where(eq(workingOrders.id, p.billId));
  const cancellations = [];
  for (const line of p.lines.filter((line) => line.parentLineId === null))
    cancellations.push({
      lineId: line.id,
      quantity: line.quantity,
      expectedBillRevision: bill!.revision,
      expectedContext: await readCancellationContext(venue.db, p.partyId, line.id),
      reasonId: venue.reasonId.houseVoid,
    });
  return { ...p.body, cancellations };
}

describe("finishing paid food service", () => {
  it("refuses to silently close a paid table with held dishes and returns every dish", async () => {
    const p = await fixture();
    const before = await snapshot(p);
    const answer = await post(p);
    expect(answer.status).toBe(409);
    expect(answer.body).toMatchObject({
      error: {
        code: "party.unserved_dishes",
        params: {
          partyId: p.partyId,
          dishes: [
            { billId: p.billId, lineId: p.lines[0]!.id, name: "Burger", quantity: "2.000" },
            { billId: p.billId, lineId: p.lines[1]!.id, name: "Water", quantity: "1.000" },
          ],
        },
      },
    });
    expect(await snapshot(p)).toEqual(before);
  });

  it("cancels every confirmed dish and closes once, retaining the filed money on replay", async () => {
    const p = await fixture();
    const body = await confirm(p);
    const before = await snapshot(p);
    expect(await post(p, body)).toEqual({ status: 200, body: { state: "closed" } });
    const after = await snapshot(p);
    expect(after.party[0]?.state).toBe("closed");
    expect(after.tables.every((row) => row.leftAt !== null)).toBe(true);
    expect(after.tickets).toEqual([]);
    expect(after.cancellations.find((row) => row.lineId === p.lines[0]!.id)).toMatchObject({
      quantity: 2000,
      wasStarted: false,
    });
    expect(after.cancellations.find((row) => row.lineId === p.lines[1]!.id)).toMatchObject({
      quantity: 1000,
      wasStarted: false,
    });
    expect(after.adjustments.filter((row) => row.workingOrderId === p.billId)).toHaveLength(2);
    expect(after.adjustments.find((row) => row.lineId === p.lines[0]!.id)).toMatchObject({
      action: "cancel",
      beforeAmount: 2400,
      afterAmount: 2400,
      reduction: 0,
      nominalValue: 2400,
      requestedBy: venue.staffId,
      approvedBy: null,
    });
    expect(after.sales).toEqual(before.sales);
    expect(after.saleLines).toEqual(before.saleLines);
    expect(after.tenders).toEqual(before.tenders);
    expect(await post(p, body)).toEqual({ status: 200, body: { state: "closed" } });
    expect(await snapshot(p)).toEqual(after);
  });

  it.each(["missing", "duplicate", "extra", "quantity"])(
    "refuses a %s dish confirmation without cancelling anything",
    async (fault) => {
      const p = await fixture();
      const body = await confirm(p);
      if (fault === "missing") body.cancellations.pop();
      if (fault === "duplicate") body.cancellations[1] = body.cancellations[0]!;
      if (fault === "extra")
        body.cancellations.push({ ...body.cancellations[0]!, lineId: randomUUID() });
      if (fault === "quantity") body.cancellations[0]!.quantity = "1.000";
      const before = await snapshot(p);
      const answer = await post(p, body);
      expect(answer.status).toBe(409);
      expect(answer.body).toMatchObject({ error: { code: "party.unserved_dishes" } });
      expect(await snapshot(p)).toEqual(before);
    },
  );

  it("rolls back earlier dish cancellations if a later reason is refused", async () => {
    const p = await fixture();
    const body = await confirm(p);
    body.cancellations[1]!.reasonId = randomUUID();
    const before = await snapshot(p);
    const answer = await post(p, body);
    expect(answer.status).toBe(400);
    expect(answer.body).toMatchObject({ error: { code: "adjustment_reason.not_found" } });
    expect(await snapshot(p)).toEqual(before);
  });

  it("keeps the outstanding bill refusal ahead of the food confirmation", async () => {
    const p = await fixture(false);
    const before = await snapshot(p);
    expect(await post(p, await confirm(p))).toMatchObject({
      status: 409,
      body: { error: { code: "party.bill_outstanding" } },
    });
    expect(await snapshot(p)).toEqual(before);
  });

  it("lists only the unserved remainder and retains served food when finishing", async () => {
    const p = await fixture(true, "fire");
    await inTx(venue, (tx) =>
      markServed(
        tx,
        venue.cfg,
        p.partyId,
        [
          { lineId: p.lines[0]!.id, quantity: "1" },
          { lineId: p.lines[1]!.id, quantity: "1" },
        ],
        {
          expectedPartyRevision: p.body.expectedPartyRevision,
          operatorId: venue.staffId,
          submissionId: randomUUID(),
        },
      ),
    );
    const [party] = await venue.db.select().from(parties).where(eq(parties.id, p.partyId));
    p.body.expectedPartyRevision = party!.revision;
    const answer = await post(p);
    expect(answer.body).toMatchObject({
      error: {
        code: "party.unserved_dishes",
        params: { dishes: [{ lineId: p.lines[0]!.id, quantity: "1.000" }] },
      },
    });
    expect(answer.body.error.params.dishes).toHaveLength(1);
    const body = await confirm(p);
    body.cancellations = [body.cancellations[0]!];
    body.cancellations[0]!.quantity = "1.000";
    expect(await post(p, body)).toMatchObject({ status: 200 });
    const after = await snapshot(p);
    expect(after.lines.map((row) => row.servedQuantity)).toEqual([1000, 1000]);
    expect(after.cancellations.find((row) => row.lineId === p.lines[0]!.id)?.quantity).toBe(1000);
  });

  it("re-prompts when the kitchen changed after confirmation, before any cancellation", async () => {
    const p = await fixture(true, "fire");
    const body = await confirm(p);
    const [ticket] = await venue.db
      .select()
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderLineId, p.lines[1]!.id));
    await inTx(venue, (tx) => advanceTicketItem(tx, venue.cfg, ticket!.id, "preparing"));
    const before = await snapshot(p);
    expect(await post(p, body)).toMatchObject({
      status: 409,
      body: { error: { code: "party.unserved_dishes" } },
    });
    expect(await snapshot(p)).toEqual(before);
  });

  it("requires the preparation answer for fired food that the kitchen has not started", async () => {
    const p = await fixture(true, "fire");
    const before = await snapshot(p);
    expect(await post(p, await confirm(p))).toMatchObject({
      status: 400,
      body: {
        error: { code: "management.request_invalid", params: { field: "preparationStarted" } },
      },
    });
    expect(await snapshot(p)).toEqual(before);
  });

  it.each([false, true])(
    "records the explicit preparation answer %s when finishing fired food",
    async (preparationStarted) => {
      const p = await fixture(true, "fire");
      const body = await confirm(p);
      expect(
        await post(p, {
          ...body,
          cancellations: body.cancellations.map((item) => ({ ...item, preparationStarted })),
        }),
      ).toMatchObject({ status: 200 });
      const after = await snapshot(p);
      expect(after.cancellations.find((row) => row.lineId === p.lines[0]!.id)?.wasStarted).toBe(
        preparationStarted,
      );
    },
  );

  it("requires refund permission before cancelling any dish for a refund handoff", async () => {
    const p = await fixture();
    const body = await confirm(p);
    const before = await snapshot(p);
    expect(
      await post(p, {
        ...body,
        cancellations: body.cancellations.map((item) => ({ ...item, refundHandoff: true })),
      }),
    ).toMatchObject({ status: 403, body: { error: { code: "authorization.not_permitted" } } });
    expect(await snapshot(p)).toEqual(before);
  });

  it("accepts the refund approver PIN and preserves the independent payment refund", async () => {
    const p = await fixture();
    const body = await confirm(p);
    const before = await snapshot(p);
    expect(
      await post(p, {
        ...body,
        approver: { personId: venue.managerId, pin: PINS.manager },
        cancellations: body.cancellations.map((item) => ({ ...item, refundHandoff: true })),
      }),
    ).toMatchObject({ status: 200 });
    const after = await snapshot(p);
    expect(after.tenders).toEqual(before.tenders);
    expect(after.sales).toEqual(before.sales);
    expect(after.saleLines).toEqual(before.saleLines);
    expect(JSON.stringify(after.commands)).not.toContain(`"${PINS.manager}"`);
  });

  it("records no refund approver whose PIN was never checked", async () => {
    const p = await fixture();
    const body = await confirm(p);
    const answer = await post(
      p,
      {
        ...body,
        approver: { personId: venue.staffId, pin: "9999" },
        cancellations: body.cancellations.map((item) => ({ ...item, refundHandoff: true })),
      },
      venue.cookie.manager,
    );
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    const rows = (await snapshot(p)).adjustments.filter(
      (row) => row.workingOrderId === p.billId && row.action === "cancel",
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row).toMatchObject({ refundHandoff: true, approvedBy: null });
  });

  it("answers a link for each handed-off dish and none for the others", async () => {
    const p = await fixture();
    const confirmed = await confirm(p);
    const body = {
      ...confirmed,
      approver: { personId: venue.managerId, pin: PINS.manager },
      cancellations: confirmed.cancellations.map((item, index) =>
        index === 0 ? { ...item, refundHandoff: true } : item,
      ),
    };
    const answer = await post(p, body);
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    const rows = (await snapshot(p)).adjustments.filter((row) => row.workingOrderId === p.billId);
    const burger = rows.find((row) => row.lineId === p.lines[0]!.id)!;
    const water = rows.find((row) => row.lineId === p.lines[1]!.id)!;
    expect(answer.body).toEqual({
      state: "closed",
      refundLinks: [{ lineId: p.lines[0]!.id, adjustmentId: burger.id }],
    });
    expect(burger).toMatchObject({ refundHandoff: true, approvedBy: venue.managerId });
    expect(water).toMatchObject({ refundHandoff: false, approvedBy: null });
    expect(await post(p, body)).toEqual(answer);
  });

  it("cancels paid dishes from every merged party bill without reassigning filed money", async () => {
    const p = await fixture();
    const other = await fixture();
    await inTx(venue, (tx) =>
      combineParties(tx, venue.cfg, {
        from: other.partyId,
        into: p.partyId,
        tables: "join",
        operatorId: venue.staffId,
      }),
    );
    const [party] = await venue.db.select().from(parties).where(eq(parties.id, p.partyId));
    p.body.expectedPartyRevision = party!.revision;
    p.body.expectedEdits.push(await inTx(venue, (tx) => readBillEditState(tx, other.billId)));
    p.body.expectedEdits.sort((a, b) => a.billId.localeCompare(b.billId));
    const one = await confirm(p);
    const two = await confirm(other);
    const before = await snapshot(p);
    const answer = await post(p, {
      ...one,
      cancellations: [...one.cancellations, ...two.cancellations],
    });
    expect(answer, JSON.stringify(answer)).toMatchObject({
      status: 200,
      body: { state: "closed" },
    });
    const after = await snapshot(p);
    for (const line of [...p.lines, ...other.lines])
      expect(after.cancellations.some((row) => row.lineId === line.id)).toBe(true);
    expect(after.sales).toEqual(before.sales);
    expect(after.saleLines).toEqual(before.saleLines);
  });

  it("compares a dish's extras and replayed dish list by values regardless of order", async () => {
    const p = await fixture(true, "hold", true);
    const body = await confirm(p);
    body.cancellations[0]!.expectedContext.components.reverse();
    expect(await post(p, body)).toMatchObject({ status: 200 });
    const after = await snapshot(p);
    expect(after.tickets).toEqual([]);
    body.cancellations.reverse();
    body.cancellations[1]!.expectedContext.components.reverse();
    expect(await post(p, body)).toEqual({ status: 200, body: { state: "closed" } });
    expect(await snapshot(p)).toEqual(after);
  });

  it("finishes without confirmation once every paid dish has been served", async () => {
    const p = await fixture(true, "fire");
    const served = await inTx(venue, (tx) =>
      markServed(
        tx,
        venue.cfg,
        p.partyId,
        [
          { lineId: p.lines[0]!.id, quantity: "2" },
          { lineId: p.lines[1]!.id, quantity: "1" },
        ],
        {
          expectedPartyRevision: p.body.expectedPartyRevision,
          operatorId: venue.staffId,
          submissionId: randomUUID(),
        },
      ),
    );
    p.body.expectedPartyRevision = served.revision;
    const before = await snapshot(p);
    expect(await post(p)).toEqual({ status: 200, body: { state: "closed" } });
    const after = await snapshot(p);
    expect(after.cancellations).toEqual(before.cancellations);
    expect(after.adjustments).toEqual(before.adjustments);
    expect(after.tenders).toEqual(before.tenders);
  });

  it.each(["approved", "wrong-pin"])(
    "derives a %s refund approval outside the write transaction",
    async (mode) => {
      const p = await fixture();
      const body = await confirm(p);
      const pin = mode === "approved" ? PINS.manager : "9999";
      const before = await snapshot(p);
      watchDerivationsAndLock(
        venue.db,
        pin,
        () => withTransaction(venue.db, async () => {}),
        () => withTransaction(venue.db, async () => {}),
      );
      const answer = await post(p, {
        ...body,
        approver: { personId: venue.managerId, pin },
        cancellations: body.cancellations.map((item) => ({ ...item, refundHandoff: true })),
      });
      if (mode === "wrong-pin") {
        expect(answer).toMatchObject({ status: 401, body: { error: { code: "pin.invalid" } } });
        expect(await snapshot(p)).toEqual(before);
      } else {
        expect(answer).toMatchObject({ status: 200 });
        expect(await watchedOrder()).toEqual(["writer", "derived"]);
        expect(watchedDerivationCount()).toBe(1);
      }
    },
  );

  it.each([
    ["cancellations", null],
    ["cancellations", {}],
    ["submissionId", null],
    ["submissionId", ""],
    ["submissionId", "x".repeat(201)],
  ])("refuses malformed %s before finishing", async (field, value) => {
    const p = await fixture();
    const before = await snapshot(p);
    expect(await post(p, { ...(await confirm(p)), [field as string]: value })).toMatchObject({
      status: 400,
      body: { error: { code: "management.request_invalid", params: { field } } },
    });
    expect(await snapshot(p)).toEqual(before);
  });
});

describe("A773 requested lifecycle", () => {
  /** Kitchen names, which the station's slips print, of the four dishes in line order. */
  const KITCHEN = ["GREENS", "BURG", "RIBEYE", "LOAF"];

  /**
   * A paid party with a held Salad, then a Burger fired at a station that waits for the pass when
   * `waiting` (Requested; otherwise released and queued), a released queued Steak and a released
   * Bread advanced to ready, each in its own group.
   */
  async function everyPhase(waiting: boolean) {
    const order = await billWith(venue, [{ name: "Salad" }], { release: "hold", shape: "grouped" });
    const seated = { partyId: order.partyId, tabId: order.billId };
    const place = (name: string) =>
      inTx(venue, (tx) =>
        placeGrouped(
          tx,
          venue.cfg,
          seated,
          [{ menuItemId: venue.item(name), quantity: "1" }],
          "fire",
          venue.staffId,
        ),
      );
    if (waiting) await inTx(venue, (tx) => setStationsWaitForPass(tx, true, [venue.stationId]));
    try {
      await place("Burger");
    } finally {
      if (waiting) await inTx(venue, (tx) => setStationsWaitForPass(tx, false, [venue.stationId]));
    }
    await place("Steak");
    await place("Bread");
    const lines = await rowsOf(venue, order.billId);
    const [bread] = await venue.db
      .select()
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderLineId, lines[3]!.id));
    await inTx(venue, (tx) => advanceTicketItem(tx, venue.cfg, bread!.id, "preparing"));
    await inTx(venue, (tx) => advanceTicketItem(tx, venue.cfg, bread!.id, "ready"));
    await payWorkingOrder(
      {
        admission: testTradingAdmission(),
        db: venue.db,
        backend: venue.backend,
        clock: venue.clock,
      },
      venue.cfg,
      { id: order.billId, tender: { method: "cash", amount: "49.50" }, lines: [] },
    );
    const [party] = await venue.db.select().from(parties).where(eq(parties.id, order.partyId));
    const p: Fixture = {
      ...order,
      lines,
      body: {
        expectedPartyRevision: party!.revision,
        expectedEdits: [await inTx(venue, (tx) => readBillEditState(tx, order.billId))],
        submissionId: randomUUID(),
      },
    };
    const confirmed = await confirm(p);
    return {
      p,
      body: {
        ...confirmed,
        approver: { personId: venue.managerId, pin: PINS.manager },
        cancellations: confirmed.cancellations.map((item) => ({
          ...item,
          refundHandoff: true,
          // Only released dishes the kitchen has not started need the answer.
          ...(item.expectedContext.components.some((c) => c.firedAt !== null) &&
          item.expectedContext.stage === "not_started"
            ? { preparationStarted: false }
            : {}),
        })),
      },
    };
  }

  /** Finish `body`, answering the jobs it printed as the kitchen names each one carries. */
  async function finishPrinting(p: Fixture, body: unknown) {
    const before = new Set((await snapshot(p)).jobs.map((job) => job.id));
    const answer = await post(p, body);
    const printed = (await snapshot(p)).jobs
      .filter((job) => !before.has(job.id))
      // A slip's table, party number and time differ between two parties.
      .map((job) =>
        printedLines(job.payload).map((line) =>
          line.replace(/^M-[0-9a-f]{8}$|^\d+$|^\d\d:\d\d$/, "<varies>"),
        ),
      );
    const byDish = KITCHEN.map((name) =>
      printed.filter((lines) => lines.some((line) => line.includes(name))),
    );
    return { answer, printed, byDish };
  }

  it("finishes held, Requested, waiting and ready dishes in one Finish", async () => {
    const twin = await everyPhase(false);
    const { p, body } = await everyPhase(true);
    const burger = body.cancellations[1]!.expectedContext;
    expect(burger.components).toMatchObject([
      { lineId: p.lines[1]!.id, firedAt: null, requestedAt: expect.any(String) },
    ]);
    expect(body.cancellations[1]).not.toHaveProperty("preparationStarted");
    for (const item of body.cancellations)
      for (const component of item.expectedContext.components) {
        expect(component).toHaveProperty("requestedAt");
        expect(component.stationId).toBe(venue.stationId);
      }

    const control = await finishPrinting(twin.p, twin.body);
    const result = await finishPrinting(p, body);
    expect(control.answer.status, JSON.stringify(control.answer.body)).toBe(200);
    expect(result.answer.status, JSON.stringify(result.answer.body)).toBe(200);
    expect(result.answer.body.state).toBe("closed");

    const positions = (links: { lineId: string }[], lines: Fixture["lines"]) =>
      links.map((link) => lines.findIndex((line) => line.id === link.lineId));
    expect(positions(result.answer.body.refundLinks, p.lines)).toEqual(
      positions(control.answer.body.refundLinks, twin.p.lines),
    );
    expect(result.answer.body.refundLinks).toHaveLength(4);

    const after = await snapshot(p);
    expect(after.party[0]?.state).toBe("closed");
    expect(after.tickets).toEqual([]);
    for (const line of p.lines)
      expect(after.cancellations.find((row) => row.lineId === line.id)).toMatchObject({
        quantity: 1000,
      });
    const cancels = after.adjustments.filter(
      (row) => row.workingOrderId === p.billId && row.action === "cancel",
    );
    expect(cancels).toHaveLength(4);
    for (const row of cancels) expect(row).toMatchObject({ reduction: 0, refundHandoff: true });
    // Matched by line position; ids and times differ between the two parties.
    const byPosition = (rows: typeof cancels, lines: Fixture["lines"]) =>
      lines.map((line) => {
        const row = rows.find((candidate) => candidate.lineId === line.id)!;
        const { id, workingOrderId, lineId, createdAt, stage, ...kept } = row;
        void [id, workingOrderId, lineId, createdAt];
        return { stage, kept };
      });
    const twinCancels = byPosition(
      (await snapshot(twin.p)).adjustments.filter(
        (row) => row.workingOrderId === twin.p.billId && row.action === "cancel",
      ),
      twin.p.lines,
    );
    const ownCancels = byPosition(cancels, p.lines);
    expect(ownCancels.map((row) => row.kept)).toEqual(twinCancels.map((row) => row.kept));
    expect(ownCancels.map((row) => row.stage)).toEqual([
      twinCancels[0]!.stage,
      "unsent",
      twinCancels[2]!.stage,
      twinCancels[3]!.stage,
    ]);
    expect(twinCancels[1]!.stage).toBe("fired");

    expect(result.byDish[1]).toEqual([]);
    expect(control.byDish[1]).toHaveLength(1);
    for (const index of [0, 2, 3])
      expect(result.byDish[index], KITCHEN[index]).toEqual(control.byDish[index]);
    expect(result.printed).toHaveLength(3);
  });

  it("refuses a Finish confirmed while a dish was held once its group became Requested", async () => {
    const p = await fixture();
    const body = await confirm(p);
    await inTx(venue, (tx) => setStationsWaitForPass(tx, true, [venue.stationId]));
    try {
      await inTx(venue, (tx) =>
        fireGroup(tx, venue.cfg, p.partyId, p.lines[0]!.groupId!, {
          submissionId: randomUUID(),
          expectedPartyRevision: p.body.expectedPartyRevision,
          operatorId: venue.staffId,
        }),
      );
    } finally {
      await inTx(venue, (tx) => setStationsWaitForPass(tx, false, [venue.stationId]));
    }
    const [burger] = await venue.db
      .select()
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderLineId, p.lines[0]!.id));
    expect(burger).toMatchObject({ requestedAt: expect.any(String), firedAt: null });
    // Everything but the dish contexts is read again, so only a context can refuse.
    const [party] = await venue.db.select().from(parties).where(eq(parties.id, p.partyId));
    const [bill] = await venue.db
      .select()
      .from(workingOrders)
      .where(eq(workingOrders.id, p.billId));
    const stale = {
      ...body,
      expectedPartyRevision: party!.revision,
      expectedEdits: [await inTx(venue, (tx) => readBillEditState(tx, p.billId))],
      cancellations: body.cancellations.map((item) => ({
        ...item,
        expectedBillRevision: bill!.revision,
      })),
    };
    const before = await snapshot(p);
    expect(await post(p, stale)).toMatchObject({
      status: 409,
      body: { error: { code: "party.unserved_dishes" } },
    });
    expect(await snapshot(p)).toEqual(before);
  });
});
