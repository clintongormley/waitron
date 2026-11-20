import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  billAdvances,
  captureError,
  readLiveSeriesIdTx,
  saleLines,
  sales,
  tenderRefunds,
  tenders,
  type Transaction,
} from "@waitron/db";
import { listAdjustmentReasons } from "@waitron/adjustments";
import { recordCorrection } from "@waitron/core";
import {
  centsToDecimal,
  decimal,
  saleId as brandSaleId,
  seriesId as brandSeriesId,
  sumDecimals,
} from "@waitron/shared";
import { filedInvoicesOf } from "@waitron/fiscal-verifactu/test/invoice-records.js";
import { reversedLines } from "./cancel-credit.js";
import { readBillBalance } from "./bill-payments.js";
import { hashSessionToken, tillSessions } from "@waitron/identity";
import { sessionCookieForTest } from "./testing/session-device.js";
import {
  advanceBills,
  printed,
  provisionAdvanceVenue,
  spanish,
  type AdvanceVenue,
} from "./testing/advance-bills.js";
import { inTx, send } from "./testing/bill-venue.js";
import "./errors.js";

// Correcting a bill's advances and the invoice that takes them off (advances plan, Task 1.6a),
// driven through the till's routes against a venue that files real Veri*Factu records.
let advanceVenue: AdvanceVenue;
/** The administrator's shift session on the second till, and its cookie. */
let adminSessionId: string;
let adminCookie: string;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    advanceVenue = await provisionAdvanceVenue(db);
    const token = randomUUID();
    const [session] = await db
      .insert(tillSessions)
      .values({
        deviceId: advanceVenue.venue.device2Id,
        personId: advanceVenue.venue.adminId,
        tokenHash: hashSessionToken(token),
      })
      .returning({ id: tillSessions.id });
    adminSessionId = session!.id;
    adminCookie = await sessionCookieForTest(db, token);
  },
});

const venue = () => advanceVenue.venue;
const { seated, advance, payRest, restId, advanceFacts, caption, readTicket } = advanceBills(
  () => advanceVenue,
);
const supervisor = () => ({ personId: venue().adminId, pin: "1234" });

type Split = { rate: string; base: string; tax: string }[];

const preview = (saleId: string, gross: string, lineIds?: string[]) =>
  send(venue().app, venue().cookie, "POST", `/api/transactions/${saleId}/corrections/preview`, {
    gross,
    ...(lineIds === undefined ? {} : { lineIds }),
  });

/** Opens Correct invoice on `saleId` for `gross`, expecting `split`; the route's answer. */
async function open(saleId: string, gross: string, split: Split, lineIds?: string[]) {
  const [reason] = await inTx(venue(), (tx) => listAdjustmentReasons(tx));
  return send(venue().app, venue().cookie, "POST", `/api/transactions/${saleId}/corrections`, {
    submissionId: randomUUID(),
    gross,
    reasonId: reason!.id,
    note: "Sent back",
    expectedSplit: split,
    ...(lineIds === undefined ? {} : { lineIds }),
    override: supervisor(),
  });
}

/** Corrects `saleId` by `gross` through Correct invoice, giving it back in cash; the corrective's id. */
async function correct(
  saleId: string,
  gross: string,
  split: Split,
  lineIds?: string[],
): Promise<string> {
  const opened = await open(saleId, gross, split, lineIds);
  expect(opened.status, JSON.stringify(opened.json)).toBe(200);
  const correctionId = (opened.json as { correction: { id: string } }).correction.id;
  const filed = await send(
    venue().app,
    venue().cookie,
    "POST",
    `/api/invoice-corrections/${correctionId}/cash`,
    { submissionId: randomUUID(), amount: gross, override: supervisor() },
  );
  expect(filed.status, JSON.stringify(filed.json)).toBe(200);
  const rows = await inTx(venue(), (tx) =>
    tx.select({ id: sales.id }).from(sales).where(eq(sales.correctsSaleId, saleId)),
  );
  return rows.at(-1)!.id;
}

