import { mkdtemp, open, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import { createS3FileStore, type S3FileStore } from "./s3-file-store.js";
import { errorXml, loopbackBucket, type LoopbackBucket } from "./testing/loopback-bucket.js";

const MiB = 1024 * 1024;
const xml = { "content-type": "application/xml" };

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "s3-file-store-upload-"));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** A file whose every byte depends on its position, so a part sent from the wrong range shows. */
async function patterned(dir: string, bytes: number): Promise<{ path: string; body: Buffer }> {
  const body = Buffer.alloc(bytes);
  for (let i = 0; i < bytes; i += 1) body[i] = (i * 7 + Math.floor(i / 4096)) % 251;
  const path = join(dir, "archive.bin");
  await writeFile(path, body);
  return { path, body };
}

async function bucketWith(options: Parameters<typeof loopbackBucket>[0] = {}) {
  const bucket = await loopbackBucket(options);
  cleanups.push(() => bucket.close());
  return bucket;
}

function storeFor(bucket: LoopbackBucket, cleanupMs?: number): S3FileStore {
  const store = createS3FileStore(bucket.config, {
    sleep: async () => {},
    ...(cleanupMs === undefined ? {} : { cleanupMs }),
  });
  cleanups.push(async () => store.close());
  return store;
}

/** How the call ended, or "still pending" when it had not within `ms`. */
async function outcome(call: Promise<unknown>, ms = 5_000): Promise<unknown> {
  const ended = call.then(
    () => "resolved",
    (error: unknown) =>
      error instanceof AppError ? { code: error.code, params: error.params } : error,
  );
  return Promise.race([ended, delay(ms, "still pending")]);
}

const live = () => ({ signal: new AbortController().signal });
const kinds = (bucket: LoopbackBucket) => bucket.seen.map((seen) => seen.kind);
const abortsSent = (bucket: LoopbackBucket) =>
  bucket.seen.filter((seen) => seen.kind === "abort").map((seen) => seen.uploadId);

