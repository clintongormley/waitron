import { AppError } from "@waitron/shared";
import { FULL_DISK_BYTES } from "./boot-failure.js";
import { freeBytes, type Statfs } from "./free-bytes.js";
import type { Logger } from "./logger.js";

export interface DiskFullState {
  /**
   * A full disk was detected: an engine refusal, a start under FULL_DISK_BYTES, or a start with the
   * spare's release marker. Keeps the first time until cleared.
   */
  noteRefused(): void;
  /** Whether a refusal is noted now. Reads no disk. */
  noted(): boolean;
  /**
   * Whether a till write must be refused now. Reads the folder's free space only while a refusal
   * is noted, and forgets the refusal only when that reading finds FULL_DISK_BYTES or more, the
   * spare's release marker is gone, and no refusal was noted while it read; an unreadable reading
   * keeps it.
   */
  full(): Promise<boolean>;
  /** When the refusal now noted was first noted; null when none is. */
  since(): Date | null;
}

export function createDiskFullState(deps: {
  dir: string;
  now: () => Date;
  log: Logger;
  statfs?: Statfs;
  spareReleased?: () => Promise<boolean>;
}): DiskFullState {
  let since: Date | null = null;
  let refusals = 0;
  return {
    noteRefused() {
      refusals += 1;
      if (since !== null) return;
      since = deps.now();
      deps.log("warn", "storage.disk_full_noted", {});
    },
    noted: () => since !== null,
    since: () => since,
    async full() {
      if (since === null) return false;
      const seen = refusals;
      const free = await freeBytes(deps.dir, deps.statfs);
      if (free === null || free < FULL_DISK_BYTES) return true;
      if (await deps.spareReleased?.()) return true;
      // A refusal noted after this reading began may postdate the space it found.
      if (refusals !== seen) return true;
      // A read racing this one may already have cleared it.
      if (since !== null) {
        since = null;
        deps.log("info", "storage.disk_space_back", { freeBytes: free });
      }
      return false;
    },
  };
}

/**
 * Notes a refusal on `state` when the spare's release marker exists or the folder has less than
 * FULL_DISK_BYTES free; an unreadable reading, with no marker, notes nothing and logs. Called once,
 * at start.
 */
export async function noteFullAtStart(
  state: DiskFullState,
  deps: { dir: string; log: Logger; statfs?: Statfs; spareReleased?: () => Promise<boolean> },
): Promise<void> {
  if (await deps.spareReleased?.()) return state.noteRefused();
  const free = await freeBytes(deps.dir, deps.statfs);
  if (free === null) {
    deps.log("warn", "storage.start_space_unread", {});
    return;
  }
  if (free < FULL_DISK_BYTES) state.noteRefused();
}

/** Notes on `state` every full-disk refusal any of `stores` reports; returns the unsubscribe. */
export function watchForDiskFull(
  state: DiskFullState,
  stores: readonly { onDiskFull(listener: () => void): () => void }[],
): () => void {
  const unsubscribes = stores.map((store) => store.onDiskFull(() => state.noteRefused()));
  return () => {
    for (const unsubscribe of unsubscribes) unsubscribe();
  };
}

/** The refusal a till write gets while the stop holds. */
export function diskFullRefusal(): AppError<"storage.disk_full"> {
  return new AppError("storage.disk_full", {});
}

/** Logs and throws the refusal a sale or payment gets while the stop holds. */
export function refuseForDiskStop(log: Logger | undefined, workingOrderId: string): never {
  log?.("warn", "storage.disk_full_stop_refused", { workingOrderId });
  throw diskFullRefusal();
}
