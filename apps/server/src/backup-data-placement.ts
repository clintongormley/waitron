import { applyMigrations, migrationOptionsFor } from "@waitron/migrations";
import { orderedMigrationSets, type WaitronModule } from "@waitron/module";
import { resolveBackupKeyInputs } from "@waitron/credentials";
import { AppError } from "@waitron/shared";
import { loadBackupConfig, loadRecoveryKey } from "./backup-config.js";
import { OPTIONAL_BACKUP_STATE } from "./backup-optional-state.js";
import type { Logger } from "./logger.js";
import {
  readArtifactIdentity,
  restoreDatabase,
  restoreSecrets,
  type ValidatedArtifact,
} from "./restore.js";
import { RECOVERY_FILES } from "./state-secrets.js";
import "./errors.js";

interface PlacementInput {
  venueDir: string;
  modules: readonly WaitronModule[];
  migrationsRoot: string | null;
  log: Logger;
}

export async function placeBackupDatabase(
  databasePath: string,
  input: PlacementInput,
): Promise<void> {
  await restoreDatabase({ databasePath, venueDir: input.venueDir, log: input.log });
  await applyMigrations(
    input.venueDir,
    migrationOptionsFor(orderedMigrationSets(input.modules), input.migrationsRoot),
  );
}

export async function placeBackupData(
  validated: ValidatedArtifact,
  input: PlacementInput & { stateDir: string },
): Promise<void> {
  const allowed = new Set([
    ...RECOVERY_FILES.map((name) => "secrets/" + name),
    ...OPTIONAL_BACKUP_STATE.map((name) => "secrets/" + name),
    ...input.modules.flatMap(
      (module) => module.backup?.verification?.entries.map((entry) => entry.name) ?? [],
    ),
  ]);
  for (const entry of validated.secretEntries) {
    if (!allowed.has(entry.name))
      throw new AppError("restore.unexpected_entry", { name: entry.name });
  }
  const { node } = readArtifactIdentity(validated.secretEntries);
  const read = (name: string) =>
    validated.secretEntries.find((entry) => entry.name === "secrets/" + name)?.bytes;
  const secretsEnv = read("secrets.env");
  if (secretsEnv === undefined)
    throw new AppError("recovery.state_incomplete", { missing: "secrets.env" });
  const env = resolveBackupKeyInputs({
    secretsEnv,
    tradingEnv: read("trading.env")!,
    backupEnv: read("backup.env") ?? null,
  });
  loadRecoveryKey(env);
  loadBackupConfig(env, node.locationId);
  await placeBackupDatabase(validated.databasePath, input);
  await restoreSecrets({
    entries: validated.secretEntries.filter((entry) => entry.name !== "secrets/backup.env"),
    stateDir: input.stateDir,
    log: input.log,
  });
}
