import type { Transaction } from "@waitron/db";
import { listAbandonedRefundOutcomes } from "@waitron/payments";
import { type Logger, requireManagementSession } from "@waitron/server-kit";
import type { Hono } from "hono";
import { run } from "./payments-api-errors.js";

export function mountPaymentsAbandonedRefundRoutes(
  app: Hono,
  log: Logger,
  gated: <T>(
    sessionId: string,
    fn: (tx: Transaction, personId: string) => Promise<T>,
  ) => Promise<T>,
): void {
  app.get("/management-api/payments/abandoned-refunds", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const rows = await gated(sessionId, (tx) => listAbandonedRefundOutcomes(tx, "sumup"));
      return c.json(
        rows.map((row) => ({
          paymentRef: row.paymentRef,
          workingOrderId: row.workingOrderId,
          externalRef: row.externalRef,
          amount: row.amount,
          claimedAt: row.claimedAt,
          settledAt: row.settledAt,
          outcome: row.outcome,
        })),
      );
    }),
  );
}
