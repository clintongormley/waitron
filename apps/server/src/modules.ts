import { ALL_MODULES } from "@waitron/composition";
import type { ClassifiedTable } from "@waitron/sync-enrolment";
import { modulesSettings, selectVenueService } from "@waitron/module";
import type { OwnedStaffNoticeSource } from "./staff-notices.js";
import type {
  AlertEventClaim,
  AlertSource,
  FloorAnnotator,
  ModulePermission,
  TableRemoval,
  VenueServiceContribution,
  WaitronModule,
} from "@waitron/module";

export { ALL_MODULES };
export const MODULES_SETTINGS = modulesSettings(ALL_MODULES);

/** The members of `ALL_MODULES` whose name is listed, in `ALL_MODULES` order. */
export function modulesNamed(names: readonly string[]): readonly WaitronModule[] {
  return ALL_MODULES.filter((m) => names.includes(m.name));
}

/** The sole venue-service contribution, resolved during module assembly so boot fails immediately. */
export const VENUE_SERVICE: VenueServiceContribution = selectVenueService(ALL_MODULES);

export function enabledFloorAnnotators(
  modules: readonly WaitronModule[],
): readonly FloorAnnotator[] {
  return modules.flatMap((m) => (m.floorAnnotations ? [m.floorAnnotations] : []));
}

export function enabledTableRemovals(modules: readonly WaitronModule[]): readonly TableRemoval[] {
  return modules.flatMap((m) => (m.tableRemoval ? [m.tableRemoval] : []));
}

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

export function enabledAlertSources(modules: readonly WaitronModule[]): readonly AlertSource[] {
  return modules.flatMap((m) => m.alerts?.sources ?? []);
}

export function enabledStaffNoticeSources(
  modules: readonly WaitronModule[],
): readonly OwnedStaffNoticeSource[] {
  return modules.flatMap((m) =>
    (m.staffNotices ?? []).map((source) => ({ owner: m.name, source })),
  );
}
