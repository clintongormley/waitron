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
import { checkedRecoveryKey, readHeldKey } from "./backup-config.js";
import { COPY_READY_FILE, type SelectedCopy } from "./handover-copy-selection.js";
import { readStoredTrustSet, type StoredTrustDeps } from "./membership-trust.js";
import { readNodeIdentityKey } from "./node-identity.js";
import { validateArtifactFile } from "./restore.js";
import { checkIntegrity } from "./restore-stream.js";
import { checkCopy } from "./spare-copy.js";
import { reachDisk } from "./sync-path.js";

export async function stageBackupAsCopy(
  deps: StoredTrustDeps & {
    db: Database;
    stateDir: string;
    artifactPath: string;
    recoveryKey?: string;
    readRecoveryKey(): Promise<string | undefined>;
    modules: readonly WaitronModule[];
    environment: DeploymentEnvironment;
    migrationsRoot: string | null;
  },
): Promise<SelectedCopy> {
  const recoveryKey =
    checkedRecoveryKey(deps.recoveryKey) ?? (await readHeldKey(deps.readRecoveryKey)).key;
  if (recoveryKey === undefined) throw new AppError("handover.backup_key_missing", {});
  const validated = await validateArtifactFile({
    ...deps,
    recoveryKey,
    stagingDir: join(deps.stateDir, SCRATCH_DIR),
    skipSecrets: true,
  });
  try {
    const path = validated.databasePath;
    if (!(await checkIntegrity(path))) throw new AppError("handover.copy_damaged", {});
    const publicKey = nodeSigningPublicKey(
      await readNodeIdentityKey(deps.node, deps.ring, deps.nodeId),
    );
    if (!(await checkCopy(path, deps.nodeId, publicKey, deps.migrationsRoot)))
      throw new AppError("handover.copy_predates_destination", {});
    const opened = await openBackupQuery(path);
    try {
      let chart: SignedMembershipDocument | null = null;
      for await (const row of opened.query.rows(
        "select document from node_membership where id = 1",
      ))
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
    const selection: SelectedCopy = { source: "selected-backup", sourceId: validated.sourceId };
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
    return selection;
  } finally {
    await validated.discard();
  }
}
