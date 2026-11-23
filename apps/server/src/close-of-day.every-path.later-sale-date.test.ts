import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { readVenueClock, withTransaction } from "@waitron/db";
import { closeOfDayConfig, issueBillAtClose } from "./close-of-day.js";
import { settlePendingBillPayments } from "./bill-payments-loop.js";
import {
  cashPayment,
  provisionBillVenue,
  seatedHeldWith,
  seatedWith,
  send,
  statusOf,
  type BillVenue,
} from "./testing/bill-venue.js";
import {
  capturedPending,
  clockAtIso as clockAt,
  filedFor,
} from "./testing/later-sale-date-fixture.js";
import { paySavedBillInCash } from "./testing/bill-payment-fixture.js";
import { placeOrder } from "./testing/order-writer-fixture.js";
import { closingEditsForTest } from "./testing/party-close-fixture.js";
import { openTillSession } from "./testing/session-device.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { parkOrder } from "./working-order.js";
import "./errors.js";

// The area's dine-in rate: 21%, and 10% from Wednesday 18 March 2026.
vi.mock("@waitron/country-packs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@waitron/country-packs")>();
  return {
    ...actual,
    vatRatesFor: (...args: Parameters<typeof actual.vatRatesFor>) => {
      const rates = actual.vatRatesFor(...args);
      return (
        rates && {
          ...rates,
          dineIn: [
            { from: null, rate: "21.00" },
            { from: "2026-03-18", rate: "10.00" },
          ],
        }
      );
    },
  };
});

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

// Europe/Madrid, UTC+1 in March, its business day turning over at 05:00. 16 March 2026 is a
// Monday, so Monday's business day ends at 05:00 on Tuesday 17 March.
const MON_2200 = "2026-03-16T21:00:00.000Z";
const MON_2230 = "2026-03-16T21:30:00.000Z";
const TUE_0030 = "2026-03-16T23:30:00.000Z";
const TUE_0500 = "2026-03-17T04:00:00.000Z";
const TUE_0501 = "2026-03-17T04:01:00.000Z";
const WED_1100 = "2026-03-18T10:00:00.000Z";
const WED_235959 = "2026-03-18T22:59:59.900Z";
const THU_0000 = "2026-03-18T23:00:00.100Z";
const THU_1200 = "2026-03-19T11:00:00.000Z";

function openedAt(venue: BillVenue, billId: string, at: string): void {
  venue.db.run(sql`update working_orders set trusted_opened_at = ${at} where id = ${billId}`);
}

/** A table bill of Croquettes (10.00), its dish sent, opened at 22:00 on Monday. */
async function mondayBill(venue: BillVenue) {
  const party = await seatedWith(venue, "Croquettes");
  openedAt(venue, party.tabId, MON_2200);
  return party;
}

function cashSale(venue: BillVenue, at: string, billId: string) {
  return cashPayment(
    { db: venue.db, app: venue.appAt(clockAt(at)) },
    venue.cookie,
    billId,
    "10.00",
  );
}

function partyRevisionNow(venue: BillVenue, partyId: string): number {
  return venue.db.all<{ revision: number }>(
    sql`select revision from parties where id = ${partyId}`,
  )[0]!.revision;
}

async function expectCloseOfDay(venue: BillVenue, billId: string, issueDay: string) {
  const { supplyDay, ticket, record, rates } = await filedFor(venue, billId);
  expect(supplyDay).toBe("2026-03-17");
  expect(ticket.saleDay).toBe("2026-03-17");
  expect(record).toEqual({ operationDate: "2026-03-17", issueDate: issueDay });
  expect(rates).toEqual([2100]);
}

async function expectOneDate(venue: BillVenue, billId: string, issueDay: string, rate: number) {
  const { supplyDay, ticket, record, rates } = await filedFor(venue, billId);
  expect(supplyDay).toBeNull();
  expect(ticket).not.toHaveProperty("saleDay");
  expect(record).toEqual({ operationDate: null, issueDate: issueDay });
  expect(rates).toEqual([rate]);
}

