import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import {
  createS3FileStore,
  type FileCall,
  type ListedFile,
  type S3FileStore,
} from "@waitron/stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { backupArchiveKey } from "./backup-keys.js";
import { pruneBackend } from "./backup-sweep.js";
import { S3Backend } from "./s3-backend.js";
import { SMALL_OBJECT_MAX_BYTES } from "./storage-backend.js";

// `@waitron/stream` does not export its loopback bucket to other packages, so this drives the adapter
// through an in-memory object with the file store's shape; the file store's own requests are
// covered in `packages/stream`.

const MiB = 1024 * 1024;

interface Recorded {
  calls: { method: string; args: unknown[]; call: FileCall }[];
  /** Bytes the most recent `readStream` handed out. */
  streamed: number;
  stream?: Readable;
  closed: boolean;
}

function fakeStore(objects: Map<string, { body: Buffer; lastModified: Date }>, record: Recorded) {
  const store: S3FileStore = {
    async putFile(key, path, call) {
      record.calls.push({ method: "putFile", args: [key, path], call });
      objects.set(key, { body: await readFile(path), lastModified: new Date() });
    },
    async putBytes(key, bytes, call) {
      record.calls.push({ method: "putBytes", args: [key, Buffer.from(bytes)], call });
      objects.set(key, { body: Buffer.from(bytes), lastModified: new Date() });
    },
    async getFile(key, outPath, call) {
      record.calls.push({ method: "getFile", args: [key, outPath], call });
      await writeFile(outPath, objects.get(key)!.body);
    },
    async readStream(key, call) {
      record.calls.push({ method: "readStream", args: [key], call });
      const body = objects.get(key)!.body;
      let offset = 0;
      record.streamed = 0;
      record.stream = new Readable({
        read() {
          if (offset >= body.length) {
            this.push(null);
            return;
          }
          const chunk = body.subarray(offset, offset + MiB);
          offset += chunk.length;
          record.streamed += chunk.length;
          this.push(chunk);
        },
      });
      return record.stream;
    },
    async list(prefix, call): Promise<ListedFile[]> {
      record.calls.push({ method: "list", args: [prefix], call });
      return [...objects]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, o]) => ({ key, size: o.body.length, lastModified: o.lastModified }));
    },
    async deleteMany(keys, call) {
      record.calls.push({ method: "deleteMany", args: [keys], call });
      for (const key of keys) objects.delete(key);
    },
    close() {
      record.closed = true;
    },
  };
  return store;
}

interface Asked {
  method: string;
  query: Record<string, unknown>;
}

/** A backend over the real file store, whose transport hands each request to `answer`. */
function overTransport(answer: (asked: Asked) => { status: number; body?: string }) {
  const asked: Asked[] = [];
  const files = createS3FileStore(
    {
      endpoint: "https://s3.example.test",
      region: "us-east-1",
      bucket: "owner-bucket",
      prefix: "",
      accessKeyId: "AKIAEXAMPLE0000",
      secretAccessKey: "not-a-real-secret",
    },
    {
      requestHandler: {
        async handle(request: Asked) {
          asked.push({ method: request.method, query: request.query });
          const { status, body } = answer(request);
          return {
            response: {
              statusCode: status,
              headers: { "content-type": "application/xml", etag: '"e"' },
              body: Readable.from(body === undefined ? [] : [Buffer.from(body)]),
            },
          };
        },
      } as never,
    },
  );
  return { backend: new S3Backend("bucket", files), asked };
}

