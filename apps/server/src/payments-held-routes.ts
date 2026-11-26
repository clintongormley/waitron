import { recordIncidentOnce, currentIncidentsOf, markIncidentHandled } from "@waitron/core";
import { type Transaction, workingOrders } from "@waitron/db";
import {
  type HeldAlertSink,
  type HoldOutcome,
  paymentHoldOutcome,
  payments,
  recordHoldOutcome,
  refreshHeldAlert,
} from "@waitron/payments";
import {
  type Logger,
  requireManagementSession,
  requireUuidParam,
  readJsonBody,
} from "@waitron/server-kit";
import { AppError, centsToDecimal } from "@waitron/shared";
import { eq, and, isNotNull, isNull } from "drizzle-orm";
import type { Hono } from "hono";
import { paymentOrderLabelFields, withPaymentOrderLabels } from "./current-order-label.js";
import type { SettledSlipPrinter } from "./payment-slip-print.js";
import type { PaymentsApiDeps } from "./payments-api-deps.js";
import { run } from "./payments-api-errors.js";

const heldAlerts: HeldAlertSink = {
  raise: recordIncidentOnce,
  current: currentIncidentsOf,
  handle: markIncidentHandled,
};
/** The request fields of a held payment's outcome, before the PIN is checked. Unlike an
 * attestation, the note is optional: an absent or blank one is stored as null. */
function parseHoldOutcome(body: Record<string, unknown>): {
  outcome: HoldOutcome;
  note: string | null;
  pin: unknown;
} {
  const outcome = body.outcome;
  if (!paymentHoldOutcome.enumValues.includes(outcome as HoldOutcome)) {
    throw new AppError("management.request_invalid", { field: "outcome" });
  }
  if (body.note !== undefined && typeof body.note !== "string") {
    throw new AppError("management.request_invalid", { field: "note" });
  }
  const note = body.note?.trim() ?? "";
  return { outcome: outcome as HoldOutcome, note: note === "" ? null : note, pin: body.pin };
}

export function mountPaymentsHeldRoutes(
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
  // A card payment the provider settled for a different amount, held until a manager says what
  // was done with it.
  app.get("/management-api/payments/held", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const rows = await gated(sessionId, async (tx) => {
        const rows = await tx
          .select({
            paymentId: payments.id,
            paymentRef: payments.paymentRef,
            provider: payments.provider,
            workingOrderId: payments.workingOrderId,
            orderNumber: workingOrders.orderNumber,
            ...paymentOrderLabelFields,
            settledAt: payments.settledAt,
            amount: payments.amount,
            providerAmount: payments.holdProviderAmount,
          })
          .from(payments)
          .innerJoin(workingOrders, eq(workingOrders.id, payments.workingOrderId))
          .where(and(isNotNull(payments.heldAt), isNull(payments.holdOutcome)))
          .orderBy(payments.heldAt, payments.id);
        return withPaymentOrderLabels(tx, rows);
      });
      return c.json(
        rows.map(({ workingOrderId, label, ...row }) => {
          void workingOrderId;
          return {
            ...row,
            ...(label === null ? {} : { label }),
            amount: centsToDecimal(row.amount),
            providerAmount: centsToDecimal(row.providerAmount!),
          };
        }),
      );
    }),
  );

  app.post("/management-api/payments/held/:id/outcome", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "PaymentId");
      const { outcome, note, pin } = parseHoldOutcome(
        await readJsonBody<Record<string, unknown>>(c),
      );
      await pinGated(sessionId, pin, async (tx, personId) => {
        await refuseUntilRecordable(tx);
        const at = deps.clock.now().instant;
        await recordHoldOutcome(tx, { paymentId: id, outcome, note, personId, at });
        await refreshHeldAlert(tx, heldAlerts, { now: at, by: personId });
      });
      return c.json({ outcome });
    }),
  );
}
