import { fiscalSlot } from "@waitron/module";
import type { WaitronModule } from "@waitron/module";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import type { Database } from "@waitron/db";
import { deploymentEnvironment } from "./config.js";

type Env = Record<string, string | undefined>;

/**
 * The host's wall clock, reported as confident and anchored: on the server the system clock IS the
 * thing being trusted, so there is no prior anchor to restore. `anchor`/`currentAnchor` are stubs
 * that `recordSale` never calls.
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
 * `fiscalSlot` refuses zero, two, or a node stamped for another regime; `deploymentEnvironment`
 * refuses an unrepresentable environment here rather than mid-sale.
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