/** The one filed record of `saleId`, refused by none of AEAT's checks, as rate/base/tax rows. */
function recordOf(saleId: string): string[][] {
  const records = filedInvoicesOf(venue().db, saleId, new Date());
  expect(records).toHaveLength(1);
  expect(records[0]!.errors).toEqual([]);
  return records[0]!.breakdown.map((row) => [...row]).sort();
}

async function linesOf(saleId: string) {
  return inTx(venue(), (tx) =>
    tx.select().from(saleLines).where(eq(saleLines.saleId, saleId)).orderBy(saleLines.lineNo),
  );
}

/** The bill's rest's invoice once `dishes` were served, `advances` paid on account and `rest`
 * paid. */
async function restOf(dishes: string[], advances: string[], rest: string) {
  const billId = await seated(...dishes);
  const advanceIds: string[] = [];
  for (const amount of advances) advanceIds.push(await advance(billId, amount));
  await payRest(billId, rest);
  const saleId = await restId(billId);
  const lines = await linesOf(saleId);
  return {
    billId,
    saleId,
    advanceIds,
    dishIds: lines.filter((line) => line.advanceRole === null).map((line) => line.id),
    deductionId: lines.find((line) => line.advanceRole === "deduction")!.id,
  };
}

/** What `recordCorrection` needs besides the amounts, for a correction of `saleId` by the venue's
 * administrator. */
async function correctionOf(tx: Transaction, saleId: string) {
  return {
    origin: venue().cfg.origin,
    operationDescription: "Sale on premises",
    nodeId: venue().cfg.nodeId,
    seriesId: brandSeriesId(await readLiveSeriesIdTx(tx, venue().cfg.nodeId, "rectificative")),
    correctsSaleId: brandSaleId(saleId),
    authz: { sessionId: adminSessionId },
    clock: venue().clock,
  };
}

function linesIn(tx: Transaction, saleId: string) {
  return tx.select().from(saleLines).where(eq(saleLines.saleId, saleId)).orderBy(saleLines.lineNo);
}

describe("a plain refund of an advance's own ticket", () => {
  it("is refused, naming Correct invoice on the advance's ticket, with or without a supervisor's override, and the bill still holds the advance", async () => {
    const billId = await seated("Tasting menu");
    const advanceId = await advance(billId, "30.00");
    const [tender] = await inTx(venue(), (tx) =>
      tx.select({ id: tenders.id }).from(tenders).where(eq(tenders.saleId, advanceId)),
    );
    const { invoiceNumber } = await advanceFacts(advanceId);
    const refund = (extra: Record<string, unknown>, cookie = venue().cookie) =>
      send(venue().app, cookie, "POST", `/api/transactions/${advanceId}/refunds`, {
        submissionId: randomUUID(),
        tenderId: tender!.id,
        appliedAmount: "30.00",
        tipAmount: "0.00",
        reason: "Changed their mind",
        ...extra,
      });

    for (const refused of [
      await refund({}, adminCookie),
      await refund({ override: supervisor() }),
    ]) {
      expect(refused.status, JSON.stringify(refused.json)).toBe(409);
      expect(refused.json).toEqual({
        code: "tender.refund_of_advance",
        params: { tenderId: tender!.id, saleId: advanceId, invoiceNumber },
      });
    }

    expect(
      await inTx(venue(), (tx) =>
        tx.select().from(tenderRefunds).where(eq(tenderRefunds.saleId, advanceId)),
      ),
    ).toEqual([]);
    expect(
      await inTx(venue(), (tx) => readBillBalance(tx, billId, decimal("120.00"))),
    ).toMatchObject({ received: "30.00", outstanding: "90.00" });
  });
});

