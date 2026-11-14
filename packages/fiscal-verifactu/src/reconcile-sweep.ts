import { and, eq, inArray } from "drizzle-orm";
import { withTransaction } from "@waitron/db";
import type { ReconcileResult } from "@waitron/fiscal";
import { codeOf } from "@waitron/server-kit";
import { reconcile, type ReconcileDeps, type ReconcileScope } from "./reconcile.js";
import { imputationMonth } from "./registro-row.js";
import { registrosFacturacion } from "./schema/registros.js";
import { envios } from "./schema/envios.js";
import { readLiveReconciliationSeries } from "./reconcile-series.js";

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
  deps: ReconcileDeps & {
    scope: ReconcileScope;
    retryMs: number;
    includeCurrentPeriod?: boolean;
    now?: () => Date;
  },
): (now: Date, signal?: AbortSignal) => Promise<ReconciliationSweepResult> {
  const next = new Map<string, number>();
  const dailyMs = 86_400_000;
  let lastTick: number | undefined;
  let running: Promise<ReconciliationSweepResult> | undefined;
  return (now, signal) => {
    running ??= run(now, signal).finally(() => {
      running = undefined;
    });
    return running;
  };

  async function run(now: Date, signal?: AbortSignal): Promise<ReconciliationSweepResult> {
    // A wall-clock correction must not postpone a daily check until the old clock catches up.
    if (lastTick !== undefined && now.getTime() < lastTick) next.clear();
    lastTick = now.getTime();
    const month = imputationMonth(
      registrosFacturacion.fechaOperacion,
      registrosFacturacion.fechaExpedicionFactura,
    );
    const stored = await withTransaction(deps.db, (tx) =>
      tx
        .selectDistinct({ month })
        .from(registrosFacturacion)
        .innerJoin(envios, eq(envios.registroId, registrosFacturacion.id))
        .where(
          and(
            inArray(registrosFacturacion.nodeId, deps.scope.historyNodeIds),
            eq(registrosFacturacion.idEmisorFactura, deps.scope.taxpayerId),
            eq(registrosFacturacion.entorno, deps.scope.environment),
          ),
        )
        .orderBy(month),
    );
    const candidates = new Set(stored.map((row) => row.month));
    const currentKey = new Date(now.getTime() + deps.clock.now().offsetMinutes * 60_000)
      .toISOString()
      .slice(0, 7);
    const hasLiveSeries =
      deps.includeCurrentPeriod === true &&
      (await withTransaction(deps.db, (tx) => readLiveReconciliationSeries(tx, deps.scope)))
        .length > 0;
    if (hasLiveSeries) {
      candidates.add(currentKey);
      for (const key of next.keys()) candidates.add(key);
      let cursor = [...candidates].sort()[0]!;
      while (cursor < currentKey) {
        candidates.add(cursor);
        const year = Number(cursor.slice(0, 4));
        const month = Number(cursor.slice(5, 7));
        cursor =
          month === 12
            ? `${String(year + 1).padStart(4, "0")}-01`
            : `${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}`;
      }
    }
    const periods: ReconciliationObservation[] = [];
    for (const key of [...candidates].sort()) {
      if (signal?.aborted) break;
      if ((next.get(key) ?? -Infinity) > now.getTime()) continue;
      const period = { year: key.slice(0, 4), month: key.slice(5, 7) };
      try {
        const result = await reconcile({ ...deps, signal }, period);
        const outcome =
          (result.checked > 0 || hasLiveSeries) && (result.deferred?.length ?? 0) === 0
            ? "observed"
            : "unknown";
        periods.push({ ...period, outcome, result });
      } catch (error) {
        periods.push({ ...period, outcome: "unknown", errorCode: codeOf(error) });
      }
    }
    const finishedAt = Math.max(now.getTime(), deps.now?.().getTime() ?? now.getTime());
    for (const period of periods)
      next.set(
        `${period.year}-${period.month}`,
        finishedAt + (period.outcome === "observed" ? dailyMs : deps.retryMs),
      );
    return {
      periods,
      nextDueAt: new Date(
        Math.min(
          finishedAt + dailyMs,
          ...[...candidates].map((key) => next.get(key) ?? now.getTime() + deps.retryMs),
        ),
      ),
    };
  }
}
