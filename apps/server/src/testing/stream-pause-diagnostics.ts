import { Buffer } from "node:buffer";
import { closeSync, fstatSync, openSync, readSync } from "node:fs";

/** Read only the WAL header; observing a stalled fill must not issue a checkpoint. */
export function readSideFile(path: string): {
  bytes: number | null;
  header: { pageBytes: number; checkpointSequence: number; salt: string } | null;
  errorCode: string | null;
} {
  try {
    const file = openSync(path, "r");
    try {
      const bytes = fstatSync(file).size;
      const header = Buffer.alloc(32);
      const length = readSync(file, header, 0, header.length, 0);
      const magic = length === 32 ? header.readUInt32BE(0) : 0;
      return {
        bytes,
        header:
          (magic === 0x377f0682 || magic === 0x377f0683) && header.readUInt32BE(4) === 3007000
            ? {
                pageBytes: header.readUInt32BE(8),
                checkpointSequence: header.readUInt32BE(12),
                salt: header.subarray(16, 24).toString("hex"),
              }
            : null,
        errorCode: null,
      };
    } finally {
      closeSync(file);
    }
  } catch (error) {
    return {
      bytes: null,
      header: null,
      errorCode: (error as NodeJS.ErrnoException).code ?? "unreadable",
    };
  }
}

/**
 * How many whole frames have been written since the side file's last restart, or null with no
 * header. A restart writes from the first frame again under a new salt, so the frames written since
 * are the leading run whose salt matches the header's; the frames after it are older.
 */
export function framesUnderHeader(path: string): number | null {
  const side = readSideFile(path);
  if (side.header === null || side.bytes === null) return null;
  const frameBytes = 24 + side.header.pageBytes;
  const salt = Buffer.from(side.header.salt, "hex");
  let file: number;
  try {
    file = openSync(path, "r");
  } catch {
    return null;
  }
  try {
    const whole = Math.floor((side.bytes - 32) / frameBytes);
    const frameSalt = Buffer.alloc(8);
    const current = (frame: number) =>
      readSync(file, frameSalt, 0, 8, 32 + frame * frameBytes + 8) === 8 && frameSalt.equals(salt);
    let low = 0;
    let high = whole;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (current(middle - 1)) low = middle;
      else high = middle - 1;
    }
    return low;
  } finally {
    closeSync(file);
  }
}

/** One `pragma wal_checkpoint(passive)` row: frames in the side file, and frames copied back. */
export interface CheckpointProbe {
  busy: number;
  log: number;
  checkpointed: number;
}

/**
 * Whether a reader holds the side file: a passive checkpoint stops at the oldest reader's snapshot,
 * so two probes, each after its own sale, that stop short of the end at the same mark show a read
 * transaction that outlived a sale.
 */
export function holdProven(
  previous: CheckpointProbe | undefined,
  current: CheckpointProbe,
): boolean {
  return (
    previous !== undefined &&
    previous.checkpointed < previous.log &&
    current.checkpointed < current.log &&
    current.checkpointed === previous.checkpointed
  );
}
