import { fiscalSlot } from "@waitron/module";
import type { WaitronModule } from "@waitron/module";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import type { Database } from "@waitron/db";
import { deploymentEnvironment } from "./config.js";

type Env = Record<string, string | undefined>;

/**
 * The wall clock at the moment this host runs, reported as already confident and anchored — the same
 * shape `scripts/record-one-sale.ts`'s own `systemClock` builds, for the same reason: `apps/server`
 * runs on a host whose system clock IS the thing being trusted, not a PWA subject to device drift,
 * so there is no prior anchor to restore and no monotonic source to compare against. `createTrustedClock`
 * (`@waitron/fiscal`) would add nothing here.
 *
 * `anchor`/`currentAnchor` are stubs, never called on the till's sale path: `recordSale` reads
 * `now()` exactly once (`recordTillSale` passes `deps.clock` straight through) and touches neither
 * of the others — the identical shape `write-path-fixtures.ts`'s `steadyClock` documents.
 */
export function systemClock(): TrustedClock {
  return {
    now: () => {
      const instant = new Date();
      return {
        instant,
        // ISO-8601 sign, the negation of `Date.prototype.getTimezoneOffset()`'s own inverted one.
        offsetMinutes: -instant.getTimezoneOffset(),
        confident: true,
        confidence: "anchored",
        anchorAgeSeconds: 0,
      };
    },
    anchor: () => {
      throw new Error("till-backend: anchor() is not used by recordSale");
    },
    currentAnchor: () => null,
  };
}

/**
 * The till's fiscal backend: the enabled module that fills the fiscal slot builds it
 * (`fiscalSlot` refuses zero, two, or a node stamped for another regime). `deploymentEnvironment(env)`
 * is the same resolver the rest of `config.ts` uses, so an unset value takes the safe `preproduction`
 * default and an unrepresentable one is refused here rather than mid-sale.
 */
export function makeFiscalBackend(
  modules: readonly WaitronModule[],
  stamped: string | null,
  db: Database,
  env: Env,
): FiscalBackend {
  return fiscalSlot(modules, stamped).makeBackend({
    db,
    clock: systemClock(),
    environment: deploymentEnvironment(env),
  });
}