describe("S3Backend", () => {
  let dir: string;
  let objects: Map<string, { body: Buffer; lastModified: Date }>;
  let record: Recorded;
  let backend: S3Backend;
  const call = { signal: new AbortController().signal };
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "s3-backend-"));
    objects = new Map();
    record = { calls: [], streamed: 0, closed: false };
    backend = new S3Backend("bucket", fakeStore(objects, record));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("carries its id", () => {
    expect(backend.id).toBe("bucket");
  });

  it("hands whole files to the file store with the caller's signal", async () => {
    const input = join(dir, "input");
    const output = join(dir, "output");
    await writeFile(input, "cipher");
    await backend.putFile("waitron-a.backup.enc", input, call);
    await backend.getFile("waitron-a.backup.enc", output, call);
    expect(await readFile(output, "utf8")).toBe("cipher");
    expect(record.calls.map((c) => [c.method, c.args, c.call.signal])).toEqual([
      ["putFile", ["waitron-a.backup.enc", input], call.signal],
      ["getFile", ["waitron-a.backup.enc", output], call.signal],
    ]);
  });

  it("puts small bytes through the file store's in-memory upload, and gets them back", async () => {
    await backend.put("small.json", Buffer.from("{}"), call);
    expect(record.calls[0]).toMatchObject({
      method: "putBytes",
      args: ["small.json", Buffer.from("{}")],
    });
    expect(record.calls[0]!.call.signal).toBe(call.signal);
    expect(await backend.get("small.json", call)).toEqual(Buffer.from("{}"));
    expect(record.calls[1]!.call.signal).toBe(call.signal);
  });

  it("passes a failed upload's error on", async () => {
    const failing = new S3Backend("bucket", {
      ...fakeStore(objects, record),
      async putBytes() {
        throw new Error("refused");
      },
    });
    await expect(failing.put("small.json", Buffer.from("{}"), call)).rejects.toThrow("refused");
  });

  it("puts small bytes in one request through the real file store", async () => {
    const { backend: real, asked } = overTransport(() => ({ status: 200 }));
    try {
      await real.put("small.json", Buffer.from("{}"), call);
      expect(asked.map(({ method }) => method)).toEqual(["PUT"]);
    } finally {
      real.close();
    }
  });

  it("a put already cancelled sends nothing and reports the cancellation", async () => {
    const { backend: real, asked } = overTransport(() => ({ status: 200 }));
    try {
      await expect(
        real.put("small.json", Buffer.from("{}"), { signal: AbortSignal.abort() }),
      ).rejects.toMatchObject({
        code: "backup.destination_request_failed",
        params: { operation: "put", key: "small.json", status: null, name: "AbortError" },
      });
      expect(asked).toEqual([]);
    } finally {
      real.close();
    }
  });

  it.each(["waitron-a/b", "waitron-a\\b", "", ".", "..", "waitron-\u0000", "waitron-\u009f"])(
    "refuses the key %j in every call, as the folder destination does, before any file or request",
    async (bad) => {
      const input = join(dir, "input");
      const refused = { code: "backup.destination_key_invalid", params: { field: "key" } };
      await expect(backend.put(bad, Buffer.from("{}"), call)).rejects.toMatchObject(refused);
      await expect(backend.putFile(bad, input, call)).rejects.toMatchObject(refused);
      await expect(backend.getFile(bad, join(dir, "out"), call)).rejects.toMatchObject(refused);
      await expect(backend.get(bad, call)).rejects.toMatchObject(refused);
      await expect(backend.delete(bad, call)).rejects.toMatchObject(refused);
      await expect(backend.deleteMany(["waitron-ok", bad], call)).rejects.toMatchObject(refused);
      expect(record.calls).toEqual([]);
    },
  );

  it("refuses to put more than the small-object bound before any request", async () => {
    await expect(
      backend.put("big", Buffer.alloc(SMALL_OBJECT_MAX_BYTES + 1), call),
    ).rejects.toMatchObject({
      code: "backup.destination_object_too_large",
      params: { maxBytes: SMALL_OBJECT_MAX_BYTES },
    });
    expect(record.calls).toEqual([]);
  });

  it("gets an object exactly at the bound", async () => {
    objects.set("edge", {
      body: Buffer.alloc(SMALL_OBJECT_MAX_BYTES, 7),
      lastModified: new Date(),
    });
    const got = await backend.get("edge", call);
    expect(got.length).toBe(SMALL_OBJECT_MAX_BYTES);
  });

  it("refuses a larger object once past the bound, without reading the rest of it", async () => {
    objects.set("huge", { body: Buffer.alloc(64 * MiB), lastModified: new Date() });
    // The length, not the buffer, when it resolves: printing 64 MiB in a failure message crashed
    // the worker.
    const outcome = await backend.get("huge", call).then(
      (bytes) => bytes.length,
      (error: unknown) => error,
    );
    expect(outcome).toMatchObject({
      code: "backup.destination_object_too_large",
      params: { maxBytes: SMALL_OBJECT_MAX_BYTES },
    });
    expect(record.streamed).toBeLessThanOrEqual(SMALL_OBJECT_MAX_BYTES + 2 * MiB);
    expect(record.stream?.destroyed).toBe(true);
  });

  it("lists newest-first with the time as milliseconds", async () => {
    objects.set("waitron-old", { body: Buffer.from("o"), lastModified: new Date(1_000) });
    objects.set("waitron-new", { body: Buffer.from("nn"), lastModified: new Date(3_000) });
    objects.set("waitron-mid", { body: Buffer.from("m"), lastModified: new Date(2_000) });
    objects.set("other", { body: Buffer.from("x"), lastModified: new Date(9_000) });
    expect(await backend.list("waitron-", call)).toEqual([
      { key: "waitron-new", size: 2, mtimeMs: 3_000 },
      { key: "waitron-mid", size: 1, mtimeMs: 2_000 },
      { key: "waitron-old", size: 1, mtimeMs: 1_000 },
    ]);
    expect(record.calls[0]).toMatchObject({ method: "list", args: ["waitron-"] });
  });

  it("lists only the keys directly inside its folder", async () => {
    objects.set("waitron-a", { body: Buffer.from("a"), lastModified: new Date(1_000) });
    objects.set("waitron-b/deeper", { body: Buffer.from("b"), lastModified: new Date(2_000) });
    expect((await backend.list("waitron-", call)).map((o) => o.key)).toEqual(["waitron-a"]);
  });

  it("refuses a listing prefix that names a folder, before any request", async () => {
    await expect(backend.list("archives/v1", call)).rejects.toMatchObject({
      code: "backup.destination_key_invalid",
      params: { field: "prefix" },
    });
    expect(record.calls).toEqual([]);
  });

  it("asks the real file store for its own folder only, never a sibling whose name extends it", async () => {
    const asked: unknown[] = [];
    const listing =
      "<ListBucketResult><IsTruncated>false</IsTruncated>" +
      ["archives/v1/waitron-a", "archives/v1/waitron-b/deeper"]
        .map(
          (key) =>
            `<Contents><Key>${key}</Key><Size>1</Size><LastModified>2026-10-12T00:00:00.000Z</LastModified></Contents>`,
        )
        .join("") +
      "</ListBucketResult>";
    const files = createS3FileStore(
      {
        endpoint: "https://s3.example.test",
        region: "us-east-1",
        bucket: "owner-bucket",
        prefix: "archives/v1",
        accessKeyId: "AKIAEXAMPLE0000",
        secretAccessKey: "not-a-real-secret",
      },
      {
        requestHandler: {
          async handle(request: { query: Record<string, unknown> }) {
            asked.push(request.query["prefix"]);
            return {
              response: {
                statusCode: 200,
                headers: { "content-type": "application/xml" },
                body: Readable.from([Buffer.from(listing)]),
              },
            };
          },
        } as never,
      },
    );
    const real = new S3Backend("bucket", files);
    try {
      expect(await real.list("waitron-", call)).toEqual([
        { key: "waitron-a", size: 1, mtimeMs: Date.parse("2026-10-12T00:00:00.000Z") },
      ]);
      expect(asked).toEqual(["archives/v1/waitron-"]);
    } finally {
      real.close();
    }
  });

  it("over the real file store, prunes nothing when a listing repeats the only archive on a second page", async () => {
    const key = backupArchiveKey(new Date("2026-10-12T00:00:00Z"));
    const page = (more: boolean) =>
      `<ListBucketResult><Contents><Key>${key}</Key><Size>1</Size>` +
      "<LastModified>2026-10-12T00:00:00.000Z</LastModified></Contents>" +
      (more
        ? "<IsTruncated>true</IsTruncated><NextContinuationToken>t1</NextContinuationToken>"
        : "<IsTruncated>false</IsTruncated>") +
      "</ListBucketResult>";
    const { backend: real, asked } = overTransport(({ method, query }) =>
      method === "GET"
        ? { status: 200, body: page(query["continuation-token"] === undefined) }
        : { status: 200, body: "<DeleteResult></DeleteResult>" },
    );
    try {
      await expect(
        pruneBackend(real, 1, 3650, Date.parse("2026-10-12T01:00:00Z"), call),
      ).rejects.toMatchObject({
        code: "backup.destination_request_failed",
        params: { operation: "list", name: "RepeatedKey" },
      });
      expect(asked.map(({ method }) => method)).toEqual(["GET", "GET"]);
    } finally {
      real.close();
    }
  });

  it("deletes one key, or many, through the file store's batch delete", async () => {
    for (const key of ["a", "b", "c"]) {
      objects.set(key, { body: Buffer.from(key), lastModified: new Date() });
    }
    await backend.delete("a", call);
    await backend.deleteMany(["b", "c"], call);
    expect([...objects.keys()]).toEqual([]);
    expect(record.calls.map((c) => [c.method, c.args, c.call.signal])).toEqual([
      ["deleteMany", [["a"]], call.signal],
      ["deleteMany", [["b", "c"]], call.signal],
    ]);
  });

  it("closes the file store", () => {
    backend.close();
    expect(record.closed).toBe(true);
  });
});