describe("Correct invoice on the rest's invoice", () => {
  it("example 1: never takes from the deduction line, and the preview shows what the writer files", async () => {
    const rest = await restOf(["Tasting menu"], ["30.00"], "90.00");
    const split = [{ rate: "10.00", base: "9.09", tax: "0.91" }];

    expect(await preview(rest.saleId, "10.00")).toMatchObject({
      status: 200,
      json: { gross: "10.00", vatBreakdown: split },
    });
    const corrective = await correct(rest.saleId, "10.00", split);

    expect(recordOf(corrective)).toEqual([["10.00", "-9.09", "-0.91"]]);
    expect((await linesOf(corrective)).map((line) => line.correctsLineId)).toEqual(rest.dishIds);
  });

  it("the advance's deduction line cannot be chosen: the lines route leaves it out and a request naming it is refused", async () => {
    const rest = await restOf(["Tasting menu"], ["30.00"], "90.00");
    const listed = await send(
      venue().app,
      venue().cookie,
      "GET",
      `/api/transactions/${rest.saleId}/corrections/lines`,
    );
    expect((listed.json as { lines: { id: string }[] }).lines.map((line) => line.id)).toEqual(
      rest.dishIds,
    );

    const named = [rest.deductionId];
    const split = [{ rate: "10.00", base: "9.09", tax: "0.91" }];
    const refused = {
      status: 400,
      json: { code: "sale.correction_scope_invalid", params: { reason: "missing" } },
    };
    expect(await preview(rest.saleId, "10.00", named)).toEqual(refused);
    expect(await open(rest.saleId, "10.00", split, named)).toEqual(refused);
    expect(
      await inTx(venue(), (tx) =>
        tx.select({ id: sales.id }).from(sales).where(eq(sales.correctsSaleId, rest.saleId)),
      ),
    ).toEqual([]);
  });

  it("the correction lines of a rest's invoice list its dishes and not the advance's line", async () => {
    const rest = await restOf(["Salad bowl", "Wine case"], ["50.00"], "50.00");

    const answer = await send(
      venue().app,
      venue().cookie,
      "GET",
      `/api/transactions/${rest.saleId}/corrections/lines`,
    );

    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(answer.json).toMatchObject({
      lines: [
        { id: rest.dishIds[0], rate: "10.00", gross: "20.00", left: "0.00" },
        { id: rest.dishIds[1], rate: "21.00", gross: "80.00", left: "80.00" },
      ],
      moneyRefundable: "50.00",
    });
    expect((answer.json as { lines: unknown[] }).lines).toHaveLength(2);
  });

  it("example 8: one €1.05 dish files −0.95/−0.10, and five dishes, more than the rest's €4.35, are refused", async () => {
    const rest = await restOf(Array<string>(7).fill("Bread roll"), ["3.00"], "4.35");

    const one = await correct(
      rest.saleId,
      "1.05",
      [{ rate: "10.00", base: "0.95", tax: "0.10" }],
      [rest.dishIds[0]!],
    );
    expect(recordOf(one)).toEqual([["10.00", "-0.95", "-0.10"]]);

    const five = (await linesOf(rest.saleId)).filter((line) =>
      rest.dishIds.slice(1, 6).includes(line.id),
    );
    const before = await inTx(venue(), (tx) =>
      tx.select({ id: sales.id }).from(sales).where(eq(sales.correctsSaleId, rest.saleId)),
    );
    const refused = await captureError(() =>
      inTx(venue(), async (tx) =>
        recordCorrection(tx, venue().backend, {
          ...(await correctionOf(tx, rest.saleId)),
          total: "-5.25",
          lines: reversedLines(five).map((line, index) => ({ ...line, lineNo: index + 1 })),
        }),
      ),
    );

    expect(refused).toMatchObject({
      code: "sale.correction_exceeds_total",
      params: { remaining: "3.30", correction: "-5.25" },
    });
    expect(
      await inTx(venue(), (tx) =>
        tx.select({ id: sales.id }).from(sales).where(eq(sales.correctsSaleId, rest.saleId)),
      ),
    ).toEqual(before);
  });

  it("example 2: the 10% the advance more than covers has nothing to correct, and €50 at 21% files −41.32/−8.68", async () => {
    const rest = await restOf(["Salad bowl", "Wine case"], ["50.00"], "50.00");

    expect(await preview(rest.saleId, "1.00", [rest.dishIds[0]!])).toMatchObject({
      status: 409,
      json: { code: "sale.correction_amount_invalid" },
    });
    const corrective = await correct(rest.saleId, "50.00", [
      { rate: "21.00", base: "41.32", tax: "8.68" },
    ]);

    expect(recordOf(corrective)).toEqual([["21.00", "-41.32", "-8.68"]]);
  });

  it("a refund larger than the rest's invoice is refused, and the whole of the rest's invoice can be corrected", async () => {
    const rest = await restOf(["Tasting menu"], ["30.00"], "90.00");

    const refused = await open(rest.saleId, "100.00", [
      { rate: "10.00", base: "90.91", tax: "9.09" },
    ]);
    expect(refused).toMatchObject({
      status: 409,
      json: { code: "sale.correction_amount_invalid" },
    });

    const whole = await correct(rest.saleId, "90.00", [
      { rate: "10.00", base: "81.82", tax: "8.18" },
    ]);

    expect(recordOf(whole)).toEqual([["10.00", "-81.82", "-8.18"]]);
  });
});

