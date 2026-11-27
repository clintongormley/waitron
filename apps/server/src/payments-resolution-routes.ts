import "./errors.js";
import { type Transaction, workingOrders, billPayments, devices } from "@waitron/db";
import {
  type AbandonedAttemptOutcome,
  type CardProviderContribution,
  type PaymentProvider,
  payments,
  recordRefund,
  readPaymentsSettings,
  cardProviderById,
  findPaymentByBillPayment,
} from "@waitron/payments";
import { paymentRefunds } from "@waitron/payments/src/schema/payment-refunds.js";
import {
  type Logger,
  requireManagementSession,
  requireUuidParam,
  readJsonBody,
} from "@waitron/server-kit";
import {
  AppError,
  centsToDecimal,
  sumDecimals,
  subtractDecimal,
  compareDecimal,
  decimal,
  isAppError,
  decimalToCents,
} from "@waitron/shared";
import { or, and, inArray, isNull, ne, eq, sql } from "drizzle-orm";
import type { Hono } from "hono";
import { ZERO, previewAllocation, MONEY } from "./bill-allocation.js";
import { settleFromProviderRow, CHARGED } from "./bill-payments-loop.js";
import { billPaymentIsLive } from "./bill-reader-payment.js";
import { completeBillPayment, failBillPayment } from "./bill-payment-settlement.js";
import { readBillBalance } from "./bill-balance.js";
import { paymentOrderLabelFields, withPaymentOrderLabels } from "./current-order-label.js";
import { type SettledSlipPrinter, withSettledSlip } from "./payment-slip-print.js";
import type { PaymentsApiDeps } from "./payments-api-deps.js";
import { run } from "./payments-api-errors.js";
import { parseAttestation } from "./payments-request-fields.js";
import { refuseRefundInProgress } from "./working-order-edit-state.js";

/** `reason` and, when the provider named one, `providerStatus` of an unknown outcome. */
function unknownOutcome(resolved: Extract<AbandonedAttemptOutcome, { outcome: "unknown" }>) {
  return {
    reason: resolved.reason,
    ...(resolved.providerStatus === undefined ? {} : { providerStatus: resolved.providerStatus }),
  };
}

