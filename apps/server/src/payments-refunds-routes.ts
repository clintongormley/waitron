import "./errors.js";
import {
  type Transaction,
  refunds as refundRows,
  billPayments,
  workingOrders,
  devices,
  sales,
  invoiceSeries,
} from "@waitron/db";
import { payments } from "@waitron/payments";
import {
  type Logger,
  requireManagementSession,
  requireUuidParam,
  readJsonBody,
} from "@waitron/server-kit";
import { centsToDecimal, AppError } from "@waitron/shared";
import { eq, sql, and } from "drizzle-orm";
import type { Hono } from "hono";
import { refundProvidersOf } from "./bill-refunds.js";
import { paymentOrderLabelFields, withPaymentOrderLabels } from "./current-order-label.js";
import type { SettledSlipPrinter } from "./payment-slip-print.js";
import type { PaymentsApiDeps } from "./payments-api-deps.js";
import { run } from "./payments-api-errors.js";
import { parseAttestation } from "./payments-request-fields.js";
import {
  tenderRefundIsLive,
  resumeBillCardRefund,
  attestBillCardRefundIn,
  readStuckTenderRefund,
  claimTenderRefund,
  resolveClaimedTenderRefund,
  attestTenderRefundIn,
} from "./tender-refund-sends.js";
import { toTenderRefundView } from "./tender-refunds.js";