describe("a file of at most 8 MiB", () => {
  it("goes up in one request that states its length", async () => {
    const bucket = await bucketWith();
    const { path, body } = await patterned(await scratch(), 100_000);
    await storeFor(bucket).putFile("archives/v1/a.enc", path, live());
    expect(kinds(bucket)).toEqual(["put"]);
    expect(bucket.seen[0]!.headers["content-length"]).toBe("100000");
    expect(bucket.seen[0]!.headers["transfer-encoding"]).toBeUndefined();
    expect(bucket.objects.get("archives/v1/a.enc")!.body.equals(body)).toBe(true);
  });

  it("goes up in one request at exactly 8 MiB", async () => {
    const bucket = await bucketWith();
    const { path, body } = await patterned(await scratch(), 8 * MiB);
    await storeFor(bucket).putFile("a.enc", path, live());
    expect(kinds(bucket)).toEqual(["put"]);
    expect(bucket.objects.get("a.enc")!.body.equals(body)).toBe(true);
  });

  it("goes up empty when the file is empty", async () => {
    const bucket = await bucketWith();
    const { path } = await patterned(await scratch(), 0);
    await storeFor(bucket).putFile("a.enc", path, live());
    expect(bucket.objects.get("a.enc")!.body.length).toBe(0);
  });

  it("lands under the configured prefix", async () => {
    const bucket = await bucketWith({ prefix: "/owner/root/" });
    const { path } = await patterned(await scratch(), 10);
    await storeFor(bucket).putFile("archives/a.enc", path, live());
    expect([...bucket.objects.keys()]).toEqual(["owner/root/archives/a.enc"]);
  });

  it("is sent again from the file after an answer that failed, and the object is whole", async () => {
    let attempts = 0;
    const bucket = await bucketWith({
      answer: (seen, _request, response) => {
        if (seen.kind !== "put") return false;
        attempts += 1;
        if (attempts > 1) return false;
        response.writeHead(503, xml);
        response.end(errorXml("SlowDown"));
        return true;
      },
    });
    const { path, body } = await patterned(await scratch(), 300_000);
    await storeFor(bucket).putFile("a.enc", path, live());
    expect(kinds(bucket)).toEqual(["put", "put"]);
    expect(bucket.seen.map((seen) => seen.body!.equals(body))).toEqual([true, true]);
    expect(bucket.objects.get("a.enc")!.body.equals(body)).toBe(true);
  });

  it("refused outright is not sent again and deletes nothing", async () => {
    const bucket = await bucketWith({
      answer: (seen, _request, response) => {
        if (seen.kind !== "put") return false;
        response.writeHead(403, xml);
        response.end(errorXml("AccessDenied"));
        return true;
      },
    });
    const { path } = await patterned(await scratch(), 10);
    expect(await outcome(storeFor(bucket).putFile("a.enc", path, live()))).toEqual({
      code: "backup.destination_request_failed",
      params: { operation: "put", key: "a.enc", status: 403, name: "AccessDenied" },
    });
    expect(kinds(bucket)).toEqual(["put"]);
  });

  it("whose answers all fail deletes its own key, since one of them may have been stored", async () => {
    const bucket = await bucketWith({
      answer: (seen, _request, response) => {
        if (seen.kind !== "put") return false;
        bucket.objects.set(seen.key, { body: seen.body!, lastModified: new Date() });
        response.writeHead(500, xml);
        response.end(errorXml("InternalError"));
        return true;
      },
    });
    const { path } = await patterned(await scratch(), 10);
    expect(await outcome(storeFor(bucket).putFile("a.enc", path, live()))).toEqual({
      code: "backup.destination_request_failed",
      params: { operation: "put", key: "a.enc", status: 500, name: "InternalError" },
    });
    expect(kinds(bucket)).toEqual(["put", "put", "put", "delete"]);
    expect(bucket.seen[3]!.key).toBe("a.enc");
    expect(bucket.objects.has("a.enc")).toBe(false);
  });

  it("whose connection drops after the bucket stored it deletes its own key", async () => {
    const bucket = await bucketWith({
      answer: (seen, request) => {
        if (seen.kind !== "put") return false;
        bucket.objects.set(seen.key, { body: seen.body!, lastModified: new Date() });
        request.socket.destroy();
        return true;
      },
    });
    bucket.objects.set("older.enc", { body: Buffer.from("keep"), lastModified: new Date() });
    const { path } = await patterned(await scratch(), 10);
    expect(await outcome(storeFor(bucket).putFile("a.enc", path, live()))).toMatchObject({
      code: "backup.destination_request_failed",
      params: { operation: "put", key: "a.enc", status: null },
    });
    expect(kinds(bucket)).toEqual(["put", "put", "put", "delete"]);
    expect([...bucket.objects.keys()]).toEqual(["older.enc"]);
  });

  it("reports a cleanup it could not finish rather than the failure that caused it", async () => {
    const bucket = await bucketWith({
      answer: (seen, request, response) => {
        if (seen.kind === "put") {
          request.socket.destroy();
          return true;
        }
        response.writeHead(403, xml);
        response.end(errorXml("AccessDenied"));
        return true;
      },
    });
    const { path } = await patterned(await scratch(), 10);
    expect(await outcome(storeFor(bucket).putFile("a.enc", path, live()))).toEqual({
      code: "backup.destination_cleanup_failed",
      params: { key: "a.enc", cleanup: "delete_object", status: 403, name: "AccessDenied" },
    });
  });

  it("whose own key is already gone when it cleans up reports the failure that caused it", async () => {
    const bucket = await bucketWith({
      answer: (seen, request, response) => {
        if (seen.kind === "put") {
          request.socket.destroy();
          return true;
        }
        // Some S3-compatible stores answer a delete of a missing key this way.
        response.writeHead(404, xml);
        response.end(errorXml("NoSuchKey"));
        return true;
      },
    });
    const { path } = await patterned(await scratch(), 10);
    expect(await outcome(storeFor(bucket).putFile("a.enc", path, live()))).toMatchObject({
      code: "backup.destination_request_failed",
      params: { operation: "put", key: "a.enc", status: null },
    });
    expect(kinds(bucket)).toEqual(["put", "put", "put", "delete"]);
  });

  it("cancelled while it is being sent deletes its own key on a signal of its own", async () => {
    const controller = new AbortController();
    const bucket = await bucketWith({
      onRequest: (seen) => {
        if (seen.kind === "put") controller.abort();
      },
    });
    const { path } = await patterned(await scratch(), 4 * MiB);
    expect(
      await outcome(storeFor(bucket).putFile("a.enc", path, { signal: controller.signal })),
    ).toEqual({
      code: "backup.destination_request_failed",
      params: { operation: "put", key: "a.enc", status: null, name: "AbortError" },
    });
    expect(kinds(bucket)).toEqual(["put", "delete"]);
    expect(bucket.objects.has("a.enc")).toBe(false);
  });
});

