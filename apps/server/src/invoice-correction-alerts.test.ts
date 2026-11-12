import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { incidents, sales, tenders } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { listAdjustmentReasons } from "@waitron/adjustments";
import { markIncidentHandled, previewCorrectionAmounts } from "@waitron/core";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { decimal, saleId as brandSaleId, type SaleId } from "@waitron/shared";
import { recordAttendanceFact } from "./attendance-capture.js";
import { takeBillPayment, takeReaderBillPayment } from "./bill-payments.js";
import { sweepInvoiceCorrections } from "./invoice-correction-alerts.js";
import { giveCorrectionCash, parseCorrectionCash } from "./invoice-correction-cash.js";
import {
  fileInvoiceCorrectionNow,
  openInvoiceCorrection,
  parseInvoiceCorrection,
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

/** Each case starts three hours after the one before, so no fiscal record it writes is dated
 * before one an earlier case wrote. */
let start = Date.parse("2026-10-14T08:00:00.000Z");
beforeEach(() => {
  start += 3 * 3_600_000;
  at(0);
  startTenderRefundResolvers(v.db);
});
afterEach(async () => {
  v.card.scriptLookups(null);
  await stopTenderRefundResolvers(v.db);
});

/** Sets the clock `minutes` after the case's start. */
function at(minutes: number) {
  v.set(new Date(start + minutes * 60_000).toISOString());
}

const deps = () => ({ backend: v.backend, clock: v.deps.clock, attendance: recordAttendanceFact });

/** A €24.20 ticket paid in cash, its €20.00 correction opened and €15.00 of it given back in cash
 * now. */
async function fifteenBack() {
  const id = await v.bill();
  await takeBillPayment(v.deps, v.cfg, id, await v.request(id, "cash", "24.20"), v.operator);
  const [sale] = await v.db.select().from(sales).where(eq(sales.workingOrderId, id));
  const saleId = brandSaleId(sale!.id);
  const expectedSplit = await splitOf(saleId, "20.00");
  const { correction } = await inTx(v, (tx) =>
    openInvoiceCorrection(
      tx,
      deps(),
      v.cfg,
      saleId,
      parseInvoiceCorrection({
        submissionId: randomUUID(),
        gross: "20.00",
        reasonId,
        note: null,
        expectedSplit,
      }),
      {
        personId: v.adminId,
        authorization: { authorizedBy: v.adminId, permission: "sale.rectify", viaOverride: false },
      },
    ),
  );
  await giveCash(correction.id, "15.00");
  return { saleId, correctionId: correction.id, completedSince: new Date(start).toISOString() };
}

/** Gives `amount` of correction `correctionId` back in cash now. */
async function giveCash(correctionId: string, amount: string) {
  await inTx(v, (tx) =>
    giveCorrectionCash(
      tx,
      deps(),
      v.cfg,
      correctionId,
      parseCorrectionCash({ submissionId: randomUUID(), amount }),
      {
        personId: v.adminId,
        authz: { sessionId: v.operator.sessionId },
        authorization: { authorizedBy: v.adminId, permission: "sale.refund", viaOverride: false },
      },
    ),
  );
}

async function splitOf(saleId: SaleId, gross: string) {
  return (
    await inTx(v, (tx) =>
      previewCorrectionAmounts(tx, v.backend, saleId, v.cfg.nodeId, { gross: decimal(gross) }),
    )
  ).vatBreakdown.map(({ rate, base, tax }) => ({ rate, base, tax }));
}

/** The unfinished-correction alerts raised for `saleId`. */
const alertsFor = (saleId: string) =>
  v.db
    .select({ params: incidents.params, severity: incidents.severity, source: incidents.source })
    .from(incidents)
    .where(and(eq(incidents.code, "invoice_correction.unfinished"), eq(incidents.saleId, saleId)));

describe("the unfinished-correction alert", () => {
  it("raises the unfinished alert once a correction has had money back for over an hour", async () => {
    const { saleId, correctionId, completedSince } = await fifteenBack();
    at(59);
    await recoverTenderRefunds(v.deps);
    expect(await alertsFor(saleId)).toEqual([]);

    at(61);
    await recoverTenderRefunds(v.deps);
    const raised = [
      {
        params: { correctionId, saleId, moneyBack: "15.00", completedSince },
        severity: "warning",
        source: "payment_check",
      },
    ];
    expect(await alertsFor(saleId)).toEqual(raised);

    at(120);
    await recoverTenderRefunds(v.deps);
    expect(await alertsFor(saleId)).toEqual(raised);
  });

  // Control: the case above raises the alert for an open correction at the same +61 minutes.
  it("raises nothing for a correction filed within the hour", async () => {
    const { saleId, correctionId } = await fifteenBack();
    at(30);
    const expectedSplit = await splitOf(saleId, "15.00");
    await expect(
      inTx(v, (tx) =>
        fileInvoiceCorrectionNow(
          tx,
          deps(),
          v.cfg,
          correctionId,
          { expectedSplit },
          { personId: v.adminId, authz: { sessionId: v.operator.sessionId } },
        ),
      ),
    ).resolves.toMatchObject({ state: "filed" });
    at(61);
    await recoverTenderRefunds(v.deps);
    expect(await alertsFor(saleId)).toEqual([]);
  });

  it("raises the alert when another refund in the same pass throws, and still reports that failure", async () => {
    const { saleId } = await fifteenBack();
    const other = await v.bill();
    await takeReaderBillPayment(
      v.deps,
      v.cfg,
      other,
      await v.request(other, "card", "24.20"),
      v.operator,
    );
    const [sale] = await v.db.select().from(sales).where(eq(sales.workingOrderId, other));
    const [tender] = await v.db.select().from(tenders).where(eq(tenders.saleId, sale!.id));
    v.card.scriptNextRefund({ made: false, answer: { kind: "uncertain", reason: "network" } });
    const submissionId = randomUUID();
    const refund = await refundSettledTender(
      v.deps,
      v.cfg,
      brandSaleId(sale!.id),
      {
        submissionId,
        tenderId: tender!.id,
        appliedAmount: "5.00",
        tipAmount: "0.00",
        reason: "Goodwill",
      },
      v.operator,
    );
    expect(refund.state).toBe("pending");
    v.card.scriptLookups({
      kind: "match",
      providerRefundRef: `confirmed-${refund.id}`,
      outcome: "completed",
      providerStatus: "succeeded",
    });
    const refusal = new Error("attendance unavailable");
    const failing = {
      ...v.deps,
      attendance: async () => {
        throw refusal;
      },
    };

    at(61);
    await expect(recoverTenderRefunds(failing)).rejects.toMatchObject({
      message: "Settled-tender refund recovery failed",
      errors: [refusal],
    });
    expect(await alertsFor(saleId)).toHaveLength(1);
  });

  it("measures the hour from the earliest completed refund, not the latest", async () => {
    const { saleId, correctionId, completedSince } = await fifteenBack();
    at(45);
    await giveCash(correctionId, "3.00");
    at(61);
    await sweepInvoiceCorrections(v.deps, v.deps.clock.now().instant);
    expect(await alertsFor(saleId)).toEqual([
      {
        params: { correctionId, saleId, moneyBack: "18.00", completedSince },
        severity: "warning",
        source: "payment_check",
      },
    ]);
  });

  it("takes the write lock only when a correction is due an alert", async () => {
    await fifteenBack();
    const lock = vi.spyOn(v.db, "withWriteLock");
    try {
      // Earlier cases leave open corrections in this database, so only an hour before any case's
      // first refund is nothing due.
      await sweepInvoiceCorrections(v.deps, new Date("2026-10-14T08:00:00.000Z"));
      expect(lock).not.toHaveBeenCalled();
      at(61);
      await sweepInvoiceCorrections(v.deps, v.deps.clock.now().instant);
      expect(lock).toHaveBeenCalledOnce();
    } finally {
      lock.mockRestore();
    }
  });

  it("takes no write lock for a correction already alerted, and alerts again once it is handled", async () => {
    const { saleId } = await fifteenBack();
    at(61);
    await sweepInvoiceCorrections(v.deps, v.deps.clock.now().instant);
    const lock = vi.spyOn(v.db, "withWriteLock");
    try {
      at(62);
      await sweepInvoiceCorrections(v.deps, v.deps.clock.now().instant);
      expect(lock).not.toHaveBeenCalled();

      const [raised] = await v.db
        .select({ id: incidents.id })
        .from(incidents)
        .where(
          and(eq(incidents.code, "invoice_correction.unfinished"), eq(incidents.saleId, saleId)),
        );
      await inTx(v, (tx) =>
        markIncidentHandled(tx, { id: raised!.id, personId: v.adminId, handledAt: new Date() }),
      );
      lock.mockClear();
      at(63);
      await sweepInvoiceCorrections(v.deps, v.deps.clock.now().instant);
      expect(lock).toHaveBeenCalledOnce();
      expect(await alertsFor(saleId)).toHaveLength(2);
    } finally {
      lock.mockRestore();
    }
  });

  it("raises the alert while refunds are paused", async () => {
    const { saleId } = await fifteenBack();
    at(61);
    const [{ pending }] = v.db.all<{ pending: number }>(
      sql`select count(*) as pending from tender_refunds
        where state = 'pending' and method = 'card' and manual = 0`,
    ) as [{ pending: number }];
    await expect(
      recoverTenderRefunds({ ...v.deps, clockUnconfirmed: () => true }),
    ).resolves.toMatchObject({ pending });
    expect(await alertsFor(saleId)).toHaveLength(1);
  });
});
