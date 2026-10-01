import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  diningTables,
  floorZones,
  invoiceSeries,
  partyTables,
  parties,
  printJobs,
  saleSettlements,
  sales,
  unpaidDepartures,
  workingOrders,
} from "@waitron/db";
import { recordCorrection, recordVoid } from "@waitron/core";
import { hashPin, loginWithPin, persons } from "@waitron/identity";
import { saleId as brandSaleId, seriesId as brandSeriesId } from "@waitron/shared";
import { writeClearingWorkflow } from "@waitron/venue-service";
import { parkOrder, placeOrder } from "./working-order.js";
import { offerProducts } from "./testing/zone-offers.js";
import {
  inTx,
  partyRevisionOf,
  provisionBillVenue,
  registroCount,
  seatedWith,
  send,
  statusOf,
  tabWith,
  type BillVenue,
} from "./testing/bill-venue.js";
import { SESSION_COOKIE } from "./till-session.js";
import { cancelBody } from "./testing/cancel-line.js";
import "./errors.js";

// Record unpaid departure (spec §8; service plan Task 17; owner's Q28 decision of 2026-10-01): the
// party's owing bills are invoiced in full and left unpaid, the debt is recorded with who recorded
// and who authorised it, and the party closes as Finish closes it. Driven over HTTP against a
// venue that files real Veri*Factu records; every case seats its own party.
let venue: BillVenue;
let invoiceFirstZone: string;
let prepayZone: string;
let supervisorId: string;
/** The supervisor's own session on the first till's device. */
let supervisorCookie: string;
/** The staff operator's session with no device. */
let noDeviceCookie: string;

const SUPERVISOR_PIN = "7777";
const REASON = "Se marcharon sin pagar";

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    invoiceFirstZone = (
      await inTx(venue, (tx) =>
        offerProducts(tx, venue.cfg, { zone: "counter", serviceMode: "invoice_first" }),
      )
    ).zoneId;
    prepayZone = await inTx(venue, async (tx) => {
      const [zone] = await tx
        .insert(floorZones)
        .values({ locationId: venue.cfg.locationId, name: "Barra prepago" })
        .returning({ id: floorZones.id });
      return (
        await offerProducts(tx, venue.cfg, { zone: { zoneId: zone!.id }, serviceMode: "prepay" })
      ).zoneId;
    });
    const session = await inTx(venue, async (tx) => {
      const [person] = await tx
        .insert(persons)
        .values({ displayName: "Sofía", pinHash: hashPin(SUPERVISOR_PIN), role: "supervisor" })
        .returning({ id: persons.id });
      supervisorId = person!.id;
      return loginWithPin(tx, {
        tillId: venue.cfg.tillId,
        personId: supervisorId,
        pin: SUPERVISOR_PIN,
      });
    });
    const [staffSession, ...device] = venue.cookie.split("; ");
    supervisorCookie = [`${SESSION_COOKIE}=${session.token}`, ...device].join("; ");
    noDeviceCookie = staffSession!;
  },
});

function depart(partyId: string, body: Record<string, unknown>, cookie = supervisorCookie) {
  return send(venue.app, cookie, "POST", `/api/parties/${partyId}/unpaid-departure`, body);
}

function revisionOf(partyId: string): number {
  const [row] = venue.db.all<{ revision: number }>(
    sql`select revision from parties where id = ${partyId}`,
  );
  return row!.revision;
}

