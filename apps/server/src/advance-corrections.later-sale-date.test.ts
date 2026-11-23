import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { billAdvances, invoiceSeries, sales } from "@waitron/db";
import { formatInvoiceNumber } from "@waitron/core";
import { listAdjustmentReasons } from "@waitron/adjustments";
import { settlePendingBillPayments } from "./bill-payments-loop.js";
import { listAccountantExport } from "./accountant-export.js";
import { advanceBills, provisionAdvanceVenue, type AdvanceVenue } from "./testing/advance-bills.js";
import { inTx, send, statusOf } from "./testing/bill-venue.js";
import { capturedPending, clockAtIso, filedFor } from "./testing/later-sale-date-fixture.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import "./errors.js";

// The area's dine-in rate: 10%, and 4% from Sunday 15 March 2026.
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
            { from: null, rate: "10.00" },
            { from: "2026-03-15", rate: "4.00" },
          ],
        }
      );
    },
  };
});

let advanceVenue: AdvanceVenue;

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

const venue = () => advanceVenue.venue;
const { seated } = advanceBills(() => advanceVenue);
const supervisor = () => ({ personId: venue().adminId, pin: "1234" });

// Europe/Madrid (UTC+1 in March): the advance and the card for the rest taken at 23:50 on
// 14 March, the card recovered and the correction ended at 09:10 on 15 March.
const ACCEPTED = "2026-03-14T22:50:00.000Z";
const NEXT_MORNING = "2026-03-15T08:10:00.000Z";

/** A €120 bill at 10% with a €30 cash advance and a €90 card captured for the rest, both taken at
 * 23:50 on 14 March, the card's bill payment left pending for recovery, on a venue of its own. */
async function billWithStrandedCard(): Promise<{ billId: string; advanceId: string }> {
  advanceVenue = await provisionAdvanceVenue(suite.db);
  const billId = await seated("Tasting menu");
  const paid = await send(
    venue().appAt(clockAtIso(ACCEPTED)),
    venue().cookie,
    "POST",
    `/api/working-orders/${billId}/payments`,
    {
      submissionId: randomUUID(),
      kind: "contribution",
      amount: "30.00",
      method: "cash",
      tendered: "30.00",
      applied: "30.00",
      tip: "0.00",
      ownReceipt: true,
    },
  );
  expect(paid.status, JSON.stringify(paid.json)).toBe(200);
  const [advance] = await inTx(venue(), (tx) =>
    tx.select().from(billAdvances).where(eq(billAdvances.workingOrderId, billId)),
  );
  await capturedPending(venue(), billId, 9000, { bill: ACCEPTED, card: ACCEPTED });
  return { billId, advanceId: advance!.advanceSaleId };
}

const recoverNextMorning = () =>
  settlePendingBillPayments({
    admission: testTradingAdmission(),
    db: venue().db,
    backend: venue().backend,
    clock: clockAtIso(NEXT_MORNING),
    cfg: venue().cfg,
  });

describe("the rest's invoice of a bill whose card was recovered the next day", () => {
  it("without a correction: recovery files 14 March and rates the meal and the advance taken off at 14 March's 10%", async () => {
    const { billId } = await billWithStrandedCard();

    expect(await recoverNextMorning()).toMatchObject({ received: 1 });

    expect(await statusOf(venue(), billId)).toBe("settled");
    const { supplyDay, record, rates } = await filedFor(venue(), billId);
    expect({ supplyDay, record, rates }).toEqual({
      supplyDay: "2026-03-14",
      record: { operationDate: "2026-03-14", issueDate: "2026-03-15" },
      rates: [1000, 1000],
    });
  });

  it("held by the advance's open correction: Discard the next morning files it as recovery would, 14 March at 10%", async () => {
    const { billId, advanceId } = await billWithStrandedCard();
    const [reason] = await inTx(venue(), (tx) => listAdjustmentReasons(tx));
    const opened = await send(
      venue().app,
      venue().cookie,
      "POST",
      `/api/transactions/${advanceId}/corrections`,
      {
        submissionId: randomUUID(),
        gross: "30.00",
        reasonId: reason!.id,
        note: "Paid too much",
        expectedSplit: [{ rate: "10.00", base: "27.27", tax: "2.73" }],
        override: supervisor(),
      },
    );
    expect(opened.status, JSON.stringify(opened.json)).toBe(200);
    const correctionId = (opened.json as { correction: { id: string } }).correction.id;
    expect(await recoverNextMorning()).toMatchObject({ received: 1 });
    expect(await statusOf(venue(), billId)).toBe("open");

    const discarded = await send(
      venue().appAt(clockAtIso(NEXT_MORNING)),
      venue().cookie,
      "POST",
      `/api/invoice-corrections/${correctionId}/close`,
      { override: supervisor() },
    );

    expect(discarded, JSON.stringify(discarded.json)).toMatchObject({
      status: 200,
      json: { state: "discarded" },
    });
    expect(await statusOf(venue(), billId)).toBe("settled");
    const { supplyDay, record, rates } = await filedFor(venue(), billId);
    expect({ supplyDay, record, rates }).toEqual({
      supplyDay: "2026-03-14",
      record: { operationDate: "2026-03-14", issueDate: "2026-03-15" },
      rates: [1000, 1000],
    });
  });
});

describe("the accountant export of a part payment paid the day before the table's receipt", () => {
  it("names the earlier part payment on the table's receipt when only the later day is exported", async () => {
    advanceVenue = await provisionAdvanceVenue(suite.db);
    const billId = await seated("Tasting menu");
    const pay = async (at: string, amount: string, ownReceipt: boolean) => {
      const paid = await send(
        venue().appAt(clockAtIso(at)),
        venue().cookie,
        "POST",
        `/api/working-orders/${billId}/payments`,
        {
          submissionId: randomUUID(),
          kind: "contribution",
          amount,
          method: "cash",
          tendered: amount,
          applied: amount,
          tip: "0.00",
          ...(ownReceipt ? { ownReceipt: true } : {}),
        },
      );
      expect(paid.status, JSON.stringify(paid.json)).toBe(200);
      return paid.json as { invoice?: { invoiceNumber: string } };
    };
    await pay("2026-03-12T12:00:00.000Z", "30.00", true);
    const [advance] = await inTx(venue(), (tx) =>
      tx.select().from(billAdvances).where(eq(billAdvances.workingOrderId, billId)),
    );
    await pay("2026-03-13T12:00:00.000Z", "90.00", false);
    const [rest] = await inTx(venue(), (tx) =>
      tx.select({ id: sales.id }).from(sales).where(eq(sales.workingOrderId, billId)),
    );
    const [advanceSale] = await inTx(venue(), (tx) =>
      tx
        .select({ code: invoiceSeries.code, number: sales.invoiceNumber })
        .from(sales)
        .innerJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
        .where(eq(sales.id, advance!.advanceSaleId)),
    );

    const exported = await inTx(venue(), (tx) =>
      listAccountantExport(tx, { from: "2026-03-13", to: "2026-03-13" }),
    );

    expect(exported.invoices.map((invoice) => invoice.id)).toEqual([rest!.id]);
    expect(exported.invoices[0]!.takesOff).toEqual([
      formatInvoiceNumber(advanceSale!.code, advanceSale!.number),
    ]);
  });
});
