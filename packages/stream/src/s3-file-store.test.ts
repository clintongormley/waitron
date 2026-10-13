import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import { createS3FileStore, planParts, type S3FileStore } from "./s3-file-store.js";
import { DELETE_CONCURRENCY } from "./s3-store.js";
import { errorXml, loopbackBucket, type LoopbackBucket } from "./testing/loopback-bucket.js";

const MiB = 1024 * 1024;
const xml = { "content-type": "application/xml" };

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

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

const live = () => ({ signal: new AbortController().signal });
const put = (bucket: LoopbackBucket, key: string, body = "x") =>
  bucket.objects.set(key, {
    body: Buffer.from(body),
    lastModified: new Date("2026-10-12T18:00:00Z"),
  });

describe("the part plan", () => {
  it("uses 8 MiB parts until 10,000 of them no longer cover the file", () => {
    expect(planParts(32 * MiB)).toEqual({ partBytes: 8 * MiB, parts: 4 });
    expect(planParts(10_000 * 8 * MiB)).toEqual({ partBytes: 8 * MiB, parts: 10_000 });
  });

  it("grows the part to a ten-thousandth of the file, rounded up", () => {
    expect(planParts(10_000 * 8 * MiB + 1)).toEqual({ partBytes: 8 * MiB + 1, parts: 10_000 });
    expect(planParts(200_000 * MiB)).toEqual({ partBytes: 20 * MiB, parts: 10_000 });
  });

  it("stops growing the part at 64 MiB, which covers 625 GiB", () => {
    expect(planParts(10_000 * 64 * MiB)).toEqual({ partBytes: 64 * MiB, parts: 10_000 });
  });

  it("refuses a file that would need more than 10,000 parts of 64 MiB", () => {
    expect(() => planParts(10_000 * 64 * MiB + 1)).toThrow(
      expect.objectContaining({
        code: "backup.destination_file_too_large",
        params: { bytes: 10_000 * 64 * MiB + 1, maxBytes: 10_000 * 64 * MiB },
      }),
    );
  });
});

const BAD_KEYS: [string, string][] = [
  ["an empty key", ""],
  ["an absolute key", "/archives/a.enc"],
  ["a parent segment", "archives/../a.enc"],
  ["a bare parent", ".."],
  ["a current-folder segment", "archives/./a.enc"],
  ["a leading current-folder segment", "./a.enc"],
  ["an empty segment", "archives//a.enc"],
  ["a trailing slash", "archives/"],
  ["a NUL", "a\u0000.enc"],
  ["a newline", "a\n.enc"],
  ["a DEL", "a\u007f.enc"],
  ["a C1 control", "a\u0085.enc"],
];

describe("a malformed key", () => {
  it.each(BAD_KEYS)("with %s is refused before any file or request", async (_name, key) => {
    const bucket = await bucketWith();
    const store = storeFor(bucket);
    const dir = await mkdtemp(join(tmpdir(), "s3-file-store-keys-"));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const refused = { code: "backup.destination_key_invalid", params: { field: "key" } };
    // The paths do not exist, so a store that touched the file system first would answer ENOENT.
    expect(await outcome(store.putFile(key, join(dir, "missing.bin"), live()))).toEqual(refused);
    expect(await outcome(store.putBytes(key, Buffer.from("{}"), live()))).toEqual(refused);
    expect(await outcome(store.getFile(key, join(dir, "no-folder", "out.bin"), live()))).toEqual(
      refused,
    );
    expect(await outcome(store.readStream(key, live()))).toEqual(refused);
    expect(await outcome(store.deleteMany(["fine.enc", key], live()))).toEqual(refused);
    expect(bucket.seen).toEqual([]);
    expect(await readdir(dir)).toEqual([]);
  });

  it.each(BAD_KEYS.filter(([, key]) => key !== "" && key !== "archives/"))(
    "with %s is refused as a listing prefix",
    async (_name, key) => {
      const bucket = await bucketWith();
      expect(await outcome(storeFor(bucket).list(key, live()))).toEqual({
        code: "backup.destination_key_invalid",
        params: { field: "prefix" },
      });
      expect(bucket.seen).toEqual([]);
    },
  );

  it("is refused in the configured prefix when the store is made", () => {
    for (const prefix of ["root/../other", "root/./x", "root\u0000"]) {
      expect(() =>
        createS3FileStore({
          region: "us-east-1",
          bucket: "b",
          prefix,
          accessKeyId: "AKIAEXAMPLE0000",
          secretAccessKey: "not-a-real-secret",
        }),
      ).toThrow(expect.objectContaining({ code: "backup.destination_key_invalid" }));
    }
  });
});

