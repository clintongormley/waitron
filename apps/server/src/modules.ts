import { ALL_MODULES } from "@waitron/composition";
import { tablesForPublication, type ClassifiedTable } from "@waitron/sync";
import type { FloorAnnotator, ModulePermission, WaitronModule } from "@waitron/module";

export { ALL_MODULES };

/** Every ENABLED module's floor-read annotator (SP1 bookings), for `listTablesWithState`. UNLIKE
 * `ALL_MODULE_PERMISSIONS` — which folds ALL_MODULES because a disabled module mounts no route, so its
 * permission is unreachable anyway — this MUST be the ENABLED set: the annotator is reached by the
 * always-on floor read, and a disabled module's backing table is not migrated, so querying it would turn
 * every floor poll into a 500. Boot passes `setsToMigrate` (the enabled set), mirroring the generic
 * route mount. */
export function enabledFloorAnnotators(
  modules: readonly WaitronModule[],
): readonly FloorAnnotator[] {
  return modules.flatMap((m) => (m.floorAnnotations ? [m.floorAnnotations] : []));
}

/** Every module's permission-seat contribution, assembled at the composition root and folded into
 * identity's role ladder once at boot (`registerModulePermissions`), before any route auth runs.
 * Assembled over ALL_MODULES, NOT the enabled set: a disabled module mounts no route, so its
 * permission is unreachable anyway, and folding it in regardless keeps this seam free of the
 * enabled-set filter. */
export const ALL_MODULE_PERMISSIONS: readonly ModulePermission[] = ALL_MODULES.flatMap(
  (m) => m.permissions ?? [],
);

/** Swap S1: every module's table classification, in ALL_MODULES order. The two publication table
 * lists below are derived from it; native replication publishes those tables. */
export const ALL_CLASSIFICATIONS: readonly ClassifiedTable[] = ALL_MODULES.flatMap(
  (m) => m.classification ?? [],
);
export const LEDGER_PUBLICATION_TABLES: readonly string[] = tablesForPublication(
  ALL_CLASSIFICATIONS,
  "ledger",
);
export const STATE_PUBLICATION_TABLES: readonly string[] = tablesForPublication(
  ALL_CLASSIFICATIONS,
  "state",
);
