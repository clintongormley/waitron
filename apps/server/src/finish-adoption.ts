import { PENDING_ADOPTION_FILE } from "@waitron/store";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { nodeSigningPublicKey, setPairLinkStateTx, type KeyRing } from "@waitron/credentials";
import { nodes, withNodeTransaction, type Database, type NodeDatabase } from "@waitron/db";
import "@waitron/module";
import type { WaitronModule } from "@waitron/module";
import { codeOf } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import "./errors.js";
import { writeFileDurable } from "./fs-atomic.js";
import type { StandbyPublicIdentity } from "./reserved-identity.js";
import type { ReservedIdentity } from "./mirror-bundle.js";
import type { Logger } from "./logger.js";
import { readNodeIdentityKey } from "./node-identity.js";

export function assertAdoptionModules(modules: readonly WaitronModule[]): void {
  for (const module of modules) {
    // The adoption latch carries no live authority for a separately prepared allocation.
    if (module.operations !== undefined && module.provisioning?.standby?.series === "on-activation")
      throw new AppError("mirror.standby_series_unsupported", { module: module.name });
  }
}

/** What a joining spare records when it adopts; the file stays until the spare finishes joining. */
export interface PendingAdoption {
  standby: StandbyPublicIdentity;
  nodeName: string;
  filingModule: string | null;
  taxModule: string | null;
  reserved: ReservedIdentity;
  originNodeId: string;
}

function pendingPath(stateDir: string): string {
  return join(stateDir, PENDING_ADOPTION_FILE);
}

/** Atomically write `<stateDir>/pending-adoption.json` (0600, tmp+rename). */
export async function writePendingAdoption(stateDir: string, p: PendingAdoption): Promise<void> {
  await writeFileDurable(pendingPath(stateDir), JSON.stringify(p), 0o600);
}

/** Read the pending-adoption record, or `null` when the file is absent (finished joining, or
 * never pending). Any other read/parse error propagates — a corrupt record is a loud boot failure. */
export async function readPendingAdoption(stateDir: string): Promise<PendingAdoption | null> {
  let raw: string;
  try {
    raw = await readFile(pendingPath(stateDir), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return JSON.parse(raw) as PendingAdoption;
}

/**
 * Finishes joining once `venue.db` (the placed first copy) holds this box's `nodes` row with the
 * public half of the key this box's `node.db` seals; until then the latch stays and the next start
 * tries again. The link is marked `copied` before the latch goes, so a start between the two finds
 * the latch, takes no second copy, and finishes here.
 */
export async function runFinishAdoption(deps: {
  ownerDb: Database;
  node: NodeDatabase;
  ring: KeyRing;
  nodeId: string;
  stateDir: string;
  modules: readonly WaitronModule[];
  restart: () => void;
  log: Logger;
}): Promise<void> {
  const pending = await readPendingAdoption(deps.stateDir);
  if (pending === null) return;
  try {
    assertAdoptionModules(deps.modules);
    const [row] = await deps.ownerDb
      .select({ publicKey: nodes.publicKey })
      .from(nodes)
      .where(eq(nodes.id, deps.nodeId));
    if (row === undefined) throw new AppError("mirror.venue_not_copied", {});
    const own = nodeSigningPublicKey(await readNodeIdentityKey(deps.node, deps.ring, deps.nodeId));
    // Only a fault in Waitron produces this: the main box wrote the key this box sent it.
    if (row.publicKey !== own) throw new AppError("node.identity_mismatch", {});
    await withNodeTransaction(deps.node, (tx) => setPairLinkStateTx(tx, deps.nodeId, "copied"));
    await rm(pendingPath(deps.stateDir), { force: true });
    deps.log("info", "adoption.established", { nodeId: deps.nodeId });
    deps.restart();
  } catch (error) {
    // Never fatal here: the latch stays, so the next start re-enters it and retries.
    deps.log("error", "adoption.establish_failed", { code: codeOf(error) });
  }
}

export { PENDING_ADOPTION_FILE } from "@waitron/store";