describe("a listing", () => {
  it("follows every page and names each object by its key under the configured prefix", async () => {
    const bucket = await bucketWith({ prefix: "root/", pageSize: 2 });
    for (const name of ["a", "b", "c", "d", "e"]) put(bucket, `root/archives/v1/${name}.enc`, name);
    put(bucket, "root/archives/v2/other.enc");
    expect(await storeFor(bucket).list("archives/v1/", live())).toEqual(
      ["a", "b", "c", "d", "e"].map((name) => ({
        key: `archives/v1/${name}.enc`,
        size: 1,
        lastModified: new Date("2026-10-12T18:00:00Z"),
      })),
    );
    expect(bucket.seen.map((seen) => seen.kind)).toEqual(["list", "list", "list"]);
  });

  it("of the whole configured prefix asks for that prefix", async () => {
    const bucket = await bucketWith({ prefix: "root" });
    put(bucket, "root/a.enc");
    put(bucket, "rootless/b.enc");
    expect((await storeFor(bucket).list("", live())).map((found) => found.key)).toEqual(["a.enc"]);
    expect(bucket.seen[0]!.key).toBe("root/");
  });

  it("of a prefix holding nothing answers no objects", async () => {
    const bucket = await bucketWith();
    expect(await storeFor(bucket).list("archives/", live())).toEqual([]);
  });

  function answeringPages(pages: string[]) {
    let page = 0;
    return (_seen: unknown, _request: unknown, response: import("node:http").ServerResponse) => {
      response.writeHead(200, xml);
      response.end(
        `<ListBucketResult>${pages[Math.min(page, pages.length - 1)]}</ListBucketResult>`,
      );
      page += 1;
      return true;
    };
  }
  const entry = (key: string, extra = "<Size>1</Size>") =>
    `<Contents><Key>${key}</Key><LastModified>2026-10-12T18:00:00.000Z</LastModified>${extra}</Contents>`;
  const more = (token: string) =>
    `<IsTruncated>true</IsTruncated><NextContinuationToken>${token}</NextContinuationToken>`;

  it("refuses the whole listing when a later page names a key outside the prefix asked for", async () => {
    const bucket = await bucketWith({
      answer: answeringPages([
        entry("archives/v1/a.enc") + more("t1"),
        entry("archives/v2/foreign.enc") + "<IsTruncated>false</IsTruncated>",
      ]),
    });
    expect(await outcome(storeFor(bucket).list("archives/v1/", live()))).toEqual({
      code: "backup.destination_key_invalid",
      params: { field: "listedKey" },
    });
  });

  it("returns a key inside the prefix that no other call accepts, for the caller's naming rules to judge", async () => {
    const bucket = await bucketWith({
      answer: answeringPages([
        entry("archives/v1/", "<Size>0</Size>") + entry("archives/v1/a.enc"),
      ]),
    });
    expect((await storeFor(bucket).list("archives/v1/", live())).map((found) => found.key)).toEqual(
      ["archives/v1/", "archives/v1/a.enc"],
    );
  });

  it("refuses a listing that offers a continuation token it already gave", async () => {
    const bucket = await bucketWith({
      answer: answeringPages([entry("a/1") + more("t1"), entry("a/2") + more("t1")]),
    });
    expect(await outcome(storeFor(bucket).list("a/", live()))).toEqual({
      code: "backup.destination_request_failed",
      params: { operation: "list", key: "a/", status: 200, name: "RepeatedContinuationToken" },
    });
    expect(bucket.seen).toHaveLength(2);
  });

  it("refuses the whole listing when a key appears on two pages", async () => {
    const bucket = await bucketWith({
      answer: answeringPages([
        entry("a/1") + more("t1"),
        entry("a/1") + "<IsTruncated>false</IsTruncated>",
      ]),
    });
    expect(await outcome(storeFor(bucket).list("a/", live()))).toEqual({
      code: "backup.destination_request_failed",
      params: { operation: "list", key: "a/", status: 200, name: "RepeatedKey" },
    });
    expect(bucket.seen).toHaveLength(2);
  });

  it("refuses an entry whose size is negative", async () => {
    const bucket = await bucketWith({
      answer: answeringPages([entry("a/1") + entry("a/2", "<Size>-1</Size>")]),
    });
    expect(await outcome(storeFor(bucket).list("a/", live()))).toEqual({
      code: "backup.destination_request_failed",
      params: { operation: "list", key: "a/", status: 200, name: "InvalidSize" },
    });
  });

  it("refuses a truncated page with no continuation token", async () => {
    const bucket = await bucketWith({
      answer: answeringPages([entry("a/1") + "<IsTruncated>true</IsTruncated>"]),
    });
    expect(await outcome(storeFor(bucket).list("a/", live()))).toEqual({
      code: "backup.destination_request_failed",
      params: { operation: "list", key: "a/", status: 200, name: "MissingContinuationToken" },
    });
  });

  it("refuses an entry without its size", async () => {
    const bucket = await bucketWith({ answer: answeringPages([entry("a/1", "")]) });
    expect(await outcome(storeFor(bucket).list("a/", live()))).toEqual({
      code: "backup.destination_request_failed",
      params: { operation: "list", key: "a/", status: 200, name: "IncompleteListing" },
    });
  });

  it("refuses a page the bucket refuses", async () => {
    const bucket = await bucketWith({
      answer: (_seen, _request, response) => {
        response.writeHead(403, xml);
        response.end(errorXml("AccessDenied"));
        return true;
      },
    });
    expect(await outcome(storeFor(bucket).list("a/", live()))).toEqual({
      code: "backup.destination_request_failed",
      params: { operation: "list", key: "a/", status: 403, name: "AccessDenied" },
    });
  });

  it("asks for no page after its signal is cancelled", async () => {
    const controller = new AbortController();
    let pages = 0;
    const bucket = await bucketWith({
      answer: (_seen, _request, response) => {
        pages += 1;
        if (pages === 2) controller.abort();
        response.writeHead(200, xml);
        response.end(
          `<ListBucketResult>${entry(`a/${pages}`)}${more(`t${pages}`)}</ListBucketResult>`,
        );
        return true;
      },
    });
    expect(await outcome(storeFor(bucket).list("a/", controller))).toEqual({
      code: "backup.destination_request_failed",
      params: { operation: "list", key: "a/", status: null, name: "AbortError" },
    });
    expect(bucket.seen).toHaveLength(2);
  });
});