function departuresOf(billId: string) {
  return inTx(venue, (tx) =>
    tx.select().from(unpaidDepartures).where(eq(unpaidDepartures.workingOrderId, billId)),
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

async function partyState(partyId: string) {
  const [row] = await inTx(venue, (tx) =>
    tx
      .select({ state: parties.state, closedBy: parties.closedBy })
      .from(parties)
      .where(eq(parties.id, partyId)),
  );
  return row!;
}

async function tableHeldBy(tableId: string): Promise<string | null> {
  const [row] = await inTx(venue, (tx) =>
    tx
      .select({ partyId: partyTables.partyId })
      .from(partyTables)
      .where(and(eq(partyTables.tableId, tableId), sql`${partyTables.leftAt} is null`)),
  );
  return row?.partyId ?? null;
}

async function needsClearingSince(tableId: string): Promise<string | null> {
  const [row] = await inTx(venue, (tx) =>
    tx
      .select({ since: diningTables.needsClearingSince })
      .from(diningTables)
      .where(eq(diningTables.id, tableId)),
  );
  return row!.since;
}

/** Nothing of the refused departure was written: no invoice, no record, the party still open. */
async function expectNothingWritten(partyId: string, billId: string): Promise<void> {
  expect(registroCount(venue, billId)).toBe(0);
  expect(await departuresOf(billId)).toEqual([]);
  expect(await statusOf(venue, billId)).toBe("open");
  expect((await partyState(partyId)).state).toBe("open");
}

/** A counter order of one Tarta (18.00) placed in `zoneId`, then moved to the party at `tableId`. */
async function placedCounterBillMovedTo(
  zoneId: string,
  party: { partyId: string; tableId: string },
): Promise<string> {
  const id = randomUUID();
  const deps = { db: venue.db, backend: venue.backend, clock: venue.clock };
  await parkOrder(deps, venue.cfg, {
    id,
    lines: [{ menuItemId: venue.offerFor("Tarta"), quantity: "1" }],
    zoneId,
    operatorId: venue.operatorId,
  });
  await placeOrder(deps, venue.cfg, id, venue.operatorId, venue.cfg.tillId);
  const moved = await send(venue.app, venue.cookie, "POST", `/api/bills/${id}/move`, {
    to: { tableId: party.tableId },
    otherPartyId: party.partyId,
    expectedOtherPartyRevision: revisionOf(party.partyId),
  });
  expect(moved.status).toBe(200);
  return id;
}

/** Records a credit note of 2.00 base (-2.42) against the bill's invoice. */
async function creditTwoEuros(billId: string): Promise<void> {
  const [issued] = await salesOf(billId);
  await inTx(venue, async (tx) => {
    const [series] = await tx
      .select({ id: invoiceSeries.id })
      .from(invoiceSeries)
      .where(
        and(eq(invoiceSeries.nodeId, venue.cfg.nodeId), eq(invoiceSeries.purpose, "rectificative")),
      );
    const session = await loginWithPin(tx, {
      tillId: venue.cfg.tillId,
      personId: venue.adminId,
      pin: "1234",
    });
    await recordCorrection(tx, venue.backend, {
      tillId: venue.cfg.tillId,
      nodeId: venue.cfg.nodeId,
      seriesId: brandSeriesId(series!.id),
      correctsSaleId: brandSaleId(issued!.id),
      total: "-2.42",
      lines: [
        {
          lineNo: 1,
          name: "Descuento",
          descriptions: { [venue.cfg.locale]: "Descuento" },
          quantity: "-1",
          unitPrice: "2.00",
          vatRate: "21.00",
          lineTotal: "-2.00",
        },
      ],
      clock: venue.clock,
      authz: { sessionId: session.id },
    });
  });
}

describe("recording that a table left without paying", () => {
  it("invoices the open bill in full, leaves it unpaid, records who and why, and frees the table", async () => {
    const party = await seatedWith(venue, "Botella tinto");

    const answer = await depart(party.partyId, {
      expectedPartyRevision: party.revision,
      reason: `  ${REASON}  `,
    });

    expect(answer.status).toBe(200);
    expect(registroCount(venue, party.tabId)).toBe(1);
    const issued = await salesOf(party.tabId);
    expect(issued).toEqual([{ id: expect.any(String), total: 3000, settledAt: null }]);
    expect(await statusOf(venue, party.tabId)).toBe("placed");
    expect(await departuresOf(party.tabId)).toEqual([
      {
        id: expect.any(String),
        partyId: party.partyId,
        workingOrderId: party.tabId,
        saleId: issued[0]!.id,
        amount: 3000,
        reason: REASON,
        recordedBy: supervisorId,
        authorizedBy: supervisorId,
        tillId: venue.deviceTillId,
        recordedAt: expect.any(String),
      },
    ]);
    expect(answer.json).toEqual({
      state: "closed",
      departures: [
        {
          id: (await departuresOf(party.tabId))[0]!.id,
          workingOrderId: party.tabId,
          saleId: issued[0]!.id,
          invoiceNumber: expect.stringMatching(/^A/),
          amount: "30.00",
        },
      ],
    });
    expect(await partyState(party.partyId)).toEqual({ state: "closed", closedBy: supervisorId });
    expect(await tableHeldBy(party.tableId)).toBeNull();
    expect(await needsClearingSince(party.tableId)).toBeNull();
  });

  it("leaves the table needing clearing when the clearing workflow is on", async () => {
    const party = await seatedWith(venue, "Botella tinto");
    await inTx(venue, (tx) => writeClearingWorkflow(tx, true));
    try {
      const answer = await depart(party.partyId, {
        expectedPartyRevision: party.revision,
        reason: REASON,
      });

      expect(answer.status).toBe(200);
      expect(await tableHeldBy(party.tableId)).toBeNull();
      expect(await needsClearingSince(party.tableId)).not.toBeNull();
    } finally {
      await inTx(venue, (tx) => writeClearingWorkflow(tx, false));
    }
  });

  it("prints no receipt, and the bill's receipt can still be printed again", async () => {
    const party = await seatedWith(venue, "Botella tinto");
    await depart(party.partyId, { expectedPartyRevision: party.revision, reason: REASON });
    const [issued] = await salesOf(party.tabId);
    const receiptsOf = () =>
      inTx(venue, (tx) => tx.select().from(printJobs).where(eq(printJobs.saleId, issued!.id)));
    expect(await receiptsOf()).toEqual([]);

    const reprinted = await send(
      venue.app,
      noDeviceCookie,
      "POST",
      `/api/sales/${party.tabId}/reprint`,
    );

    expect(reprinted.status).toBe(200);
    expect(await receiptsOf()).toHaveLength(1);
  });

  it("keeps the closed party's bills readable", async () => {
    const party = await seatedWith(venue, "Botella tinto");
    await depart(party.partyId, { expectedPartyRevision: party.revision, reason: REASON });

    const bills = await send(venue.app, venue.cookie, "GET", `/api/parties/${party.partyId}/bills`);

    expect(bills.status).toBe(200);
    expect(bills.json).toEqual([
      expect.objectContaining({
        workingOrderId: party.tabId,
        status: "placed",
        total: "30.00",
        outstanding: "30.00",
        receiptAvailable: true,
      }),
    ]);
  });
});

describe("who may record it", () => {
  it("refuses an operator without the permission, and writes nothing", async () => {
    const party = await seatedWith(venue, "Botella tinto");

    const answer = await depart(
      party.partyId,
      { expectedPartyRevision: party.revision, reason: REASON },
      venue.cookie,
    );

    expect(answer).toMatchObject({
      status: 403,
      json: {
        code: "authorization.not_permitted",
        params: { permission: "sale.unpaid_departure" },
      },
    });
    await expectNothingWritten(party.partyId, party.tabId);
  });

  it("records it for an operator with a supervisor's PIN, naming the supervisor as authorising", async () => {
    const party = await seatedWith(venue, "Botella tinto");

    const answer = await depart(
      party.partyId,
      {
        expectedPartyRevision: party.revision,
        reason: REASON,
        override: { personId: supervisorId, pin: SUPERVISOR_PIN },
      },
      venue.cookie,
    );

    expect(answer.status).toBe(200);
    expect(await departuresOf(party.tabId)).toEqual([
      expect.objectContaining({ recordedBy: venue.operatorId, authorizedBy: supervisorId }),
    ]);
    expect((await partyState(party.partyId)).closedBy).toBe(venue.operatorId);
  });

  it("refuses a wrong supervisor PIN, and writes nothing", async () => {
    const party = await seatedWith(venue, "Botella tinto");

    const answer = await depart(
      party.partyId,
      {
        expectedPartyRevision: party.revision,
        reason: REASON,
        override: { personId: supervisorId, pin: "0000" },
      },
      venue.cookie,
    );

    expect(answer).toMatchObject({ status: 401, json: { code: "pin.invalid" } });
    await expectNothingWritten(party.partyId, party.tabId);
  });

  it("lists the active holders of the permission, and no one else, by id and name only", async () => {
    const listed = await send(venue.app, venue.cookie, "GET", "/api/unpaid-departure-authorizers");

    expect(listed.status).toBe(200);
    const people = listed.json as unknown as Record<string, unknown>[];
    const ids = people.map((person) => person.personId);
    expect(ids).toEqual(expect.arrayContaining([venue.adminId, supervisorId]));
    expect(ids).not.toContain(venue.operatorId);
    for (const person of people) expect(Object.keys(person)).toEqual(["personId", "displayName"]);
  });
});

describe("the reason", () => {
  it.each([
    ["missing", undefined],
    ["blank", "   "],
    ["too long", "x".repeat(501)],
    ["not text", 42],
  ])("refuses a %s reason, and writes nothing", async (_, reason) => {
    const party = await seatedWith(venue, "Botella tinto");

    const answer = await depart(party.partyId, {
      expectedPartyRevision: party.revision,
      ...(reason === undefined ? {} : { reason }),
    });

    expect(answer).toMatchObject({
      status: 400,
      json: { code: "management.request_invalid", params: { field: "reason" } },
    });
    await expectNothingWritten(party.partyId, party.tabId);
  });

  it("refuses an override that is not an object, and writes nothing", async () => {
    const party = await seatedWith(venue, "Botella tinto");

    const answer = await depart(
      party.partyId,
      { expectedPartyRevision: party.revision, reason: REASON, override: SUPERVISOR_PIN },
      venue.cookie,
    );

    expect(answer).toMatchObject({
      status: 400,
      json: { code: "management.request_invalid", params: { field: "override" } },
    });
    await expectNothingWritten(party.partyId, party.tabId);
  });

  it("takes a reason of exactly 500 characters", async () => {
    const party = await seatedWith(venue, "Botella tinto");

    const answer = await depart(party.partyId, {
      expectedPartyRevision: party.revision,
      reason: "x".repeat(500),
    });

    expect(answer.status).toBe(200);
  });
});

describe("bills already presented", () => {
  it("files no second invoice for a bill invoiced when it was placed, and records what that invoice still owes", async () => {
    const party = await seatedWith(venue, "Caña");
    const placedId = await placedCounterBillMovedTo(invoiceFirstZone, party);
    await creditTwoEuros(placedId);
    const [invoiced] = await salesOf(placedId);

    const answer = await depart(party.partyId, {
      expectedPartyRevision: revisionOf(party.partyId),
      reason: REASON,
    });

    expect(answer.status).toBe(200);
    expect(registroCount(venue, placedId)).toBe(1);
    expect(await salesOf(placedId)).toEqual([invoiced]);
    expect(await departuresOf(placedId)).toEqual([
      expect.objectContaining({ saleId: invoiced!.id, amount: 1558 }),
    ]);
    expect(registroCount(venue, party.tabId)).toBe(1);
    expect(await departuresOf(party.tabId)).toEqual([expect.objectContaining({ amount: 300 })]);
  });

  it("invoices in full a bill placed without an invoice", async () => {
    const party = await seatedWith(venue, "Caña");
    const placedId = await placedCounterBillMovedTo(prepayZone, party);
    expect(await salesOf(placedId)).toEqual([]);

    const answer = await depart(party.partyId, {
      expectedPartyRevision: revisionOf(party.partyId),
      reason: REASON,
    });

    expect(answer.status).toBe(200);
    expect(registroCount(venue, placedId)).toBe(1);
    const [invoiced] = await salesOf(placedId);
    expect(invoiced).toMatchObject({ total: 1800, settledAt: null });
    expect(await statusOf(venue, placedId)).toBe("placed");
    expect(await departuresOf(placedId)).toEqual([
      expect.objectContaining({ saleId: invoiced!.id, amount: 1800 }),
    ]);
  });
});

describe("the party's other bills", () => {
  it("abandons an empty bill, as Finish does", async () => {
    const party = await seatedWith(venue);
    const placedId = await placedCounterBillMovedTo(invoiceFirstZone, party);

    const answer = await depart(party.partyId, {
      expectedPartyRevision: revisionOf(party.partyId),
      reason: REASON,
    });

    expect(answer.status).toBe(200);
    expect(await statusOf(venue, party.tabId)).toBe("abandoned");
    expect(await departuresOf(party.tabId)).toEqual([]);
    expect(await departuresOf(placedId)).toEqual([expect.objectContaining({ amount: 1800 })]);
  });
});

describe("what is refused", () => {
  it("refuses a bill holding dishes never sent to the kitchen, and writes nothing", async () => {
    const billId = await tabWith(venue, "Botella tinto");
    const [{ partyId }] = venue.db.all<{ partyId: string }>(
      sql`select party_id as partyId from working_orders where id = ${billId}`,
    ) as [{ partyId: string }];

    const answer = await depart(partyId, {
      expectedPartyRevision: await partyRevisionOf(venue, billId),
      reason: REASON,
    });

    expect(answer).toMatchObject({
      status: 409,
      json: { code: "unpaid_departure.unfired_dishes", params: { workingOrderId: billId } },
    });
    await expectNothingWritten(partyId, billId);
  });

  it("refuses a bill holding a dish whose group is still held, then records the rest once that dish is cancelled", async () => {
    const party = await seatedWith(venue);
    const ordered = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/parties/${party.partyId}/groups`,
      {
        submissionId: randomUUID(),
        expectedPartyRevision: party.revision,
        groups: [
          {
            lines: [{ menuItemId: venue.offerFor("Botella tinto"), quantity: "1" }],
            release: "fire",
          },
          { lines: [{ menuItemId: venue.offerFor("Tarta"), quantity: "1" }], release: "hold" },
        ],
      },
    );
    expect(ordered.status).toBe(200);

    const refused = await depart(party.partyId, {
      expectedPartyRevision: revisionOf(party.partyId),
      reason: REASON,
    });

    expect(refused).toMatchObject({
      status: 409,
      json: { code: "unpaid_departure.unfired_dishes", params: { workingOrderId: party.tabId } },
    });
    await expectNothingWritten(party.partyId, party.tabId);

    const cancelled = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${party.tabId}/adjustments`,
      await cancelBody(venue.db, party.tabId, 2),
    );
    expect(cancelled.status).toBe(200);

    const recorded = await depart(party.partyId, {
      expectedPartyRevision: revisionOf(party.partyId),
      reason: REASON,
    });

    expect(recorded.status).toBe(200);
    expect(registroCount(venue, party.tabId)).toBe(1);
    expect(await salesOf(party.tabId)).toEqual([
      { id: expect.any(String), total: 3000, settledAt: null },
    ]);
    expect(await departuresOf(party.tabId)).toEqual([expect.objectContaining({ amount: 3000 })]);
  });

  it("refuses a bill holding a payment, and writes nothing", async () => {
    const party = await seatedWith(venue, "Botella tinto");
    const paid = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${party.tabId}/payments`,
      {
        submissionId: randomUUID(),
        kind: "contribution",
        amount: "5.00",
        method: "cash",
        tendered: "5.00",
        applied: "5.00",
        tip: "0.00",
      },
    );
    expect(paid.status).toBe(200);

    const answer = await depart(party.partyId, {
      expectedPartyRevision: revisionOf(party.partyId),
      reason: REASON,
    });

    expect(answer).toMatchObject({
      status: 409,
      json: { code: "unpaid_departure.bill_part_paid", params: { workingOrderId: party.tabId } },
    });
    await expectNothingWritten(party.partyId, party.tabId);
  });

  it("refuses a bill being paid in full by card at the reader, and writes nothing", async () => {
    const party = await seatedWith(venue, "Botella tinto");
    venue.db.run(
      sql`update working_orders set payment_attempt_at = ${new Date().toISOString()} where id = ${party.tabId}`,
    );
    try {
      const answer = await depart(party.partyId, {
        expectedPartyRevision: party.revision,
        reason: REASON,
      });

      expect(answer).toMatchObject({
        status: 409,
        json: { code: "order.payment_in_flight", params: { workingOrderId: party.tabId } },
      });
      await expectNothingWritten(party.partyId, party.tabId);
    } finally {
      venue.db.run(
        sql`update working_orders set payment_attempt_at = null where id = ${party.tabId}`,
      );
    }
  });

  it("refuses a party with nothing outstanding: Finish is the action then", async () => {
    const party = await seatedWith(venue);

    const answer = await depart(party.partyId, {
      expectedPartyRevision: party.revision,
      reason: REASON,
    });

    expect(answer).toMatchObject({
      status: 409,
      json: { code: "unpaid_departure.nothing_outstanding", params: { partyId: party.partyId } },
    });
    expect((await partyState(party.partyId)).state).toBe("open");
  });

  it("refuses a stale party revision as Finish does, and writes nothing", async () => {
    const party = await seatedWith(venue, "Botella tinto");

    const answer = await depart(party.partyId, {
      expectedPartyRevision: party.revision - 1,
      reason: REASON,
    });

    expect(answer).toMatchObject({
      status: 409,
      json: { code: "party.out_of_date", params: { revision: party.revision } },
    });
    await expectNothingWritten(party.partyId, party.tabId);
  });

  it("answers a retry after it was recorded as Finish does a closed party, and invoices nothing twice", async () => {
    const party = await seatedWith(venue, "Botella tinto");
    const body = { expectedPartyRevision: party.revision, reason: REASON };
    expect((await depart(party.partyId, body)).status).toBe(200);

    const retried = await depart(party.partyId, body);

    expect(retried).toMatchObject({ status: 409, json: { code: "party.not_open" } });
    expect(registroCount(venue, party.tabId)).toBe(1);
    expect(await departuresOf(party.tabId)).toHaveLength(1);
  });
});

describe("a merged party", () => {
  it("invoices and records an owing bill brought by each party, and frees every table", async () => {
    const ana = await seatedWith(venue, "Botella tinto");
    const luis = await seatedWith(venue, "Pulpo");
    const joined = await send(venue.app, venue.cookie, "POST", `/api/parties/${ana.partyId}/join`, {
      tableId: luis.tableId,
      bills: "separate",
      expectedPartyRevision: revisionOf(ana.partyId),
      otherPartyId: luis.partyId,
      expectedOtherPartyRevision: revisionOf(luis.partyId),
    });
    expect(joined.status).toBe(200);

    const answer = await depart(ana.partyId, {
      expectedPartyRevision: revisionOf(ana.partyId),
      reason: REASON,
    });

    expect(answer.status).toBe(200);
    expect(registroCount(venue, ana.tabId)).toBe(1);
    expect(registroCount(venue, luis.tabId)).toBe(1);
    expect(await departuresOf(ana.tabId)).toEqual([expect.objectContaining({ amount: 3000 })]);
    expect(await departuresOf(luis.tabId)).toEqual([expect.objectContaining({ amount: 2000 })]);
    expect(await tableHeldBy(ana.tableId)).toBeNull();
    expect(await tableHeldBy(luis.tableId)).toBeNull();
  });
});

describe("the list of unpaid departures (GET /api/unpaid-departures)", () => {
  type Listed = Record<string, unknown> & { id: string };
  async function listed(): Promise<Listed[]> {
    const answer = await send(venue.app, venue.cookie, "GET", "/api/unpaid-departures");
    expect(answer.status).toBe(200);
    return answer.json as unknown as Listed[];
  }

  it("shows a departure until its bill is collected in full, which settles the invoice", async () => {
    const party = await seatedWith(venue, "Botella tinto");
    await depart(party.partyId, { expectedPartyRevision: party.revision, reason: REASON });
    const [row] = await departuresOf(party.tabId);
    const [issued] = await salesOf(party.tabId);
    const [bill] = await inTx(venue, (tx) =>
      tx
        .select({ label: workingOrders.label })
        .from(workingOrders)
        .where(eq(workingOrders.id, party.tabId)),
    );
    const [table] = await inTx(venue, (tx) =>
      tx
        .select({ label: diningTables.label })
        .from(diningTables)
        .where(eq(diningTables.id, party.tableId)),
    );

    const before = await listed();

    expect(before[0]).toEqual({
      id: row!.id,
      workingOrderId: party.tabId,
      billLabel: bill!.label,
      tableLabels: [table!.label],
      saleId: issued!.id,
      invoiceNumber: expect.stringMatching(/^A/),
      amount: "30.00",
      reason: REASON,
      recordedByName: "Sofía",
      authorizedByName: "Sofía",
      recordedAt: row!.recordedAt,
    });

    const collected = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${party.tabId}/collect`,
      { tender: { method: "cash", amount: "30.00" } },
    );

    expect(collected.status).toBe(200);
    expect((await salesOf(party.tabId))[0]!.settledAt).not.toBeNull();
    expect(registroCount(venue, party.tabId)).toBe(1);
    expect((await listed()).map((entry) => entry.id)).not.toContain(row!.id);
  });

  it("leaves out a departure whose invoice has been voided", async () => {
    const party = await seatedWith(venue, "Caña");
    await depart(party.partyId, { expectedPartyRevision: party.revision, reason: REASON });
    const [issued] = await salesOf(party.tabId);
    expect((await listed()).map((entry) => entry.workingOrderId)).toContain(party.tabId);

    await inTx(venue, async (tx) => {
      const session = await loginWithPin(tx, {
        tillId: venue.cfg.tillId,
        personId: venue.adminId,
        pin: "1234",
      });
      await recordVoid(tx, venue.backend, brandSaleId(issued!.id), "Error de cobro", {
        sessionId: session.id,
      });
    });

    expect((await listed()).map((entry) => entry.workingOrderId)).not.toContain(party.tabId);
  });

  it("lists the newest departure first", async () => {
    const first = await seatedWith(venue, "Caña");
    await depart(first.partyId, { expectedPartyRevision: first.revision, reason: "primera" });
    const second = await seatedWith(venue, "Caña");
    await depart(second.partyId, { expectedPartyRevision: second.revision, reason: "segunda" });

    const ids = (await listed()).map((entry) => entry.workingOrderId);

    expect(ids.indexOf(second.tabId)).toBeLessThan(ids.indexOf(first.tabId));
  });

  it("answers a caller with no session with session.required", async () => {
    const answer = await send(venue.app, "", "GET", "/api/unpaid-departures");
    expect(answer).toMatchObject({ status: 401, json: { code: "session.required" } });
  });
});
