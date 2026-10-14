import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { eq } from "drizzle-orm";
import { locations, openVenueDatabase, readTenant, readBreakGlassKeyName } from "@waitron/db";
import { AppError } from "@waitron/shared";
import {
  readArtifactIdentity,
  validateArtifact,
  type ValidationDeps,
  type ValidatedArtifact,
} from "./restore.js";
import "./errors.js";

export interface RecoveryBackupPreview {
  readonly sourceId: string;
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
): Promise<RecoveryBackupPreview> {
  const { node } = readArtifactIdentity(copy.secretEntries);
  const store = await openVenueDatabase(dirname(copy.databasePath));
  try {
    const tenant = await readTenant(store.venue);
    const [location] = await store.venue
      .select({ name: locations.name })
      .from(locations)
      .where(eq(locations.id, node.locationId));
    if (tenant === null || location === undefined)
      throw new AppError("restore.identity_unknown", { nodeId: node.nodeId });
    return {
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
    return await readRecoveryCopyPreview(
      copy,
      createHash("sha256").update(deps.artifact).digest("hex"),
    );
  } finally {
    await copy.discard();
  }
}
