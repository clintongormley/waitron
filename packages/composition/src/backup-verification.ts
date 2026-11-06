import type { MigrationSetSource } from "@waitron/migrations";
import {
  BackupVerificationUnsupported,
  modulesWithSets,
  orderedMigrationSets,
  validateBackupVerificationContribution,
  type BackupVerificationContribution,
  type WaitronModule,
} from "@waitron/module";

export function backupVerificationInventory(modules: readonly WaitronModule[]): readonly {
  readonly module: WaitronModule & { readonly migrations: MigrationSetSource };
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
        "module.dependency_cycle",
      ].includes(String(error.code))
    ) {
      throw new BackupVerificationUnsupported("target_incompatible");
    }
    throw error;
  }
  // A module with no set of its own has no journal to check its tables against.
  const withSets = modulesWithSets(modules);
  if (withSets.length !== modules.length) {
    throw new BackupVerificationUnsupported("target_incompatible");
  }
  return Object.freeze(
    withSets.map((module) =>
      Object.freeze({
        module,
        verification: validateBackupVerificationContribution(module.backup?.verification),
      }),
    ),
  );
}
