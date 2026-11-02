import { and, eq, sql } from "drizzle-orm";
import { withTransaction } from "@waitron/db";
import type { ReconcileResult } from "@waitron/fiscal";
import { codeOf } from "@waitron/server-kit";
import { reconcile, type ReconcileDeps, type ReconcileScope } from "./reconcile.js";
import { registrosFacturacion } from "./schema/registros.js";
import { envios } from "./schema/envios.js";

export interface ReconciliationObservation {
  year: string;
  month: string;
  /** A completed lookup of stored records is evidence, never a reservation or a freshness proof. */
  outcome: "observed" | "unknown";
  result?: ReconcileResult;
  errorCode?: string;
}

export interface ReconciliationSweepResult {
  periods: ReconciliationObservation[];
  nextDueAt: Date;
}

export function createReconciliationSweep(
  deps: ReconcileDeps & { scope: ReconcileScope; retryMs: number },
): (now: Date) => Promise<ReconciliationSweepResult> {
  const next = new Map<string, number>();
  const dailyMs = 86_400_000;
  let lastTick: number | undefined;
  let running: Promise<ReconciliationSweepResult> | undefined;
  return (now) => {
    running ??= run(now).finally(() => {
      running = undefined;
    });
    return running;
  };

  async function run(now: Date): Promise<ReconciliationSweepResult> {
    // A wall-clock correction must not postpone a daily check until the old clock catches up.
    if (lastTick !== undefined && now.getTime() < lastTick) next.clear();
    lastTick = now.getTime();
    const month = sql<string>`substr(${registrosFacturacion.fechaExpedicionFactura}, 1, 7)`;
    const stored = await withTransaction(deps.db, (tx) =>
      tx
        .selectDistinct({ month })
        .from(registrosFacturacion)
        .innerJoin(envios, eq(envios.registroId, registrosFacturacion.id))
        .where(
          and(
            eq(registrosFacturacion.nodeId, deps.scope.nodeId),
            eq(registrosFacturacion.idEmisorFactura, deps.scope.taxpayerId),
            eq(registrosFacturacion.entorno, deps.scope.environment),
          ),
        )
        .orderBy(month),
    );
    const periods: ReconciliationObservation[] = [];
    for (const { month: key } of stored) {
      if ((next.get(key) ?? -Infinity) > now.getTime()) continue;
      const period = { year: key.slice(0, 4), month: key.slice(5, 7) };
      try {
        const result = await reconcile(deps, period);
        const outcome =
          result.checked > 0 && (result.deferred?.length ?? 0) === 0 ? "observed" : "unknown";
        periods.push({ ...period, outcome, result });
        next.set(key, now.getTime() + (outcome === "observed" ? dailyMs : deps.retryMs));
      } catch (error) {
        periods.push({ ...period, outcome: "unknown", errorCode: codeOf(error) });
        next.set(key, now.getTime() + deps.retryMs);
      }
    }
    return {
      periods,
      nextDueAt: new Date(
        Math.min(now.getTime() + dailyMs, ...stored.map(({ month: key }) => next.get(key)!)),
      ),
    };
  }
}
