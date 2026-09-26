import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { lockVenueDatabase, openVenueDatabase, type VenueLock } from "@waitron/db";
import { readOperationalVenueIds, readTenantIdentities } from "@waitron/provisioning";
import { wipeVenueDatabases } from "./db-wipe.js";
import { PENDING_ADOPTION_FILE } from "./finish-adoption.js";
import { writeFileAtomic } from "./fs-atomic.js";
import type { Logger } from "./logger.js";
import { createSetupOperationStore } from "./setup-operation.js";

const MARKER = "reset-request.json";

export interface StagedResetDeps {
  stateDir: string;
  /** The directory holding `venue.db` and `node.db`. */
  venueDir: string;
  log: Logger;
}

/** Stage the reset of the adopt `operationId`, for the next start to carry out. */
export async function stageResetRequest(stateDir: string, operationId: string): Promise<void> {
  await writeFileAtomic(join(stateDir, MARKER), JSON.stringify({ version: 1, operationId }), 0o600);
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
  if (!existsSync(join(venueDir, "venue.db"))) return false;
  let store: Awaited<ReturnType<typeof openVenueDatabase>> | undefined;
  try {
    store = await openVenueDatabase(venueDir);
    const tenants = await readTenantIdentities(store.venue);
    const venues = await readOperationalVenueIds(store.venue);
    return tenants.length > 0 || venues.length > 0;
  } catch {
    return true;
  } finally {
    await store?.close();
  }
}

async function refusal(deps: StagedResetDeps, raw: string): Promise<string | null> {
  const operationId = stagedOperationId(raw);
  if (operationId === null) return "marker_invalid";
  if (existsSync(join(deps.stateDir, "trading.env"))) return "trading_configured";
  if (!(await recordMatches(deps.stateDir, operationId))) return "operation_mismatch";
  if (await holdsVenue(deps.venueDir)) return "venue_present";
  return null;
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
    const reason = await refusal(deps, raw);
    if (reason !== null) {
      await rm(markerPath, { force: true });
      deps.log("warn", "setup.reset_discarded", { reason });
      return false;
    }
    await wipeVenueDatabases(deps.venueDir);
    for (const file of [PENDING_ADOPTION_FILE, "modules.json", "setup-operation.json"]) {
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
