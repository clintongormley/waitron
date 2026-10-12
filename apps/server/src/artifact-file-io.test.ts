import { mkdtemp, open, readFile, rm, writeFile, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { readExactly, writeAll } from "./artifact-file-io.js";
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
it("finishes partial reads and writes, preserving positions and the default cursor", async () => {
  const dir = await mkdtemp(join(tmpdir(), "file-io-"));
  dirs.push(dir);
  await writeFile(join(dir, "input"), "xxPAYLOADyy");
  const input = await open(join(dir, "input"), "r");
  const output = await open(join(dir, "output"), "wx", 0o600);
  try {
    const shortReader = {
      read: (buffer: Buffer, offset: number, length: number, position: number) =>
        input.read(buffer, offset, Math.min(length, 2), position),
    } as FileHandle;
    expect((await readExactly(shortReader, 7, 2)).toString()).toBe("PAYLOAD");
    const shortWriter = {
      write: (buffer: Uint8Array, offset: number, length: number, position: number | null) =>
        output.write(buffer, offset, Math.min(length, 2), position),
    } as FileHandle;
    await writeAll(shortWriter, Buffer.from("xxPAYLOADyy"));
    await writeAll(shortWriter, Buffer.from("HEAD"), 2);
    expect((await readFile(join(dir, "output"))).toString()).toBe("xxHEADOADyy");
  } finally {
    await input.close();
    await output.close();
  }
});
it("refuses EOF and stalled writes instead of looping", async () => {
  const dir = await mkdtemp(join(tmpdir(), "file-io-"));
  dirs.push(dir);
  await writeFile(join(dir, "input"), "x");
  const input = await open(join(dir, "input"), "r");
  try {
    await expect(readExactly(input, 2, 0)).rejects.toThrow("Unexpected end of file");
  } finally {
    await input.close();
  }
  await expect(
    writeAll(
      { write: async () => ({ bytesWritten: 0 }) } as unknown as FileHandle,
      Buffer.from("x"),
    ),
  ).rejects.toThrow("File write made no progress");
});
