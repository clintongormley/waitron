import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  billPayments,
  parties,
  partyTables,
  saleLines,
  saleSettlements,
  sales,
  workingOrderLines,
} from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { thousandthsToDecimal } from "@waitron/shared";
import { readBillEditState } from "./bill-editing.js";
import { endMeal } from "./meal-end.js";
import { cancelLine, giveAway } from "./testing/cancel-line.js";
import { saveDraftForTest as saveDraft } from "./testing/draft-command-fixture.js";
import {
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
import { testTradingAdmission } from "./testing/trading-admission.js";
import { offerProducts } from "./testing/zone-offers.js";
import { markServed } from "./working-order.js";
import "./errors.js";

let venue: BillVenue;
let ticketThenPayZone: string;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
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
      venue.cfg,
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
    const party = await seatedWith(venue, "Caña");
    await giveAway(venue, party.tabId, 1);
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
        dishes: [{ lineId: tarta!.id, name: "Tarta", quantity: "1.000", released: true }],
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
        dishes: [{ lineId: tarta!.id, name: "Tarta", quantity: "1.000", released: false }],
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

  it("refuses a presented bill with a pending card part payment", async () => {
    const party = await seatedWith(venue);
    const other = await placedCounterBillMovedTo(venue, ticketThenPayZone, party);
    await serveAll(party, other);
    await inTx(venue, (tx) =>
      tx.insert(billPayments).values({
        workingOrderId: other,
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

    await refused(
      end(party, { billId: other }),
      other,
      { code: "order.payment_in_flight", params: { workingOrderId: other } },
      "placed",
    );
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
});
