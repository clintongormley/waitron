import { codeOf } from "@waitron/server-kit";
import type { DiskFullState } from "./disk-full-state.js";
import { errnoOf } from "./errno.js";
import { freeBytes, type Statfs } from "./free-bytes.js";
import type { Logger } from "./logger.js";
import { unrefTimer, type Timer } from "./unref-timer.js";

/** Below this the box warns that its disk is running out (design §4.6 item 4). */
export const SPACE_LOW_BYTES = 2 * 1024 ** 3;
/** The warning goes off only at this much free, so it does not toggle at the line. */
export const SPACE_OK_BYTES = 2.5 * 1024 ** 3;
export const FREE_SPACE_CHECK_MS = 60_000;

/** `freeBytes` is the latest reading the filesystem could give; `lowSince` is when the warning now on
 * came on, null while it is off. Before the first reading all three are null. */
export type FreeSpaceReading =
  | { readonly freeBytes: null; readonly readAt: null; readonly lowSince: null }
  | { readonly freeBytes: number; readonly readAt: Date; readonly lowSince: Date | null };

export interface FreeSpaceState {
  /** `free` is `freeBytes`' answer: null where the filesystem cannot say. */
  record(free: number | null, at: Date): void;
  current(): FreeSpaceReading;
}

export function createFreeSpaceState(deps: { log: Logger }): FreeSpaceState {
  let reading: FreeSpaceReading = { freeBytes: null, readAt: null, lowSince: null };
  let lastReadable: boolean | null = null;
  return {
    record(free, at) {
      if (free === null) {
        if (lastReadable !== false) deps.log("warn", "storage.free_space_unread", {});
        lastReadable = false;
        return;
      }
      if (lastReadable !== true) deps.log("info", "storage.free_space_read", { freeBytes: free });
      lastReadable = true;
      let lowSince = reading.lowSince;
      if (lowSince === null && free < SPACE_LOW_BYTES) {
        lowSince = at;
        deps.log("warn", "storage.space_low", { freeBytes: free });
      } else if (lowSince !== null && free >= SPACE_OK_BYTES) {
        lowSince = null;
        deps.log("info", "storage.space_ok", { freeBytes: free });
      }
      reading = { freeBytes: free, readAt: at, lowSince };
    },
    current: () => reading,
  };
}

/**
 * Reads `dir`'s free space at once and then every `intervalMs`, each timer armed after the reading
 * before it finished. Each reading lets `freeOldBackups` delete old backups, then `restoreSpare`
 * write the box's spare file back, then reads free space, so room the deletion made is in the
 * reading and the spare. While `disk` holds a noted stop, each reading also asks it to re-check, so a stop
 * lifts when space is freed even if nothing writes. `stop()` aborts the deletion's signal and
 * answers once the reading in flight, and any deletion or write-back in it, has finished.
 */
export function startFreeSpaceWatch(deps: {
  dir: string;
  state: FreeSpaceState;
  disk: Pick<DiskFullState, "noted" | "full">;
  intervalMs: number;
  now: () => Date;
  log: Logger;
  statfs?: Statfs;
  restoreSpare?: () => Promise<void>;
  freeOldBackups?: (signal: AbortSignal) => Promise<void>;
  timer?: (ms: number, fn: () => void) => Timer;
}): { stop: () => Promise<void> } {
  const timer = deps.timer ?? unrefTimer;
  let stopped = false;
  const stopping = new AbortController();
  let reading: Promise<void> = Promise.resolve();

  async function read(): Promise<void> {
    try {
      await freeOldBackups();
      if (stopped) return;
      await restore();
      if (stopped) return;
      const free = await freeBytes(deps.dir, deps.statfs);
      if (stopped) return;
      deps.state.record(free, deps.now());
      if (deps.disk.noted()) await deps.disk.full();
    } catch (error) {
      deps.log("warn", "storage.free_space_check_failed", { errorCode: codeOf(error) });
    } finally {
      if (!stopped) armed = timer(deps.intervalMs, start);
    }
  }

  async function freeOldBackups(): Promise<void> {
    try {
      await deps.freeOldBackups?.(stopping.signal);
    } catch (error) {
      if (stopped) return;
      deps.log("warn", "backup.low_space_delete_failed", {
        errorCode: codeOf(error),
        errno: errnoOf(error) ?? null,
      });
    }
  }

  async function restore(): Promise<void> {
    try {
      await deps.restoreSpare?.();
    } catch (error) {
      deps.log("warn", "storage.spare_restore_failed", { errno: errnoOf(error) ?? null });
    }
  }

  function start(): void {
    reading = read();
  }

  let armed = timer(0, start);

  return {
    stop: () => {
      stopped = true;
      stopping.abort();
      armed.cancel();
      return reading;
    },
  };
}
