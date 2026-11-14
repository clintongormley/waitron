import { dirname } from "node:path";
import { openVenueDatabase, readTenant, readVenue, readSettings } from "@waitron/db";
import { readRecoveryKeyName } from "@waitron/node-db";
import { AppError, isAppError } from "@waitron/shared";
import { applyMigrations, migrationOptionsFor } from "@waitron/migrations";
import { orderedMigrationSets, modulesSettings } from "@waitron/module";
import {
  openStagedCopy,
  readArtifactNode,
  validateDatabaseEntries,
  type EntryValidationDeps,
  validateArtifact,
  type ValidationDeps,
  type ValidatedArtifact,
} from "./restore.js";
import { prepareStreamRestore, type PrepareStreamDeps } from "./restore-stream.js";
import "./errors.js";
import { schemaVersionsByModule } from "./backup-manifest.js";
import { readModuleRecoveryEvidence } from "./backup-sources.js";
import {
  recoveryFiscalSelection,
  type RecoveryFiscalSelection,
} from "./recovery-fiscal-selection.js";

export interface RecoveryBackupPreview {
  readonly moduleEvidence?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly fiscalSelection?: RecoveryFiscalSelection;
  readonly sourceId: string;
  /** A bucket generation can contain several points; activation binds the bytes before migration. */
  readonly activationSourceId?: string;
  readonly createdAt: string;
  readonly environment: "preproduction" | "production";
  readonly nodeId: string;
  readonly nodeRecoveryKeyName: string | null;
  readonly taxpayer: { readonly legalName: string; readonly taxId: string };
  readonly venueName: string;
}

export async function readRecoveryCopyPreview(
  copy: ValidatedArtifact,
  sourceId: string,
  deps: Pick<ValidationDeps, "modules" | "migrationsRoot">,
): Promise<RecoveryBackupPreview> {
  const node = await readArtifactNode(copy);
  const directory = dirname(copy.databasePath);
  const original = await openStagedCopy(directory);
  let recordedVersions: Record<string, number>;
  try {
    recordedVersions = await schemaVersionsByModule(original, deps.modules);
  } finally {
    await original.close();
  }
  // Only the validated private copy is upgraded; the source and live venue retain their bytes.
  await applyMigrations(
    directory,
    migrationOptionsFor(orderedMigrationSets(deps.modules), deps.migrationsRoot),
  );
  const store = await openVenueDatabase(directory);
  try {
    const tenant = await readTenant(store.venue);
    if (tenant === null) throw new AppError("restore.identity_unknown", { nodeId: node.nodeId });
    let venue;
    try {
      venue = await readVenue(store.venue);
    } catch (error) {
      if (
        isAppError(error) &&
        (error.code === "venue.not_found" || error.code === "provisioning.second_venue")
      ) {
        throw new AppError("restore.identity_unknown", { nodeId: node.nodeId });
      }
      throw error;
    }
    const fiscalSelection = recoveryFiscalSelection(
      {
        country: tenant.country,
        fiscalTerritory: venue.fiscalTerritory,
        timeZone: venue.timeZone,
      },
      copy.manifest,
      await readSettings(store.venue, modulesSettings(deps.modules)).then(
        (saved) => saved.doc,
        () => undefined,
      ),
      deps.modules,
      deps.migrationsRoot,
      recordedVersions,
    );
    const moduleEvidence = readModuleRecoveryEvidence(deps.modules, copy.secretEntries);
    return {
      ...(Object.keys(moduleEvidence).length === 0 ? {} : { moduleEvidence }),
      ...(fiscalSelection === undefined ? {} : { fiscalSelection }),
      sourceId,
      createdAt: copy.manifest.createdAt,
      environment: copy.manifest.environment,
      nodeId: node.nodeId,
      nodeRecoveryKeyName: await readRecoveryKeyName(store.node, node.nodeId),
      taxpayer: { legalName: tenant.legalName, taxId: tenant.taxId },
      venueName: venue.name,
    };
  } finally {
    await store.close();
  }
}

export async function previewRecoveryArchive(deps: ValidationDeps): Promise<RecoveryBackupPreview> {
  const copy = await validateArtifact(deps);
  try {
    return await readRecoveryCopyPreview(copy, copy.sourceId, deps);
  } finally {
    await copy.discard();
  }
}

export async function previewRecoveryStream(
  deps: PrepareStreamDeps & EntryValidationDeps,
): Promise<RecoveryBackupPreview> {
  const prepared = await prepareStreamRestore(deps);
  try {
    const copy = await validateDatabaseEntries(prepared.entries, prepared.databasePath, deps);
    const activationSourceId = copy.sourceId;
    const preview = await readRecoveryCopyPreview(
      copy,
      `stream:${deps.kit.venueId}:${prepared.generation}`,
      deps,
    );
    return { ...preview, activationSourceId };
  } finally {
    await prepared.discard();
  }
}
