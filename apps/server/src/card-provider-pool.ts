import type { Database } from "@waitron/db";
import type { KeyRing } from "@waitron/credentials";
import {
  cardProviderById,
  type CardProviderContribution,
  type IncidentSink,
  type PaymentProvider,
} from "@waitron/payments";
import type { DeploymentEnvironment } from "./config.js";

/**
 * One live `PaymentProvider` per `providerId`, built from the sealed credential on first use and
 * dropped on `evict`, so a credential change takes effect without a restart.
 *
 * The provider carries NO reader: the reader is a per-collect input (`CollectParams.readerRef`), so
 * one cached provider serves every reader on the same vendor.
 */
export interface CardProviderPool {
  get(providerId: string): Promise<PaymentProvider>;
  evict(providerId: string): void;
}

/** The pool reaches a seat only through `cardProviderById`, never by importing a provider package. */
export function createCardProviderPool(deps: {
  providers: readonly CardProviderContribution[];
  db: Database;
  ring: KeyRing;
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
      // `build` is synchronous, so a throw here surfaces before anything is cached.
      const provider = contribution.build({
        db: deps.db,
        ring: deps.ring,
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
