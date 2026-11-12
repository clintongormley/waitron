import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sales, tenderRefunds, tenders } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { listAdjustmentReasons } from "@waitron/adjustments";
import { previewCorrectionAmounts } from "@waitron/core";
import { endSession, loginWithPin } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { decimal, saleId as brandSaleId, type SaleId } from "@waitron/shared";
import { recordAttendanceFact } from "./attendance-capture.js";
import { takeBillPayment, takeReaderBillPayment } from "./bill-payments.js";
import { giveCorrectionCash, parseCorrectionCash } from "./invoice-correction-cash.js";
import {
  closeInvoiceCorrection,
  fileInvoiceCorrectionNow,
  openInvoiceCorrection,
  parseInvoiceCorrection,
  previewInvoiceCorrection,
  readInvoiceCorrection,
} from "./invoice-corrections.js";
import { recoverTenderRefunds } from "./tender-refund-recovery.js";
import { startTenderRefundResolvers, stopTenderRefundResolvers } from "./tender-refund-sends.js";
import { refundSettledTender } from "./tender-refunds.js";
import { inTx } from "./testing/bill-venue.js";
import { zonePaymentVenue } from "./testing/zone-payment-venue.js";

let v: Awaited<ReturnType<typeof zonePaymentVenue>>;
let reasonId: string;
useVenueDb({
  resetPerTest: false,
  timeoutMs: 60_000,
  migrations: migrationOptionsFor(manifestSets(), null),
  setup: async (db) => {
    v = await zonePaymentVenue(db);
    reasonId = (await inTx(v, (tx) => listAdjustmentReasons(tx))).find(
      (reason) => reason.kind === "void" && !reason.noteRequired,
    )!.id;
  },
});
beforeEach(() => {
  v.set("2026-10-14T23:30:00.000Z");
  startTenderRefundResolvers(v.db);
});
afterEach(async () => {
  v.card.scriptLookups(null);
  await stopTenderRefundResolvers(v.db);
});

const deps = () => ({ backend: v.backend, clock: v.deps.clock, attendance: recordAttendanceFact });
const rectify = { authorizedBy: "", permission: "sale.rectify", viaOverride: false };

/** A €24.20 ticket paid €14.20 in cash, then €10.00 on the reader; its sale and card payment. */
async function cashAndReader() {
  const id = await v.bill();
  await takeBillPayment(v.deps, v.cfg, id, await v.request(id, "cash", "14.20"), v.operator);
  await takeReaderBillPayment(v.deps, v.cfg, id, await v.request(id, "card", "10.00"), v.operator);
  const [sale] = await v.db.select().from(sales).where(eq(sales.workingOrderId, id));
  const card = (await v.db.select().from(tenders).where(eq(tenders.saleId, sale!.id))).find(
    (row) => row.method === "card",
  )!;
  return { saleId: brandSaleId(sale!.id), cardTenderId: card.id };
}

async function splitOf(saleId: SaleId, gross: string) {
  return (
    await inTx(v, (tx) =>
      previewCorrectionAmounts(tx, v.backend, saleId, v.cfg.nodeId, { gross: decimal(gross) }),
    )
  ).vatBreakdown.map(({ rate, base, tax }) => ({ rate, base, tax }));
}

async function open(saleId: SaleId, gross: string) {
  const expectedSplit = await splitOf(saleId, gross);
  return inTx(v, (tx) =>
    openInvoiceCorrection(
      tx,
      deps(),
      v.cfg,
      saleId,
      parseInvoiceCorrection({
        submissionId: randomUUID(),
        gross,
        reasonId,
        note: null,
        expectedSplit,
      }),
      {
        personId: v.adminId,
        authorization: { ...rectify, authorizedBy: v.adminId },
      },
    ),
  );
}

