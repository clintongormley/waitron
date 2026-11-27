import { Readable } from "node:stream";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import zlib from "node:zlib";
import { syncBuiltinESMExports } from "node:module";
import { gzipSync, gunzipSync } from "node:zlib";
import { afterEach, expect, it, vi } from "vitest";
import { compressArchive, decodeArchiveFile } from "./backup-compression.js";
import { START_FREE_SPACE_FLOOR } from "./start-space.js";
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture(bytes: Uint8Array) {
  const root = await mkdtemp(join(tmpdir(), "backup-compression-"));
  roots.push(root);
  const input = join(root, "input");
  const output = join(root, "output");
  await writeFile(input, bytes);
  return { root, input, output };
}
it("compresses chunked input without changing bytes and propagates source failures", async () => {
  const f = await fixture(Buffer.alloc(200_000, 65));
  const parts: Uint8Array[] = [];
  for await (const part of compressArchive(createReadStream(f.input, { highWaterMark: 7 })))
    parts.push(part);
  const compressed = Buffer.concat(parts);
  expect(compressed.length).toBeLessThan(1000);
  expect(gunzipSync(compressed)).toEqual(await readFile(f.input));
  const failure = new Error("source failed");
  async function* broken() {
    yield Buffer.from("first");
    throw failure;
  }
  await expect(Readable.from(compressArchive(broken())).toArray()).rejects.toBe(failure);
});
it("decodes gzip in a protected file, removes compressed scratch and leaves raw input alone", async () => {
  const bytes = Buffer.from("WBA1".repeat(30_000));
  const f = await fixture(gzipSync(bytes));
  expect(await decodeArchiveFile(f.input, f.output)).toBe(f.output);
  expect(await readFile(f.output)).toEqual(bytes);
  expect((await stat(f.output)).mode & 0o777).toBe(0o600);
  expect(await readdir(f.root)).toEqual(["output"]);
  const raw = await fixture(bytes);
  expect(await decodeArchiveFile(raw.input, raw.output)).toBe(raw.input);
  expect(await readFile(raw.input)).toEqual(bytes);
  expect(await readdir(raw.root)).toEqual(["input"]);
});
it.each(["truncated", "junk", "second member", "invalid body"])(
  "refuses gzip %s and removes partial decoded output",
  async (mode) => {
    let bytes = gzipSync(Buffer.from("archive"));
    if (mode === "truncated") bytes = bytes.subarray(0, bytes.length - 1);
    if (mode === "junk") bytes = Buffer.concat([bytes, Buffer.from("junk")]);
    if (mode === "second member") bytes = Buffer.concat([bytes, gzipSync(Buffer.from("other"))]);
    if (mode === "invalid body") bytes[12] ^= 255;
    const f = await fixture(bytes);
    await expect(decodeArchiveFile(f.input, f.output)).rejects.toMatchObject({
      code: "backup.archive_invalid",
    });
    expect(await readdir(f.root)).toEqual(["input"]);
  },
);
it.each([0, 16, null])(
  "refuses output beyond the scratch budget (%s bytes free above reserve)",
  async (free) => {
    const f = await fixture(gzipSync(Buffer.alloc(100_000)));
    await expect(
      decodeArchiveFile(f.input, f.output, {
        statfs: async () => {
          if (free === null) throw new Error("cannot measure");
          return { bavail: START_FREE_SPACE_FLOOR + free, frsize: 1 };
        },
      }),
    ).rejects.toMatchObject({ code: "restore.archive_resource_limit" });
    expect(await readdir(f.root)).toEqual(["input"]);
  },
);
it.each([false, true])(
  "limits expanded archive bytes including raw input (gzip %s)",
  async (gzip) => {
    const bytes = Buffer.from("WBA1".repeat(10));
    const exact = await fixture(gzip ? gzipSync(bytes) : bytes);
    const path = await decodeArchiveFile(exact.input, exact.output, { maxBytes: 40 });
    expect(await readFile(path)).toEqual(bytes);
    const long = await fixture(gzip ? gzipSync(bytes) : bytes);
    await expect(
      decodeArchiveFile(long.input, long.output, { maxBytes: 39 }),
    ).rejects.toMatchObject({ code: "restore.archive_resource_limit" });
    expect(await readdir(long.root)).toEqual(["input"]);
  },
);
it("honours cancellation during decoding and compression", async () => {
  const f = await fixture(gzipSync(Buffer.alloc(1_000_000)));
  const controller = new AbortController();
  await expect(
    decodeArchiveFile(f.input, f.output, {
      signal: controller.signal,
      statfs: async () => {
        controller.abort();
        return { bavail: 1_000_000_000, frsize: 1 };
      },
    }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(await readdir(f.root)).toEqual(["input"]);
  await expect(
    Readable.from(compressArchive(createReadStream(f.input), controller.signal)).toArray(),
  ).rejects.toMatchObject({ name: "AbortError" });
});

/** Every gzip stream `compressArchive` makes from here on, so a case can wait on its state. */
function watchGzips(): zlib.Gzip[] {
  const gzips: zlib.Gzip[] = [];
  const createGzip = zlib.createGzip;
  vi.spyOn(zlib, "createGzip").mockImplementation((options) => {
    const gzip = createGzip(options);
    gzips.push(gzip);
    return gzip;
  });
  syncBuiltinESMExports();
  return gzips;
}

/** Reads one part of a compression whose gzip then takes all its input, leaving output unread. */
async function compressionPastItsInput(signal?: AbortSignal) {
  const gzips = watchGzips();
  const bytes = randomBytes(100_000);
  async function* source() {
    for (let at = 0; at < bytes.length; at += 4_000) yield bytes.subarray(at, at + 4_000);
  }
  const parts = compressArchive(source(), signal)[Symbol.asyncIterator]();
  await parts.next();
  const [gzip] = gzips;
  await expect.poll(() => gzip?.writableFinished && !gzip.readableEnded).toBe(true);
  return { gzip: gzip!, parts };
}

async function readRest(parts: AsyncIterator<Uint8Array>) {
  while (!(await parts.next()).done);
}

/** Every exception left uncaught while `run` and the turn after it ran, held from the runner. */
async function uncaughtDuring(run: () => Promise<void>): Promise<unknown[]> {
  const caught: unknown[] = [];
  const record = (error: unknown) => caught.push(error);
  const runners = process.rawListeners("uncaughtException");
  process.removeAllListeners("uncaughtException");
  process.on("uncaughtException", record);
  try {
    await run();
    await new Promise(setImmediate);
  } finally {
    process.off("uncaughtException", record);
    for (const runner of runners) process.on("uncaughtException", runner);
  }
  return caught;
}

it.each(["abort", "return"])(
  "stopping after compression has taken all input (%s) raises no uncaught error",
  async (stop) => {
    const uncaught = await uncaughtDuring(async () => {
      const controller = new AbortController();
      const { parts } = await compressionPastItsInput(controller.signal);
      if (stop === "abort") {
        controller.abort();
        await expect(readRest(parts)).rejects.toMatchObject({ name: "AbortError" });
      } else await parts.return?.();
    });
    expect(uncaught.map(String)).toEqual([]);
  },
);

it(
  "passes a gzip failure after compression has taken all input on to the reader",
  { timeout: 5_000 },
  async () => {
    const { gzip, parts } = await compressionPastItsInput();
    const failure = new Error("late gzip failure");
    gzip.destroy(failure);
    await expect(readRest(parts)).rejects.toBe(failure);
  },
);

it("keeps half of the free space for extracting the decoded database", async () => {
  const f = await fixture(gzipSync(Buffer.alloc(100_000)));
  await expect(
    decodeArchiveFile(f.input, f.output, {
      statfs: async () => ({ bavail: START_FREE_SPACE_FLOOR + 150_000, frsize: 1 }),
    }),
  ).rejects.toMatchObject({ code: "restore.archive_resource_limit" });
  expect(await readdir(f.root)).toEqual(["input"]);
  expect(
    await decodeArchiveFile(f.input, f.output, {
      statfs: async () => ({ bavail: START_FREE_SPACE_FLOOR + 200_000, frsize: 1 }),
    }),
  ).toBe(f.output);
  expect((await stat(f.output)).size).toBe(100_000);
});
it("keeps a decoder memory failure distinct from a corrupt archive", async () => {
  const f = await fixture(gzipSync(Buffer.from("archive")));
  const error = Object.assign(new Error("decoder memory"), { code: "Z_MEM_ERROR" });
  vi.spyOn(zlib, "createGunzip").mockImplementation(() => {
    throw error;
  });
  syncBuiltinESMExports();
  await expect(decodeArchiveFile(f.input, f.output)).rejects.toBe(error);
  expect(await readdir(f.root)).toEqual(["input"]);
});
