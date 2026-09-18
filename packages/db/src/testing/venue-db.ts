import { usePgliteDb, type PgliteSuite, type PgliteSuiteOptions } from "./lifecycle.js";

/**
 * The one way a suite asks for a venue database.
 *
 * Today it is PGlite, and the options and the handle are PGlite's own — a caller that switches
 * from {@link usePgliteDb} to this changes nothing about how its suite behaves. The point is the
 * seam: the storage switch changes what this function returns, and a suite that named the driver
 * itself would have to change with it.
 *
 * NOT a seam for the other two targets: `useRealPostgres` and `describeEachTarget` name a real
 * container deliberately, and each is decided on its own in task F1 rather than routed through
 * here.
 */
export type VenueDbOptions = PgliteSuiteOptions;
export type VenueDb = PgliteSuite;

export function useVenueDb(options: VenueDbOptions): VenueDb {
  return usePgliteDb(options);
}
