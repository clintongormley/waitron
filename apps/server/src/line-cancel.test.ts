import { readBillEditState } from "./bill-editing.js";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { adjustments, createAdjustmentReason } from "@waitron/adjustments";
import { attendanceOperationFacts } from "@waitron/workforce";
import { recordAttendanceFact } from "./attendance-capture.js";
import {
  lineServiceCancellations,
  billPayments,
  parties,
  printJobs,
  sales,
  saleLines,
  tenders,
  serviceCommands,
  ticketItems,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { listStationNotices, setRoutingCell, writePrintHeldWork } from "@waitron/venue-service";
import { readCancellationContext } from "./line-cancel-context.js";
import { cancelItem, type CancelItemAsk } from "./line-cancel.js";
import { createStation } from "./kitchen.js";
import { advanceTicketItem } from "./working-order.js";
import { payWorkingOrder } from "./testing/whole-payment-fixture.js";
import { printedLines } from "./testing/decode-ticket.js";
import { recallToDraft } from "./draft-recall.js";
import {
  billWith,
  inTx,
  provisionAdjustmentVenue,
  PINS,
  type AdjustmentVenue,
} from "./testing/adjustment-venue.js";

let venue: AdjustmentVenue;
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionAdjustmentVenue(db);
    await inTx(venue, async (tx) => {
      const station = await createStation(tx, venue.cfg, { name: "Extra preparation" });
      await setRoutingCell(
        tx,
        venue.cfg,
        { row: { kind: "product", productId: venue.olivesId }, zoneId: null },
        { kind: "station", stationId: station.id },
      );
    });
  },
});

async function fixture(release: "fire" | "hold" = "fire", name = "Pizza", quantity = "3") {
  const order = await billWith(
    venue,
    [{ name, quantity, ...(name === "Pizza" ? { olives: 2 } : {}) }],
    { release },
  );
  return inTx(venue, async (tx) => {
    const lines = await tx
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, order.billId))
      .orderBy(workingOrderLines.lineNo);
    const tickets = await tx
      .select()
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderId, order.billId));
    return { ...order, parent: lines[0]!, extra: lines[1], tickets };
  });
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

async function askFor(
  order: Fixture,
  outcome: CancelItemAsk["outcome"] = "keep_charge",
  quantity = "2",
): Promise<CancelItemAsk> {
  return inTx(venue, async (tx) => {
    const [party] = await tx.select().from(parties).where(eq(parties.id, order.partyId));
    const [bill] = await tx.select().from(workingOrders).where(eq(workingOrders.id, order.billId));
    return {
      quantity,
      expectedEdit: await readBillEditState(tx, order.billId),
      outcome,
      expectedPartyRevision: party!.revision,
      expectedBillRevision: bill!.revision,
      expectedContext: await readCancellationContext(tx, order.partyId, order.parent.id),
      submissionId: randomUUID(),
    };
  });
}
function cancel(order: Fixture, ask: CancelItemAsk) {
  return inTx(venue, (tx) =>
    cancelItem(tx, venue.cfg, order.partyId, order.parent.id, ask, venue.staffId),
  );
}
async function snapshot(order: Fixture) {
  return inTx(venue, async (tx) => ({
    bill: await tx.select().from(workingOrders).where(eq(workingOrders.id, order.billId)),
    party: await tx.select().from(parties).where(eq(parties.id, order.partyId)),
    lines: await tx
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, order.billId))
      .orderBy(workingOrderLines.lineNo),
    tickets: await tx
      .select()
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderId, order.billId)),
    cancellations: await tx
      .select()
      .from(lineServiceCancellations)
      .where(eq(lineServiceCancellations.lineId, order.parent.id)),
    commands: await tx
      .select()
      .from(serviceCommands)
      .where(eq(serviceCommands.scopeId, order.partyId)),
    adjustments: await tx
      .select()
      .from(adjustments)
      .where(eq(adjustments.workingOrderId, order.billId)),
  }));
}
async function startExtra(order: Fixture) {
  const ticket = order.tickets.find((row) => row.workingOrderLineId === order.extra!.id)!;
  await inTx(venue, (tx) => advanceTicketItem(tx, venue.cfg, ticket.id, "preparing"));
}

