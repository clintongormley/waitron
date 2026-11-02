import { readTenant, withTransaction } from "@waitron/db";
import type { FiscalContribution } from "@waitron/fiscal";
import {
  aeatClientResolver,
  aeatEndpointFor,
  mtlsFetch,
  type ClientResolver,
} from "./aeat-transport.js";
import { createReconciliationSweep, type ReconciliationSweepResult } from "./reconcile-sweep.js";

export const createRuntimeReconciliation: NonNullable<
  FiscalContribution["createReconciliation"]
> = (deps) => {
  let taxpayerId: string | undefined;
  let sweep: ReturnType<typeof createReconciliationSweep> | undefined;
  let running: Promise<ReconciliationSweepResult> | undefined;
  const resolvers: ClientResolver[] = [];
  return (now) => {
    running ??= run(now).finally(() => {
      running = undefined;
    });
    return running;
  };

  async function run(now: Date): Promise<ReconciliationSweepResult> {
    try {
      const tenant = await withTransaction(deps.db, readTenant);
      if (tenant === null) throw new Error("reconciliation requires the venue taxpayer");
      if (sweep === undefined || taxpayerId !== tenant.taxId) {
        taxpayerId = tenant.taxId;
        sweep = createReconciliationSweep({
          db: deps.db,
          clock: deps.clock,
          scope: { nodeId: deps.nodeId, taxpayerId, environment: deps.environment },
          retryMs: deps.skipRetryMs,
          resolveClient: () => {
            const resolver = aeatClientResolver(
              {
                db: deps.db,
                ring: deps.ring,
                endpointFor: aeatEndpointFor(deps.environment),
                fetchFor: mtlsFetch,
              },
              deps.log,
            );
            resolvers.push(resolver);
            return resolver.resolve();
          },
        });
      }
      const result = await sweep(now);
      for (const period of result.periods) {
        deps.log?.(
          period.outcome === "unknown" ? "warn" : "info",
          "fiscal.reconciliation_observed",
          {
            year: period.year,
            month: period.month,
            outcome: period.outcome,
            errorCode: period.errorCode,
            checked: period.result?.checked,
            deferred: period.result?.deferred?.length ?? 0,
          },
        );
      }
      return result;
    } finally {
      for (const resolver of resolvers.splice(0)) await resolver.closeAll();
    }
  }
};
