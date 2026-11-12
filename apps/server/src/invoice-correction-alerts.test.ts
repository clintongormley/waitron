import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { incidents, invoiceCorrections, sales, tenderRefunds, tenders } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { listAdjustmentReasons } from "@waitron/adjustments";
import { markIncidentHandled, previewCorrectionAmounts } from "@waitron/core";
import { hashPin, persons } from "@waitron/identity";
import type { Logger } from "@waitron/server-kit";
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
  const correctionId = await open(saleId, "20.00");
  await giveCash(correctionId, "15.00");
  return { saleId, correctionId, completedSince: new Date(start).toISOString() };
}

/** Opens a correction of `gross` off the sale, approved by `approverId`; its id. */
async function open(saleId: SaleId, gross: string, approverId = v.adminId) {
  const expectedSplit = await splitOf(saleId, gross);
  const { correction } = await inTx(v, (tx) =>
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
        authorization: { authorizedBy: approverId, permission: "sale.rectify", viaOverride: false },
      },
    ),
  );
  return correction.id;
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

/** The alerts of `code`, by default the unfinished-correction one, raised for `saleId`. */
const alertsFor = (saleId: string, code = "invoice_correction.unfinished") =>
  v.db
    .select({ params: incidents.params, severity: incidents.severity, source: incidents.source })
    .from(incidents)
    .where(and(eq(incidents.code, code), eq(incidents.saleId, saleId)));

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

/** A €24.20 ticket paid on the reader; its sale and card payment. */
async function paidOnTheReader() {
  const id = await v.bill();
  await takeReaderBillPayment(v.deps, v.cfg, id, await v.request(id, "card", "24.20"), v.operator);
  const [sale] = await v.db.select().from(sales).where(eq(sales.workingOrderId, id));
  const [tender] = await v.db.select().from(tenders).where(eq(tenders.saleId, sale!.id));
  return { saleId: brandSaleId(sale!.id), tenderId: tender!.id };
}

/** `amount` back on the reader payment through Refund a payment, as a leg of `correctionId`,
 * on `backend`. */
function cardLeg(
  t: { saleId: SaleId; tenderId: string },
  correctionId: string,
  amount: string,
  backend = v.backend,
  log?: Logger,
) {
  const submissionId = randomUUID();
  return refundSettledTender(
    { ...v.deps, backend, ...(log === undefined ? {} : { log }) },
    v.cfg,
    t.saleId,
    {
      submissionId,
      tenderId: t.tenderId,
      appliedAmount: amount,
      tipAmount: "0.00",
      reason: "Goodwill",
      invoiceCorrection: { id: correctionId, requestId: submissionId },
    },
    v.operator,
  );
}

/** The real backend, its chain check counted, reporting an issue while `broken` says so. */
function standIn(broken: boolean) {
  const counted = { checks: 0 };
  const backend = Object.create(v.backend, {
    checkIntegrity: {
      value: (...args: Parameters<typeof v.backend.checkIntegrity>) => {
        counted.checks += 1;
        return broken
          ? Promise.resolve({
              ok: false,
              checked: 1,
              issues: [{ code: "predecessor-hash-mismatch", params: {} }],
            })
          : v.backend.checkIntegrity(...args);
      },
    },
  }) as typeof v.backend;
  return { backend, counted };
}

const correctionOf = async (correctionId: string) =>
  (await v.db.select().from(invoiceCorrections).where(eq(invoiceCorrections.id, correctionId)))[0]!;
const salesCount = () => v.db.all<{ n: number }>(sql`select count(*) as n from sales`)[0]!.n;
const nextNumbers = () =>
  v.db.all<{ n: number }>(sql`select sum(next_number) as n from invoice_series`)[0]!.n;
const FILING_REFUSED = "invoice_correction.filing_refused";

