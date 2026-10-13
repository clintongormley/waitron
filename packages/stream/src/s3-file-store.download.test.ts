import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import { createS3FileStore, type S3FileStore } from "./s3-file-store.js";
import type { BucketConfig } from "./s3-client.js";
import { loopbackBucket, type LoopbackBucket } from "./testing/loopback-bucket.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "s3-file-store-download-"));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function bucketWith(options: Parameters<typeof loopbackBucket>[0] = {}) {
  const bucket = await loopbackBucket(options);
  cleanups.push(() => bucket.close());
  return bucket;
}

function storeFor(bucket: LoopbackBucket): S3FileStore {
  const store = createS3FileStore(bucket.config);
  cleanups.push(async () => store.close());
  return store;
}

async function outcome(call: Promise<unknown>, ms = 5_000): Promise<unknown> {
  const ended = call.then(
    () => "resolved",
    (error: unknown) =>
      error instanceof AppError ? { code: error.code, params: error.params } : error,
  );
  return Promise.race([ended, delay(ms, "still pending")]);
}

function signalled(): { resolve: () => void; promise: Promise<void> } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { resolve, promise };
}

const live = () => ({ signal: new AbortController().signal });
const cancelled = {
  code: "backup.destination_request_failed",
  params: { operation: "get", key: "a.enc", status: null, name: "AbortError" },
};
const ARCHIVE = Buffer.from("the archive's bytes, all of them");
const ORIGINAL = Buffer.from("an archive already in place");

/** A bucket whose answer sends its headers and the first part of the body, then waits. */
async function stallingBucket(after?: (socket: import("node:net").Socket) => void) {
  const headersSent = signalled();
  const observed = { closed: false };
  const bucket = await bucketWith({
    answer: (seen, request, response) => {
      if (seen.kind !== "get") return false;
      request.socket.once("close", () => (observed.closed = true));
      response.writeHead(200, { etag: '"v1"', "content-length": "1000" });
      response.write("the first part");
      headersSent.resolve();
      after?.(request.socket);
      return true;
    },
  });
  return { bucket, headersSent: headersSent.promise, observed };
}

