import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { openVenueDatabase, readBreakGlassKeyName } from "@waitron/db";
import type { OperationBinding } from "@waitron/module";
import { readRecoveryCopyPreview, type RecoveryBackupPreview } from "./recovery-backup-preview.js";
import { withRecoveryKeyAuthority } from "./operation-authentication.js";
import type { RecoveryPreparationSource } from "./setup-recovery-preparation-api.js";
import {
  copyStagedCopy,
  readArtifactIdentity,
  validateArtifact,
  validateDatabaseEntries,
  type ValidationDeps,
  type ValidatedArtifact,
} from "./restore.js";
import { prepareStreamRestore, type PrepareStreamDeps } from "./restore-stream.js";
import { parseRecoveryKit } from "@waitron/stream";
import { AppError } from "@waitron/shared";
import "./errors.js";
import type { createCloudRecoveryClient } from "./cloud-recovery.js";
import type { ArchiveRestoreRequest } from "./restore-request.js";

export type BackupRepairSource = Exclude<RecoveryPreparationSource, { kind: "staged" }>;
export type BackupRepairSourceDeps = Pick<
  ValidationDeps,
  "stateDir" | "stagingDir" | "migrationsRoot" | "modules"
> & {
  bucket: Omit<PrepareStreamDeps, "kit" | "stateDir" | "migrationsRoot" | "oldBoxGone">;
  cloudRecovery?: ReturnType<typeof createCloudRecoveryClient>;
};
export async function openFirstSetupBackupSource(
  source: BackupRepairSource,
  deps: BackupRepairSourceDeps,
  context: { oldBoxGone: boolean } = { oldBoxGone: false },
): Promise<{ copy: ValidatedArtifact; sourceId: string; cloudRequest?: ArchiveRestoreRequest }> {
  if (source.kind === "archive") {
    const copy = await validateArtifact({ ...deps, ...source });
    return { copy, sourceId: copy.sourceId };
  }
  if (source.kind === "cloud") {
    if (deps.cloudRecovery === undefined) throw new AppError("setup.not_ready", {});
    return deps.cloudRecovery.preview(async (request) => {
      const copy = await validateArtifact({ ...deps, ...request });
      return { copy, sourceId: copy.sourceId, cloudRequest: request };
    }, source.pointId);
  }
  const environment = source.environment;
  const kit = parseRecoveryKit(source.kit);
  const prepared = await prepareStreamRestore({
    ...deps.bucket,
    stateDir: deps.stateDir,
    migrationsRoot: deps.migrationsRoot,
    kit,
    oldBoxGone: context.oldBoxGone,
  });
  try {
    const copy = await validateDatabaseEntries(prepared.entries, prepared.databasePath, {
      ...deps,
      environment,
    });
    return {
      copy: { ...copy, discard: () => prepared.discard() },
      sourceId: `stream:${kit.venueId}:${prepared.generation}`,
    };
  } catch (error) {
    await prepared.discard();
    throw error;
  }
}

export async function authenticatedFirstSetupBackupPreview(
  selected: { copy: ValidatedArtifact; sourceId: string },
  binding: OperationBinding,
  secret: string,
  deps: Pick<ValidationDeps, "modules" | "migrationsRoot">,
): Promise<RecoveryBackupPreview> {
  const copy = {
    ...selected.copy,
    manifest: structuredClone(selected.copy.manifest),
    nodeDump: Uint8Array.from(selected.copy.nodeDump),
    secretEntries: selected.copy.secretEntries.map((entry) => ({
      name: entry.name,
      bytes: Uint8Array.from(entry.bytes),
    })),
  };
  const sourceId = selected.sourceId;
  const held = Object.freeze({ ...binding });
  const { node } = readArtifactIdentity(copy.secretEntries);
  const refuse = (): never => {
    throw new AppError("promotion.break_glass_invalid", {});
  };
  if (
    held.action !== "restore" ||
    held.sourceId !== copy.sourceId ||
    held.targetNodeId !== node.nodeId
  )
    refuse();
  // Preview migration owns another copy so activation still binds the original validated bytes.
  const directory = await mkdtemp(join(dirname(copy.databasePath), "proof-"));
  try {
    const database = await openVenueDatabase(dirname(await copyStagedCopy(copy, directory)));
    try {
      if (!(await readBreakGlassKeyName(database.venue, node.nodeId))?.trim()) refuse();
      await withRecoveryKeyAuthority(
        { db: database.venue, node: database.node, nodeId: node.nodeId },
        held,
        secret,
        async () => {},
      );
    } finally {
      await database.close();
    }
    const preview = await readRecoveryCopyPreview(
      { ...copy, databasePath: join(directory, "venue.db") },
      sourceId,
      deps,
    );
    return sourceId === copy.sourceId ? preview : { ...preview, activationSourceId: copy.sourceId };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
