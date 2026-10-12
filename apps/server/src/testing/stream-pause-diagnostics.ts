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