describe("a delete of several keys", () => {
  const keys = Array.from({ length: 1_005 }, (_, i) => `archives/k${i}.enc`);
  const keysIn = (body: Buffer) => [...body.toString().matchAll(/<Key>/g)].length;

  it("sends 1,005 keys as batches of 1,000 and 5 under the configured prefix", async () => {
    const bucket = await bucketWith({ prefix: "root" });
    for (const key of keys) put(bucket, `root/${key}`);
    put(bucket, "root/archives/kept.enc");
    await storeFor(bucket).deleteMany(keys, live());
    expect(bucket.seen.map((seen) => keysIn(seen.body!))).toEqual([1000, 5]);
    expect([...bucket.objects.keys()]).toEqual(["root/archives/kept.enc"]);
  });

  it("of no keys sends nothing", async () => {
    const bucket = await bucketWith();
    await storeFor(bucket).deleteMany([], live());
    expect(bucket.seen).toEqual([]);
  });

  it("fails on a key the bucket names in an otherwise successful answer, and sends no further batch", async () => {
    const bucket = await bucketWith({
      answer: (_seen, _request, response) => {
        response.writeHead(200, xml);
        response.end(
          "<DeleteResult><Error><Key>archives/k7.enc</Key><Code>AccessDenied</Code>" +
            "<Message>no</Message></Error></DeleteResult>",
        );
        return true;
      },
    });
    expect(await outcome(storeFor(bucket).deleteMany(keys, live()))).toEqual({
      code: "backup.destination_request_failed",
      params: { operation: "delete", key: "archives/k7.enc", status: 200, name: "AccessDenied" },
    });
    expect(bucket.seen).toHaveLength(1);
  });

  it("counts a key the batch answer names NoSuchKey as already deleted", async () => {
    const bucket = await bucketWith({
      answer: (_seen, _request, response) => {
        response.writeHead(200, xml);
        response.end(
          "<DeleteResult><Error><Key>a</Key><Code>NoSuchKey</Code></Error>" +
            "<Error><Key>b</Key><Code>AccessDenied</Code></Error></DeleteResult>",
        );
        return true;
      },
    });
    expect(await outcome(storeFor(bucket).deleteMany(["a", "b"], live()))).toEqual({
      code: "backup.destination_request_failed",
      params: { operation: "delete", key: "b", status: 200, name: "AccessDenied" },
    });
  });

  it("fails on a refusal that names no key it sent", async () => {
    const bucket = await bucketWith({
      answer: (_seen, _request, response) => {
        response.writeHead(200, xml);
        response.end(
          "<DeleteResult><Error><Key>elsewhere</Key><Code>AccessDenied</Code></Error></DeleteResult>",
        );
        return true;
      },
    });
    expect(await outcome(storeFor(bucket).deleteMany(["a", "b"], live()))).toEqual({
      code: "backup.destination_request_failed",
      params: { operation: "delete", key: "a", status: 200, name: "IncompleteDeleteResult" },
    });
  });

  it("fails on a refusal that gives no code", async () => {
    const bucket = await bucketWith({
      answer: (_seen, _request, response) => {
        response.writeHead(200, xml);
        response.end("<DeleteResult><Error><Key>b</Key></Error></DeleteResult>");
        return true;
      },
    });
    expect(await outcome(storeFor(bucket).deleteMany(["a", "b"], live()))).toEqual({
      code: "backup.destination_request_failed",
      params: { operation: "delete", key: "b", status: 200, name: "IncompleteDeleteResult" },
    });
  });

  it("fails when the bucket refuses the batch", async () => {
    const bucket = await bucketWith({
      answer: (_seen, _request, response) => {
        response.writeHead(403, xml);
        response.end(errorXml("AccessDenied"));
        return true;
      },
    });
    expect(await outcome(storeFor(bucket).deleteMany(["a", "b"], live()))).toEqual({
      code: "backup.destination_request_failed",
      params: { operation: "delete", key: "a", status: 403, name: "AccessDenied" },
    });
  });

  it("deletes one key at a time where the bucket has no batch delete", async () => {
    const bucket = await bucketWith({
      answer: (seen, _request, response) => {
        if (seen.kind !== "deleteMany") return false;
        response.writeHead(501, xml);
        response.end(errorXml("NotImplemented"));
        return true;
      },
    });
    for (const key of ["a", "b", "c", "kept"]) put(bucket, key);
    await storeFor(bucket).deleteMany(["a", "b", "c"], live());
    expect(
      bucket.seen
        .filter((seen) => seen.kind === "delete")
        .map((seen) => seen.key)
        .sort(),
    ).toEqual(["a", "b", "c"]);
    expect([...bucket.objects.keys()]).toEqual(["kept"]);
  });

  it("one key at a time counts a key the bucket answers NoSuchKey as already deleted", async () => {
    const bucket = await bucketWith({
      answer: (seen, _request, response) => {
        if (seen.kind === "deleteMany") response.writeHead(501, xml);
        else if (seen.key === "b") response.writeHead(404, xml);
        else return false;
        response.end(errorXml(seen.kind === "deleteMany" ? "NotImplemented" : "NoSuchKey"));
        return true;
      },
    });
    for (const key of ["a", "c", "kept"]) put(bucket, key);
    expect(await outcome(storeFor(bucket).deleteMany(["a", "b", "c"], live()))).toBe("resolved");
    expect([...bucket.objects.keys()]).toEqual(["kept"]);
  });

  it("one key at a time fails on the first key refused", async () => {
    const bucket = await bucketWith({
      answer: (seen, _request, response) => {
        if (seen.kind === "deleteMany") response.writeHead(501, xml);
        else if (seen.key === "b") response.writeHead(403, xml);
        else return false;
        response.end(errorXml(seen.kind === "deleteMany" ? "NotImplemented" : "AccessDenied"));
        return true;
      },
    });
    expect(await outcome(storeFor(bucket).deleteMany(["a", "b", "c"], live()))).toEqual({
      code: "backup.destination_request_failed",
      params: { operation: "delete", key: "b", status: 403, name: "AccessDenied" },
    });
  });

  it("starts no second batch once cancelled during the first", async () => {
    const controller = new AbortController();
    const bucket = await bucketWith({ onRequest: () => controller.abort() });
    expect(await outcome(storeFor(bucket).deleteMany(keys, controller))).toEqual({
      code: "backup.destination_request_failed",
      params: { operation: "delete", key: "archives/k0.enc", status: null, name: "AbortError" },
    });
    expect(bucket.seen).toHaveLength(1);
  });

  it("one key at a time starts no further delete once cancelled", async () => {
    const controller = new AbortController();
    let singles = 0;
    const bucket = await bucketWith({
      answer: (seen, _request, response) => {
        if (seen.kind === "deleteMany") {
          response.writeHead(501, xml);
          response.end(errorXml("NotImplemented"));
          return true;
        }
        singles += 1;
        if (singles === DELETE_CONCURRENCY) controller.abort();
        // Answers each delete later, so a store that ignores the cancellation goes on to the rest.
        setTimeout(() => bucket.answerAsS3(seen, response), 100);
        return true;
      },
    });
    const many = Array.from({ length: 50 }, (_, i) => `k${i}`);
    expect(await outcome(storeFor(bucket).deleteMany(many, controller))).toEqual({
      code: "backup.destination_request_failed",
      params: { operation: "delete", key: "k0", status: null, name: "AbortError" },
    });
    await delay(300);
    expect(singles).toBe(DELETE_CONCURRENCY);
  });
});

describe("over a transport that ignores the signal", () => {
  it("a read whose answer arrives after the cancellation destroys that answer's body", async () => {
    const body = new Readable({ read() {} });
    const controller = new AbortController();
    const handler = {
      async handle() {
        controller.abort();
        return { response: { statusCode: 200, headers: { etag: '"v1"' }, body } };
      },
    };
    const store = createS3FileStore(
      {
        endpoint: "https://s3.example.test",
        region: "us-east-1",
        bucket: "owner-bucket",
        prefix: "",
        accessKeyId: "AKIAEXAMPLE0000",
        secretAccessKey: "not-a-real-secret",
      },
      { requestHandler: handler },
    );
    cleanups.push(async () => store.close());
    expect(await outcome(store.readStream("a.enc", controller))).toEqual({
      code: "backup.destination_request_failed",
      params: { operation: "get", key: "a.enc", status: null, name: "AbortError" },
    });
    await expect.poll(() => body.destroyed).toBe(true);
  });
});
