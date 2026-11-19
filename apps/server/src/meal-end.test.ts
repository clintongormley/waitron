import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  billPayments,
  devices,
  invoiceDeliveries,
  parties,
  partyTables,
  printJobs,
  printers,
  saleLines,
  saleSettlements,
  sales,
  taxpayer,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { insertA4Printer, setPrinterListsForTest } from "@waitron/db/testing/printers.js";
import { seedDevice, seedZone } from "@waitron/db/testing/seed.js";
import { deviceOrigin, thousandthsToDecimal } from "@waitron/shared";
import { readBillEditState } from "./bill-editing.js";
import { endMeal } from "./meal-end.js";
import { cancelLine, seedGivenAwayLine } from "./testing/cancel-line.js";
import { saveDraftForTest as saveDraft } from "./testing/draft-command-fixture.js";
import {
  fiscalRecordCount,
  inTx,
  placedCounterBillMovedTo,
  provisionBillVenue,
  seatedHeldWith,
  seatedWith,
  send,
  statusOf,
  type BillVenue,
} from "./testing/bill-venue.js";
import { printOrderForTest } from "./testing/issue-order.js";
import { addFixtureExtra } from "./testing/portion-bill.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { offerProducts } from "./testing/zone-offers.js";
import { markServed } from "./working-order.js";
import "./errors.js";

let venue: BillVenue;
let ticketThenPayZone: string;
/** A Counter zone whose bills are presented with no ticket. */
let prepayZone: string;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    await inTx(venue, (tx) =>
      tx.update(taxpayer).set({ taxpayerDomicile: "Calle Fiscal 8, Madrid" }),
    );
    prepayZone = await inTx(venue, async (tx) => {
      const zone = await seedZone(tx, { name: "Prepay counter" });
      return (
        await offerProducts(tx, venue.cfg, { zone: { zoneId: zone.id }, orderStart: "counter" })
      ).zoneId;
    });
    ticketThenPayZone = (
      await inTx(venue, (tx) =>
        offerProducts(tx, venue.cfg, { zone: "counter", orderStart: "counter" }),
      )
    ).zoneId;
  },
});

type Party = Awaited<ReturnType<typeof seatedWith>>;

function deps() {
  return {
    admission: testTradingAdmission(),
    db: venue.db,
    backend: venue.backend,
    clock: venue.clock,
  };
}

function revisionOf(partyId: string): number {
  const [row] = venue.db.all<{ revision: number }>(
    sql`select revision from parties where id = ${partyId}`,
  );
  return row!.revision;
}

async function end(
  party: Pick<Party, "partyId" | "tabId">,
  overrides: Partial<Parameters<typeof endMeal>[4]> = {},
  cfg = venue.cfg,
) {
  const billId = overrides.billId ?? party.tabId;
  const expectedEdits = await inTx(venue, async (tx) => {
    const {
      billId: id,
      editorVersion,
      draftId,
      draftRevision,
    } = await readBillEditState(tx, billId);
    return [{ billId: id, editorVersion, draftId, draftRevision }];
  });
  return inTx(venue, (tx) =>
    endMeal(
      tx,
      deps(),
      cfg,
      party.partyId,
      {
        billId,
        expectedPartyRevision: revisionOf(party.partyId),
        expectedEdits,
        submissionId: randomUUID(),
        printAnyway: false,
        ...overrides,
      },
      venue.operatorId,
      null,
    ),
  );
}

function linesOf(billId: string) {
  return inTx(venue, (tx) =>
    tx
      .select({
        id: workingOrderLines.id,
        quantity: workingOrderLines.quantity,
        lineNo: workingOrderLines.lineNo,
      })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, billId))
      .orderBy(workingOrderLines.lineNo),
  );
}

async function serveAll(party: Pick<Party, "partyId" | "tabId">, billId = party.tabId) {
  const lines = await linesOf(billId);
  await inTx(venue, (tx) =>
    markServed(
      tx,
      venue.cfg,
      party.partyId,
      lines.map((line) => ({ lineId: line.id, quantity: thousandthsToDecimal(line.quantity) })),
      {
        operatorId: venue.operatorId,
        submissionId: randomUUID(),
        expectedPartyRevision: revisionOf(party.partyId),
      },
    ),
  );
}