describe("a download to a file", () => {
  it("writes the whole object to the target, readable by this user alone", async () => {
    const bucket = await bucketWith({ prefix: "root" });
    bucket.objects.set("root/archives/a.enc", { body: ARCHIVE, lastModified: new Date() });
    const target = join(await scratch(), "a.enc");
    await storeFor(bucket).getFile("archives/a.enc", target, live());
    expect(await readFile(target)).toEqual(ARCHIVE);
    expect((await stat(target)).mode & 0o777).toBe(0o600);
  });

  it("writes an empty object as an empty file", async () => {
    const bucket = await bucketWith();
    bucket.objects.set("a.enc", { body: Buffer.alloc(0), lastModified: new Date() });
    const target = join(await scratch(), "a.enc");
    await storeFor(bucket).getFile("a.enc", target, live());
    expect((await readFile(target)).length).toBe(0);
  });

  it("replaces a file already at the target only once the whole body has arrived", async () => {
    const bucket = await bucketWith();
    bucket.objects.set("a.enc", { body: ARCHIVE, lastModified: new Date() });
    const dir = await scratch();
    const target = join(dir, "a.enc");
    await writeFile(target, ORIGINAL);
    await storeFor(bucket).getFile("a.enc", target, live());
    expect(await readFile(target)).toEqual(ARCHIVE);
    expect(await readdir(dir)).toEqual(["a.enc"]);
  });

  it("writes the body to a private file beside the target while it arrives", async () => {
    const { bucket, headersSent } = await stallingBucket();
    const dir = await scratch();
    const target = join(dir, "a.enc");
    await writeFile(target, ORIGINAL);
    const controller = new AbortController();
    const call = outcome(storeFor(bucket).getFile("a.enc", target, controller));
    await headersSent;
    await expect.poll(async () => (await readdir(dir)).length).toBe(2);
    const partial = (await readdir(dir)).find((name) => name !== "a.enc")!;
    expect((await stat(join(dir, partial))).mode & 0o777).toBe(0o600);
    controller.abort();
    expect(await call).toEqual(cancelled);
  });

  it("cancelled mid-body removes its partial file, keeps the target and closes the connection", async () => {
    const { bucket, headersSent, observed } = await stallingBucket();
    const dir = await scratch();
    const target = join(dir, "a.enc");
    await writeFile(target, ORIGINAL);
    const controller = new AbortController();
    const call = outcome(storeFor(bucket).getFile("a.enc", target, controller));
    await headersSent;
    await delay(50);
    controller.abort();
    expect(await call).toEqual(cancelled);
    expect(await readdir(dir)).toEqual(["a.enc"]);
    expect(await readFile(target)).toEqual(ORIGINAL);
    await expect.poll(() => observed.closed).toBe(true);
  });

  it("whose connection drops after the headers removes its partial file and keeps the target", async () => {
    const { bucket } = await stallingBucket((socket) => setTimeout(() => socket.destroy(), 20));
    const dir = await scratch();
    const target = join(dir, "a.enc");
    await writeFile(target, ORIGINAL);
    expect(await outcome(storeFor(bucket).getFile("a.enc", target, live()))).toMatchObject({
      code: "backup.destination_request_failed",
      params: { operation: "get", key: "a.enc", status: null },
    });
    expect(await readdir(dir)).toEqual(["a.enc"]);
    expect(await readFile(target)).toEqual(ORIGINAL);
  });

  it("of a missing object writes nothing", async () => {
    const bucket = await bucketWith();
    const dir = await scratch();
    expect(await outcome(storeFor(bucket).getFile("a.enc", join(dir, "a.enc"), live()))).toEqual({
      code: "backup.destination_request_failed",
      params: { operation: "get", key: "a.enc", status: 404, name: "NoSuchKey" },
    });
    expect(await readdir(dir)).toEqual([]);
  });

  it("whose signal is already cancelled sends nothing and writes nothing", async () => {
    const bucket = await bucketWith();
    const dir = await scratch();
    expect(
      await outcome(
        storeFor(bucket).getFile("a.enc", join(dir, "a.enc"), { signal: AbortSignal.abort() }),
      ),
    ).toEqual(cancelled);
    expect(bucket.seen).toEqual([]);
    expect(await readdir(dir)).toEqual([]);
  });

  it("into a folder that does not exist passes the file system's error on and closes the body", async () => {
    const { bucket, observed } = await stallingBucket();
    const target = join(await scratch(), "missing", "a.enc");
    await expect(storeFor(bucket).getFile("a.enc", target, live())).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect.poll(() => observed.closed).toBe(true);
  });
});

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

describe("a download as a stream", () => {
  it("hands back the object's bytes", async () => {
    const bucket = await bucketWith();
    bucket.objects.set("a.enc", { body: ARCHIVE, lastModified: new Date() });
    expect(await readAll(await storeFor(bucket).readStream("a.enc", live()))).toEqual(ARCHIVE);
  });

  it("is destroyed, and its connection closed, when the signal is cancelled", async () => {
    const { bucket, headersSent, observed } = await stallingBucket();
    const controller = new AbortController();
    const stream = await storeFor(bucket).readStream("a.enc", controller);
    await headersSent;
    const reading = outcome(readAll(stream));
    await delay(50);
    controller.abort();
    expect(await reading).toEqual(cancelled);
    expect(stream.destroyed).toBe(true);
    await expect.poll(() => observed.closed).toBe(true);
  });

  it("is destroyed when the signal is cancelled while nothing is reading it", async () => {
    const { bucket, headersSent, observed } = await stallingBucket();
    const controller = new AbortController();
    const stream = await storeFor(bucket).readStream("a.enc", controller);
    await headersSent;
    const failed = new Promise((resolve) => stream.once("error", resolve));
    controller.abort();
    expect(await outcome(failed.then((error) => Promise.reject(error)))).toEqual(cancelled);
    expect(stream.destroyed).toBe(true);
    await expect.poll(() => observed.closed).toBe(true);
  });

  it("fails as cancelled when cancelled while a chunk waits unread", async () => {
    const { bucket, headersSent } = await stallingBucket();
    const controller = new AbortController();
    const stream = await storeFor(bucket).readStream("a.enc", controller);
    await headersSent;
    const buffered = new Promise((resolve) => stream.once("readable", resolve));
    stream.read(0);
    await buffered;
    controller.abort();
    expect(await outcome(readAll(stream))).toEqual(cancelled);
  });

  it("fails as a request that broke off when its connection drops", async () => {
    const { bucket } = await stallingBucket((socket) => setTimeout(() => socket.destroy(), 20));
    const stream = await storeFor(bucket).readStream("a.enc", live());
    expect(await outcome(readAll(stream))).toMatchObject({
      code: "backup.destination_request_failed",
      params: { operation: "get", key: "a.enc", status: null },
    });
  });

  it("closes its connection when its reader destroys it", async () => {
    const { bucket, headersSent, observed } = await stallingBucket();
    const stream = await storeFor(bucket).readStream("a.enc", live());
    await headersSent;
    stream.destroy();
    await expect.poll(() => observed.closed).toBe(true);
  });

  it("of a missing object is refused", async () => {
    const bucket = await bucketWith();
    expect(await outcome(storeFor(bucket).readStream("a.enc", live()))).toEqual({
      code: "backup.destination_request_failed",
      params: { operation: "get", key: "a.enc", status: 404, name: "NoSuchKey" },
    });
  });

  it("whose signal is already cancelled sends nothing", async () => {
    const bucket = await bucketWith();
    expect(
      await outcome(storeFor(bucket).readStream("a.enc", { signal: AbortSignal.abort() })),
    ).toEqual(cancelled);
    expect(bucket.seen).toEqual([]);
  });
});

