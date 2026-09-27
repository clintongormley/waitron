import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { captureError, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { TrustedClock } from "@waitron/fiscal";
import { computeDailyClose, recordDailyClose } from "@waitron/reporting";
import type { CashCountInput } from "@waitron/reporting";
import { AppError, tillId as brandTillId } from "@waitron/shared";
import {
  paymentRows,
  provisionBillVenue,
  send,
  systemClock,
  tabWith,
  tendersOfBill,
  type Answer,
  type BillVenue,
} from "./testing/bill-venue.js";
import "./errors.js";

// Bill payments design §8 tests 24–27: the cash-up counts money on the day and till it moves,
// driven through the till's routes on a clock set to each day. Each case uses days of its own, so a
// day's cash-up is that case's alone.
let venue: BillVenue;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
  },
});

const CLOSED_BY = "cccccccc-0000-4000-8000-000000000001";

/** Noon in Madrid (CET, UTC+1) on `day`, well past the venue's 05:00 cutover. */
function noonOn(day: string): TrustedClock {
  const base = systemClock();
  const instant = new Date(`${day}T11:00:00.000Z`);
  return { ...base, now: () => ({ ...base.now(), instant }) };
}

function post(day: string, cookie: string, path: string, body: unknown): Promise<Answer> {
  return send(venue.appAt(noonOn(day)), cookie, "POST", path, body);
}

function cashContribution(day: string, cookie: string, billId: string, amount: string) {
  return post(day, cookie, `/api/working-orders/${billId}/payments`, {
    submissionId: randomUUID(),
    kind: "contribution",
    amount,
    method: "cash",
    tendered: amount,
    applied: amount,
    tip: "0.00",
  });
}

function manualCard(day: string, cookie: string, billId: string, amount: string) {
  return post(day, cookie, `/api/working-orders/${billId}/payments`, {
    submissionId: randomUUID(),
    kind: "contribution",
    amount,
    method: "card",
    entry: "manual",
    externalRef: `OP-${randomUUID().slice(0, 8)}`,
    applied: amount,
    tip: "0.00",
  });
}

function cashRefund(
  day: string,
  cookie: string,
  billId: string,
  paymentId: string,
  amount: string,
) {
  return post(day, cookie, `/api/working-orders/${billId}/payments/${paymentId}/refunds`, {
    submissionId: randomUUID(),
    appliedAmount: amount,
    tipAmount: "0.00",
    reason: "Cobrado de más",
    override: { personId: venue.adminId, pin: "1234" },
  });
}

function paymentIdOf(paid: Answer): string {
  return (paid.json.payment as { id: string }).id;
}

function closeInput(businessDay: string) {
  return {
    nodeId: venue.cfg.nodeId,
    businessDay,
    timeZone: "Europe/Madrid",
    dayCutover: "05:00",
  };
}

function dailyClose(businessDay: string) {
  return withTransaction(venue.db, (tx) => computeDailyClose(tx, closeInput(businessDay)));
}

function freeze(businessDay: string, cashCounts: CashCountInput[]) {
  return withTransaction(venue.db, (tx) =>
    recordDailyClose(tx, { ...closeInput(businessDay), closedBy: CLOSED_BY, cashCounts }),
  );
}

async function refusedClose(businessDay: string, cashCounts: CashCountInput[]) {
  const error = await captureError(() => freeze(businessDay, cashCounts));
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
}

