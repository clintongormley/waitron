import { Buffer } from "node:buffer";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { framesUnderHeader, holdProven, readSideFile as read } from "./stream-pause-diagnostics.js";

describe("stream pause side-file diagnostics", () => {
  it("reports restart identity even when a reused file keeps the same size", async () => {
    const root = await mkdtemp(join(tmpdir(), "pause-diagnostics-"));
    try {
      const path = join(root, "venue.db-wal");
      const bytes = Buffer.alloc(8272);
      bytes.writeUInt32BE(0x377f0682, 0);
      bytes.writeUInt32BE(3007000, 4);
      bytes.writeUInt32BE(4096, 8);
      bytes.writeUInt32BE(7, 12);
      bytes.writeUInt32BE(0x12345678, 16);
      bytes.writeUInt32BE(0xabcdef01, 20);
      await writeFile(path, bytes);
      expect(read(path)).toEqual({
        bytes: 8272,
        header: { pageBytes: 4096, checkpointSequence: 7, salt: "12345678abcdef01" },
        errorCode: null,
      });
      bytes.writeUInt32BE(8, 12);
      bytes.writeUInt32BE(0x12345679, 16);
      await writeFile(path, bytes);
      expect(read(path)).toEqual({
        bytes: 8272,
        header: { pageBytes: 4096, checkpointSequence: 8, salt: "12345679abcdef01" },
        errorCode: null,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps a truncated file's size without inventing header fields", async () => {
    const root = await mkdtemp(join(tmpdir(), "pause-diagnostics-"));
    try {
      const path = join(root, "venue.db-wal");
      for (const bytes of [Buffer.alloc(0), Buffer.alloc(12), Buffer.alloc(32)]) {
        await writeFile(path, bytes);
        expect(read(path)).toEqual({ bytes: bytes.length, header: null, errorCode: null });
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports a vanished file without throwing or exposing its path", () => {
    expect(read(join(tmpdir(), "missing-pause-diagnostics", "venue.db-wal"))).toEqual({
      bytes: null,
      header: null,
      errorCode: "ENOENT",
    });
  });

  it("counts the frames written since the side file's last restart, by their salt", async () => {
    const root = await mkdtemp(join(tmpdir(), "pause-diagnostics-"));
    try {
      const path = join(root, "venue.db-wal");
      const pageBytes = 512;
      const frameBytes = 24 + pageBytes;
      const bytes = Buffer.alloc(32 + 5 * frameBytes);
      bytes.writeUInt32BE(0x377f0682, 0);
      bytes.writeUInt32BE(3007000, 4);
      bytes.writeUInt32BE(pageBytes, 8);
      bytes.writeUInt32BE(9, 12);
      bytes.writeUInt32BE(0x0000000a, 16);
      bytes.writeUInt32BE(0xabcdef01, 20);
      const stamp = (frame: number, salt1: number, salt2: number) => {
        bytes.writeUInt32BE(salt1, 32 + frame * frameBytes + 8);
        bytes.writeUInt32BE(salt2, 32 + frame * frameBytes + 12);
      };
      for (const frame of [0, 1, 2]) stamp(frame, 0x0000000a, 0xabcdef01);
      // Older frames keep the salt of the header before the restart.
      for (const frame of [3, 4]) stamp(frame, 0x00000009, 0x55555555);
      await writeFile(path, bytes);
      expect(framesUnderHeader(path)).toBe(3);

      for (const frame of [3, 4]) stamp(frame, 0x0000000a, 0xabcdef01);
      await writeFile(path, bytes);
      expect(framesUnderHeader(path)).toBe(5);

      // A frame cut short at the end of the file is not counted.
      await writeFile(path, bytes.subarray(0, 32 + 4 * frameBytes + 30));
      expect(framesUnderHeader(path)).toBe(4);

      // Just restarted: nothing written under the new header yet.
      for (const frame of [0, 1, 2, 3, 4]) stamp(frame, 0x00000009, 0x55555555);
      await writeFile(path, bytes);
      expect(framesUnderHeader(path)).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("answers null for a side file with no header, or none at all", async () => {
    const root = await mkdtemp(join(tmpdir(), "pause-diagnostics-"));
    try {
      const path = join(root, "venue.db-wal");
      await writeFile(path, Buffer.alloc(64));
      expect(framesUnderHeader(path)).toBeNull();
      expect(framesUnderHeader(join(root, "missing", "venue.db-wal"))).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  describe("holdProven", () => {
    it("is proven when two probes in turn stop short of the side file's end at the same mark", () => {
      expect(
        holdProven({ busy: 0, log: 60, checkpointed: 12 }, { busy: 0, log: 118, checkpointed: 12 }),
      ).toBe(true);
    });

    it("is not proven when a probe copied the whole side file back", () => {
      expect(
        holdProven(
          { busy: 0, log: 60, checkpointed: 12 },
          { busy: 0, log: 118, checkpointed: 118 },
        ),
      ).toBe(false);
      expect(
        holdProven({ busy: 0, log: 60, checkpointed: 60 }, { busy: 0, log: 118, checkpointed: 60 }),
      ).toBe(false);
    });

    it("is not proven when the mark moved between the probes", () => {
      expect(
        holdProven({ busy: 0, log: 60, checkpointed: 12 }, { busy: 0, log: 118, checkpointed: 70 }),
      ).toBe(false);
    });

    it("is not proven on the first probe alone", () => {
      expect(holdProven(undefined, { busy: 0, log: 118, checkpointed: 12 })).toBe(false);
    });
  });
});