describe("a file over 8 MiB", () => {
  it("goes up as four 8 MiB parts for 32 MiB, completed once after the last", async () => {
    const bucket = await bucketWith();
    const { path, body } = await patterned(await scratch(), 32 * MiB);
    await storeFor(bucket).putFile("archives/v1/a.enc", path, live());
    expect(bucket.record.partBytes).toEqual([8388608, 8388608, 8388608, 8388608]);
    expect(kinds(bucket)).toEqual(["create", "part", "part", "part", "part", "complete"]);
    expect(bucket.seen.slice(1, 5).map((seen) => seen.partNumber)).toEqual([1, 2, 3, 4]);
    expect(bucket.objects.get("archives/v1/a.enc")!.body.equals(body)).toBe(true);
  });

  it("puts one byte past 8 MiB in a second part", async () => {
    const bucket = await bucketWith();
    const { path, body } = await patterned(await scratch(), 8 * MiB + 1);
    await storeFor(bucket).putFile("a.enc", path, live());
    expect(bucket.record.partBytes).toEqual([8 * MiB, 1]);
    expect(bucket.objects.get("a.enc")!.body.equals(body)).toBe(true);
  });

  it("sends a part again from its own range of the file after an answer that failed", async () => {
    let secondPartAttempts = 0;
    const bucket = await bucketWith({
      answer: (seen, _request, response) => {
        if (seen.kind !== "part" || seen.partNumber !== 2) return false;
        secondPartAttempts += 1;
        if (secondPartAttempts > 1) return false;
        response.writeHead(500, xml);
        response.end(errorXml("InternalError"));
        return true;
      },
    });
    const { path, body } = await patterned(await scratch(), 20 * MiB);
    await storeFor(bucket).putFile("a.enc", path, live());
    const secondPart = bucket.seen.filter((seen) => seen.partNumber === 2);
    expect(secondPart).toHaveLength(2);
    const range = body.subarray(8 * MiB, 16 * MiB);
    expect(secondPart.map((seen) => seen.body!.equals(range))).toEqual([true, true]);
    expect(bucket.objects.get("a.enc")!.body.equals(body)).toBe(true);
  });

  it("refused a part, completes nothing and abandons its own upload", async () => {
    const bucket = await bucketWith({
      answer: (seen, _request, response) => {
        if (seen.kind !== "part" || seen.partNumber !== 3) return false;
        response.writeHead(403, xml);
        response.end(errorXml("AccessDenied"));
        return true;
      },
    });
    const { path } = await patterned(await scratch(), 32 * MiB);
    expect(await outcome(storeFor(bucket).putFile("a.enc", path, live()))).toEqual({
      code: "backup.destination_request_failed",
      params: { operation: "upload_part", key: "a.enc", status: 403, name: "AccessDenied" },
    });
    expect(kinds(bucket)).toEqual(["create", "part", "part", "part", "abort"]);
    expect(bucket.record.completedIds).toEqual([]);
    expect(bucket.record.abortedIds).toEqual([bucket.record.createdIds[0]]);
    expect(bucket.objects.size).toBe(0);
  });

  it("cancelled after a part was stored, sends no further part and abandons its own upload on a fresh signal", async () => {
    const controller = new AbortController();
    const bucket = await bucketWith({
      onRequest: (seen) => {
        if (seen.kind === "part" && seen.partNumber === 2) controller.abort();
      },
    });
    const { path } = await patterned(await scratch(), 32 * MiB);
    expect(
      await outcome(storeFor(bucket).putFile("a.enc", path, { signal: controller.signal })),
    ).toEqual({
      code: "backup.destination_request_failed",
      params: { operation: "upload_part", key: "a.enc", status: null, name: "AbortError" },
    });
    expect(kinds(bucket)).toEqual(["create", "part", "part", "abort"]);
    expect(bucket.record.completedIds).toEqual([]);
    expect(bucket.record.abortedIds).toEqual([bucket.record.createdIds[0]]);
  });

  it("reports an abandonment the bucket never answers once the cleanup budget runs out", async () => {
    const bucket = await bucketWith({
      answer: (seen, _request, response) => {
        if (seen.kind === "abort") return true;
        if (seen.kind !== "part") return false;
        response.writeHead(403, xml);
        response.end(errorXml("AccessDenied"));
        return true;
      },
    });
    const { path } = await patterned(await scratch(), 9 * MiB);
    const started = Date.now();
    expect(await outcome(storeFor(bucket, 150).putFile("a.enc", path, live()))).toEqual({
      code: "backup.destination_cleanup_failed",
      params: { key: "a.enc", cleanup: "abort_upload", status: null, name: "AbortError" },
    });
    expect(Date.now() - started).toBeLessThan(2_000);
    await expect.poll(() => bucket.seen.at(-1)!.closedEarly).toBe(true);
  });

  it("whose completion is not known to have failed abandons the upload and deletes its own key", async () => {
    let completions = 0;
    const bucket = await bucketWith({
      answer: (seen, request) => {
        if (seen.kind !== "complete") return false;
        completions += 1;
        if (completions > 1) return false;
        bucket.answerAsS3(seen, { writeHead() {}, end() {} } as never);
        request.socket.destroy();
        return true;
      },
    });
    bucket.objects.set("older.enc", { body: Buffer.from("keep"), lastModified: new Date() });
    const { path } = await patterned(await scratch(), 9 * MiB);
    expect(await outcome(storeFor(bucket).putFile("a.enc", path, live()))).toEqual({
      code: "backup.destination_request_failed",
      params: { operation: "complete_upload", key: "a.enc", status: 404, name: "NoSuchUpload" },
    });
    expect(kinds(bucket).slice(-2)).toEqual(["abort", "delete"]);
    // The completion went through, so the bucket answers the abandonment NoSuchUpload.
    expect(abortsSent(bucket)).toEqual([bucket.record.createdIds[0]]);
    expect([...bucket.objects.keys()]).toEqual(["older.enc"]);
  });

  it("refused its start sends nothing more", async () => {
    const bucket = await bucketWith({
      answer: (seen, _request, response) => {
        response.writeHead(403, xml);
        response.end(errorXml("AccessDenied"));
        return seen.kind === "create";
      },
    });
    const { path } = await patterned(await scratch(), 9 * MiB);
    expect(await outcome(storeFor(bucket).putFile("a.enc", path, live()))).toEqual({
      code: "backup.destination_request_failed",
      params: { operation: "create_upload", key: "a.enc", status: 403, name: "AccessDenied" },
    });
    expect(kinds(bucket)).toEqual(["create"]);
  });

  it("whose start is answered without an upload id sends nothing more", async () => {
    const bucket = await bucketWith({
      answer: (seen, _request, response) => {
        if (seen.kind !== "create") return false;
        response.writeHead(200, xml);
        response.end("<InitiateMultipartUploadResult></InitiateMultipartUploadResult>");
        return true;
      },
    });
    const { path } = await patterned(await scratch(), 9 * MiB);
    expect(await outcome(storeFor(bucket).putFile("a.enc", path, live()))).toEqual({
      code: "backup.destination_request_failed",
      params: { operation: "create_upload", key: "a.enc", status: 200, name: "IncompleteResponse" },
    });
    expect(kinds(bucket)).toEqual(["create"]);
  });

  it("whose part is answered without its tag completes nothing and abandons its own upload", async () => {
    const bucket = await bucketWith({
      answer: (seen, _request, response) => {
        if (seen.kind !== "part") return false;
        response.writeHead(200);
        response.end();
        return true;
      },
    });
    const { path } = await patterned(await scratch(), 9 * MiB);
    expect(await outcome(storeFor(bucket).putFile("a.enc", path, live()))).toEqual({
      code: "backup.destination_request_failed",
      params: { operation: "upload_part", key: "a.enc", status: 200, name: "MissingETag" },
    });
    expect(kinds(bucket)).toEqual(["create", "part", "abort"]);
    expect(bucket.record.abortedIds).toEqual([bucket.record.createdIds[0]]);
  });

  it("cancelled while it waits to send a part again sends no further part", async () => {
    const controller = new AbortController();
    const bucket = await bucketWith({
      answer: (seen, _request, response) => {
        if (seen.kind !== "part") return false;
        response.writeHead(503, xml);
        response.end(errorXml("SlowDown"));
        return true;
      },
    });
    const store = createS3FileStore(bucket.config, { sleep: async () => controller.abort() });
    cleanups.push(async () => store.close());
    const { path } = await patterned(await scratch(), 9 * MiB);
    expect(await outcome(store.putFile("a.enc", path, controller))).toEqual({
      code: "backup.destination_request_failed",
      params: { operation: "upload_part", key: "a.enc", status: null, name: "AbortError" },
    });
    expect(kinds(bucket)).toEqual(["create", "part", "abort"]);
  });

  it("fails, rather than send a short part, when the file shrinks during its upload", async () => {
    let path = "";
    const bucket = await bucketWith({
      onRequest: (seen) => {
        if (seen.kind === "part" && seen.partNumber === 2) void truncate(path, 8 * MiB + 10);
      },
    });
    ({ path } = await patterned(await scratch(), 20 * MiB));
    await expect(storeFor(bucket).putFile("a.enc", path, live())).rejects.toThrow(
      "the file is shorter than when its upload began",
    );
    expect(kinds(bucket)).toEqual(["create", "part", "part", "abort"]);
    expect(bucket.record.completedIds).toEqual([]);
    expect(bucket.record.abortedIds).toEqual([bucket.record.createdIds[0]]);
  });

  it("refuses a file that needs more than 10,000 parts of 64 MiB before opening an upload", async () => {
    // A sparse file: its length is set without writing its bytes.
    const path = join(await scratch(), "huge.bin");
    const handle = await open(path, "w");
    await handle.truncate(10_000 * 64 * MiB + 1);
    await handle.close();
    const bucket = await bucketWith();
    expect(await outcome(storeFor(bucket).putFile("a.enc", path, live()))).toEqual({
      code: "backup.destination_too_large",
      params: { bytes: 10_000 * 64 * MiB + 1, maxBytes: 10_000 * 64 * MiB },
    });
    expect(bucket.seen).toEqual([]);
  });
});

describe("an upload whose signal is already cancelled", () => {
  it("opens no file and sends nothing", async () => {
    const bucket = await bucketWith();
    const missing = join(await scratch(), "not-there.bin");
    expect(
      await outcome(storeFor(bucket).putFile("a.enc", missing, { signal: AbortSignal.abort() })),
    ).toEqual({
      code: "backup.destination_request_failed",
      params: { operation: "put", key: "a.enc", status: null, name: "AbortError" },
    });
    expect(bucket.seen).toEqual([]);
  });
});

describe("an upload of a file that cannot be read", () => {
  it("sends nothing and passes the file system's own error on", async () => {
    const bucket = await bucketWith();
    const missing = join(await scratch(), "not-there.bin");
    await expect(storeFor(bucket).putFile("a.enc", missing, live())).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(bucket.seen).toEqual([]);
  });
});