describe("the cash-up counts money on the day and till it moves (bill payments design §9a)", () => {
  it("counts day 1's cash on its till, and day 2's card on its till, once each (test 24)", async () => {
    const tillA = brandTillId(venue.deviceTillId);
    const tillB = brandTillId(venue.device2TillId);
    const billId = await tabWith(venue, "Paella", "Chuletón", "Botella tinto", "Ensalada", "Tarta");

    expect((await cashContribution("2026-03-10", venue.cookie, billId, "50.00")).status).toBe(200);
    const day1 = await dailyClose("2026-03-10");
    expect(day1.cash).toEqual({
      byTill: [
        {
          tillId: tillA,
          byMethod: [{ method: "cash", amount: "50.00", tip: "0.00" }],
          cashTakings: "50.00",
        },
      ],
      tenderTotal: "50.00",
      tipTotal: "0.00",
    });
    expect(day1.vat.byRate).toEqual([]);
    expect(day1.counts.sales).toBe(0);

    const last = await manualCard("2026-03-11", venue.cookie2, billId, "70.00");
    expect(last.status).toBe(200);
    expect(last.json.invoice).toMatchObject({ total: "120.00" });
    // The invoice was filed at till B with a tender for each payment, so a cash-up that read them
    // would count day 1's €50.00 again, on till B.
    expect(
      (await tendersOfBill(venue, billId)).map((t) => [t.method, t.saleTillId]).sort(),
    ).toEqual([
      ["card", tillB],
      ["cash", tillB],
    ]);

    expect((await dailyClose("2026-03-10")).cash).toEqual(day1.cash);
    const day2 = await dailyClose("2026-03-11");
    expect(day2.cash).toEqual({
      byTill: [
        {
          tillId: tillB,
          byMethod: [{ method: "card", amount: "70.00", tip: "0.00" }],
          cashTakings: "0.00",
        },
      ],
      tenderTotal: "70.00",
      tipTotal: "0.00",
    });
    expect(day2.vat.grossTotal).toBe("120.00");

    expect(await refusedClose("2026-03-10", [])).toMatchObject({
      code: "close.invalid_cash_input",
      params: { tillId: tillA, reason: "uncounted_cash_till" },
    });
    const frozen = await freeze("2026-03-10", [
      { tillId: tillA, openingFloat: "100.00", payouts: "0.00", countedCash: "150.00" },
    ]);
    expect(frozen.snapshot.cashReconciliation.byTill).toMatchObject([
      { tillId: tillA, cashTakings: "50.00", cashVariance: "0.00" },
    ]);
  });

  it("subtracts a refund given on another day at another till, and forces that till's count (test 25)", async () => {
    const tillA = brandTillId(venue.deviceTillId);
    const tillB = brandTillId(venue.device2TillId);
    const billId = await tabWith(venue, "Paella", "Chuletón", "Botella tinto", "Ensalada", "Tarta");
    const paymentId = paymentIdOf(
      await cashContribution("2026-03-12", venue.cookie, billId, "50.00"),
    );
    expect((await cashRefund("2026-03-13", venue.cookie2, billId, paymentId, "20.00")).status).toBe(
      200,
    );

    expect((await dailyClose("2026-03-12")).cash.byTill).toEqual([
      {
        tillId: tillA,
        byMethod: [{ method: "cash", amount: "50.00", tip: "0.00" }],
        cashTakings: "50.00",
      },
    ]);
    expect((await dailyClose("2026-03-13")).cash).toEqual({
      byTill: [
        {
          tillId: tillB,
          byMethod: [{ method: "cash", amount: "-20.00", tip: "0.00" }],
          cashTakings: "-20.00",
        },
      ],
      tenderTotal: "-20.00",
      tipTotal: "0.00",
    });

    expect(await refusedClose("2026-03-13", [])).toMatchObject({
      code: "close.invalid_cash_input",
      params: { tillId: tillB, reason: "uncounted_cash_till" },
    });
    const frozen = await freeze("2026-03-13", [
      { tillId: tillB, openingFloat: "100.00", payouts: "0.00", countedCash: "80.00" },
    ]);
    expect(frozen.snapshot.cashReconciliation.byTill).toMatchObject([
      { tillId: tillB, cashTakings: "-20.00", cashVariance: "0.00" },
    ]);
  });

  it("counts a walk-up cash sale's tender exactly once, as before (test 26)", async () => {
    const res = await venue.appAt(noonOn("2026-03-14")).request("/api/sales", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: venue.cookie },
      body: JSON.stringify({
        lines: [{ menuItemId: venue.offerFor("Caña"), quantity: "2" }],
        tender: { method: "cash", amount: "6.00" },
        zoneId: venue.zoneId,
      }),
    });
    expect(res.status).toBe(200);

    expect((await dailyClose("2026-03-14")).cash).toEqual({
      byTill: [
        {
          tillId: venue.deviceTillId,
          byMethod: [{ method: "cash", amount: "6.00", tip: "0.00" }],
          cashTakings: "6.00",
        },
      ],
      tenderTotal: "6.00",
      tipTotal: "0.00",
    });
  });

  it("forces a count for a till whose cash nets to zero, but not for a card-only till (test 27)", async () => {
    const billId = await tabWith(venue, "Paella", "Chuletón", "Botella tinto", "Ensalada", "Tarta");
    const paid = await cashContribution("2026-03-15", venue.cookieNoCard, billId, "50.00");
    const paymentId = paymentIdOf(paid);
    expect(
      (await cashRefund("2026-03-15", venue.cookieNoCard, billId, paymentId, "50.00")).status,
    ).toBe(200);
    // The control: a card taken on another till the same day.
    expect((await manualCard("2026-03-15", venue.cookie2, billId, "30.00")).status).toBe(200);
    const tillC = brandTillId(
      (await paymentRows(venue, billId)).find((row) => row.id === paymentId)!.tillId,
    );

    const day = await dailyClose("2026-03-15");
    expect(day.cash.byTill.find((t) => t.tillId === tillC)).toEqual({
      tillId: tillC,
      byMethod: [{ method: "cash", amount: "0.00", tip: "0.00" }],
      cashTakings: "0.00",
    });

    expect(await refusedClose("2026-03-15", [])).toMatchObject({
      code: "close.invalid_cash_input",
      params: { tillId: tillC, reason: "uncounted_cash_till" },
    });
    const frozen = await freeze("2026-03-15", [
      { tillId: tillC, openingFloat: "100.00", payouts: "0.00", countedCash: "100.00" },
    ]);
    expect(frozen.snapshot.cashReconciliation.byTill).toMatchObject([
      { tillId: tillC, cashTakings: "0.00", cashVariance: "0.00" },
    ]);
    expect(frozen.snapshot.close.cash.byTill.map((t) => t.tillId).sort()).toEqual(
      [tillC, venue.device2TillId].sort(),
    );
  });
});
