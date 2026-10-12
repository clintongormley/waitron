import { Buffer } from "node:buffer";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readSideFile as read } from "./stream-pause-diagnostics.js";

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
});
