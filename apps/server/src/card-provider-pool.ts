import type { Database } from "@waitron/db";
import type { KeyRing } from "@waitron/credentials";
import type { TenantId, TillId } from "@waitron/shared";
import {
  cardProviderById,
  type CardProviderContribution,
  type IncidentSink,
  type PaymentProvider,
} from "@waitron/payments";
import type { DeploymentEnvironment } from "./config.js";

/**
 * One live `PaymentProvider` per `providerId`, built from the tenant's sealed vault credential on
 * first use and dropped on `evict` so a dashboard credential change takes effect without a
 * restart — `get` after an eviction rebuilds from whatever is sealed now, never the stale instance.
 */
export interface CardProviderPool {
  get(
    providerId: string,
    resolveReader: (tenantId: TenantId, tillId: TillId) => Promise<string>,
  ): Promise<PaymentProvider>;
  evict(providerId: string): void;
}

/** Builds a `CardProviderPool` scoped to one tenant/node. `deps.providers` is the composition list
 * (`CARD_PROVIDERS`, Task 9) — the pool reaches a seat only through `cardProviderById`, never by
 * importing a provider package itself. */
export function createCardProviderPool(deps: {
  providers: readonly CardProviderContribution[];
  db: Database;
  ring: KeyRing;
  tenantId: TenantId;
  nodeId: string;
  environment: DeploymentEnvironment;
  incidents: IncidentSink;
}): CardProviderPool {
  const cache = new Map<string, PaymentProvider>();

  return {
    async get(providerId, resolveReader) {
      const cached = cache.get(providerId);
      if (cached !== undefined) return cached;

      const contribution = cardProviderById(deps.providers, providerId);
      // `build` is synchronous (a seat's own credential read is deferred to its first real call —
      // see @waitron/payments-sumup's `deferredClient`), so a thrown error here surfaces before
      // anything is cached; the `Map` is only written to on success.
      const provider = contribution.build({
        db: deps.db,
        ring: deps.ring,
        tenantId: deps.tenantId,
        nodeId: deps.nodeId,
        environment: deps.environment,
        resolveReader,
        incidents: deps.incidents,
      });
      cache.set(providerId, provider);
      return provider;
    },
    evict(providerId) {
      cache.delete(providerId);
    },
  };
}
