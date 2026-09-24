import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Who holds the venue folder, beside `venue.lock`, so a process refused the folder can tell a live
 * holder from a frozen one. Written only by the process holding the lock; removed by it before the
 * lock is let go.
 */
export const VENUE_HOLDER_FILE = "venue.holder.json";

export const VENUE_HOLDER_KINDS = [
  "server",
  "restore",
  "rejoin",
  "provisioning",
  "script",
] as const;

export type VenueHolderKind = (typeof VENUE_HOLDER_KINDS)[number];

export interface VenueHolder {
  kind: VenueHolderKind;
  pid: number;
  /** `os.hostname()` of the holder — under Docker, its container id. */
  host: string;
  lockedAt: string;
  heartbeatAt: string;
}

/**
 * How long without a heartbeat before a process refused the folder calls its holder frozen: six of
 * the holder's 5 s rewrites. The holder's own watchdog kills on a longer bound
 * (`WATCHDOG_KILL_MS`, `./venue-liveness.ts`).
 */
export const VENUE_HOLDER_STALE_MS = 30_000;

const isIsoTime = (value: unknown): value is string =>
  typeof value === "string" &&
  !Number.isNaN(Date.parse(value)) &&
  new Date(value).toISOString() === value;

/**
 * The holder named beside `venue.lock`, or null when there is no such file or it is not a record
 * this code wrote. A kind outside {@link VENUE_HOLDER_KINDS} makes the whole record null rather than
 * a record with no kind: every field is validated and the record is all or nothing. Never takes the
 * lock.
 */
export function readVenueHolder(directory: string): VenueHolder | null {
  try {
    return parseVenueHolder(readFileSync(join(directory, VENUE_HOLDER_FILE), "utf8"));
  } catch {
    return null;
  }
}

/** {@link readVenueHolder} without blocking the thread on the read. */
export async function readVenueHolderAsync(directory: string): Promise<VenueHolder | null> {
  try {
    return parseVenueHolder(await readFile(join(directory, VENUE_HOLDER_FILE), "utf8"));
  } catch {
    return null;
  }
}

/** Throws on bytes that are not JSON; answers null for JSON that is not a holder record. */
function parseVenueHolder(text: string): VenueHolder | null {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null) return null;
  const { kind, pid, host, lockedAt, heartbeatAt } = parsed as Record<string, unknown>;
  if (!(VENUE_HOLDER_KINDS as readonly unknown[]).includes(kind)) return null;
  if (!Number.isInteger(pid) || (pid as number) <= 0) return null;
  if (typeof host !== "string" || host === "") return null;
  if (!isIsoTime(lockedAt) || !isIsoTime(heartbeatAt)) return null;
  return { kind: kind as VenueHolderKind, pid: pid as number, host, lockedAt, heartbeatAt };
}

/**
 * Whether the holder's heartbeat is younger than {@link VENUE_HOLDER_STALE_MS} at `now`. A heartbeat
 * a whole bound or more AHEAD of `now` is stale too. A live holder rewrites it from the same clock
 * every 5 s, so a step back of more than the bound makes a live holder read stale only until its
 * next rewrite.
 */
export function isVenueHolderFresh(holder: VenueHolder, now: Date): boolean {
  const age = now.getTime() - Date.parse(holder.heartbeatAt);
  return age < VENUE_HOLDER_STALE_MS && age > -VENUE_HOLDER_STALE_MS;
}

/** Replaces the holder file whole, so a reader never sees half of one. */
export function writeVenueHolder(directory: string, holder: VenueHolder): void {
  const path = join(directory, VENUE_HOLDER_FILE);
  const working = `${path}.partial`;
  try {
    writeFileSync(working, `${JSON.stringify(holder)}\n`);
    renameSync(working, path);
  } catch (error) {
    try {
      rmSync(working, { force: true });
    } catch {
      // The write's failure is the one the caller needs to see.
    }
    throw error;
  }
}

export function removeVenueHolder(directory: string): void {
  rmSync(join(directory, VENUE_HOLDER_FILE), { force: true });
}
