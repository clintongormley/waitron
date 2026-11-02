import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Database } from "@waitron/db";
import "@waitron/module";
import type { WaitronModule } from "@waitron/module";
import { codeOf } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import { writeFileAtomic } from "./fs-atomic.js";
import {
  establishReservedStandbyIdentity,
  type StandbyPublicIdentity,
} from "./reserved-identity.js";
import { ensureMirrorViewer } from "./mirror-session.js";
import type { ReservedIdentity } from "./mirror-bundle.js";
import type { Logger } from "./logger.js";

/** The file under `<stateDir>` a mirror writes at adopt and clears once its identity is established. */
export const PENDING_ADOPTION_FILE = "pending-adoption.json";

export function assertAdoptionModules(modules: readonly WaitronModule[]): void {
  for (const module of modules) {
    // The adoption latch carries no live authority for a separately prepared allocation.
    if (module.operations !== undefined && module.provisioning?.standby?.series === "on-activation")
      throw new AppError("module.operation_invalid", { module: module.name });
  }
}

/**
 * The pending standby identity a boot establishes. Establishing refuses with
 * `mirror.venue_not_copied` while this database holds no venue row (`reserved-identity.ts`), and
 * nothing copies the main box's rows to a mirror yet, so an adopted mirror stays adoption-pending
 * until a replacement copy mechanism lands (`docs/backlog.md` → Replication, membership & failover).
 */
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
  await writeFileAtomic(pendingPath(stateDir), JSON.stringify(p), 0o600);
}

/** Read the pending-adoption record, or `null` when the file is absent (established, or never
 * pending). Any other read/parse error propagates — a corrupt record is a loud boot failure. */
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

/** The argument shape `establishReservedStandbyIdentity` takes — hoisted so the injectable `establish`
 * seat below matches it exactly. */
type EstablishArgs = {
  standby: StandbyPublicIdentity;
  nodeName: string;
  filingModule: string | null;
  taxModule: string | null;
  modules: readonly WaitronModule[];
  reserved: ReservedIdentity;
};

/**
 * Keep the latch on refusal or an unfinished step. Establish the identity before the viewer;
 * clear the latch only after both succeed, so a later boot can retry the same reservation.
 */
export async function runFinishAdoption(deps: {
  ownerDb: Database;
  stateDir: string;
  modules: readonly WaitronModule[];
  establish?: (args: EstablishArgs) => Promise<void>;
  ensureViewer?: () => Promise<void>;
  log: Logger;
}): Promise<void> {
  const establish =
    deps.establish ?? ((args) => establishReservedStandbyIdentity({ ownerDb: deps.ownerDb }, args));
  const ensureViewer = deps.ensureViewer ?? (() => ensureMirrorViewer(deps.ownerDb));

  const pending = await readPendingAdoption(deps.stateDir);
  if (pending === null) return; // established (file unlinked) or never pending — nothing to finish.
  try {
    assertAdoptionModules(deps.modules);
    // The file must survive a throw in either step so the next boot retries.
    await establish({
      standby: pending.standby,
      nodeName: pending.nodeName,
      filingModule: pending.filingModule,
      taxModule: pending.taxModule,
      modules: deps.modules,
      reserved: pending.reserved,
    });
    // The cookie token this returns is dropped: this boot mounts no mirror session, and the boot
    // that does mints its own, which replaces the hash stored here.
    await ensureViewer();
    await rm(pendingPath(deps.stateDir), { force: true });
    deps.log("info", "adoption.established", { nodeId: pending.standby.nodeId });
  } catch (error) {
    // Never fatal here: log and leave the latch file, so the next boot re-enters adoption-pending
    // mode and retries the whole step.
    deps.log("error", "adoption.establish_failed", { code: codeOf(error) });
  }
}
