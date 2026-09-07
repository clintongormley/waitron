import { ALL_MODULES } from "@waitron/composition";
import type { EnrolledTable } from "@waitron/sync";
import type { ModulePermission } from "@waitron/module";

export { ALL_MODULES };

/** Every module's permission-seat contribution, assembled at the composition root and folded into
 * identity's role ladder once at boot (`registerModulePermissions`), before any route auth runs.
 * Assembled over ALL_MODULES, NOT the enabled set: a disabled module mounts no route, so its
 * permission is unreachable anyway, and folding it in regardless keeps this seam free of the
 * enabled-set filter (mirrors ALL_SYNC_ENROLMENTS above). */
export const ALL_MODULE_PERMISSIONS: readonly ModulePermission[] = ALL_MODULES.flatMap(
  (m) => m.permissions ?? [],
);

/** The composition root's assembled sync-enrolment set — every module's declared enrolment, in
 * ALL_MODULES order (SP-2a inversion). `@waitron/sync` no longer owns this; boot injects it into
 * mountSyncApi/runSyncPull/readDrainProgress, and the tests use the same reference. Assembled from
 * ALL_MODULES (not the enabled set) — the enabled-set-aware pull is DEFERRED (spec §2/§7), built
 * with the first genuinely-toggleable module. */
export const ALL_SYNC_ENROLMENTS: readonly EnrolledTable[] = ALL_MODULES.flatMap(
  (m) => m.sync ?? [],
);

/** table → owning-module name, built at the composition root (SP-2b). The apply gate resolves a
 * sync_log row's module by table name; it is a side map rather than a field on EnrolledTable so
 * SP-2a's enrolment type and its threading stay untouched (spec §5). */
export const MODULE_BY_TABLE: ReadonlyMap<string, string> = new Map(
  ALL_MODULES.flatMap((m) => (m.sync ?? []).map((e) => [e.table, m.name] as const)),
);