async function cash(correctionId: string, amount: string, sessionId = v.operator.sessionId) {
  return inTx(v, (tx) =>
    giveCorrectionCash(
      tx,
      deps(),
      v.cfg,
      correctionId,
      parseCorrectionCash({ submissionId: randomUUID(), amount }),
      {
        personId: v.adminId,
        authz: { sessionId },
        authorization: { authorizedBy: v.adminId, permission: "sale.refund", viaOverride: false },
      },
    ),
  );
}

/** `amount` back on the reader payment through Refund a payment, a leg of `correctionId` when
 * named. */
async function cardRefund(
  t: { saleId: SaleId; cardTenderId: string },
  amount: string,
  correctionId?: string,
  operator = v.operator,
) {
  const submissionId = randomUUID();
  return refundSettledTender(
    v.deps,
    v.cfg,
    t.saleId,
    {
      submissionId,
      tenderId: t.cardTenderId,
      appliedAmount: amount,
      tipAmount: "0.00",
      reason: "Goodwill",
      ...(correctionId === undefined
        ? {}
        : { invoiceCorrection: { id: correctionId, requestId: submissionId } }),
    },
    operator,
  );
}

/** Leaves the next reader refund pending: the processor's answer is lost. */
function loseNextAnswer() {
  v.card.scriptNextRefund({ made: false, answer: { kind: "uncertain", reason: "network" } });
}

/** The card company reports the refund `refundId` went through; the background pass runs, a minute
 * apart, until the refund is no longer pending. */
async function confirmedByThePass(refundId: string) {
  v.card.scriptLookups({
    kind: "match",
    providerRefundRef: `confirmed-${refundId}`,
    outcome: "completed",
    providerStatus: "succeeded",
  });
  for (let minute = 31; minute < 60; minute++) {
    const [row] = await v.db.select().from(tenderRefunds).where(eq(tenderRefunds.id, refundId));
    if (row!.state !== "pending") return row!;
    v.set(`2026-10-14T23:${String(minute)}:00.000Z`);
    await recoverTenderRefunds(v.deps);
  }
  throw new Error(`refund ${refundId} still pending`);
}

const read = (correctionId: string) =>
  inTx(v, (tx) => readInvoiceCorrection(tx, v.backend, v.cfg, correctionId));
const fileNow = (correctionId: string, expectedSplit: Awaited<ReturnType<typeof splitOf>>) =>
  inTx(v, (tx) =>
    fileInvoiceCorrectionNow(
      tx,
      deps(),
      v.cfg,
      correctionId,
      { expectedSplit },
      { personId: v.adminId, authz: { sessionId: v.operator.sessionId } },
    ),
  );
const close = (correctionId: string) =>
  inTx(v, (tx) => closeInvoiceCorrection(tx, deps(), v.cfg, correctionId, { personId: v.adminId }));
const salesCount = () => v.db.all<{ n: number }>(sql`select count(*) as n from sales`)[0]!.n;