describe("a 10% advance on a bill whose meal is all at 21%", () => {
  it("takes nothing off the 21% dishes, and what is corrected stays capped at the rest's invoice", async () => {
    const rest = await restOf(["Wine case"], ["30.00"], "50.00");
    expect(recordOf(rest.saleId)).toEqual([
      ["10.00", "-27.27", "-2.73"],
      ["21.00", "66.12", "13.88"],
    ]);

    const lines = await send(
      venue().app,
      venue().cookie,
      "GET",
      `/api/transactions/${rest.saleId}/corrections/lines`,
    );
    expect(lines.json).toEqual({
      lines: [
        expect.objectContaining({
          id: rest.dishIds[0],
          rate: "21.00",
          gross: "80.00",
          left: "80.00",
        }),
      ],
      moneyRefundable: "50.00",
    });
    expect(await preview(rest.saleId, "50.01")).toMatchObject({
      status: 409,
      json: { code: "invoice_correction.money_short", params: { moneyLeft: "50.00" } },
    });
    const wine = await linesOf(rest.saleId);
    expect(
      await captureError(() =>
        inTx(venue(), async (tx) =>
          recordCorrection(tx, venue().backend, {
            ...(await correctionOf(tx, rest.saleId)),
            total: "-80.00",
            lines: reversedLines(wine.filter((line) => line.id === rest.dishIds[0])),
          }),
        ),
      ),
    ).toMatchObject({ code: "sale.correction_exceeds_total", params: { remaining: "50.00" } });

    const corrective = await correct(rest.saleId, "50.00", [
      { rate: "21.00", base: "41.32", tax: "8.68" },
    ]);

    expect(recordOf(corrective)).toEqual([["21.00", "-41.32", "-8.68"]]);
    expect(await preview(rest.saleId, "0.01")).toMatchObject({
      status: 409,
      json: { code: "invoice_correction.money_short", params: { moneyLeft: "0.00" } },
    });
  });
});

describe("an advance corrected before the meal ends", () => {
  it("reduces what the rest's invoice takes off", async () => {
    const billId = await seated("Tasting menu");
    const advanceId = await advance(billId, "30.00");
    await correct(advanceId, "10.00", [{ rate: "10.00", base: "9.09", tax: "0.91" }]);

    const invoice = await payRest(billId, "100.00");

    expect(invoice.lines.at(-1)).toMatchObject({ gross: "-20.00" });
    expect(recordOf(await restId(billId))).toEqual([["10.00", "90.91", "9.09"]]);
  });
});