function salesOf(billId: string) {
  return inTx(venue, (tx) =>
    tx
      .select({ id: sales.id, total: sales.total, settledAt: saleSettlements.settledAt })
      .from(sales)
      .leftJoin(saleSettlements, eq(saleSettlements.saleId, sales.id))
      .where(eq(sales.workingOrderId, billId)),
  );
}

async function partyStateOf(partyId: string) {
  const [row] = await inTx(venue, (tx) =>
    tx.select({ state: parties.state }).from(parties).where(eq(parties.id, partyId)),
  );
  return row!.state;
}

async function tableHeldBy(tableId: string): Promise<string | null> {
  const [row] = await inTx(venue, (tx) =>
    tx
      .select({ partyId: partyTables.partyId })
      .from(partyTables)
      .where(and(eq(partyTables.tableId, tableId), isNull(partyTables.leftAt))),
  );
  return row?.partyId ?? null;
}

function payInCash(billId: string, amount: string) {
  return send(venue.app, venue.cookie, "POST", `/api/working-orders/${billId}/payments`, {
    submissionId: randomUUID(),
    kind: "contribution",
    amount,
    method: "cash",
    tendered: amount,
    applied: amount,
    tip: "0.00",
  });
}

async function orderRow(billId: string) {
  const [row] = await inTx(venue, (tx) =>
    tx.select().from(workingOrders).where(eq(workingOrders.id, billId)),
  );
  return row!;
}

function deliveriesOf(saleId: string) {
  return inTx(venue, (tx) =>
    tx
      .select({ medium: invoiceDeliveries.medium })
      .from(invoiceDeliveries)
      .where(eq(invoiceDeliveries.saleId, saleId)),
  );
}

async function choose(billId: string, invoiceType: "F1" | "F2") {
  const { editorVersion, draftId, draftRevision } = await inTx(venue, (tx) =>
    readBillEditState(tx, billId),
  );
  return send(venue.app, venue.cookie, "PUT", `/api/working-orders/${billId}/invoice-choice`, {
    revision: (await orderRow(billId)).revision,
    invoiceType,
    recipient:
      invoiceType === "F1"
        ? {
            taxId: "B12345674",
            legalName: "Harbour Foods",
            address: "2 Main Street, 28013 Madrid, Madrid",
            countryCode: "ES",
          }
        : null,
    expectedEdit: { billId, editorVersion, draftId, draftRevision },
  });
}

/** The refusal's code and params, and nothing issued or placed. */
async function refused(
  attempt: Promise<unknown>,
  billId: string,
  error: { code: string; params?: Record<string, unknown> },
  status = "open",
) {
  const before = await salesOf(billId);
  await expect(attempt).rejects.toMatchObject(error);
  expect(await salesOf(billId)).toEqual(before);
  expect(await statusOf(venue, billId)).toBe(status);
}