export function mountPaymentsResolutionRoutes(
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
  collectionScope: (tx: Transaction) => Promise<ReturnType<typeof or>>,
  refuseUntilRecordable: (tx: Transaction) => Promise<void>,
  requireConnected: (tx: Transaction, seat: CardProviderContribution) => Promise<void>,
  resolveAtProvider: (
    attempt: { provider: string; paymentRef: string },
    personId: string,
    notStuck: () => AppError,
  ) => Promise<{ provider: PaymentProvider; resolved: AbandonedAttemptOutcome; now: Date }>,
): void {
  const refundReleaseProviders = deps.providers
    .filter((p) => p.partialRefundRelease)
    .map((p) => p.providerId);
  const partialRefundEligible = (replay = false) =>
    and(
      inArray(payments.provider, refundReleaseProviders),
      inArray(payments.state, replay ? ["partially_refunded", "refunded"] : ["partially_refunded"]),
      isNull(payments.saleId),
      inArray(workingOrders.status, ["open", "placed"]),
      ne(billPayments.state, "received"),
    )!;
  const refundFacts = async (tx: Transaction, paymentId: string, amount: number) => {
    const refunds = await tx
      .select()
      .from(paymentRefunds)
      .where(and(eq(paymentRefunds.paymentId, paymentId), eq(paymentRefunds.state, "succeeded")));
    const captured = centsToDecimal(amount);
    const refunded = sumDecimals(refunds.map((r) => centsToDecimal(r.amount)));
    return {
      refunds,
      partialRefund: {
        paymentId,
        captured,
        refunded,
        remaining: subtractDecimal(captured, refunded),
      },
    };
  };

  const acceptRefundEvidence = async (
    tx: Transaction,
    payment: typeof payments.$inferSelect,
    refunds: (typeof paymentRefunds.$inferSelect)[],
    evidence: Awaited<ReturnType<NonNullable<PaymentProvider["lookupCompletedRefunds"]>>>,
    personId: string,
    full: boolean,
  ) => {
    const paymentId = payment.id;
    const total =
      evidence.kind === "known" ? sumDecimals(evidence.refunds.map((r) => r.amount)) : ZERO;
    if (
      evidence.kind !== "known" ||
      compareDecimal(total, ZERO) <= 0 ||
      (full
        ? compareDecimal(total, evidence.captured) !== 0
        : compareDecimal(total, evidence.captured) >= 0)
    )
      throw new AppError("payment.outcome_unknown", { paymentId, reason: "ambiguous" });
    const unknown = () =>
      new AppError("payment.outcome_unknown", { paymentId, reason: "ambiguous" });
    if (
      evidence.kind !== "known" ||
      evidence.processorRef !== payment.externalRef ||
      compareDecimal(evidence.captured, centsToDecimal(payment.amount)) !== 0
    )
      throw unknown();
    const byRef = new Map(evidence.refunds.map((r) => [r.providerRefundRef, r]));
    if (
      byRef.size !== evidence.refunds.length ||
      evidence.refunds.some(
        (r) => !r.providerRefundRef || compareDecimal(r.amount, decimal("0")) <= 0,
      )
    )
      throw unknown();
    const recorded = new Set<string>();
    for (const refund of refunds) {
      const ref = refund.providerRefundRef;
      if (ref === null)
        throw new AppError("payment.outcome_unknown", {
          paymentId,
          reason: "refund_reference_missing",
        });
      if (
        recorded.has(ref) ||
        !byRef.has(ref) ||
        compareDecimal(byRef.get(ref)!.amount, centsToDecimal(refund.amount)) !== 0
      )
        throw unknown();
      recorded.add(ref);
    }
    for (const refund of evidence.refunds)
      if (!recorded.has(refund.providerRefundRef)) {
        // The manager confirms the provider's refund here; this does not identify its original sender.
        await recordRefund(tx, {
          provider: payment.provider,
          paymentRef: payment.paymentRef,
          ...refund,
          authorizedBy: personId,
        });
      }
  };

  const retentionPreview = async (
    tx: Transaction,
    payment: typeof payments.$inferSelect,
    remaining: string,
  ) => {
    const balance = await readBillBalance(tx, payment.workingOrderId);
    const own = balance.payments.find((row) => row.id === payment.billPaymentId);
    const reserved = subtractDecimal(
      decimal(balance.reserved),
      own?.state === "pending" ? decimal(own.applied) : ZERO,
    );
    if (compareDecimal(reserved, ZERO) > 0)
      throw new AppError("order.payment_in_flight", { workingOrderId: payment.workingOrderId });
    await refuseRefundInProgress(tx, [payment.workingOrderId]);
    const preview = previewAllocation(
      {
        workingOrderId: payment.workingOrderId,
        total: decimal(balance.total),
        received: decimal(balance.received),
        reserved,
      },
      {
        kind: "contribution",
        amount: decimal(remaining),
        payment: { method: "card", addedTip: ZERO },
      },
      { tipsEnabled: (await readPaymentsSettings(tx)).doc.tipsEnabled },
    );
    return {
      remaining: decimal(remaining),
      applied: preview.applied,
      tip: preview.tip,
      outstanding: subtractDecimal(
        subtractDecimal(decimal(balance.total), decimal(balance.received)),
        preview.applied,
      ),
    };
  };
  const listedRetention = async (tx: Transaction, paymentId: string, remaining: string) => {
    const [payment] = await tx.select().from(payments).where(eq(payments.id, paymentId));
    if (payment!.billPaymentId !== null) {
      const [bill] = await tx
        .select()
        .from(billPayments)
        .where(eq(billPayments.id, payment!.billPaymentId));
      if (bill?.state !== "pending") return {};
    }
    try {
      return { retention: await retentionPreview(tx, payment!, remaining) };
    } catch (error) {
      if (
        isAppError(error) &&
        [
          "bill.tip_not_allowed",
          "bill.nothing_outstanding",
          "order.payment_in_flight",
          "bill.refund_in_progress",
        ].includes(error.code)
      )
        return {};
      throw error;
    }
  };

  const partialView = async (tx: Transaction, paymentId: string, amount: number) => {
    const { partialRefund } = await refundFacts(tx, paymentId, amount);
    return { partialRefund, ...(await listedRetention(tx, paymentId, partialRefund.remaining)) };
  };

  const allocationChanged = (
    workingOrderId: string,
    allocation: Awaited<ReturnType<typeof retentionPreview>>,
  ) =>
    new AppError("bill.allocation_changed", {
      workingOrderId,
      preview: {
        kind: "allocated",
        applied: allocation.applied,
        tip: allocation.tip,
        charged: allocation.remaining,
        change: null,
      },
    });

  app.post("/management-api/payments/partial-refunds/:id/retain", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const paymentId = requireUuidParam(c.req.param("id"), "PaymentId");
      const body = await readJsonBody<Record<string, unknown>>(c);
      const seen = {} as { remaining: string; applied: string; tip: string };
      for (const field of ["remaining", "applied", "tip"] as const) {
        if (typeof body[field] !== "string" || !MONEY.test(body[field]))
          throw new AppError("management.request_invalid", { field });
        seen[field] = body[field];
      }
      const read = async (tx: Transaction) => {
        const [row] = await tx
          .select({ payment: payments, bill: billPayments, order: workingOrders })
          .from(payments)
          .innerJoin(workingOrders, eq(workingOrders.id, payments.workingOrderId))
          .innerJoin(billPayments, eq(billPayments.id, payments.billPaymentId))
          .where(and(eq(payments.id, paymentId), await collectionScope(tx)));
        if (!row) {
          await refuseUntilRecordable(tx);
          throw new AppError("payment.not_stuck", { paymentId });
        }
        const { payment, bill, order } = row;
        if (
          bill.state === "received" &&
          bill.attestationNote === "Retained confirmed remaining money"
        ) {
          if (
            compareDecimal(decimal(seen.applied), centsToDecimal(bill.applied)) !== 0 ||
            compareDecimal(decimal(seen.tip), centsToDecimal(bill.tip)) !== 0 ||
            decimalToCents(decimal(seen.remaining)) !== bill.applied + bill.tip
          )
            throw new AppError("management.request_invalid", { field: "remaining" });
          return {
            ...row,
            replay: true as const,
            allocation: { ...seen, outstanding: centsToDecimal(bill.remainingAfter!) },
          };
        }
        await refuseUntilRecordable(tx);
        if (
          !refundReleaseProviders.includes(payment.provider) ||
          payment.state !== "partially_refunded" ||
          payment.saleId !== null ||
          !["open", "placed"].includes(order.status) ||
          bill.state !== "pending" ||
          billPaymentIsLive(deps.db, bill.id)
        )
          throw new AppError("payment.not_stuck", { paymentId });
        const facts = await refundFacts(tx, paymentId, payment.amount);
        if (facts.refunds.some((r) => r.providerRefundRef === null))
          throw new AppError("payment.outcome_unknown", {
            paymentId,
            reason: "refund_reference_missing",
          });
        const allocation = await retentionPreview(tx, payment, facts.partialRefund.remaining);
        for (const field of ["remaining", "applied", "tip"] as const)
          if (compareDecimal(decimal(seen[field]), allocation[field]) !== 0)
            throw allocationChanged(payment.workingOrderId, allocation);
        return { ...row, replay: false as const, allocation, refunds: facts.refunds };
      };
      const before = await gated(sessionId, read);
      if (before.replay) return c.json({ outcome: "retained", ...before.allocation });
      await gated(sessionId, (tx) =>
        requireConnected(tx, cardProviderById(deps.providers, before.payment.provider)),
      );
      const provider = await deps.pool.get(before.payment.provider);
      if (!provider.lookupCompletedRefunds)
        throw new AppError("payment.resolve_unsupported", { providerId: before.payment.provider });
      const evidence =
        before.payment.externalRef === null
          ? { kind: "unknown" as const }
          : await provider.lookupCompletedRefunds(before.payment.externalRef);
      let changedEvidence: AppError | undefined;
      const answer = await withSettledSlip((print) =>
        gated(sessionId, async (tx, personId) => {
          const current = await read(tx);
          if (current.replay) return current.allocation;
          const { payment, bill, allocation, refunds } = current;
          await acceptRefundEvidence(tx, payment, refunds, evidence, personId, false);
          const nowFacts = await refundFacts(tx, paymentId, payment.amount);
          if (compareDecimal(nowFacts.partialRefund.remaining, allocation.remaining) !== 0) {
            // Keep identified provider refunds visible on refresh; the bill stays held for a new confirmation.
            changedEvidence = allocationChanged(
              payment.workingOrderId,
              await retentionPreview(tx, payment, nowFacts.partialRefund.remaining),
            );
            return allocation;
          }
          const attestation = { attestedBy: personId, note: "Retained confirmed remaining money" };
          const receivedAt = new Date(payment.settledAt!);
          await completeBillPayment(tx, fiscal, deps.cfg, bill.id, receivedAt, {
            attestation,
            confirmedNet: { applied: allocation.applied, tip: allocation.tip },
            datedByLatestAcceptance: true,
          });
          await print(tx, bill.id);
          return allocation;
        }),
      );
      if (changedEvidence) throw changedEvidence;
      return c.json({ outcome: "retained", ...answer });
    }),
  );

  app.post("/management-api/payments/partial-refunds/:id/release", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const paymentId = requireUuidParam(c.req.param("id"), "PaymentId");
      const read = async (tx: Transaction) => {
        await refuseUntilRecordable(tx);
        const [row] = await tx
          .select({
            payment: payments,
            billId: billPayments.id,
            billState: billPayments.state,
          })
          .from(payments)
          .innerJoin(workingOrders, eq(workingOrders.id, payments.workingOrderId))
          .innerJoin(billPayments, eq(billPayments.id, payments.billPaymentId))
          .where(
            and(eq(payments.id, paymentId), partialRefundEligible(true), await collectionScope(tx)),
          );
        if (!row || billPaymentIsLive(deps.db, row.billId))
          throw new AppError("payment.not_stuck", { paymentId });
        const refunds =
          row.payment.state === "partially_refunded"
            ? (await refundFacts(tx, paymentId, row.payment.amount)).refunds
            : [];
        if (refunds.some((refund) => refund.providerRefundRef === null))
          throw new AppError("payment.outcome_unknown", {
            paymentId,
            reason: "refund_reference_missing",
          });
        return { ...row, refunds };
      };
      const before = await gated(sessionId, read);
      if (before.payment.state === "refunded") return c.json({ outcome: "released" });
      const seat = cardProviderById(deps.providers, before.payment.provider);
      await gated(sessionId, (tx) => requireConnected(tx, seat));
      const provider = await deps.pool.get(before.payment.provider);
      if (!provider.lookupCompletedRefunds)
        throw new AppError("payment.resolve_unsupported", { providerId: before.payment.provider });
      const evidence =
        before.payment.externalRef === null
          ? { kind: "unknown" as const }
          : await provider.lookupCompletedRefunds(before.payment.externalRef);
      await withSettledSlip((print) =>
        gated(sessionId, async (tx, personId) => {
          const { payment, billId, billState, refunds } = await read(tx);
          if (payment.state === "refunded") return;
          await acceptRefundEvidence(tx, payment, refunds, evidence, personId, true);
          if (billState === "pending")
            await settleFromProviderRow(tx, fiscal, billId, deps.clock.now().instant, print);
        }),
      );
      return c.json({ outcome: "released" });
    }),
  );

  const requireStuckBillPayment = async (tx: Transaction, id: string) => {
    const [row] = await tx.select().from(billPayments).where(eq(billPayments.id, id));
    if (row === undefined) throw new AppError("bill.payment_not_found", { paymentId: id });
    if (row.state !== "pending" || billPaymentIsLive(deps.db, id)) {
      throw new AppError("bill.payment_not_stuck", { paymentId: id });
    }
    const [owned] = await tx
      .select({ id: billPayments.id })
      .from(billPayments)
      .leftJoin(payments, eq(payments.billPaymentId, billPayments.id))
      .where(and(eq(billPayments.id, id), await collectionScope(tx)));
    if (owned === undefined) throw new AppError("bill.payment_not_stuck", { paymentId: id });
    return row;
  };
  const fiscal = {
    db: deps.db,
    backend: deps.backend,
    admission: deps.admission,
    clock: deps.clock,
    cfg: deps.cfg,
    log,
    attendance: deps.attendance,
  };

  // Card payments towards a bill that nothing is driving any more (bill payments design §5.4).
  app.get("/management-api/payments/bill-payments", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const rows = await gated(sessionId, async (tx) => {
        const rows = await tx
          .select({
            partial: partialRefundEligible(),
            providerPaymentId: payments.id,
            providerAmount: payments.amount,
            billPaymentId: billPayments.id,
            workingOrderId: billPayments.workingOrderId,
            orderNumber: workingOrders.orderNumber,
            ...paymentOrderLabelFields,
            source: billPayments.source,
            deviceId: billPayments.deviceId,
            deviceName: devices.label,
            method: billPayments.method,
            applied: billPayments.applied,
            tip: billPayments.tip,
            startedAt: billPayments.createdAt,
            provider: payments.provider,
            providerState: payments.state,
            billState: billPayments.state,
          })
          .from(billPayments)
          .innerJoin(workingOrders, eq(workingOrders.id, billPayments.workingOrderId))
          .leftJoin(devices, eq(devices.id, billPayments.deviceId))
          .leftJoin(payments, eq(payments.billPaymentId, billPayments.id))
          .where(
            and(
              or(eq(billPayments.state, "pending"), partialRefundEligible()),
              await collectionScope(tx),
            ),
          )
          .orderBy(billPayments.createdAt, sql`${billPayments}.rowid`);
        const result = [];
        for (const { partial, providerPaymentId, providerAmount, ...row } of rows)
          result.push({
            ...row,
            ...(partial && providerPaymentId !== null && providerAmount !== null
              ? await partialView(tx, providerPaymentId, providerAmount)
              : {}),
          });
        return withPaymentOrderLabels(tx, result);
      });
      return c.json(
        rows
          .filter((row) => !billPaymentIsLive(deps.db, row.billPaymentId))
          .map((row) => ({
            ...row,
            applied: centsToDecimal(row.applied),
            tip: centsToDecimal(row.tip),
          })),
      );
    }),
  );

  app.post("/management-api/payments/bill-payments/:id/resolve", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "BillPaymentId");
      const stuck = await gated(sessionId, async (tx, personId) => {
        await refuseUntilRecordable(tx);
        await requireStuckBillPayment(tx, id);
        const provided = await findPaymentByBillPayment(tx, id);
        if (provided?.state === "attempting" && provided.provider !== "simulator") {
          await requireConnected(tx, cardProviderById(deps.providers, provided.provider));
        }
        return { provided, personId };
      });

      const fromRow = async () => {
        const settled = await withSettledSlip((print) =>
          gated(sessionId, async (tx) => {
            await requireStuckBillPayment(tx, id);
            return settleFromProviderRow(tx, fiscal, id, deps.clock.now().instant, print);
          }),
        );
        switch (settled.settled) {
          case "received":
            return c.json({
              outcome: "received",
              ...(settled.invoice === null ? {} : { invoiceNumber: settled.invoice.invoiceNumber }),
            });
          case "failed":
            return c.json({ outcome: "not_charged" });
          case "left":
            throw new AppError("bill.payment_outcome_unconfirmed", {
              paymentId: id,
              reason: "ambiguous",
              providerStatus: settled.providerState,
            });
        }
      };

      if (stuck.provided?.state !== "attempting") return fromRow();

      const { resolved, now } = await resolveAtProvider(
        stuck.provided,
        stuck.personId,
        () => new AppError("bill.payment_not_stuck", { paymentId: id }),
      );
      if (resolved.outcome === "unknown") {
        throw new AppError("bill.payment_outcome_unconfirmed", {
          paymentId: id,
          ...unknownOutcome(resolved),
        });
      }
      if (resolved.outcome === "failed") {
        // The provider's own record says nothing was charged, so the reservation is released.
        await withSettledSlip((print) =>
          gated(sessionId, async (tx) => {
            await requireStuckBillPayment(tx, id);
            await failBillPayment(tx, fiscal, deps.cfg, id, now, undefined);
            await print(tx, id);
          }),
        );
        return c.json({ outcome: "not_charged" });
      }
      return fromRow();
    }),
  );

  // A manager records the outcome the provider confirmed when the provider cannot be asked: only
  // with a note, and with their own PIN entered again.
  app.post("/management-api/payments/bill-payments/:id/attest", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "BillPaymentId");
      const { outcome, note, pin } = parseAttestation(
        await readJsonBody<Record<string, unknown>>(c),
        ["received", "failed"] as const,
      );
      const answer = await pinGated(sessionId, pin, async (tx, personId, print) => {
        await refuseUntilRecordable(tx);
        await requireStuckBillPayment(tx, id);
        // A provider row still `attempting` can yet be charged, so no outcome is recorded over it;
        // one that shows the card charged contradicts a failure.
        const provided = await findPaymentByBillPayment(tx, id);
        if (provided?.state === "partially_refunded") {
          throw new AppError("bill.attestation_contradicted", { id, evidence: "captured" });
        }
        if (provided?.state === "attempting") {
          throw new AppError("bill.payment_outcome_unconfirmed", {
            paymentId: id,
            reason: "attempting",
          });
        }
        if (outcome === "failed" && provided !== undefined && CHARGED.has(provided.state)) {
          throw new AppError("bill.attestation_contradicted", { id, evidence: "captured" });
        }
        const attestation = { attestedBy: personId, note };
        const now = deps.clock.now().instant;
        if (outcome === "failed") {
          await failBillPayment(tx, fiscal, deps.cfg, id, now, attestation);
          await print(tx, id);
          return { outcome: "not_charged" as const };
        }
        // Dated when the provider settled it, as the work loop does.
        const receivedAt =
          provided === undefined || provided.settledAt === null
            ? now
            : new Date(provided.settledAt);
        const done = await completeBillPayment(tx, fiscal, deps.cfg, id, receivedAt, {
          attestation,
          datedByLatestAcceptance: true,
        });
        await print(tx, id);
        return {
          outcome: "received" as const,
          ...(done.invoice === null ? {} : { invoiceNumber: done.invoice.invoiceNumber }),
        };
      });
      return c.json(answer);
    }),
  );
}