describe("an advance once the rest's invoice has taken it off", () => {
  /** A bill whose €30 advance the rest's invoice took off; the advance, its payment and tender,
   * and the refusal every way of giving it back meets. */
  async function takenOff() {
    const billId = await seated("Tasting menu");
    const advanceId = await advance(billId, "30.00");
    await payRest(billId, "90.00");
    const finalSaleId = await restId(billId);
    const [row] = await inTx(venue(), (tx) =>
      tx
        .select({ paymentId: billAdvances.billPaymentId, tenderId: tenders.id })
        .from(billAdvances)
        .innerJoin(tenders, eq(tenders.saleId, billAdvances.advanceSaleId))
        .where(eq(billAdvances.advanceSaleId, advanceId)),
    );
    const refusal = {
      code: "advance.taken_off_final_invoice",
      params: {
        saleId: advanceId,
        finalSaleId,
        invoiceNumber: (await advanceFacts(finalSaleId)).invoiceNumber,
      },
    };
    return { billId, advanceId, finalSaleId, ...row!, refusal };
  }

  it("refuses Correct invoice on the advance's ticket, naming the rest's invoice, and files nothing", async () => {
    const { advanceId, refusal } = await takenOff();
    const split = [{ rate: "10.00", base: "27.27", tax: "2.73" }];

    for (const refused of [
      await preview(advanceId, "30.00"),
      await open(advanceId, "30.00", split),
      await send(
        venue().app,
        venue().cookie,
        "GET",
        `/api/transactions/${advanceId}/corrections/lines`,
      ),
    ]) {
      expect(refused.status, JSON.stringify(refused.json)).toBe(409);
      expect(refused.json).toEqual(refusal);
    }
    expect(
      await inTx(venue(), (tx) =>
        tx.select().from(sales).where(eq(sales.correctsSaleId, advanceId)),
      ),
    ).toEqual([]);
  });

  it("refuses a plain refund of the advance's ticket and a bill refund of its payment with the same words", async () => {
    const { billId, advanceId, paymentId, tenderId, refusal } = await takenOff();

    const tenderRefund = await send(
      venue().app,
      venue().cookie,
      "POST",
      `/api/transactions/${advanceId}/refunds`,
      {
        submissionId: randomUUID(),
        tenderId,
        appliedAmount: "30.00",
        tipAmount: "0.00",
        reason: "Changed their mind",
        override: supervisor(),
      },
    );
    const billRefund = await send(
      venue().app,
      venue().cookie,
      "POST",
      `/api/working-orders/${billId}/payments/${paymentId}/refunds`,
      {
        submissionId: randomUUID(),
        appliedAmount: "30.00",
        tipAmount: "0.00",
        reason: "Paid too much",
        override: supervisor(),
      },
    );

    for (const refused of [tenderRefund, billRefund]) {
      expect(refused.status, JSON.stringify(refused.json)).toBe(409);
      expect(refused.json).toEqual(refusal);
    }
    expect(
      await inTx(venue(), (tx) =>
        tx.select().from(tenderRefunds).where(eq(tenderRefunds.saleId, advanceId)),
      ),
    ).toEqual([]);
  });
});

