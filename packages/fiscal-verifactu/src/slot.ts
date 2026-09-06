import type { FiscalContribution } from "@waitron/fiscal";
import { VerifactuBackend } from "./backend.js";
import { aeatClientResolver, aeatEndpointFor, mtlsFetch } from "./aeat-transport.js";
import { drain as runDrain } from "./drain.js";

/**
 * The sale path never contacts AEAT — only `drain`/`reconcile` do, and the backend built here is
 * handed to neither (the host's fiscal pass builds its own transport). Reaching this is a bug in the
 * host or the backend, so it rejects loudly rather than ever returning a usable client.
 */
export function rejectResolveClient(): Promise<never> {
  return Promise.reject(new Error("fiscal slot: resolveClient must never be called by recordSale"));
}

/** The fiscal module's slot contribution: the Veri*Factu sale-path backend. Both `environment`
 * (the QR validation host) and `deploymentEnvironment` (the `entorno` stamped on every registro)
 * take the host's deployment, so a preproduction box never files as production. */
export const FISCAL_SLOT: FiscalContribution = {
  id: "verifactu",
  makeBackend: ({ db, clock, environment }) =>
    new VerifactuBackend({
      clock,
      db,
      environment,
      deploymentEnvironment: environment,
      resolveClient: rejectResolveClient,
    }),
  // The runtime submission pass. The regime OWNS its transport: it builds a per-pass mTLS resolver
  // (one TLS pool per tenant with due work, released in `finally`) and hands `runDrain` only the
  // vault-scoped `resolveClient`. `environment` doubles as `runDrain`'s `Entorno` guard and
  // `aeatEndpointFor`'s host selector — the same `"production" | "preproduction"` union — so no cast.
  drain: async ({ db, ring, environment, skipRetryMs, log }, now) => {
    const resolver = aeatClientResolver(
      { db, ring, endpointFor: aeatEndpointFor(environment), fetchFor: mtlsFetch },
      log,
    );
    try {
      return await runDrain({ db, resolveClient: resolver.resolve, skipRetryMs, environment }, now);
    } finally {
      await resolver.closeAll();
    }
  },
};
