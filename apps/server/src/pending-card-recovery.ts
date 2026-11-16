import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { withTransaction, workingOrders, type Transaction } from "@waitron/db";
import { payments } from "@waitron/payments";
import type { PaymentProvider } from "@waitron/payments";
import type { CardProviderPool } from "./card-provider-pool.js";
import { storedDeviceOrigin } from "./request-config.js";
import { paymentAttemptIsLive, payWorkingOrderIntegratedOrchestration } from "./till-sale.js";
import type { TillSaleDeps } from "./working-order.js";
import type { TradingContext } from "./trading-context.js";
import { realSleep, runLoop, type LoopDeps } from "./loop.js";
import type { TradingAdmission } from "./trading-admission.js";

export function runPendingCardLoop(
  deps: Pick<LoopDeps, "pass" | "now" | "signal" | "log"> & {
    admission: TradingAdmission;
    sleep?: LoopDeps["sleep"];
  },
): Promise<void> {
  return runLoop({
    ...deps,
    pass: async (now) => {
      deps.admission.require();
      return deps.pass(now);
    },
    sleep: deps.sleep ?? realSleep,
    minTickMs: 5000,
    maxTickMs: 60_000,
  });
}

export interface AutomaticCardRecoveryDeps extends TillSaleDeps {
  cfg: TradingContext;
  pool: Pick<CardProviderPool, "get">;
}

export function unfiledAutomaticResolutions(tx: Transaction) {
  return (
    tx
      .select({
        id: sql<string>`${payments.id}`,
        provider: sql<string>`${payments.provider}`,
        orderId: sql<string>`${payments.workingOrderId}`,
      })
      // The box collects no planner statistics; keep this sweep on its partial index.
      .from(sql`${payments} indexed by payments_unfiled_resolution_idx`)
      .innerJoin(workingOrders, eq(workingOrders.id, payments.workingOrderId))
      .where(
        and(
          sql`${payments.resolutionOutcome} = 'captured'`,
          isNull(payments.resolvedBy),
          eq(payments.state, "captured"),
          isNull(payments.saleId),
          isNull(payments.billPaymentId),
          inArray(workingOrders.status, ["open", "placed"]),
        ),
      )
  );
}

export async function recoverAutomaticCardPayments(
  deps: AutomaticCardRecoveryDeps,
): Promise<{ filed: number; errors: { paymentId: string; error: string }[] }> {
  deps.admission.require();
  const pending = await withTransaction(deps.db, unfiledAutomaticResolutions);
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
      const recovered = await payWorkingOrderIntegratedOrchestration(
        { ...deps, provider: recoveryProvider },
        { ...deps.cfg, origin: storedDeviceOrigin(payment) },
        { id: candidate.orderId, lines: [], expectedEdit: null },
      );
      if (recovered.outcome === "captured") filed++;
    } catch (error) {
      errors.push({ paymentId: candidate.id, error: String(error) });
    }
  }
  return { filed, errors };
}
