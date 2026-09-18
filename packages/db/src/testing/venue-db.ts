import { usePgliteDb, type PgliteSuite, type PgliteSuiteOptions } from "./lifecycle.js";

export type VenueDbOptions = PgliteSuiteOptions;
export type VenueDb = PgliteSuite;

/**
 * The seam a PGlite suite asks for its database through, so that the storage switch changes one
 * function body rather than every call site.
 *
 * It forwards to {@link usePgliteDb} unchanged: same options, same handle, same per-test reset.
 * No suite has been converted onto it yet — the suites that call `usePgliteDb` still call it
 * directly, and they convert a package at a time (plan task P2 step 5). Some suites reach PGlite
 * without `usePgliteDb` at all, through `createPgliteDb` or `describeEachTarget`; that conversion
 * is not mechanical and is task F1's, not step 5's.
 *
 * It is NOT the seam for a real container, and it is not the seam for `describeEachTarget` either.
 * `useRealPostgres` names a container deliberately. `describeEachTarget` is a dual-target harness
 * whose PGlite half hands out a fresh cluster PER TEST, where this helper hands out one database
 * per SUITE with a per-test truncate — a different isolation contract, argued for in `Target`'s own
 * doc comment in `harness.ts`. Whether either moves is task F1's question, not this function's.
 */
export function useVenueDb(options: VenueDbOptions): VenueDb {
  return usePgliteDb(options);
}
