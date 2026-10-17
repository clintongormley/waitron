import { and, eq, inArray, isNull } from "drizzle-orm";
import { withTransaction, workingOrders } from "@waitron/db";
import { paymentResolutions, payments } from "@waitron/payments";
import type { PaymentProvider } from "@waitron/payments";
import type { CardProviderPool } from "./card-provider-pool.js";
import { storedDeviceOrigin } from "./request-config.js";
import { paymentAttemptIsLive, payWorkingOrderIntegratedOrchestration } from "./till-sale.js";
import type { TillSaleDeps } from "./working-order.js";
import type { TillConfig } from "./till-config.js";
import { realSleep, runLoop, type LoopDeps } from "./loop.js";

export function runPendingCardLoop(
  deps: Pick<LoopDeps, "pass" | "now" | "signal" | "log"> & { sleep?: LoopDeps["sleep"] },
): Promise<void> {
  return runLoop({ ...deps, sleep: deps.sleep ?? realSleep, minTickMs: 5000, maxTickMs: 60_000 });
}

export interface AutomaticCardRecoveryDeps extends TillSaleDeps {
  cfg: TillConfig;
  pool: Pick<CardProviderPool, "get">;
}

export async function recoverAutomaticCardPayments(
  deps: AutomaticCardRecoveryDeps,
): Promise<{ filed: number; errors: { paymentId: string; error: string }[] }> {
  const pending = await withTransaction(deps.db, (tx) =>
    tx
      .select({
        id: payments.id,
        provider: payments.provider,
        orderId: payments.workingOrderId,
      })
      .from(payments)
      .innerJoin(paymentResolutions, eq(paymentResolutions.paymentId, payments.id))
      .innerJoin(workingOrders, eq(workingOrders.id, payments.workingOrderId))
      .where(
        and(
          eq(paymentResolutions.outcome, "captured"),
          isNull(paymentResolutions.personId),
          eq(payments.state, "captured"),
          isNull(payments.saleId),
          isNull(payments.billPaymentId),
          inArray(workingOrders.status, ["open", "placed"]),
        ),
      ),
  );
  let filed = 0;
  const errors: { paymentId: string; error: string }[] = [];
  for (const candidate of pending) {
    try {
      if (paymentAttemptIsLive(deps.db, candidate.orderId)) continue;
      const provider = await deps.pool.get(candidate.provider);
      const [payment] = await deps.db.select().from(payments).where(eq(payments.id, candidate.id));
      if (
        payment?.state !== "captured" ||
        payment.saleId !== null ||
        payment.billPaymentId !== null ||
        paymentAttemptIsLive(deps.db, candidate.orderId)
      )
        continue;
      // Recovery may only consume an existing capture, even if eligibility changes after this read.
      const recoveryProvider: PaymentProvider = new Proxy(provider, {
        get(target, property) {
          if (property === "collect")
            return () => {
              throw new Error("automatic recovery must never collect a payment");
            };
          const value: unknown = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      await payWorkingOrderIntegratedOrchestration(
        { ...deps, provider: recoveryProvider },
        { ...deps.cfg, origin: storedDeviceOrigin(payment) },
        { id: candidate.orderId, lines: [] },
      );
      filed++;
    } catch (error) {
      errors.push({ paymentId: candidate.id, error: String(error) });
    }
  }
  return { filed, errors };
}
