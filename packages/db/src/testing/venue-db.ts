import { usePgliteDb, type PgliteSuite, type PgliteSuiteOptions } from "./lifecycle.js";

export type VenueDbOptions = PgliteSuiteOptions;
export type VenueDb = PgliteSuite;

/**
 * The seam a PGlite suite asks for its database through, so that the storage switch changes one
 * function body rather than every call site.
 *
 * It forwards to {@link usePgliteDb} unchanged — same options, same handle, same per-test reset.
 * Suites move onto it one package at a time (plan task P2 step 5,
 * `docs/superpowers/plans/2026-09-16-sqlite-slice1-storage-swap.md`), so this is not yet the only
 * door: until that rollout finishes most suites still call `usePgliteDb` directly.
 *
 * It is NOT the seam for a real container. `useRealPostgres` names one deliberately. And
 * `describeEachTarget` is not a real-container helper either — it registers BOTH targets, PGlite
 * and postgres, and skips the postgres half when Docker is absent (`harness.ts`,
 * `const allTargets: Target[] = [pgliteTarget, postgresTarget()]`), so its PGlite half is the kind
 * of thing this helper could route. Whether either moves is task F1's decision, recorded in the
 * plan, not a property of this function.
 */
export function useVenueDb(options: VenueDbOptions): VenueDb {
  return usePgliteDb(options);
}
