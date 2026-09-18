import { usePgliteDb, type PgliteSuite, type PgliteSuiteOptions } from "./lifecycle.js";

export type VenueDbOptions = PgliteSuiteOptions;
export type VenueDb = PgliteSuite;

/**
 * The seam a PGlite suite asks for its database through, so that the storage switch changes one
 * function body rather than every call site.
 *
 * It forwards to {@link usePgliteDb} unchanged: same options, same handle, same per-test reset.
 * Suites are moving onto it a package at a time (plan task P2 step 5), so until that rollout
 * finishes some still call `usePgliteDb` directly; `git grep -l "usePgliteDb("` answers which,
 * where a list here would be stale by the next pull request. Some suites reach PGlite without
 * `usePgliteDb` at all, through `createPgliteDb` or `describeEachTarget`; that conversion is not
 * mechanical and is task F1's, not step 5's.
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
