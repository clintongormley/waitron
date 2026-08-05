import { VerifactuBackend } from "@waitron/fiscal-verifactu";
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
 * A `resolveClient` the till's `recordSale` path never invokes — only `drain`/`reconcile` contact
 * AEAT, and this backend is handed to neither (the server's real drain loop builds its own
 * `aeatClientResolver` in `boot.ts`). So reaching it is a bug in this host or the backend, not a real
 * AEAT contact, and it rejects loudly rather than ever returning a usable client. Exported so its
 * guard is exercised directly in the test rather than left as a never-called closure.
 *
 * Typed `Promise<never>`: it only ever rejects, which is assignable to
 * `VerifactuBackendOptions.resolveClient`'s `Promise<VerifactuClient>` without importing that type.
 */
export function rejectResolveClient(): Promise<never> {
  return Promise.reject(
    new Error("till-backend: resolveClient must never be called by recordSale"),
  );
}

/**
 * The till's fiscal backend: a `VerifactuBackend` built exactly as `scripts/record-one-sale.ts`
 * does, so the till's HTTP `POST /api/sales` writes the same chain that script does. Both
 * `environment` (the QR validation host) and `deploymentEnvironment` (the `entorno` stamped on every
 * registro) resolve through the host's own `deploymentEnvironment(env)` — the same resolver the rest
 * of `config.ts` uses — so an unset value takes the safe `preproduction` default and an
 * unrepresentable one (`"staging"`, a stray `NODE_ENV`) is refused here rather than surfacing as a
 * `registros_entorno_ck` violation mid-sale (spec §4 forbids blocking a sale on anything but itself).
 *
 * `resolveClient` is the never-called stub above; the till never contacts AEAT (spec §4 — fiscal
 * submission is `drain`'s outbox, run separately by this same host's loop).
 */
export function makeFiscalBackend(db: Database, env: Env): FiscalBackend {
  const environment = deploymentEnvironment(env);
  return new VerifactuBackend({
    clock: systemClock(),
    db,
    environment,
    deploymentEnvironment: environment,
    resolveClient: rejectResolveClient,
  });
}