describe("a table bill issued after the business day it was opened in ended", () => {
  it("files the end of that day when cash pays it in full on Thursday, before the close of day ran", async () => {
    const venue = await provisionBillVenue(suite.db);
    const party = await mondayBill(venue);

    const paid = await cashSale(venue, THU_1200, party.tabId);

    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    expect(await statusOf(venue, party.tabId)).toBe("settled");
    await expectCloseOfDay(venue, party.tabId, "2026-03-19");
  });

  it("files the end of that day when a card taken live on Thursday pays it", async () => {
    const venue = await provisionBillVenue(suite.db);
    const party = await mondayBill(venue);

    const paid = await send(
      venue.appAt(clockAt(THU_1200)),
      venue.cookie,
      "POST",
      `/api/working-orders/${party.tabId}/payments`,
      {
        submissionId: party.tabId,
        kind: "share",
        shareOf: 1,
        method: "card",
        entry: "reader",
        applied: "10.00",
        tip: "0.00",
      },
    );

    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    expect(paid.json.outcome).toBe("received");
    await expectCloseOfDay(venue, party.tabId, "2026-03-19");
  });

  it("files the end of that day, not the later acceptance, when the close waited for a card the recovery completes", async () => {
    const venue = await provisionBillVenue(suite.db);
    const party = await mondayBill(venue);
    await capturedPending(venue, party.tabId, 1000, { bill: MON_2230, card: WED_1100 });
    const closed = await withTransaction(venue.db, async (tx) =>
      issueBillAtClose(
        tx,
        {
          admission: testTradingAdmission(),
          db: venue.db,
          backend: venue.backend,
          clock: clockAt(TUE_0501),
        },
        closeOfDayConfig(venue.cfg),
        party.tabId,
        { dayStartedAt: new Date(TUE_0500), venueClock: await readVenueClock(tx) },
      ),
    );
    expect(closed).toEqual({ kind: "money_moving" });

    expect(
      await settlePendingBillPayments({
        admission: testTradingAdmission(),
        db: venue.db,
        backend: venue.backend,
        clock: clockAt(THU_1200),
        cfg: venue.cfg,
      }),
    ).toMatchObject({ received: 1 });

    expect(await statusOf(venue, party.tabId)).toBe("settled");
    await expectCloseOfDay(venue, party.tabId, "2026-03-19");
  });

  it("files the card's own Monday when the recovery completes on Thursday a card accepted before the day ended", async () => {
    const venue = await provisionBillVenue(suite.db);
    const party = await mondayBill(venue);
    await capturedPending(venue, party.tabId, 1000, { bill: MON_2230, card: MON_2230 });

    expect(
      await settlePendingBillPayments({
        admission: testTradingAdmission(),
        db: venue.db,
        backend: venue.backend,
        clock: clockAt(THU_1200),
        cfg: venue.cfg,
      }),
    ).toMatchObject({ received: 1 });

    const { supplyDay, record, rates } = await filedFor(venue, party.tabId);
    expect(supplyDay).toBe("2026-03-16");
    expect(record).toEqual({ operationDate: "2026-03-16", issueDate: "2026-03-19" });
    expect(rates).toEqual([2100]);
  });

  it("files the end of that day when the bill is printed (Print the bill) on Thursday", async () => {
    const venue = await provisionBillVenue(suite.db);
    const party = await mondayBill(venue);
    venue.db.run(sql`
      update device_profiles
      set capabilities = json_insert(capabilities, '$[#]', 'print-receipt')
      where name = 'Counter till'
    `);

    const printed = await send(
      venue.appAt(clockAt(THU_1200)),
      venue.cookie,
      "POST",
      `/api/parties/${party.partyId}/end-meal`,
      {
        billId: party.tabId,
        expectedPartyRevision: partyRevisionNow(venue, party.partyId),
        expectedEdits: await withTransaction(venue.db, (tx) =>
          closingEditsForTest(tx, party.partyId),
        ),
        submissionId: randomUUID(),
        printAnyway: true,
      },
    );

    expect(printed.status, JSON.stringify(printed.json)).toBe(200);
    await expectCloseOfDay(venue, party.tabId, "2026-03-19");
  });

  it("keeps one date when the bill holds a dish the kitchen was never asked for, which the close leaves open", async () => {
    const venue = await provisionBillVenue(suite.db);
    const party = await seatedHeldWith(venue, "Croquettes");
    openedAt(venue, party.tabId, MON_2200);

    const paid = await cashSale(venue, THU_1200, party.tabId);

    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    await expectOneDate(venue, party.tabId, "2026-03-19", 1000);
  });

  it("keeps one date for a takeaway opened on Monday and paid on Thursday", async () => {
    const venue = await provisionBillVenue(suite.db);
    const id = randomUUID();
    const deps = { db: venue.db, backend: venue.backend, clock: venue.clock };
    await parkOrder(deps, venue.cfg, {
      id,
      lines: [{ menuItemId: venue.offerFor("Croquettes"), quantity: "1" }],
      zoneId: venue.zoneId,
      operatorId: venue.operatorId,
    });
    openedAt(venue, id, MON_2200);
    await placeOrder(
      { ...deps, admission: testTradingAdmission() },
      venue.cfg,
      id,
      venue.operatorId,
    );

    const paid = await cashSale(venue, THU_1200, id);

    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    await expectOneDate(venue, id, "2026-03-19", 1000);
  });

  it("keeps one date when cash pays it after midnight but before its business day ended", async () => {
    const venue = await provisionBillVenue(suite.db);
    const party = await mondayBill(venue);

    const paid = await cashSale(venue, TUE_0030, party.tabId);

    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    await expectOneDate(venue, party.tabId, "2026-03-17", 2100);
  });

  it("dates the issue by the payment's one clock reading when the clock passes Madrid midnight after it", async () => {
    const venue = await provisionBillVenue(suite.db);
    const party = await mondayBill(venue);
    const paymentReading = clockAt(WED_235959).now();
    const afterMidnight = clockAt(THU_0000).now();
    const now = vi.fn(() => afterMidnight).mockReturnValueOnce(paymentReading);
    const sessionId = await openTillSession(venue.db, {
      personId: venue.operatorId,
      deviceId: venue.cfg.origin.deviceId,
    });

    await paySavedBillInCash(
      { ...venue, clock: { ...venue.clock, now }, admission: testTradingAdmission() },
      venue.cfg,
      { personId: venue.operatorId, sessionId },
      party.tabId,
      "10.00",
    );

    await expectCloseOfDay(venue, party.tabId, "2026-03-18");
    expect(
      venue.db.all(sql`select settled_at from working_orders where id = ${party.tabId}`),
    ).toEqual([{ settled_at: WED_235959 }]);
    expect(now).toHaveBeenCalledTimes(1);
  });
});
