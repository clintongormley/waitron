import "./errors.js";
import { existsSync } from "node:fs";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { nodeSigningPublicKey } from "@waitron/credentials";
import { readNodeMembership, type Database, type DeploymentEnvironment } from "@waitron/db";
import {
  servingPrimaryNodeId,
  verifyMembershipDocument,
  type SignedMembershipDocument,
} from "@waitron/membership";
import { checkHandoverCopy, type WaitronModule } from "@waitron/module";
import { writeFileDurable } from "@waitron/provisioning";
import { AppError } from "@waitron/shared";
import { openBackupQuery, PAIR_COPY_DIR, SCRATCH_DIR, VENUE_FILE } from "@waitron/store";
import { MIN_RECOVERY_KEY_LENGTH, readHeldKey } from "./backup-config.js";
import { isUnset } from "./env-value.js";
import { COPY_READY_FILE, type SelectedCopy } from "./handover-copy-selection.js";
import { readStoredTrustSet, type StoredTrustDeps } from "./membership-trust.js";
import { readNodeIdentityKey } from "./node-identity.js";
import { validateArtifactFile } from "./restore.js";
import { checkCopyIntegrity } from "./handover-integrity.js";
import { checkCopy } from "./spare-copy.js";
import { reachDisk } from "./sync-path.js";

export type CheckedCopyDeps = StoredTrustDeps & {
  db: Database;
  stateDir: string;
  modules: readonly WaitronModule[];
  migrationsRoot: string | null;
  signal?: AbortSignal;
};

/** Checks a copy read-only where it lies, then publishes one copy of it under `selection`. */
export async function stageCheckedCopy(
  deps: CheckedCopyDeps,
  path: string,
  selection: SelectedCopy,
): Promise<void> {
  if (!(await checkCopyIntegrity(path, { signal: deps.signal })))
    throw new AppError("handover.copy_damaged", {});
  const publicKey = nodeSigningPublicKey(
    await readNodeIdentityKey(deps.node, deps.ring, deps.nodeId),
  );
  if (!(await checkCopy(path, deps.nodeId, publicKey, deps.migrationsRoot)))
    throw new AppError("handover.copy_predates_destination", {});
  const opened = await openBackupQuery(path);
  try {
    let chart: SignedMembershipDocument | null = null;
    for await (const row of opened.query.rows("select document from node_membership where id = 1"))
      chart = JSON.parse(String(row.document)) as SignedMembershipDocument;
    const heldChart = await readNodeMembership(deps.db);
    const source = heldChart === null ? undefined : servingPrimaryNodeId(heldChart);
    if (
      chart === null ||
      !verifyMembershipDocument(chart, await readStoredTrustSet(deps)).valid ||
      source === undefined ||
      servingPrimaryNodeId(chart) !== source ||
      !chart.body.nodes.some(
        (node) => node.nodeId === deps.nodeId && node.standing === "serving-secondary",
      )
    )
      throw new AppError("handover.copy_predates_destination", {});
    const checked = await checkHandoverCopy(deps.modules, opened.query);
    if (!checked.ok) throw new AppError("handover.chain_broken", { module: checked.module });
  } finally {
    await opened.close();
  }
  const folder = join(deps.stateDir, PAIR_COPY_DIR);
  await mkdir(folder, { recursive: true, mode: 0o700 });
  // A stopped replacement must never leave an old marker vouching for partial new bytes.
  await rm(join(folder, COPY_READY_FILE), { force: true });
  await reachDisk(folder);
  try {
    await copyFile(path, join(folder, VENUE_FILE));
    await reachDisk(join(folder, VENUE_FILE));
    await writeFileDurable(join(folder, COPY_READY_FILE), JSON.stringify(selection), 0o600);
  } catch (error) {
    // A published marker still owns a whole checked copy, even if its folder sync failed.
    if (!existsSync(join(folder, COPY_READY_FILE)))
      await rm(join(folder, VENUE_FILE), { force: true }).catch(() => {});
    throw error;
  }
}

/** The key the setup page typed; a too-short key the box holds stays `backup.recovery_key_too_short`. */
function typedRecoveryKey(recoveryKey: string | undefined): string | undefined {
  if (isUnset(recoveryKey)) return undefined;
  if (recoveryKey.length < MIN_RECOVERY_KEY_LENGTH) {
    throw new AppError("backup.new_recovery_key_too_short", { min: MIN_RECOVERY_KEY_LENGTH });
  }
  return recoveryKey;
}

export async function stageBackupAsCopy(
  deps: CheckedCopyDeps & {
    artifactPath: string;
    recoveryKey?: string;
    readRecoveryKey(): Promise<string | undefined>;
    environment: DeploymentEnvironment;
  },
): Promise<SelectedCopy> {
  const recoveryKey =
    typedRecoveryKey(deps.recoveryKey) ?? (await readHeldKey(deps.readRecoveryKey)).key;
  if (recoveryKey === undefined) throw new AppError("handover.backup_key_missing", {});
  const validated = await validateArtifactFile({
    ...deps,
    recoveryKey,
    stagingDir: join(deps.stateDir, SCRATCH_DIR),
    skipSecrets: true,
  });
  try {
    const selection: SelectedCopy = { source: "selected-backup", sourceId: validated.sourceId };
    await stageCheckedCopy(deps, validated.databasePath, selection);
    return selection;
  } finally {
    await validated.discard();
  }
}
