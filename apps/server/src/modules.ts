import { ALL_MODULES } from "@waitron/composition";
import type { ClassifiedTable } from "@waitron/sync-enrolment";
import { selectVenueService } from "@waitron/module";
import type {
  AlertEventClaim,
  AlertSource,
  FloorAnnotator,
  ModulePermission,
  VenueServiceContribution,
  WaitronModule,
} from "@waitron/module";

export { ALL_MODULES };

/** The sole venue-service contribution, resolved during module assembly so boot fails immediately. */
export const VENUE_SERVICE: VenueServiceContribution = selectVenueService(ALL_MODULES);

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

/** Every module's table classification, in ALL_MODULES order. The class decides which database file
 * a table lives in (`ledger`/`state` together, `local` apart), which is why no foreign key may cross
 * between the two. */
export const ALL_CLASSIFICATIONS: readonly ClassifiedTable[] = ALL_MODULES.flatMap(
  (m) => m.classification ?? [],
);

/** Every module's incident-code claims. Read from ALL_MODULES: an incident recorded while a module
 * was enabled keeps its area after the module is switched off. */
export const ALL_ALERT_CLAIMS: readonly AlertEventClaim[] = ALL_MODULES.flatMap(
  (m) => m.alerts?.events ?? [],
);

/** The ongoing checks of the modules given — boot passes the enabled set, because a disabled
 * module's tables are not migrated. */
export function enabledAlertSources(modules: readonly WaitronModule[]): readonly AlertSource[] {
  return modules.flatMap((m) => m.alerts?.sources ?? []);
}