describe("Print the bill", () => {
  it("issues the bill's ticket and leaves the table seated", async () => {
    const party = await seatedWith(venue, "Red wine bottle", "Tarta");
    await serveAll(party);

    const answer = await end(party);

    const issued = await salesOf(party.tabId);
    expect(issued).toEqual([{ id: answer.saleId, total: 4800, settledAt: null }]);
    expect(answer).toEqual({
      revision: expect.any(Number),
      workingOrderId: party.tabId,
      saleId: issued[0]!.id,
      invoiceNumber: expect.any(String),
      total: "48.00",
      owed: "48.00",
    });
    expect(answer.revision).toBe(revisionOf(party.partyId));
    expect(await statusOf(venue, party.tabId)).toBe("placed");
    expect(await partyStateOf(party.partyId)).toBe("open");
    expect(await tableHeldBy(party.tableId)).toBe(party.partyId);
  });

  it("leaves the table's other bill alone", async () => {
    const party = await seatedWith(venue, "Red wine bottle");
    await serveAll(party);
    const other = await placedCounterBillMovedTo(venue, ticketThenPayZone, party);

    await end(party);

    expect(await salesOf(party.tabId)).toHaveLength(1);
    expect(await salesOf(other)).toEqual([]);
    expect(await statusOf(venue, other)).toBe("placed");
  });

  it("a part-paid bill's ticket is for the whole bill and owes the rest", async () => {
    const party = await seatedWith(venue, "Red wine bottle");
    await serveAll(party);
    expect((await payInCash(party.tabId, "5.00")).status).toBe(200);

    const answer = await end(party);

    expect(answer).toMatchObject({ total: "30.00", owed: "25.00" });
    expect(await salesOf(party.tabId)).toEqual([
      { id: answer.saleId, total: 3000, settledAt: null },
    ]);
    expect(await statusOf(venue, party.tabId)).toBe("placed");
  });

  it("a €0.00 bill is issued and settled", async () => {
    const party = await seatedWith(venue, "Red wine bottle");
    await seedGivenAwayLine(venue, party.tabId, 1);
    await serveAll(party);
    venue.db.run(
      sql`update parties set bill_requested_at = ${new Date().toISOString()} where id = ${party.partyId}`,
    );

    const answer = await end(party);

    expect(answer).toMatchObject({ total: "0.00", owed: "0.00" });
    expect(await salesOf(party.tabId)).toEqual([
      { id: answer.saleId, total: 0, settledAt: expect.any(String) },
    ]);
    expect(await statusOf(venue, party.tabId)).toBe("settled");
    expect(await partyStateOf(party.partyId)).toBe("open");
    expect(
      venue.db.all(sql`select bill_requested_at as at from parties where id = ${party.partyId}`),
    ).toEqual([{ at: null }]);
  });

  it("issues a presented bill that has no ticket yet, leaving it placed", async () => {
    const party = await seatedWith(venue);
    const other = await placedCounterBillMovedTo(venue, ticketThenPayZone, party);
    await serveAll(party, other);

    const answer = await end(party, { billId: other });

    expect(await salesOf(other)).toEqual([{ id: answer.saleId, total: 1800, settledAt: null }]);
    expect(await statusOf(venue, other)).toBe("placed");
  });

  it("refuses a bill that already has a ticket", async () => {
    const party = await seatedWith(venue, "Red wine bottle");
    await serveAll(party);
    await printOrderForTest({ ...deps() }, venue.cfg, party.tabId, venue.operatorId);

    await refused(
      end(party),
      party.tabId,
      { code: "meal_end.already_issued", params: { workingOrderId: party.tabId } },
      "placed",
    );
  });

  it("refuses a bill that is not the party's", async () => {
    const party = await seatedWith(venue, "Red wine bottle");
    const stranger = await seatedWith(venue, "Tarta");

    await refused(end(party, { billId: stranger.tabId }), stranger.tabId, {
      code: "working_order.not_open",
      params: { workingOrderId: stranger.tabId },
    });
  });

  it("issues a merged-in party's bill through the surviving party, refusing it through the merged-away one", async () => {
    const survivor = await seatedWith(venue, "Red wine bottle");
    const merged = await seatedWith(venue, "Tarta");
    await serveAll(merged);
    venue.db.run(
      sql`update parties set state = 'closed', closed_at = ${new Date().toISOString()}, merged_into_party_id = ${survivor.partyId} where id = ${merged.partyId}`,
    );

    await refused(end(merged), merged.tabId, {
      code: "party.not_open",
      params: { partyId: merged.partyId },
    });
    expect(fiscalRecordCount(venue, merged.tabId)).toBe(0);

    const answer = await end(survivor, { billId: merged.tabId });

    expect(await salesOf(merged.tabId)).toEqual([
      { id: answer.saleId, total: 1800, settledAt: null },
    ]);
    expect(fiscalRecordCount(venue, merged.tabId)).toBe(1);
    expect(await statusOf(venue, merged.tabId)).toBe("placed");
  });

  it("refuses a bill that was cancelled, filing no record", async () => {
    const party = await seatedWith(venue, "Red wine bottle");
    const cancelled = await placedCounterBillMovedTo(venue, ticketThenPayZone, party);
    await serveAll(party, cancelled);
    const answer = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${cancelled}/cancel`,
      { reason: "Wrong order" },
    );
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    const revision = revisionOf(party.partyId);

    await refused(
      end(party, { billId: cancelled, printAnyway: true }),
      cancelled,
      { code: "bill.nothing_outstanding", params: { workingOrderId: cancelled } },
      "abandoned",
    );
    expect(fiscalRecordCount(venue, cancelled)).toBe(0);
    expect(revisionOf(party.partyId)).toBe(revision);
  });

  it("refuses a bill with no dishes, as an unpaid departure does", async () => {
    const party = await seatedWith(venue);

    await refused(end(party), party.tabId, {
      code: "bill.nothing_outstanding",
      params: { workingOrderId: party.tabId },
    });
  });

  it("warns of a dish not marked served, listing it as one the kitchen has, and issues nothing", async () => {
    const party = await seatedWith(venue, "Red wine bottle", "Tarta");
    const [wine, tarta] = await linesOf(party.tabId);
    await inTx(venue, (tx) =>
      markServed(tx, venue.cfg, party.partyId, [{ lineId: wine!.id, quantity: "1" }], {
        operatorId: venue.operatorId,
        submissionId: randomUUID(),
        expectedPartyRevision: revisionOf(party.partyId),
      }),
    );

    await refused(end(party), party.tabId, {
      code: "meal_end.unserved_dishes",
      params: {
        workingOrderId: party.tabId,
        dishes: [{ lineId: tarta!.id, dishName: "Tarta", quantity: "1.000", released: true }],
      },
    });
  });

  it("warns of an unserved dish with an extra by the dish alone", async () => {
    const party = await seatedWith(venue, "Red wine bottle");
    const [wine] = await linesOf(party.tabId);
    await inTx(venue, (tx) =>
      addFixtureExtra(tx, venue.cfg, party.tabId, wine!.id, venue.offerFor("Tarta")),
    );

    await refused(end(party), party.tabId, {
      code: "meal_end.unserved_dishes",
      params: {
        workingOrderId: party.tabId,
        dishes: [
          { lineId: wine!.id, dishName: "Red wine bottle", quantity: "1.000", released: true },
        ],
      },
    });
  });

  it("lists a dish on hold as one the kitchen does not have", async () => {
    const party = await seatedHeldWith(venue, "Tarta");
    const [tarta] = await linesOf(party.tabId);

    await refused(end(party), party.tabId, {
      code: "meal_end.unserved_dishes",
      params: {
        workingOrderId: party.tabId,
        dishes: [{ lineId: tarta!.id, dishName: "Tarta", quantity: "1.000", released: false }],
      },
    });
  });

  it("prints anyway with printAnyway, the unserved dish on the ticket", async () => {
    const party = await seatedWith(venue, "Tarta");

    const answer = await end(party, { printAnyway: true });

    expect(await salesOf(party.tabId)).toHaveLength(1);
    const printed = await inTx(venue, (tx) =>
      tx
        .select({ name: saleLines.name, quantity: saleLines.quantity })
        .from(saleLines)
        .where(eq(saleLines.saleId, answer.saleId)),
    );
    expect(printed).toEqual([{ name: "Tarta", quantity: 1000 }]);
    expect(answer).toMatchObject({ total: "18.00", owed: "18.00" });
  });

  it("a dish cancelled in full is not listed", async () => {
    const party = await seatedWith(venue, "Red wine bottle", "Tarta");
    const [wine] = await linesOf(party.tabId);
    await inTx(venue, (tx) => cancelLine(tx, venue.cfg, party.tabId, 2));
    await inTx(venue, (tx) =>
      markServed(tx, venue.cfg, party.partyId, [{ lineId: wine!.id, quantity: "1" }], {
        operatorId: venue.operatorId,
        submissionId: randomUUID(),
        expectedPartyRevision: revisionOf(party.partyId),
      }),
    );

    const answer = await end(party);

    expect(answer).toMatchObject({ total: "30.00" });
  });

  async function unsentTarta(billId: string, partyId: string, ownerId: string) {
    await inTx(venue, (tx) =>
      saveDraft(tx, venue.cfg, partyId, ownerId, {
        billId,
        draftId: null,
        revision: 0,
        lines: [
          {
            menuItemId: venue.offerFor("Tarta"),
            quantity: "1",
            options: [],
            extras: [],
            note: null,
            courseId: null,
            makeAt: null,
          },
        ],
      }),
    );
  }

  it("refuses a bill someone else is editing", async () => {
    const party = await seatedWith(venue, "Red wine bottle");
    await serveAll(party);
    await unsentTarta(party.tabId, party.partyId, venue.adminId);

    await refused(end(party), party.tabId, {
      code: "draft.taken_over",
      params: { billId: party.tabId },
    });
  });

  it("refuses the operator's own dishes not yet sent", async () => {
    const party = await seatedWith(venue, "Red wine bottle");
    await serveAll(party);
    await unsentTarta(party.tabId, party.partyId, venue.operatorId);

    await refused(end(party), party.tabId, {
      code: "bill.unsent_dishes",
      params: { billId: party.tabId },
    });
  });

  it("refuses a payment in flight", async () => {
    const party = await seatedWith(venue, "Red wine bottle");
    await serveAll(party);
    await inTx(venue, (tx) =>
      tx.insert(billPayments).values({
        workingOrderId: party.tabId,
        submissionId: randomUUID(),
        fingerprint: "pending",
        kind: "contribution",
        method: "card",
        applied: 1000,
        tip: 0,
        state: "pending",
        requestedBy: venue.operatorId,
        source: "device",
        deviceId: venue.device2Id,
      }),
    );

    await refused(end(party), party.tabId, {
      code: "order.payment_in_flight",
      params: { workingOrderId: party.tabId },
    });
  });

  it("a resend with the same submission id answers the same and issues nothing more", async () => {
    const party = await seatedWith(venue, "Red wine bottle");
    await serveAll(party);
    const submissionId = randomUUID();
    const expectedPartyRevision = revisionOf(party.partyId);

    const first = await end(party, { submissionId, expectedPartyRevision });
    const again = await end(party, { submissionId, expectedPartyRevision });

    expect(again).toEqual(first);
    expect(await salesOf(party.tabId)).toHaveLength(1);
  });

  it("a stale party revision is refused", async () => {
    const party = await seatedWith(venue, "Red wine bottle");
    await serveAll(party);

    await refused(
      end(party, { expectedPartyRevision: revisionOf(party.partyId) - 1 }),
      party.tabId,
      {
        code: "party.out_of_date",
        params: { partyId: party.partyId },
      },
    );
  });

  it("refuses a bill already paid in full that has no ticket", async () => {
    const party = await seatedWith(venue, "Red wine bottle");
    await serveAll(party);
    await inTx(venue, (tx) =>
      tx.insert(billPayments).values({
        workingOrderId: party.tabId,
        submissionId: randomUUID(),
        fingerprint: "paid",
        kind: "contribution",
        method: "cash",
        applied: 3000,
        tendered: 3000,
        tip: 0,
        state: "received",
        receivedAt: new Date().toISOString(),
        requestedBy: venue.operatorId,
        source: "device",
        deviceId: venue.deviceId,
      }),
    );

    await refused(end(party), party.tabId, {
      code: "bill.nothing_outstanding",
      params: { workingOrderId: party.tabId },
    });
  });
});

describe("a Counter bill presented with no ticket, moved to the table", () => {
  function contribution(
    billId: string,
    amount: string,
    method: "cash" | "card",
    extra: Record<string, unknown> = {},
  ) {
    return send(venue.app, venue.cookie, "POST", `/api/working-orders/${billId}/payments`, {
      submissionId: randomUUID(),
      kind: "contribution",
      amount,
      method,
      ...(method === "cash" ? { tendered: amount } : { entry: "reader" }),
      applied: amount,
      tip: "0.00",
      ...extra,
    });
  }

  /** The Counter bill, part paid `paid` in cash at the counter when given, moved to the party. */
  async function presented(party: Party, paid?: string): Promise<string> {
    const id = await placedCounterBillMovedTo(venue, prepayZone, party, false, async (sent) => {
      if (paid !== undefined)
        expect((await contribution(sent, paid, "cash", { expectedEdit: null })).status).toBe(200);
    });
    await serveAll(party, id);
    return id;
  }

  /** Runs `during` while `start`'s card, or card refund, is held at the provider. */
  async function whileHeld<T>(
    hold: () => () => void,
    calls: () => number,
    start: () => Promise<{ status: number }>,
    during: () => Promise<T>,
  ): Promise<{ during: PromiseSettledResult<T>; started: { status: number } }> {
    const before = calls();
    const release = hold();
    let started: Promise<{ status: number }> | undefined;
    let outcome: PromiseSettledResult<T>;
    try {
      started = start();
      await expect.poll(calls).toBe(before + 1);
      outcome = (await Promise.allSettled([during()]))[0]!;
    } finally {
      release();
    }
    return { during: outcome, started: await started };
  }

  it("issues a part-paid one for the whole bill, owing the rest", async () => {
    const party = await seatedWith(venue);
    const id = await presented(party, "5.00");

    const answer = await end(party, { billId: id });

    expect(answer).toMatchObject({ total: "18.00", owed: "13.00" });
    expect(await salesOf(id)).toEqual([{ id: answer.saleId, total: 1800, settledAt: null }]);
    expect(await statusOf(venue, id)).toBe("placed");
  });

  it("refuses one whose whole payment is at the card reader, and the card then pays it", async () => {
    const party = await seatedWith(venue);
    const id = await presented(party);

    const { during, started } = await whileHeld(
      () => venue.card.holdNextCollect(),
      () => venue.card.collectCalls.length,
      () => send(venue.app, venue.cookie, "POST", "/api/pay", { dining: "eat_in", id, lines: [] }),
      () =>
        refused(
          end(party, { billId: id }),
          id,
          { code: "order.payment_in_flight", params: { workingOrderId: id } },
          "placed",
        ),
    );

    expect(during.status).toBe("fulfilled");
    expect(started.status).toBe(200);
    const sales = await salesOf(id);
    expect(sales).toHaveLength(1);
    expect(sales[0]!.settledAt).not.toBeNull();
    expect(await statusOf(venue, id)).toBe("settled");
  });

  it("refuses one whose card part payment is at the reader", async () => {
    const party = await seatedWith(venue);
    const id = await presented(party, "5.00");

    const { during, started } = await whileHeld(
      () => venue.card.holdNextCollect(),
      () => venue.card.collectCalls.length,
      () => contribution(id, "5.00", "card"),
      () =>
        refused(
          end(party, { billId: id }),
          id,
          { code: "order.payment_in_flight", params: { workingOrderId: id } },
          "placed",
        ),
    );

    expect(during.status).toBe("fulfilled");
    expect(started.status).toBe(200);
    expect(await salesOf(id)).toEqual([]);
  });

  it("refuses one whose card part payment is being refunded", async () => {
    const party = await seatedWith(venue);
    const id = await presented(party, "5.00");
    const card = await contribution(id, "5.00", "card");
    expect(card.status).toBe(200);
    const paymentId = (card.json.payment as { id: string }).id;

    const { during, started } = await whileHeld(
      () => venue.card.holdNextRefund(),
      () => venue.card.refundCalls.length,
      () =>
        send(
          venue.app,
          venue.cookie,
          "POST",
          `/api/working-orders/${id}/payments/${paymentId}/refunds`,
          {
            submissionId: randomUUID(),
            appliedAmount: "5.00",
            tipAmount: "0.00",
            reason: "Overcharged",
            override: { personId: venue.adminId, pin: "1234" },
          },
        ),
      () =>
        refused(
          end(party, { billId: id }),
          id,
          { code: "bill.refund_in_progress", params: { workingOrderId: id } },
          "placed",
        ),
    );

    expect(during.status).toBe("fulfilled");
    expect(started.status).toBe(200);
    expect(await salesOf(id)).toEqual([]);
  });
});

describe("a printed bill's invoice type", () => {
  async function refusesSwitch(billId: string, invoiceType: "F1" | "F2") {
    const before = await orderRow(billId);
    const sold = await salesOf(billId);
    expect(await choose(billId, invoiceType)).toEqual({
      status: 409,
      json: { code: "invoice.choice_locked", params: {} },
    });
    expect(await orderRow(billId)).toEqual(before);
    expect(await salesOf(billId)).toEqual(sold);
  }

  it("an unprinted bill switches both ways", async () => {
    const party = await seatedWith(venue, "Red wine bottle");

    expect((await choose(party.tabId, "F1")).status).toBe(200);
    expect((await orderRow(party.tabId)).invoiceType).toBe("F1");
    expect((await choose(party.tabId, "F2")).status).toBe(200);
    expect((await orderRow(party.tabId)).invoiceType).toBe("F2");
  });

  it("a printed, unpaid simplified bill refuses a switch to a full invoice", async () => {
    const party = await seatedWith(venue, "Red wine bottle");
    await serveAll(party);
    await end(party);

    await refusesSwitch(party.tabId, "F1");
  });

  it("a printed, unpaid full-invoice bill refuses a switch to a simplified one", async () => {
    const party = await seatedWith(venue, "Red wine bottle");
    expect((await choose(party.tabId, "F1")).status).toBe(200);
    await serveAll(party);
    const { saleId } = await end(party);

    expect(
      await inTx(venue, (tx) =>
        tx
          .select({ kind: printJobs.kind, copy: printJobs.receiptCopy })
          .from(printJobs)
          .where(eq(printJobs.saleId, saleId)),
      ),
    ).toEqual([{ kind: "document", copy: false }]);
    expect(await deliveriesOf(saleId)).toEqual([{ medium: "receipt" }]);
    await refusesSwitch(party.tabId, "F2");
  });
});

describe("Print the bill's receipt", () => {
  function jobsOf(saleId: string) {
    return inTx(venue, (tx) =>
      tx
        .select({
          printerId: printJobs.printerId,
          kind: printJobs.kind,
          copy: printJobs.receiptCopy,
          page: printJobs.pageDocument,
        })
        .from(printJobs)
        .where(eq(printJobs.saleId, saleId)),
    );
  }

  async function drawerJobs() {
    return (
      await inTx(venue, (tx) => tx.select().from(printJobs).where(eq(printJobs.kind, "drawer")))
    ).length;
  }

  async function venuePrinterId() {
    const [row] = await inTx(venue, (tx) =>
      tx
        .select({ id: devices.receiptPrinterId })
        .from(devices)
        .where(eq(devices.id, venue.cfg.origin.deviceId)),
    );
    return row!.id!;
  }

  /** A device seeded after the venue's printers were chosen: none of its own, nor a profile default. */
  async function bareDevice() {
    const { deviceId, profileId } = await seedDevice(venue.db, { capabilities: [] });
    return { cfg: { ...venue.cfg, origin: deviceOrigin(deviceId) }, profileId };
  }

  it("queues one original receipt on the device's chosen receipt printer", async () => {
    const party = await seatedWith(venue, "Red wine bottle");
    await serveAll(party);
    const drawers = await drawerJobs();

    const { saleId } = await end(party);

    expect(await jobsOf(saleId)).toEqual([
      { printerId: await venuePrinterId(), kind: "document", copy: false, page: null },
    ]);
    expect(await drawerJobs()).toBe(drawers);
  });

  it("a device with no printer of its own prints on its profile's default", async () => {
    const { cfg, profileId } = await bareDevice();
    const printerId = await venuePrinterId();
    await inTx(venue, (tx) =>
      setPrinterListsForTest(tx, profileId, {
        receipt: { ids: [printerId], defaultId: printerId },
      }),
    );
    const party = await seatedWith(venue, "Red wine bottle");
    await serveAll(party);

    const { saleId } = await end(party, {}, cfg);

    expect(await jobsOf(saleId)).toEqual([
      { printerId, kind: "document", copy: false, page: null },
    ]);
  });

  it("a full invoice staged for email prints no receipt and needs no printer", async () => {
    const { cfg } = await bareDevice();
    const party = await seatedWith(venue, "Red wine bottle");
    expect((await choose(party.tabId, "F1")).status).toBe(200);
    await inTx(venue, (tx) =>
      tx
        .update(workingOrders)
        .set({
          invoiceDelivery: {
            medium: "email",
            recipient: "customer@example.com",
            personId: venue.operatorId,
          },
        })
        .where(eq(workingOrders.id, party.tabId)),
    );
    await serveAll(party);

    const { saleId } = await end(party, {}, cfg);

    expect(await jobsOf(saleId)).toEqual([]);
    expect(await deliveriesOf(saleId)).toEqual([{ medium: "email" }]);
  });

  it("a full invoice staged for email prints no receipt on a device that has a printer", async () => {
    const party = await seatedWith(venue, "Red wine bottle");
    expect((await choose(party.tabId, "F1")).status).toBe(200);
    await inTx(venue, (tx) =>
      tx
        .update(workingOrders)
        .set({
          invoiceDelivery: {
            medium: "email",
            recipient: "customer@example.com",
            personId: venue.operatorId,
          },
        })
        .where(eq(workingOrders.id, party.tabId)),
    );
    await serveAll(party);

    const { saleId } = await end(party);

    expect(await jobsOf(saleId)).toEqual([]);
  });

  it("a full invoice staged for A4 prints no receipt on a device that has a printer", async () => {
    const { party, pagePrinterId } = await stagedForA4(true);

    const { saleId } = await end(party);

    expect(await jobsOf(saleId)).toEqual([
      { printerId: pagePrinterId, kind: "a4", copy: null, page: "invoice" },
    ]);
    expect(await deliveriesOf(saleId)).toEqual([{ medium: "a4" }]);
  });

  async function stagedForA4(active: boolean) {
    const pagePrinterId = randomUUID();
    await inTx(venue, (tx) =>
      insertA4Printer(tx, { id: pagePrinterId, name: "Office", host: pagePrinterId }),
    );
    const party = await seatedWith(venue, "Red wine bottle");
    expect((await choose(party.tabId, "F1")).status).toBe(200);
    await inTx(venue, (tx) =>
      tx
        .update(workingOrders)
        .set({ invoiceDelivery: { medium: "a4", pagePrinterId, personId: venue.operatorId } })
        .where(eq(workingOrders.id, party.tabId)),
    );
    await serveAll(party);
    if (!active)
      await inTx(venue, (tx) =>
        tx.update(printers).set({ active: false }).where(eq(printers.id, pagePrinterId)),
      );
    return { party, pagePrinterId };
  }

  /** The refusal, and no record filed, the bill still open and the party's revision unmoved. */
  async function refusedUndelivered(party: Party, medium: "a4" | "email") {
    const records = fiscalRecordCount(venue, party.tabId);
    const revision = revisionOf(party.partyId);

    await refused(end(party), party.tabId, {
      code: "meal_end.delivery_unavailable",
      params: { workingOrderId: party.tabId, medium },
    });

    expect(fiscalRecordCount(venue, party.tabId)).toBe(records);
    expect(records).toBe(0);
    expect(revisionOf(party.partyId)).toBe(revision);
  }

  it("refuses a full invoice staged for an A4 printer switched off since, issuing nothing", async () => {
    await refusedUndelivered((await stagedForA4(false)).party, "a4");
  });

  it("refuses a full invoice staged for email whose delivery cannot be queued, issuing nothing", async () => {
    const party = await seatedWith(venue, "Red wine bottle");
    expect((await choose(party.tabId, "F1")).status).toBe(200);
    await inTx(venue, (tx) =>
      tx
        .update(workingOrders)
        .set({
          invoiceDelivery: {
            medium: "email",
            recipient: "customer@example.com",
            personId: venue.operatorId,
          },
        })
        .where(eq(workingOrders.id, party.tabId)),
    );
    await serveAll(party);
    venue.db.run(
      sql.raw(`create trigger meal_end_test_no_delivery before insert on invoice_deliveries
        begin select raise(abort, 'meal-end test: delivery refused'); end`),
    );
    try {
      await refusedUndelivered(party, "email");
    } finally {
      venue.db.run(sql.raw("drop trigger meal_end_test_no_delivery"));
    }
  });

  it("refuses meal_end.no_printer when the device's receipts resolve to no printer, issuing nothing", async () => {
    const { cfg } = await bareDevice();
    const party = await seatedWith(venue, "Red wine bottle");
    await serveAll(party);

    await refused(end(party, {}, cfg), party.tabId, {
      code: "meal_end.no_printer",
      params: { workingOrderId: party.tabId },
    });
  });

  it("a resend with the same submission id queues no second receipt", async () => {
    const party = await seatedWith(venue, "Red wine bottle");
    await serveAll(party);
    const submissionId = randomUUID();
    const expectedPartyRevision = revisionOf(party.partyId);

    const first = await end(party, { submissionId, expectedPartyRevision });
    const second = await end(party, { submissionId, expectedPartyRevision });

    expect(second).toEqual(first);
    expect(await jobsOf(first.saleId)).toHaveLength(1);
  });
});