describe("automatic filing of a correction whose money is all back", () => {
  it("keeps the refund and raises one filing_refused alert when automatic filing is refused, then files on the pass after the refusal clears", async () => {
    const t = await paidOnTheReader();
    const correctionId = await open(t.saleId, "10.00");
    const broken = standIn(true);
    const before = salesCount();

    const leg = await cardLeg(t, correctionId, "10.00", broken.backend);

    expect(leg).toMatchObject({ state: "completed", appliedAmount: "10.00" });
    expect(salesCount()).toBe(before);
    expect(await correctionOf(correctionId)).toMatchObject({ state: "open" });
    const raised = [
      {
        params: {
          correctionId,
          saleId: t.saleId,
          moneyBack: "10.00",
          refusal: "invoice_correction.chain_unsound",
        },
        severity: "error",
        source: "payment_check",
      },
    ];
    expect(await alertsFor(t.saleId, FILING_REFUSED)).toEqual(raised);

    const checks = broken.counted.checks;
    at(1);
    await recoverTenderRefunds({ ...v.deps, backend: broken.backend });
    expect(broken.counted.checks).toBeGreaterThan(checks);
    expect(await alertsFor(t.saleId, FILING_REFUSED)).toEqual(raised);
    expect(salesCount()).toBe(before);
    expect(
      await v.db
        .select({ state: tenderRefunds.state })
        .from(tenderRefunds)
        .where(eq(tenderRefunds.id, leg.id)),
    ).toEqual([{ state: "completed" }]);

    at(2);
    await recoverTenderRefunds(v.deps);
    expect(salesCount()).toBe(before + 1);
    const filed = await correctionOf(correctionId);
    expect(filed).toMatchObject({ state: "filed", endedBy: null });
    const [corrective] = await v.db
      .select()
      .from(sales)
      .where(eq(sales.id, filed.correctiveSaleId!));
    expect(corrective).toMatchObject({ correctsSaleId: t.saleId, total: -1000 });
  });

  it("does not retry when the approver has been suspended, leaving the alert for Record correction", async () => {
    const [approver] = await v.db
      .insert(persons)
      .values({ displayName: "Laura", pinHash: hashPin("7777"), role: "manager" })
      .returning({ id: persons.id });
    const t = await paidOnTheReader();
    const correctionId = await open(t.saleId, "10.00", approver!.id);
    await v.db.update(persons).set({ status: "suspended" }).where(eq(persons.id, approver!.id));

    expect(await cardLeg(t, correctionId, "10.00")).toMatchObject({ state: "completed" });

    const raised = [
      {
        params: {
          correctionId,
          saleId: t.saleId,
          moneyBack: "10.00",
          refusal: "authorization.not_permitted",
        },
        severity: "error",
        source: "payment_check",
      },
    ];
    expect(await alertsFor(t.saleId, FILING_REFUSED)).toEqual(raised);
    const counting = standIn(false);
    const numbers = nextNumbers();
    at(1);
    await recoverTenderRefunds({ ...v.deps, backend: counting.backend });
    at(2);
    await recoverTenderRefunds({ ...v.deps, backend: counting.backend });
    expect(counting.counted.checks).toBe(0);
    expect(nextNumbers()).toBe(numbers);
    expect(await correctionOf(correctionId)).toMatchObject({ state: "open" });
    expect(await alertsFor(t.saleId, FILING_REFUSED)).toEqual(raised);

    const expectedSplit = await splitOf(t.saleId, "10.00");
    const filed = await inTx(v, (tx) =>
      fileInvoiceCorrectionNow(
        tx,
        deps(),
        v.cfg,
        correctionId,
        { expectedSplit },
        { personId: v.adminId, authz: { sessionId: v.operator.sessionId } },
      ),
    );
    expect(filed).toMatchObject({ state: "filed", moneyBack: "10.00" });
    const [corrective] = await v.db
      .select()
      .from(sales)
      .where(eq(sales.id, filed.correctiveSaleId!));
    expect(corrective).toMatchObject({
      correctsSaleId: t.saleId,
      total: -1000,
      authorizedBy: v.adminId,
    });
  });

  it("takes no write lock for a correction whose approver's refusal is already alerted, and files once the approver is active again", async () => {
    const [approver] = await v.db
      .insert(persons)
      .values({ displayName: "Marta", pinHash: hashPin("6666"), role: "manager" })
      .returning({ id: persons.id });
    const t = await paidOnTheReader();
    const correctionId = await open(t.saleId, "10.00", approver!.id);
    await v.db.update(persons).set({ status: "suspended" }).where(eq(persons.id, approver!.id));
    expect(await cardLeg(t, correctionId, "10.00")).toMatchObject({ state: "completed" });
    expect(await alertsFor(t.saleId, FILING_REFUSED)).toHaveLength(1);
    // An hour before any case's first refund, so no correction is due the unfinished alert.
    const nothingDue = new Date("2026-10-14T08:00:00.000Z");

    let lock = vi.spyOn(v.db, "withWriteLock");
    try {
      at(1);
      await sweepInvoiceCorrections(v.deps, nothingDue);
      expect(lock).not.toHaveBeenCalled();
      expect(await correctionOf(correctionId)).toMatchObject({ state: "open" });

      lock.mockRestore();
      await v.db.update(persons).set({ status: "active" }).where(eq(persons.id, approver!.id));
      lock = vi.spyOn(v.db, "withWriteLock");
      at(2);
      await sweepInvoiceCorrections(v.deps, nothingDue);
      expect(lock).toHaveBeenCalledOnce();
      expect(await correctionOf(correctionId)).toMatchObject({ state: "filed" });
      expect(await alertsFor(t.saleId, FILING_REFUSED)).toHaveLength(1);
    } finally {
      lock.mockRestore();
    }
  });

  it("answers a saved card leg as completed when its automatic filing throws, and the next pass files it", async () => {
    const t = await paidOnTheReader();
    const correctionId = await open(t.saleId, "10.00");
    const throwing = Object.create(v.backend, {
      checkIntegrity: {
        value: () => Promise.reject(new Error("disk went away")),
      },
    }) as typeof v.backend;
    const logged: unknown[][] = [];
    const before = salesCount();

    const leg = await cardLeg(t, correctionId, "10.00", throwing, (...line) => {
      logged.push(line);
    });

    expect(leg).toMatchObject({ state: "completed", appliedAmount: "10.00" });
    expect(logged).toEqual([
      [
        "error",
        "invoice_correction.automatic_filing_failed",
        { correctionId, refundId: leg.id, errorCode: "unknown" },
      ],
    ]);
    expect(salesCount()).toBe(before);
    expect(await correctionOf(correctionId)).toMatchObject({ state: "open" });

    at(1);
    await recoverTenderRefunds(v.deps);
    expect(salesCount()).toBe(before + 1);
    expect(await correctionOf(correctionId)).toMatchObject({ state: "filed" });
  });

  it("files nothing while refunds are paused, and files on the first pass after", async () => {
    const t = await paidOnTheReader();
    const correctionId = await open(t.saleId, "10.00");
    expect(await cardLeg(t, correctionId, "10.00", standIn(true).backend)).toMatchObject({
      state: "completed",
    });
    const before = salesCount();

    at(1);
    await recoverTenderRefunds({ ...v.deps, clockUnconfirmed: () => true });
    expect(salesCount()).toBe(before);
    expect(await correctionOf(correctionId)).toMatchObject({ state: "open" });

    at(2);
    await recoverTenderRefunds(v.deps);
    expect(salesCount()).toBe(before + 1);
    expect(await correctionOf(correctionId)).toMatchObject({ state: "filed" });
  });
});
