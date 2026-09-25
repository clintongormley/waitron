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

/** Every ENABLED module's floor-read annotator, for `listTablesWithState`. This MUST be the ENABLED
 * set: the always-on floor read reaches the annotator, and a disabled module's table is not migrated. */
export function enabledFloorAnnotators(
  modules: readonly WaitronModule[],
): readonly FloorAnnotator[] {
  return modules.flatMap((m) => (m.floorAnnotations ? [m.floorAnnotations] : []));
}

/** Every module's permission-seat contribution. Over ALL_MODULES, NOT the enabled set: a disabled
 * module mounts no route, so its permission is unreachable anyway. */
export const ALL_MODULE_PERMISSIONS: readonly ModulePermission[] = ALL_MODULES.flatMap(
  (m) => m.permissions ?? [],
);

/** Every module's table classification, in ALL_MODULES order. What each class means is on
 * `TableClass` (`@waitron/sync-enrolment`); no foreign key may join a `local` table to a
 * `ledger`/`state` one (`scripts/two-file-foreign-keys.test.ts`). */
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