const NO_NETWORK: BucketConfig = {
  endpoint: "http://127.0.0.1:9",
  region: "us-east-1",
  bucket: "owner-bucket",
  prefix: "",
  accessKeyId: "AKIAEXAMPLE0000",
  secretAccessKey: "not-a-real-secret",
};

/**
 * For each `depth`, a store whose request handler answers a GET with a body that sends one chunk
 * and then waits, and cancels the call `depth` microtasks after answering. Sweeping the depth
 * lands the cancellation at every point between the answer and the store's own listener.
 */
function answeredThenCancelled(depth: number) {
  const controller = new AbortController();
  const body = new Readable({ read() {} });
  body.push("the first part");
  const requestHandler = {
    async handle() {
      let tick = Promise.resolve();
      for (let i = 0; i < depth; i += 1) tick = tick.then(() => {});
      void tick.then(() => controller.abort());
      return {
        response: {
          statusCode: 200,
          headers: { etag: '"v1"', "content-length": "1000" },
          body,
        },
      };
    },
    updateHttpClientConfig() {},
    httpHandlerConfigs: () => ({}),
    destroy() {},
  };
  const store = createS3FileStore(NO_NETWORK, { requestHandler: requestHandler as never });
  cleanups.push(async () => store.close());
  return { store, signal: controller.signal, body };
}

const DEPTHS = Array.from({ length: 100 }, (_, depth) => depth);
const settled = () => new Promise((resolve) => setImmediate(resolve));

describe("a download cancelled at any point after the bucket answered", () => {
  it("to a file ends as cancelled and closes the body", async () => {
    const dir = await scratch();
    const missed: number[] = [];
    for (const depth of DEPTHS) {
      const { store, signal, body } = answeredThenCancelled(depth);
      const ended = await outcome(store.getFile("a.enc", join(dir, "a.enc"), { signal }), 300);
      await settled();
      if (JSON.stringify(ended) !== JSON.stringify(cancelled) || !body.destroyed)
        missed.push(depth);
    }
    expect(missed).toEqual([]);
    expect(await readdir(dir)).toEqual([]);
  });

  it("as a stream ends as cancelled and closes the body", async () => {
    const missed: number[] = [];
    const handedBackAtCancel: boolean[] = [];
    for (const depth of DEPTHS) {
      const { store, signal, body } = answeredThenCancelled(depth);
      let handedBack = false;
      signal.addEventListener("abort", () => handedBackAtCancel.push(handedBack));
      const ended = await outcome(
        store.readStream("a.enc", { signal }).then((stream) => {
          handedBack = true;
          return readAll(stream);
        }),
        300,
      );
      await settled();
      if (JSON.stringify(ended) !== JSON.stringify(cancelled) || !body.destroyed)
        missed.push(depth);
    }
    expect(missed).toEqual([]);
    // The sweep starts before the stream is handed back and ends after it.
    expect([handedBackAtCancel[0], handedBackAtCancel.at(-1)]).toEqual([false, true]);
  });
});
