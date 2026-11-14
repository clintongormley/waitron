import { SETUP_OPERATION_FILE } from "@waitron/store";
import { RESET_REQUEST_FILE, TRADING_ENV_FILE } from "@waitron/store";
import { assertVenueFirstSetupAllowed } from "@waitron/provisioning";
import { existsSync } from "node:fs";
import { readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { lockVenueDatabase, openVenueDatabase, type VenueLock } from "@waitron/db";
import { hasOperationalVenue, readTenantIdentities } from "@waitron/provisioning";
import {
  BACKUP_ENV_FILE,
  SECRETS_ENV_FILE,
  TLS_DIR,
  TLS_REPAIR_FLOW_DIR,
  TLS_JOINED_FILE,
  VENUE_FILE,
} from "@waitron/store";
import { wipeVenueDatabases } from "./db-wipe.js";
import { PENDING_ADOPTION_FILE } from "./finish-adoption.js";
import { failedAtFolderSync, writeFileDurable } from "./fs-atomic.js";
import { joinedAnotherBox } from "./box-tls-install.js";
import type { Logger } from "./logger.js";
import { createSetupOperationStore } from "./setup-operation.js";

const MARKER = RESET_REQUEST_FILE;

export interface StagedResetDeps {
  stateDir: string;
  /** The directory holding `venue.db` and `node.db`. */
  venueDir: string;
  log: Logger;
}

/** Stage the reset of the adopt `operationId`, for the next start to carry out. */
export async function stageResetRequest(stateDir: string, operationId: string): Promise<void> {
  try {
    await writeFileDurable(
      join(stateDir, MARKER),
      JSON.stringify({ version: 1, operationId }),
      0o600,
    );
  } catch (error) {
    if (failedAtFolderSync(error)) await rm(join(stateDir, MARKER), { force: true });
    throw error;
  }
}

function stagedOperationId(raw: string): string | null {
  try {
    const marker = JSON.parse(raw) as { version?: unknown; operationId?: unknown };
    return marker.version === 1 && typeof marker.operationId === "string"
      ? marker.operationId
      : null;
  } catch {
    return null;
  }
}

async function recordMatches(stateDir: string, operationId: string): Promise<boolean> {
  const record = await createSetupOperationStore(stateDir)
    .read()
    .catch(() => null);
  return (
    record !== null &&
    record.kind === "adopt" &&
    record.phase !== "started" &&
    record.phase !== "complete" &&
    record.id === operationId
  );
}

async function holdsVenue(venueDir: string): Promise<boolean> {
  // Opening would create an empty file whose unmigrated tables fail the read, and a reset re-run
  // after its wipe meets exactly that.
  if (!existsSync(join(venueDir, VENUE_FILE))) return false;
  let store: Awaited<ReturnType<typeof openVenueDatabase>> | undefined;
  try {
    store = await openVenueDatabase(venueDir);
    const tenants = await readTenantIdentities(store.venue);
    const venues = await hasOperationalVenue(store.venue);
    return tenants.length > 0 || venues;
  } catch {
    return true;
  } finally {
    await store?.close();
  }
}

async function refusal(deps: StagedResetDeps, raw: string): Promise<string | null> {
  const operationId = stagedOperationId(raw);
  if (operationId === null) return "marker_invalid";
  if (existsSync(join(deps.stateDir, TRADING_ENV_FILE))) return "trading_configured";
  if (!(await recordMatches(deps.stateDir, operationId))) return "operation_mismatch";
  if (await holdsVenue(deps.venueDir)) return "venue_present";
  return null;
}

/**
 * Whether a staged reset passes `refusal`'s marker, `trading.env` and operation-record checks and
 * will empty `tls/` because this box joined another; `runStagedReset` repeats those, and the rest,
 * under the venue lock.
 */
export async function stagedResetEmptiesTls(stateDir: string): Promise<boolean> {
  const raw = await readFile(join(stateDir, MARKER), "utf8").catch(() => null);
  const operationId = raw === null ? null : stagedOperationId(raw);
  return (
    operationId !== null &&
    !existsSync(join(stateDir, TRADING_ENV_FILE)) &&
    (await recordMatches(stateDir, operationId)) &&
    (await joinedAnotherBox(stateDir))
  );
}

/**
 * Carry out a staged reset of an adopt that stopped partway; the caller runs it before anything in
 * this process opens the venue database. Every check runs under the venue lock, and any that fails
 * discards the request having deleted nothing. Returns true only when the reset ran.
 */
export async function runStagedReset(
  deps: StagedResetDeps,
  lock: (venueDir: string) => Promise<VenueLock> = lockVenueDatabase,
): Promise<boolean> {
  const markerPath = join(deps.stateDir, MARKER);
  let raw: string;
  try {
    raw = await readFile(markerPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  const hold = await lock(deps.venueDir);
  try {
    await assertVenueFirstSetupAllowed(deps.venueDir, deps.stateDir);
    const reason = await refusal(deps, raw);
    if (reason !== null) {
      await rm(markerPath, { force: true });
      deps.log("warn", "setup.reset_discarded", { reason });
      return false;
    }
    await wipeVenueDatabases(deps.venueDir, deps.stateDir);
    // The other venue's authority and key ring may be here, so the box's own go with them and the
    // next setup start mints a fresh set; `backup.env` may hold the other venue's recovery key.
    // Before the operation record, whose removal makes a re-run discard; the joined record goes
    // last of them, so a re-run still finds this box joined.
    if (await joinedAnotherBox(deps.stateDir)) {
      await rm(join(deps.stateDir, TLS_REPAIR_FLOW_DIR), { recursive: true, force: true });
      await rm(join(deps.stateDir, SECRETS_ENV_FILE), { force: true });
      await rm(join(deps.stateDir, BACKUP_ENV_FILE), { force: true });
      const tlsDir = join(deps.stateDir, TLS_DIR);
      for (const name of await readdir(tlsDir)) {
        if (join(TLS_DIR, name) !== TLS_JOINED_FILE) {
          await rm(join(tlsDir, name), { recursive: true, force: true });
        }
      }
      await rm(join(deps.stateDir, TLS_JOINED_FILE), { force: true });
    }
    for (const file of [PENDING_ADOPTION_FILE, SETUP_OPERATION_FILE]) {
      await rm(join(deps.stateDir, file), { force: true });
    }
    // Last, so a start cut short re-runs the reset; once the record is gone a re-run discards.
    await rm(markerPath, { force: true });
    deps.log("info", "setup.reset_done", {});
    return true;
  } finally {
    hold.release();
  }
}

export { RESET_REQUEST_FILE } from "@waitron/store";