describe("Cancel item service command", () => {
  it("keeps fired food charged when the waiter confirms preparation has started", async () => {
    const order = await fixture();
    const ask = { ...(await askFor(order)), preparationStarted: true };
    const before = await snapshot(order);
    await cancel(order, ask);
    const after = await snapshot(order);
    expect(after.lines).toEqual(before.lines);
    expect(after.cancellations).toMatchObject([{ quantity: 2000, wasStarted: true }]);
    expect(after.tickets.map((row) => row.quantity).sort()).toEqual([1000, 2000]);
    const notices = [];
    for (const station of new Set(order.tickets.map((row) => row.stationId)))
      notices.push(...(await inTx(venue, (tx) => listStationNotices(tx, venue.cfg, station))));
    expect(notices.filter((row) => row.workingOrderId === order.billId)).toMatchObject([
      { quantity: "2.000", wasStarted: true },
      { quantity: "4.000", wasStarted: true },
    ]);
    await cancel(order, ask);
    expect(await snapshot(order)).toEqual(after);
    await expect(cancel(order, { ...ask, preparationStarted: false })).rejects.toMatchObject({
      code: "submission.id_reused",
    });
    expect(await snapshot(order)).toEqual(after);
  });

  it("requires the started cancellation reason after a fired preparation Yes", async () => {
    const order = await fixture();
    const ask = { ...(await askFor(order, "remove_charge")), preparationStarted: true };
    const before = await snapshot(order);
    await expect(cancel(order, ask)).rejects.toMatchObject({
      code: "management.request_invalid",
      params: { field: "reasonId" },
    });
    expect(await snapshot(order)).toEqual(before);
    await cancel(order, { ...ask, reasonId: venue.reasonId.house });
    const after = await snapshot(order);
    expect(after.lines.map((row) => ({ quantity: row.quantity, total: row.lineTotal }))).toEqual([
      { quantity: 1000, total: 900 },
      { quantity: 2000, total: 300 },
    ]);
    expect(after.adjustments).toMatchObject([{ action: "cancel", reasonId: venue.reasonId.house }]);
    const notices = [];
    for (const station of new Set(order.tickets.map((row) => row.stationId)))
      notices.push(...(await inTx(venue, (tx) => listStationNotices(tx, venue.cfg, station))));
    expect(notices.filter((row) => row.workingOrderId === order.billId)).toMatchObject([
      { quantity: "2.000", wasStarted: true },
      { quantity: "4.000", wasStarted: true },
    ]);
  });

  it("does not turn held food into started food from a supplied answer", async () => {
    const order = await fixture("hold");
    const before = await snapshot(order);
    await expect(
      cancel(order, { ...(await askFor(order)), preparationStarted: true }),
    ).rejects.toMatchObject({
      code: "management.request_invalid",
      params: { field: "preparationStarted" },
    });
    expect(await snapshot(order)).toEqual(before);
  });

  it("does not use preparation No to bypass an extra that is already started", async () => {
    const order = await fixture();
    await startExtra(order);
    const ask = { ...(await askFor(order, "remove_charge")), preparationStarted: false };
    const before = await snapshot(order);
    await expect(cancel(order, ask)).rejects.toMatchObject({
      code: "management.request_invalid",
      params: { field: "reasonId" },
    });
    expect(await snapshot(order)).toEqual(before);
  });

  it.each([[null], ["yes"], [1], [[]], [{}]])(
    "refuses a malformed direct preparation answer %j without writes",
    async (preparationStarted) => {
      const order = await fixture();
      const ask = {
        ...(await askFor(order, "remove_charge")),
        preparationStarted: preparationStarted as unknown as boolean,
      };
      const before = await snapshot(order);
      await expect(cancel(order, ask)).rejects.toMatchObject({
        code: "management.request_invalid",
        params: { field: "preparationStarted" },
      });
      expect(await snapshot(order)).toEqual(before);
    },
  );

  it("rechecks the stored context even after the waiter answered preparation Yes", async () => {
    const order = await fixture();
    const ask = { ...(await askFor(order)), preparationStarted: true };
    await startExtra(order);
    const before = await snapshot(order);
    const context = await inTx(venue, (tx) =>
      readCancellationContext(tx, order.partyId, order.parent.id),
    );
    await expect(cancel(order, ask)).rejects.toMatchObject({
      code: "tab.cancel_context_changed",
      params: { context },
    });
    expect(await snapshot(order)).toEqual(before);
  });

  it.each(["hold", "fire"] as const)(
    "removes an unpaid unstarted %s dish without a reason or an adjustment, once",
    async (release) => {
      const order = await fixture(release);
      const ask = await askFor(order, "remove_charge", "2");
      const beforeJobs = await inTx(venue, (tx) => tx.select().from(printJobs));
      await cancel(order, ask);
      const after = await snapshot(order);
      expect(
        after.lines.map((row) => ({ id: row.id, quantity: row.quantity, total: row.lineTotal })),
      ).toEqual([
        { id: order.parent.id, quantity: 1000, total: 900 },
        { id: order.extra!.id, quantity: 2000, total: 300 },
      ]);
      expect(after.adjustments).toEqual([]);
      expect(after.cancellations).toEqual([]);
      expect(after.bill[0]!.revision).toBe(ask.expectedBillRevision + 1);
      expect(after.party[0]!.revision).toBe(ask.expectedPartyRevision + 1);
      const notices = [];
      for (const station of new Set(order.tickets.map((row) => row.stationId)))
        notices.push(...(await inTx(venue, (tx) => listStationNotices(tx, venue.cfg, station))));
      const added = notices.filter((row) => row.workingOrderId === order.billId);
      const jobs = (await inTx(venue, (tx) => tx.select().from(printJobs))).filter(
        (row) => !beforeJobs.some((old) => old.id === row.id),
      );
      if (release === "fire") {
        expect(added).toHaveLength(2);
        expect(added).toMatchObject([
          { kind: "void", lineName: "PIZZA", quantity: "2.000", wasStarted: false },
          {
            kind: "void",
            lineName: expect.stringContaining("ACEIT"),
            quantity: "4.000",
            wasStarted: false,
          },
        ]);
        expect(jobs).toHaveLength(1);
        expect(printedLines(jobs[0]!.payload).join("\n")).toContain("2.000 x PIZZA");
      } else {
        expect(added).toEqual([]);
        expect(jobs).toEqual([]);
      }
      await cancel(order, ask);
      expect(await snapshot(order)).toEqual(after);
      expect(await inTx(venue, (tx) => tx.select().from(printJobs))).toEqual([
        ...beforeJobs,
        ...jobs,
      ]);
    },
  );

  it("refuses removing unstarted food from a presented bill without a reason", async () => {
    const order = await fixture("hold");
    await inTx(venue, (tx) =>
      tx.update(workingOrders).set({ status: "placed" }).where(eq(workingOrders.id, order.billId)),
    );
    const ask = await askFor(order, "remove_charge");
    const before = await snapshot(order);
    await expect(cancel(order, ask)).rejects.toMatchObject({
      code: "tab.not_open",
      params: { tabId: order.billId },
    });
    expect(await snapshot(order)).toEqual(before);
  });

  it("refuses removing unstarted food while its bill is being paid", async () => {
    const order = await fixture("hold");
    await inTx(venue, (tx) =>
      tx
        .update(workingOrders)
        .set({ paymentAttemptAt: "2026-10-19T12:00:00.000Z" })
        .where(eq(workingOrders.id, order.billId)),
    );
    const ask = await askFor(order, "remove_charge");
    const before = await snapshot(order);
    await expect(cancel(order, ask)).rejects.toMatchObject({
      code: "order.payment_in_flight",
      params: { workingOrderId: order.billId },
    });
    expect(await snapshot(order)).toEqual(before);
  });

  it("keeps the charge and family identities while reducing the dish and extra kitchen work", async () => {
    const order = await fixture();
    await startExtra(order);
    const ask = await askFor(order);
    const before = await snapshot(order);
    const answer = await cancel(order, ask);
    const after = await snapshot(order);
    expect(after.lines).toEqual(before.lines);
    expect(after.bill).toEqual([{ ...before.bill[0], revision: ask.expectedBillRevision + 1 }]);
    expect(after.party).toEqual([{ ...before.party[0], revision: ask.expectedPartyRevision + 1 }]);
    expect(answer).toEqual({ revision: ask.expectedPartyRevision + 1 });
    expect(after.cancellations).toEqual([
      {
        lineId: order.parent.id,
        quantity: 2000,
        wasStarted: true,
        actorId: venue.staffId,
        cancelledAt: expect.any(String),
      },
    ]);
    expect(
      after.tickets.map((row) => ({ id: row.workingOrderLineId, quantity: row.quantity })),
    ).toEqual(
      expect.arrayContaining([
        { id: order.parent.id, quantity: 1000 },
        { id: order.extra!.id, quantity: 2000 },
      ]),
    );
    expect(after.tickets).toHaveLength(2);
    expect(after.commands).toHaveLength(before.commands.length + 1);
    expect(after.commands.at(-1)).toMatchObject({
      kind: "line.cancel-item",
      submissionId: ask.submissionId,
    });
  });

  it("refuses the old confirmation after an extra starts without moving either revision", async () => {
    const order = await fixture();
    const ask = await askFor(order, "remove_charge");
    ask.reasonId = venue.reasonId.house;
    const unopened = await snapshot(order);
    await startExtra(order);
    const before = await snapshot(order);
    expect(before.bill).toEqual(unopened.bill);
    expect(before.party).toEqual(unopened.party);
    const context = await inTx(venue, (tx) =>
      readCancellationContext(tx, order.partyId, order.parent.id),
    );
    await expect(cancel(order, ask)).rejects.toMatchObject({
      code: "tab.cancel_context_changed",
      params: { context },
    });
    expect(await snapshot(order)).toEqual(before);
    const fresh = await askFor(order, "remove_charge", "2");
    fresh.reasonId = venue.reasonId.house;
    await cancel(order, fresh);
    const after = await snapshot(order);
    expect(
      after.lines.map((line) => ({ quantity: line.quantity, lineTotal: line.lineTotal })),
    ).toEqual([
      { quantity: 1000, lineTotal: 900 },
      { quantity: 2000, lineTotal: 300 },
    ]);
    expect(after.cancellations).toEqual([]);
    expect(after.party[0]!.revision).toBe(fresh.expectedPartyRevision + 1);
    expect(after.bill[0]!.revision).toBe(fresh.expectedBillRevision + 1);
  });

  it("records each component's own started flag and prints the removed counts before reducing tickets", async () => {
    const order = await fixture();
    await startExtra(order);
    const jobs = await inTx(venue, (tx) => tx.select().from(printJobs));
    await cancel(order, await askFor(order));
    const afterJobs = await inTx(venue, (tx) => tx.select().from(printJobs));
    const added = afterJobs.filter((row) => !jobs.some((old) => old.id === row.id));
    expect(added).toHaveLength(1);
    expect(printedLines(added[0]!.payload).join("\n")).toContain("2.000 x PIZZA");
    const parentStation = order.tickets.find(
      (row) => row.workingOrderLineId === order.parent.id,
    )!.stationId;
    const extraStation = order.tickets.find(
      (row) => row.workingOrderLineId === order.extra!.id,
    )!.stationId;
    const notices = await inTx(venue, async (tx) => [
      ...(await listStationNotices(tx, venue.cfg, parentStation)),
      ...(await listStationNotices(tx, venue.cfg, extraStation)),
    ]);
    expect(notices.filter((row) => row.workingOrderId === order.billId)).toMatchObject([
      { kind: "void", lineName: "PIZZA", quantity: "2.000", wasStarted: false },
      {
        kind: "void",
        lineName: expect.stringContaining("ACEIT"),
        quantity: "4.000",
        wasStarted: true,
      },
    ]);
  });

  it.each(["0", "-1", "1.5", "4", "3.0001", "", "no", "Infinity"])(
    "refuses invalid each quantity %j with no writes",
    async (quantity) => {
      const order = await fixture();
      await startExtra(order);
      const ask = await askFor(order, "keep_charge", quantity);
      const before = await snapshot(order);
      await expect(cancel(order, ask)).rejects.toMatchObject({
        code: "adjustment.quantity_invalid",
      });
      expect(await snapshot(order)).toEqual(before);
    },
  );

  it("allows only the whole active weighed dish", async () => {
    const order = await fixture("fire", "Ham", "1.250");
    await inTx(venue, (tx) => advanceTicketItem(tx, venue.cfg, order.tickets[0]!.id, "preparing"));
    const before = await snapshot(order);
    await expect(cancel(order, await askFor(order, "keep_charge", "0.250"))).rejects.toMatchObject({
      code: "adjustment.quantity_invalid",
    });
    expect(await snapshot(order)).toEqual(before);
    await cancel(order, await askFor(order, "keep_charge", "1.250"));
    const after = await snapshot(order);
    expect(after.lines).toEqual(before.lines);
    expect(after.tickets).toEqual([]);
    expect(after.cancellations[0]!.quantity).toBe(1250);
  });

  it.each(["hold", "fire"] as const)(
    "refuses keeping an unpaid %s dish that no one has started",
    async (release) => {
      const order = await fixture(release);
      const before = await snapshot(order);
      await expect(cancel(order, await askFor(order))).rejects.toMatchObject({
        code: "management.request_invalid",
        params: { field: "outcome" },
      });
      expect(await snapshot(order)).toEqual(before);
    },
  );

  it("refuses an unrecognised outcome instead of treating it as keep-charge", async () => {
    const order = await fixture();
    await startExtra(order);
    const ask = await askFor(order);
    const before = await snapshot(order);
    await expect(
      cancel(order, { ...ask, outcome: "refund" as CancelItemAsk["outcome"] }),
    ).rejects.toMatchObject({ code: "management.request_invalid", params: { field: "outcome" } });
    expect(await snapshot(order)).toEqual(before);
  });

  it("replays the same full consent independent of component order and reread revisions", async () => {
    const order = await fixture();
    await startExtra(order);
    const ask = await askFor(order);
    const answer = await cancel(order, ask);
    const before = await snapshot(order);
    expect(
      await cancel(order, {
        ...ask,
        expectedPartyRevision: answer.revision,
        expectedBillRevision: ask.expectedBillRevision + 1,
        expectedContext: {
          ...ask.expectedContext,
          components: [...ask.expectedContext.components].reverse(),
        },
      }),
    ).toEqual(answer);
    expect(await snapshot(order)).toEqual(before);
    await expect(
      cancel(order, { ...ask, expectedContext: { ...ask.expectedContext, stage: "not_started" } }),
    ).rejects.toMatchObject({ code: "submission.id_reused" });
    expect(await snapshot(order)).toEqual(before);
  });

  it("accumulates once, cancels the active remainder and refuses cancelling a charged slice again", async () => {
    const order = await fixture();
    await startExtra(order);
    await cancel(order, await askFor(order));
    const before = await snapshot(order);
    await expect(cancel(order, await askFor(order, "keep_charge", "2"))).rejects.toMatchObject({
      code: "adjustment.quantity_invalid",
    });
    expect(await snapshot(order)).toEqual(before);
    await cancel(order, await askFor(order, "keep_charge", "1"));
    const after = await snapshot(order);
    expect(after.lines).toEqual(before.lines);
    expect(after.tickets).toEqual([]);
    expect(after.cancellations[0]!).toMatchObject({ quantity: 3000, wasStarted: true });
    await expect(cancel(order, await askFor(order, "keep_charge", "1"))).rejects.toMatchObject({
      code: "adjustment.quantity_invalid",
    });
    expect(await snapshot(order)).toEqual(after);
  });

  it("clamps actual serving when a charged cancellation consumes served food", async () => {
    const order = await fixture();
    await startExtra(order);
    await inTx(venue, async (tx) => {
      await tx
        .update(workingOrderLines)
        .set({ servedQuantity: 2000 })
        .where(eq(workingOrderLines.id, order.parent.id));
      await tx
        .update(workingOrderLines)
        .set({ servedQuantity: 4000 })
        .where(eq(workingOrderLines.id, order.extra!.id));
    });
    await cancel(order, await askFor(order));
    const after = await snapshot(order);
    expect(
      after.lines.map((row) => ({
        quantity: row.quantity,
        served: row.servedQuantity,
        servedAt: row.servedAt,
      })),
    ).toEqual([
      { quantity: 3000, served: 1000, servedAt: expect.any(String) },
      { quantity: 6000, served: 2000, servedAt: expect.any(String) },
    ]);
    expect(after.cancellations[0]!.quantity).toBe(2000);
  });

  it("refuses a recalled source rather than cancelling behind another owner's New order", async () => {
    const order = await fixture("hold");
    const ask = await askFor(order);
    await inTx(venue, async (tx) =>
      recallToDraft(tx, venue.cfg, order.partyId, order.parent.id, {
        expectedEdit: await readBillEditState(tx, order.parent.workingOrderId),
        expectedPartyRevision: ask.expectedPartyRevision,
        submissionId: randomUUID(),
        operatorId: venue.staffId,
      }),
    );
    const before = await snapshot(order);
    const current = await askFor(order, "remove_charge");
    current.reasonId = venue.reasonId.house;
    const edit = await inTx(venue, (tx) => readBillEditState(tx, order.parent.workingOrderId));
    await expect(cancel(order, current)).rejects.toMatchObject({
      code: "draft.out_of_date",
      params: {
        billId: order.parent.workingOrderId,
        draftId: edit.draftId,
        revision: edit.draftRevision,
        edit,
      },
    });
    expect(await snapshot(order)).toEqual(before);
  });

  it.each(["hold", "fire"] as const)(
    "stops a genuinely paid %s dish without altering its filed sale or payment",
    async (release) => {
      const order = await fixture(release);
      await payWorkingOrder(
        { db: venue.db, backend: venue.backend, clock: venue.clock },
        venue.cfg,
        {
          id: order.billId,
          tender: { method: "cash", amount: "36.00" },
          lines: [],
        },
      );
      async function money() {
        return inTx(venue, async (tx) => {
          const sale = await tx.select().from(sales).where(eq(sales.workingOrderId, order.billId));
          return {
            sale,
            lines: await tx.select().from(saleLines).where(eq(saleLines.saleId, sale[0]!.id)),
            tenders: await tx.select().from(tenders).where(eq(tenders.saleId, sale[0]!.id)),
            payments: await tx
              .select()
              .from(billPayments)
              .where(eq(billPayments.workingOrderId, order.billId)),
          };
        });
      }
      const before = await money();
      expect(before.sale).toHaveLength(1);
      expect(before.tenders).toHaveLength(1);
      const billed = await snapshot(order);
      expect(billed.bill[0]!.status).toBe("settled");
      await cancel(order, await askFor(order, "keep_charge", "3"));
      const after = await snapshot(order);
      expect(after.lines).toEqual(billed.lines);
      expect(after.bill).toEqual(billed.bill);
      expect(after.tickets).toEqual([]);
      expect(after.cancellations[0]!).toMatchObject({ quantity: 3000, wasStarted: false });
      expect(await money()).toEqual(before);
    },
  );

  it.each(["party", "bill"] as const)(
    "refuses a stale %s revision with no writes",
    async (kind) => {
      const order = await fixture();
      await startExtra(order);
      const ask = await askFor(order);
      if (kind === "party") ask.expectedPartyRevision++;
      else ask.expectedBillRevision++;
      const before = await snapshot(order);
      await expect(cancel(order, ask)).rejects.toMatchObject({
        code: kind === "party" ? "party.out_of_date" : "working_order.out_of_date",
      });
      expect(await snapshot(order)).toEqual(before);
    },
  );

  it("requires the usual reason and required note for off-bill cancellation", async () => {
    const order = await fixture();
    await startExtra(order);
    const ask = await askFor(order, "remove_charge");
    const before = await snapshot(order);
    await expect(cancel(order, ask)).rejects.toMatchObject({
      code: "management.request_invalid",
      params: { field: "reasonId" },
    });
    await expect(cancel(order, { ...ask, reasonId: venue.reasonId.mistake })).rejects.toMatchObject(
      { code: "adjustment.note_required" },
    );
    expect(await snapshot(order)).toEqual(before);
    await cancel(order, { ...ask, reasonId: venue.reasonId.mistake, note: "Wrong table" });
    const after = await snapshot(order);
    expect(after.lines.map((row) => row.quantity)).toEqual([1000, 2000]);
    expect(after.adjustments).toMatchObject([
      {
        action: "cancel",
        reasonId: venue.reasonId.mistake,
        note: "Wrong table",
        reduction: 2400,
        requestedBy: venue.staffId,
      },
    ]);
    expect(after.commands).toHaveLength(before.commands.length + 1);
  });

  it("does not cancel an extra on its own or a dish belonging to a different party", async () => {
    const order = await fixture();
    await startExtra(order);
    const ask = await askFor(order);
    const other = await fixture();
    const before = await snapshot(order);
    await expect(
      inTx(venue, (tx) =>
        cancelItem(tx, venue.cfg, order.partyId, order.extra!.id, ask, venue.staffId),
      ),
    ).rejects.toMatchObject({ code: "management.request_invalid", params: { field: "lineId" } });
    await expect(
      inTx(venue, (tx) =>
        cancelItem(tx, venue.cfg, other.partyId, order.parent.id, ask, venue.staffId),
      ),
    ).rejects.toMatchObject({ code: "bill.other_party" });
    expect(await snapshot(order)).toEqual(before);
  });

  it("keeps an unprepared dish's bill identity and clamps its actual serving without any kitchen ticket", async () => {
    const order = await fixture("fire", "Coffee");
    await inTx(venue, (tx) =>
      tx
        .update(workingOrderLines)
        .set({ servedQuantity: 2000 })
        .where(eq(workingOrderLines.id, order.parent.id)),
    );
    const before = await snapshot(order);
    await cancel(order, await askFor(order));
    const after = await snapshot(order);
    expect(after.lines).toEqual([
      { ...before.lines[0], servedQuantity: 1000, servedAt: expect.any(String) },
    ]);
    expect(after.cancellations[0]!).toMatchObject({ quantity: 2000, wasStarted: true });
    expect(after.tickets).toEqual([]);
  });

  it.each([true, false])(
    "tells the kitchen when paid held work had printed=%s",
    async (printed) => {
      await inTx(venue, (tx) => writePrintHeldWork(tx, printed));
      try {
        const order = await fixture("hold");
        await payWorkingOrder(
          { db: venue.db, backend: venue.backend, clock: venue.clock },
          venue.cfg,
          {
            id: order.billId,
            tender: { method: "cash", amount: "36.00" },
            lines: [],
          },
        );
        const beforeJobs = await inTx(venue, (tx) => tx.select().from(printJobs));
        await cancel(order, await askFor(order, "keep_charge", "3"));
        const jobs = (await inTx(venue, (tx) => tx.select().from(printJobs))).filter(
          (row) => !beforeJobs.some((old) => old.id === row.id),
        );
        expect(jobs).toHaveLength(1);
        const lines = printedLines(jobs[0]!.payload).join("\n");
        expect(lines).toContain("HOLD CANCELLED");
        expect(lines).toContain("3.000 x PIZZA");
        const notices = await inTx(venue, (tx) =>
          listStationNotices(tx, venue.cfg, venue.stationId),
        );
        expect(notices.filter((notice) => notice.workingOrderId === order.billId)).toMatchObject([
          { kind: "void", quantity: "3.000", wasStarted: false },
        ]);
      } finally {
        await inTx(venue, (tx) => writePrintHeldWork(tx, false));
      }
    },
  );

  it.each([true, false])(
    "tells the kitchen once when off-bill held work had printed=%s",
    async (printed) => {
      await inTx(venue, (tx) => writePrintHeldWork(tx, printed));
      try {
        const order = await fixture("hold");
        const beforeJobs = await inTx(venue, (tx) => tx.select().from(printJobs));
        const ask = {
          ...(await askFor(order, "remove_charge", "2")),
          reasonId: venue.reasonId.house,
        };
        await cancel(order, ask);
        const after = await snapshot(order);
        expect(after.lines.map((row) => row.quantity)).toEqual([1000, 2000]);
        const jobs = (await inTx(venue, (tx) => tx.select().from(printJobs))).filter(
          (row) => !beforeJobs.some((old) => old.id === row.id),
        );
        expect(jobs).toHaveLength(printed ? 1 : 0);
        if (printed) expect(printedLines(jobs[0]!.payload).join("\n")).toContain("2.000 x PIZZA");
        const notices = await inTx(venue, (tx) =>
          listStationNotices(tx, venue.cfg, venue.stationId),
        );
        const added = notices.filter((row) => row.workingOrderId === order.billId);
        if (printed)
          expect(added).toMatchObject([{ kind: "void", quantity: "2.000", wasStarted: false }]);
        else expect(added).toEqual([]);
      } finally {
        await inTx(venue, (tx) => writePrintHeldWork(tx, false));
      }
    },
  );

  it("rolls back the charge-preserving cancellation, corrections and command when its transaction fails", async () => {
    const order = await fixture();
    await startExtra(order);
    const ask = await askFor(order);
    const before = await snapshot(order);
    const jobs = await inTx(venue, (tx) => tx.select().from(printJobs));
    const failure = new Error("rollback after cancellation");
    await expect(
      inTx(venue, async (tx) => {
        await cancelItem(tx, venue.cfg, order.partyId, order.parent.id, ask, venue.staffId);
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(await snapshot(order)).toEqual(before);
    expect(await inTx(venue, (tx) => tx.select().from(printJobs))).toEqual(jobs);
    await cancel(order, ask);
    expect((await snapshot(order)).cancellations[0]!.quantity).toBe(2000);
  });

  it("records the keep-charge activity once under the admitted actor", async () => {
    const order = await fixture();
    await startExtra(order);
    const ask = await askFor(order);
    const attendance = { recorder: recordAttendanceFact, clock: venue.clock };
    const command = () =>
      inTx(venue, (tx) =>
        cancelItem(tx, venue.cfg, order.partyId, order.parent.id, ask, venue.staffId, attendance),
      );
    await command();
    const facts = await inTx(venue, (tx) => tx.select().from(attendanceOperationFacts));
    const accepted = facts.filter(
      (row) => row.key === `service:${order.billId}:party:${order.partyId}:${ask.submissionId}`,
    );
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toMatchObject({
      source: "order",
      personId: venue.staffId,
      locationId: venue.cfg.locationId,
      kind: "order",
    });
    await command();
    expect(await inTx(venue, (tx) => tx.select().from(attendanceOperationFacts))).toEqual(facts);
  });

  it("uses the existing cancel approval policy and records the manager without storing the PIN", async () => {
    const order = await fixture();
    await startExtra(order);
    const reason = await inTx(venue, (tx) =>
      createAdjustmentReason(tx, {
        name: `Manager cancel ${randomUUID()}`,
        names: { en: "Manager cancel" },
        actions: ["cancel"],
        maxPercentBp: null,
        maxAmount: null,
        applyRole: "supervisor",
        approverRole: "manager",
        noteRequired: true,
      }),
    );
    const ask = {
      ...(await askFor(order, "remove_charge")),
      reasonId: reason.id,
      note: "Wrong order",
    };
    const before = await snapshot(order);
    await expect(cancel(order, ask)).rejects.toMatchObject({
      code: "adjustment.approval_required",
      params: { approverRole: "manager" },
    });
    expect(await snapshot(order)).toEqual(before);
    await cancel(order, { ...ask, approver: { personId: venue.managerId, pin: PINS.manager } });
    const after = await snapshot(order);
    expect(after.adjustments).toMatchObject([
      {
        approvedBy: venue.managerId,
        requestedBy: venue.staffId,
        note: "Wrong order",
        reduction: 2400,
      },
    ]);
    const commands = await inTx(venue, (tx) => tx.select().from(serviceCommands));
    expect(JSON.stringify(commands)).not.toContain('"pin"');
    expect(JSON.stringify(commands)).not.toContain(`"${PINS.manager}"`);
    const ids = after.lines.map((row) => row.id);
    expect(ids).toEqual([order.parent.id, order.extra!.id]);
  });
});