export function mountPaymentsRefundRoutes(
  app: Hono,
  deps: PaymentsApiDeps,
  log: Logger,
  gated: <T>(
    sessionId: string,
    fn: (tx: Transaction, personId: string) => Promise<T>,
  ) => Promise<T>,
  pinGated: <T>(
    sessionId: string,
    pin: unknown,
    fn: (tx: Transaction, personId: string, print: SettledSlipPrinter) => Promise<T>,
  ) => Promise<T>,
  refuseUntilRecordable: (tx: Transaction) => Promise<void>,
): void {
  const refundDeps = {
    db: deps.db,
    backend: deps.backend,
    admission: deps.admission,
    cfg: deps.cfg,
    clock: deps.clock,
    attendance: deps.attendance,
    refundProviderFor: refundProvidersOf({ simulator: deps.simulator, pool: deps.pool }),
    clockUnconfirmed: deps.clockUnconfirmed,
  };

  // Card refunds of a bill that nothing is driving any more (bill payments design §6b).
  app.get("/management-api/payments/bill-refunds", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const rows = await gated(sessionId, async (tx) => {
        const rows = await tx
          .select({
            refundId: refundRows.id,
            billPaymentId: billPayments.id,
            workingOrderId: billPayments.workingOrderId,
            orderNumber: workingOrders.orderNumber,
            ...paymentOrderLabelFields,
            source: refundRows.source,
            deviceId: refundRows.deviceId,
            deviceName: devices.label,
            appliedAmount: refundRows.appliedAmount,
            tipAmount: refundRows.tipAmount,
            reason: refundRows.reason,
            requestedAt: refundRows.createdAt,
            sentAt: refundRows.sentAt,
            sendCount: refundRows.sendCount,
            provider: payments.provider,
          })
          .from(refundRows)
          .innerJoin(billPayments, eq(billPayments.id, refundRows.billPaymentId))
          .innerJoin(workingOrders, eq(workingOrders.id, billPayments.workingOrderId))
          .leftJoin(devices, eq(devices.id, refundRows.deviceId))
          .leftJoin(payments, eq(payments.billPaymentId, billPayments.id))
          .where(eq(refundRows.state, "pending"))
          .orderBy(refundRows.createdAt, sql`${refundRows}.rowid`);
        return withPaymentOrderLabels(tx, rows);
      });
      return c.json(
        rows
          .filter((row) => !tenderRefundIsLive(deps.db, row.refundId))
          .map((row) => ({
            ...row,
            appliedAmount: centsToDecimal(row.appliedAmount),
            tipAmount: centsToDecimal(row.tipAmount),
          })),
      );
    }),
  );

  // Looks the refund up at its provider and records what that settles; for a provider whose key
  // is still kept, a refund it has no record of is sent again under the same key. Never records a
  // failure from an empty lookup.
  app.post("/management-api/payments/bill-refunds/:id/resolve", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "BillRefundId");
      await gated(sessionId, refuseUntilRecordable);
      const resumed = await resumeBillCardRefund(refundDeps, id, "manager");
      if (!resumed.claimed) throw new AppError("bill.refund_not_stuck", { refundId: id });
      if (resumed.refund.state !== "pending") return c.json({ outcome: resumed.refund.state });
      const { lookup } = resumed;
      throw new AppError("bill.refund_outcome_unconfirmed", {
        refundId: id,
        reason:
          resumed.resent || lookup === null || lookup.kind === "match"
            ? "pending"
            : lookup.kind === "none"
              ? "not_found"
              : lookup.kind,
      });
    }),
  );

  // A manager records the outcome the provider confirmed (design §6b): only with a note, and with
  // their own PIN entered again.
  app.post("/management-api/payments/bill-refunds/:id/attest", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "BillRefundId");
      const { outcome, note, pin } = parseAttestation(
        await readJsonBody<Record<string, unknown>>(c),
        ["completed", "failed"] as const,
      );
      const refund = await pinGated(sessionId, pin, async (tx, personId) => {
        await refuseUntilRecordable(tx);
        return attestBillCardRefundIn(tx, refundDeps, id, outcome, { attestedBy: personId, note });
      });
      return c.json({ outcome: refund.state });
    }),
  );
  app.get("/management-api/payments/tender-refunds", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const rows = await gated(sessionId, (tx) =>
        tx
          .select({
            refund: refundRows,
            invoiceNumber: sales.invoiceNumber,
            seriesCode: invoiceSeries.code,
          })
          .from(refundRows)
          .innerJoin(sales, eq(sales.id, refundRows.saleId))
          .innerJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
          .where(
            and(
              eq(refundRows.state, "pending"),
              eq(refundRows.method, "card"),
              eq(refundRows.manual, false),
            ),
          )
          .orderBy(refundRows.createdAt, sql`${refundRows}.rowid`),
      );
      return c.json(
        rows
          .filter(({ refund }) => !tenderRefundIsLive(deps.db, refund.id))
          .map(({ refund, invoiceNumber, seriesCode }) => ({
            ...toTenderRefundView(refund),
            invoiceNumber: `${seriesCode}/${invoiceNumber}`,
            reason: refund.reason,
            provider: refund.provider,
            providerPaymentRef: refund.providerPaymentRef,
          })),
      );
    }),
  );
  app.post("/management-api/payments/tender-refunds/:id/resolve", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "TenderRefundId").toLowerCase();
      let release: (() => void) | undefined;
      try {
        await gated(sessionId, async (tx) => {
          await refuseUntilRecordable(tx);
          await readStuckTenderRefund(tx, deps.db, id);
          release = claimTenderRefund(deps.db, id);
        });
        const held = release!;
        release = undefined;
        const refund = await resolveClaimedTenderRefund(refundDeps, id, "manager", held);
        if (refund.state === "pending")
          throw new AppError("tender.refund_outcome_unconfirmed", { refundId: id });
        return c.json({ outcome: refund.state });
      } catch (error) {
        release?.();
        throw error;
      }
    }),
  );
  app.post("/management-api/payments/tender-refunds/:id/attest", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "TenderRefundId").toLowerCase();
      const { outcome, note, pin } = parseAttestation(
        await readJsonBody<Record<string, unknown>>(c),
        ["completed", "failed"] as const,
      );
      const refund = await pinGated(sessionId, pin, async (tx, personId) => {
        await refuseUntilRecordable(tx);
        await readStuckTenderRefund(tx, deps.db, id);
        return attestTenderRefundIn(tx, refundDeps, id, outcome, { attestedBy: personId, note });
      });
      return c.json({ outcome: refund.state });
    }),
  );
}
