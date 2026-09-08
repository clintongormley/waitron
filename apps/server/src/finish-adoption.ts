import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { readSubscriptionStatus, subscriptionName, type SubscriptionStatus } from "@waitron/sync";
import type { Database } from "@waitron/db";
import type { KeyRing } from "@waitron/credentials";
import type { WaitronModule } from "@waitron/module";
import { codeOf } from "@waitron/server-kit";
import { writeFileAtomic } from "./fs-atomic.js";
import { realSleep } from "./loop.js";
import { establishReservedStandbyIdentity, type StandbyIdentity } from "./reserved-identity.js";
import { ensureMirrorViewer } from "./mirror-session.js";
import type { ReservedIdentity } from "./mirror-bundle.js";
import type { DeploymentEnvironment } from "./config.js";
import type { Logger } from "./logger.js";

/** The file under `<stateDir>` a mirror writes at adopt and clears once its identity is established. */
export const PENDING_ADOPTION_FILE = "pending-adoption.json";

/**
 * The full standby identity + reservation an adopted mirror must finish establishing AFTER its native
 * initial copy completes (derived fact 1 / C6): a native COPY cannot coexist with pre-inserted rows,
 * so adopt no longer scaffolds the tenant; the mirror boots into an empty database while the copy
 * runs, and `runFinishAdoption` seals this identity once every `pg_subscription_rel` row reaches `r`.
 * Persisted on disk (not the DB) because the DB it targets is still being copied.
 */
export interface PendingAdoption {
  tenantId: string;
  locationId: string;
  standby: StandbyIdentity;
  nodeName: string;
  filingModule: string | null;
  taxModule: string | null;
  reserved: ReservedIdentity;
  originNodeId: string;
}

function pendingPath(stateDir: string): string {
  return join(stateDir, PENDING_ADOPTION_FILE);
}

/** Atomically write `<stateDir>/pending-adoption.json` (0600, tmp+rename) — the same secret-safe write
 * `writeTradingEnv` uses; the record carries the standby's sealed private key. */
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
  tenantId: string;
  locationId: string;
  standby: StandbyIdentity;
  nodeName: string;
  filingModule: string | null;
  taxModule: string | null;
  modules: readonly WaitronModule[];
  reserved: ReservedIdentity;
};

const ADOPTION_POLL_MS = 2000;

/**
 * The boot-time finish worker for an adoption-pending mirror (C6). While the pending file exists, it
 * polls the mirror's OWN subscription (`subscriptionName(env, standby.nodeId)` — named after the
 * SUBSCRIBER, C1) until every table has finished its initial copy
 * (`tablesTotal > 0 && tablesReady === tablesTotal`). Then it establishes the reserved identity
 * (idempotent) with THIS node's enabled module set, ensures the ambient mirror viewer, unlinks the
 * file and logs `adoption.established`. A throw in any tick is logged (`adoption.establish_failed`)
 * and retried next tick — the file is kept until the whole step succeeds. Abortable: on `signal`
 * the loop returns without establishing (a later boot re-enters adoption-pending mode and retries).
 */
export async function runFinishAdoption(deps: {
  replicationDb: Database;
  ring: KeyRing;
  stateDir: string;
  environment: DeploymentEnvironment;
  modules: readonly WaitronModule[];
  readStatus?: (name: string) => Promise<SubscriptionStatus>;
  establish?: (args: EstablishArgs) => Promise<void>;
  ensureViewer?: (tenantId: string) => Promise<void>;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  log: Logger;
  signal: AbortSignal;
}): Promise<void> {
  const readStatus =
    deps.readStatus ?? ((name) => readSubscriptionStatus(deps.replicationDb, name));
  const establish =
    deps.establish ??
    ((args) =>
      establishReservedStandbyIdentity({ ownerDb: deps.replicationDb, ring: deps.ring }, args));
  const ensureViewer =
    deps.ensureViewer ?? ((tenantId) => ensureMirrorViewer(deps.replicationDb, tenantId));
  const sleep = deps.sleep ?? realSleep;

  while (!deps.signal.aborted) {
    const pending = await readPendingAdoption(deps.stateDir);
    if (pending === null) return; // established (file unlinked) or never pending — nothing to finish.
    try {
      const status = await readStatus(subscriptionName(deps.environment, pending.standby.nodeId));
      if (status.tablesTotal > 0 && status.tablesReady === status.tablesTotal) {
        // establish FIRST (its inserts FK to the now-copied tenant/location rows), then the ambient
        // viewer (its `persons` insert FKs to the same tenant), then clear the latch — order matters:
        // the file must survive a throw in either step so the next boot retries.
        await establish({
          tenantId: pending.tenantId,
          locationId: pending.locationId,
          standby: pending.standby,
          nodeName: pending.nodeName,
          filingModule: pending.filingModule,
          taxModule: pending.taxModule,
          modules: deps.modules,
          reserved: pending.reserved,
        });
        await ensureViewer(pending.tenantId);
        await rm(pendingPath(deps.stateDir), { force: true });
        deps.log("info", "adoption.established", { nodeId: pending.standby.nodeId });
        return;
      }
    } catch (error) {
      // The copy may still be settling, or a transient DB fault — never fatal here: log and retry the
      // whole tick. The file is untouched, so a re-read next tick picks it up again.
      deps.log("error", "adoption.establish_failed", { code: codeOf(error) });
    }
    await sleep(ADOPTION_POLL_MS, deps.signal);
  }
}
