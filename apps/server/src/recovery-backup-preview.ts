import { dirname } from "node:path";
import { eq } from "drizzle-orm";
import { locations, openVenueDatabase, readTenant, readBreakGlassKeyName } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { applyMigrations, migrationOptionsFor } from "@waitron/migrations";
import { orderedMigrationSets } from "@waitron/module";
import {
  readArtifactIdentity,
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
  readonly locationName: string;
}

export async function readRecoveryCopyPreview(
  copy: ValidatedArtifact,
  sourceId: string,
  deps: Pick<ValidationDeps, "modules" | "migrationsRoot">,
): Promise<RecoveryBackupPreview> {
  const { node } = readArtifactIdentity(copy.secretEntries);
  const directory = dirname(copy.databasePath);
  const original = await openVenueDatabase(directory);
  let recordedVersions: Record<string, number>;
  try {
    recordedVersions = await schemaVersionsByModule(original.venue, deps.modules);
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
    const [location] = await store.venue
      .select({
        name: locations.name,
        fiscalTerritory: locations.fiscalTerritory,
        timeZone: locations.timeZone,
      })
      .from(locations)
      .where(eq(locations.id, node.locationId));
    if (tenant === null || location === undefined)
      throw new AppError("restore.identity_unknown", { nodeId: node.nodeId });
    const fiscalSelection = recoveryFiscalSelection(
      {
        country: tenant.country,
        fiscalTerritory: location.fiscalTerritory,
        timeZone: location.timeZone,
      },
      copy.manifest,
      copy.secretEntries,
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
      nodeRecoveryKeyName: await readBreakGlassKeyName(store.venue, node.nodeId),
      taxpayer: { legalName: tenant.legalName, taxId: tenant.taxId },
      locationName: location.name,
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
