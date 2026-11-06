import type { MigrationSetSource } from "@waitron/migrations";
import {
  BackupVerificationUnsupported,
  combineBackupVerification,
  modulesWithSets,
  orderedMigrationSets,
  validateBackupVerificationContribution,
  type BackupVerificationContribution,
  type WaitronModule,
} from "@waitron/module";

/**
 * One entry per migration set: the set's own module, the modules whose tables it holds (by name),
 * and a verification covering all of them. Callers pass every module the binary carries, not only
 * the enabled ones, so a switched-off module's tables stay covered.
 */
export function backupVerificationInventory(modules: readonly WaitronModule[]): readonly {
  readonly module: WaitronModule & { readonly migrations: MigrationSetSource };
  readonly hosted: readonly WaitronModule[];
  readonly verification: BackupVerificationContribution;
}[] {
  if (modules.length === 0) throw new BackupVerificationUnsupported("module_missing");
  const names = modules.map((module) => module.name);
  if (
    new Set(names).size !== names.length ||
    names.some((name) => typeof name !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(name))
  ) {
    throw new BackupVerificationUnsupported("target_incompatible");
  }
  try {
    orderedMigrationSets(modules);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      [
        "module.requires_invalid",
        "module.dependency_missing",
        "module.incompatible_version",
        "module.set_ownership_invalid",
        "module.dependency_cycle",
      ].includes(String(error.code))
    ) {
      throw new BackupVerificationUnsupported("target_incompatible");
    }
    throw error;
  }
  const withSets = modulesWithSets(modules);
  const setless = modules.filter((module) => module.migrations === undefined);
  return Object.freeze(
    withSets.map((module) => {
      const hosted = setless
        .filter((m) => m.tablesIn === module.name)
        .sort((a, b) => (a.name < b.name ? -1 : 1));
      return Object.freeze({
        module,
        hosted: Object.freeze(hosted),
        verification: combineBackupVerification(
          validateBackupVerificationContribution(module.backup?.verification),
          hosted.map((m) => validateBackupVerificationContribution(m.backup?.verification)),
        ),
      });
    }),
  );
}