describe("what is left of an advance, on the bill's payments", () => {
  async function shownAdvance(billId: string) {
    const read = await send(
      venue().app,
      venue().cookie,
      "GET",
      `/api/working-orders/${billId}/payments`,
    );
    expect(read.status, JSON.stringify(read.json)).toBe(200);
    return (read.json as { payments: Record<string, unknown>[] }).payments[0];
  }

  it("shows the whole advance, then what a part correction leaves, then nothing once it is all given back", async () => {
    const billId = await seated("Tasting menu");
    const advanceId = await advance(billId, "30.00");
    expect(await shownAdvance(billId)).toMatchObject({
      hasTicket: true,
      applied: "30.00",
      left: "30.00",
      tipLeft: "0.00",
    });

    await correct(advanceId, "10.00", [{ rate: "10.00", base: "9.09", tax: "0.91" }]);
    expect(await shownAdvance(billId)).toMatchObject({ left: "20.00", tipLeft: "0.00" });

    await correct(advanceId, "20.00", [{ rate: "10.00", base: "18.18", tax: "1.82" }]);
    expect(await shownAdvance(billId)).toMatchObject({ left: "0.00", tipLeft: "0.00" });
  });
});

describe("a whole credit of the rest's invoice (ruling L9)", () => {
  /** Credits the settled rest's invoice whole: its lines reversed as cancelling an order reverses
   * them, and its split the invoice's own negated. The credit's id. */
  async function creditWhole(saleId: string): Promise<string> {
    const { saleId: credit } = await inTx(venue(), async (tx) => {
      const [sale] = await tx
        .select({ total: sales.total })
        .from(sales)
        .where(eq(sales.id, saleId));
      return recordCorrection(tx, venue().backend, {
        ...(await correctionOf(tx, saleId)),
        total: centsToDecimal(-sale!.total),
        lines: reversedLines(await linesIn(tx, saleId)),
        wholeInvoice: true,
      });
    });
    return credit;
  }

  it("example 1: files a whole credit reversing every line, the deduction line included, and prints the advance's caption", async () => {
    const rest = await restOf(["Tasting menu"], ["30.00"], "90.00");

    const credit = await creditWhole(rest.saleId);

    expect(recordOf(credit)).toEqual([["10.00", "-81.82", "-8.18"]]);
    const lines = await linesOf(credit);
    expect(lines.map((line) => [line.correctsLineId, line.lineTotal, line.lineGross])).toEqual([
      [rest.dishIds[0], -10909, -12000],
      [rest.deductionId, 2727, 3000],
    ]);
    const ticket = await readTicket(credit);
    expect(sumDecimals(ticket.lines.map((line) => decimal(line.gross)))).toBe(ticket.total);
    const words = await caption(rest.advanceIds[0]!);
    const entries = printed(ticket);
    expect(entries).toContain(`-1 ${words} 30,00`);
    expect(entries.some((line) => line.startsWith(`${spanish.total} -90,00`))).toBe(true);
  });

  it("leaves Correct invoice on the advance refused, naming the credited rest's invoice", async () => {
    const rest = await restOf(["Tasting menu"], ["30.00"], "90.00");
    await creditWhole(rest.saleId);

    const refused = await preview(rest.advanceIds[0]!, "30.00");

    expect(refused.status, JSON.stringify(refused.json)).toBe(409);
    expect(refused.json).toEqual({
      code: "advance.taken_off_final_invoice",
      params: {
        saleId: rest.advanceIds[0],
        finalSaleId: rest.saleId,
        invoiceNumber: (await advanceFacts(rest.saleId)).invoiceNumber,
      },
    });
  });

  it("example 8: files −3.92/−0.43, reversing the seven dishes and the deduction line", async () => {
    const rest = await restOf(Array<string>(7).fill("Bread roll"), ["3.00"], "4.35");

    const credit = await creditWhole(rest.saleId);

    expect(recordOf(credit)).toEqual([["10.00", "-3.92", "-0.43"]]);
    const lines = await linesOf(credit);
    expect(lines.map((line) => line.correctsLineId)).toEqual([...rest.dishIds, rest.deductionId]);
    expect(lines.at(-1)).toMatchObject({ lineTotal: 273, lineGross: 300 });
    expect(
      await inTx(venue(), (tx) =>
        tx.select({ id: sales.id }).from(sales).where(eq(sales.correctsSaleId, rest.saleId)),
      ),
    ).toHaveLength(1);
  });
});
