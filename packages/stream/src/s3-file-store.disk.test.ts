import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createS3FileStore } from "./s3-file-store.js";
import { loopbackBucket } from "./testing/loopback-bucket.js";

// Every file the store opens is wrapped, so a test can count what it reads and make a write fail.
const disk = vi.hoisted(() => ({
  bytesRead: 0,
  onRead: () => {},
  writeError: null as Error | null,
  shortWrites: false,
  onSync: () => {},
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const open = async (...args: Parameters<typeof actual.open>): Promise<FileHandle> => {
    const handle = await actual.open(...args);
    return new Proxy(handle, {
      get(target, property) {
        if (property === "read") {
          return async (...readArgs: unknown[]) => {
            const result = await (
              target.read as (...a: unknown[]) => Promise<{ bytesRead: number }>
            )(...readArgs);
            disk.bytesRead += result.bytesRead;
            disk.onRead();
            return result;
          };
        }
        if (property === "sync") {
          return async () => {
            await target.sync();
            disk.onSync();
          };
        }
        if (property === "write" && disk.shortWrites) {
          // Writes half of what it was asked to, as a write to a file is allowed to.
          return (buffer: Buffer, offset = 0) =>
            target.write(buffer, offset, Math.ceil((buffer.length - offset) / 2));
        }
        if (property === "write" && disk.writeError !== null) {
          const error = disk.writeError;
          return async () => {
            throw error;
          };
        }
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  };
  return { ...actual, open, default: { ...actual, open } };
});

const MiB = 1024 * 1024;
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  disk.bytesRead = 0;
  disk.onRead = () => {};
  disk.writeError = null;
  disk.shortWrites = false;
  disk.onSync = () => {};
});

async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "s3-file-store-disk-"));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

describe("an upload of 32 MiB", () => {
  it("never holds more than one part read from the file and not yet sent", async () => {
    let received = 0;
    const record = { peakBufferedBytes: 0 };
    const sample = () => {
      record.peakBufferedBytes = Math.max(record.peakBufferedBytes, disk.bytesRead - received);
    };
    const bucket = await loopbackBucket({
      onBodyBytes: (_seen, bytes) => {
        received += bytes;
        sample();
      },
    });
    cleanups.push(() => bucket.close());
    const dir = await scratch();
    const path = join(dir, "archive.bin");
    await writeFile(path, Buffer.alloc(32 * MiB, 7));
    disk.onRead = sample;
    const store = createS3FileStore(bucket.config);
    cleanups.push(async () => store.close());
    await store.putFile("a.enc", path, { signal: new AbortController().signal });
    expect(bucket.record.partBytes).toEqual([8 * MiB, 8 * MiB, 8 * MiB, 8 * MiB]);
    expect(disk.bytesRead).toBe(32 * MiB);
    expect(record.peakBufferedBytes).toBeLessThanOrEqual(8 * MiB);
  });
});

describe("a download onto a full disk", () => {
  it("removes its partial file, keeps the target, closes the connection and reports the disk", async () => {
    const observed = { closed: false };
    const bucket = await loopbackBucket({
      answer: (seen, request, response) => {
        if (seen.kind !== "get") return false;
        request.socket.once("close", () => (observed.closed = true));
        response.writeHead(200, { etag: '"v1"', "content-length": "100000" });
        response.write(Buffer.alloc(1000, 1));
        return true;
      },
    });
    cleanups.push(() => bucket.close());
    const dir = await scratch();
    const target = join(dir, "a.enc");
    await writeFile(target, "an archive already in place");
    disk.writeError = Object.assign(new Error("no space left on device"), { code: "ENOSPC" });
    const store = createS3FileStore(bucket.config);
    cleanups.push(async () => store.close());
    await expect(
      store.getFile("a.enc", target, { signal: new AbortController().signal }),
    ).rejects.toMatchObject({ code: "ENOSPC" });
    expect(await readdir(dir)).toEqual(["a.enc"]);
    expect(await readFile(target, "utf8")).toBe("an archive already in place");
    await expect.poll(() => observed.closed).toBe(true);
  });
});

describe("a download onto a disk that writes less than it is asked to", () => {
  it("writes the rest until the whole body is in the file", async () => {
    const body = Buffer.alloc(300_000);
    for (let i = 0; i < body.length; i += 1) body[i] = i % 253;
    const bucket = await loopbackBucket();
    cleanups.push(() => bucket.close());
    bucket.objects.set("a.enc", { body, lastModified: new Date() });
    const target = join(await scratch(), "a.enc");
    disk.shortWrites = true;
    const store = createS3FileStore(bucket.config);
    cleanups.push(async () => store.close());
    await store.getFile("a.enc", target, { signal: new AbortController().signal });
    expect((await readFile(target)).equals(body)).toBe(true);
  });
});

describe("a download cancelled once its whole body is on disk", () => {
  it("does not replace the target, and removes its partial file", async () => {
    const bucket = await loopbackBucket();
    cleanups.push(() => bucket.close());
    bucket.objects.set("a.enc", { body: Buffer.from("new"), lastModified: new Date() });
    const dir = await scratch();
    const target = join(dir, "a.enc");
    await writeFile(target, "an archive already in place");
    const controller = new AbortController();
    disk.onSync = () => controller.abort();
    const store = createS3FileStore(bucket.config);
    cleanups.push(async () => store.close());
    await expect(store.getFile("a.enc", target, controller)).rejects.toMatchObject({
      code: "backup.destination_request_failed",
      params: { operation: "get", key: "a.enc", status: null, name: "AbortError" },
    });
    expect(await readdir(dir)).toEqual(["a.enc"]);
    expect(await readFile(target, "utf8")).toBe("an archive already in place");
  });
});