describe("a correction's connected card legs", () => {
  it("previews a correction of a ticket paid partly on the reader", async () => {
    const { saleId } = await cashAndReader();
    await expect(
      inTx(v, (tx) =>
        previewInvoiceCorrection(tx, v.backend, v.cfg, v.deps.clock.now(), saleId, {
          gross: "24.20",
        }),
      ),
    ).resolves.toMatchObject({ gross: "24.20", moneyRefundable: "24.20" });
  });

  it("files when the background pass confirms a card leg, with nobody signed in", async () => {
    const t = await cashAndReader();
    const { correction } = await open(t.saleId, "24.20");
    const session = await inTx(v, (tx) =>
      loginWithPin(tx, { deviceId: v.deviceId, personId: v.adminId, pin: "1234" }),
    );
    const opener = { ...v.operator, sessionId: session.id };
    await cash(correction.id, "14.20", opener.sessionId);
    loseNextAnswer();
    const leg = await cardRefund(t, "10.00", correction.id, opener);
    expect(leg.state).toBe("pending");
    expect(await read(correction.id)).toMatchObject({ pending: "10.00", fileNow: null });
    expect(await inTx(v, (tx) => endSession(tx, session.token))).toBe(true);
    const before = salesCount();

    // Control: a pass while the card company still answers pending files nothing.
    await recoverTenderRefunds(v.deps);
    expect(await read(correction.id)).toMatchObject({ state: "open", pending: "10.00" });
    expect(salesCount()).toBe(before);

    expect(await confirmedByThePass(leg.id)).toMatchObject({ state: "completed" });

    expect(salesCount()).toBe(before + 1);
    const filed = await read(correction.id);
    expect(filed).toMatchObject({
      state: "filed",
      moneyBack: "24.20",
      pending: "0.00",
      left: "0.00",
      fileNow: null,
    });
    const [corrective] = await v.db
      .select()
      .from(sales)
      .where(eq(sales.id, filed.correctiveSaleId!));
    expect(corrective).toMatchObject({
      correctsSaleId: t.saleId,
      total: -2420,
      authorizedBy: v.adminId,
    });
  });

  it("files for the money back when a card leg failed", async () => {
    const t = await cashAndReader();
    const { correction } = await open(t.saleId, "24.20");
    await cash(correction.id, "14.20");
    v.card.scriptNextRefund({ made: "failed", answer: "made" });

    expect(await cardRefund(t, "10.00", correction.id)).toMatchObject({ state: "failed" });

    const split = await splitOf(t.saleId, "14.20");
    expect(await read(correction.id)).toMatchObject({
      state: "open",
      moneyBack: "14.20",
      pending: "0.00",
      left: "10.00",
      fileNow: { gross: "14.20", vatBreakdown: split },
    });
    const filed = await fileNow(correction.id, split);
    expect(filed).toMatchObject({ state: "filed", moneyBack: "14.20" });
    const [corrective] = await v.db
      .select()
      .from(sales)
      .where(eq(sales.id, filed.correctiveSaleId!));
    expect(corrective).toMatchObject({ correctsSaleId: t.saleId, total: -1420 });
  });

  it("refuses to open while a refund on the ticket is pending, and opens once it completes", async () => {
    const t = await cashAndReader();
    loseNextAnswer();
    const ordinary = await cardRefund(t, "1.00");
    const refused = {
      code: "invoice_correction.refund_pending",
      params: { saleId: t.saleId, refundId: ordinary.id },
    };
    await expect(open(t.saleId, "5.00")).rejects.toMatchObject(refused);
    await expect(
      inTx(v, (tx) =>
        previewInvoiceCorrection(tx, v.backend, v.cfg, v.deps.clock.now(), t.saleId, {
          gross: "5.00",
        }),
      ),
    ).rejects.toMatchObject(refused);

    await confirmedByThePass(ordinary.id);

    await expect(open(t.saleId, "5.00")).resolves.toMatchObject({ correction: { state: "open" } });
  });

  it("refuses to file or close with cash back while a card leg is pending, and files once it completes", async () => {
    const t = await cashAndReader();
    const { correction } = await open(t.saleId, "24.20");
    await cash(correction.id, "14.20");
    loseNextAnswer();
    const leg = await cardRefund(t, "10.00", correction.id);
    const refused = {
      code: "invoice_correction.refund_pending",
      params: { saleId: t.saleId, refundId: leg.id },
    };
    const before = salesCount();
    await expect(fileNow(correction.id, await splitOf(t.saleId, "14.20"))).rejects.toMatchObject(
      refused,
    );
    await expect(close(correction.id)).rejects.toMatchObject(refused);
    expect(await read(correction.id)).toMatchObject({
      state: "open",
      moneyBack: "14.20",
      pending: "10.00",
    });
    expect(salesCount()).toBe(before);

    await confirmedByThePass(leg.id);

    await expect(close(correction.id)).rejects.toMatchObject({
      code: "invoice_correction.still_correctable",
    });
    await expect(fileNow(correction.id, await splitOf(t.saleId, "24.20"))).resolves.toMatchObject({
      state: "filed",
      moneyBack: "24.20",
    });
  });
});
