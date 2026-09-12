import type { Database } from "@waitron/db";
import type { KeyRing } from "@waitron/credentials";
import type { TenantId } from "@waitron/shared";
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
 *
 * The provider carries NO reader: which reader a sale charges is a per-collect input
 * (`CollectParams.readerRef`), so one cached provider serves every reader on the same vendor. That
 * is why `get` takes only a `providerId` — a cache hit must not discard a caller's reader, because
 * there is no reader to discard.
 */
export interface CardProviderPool {
  get(providerId: string): Promise<PaymentProvider>;
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
    async get(providerId) {
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
