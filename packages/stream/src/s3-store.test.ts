import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import { CONFLICT_ATTEMPTS, DELETE_CONCURRENCY, createS3ObjectStore } from "./s3-store.js";
import type { BucketConfig } from "./s3-store.js";

type SentRequest = {
  method: string;
  protocol: string;
  hostname: string;
  port?: number;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body?: string;
};
type Scripted =
  | {
      status: number;
      headers?: Record<string, string>;
      body?: string;
      /** The connection drops with this message after the body's first chunk. */
      breaksAfterFirstChunk?: string;
    }
  | { throws: string };

const xml = { "content-type": "application/xml" };
function errorBody(code: string, message: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${message}</Message></Error>`;
}
const PRECONDITION: Scripted = {
  status: 412,
  headers: xml,
  body: errorBody(
    "PreconditionFailed",
    "At least one of the pre-conditions you specified did not hold",
  ),
};
const CONFLICT: Scripted = {
  status: 409,
  headers: xml,
  body: errorBody(
    "ConditionalRequestConflict",
    "A conflicting conditional operation is currently in progress against this resource.",
  ),
};
const PUT_OK: Scripted = { status: 200, headers: { etag: '"v2"' } };

function bodyStream(text: string, breaks: string | undefined): Readable {
  if (breaks === undefined) return Readable.from([Buffer.from(text)]);
  let started = false;
  return new Readable({
    read() {
      if (started) {
        this.destroy(Object.assign(new Error(breaks), { code: "ECONNRESET" }));
        return;
      }
      started = true;
      this.push(Buffer.from(text));
    },
  });
}

/**
 * The network, scripted. The real client builds, signs and sends each request; this answers in turn.
 * The response shape — a status, headers and a Node stream body — is the one the pinned client
 * accepted in a run on 2026-09-23 (@aws-sdk/client-s3 3.1136.0).
 */
function network(responses: Scripted[]) {
  const sent: SentRequest[] = [];
  const handler = {
    async handle(request: SentRequest & { body?: unknown }) {
      sent.push({
        ...request,
        headers: { ...request.headers },
        query: { ...request.query },
        body: typeof request.body === "string" ? request.body : undefined,
      });
      const next = responses.shift();
      if (next === undefined)
        throw new Error(`no scripted response for ${request.method} ${request.path}`);
      if ("throws" in next) throw Object.assign(new Error(next.throws), { code: "ECONNREFUSED" });
      return {
        response: {
          statusCode: next.status,
          headers: next.headers ?? {},
          body: bodyStream(next.body ?? "", next.breaksAfterFirstChunk),
        },
      };
    },
  };
  return { handler, sent };
}

const CONFIG: BucketConfig = {
  endpoint: "https://s3.example.test",
  region: "us-east-1",
  bucket: "owner-bucket",
  prefix: "waitron",
  accessKeyId: "AKIAEXAMPLE0000",
  secretAccessKey: "not-a-real-secret",
};
const BYTES = new TextEncoder().encode("{}");

function storeOver(responses: Scripted[], config: BucketConfig = CONFIG) {
  const net = network(responses);
  const waits: number[] = [];
  const store = createS3ObjectStore(config, {
    requestHandler: net.handler,
    sleep: async (ms) => {
      waits.push(ms);
    },
  });
  return { store, sent: net.sent, waits };
}

async function rejection(promise: Promise<unknown>): Promise<{ code: string; params: unknown }> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return { code: error.code, params: error.params };
    throw error;
  }
  throw new Error("expected a rejection");
}

describe("put — the conditions go on the wire", () => {
  it("sends 'only if unchanged' as If-Match carrying the version the caller read", async () => {
    const { store, sent } = storeOver([PUT_OK]);
    await expect(store.put("venues/v1/current.json", BYTES, { ifMatch: '"v1"' })).resolves.toEqual({
      etag: '"v2"',
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.method).toBe("PUT");
    expect(sent[0]!.path).toBe("/owner-bucket/waitron/venues/v1/current.json");
    expect(sent[0]!.headers["if-match"]).toBe('"v1"');
    expect(sent[0]!.headers["if-none-match"]).toBeUndefined();
  });

  it("sends 'only if absent' as If-None-Match: *", async () => {
    const { store, sent } = storeOver([PUT_OK]);
    await store.put("k", BYTES, { ifNoneMatch: "*" });
    expect(sent[0]!.headers["if-none-match"]).toBe("*");
    expect(sent[0]!.headers["if-match"]).toBeUndefined();
  });

  it("sends neither when no condition is asked for", async () => {
    const { store, sent } = storeOver([PUT_OK]);
    await store.put("k", BYTES);
    expect(sent[0]!.headers["if-match"]).toBeUndefined();
    expect(sent[0]!.headers["if-none-match"]).toBeUndefined();
  });
});

describe("put — 412 is a loss, 409 is a retry", () => {
  it("throws a 412 at once as backup.stream_precondition_failed, without retrying", async () => {
    const { store, sent, waits } = storeOver([PRECONDITION]);
    expect(
      await rejection(store.put("venues/v1/current.json", BYTES, { ifMatch: '"v1"' })),
    ).toEqual({
      code: "backup.stream_precondition_failed",
      params: { key: "venues/v1/current.json" },
    });
    expect(sent).toHaveLength(1);
    expect(waits).toEqual([]);
  });

  it("retries a 409 with the SAME condition, and succeeds when the conflict clears", async () => {
    const { store, sent, waits } = storeOver([CONFLICT, CONFLICT, PUT_OK]);
    await expect(store.put("k", BYTES, { ifMatch: '"v1"' })).resolves.toEqual({ etag: '"v2"' });
    expect(sent).toHaveLength(3);
    expect(sent.map((request) => request.headers["if-match"])).toEqual(['"v1"', '"v1"', '"v1"']);
    expect(waits).toEqual([200, 400]);
  });

  it("waits for real between conflict retries when no wait is supplied", async () => {
    const net = network([CONFLICT, PUT_OK]);
    const store = createS3ObjectStore(CONFIG, { requestHandler: net.handler });
    const started = Date.now();
    await expect(store.put("k", BYTES, { ifNoneMatch: "*" })).resolves.toEqual({ etag: '"v2"' });
    expect(Date.now() - started).toBeGreaterThanOrEqual(150);
    expect(net.sent).toHaveLength(2);
  });

  it("a 409 answered by a 412 on retry is a loss", async () => {
    const { store } = storeOver([CONFLICT, PRECONDITION]);
    expect((await rejection(store.put("k", BYTES, { ifMatch: '"v1"' }))).code).toBe(
      "backup.stream_precondition_failed",
    );
  });

  it("a 409 that never clears ends as a request failure, never as a loss", async () => {
    const { store, sent } = storeOver(Array.from({ length: CONFLICT_ATTEMPTS }, () => CONFLICT));
    expect(await rejection(store.put("k", BYTES, { ifNoneMatch: "*" }))).toEqual({
      code: "backup.stream_request_failed",
      params: { operation: "put", key: "k", status: 409, name: "ConditionalRequestConflict" },
    });
    expect(sent).toHaveLength(CONFLICT_ATTEMPTS);
  });

  it("any other refusal is a request failure naming the store's answer", async () => {
    const { store } = storeOver([
      { status: 403, headers: xml, body: errorBody("AccessDenied", "Access Denied") },
    ]);
    expect(await rejection(store.put("k", BYTES))).toEqual({
      code: "backup.stream_request_failed",
      params: { operation: "put", key: "k", status: 403, name: "AccessDenied" },
    });
  });

  it("a success with no version tag is a request failure, because the next conditional write needs one", async () => {
    const { store } = storeOver([{ status: 200 }]);
    expect(await rejection(store.put("k", BYTES))).toEqual({
      code: "backup.stream_request_failed",
      params: { operation: "put", key: "k", status: 200, name: "MissingETag" },
    });
  });
});

describe("get", () => {
  it("reads the body and its version tag", async () => {
    const { store, sent } = storeOver([{ status: 200, headers: { etag: '"e1"' }, body: "hello" }]);
    const got = await store.get("venues/v1/current.json");
    expect(got?.etag).toBe('"e1"');
    expect(new TextDecoder().decode(got?.body)).toBe("hello");
    expect(sent[0]!.method).toBe("GET");
    expect(sent[0]!.path).toBe("/owner-bucket/waitron/venues/v1/current.json");
  });

  it("a connection that drops partway through the body is a request failure with no status", async () => {
    const response = { status: 200, headers: { etag: '"e1"' }, body: "hel" };
    const whole = storeOver([response]);
    expect(new TextDecoder().decode((await whole.store.get("k"))?.body)).toBe("hel");
    const broken = storeOver([{ ...response, breaksAfterFirstChunk: "read ECONNRESET" }]);
    expect(await rejection(broken.store.get("k"))).toEqual({
      code: "backup.stream_request_failed",
      params: { operation: "get", key: "k", status: null, name: "Error" },
    });
  });

  it("answers null for a missing KEY", async () => {
    const { store } = storeOver([
      {
        status: 404,
        headers: xml,
        body: errorBody("NoSuchKey", "The specified key does not exist."),
      },
    ]);
    await expect(store.get("absent")).resolves.toBeNull();
  });

  it("does not read a missing BUCKET as a missing key, though both answer 404", async () => {
    const { store } = storeOver([
      {
        status: 404,
        headers: xml,
        body: errorBody("NoSuchBucket", "The specified bucket does not exist"),
      },
    ]);
    expect(await rejection(store.get("k"))).toEqual({
      code: "backup.stream_request_failed",
      params: { operation: "get", key: "k", status: 404, name: "NoSuchBucket" },
    });
  });

  it("a body with no version tag is a request failure", async () => {
    const { store } = storeOver([{ status: 200, body: "hello" }]);
    expect(await rejection(store.get("k"))).toEqual({
      code: "backup.stream_request_failed",
      params: { operation: "get", key: "k", status: 200, name: "IncompleteResponse" },
    });
  });

  it("no answer at all is a request failure with no status", async () => {
    // The client retries a refused connection itself (three calls were measured on 2026-09-23).
    const { store } = storeOver([
      { throws: "connect ECONNREFUSED" },
      { throws: "connect ECONNREFUSED" },
      { throws: "connect ECONNREFUSED" },
    ]);
    const failure = await rejection(store.get("k"));
    expect(failure.code).toBe("backup.stream_request_failed");
    expect(failure.params).toMatchObject({ operation: "get", key: "k", status: null });
  });
});

describe("list", () => {
  it("follows continuation tokens and answers keys relative to the configured prefix", async () => {
    const page = (keys: string[], next?: string) =>
      `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>owner-bucket</Name>` +
      `<IsTruncated>${next ? "true" : "false"}</IsTruncated>${next ? `<NextContinuationToken>${next}</NextContinuationToken>` : ""}` +
      keys
        .map(
          (key) =>
            `<Contents><Key>${key}</Key><LastModified>2026-09-23T10:00:00.000Z</LastModified></Contents>`,
        )
        .join("") +
      `</ListBucketResult>`;
    const { store, sent } = storeOver([
      { status: 200, headers: xml, body: page(["waitron/venues/v1/a"], "t2") },
      { status: 200, headers: xml, body: page(["waitron/venues/v1/b"]) },
    ]);
    await expect(store.list("venues/v1/")).resolves.toEqual([
      { key: "venues/v1/a", lastModified: new Date("2026-09-23T10:00:00.000Z") },
      { key: "venues/v1/b", lastModified: new Date("2026-09-23T10:00:00.000Z") },
    ]);
    expect(sent.map((request) => request.query)).toEqual([
      { "list-type": "2", prefix: "waitron/venues/v1/" },
      { "list-type": "2", prefix: "waitron/venues/v1/", "continuation-token": "t2" },
    ]);
  });

  it("answers an empty list for a prefix that holds nothing", async () => {
    const body =
      `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>owner-bucket</Name>` +
      `<KeyCount>0</KeyCount><IsTruncated>false</IsTruncated></ListBucketResult>`;
    const { store, sent } = storeOver([{ status: 200, headers: xml, body }]);
    await expect(store.list("venues/v1/")).resolves.toEqual([]);
    expect(sent).toHaveLength(1);
  });

  const listing = (contents: string, tail = "<IsTruncated>false</IsTruncated>") =>
    `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult>${tail}${contents}</ListBucketResult>`;
  const entry = (key: string) =>
    `<Contents><Key>${key}</Key><LastModified>2026-09-23T10:00:00.000Z</LastModified></Contents>`;
  const refusal = (name: string) => ({
    code: "backup.stream_request_failed",
    params: { operation: "list", key: "venues/v1/", status: 200, name },
  });

  it.each([
    ["another folder under the configured root", "waitron/venues/v2/a"],
    ["a key outside the configured root", "elsewhere/venues/v1/a"],
    ["a key that only shares the prefix's first characters", "waitron/venues/v1"],
  ])(
    "refuses a listing that names %s, as a bad name rather than a failed request",
    async (_, key) => {
      const { store } = storeOver([
        { status: 200, headers: xml, body: listing(entry("waitron/venues/v1/a") + entry(key)) },
      ]);
      expect(await rejection(store.list("venues/v1/"))).toEqual({
        code: "backup.stream_name_invalid",
        params: { field: "listedKey", value: key },
      });
    },
  );

  it.each([
    ["no time", "<Contents><Key>waitron/venues/v1/a</Key></Contents>"],
    ["no key", "<Contents><LastModified>2026-09-23T10:00:00.000Z</LastModified></Contents>"],
  ])(
    "refuses a listing with an entry that has %s, rather than answering without it",
    async (_, contents) => {
      const { store } = storeOver([{ status: 200, headers: xml, body: listing(contents) }]);
      expect(await rejection(store.list("venues/v1/"))).toEqual(refusal("IncompleteListing"));
    },
  );

  it("refuses a page that says more follow but gives no token to fetch them", async () => {
    const { store, sent } = storeOver([
      {
        status: 200,
        headers: xml,
        body: listing(entry("waitron/venues/v1/a"), "<IsTruncated>true</IsTruncated>"),
      },
    ]);
    expect(await rejection(store.list("venues/v1/"))).toEqual(refusal("MissingContinuationToken"));
    expect(sent).toHaveLength(1);
  });

  it("refuses a continuation token it has already followed, rather than asking again", async () => {
    const again = listing(
      entry("waitron/venues/v1/a"),
      "<IsTruncated>true</IsTruncated><NextContinuationToken>t1</NextContinuationToken>",
    );
    const { store, sent } = storeOver([
      { status: 200, headers: xml, body: again },
      { status: 200, headers: xml, body: again },
      { status: 200, headers: xml, body: again },
    ]);
    expect(await rejection(store.list("venues/v1/"))).toEqual(refusal("RepeatedContinuationToken"));
    expect(sent).toHaveLength(2);
  });

  it("a refused listing is a request failure", async () => {
    const { store } = storeOver([
      { status: 403, headers: xml, body: errorBody("AccessDenied", "Access Denied") },
    ]);
    expect(await rejection(store.list("venues/"))).toEqual({
      code: "backup.stream_request_failed",
      params: { operation: "list", key: "venues/", status: 403, name: "AccessDenied" },
    });
  });
});

describe("delete", () => {
  it("deletes under the configured prefix", async () => {
    const { store, sent } = storeOver([{ status: 204 }]);
    await expect(store.delete("venues/v1/x")).resolves.toBeUndefined();
    expect(sent[0]!.method).toBe("DELETE");
    expect(sent[0]!.path).toBe("/owner-bucket/waitron/venues/v1/x");
  });

  it("a refused delete is a request failure", async () => {
    const { store } = storeOver([
      { status: 403, headers: xml, body: errorBody("AccessDenied", "Access Denied") },
    ]);
    expect((await rejection(store.delete("k"))).params).toEqual({
      operation: "delete",
      key: "k",
      status: 403,
      name: "AccessDenied",
    });
  });
});

describe("deleteMany — S3's multi-object delete", () => {
  const keysIn = (body: string | undefined) =>
    [...(body ?? "").matchAll(/<Key>([^<]*)<\/Key>/g)].map((match) => match[1]);
  const DELETED: Scripted = {
    status: 200,
    headers: xml,
    body: '<?xml version="1.0" encoding="UTF-8"?><DeleteResult></DeleteResult>',
  };
  function perKeyErrors(errors: { key: string; code: string }[]): Scripted {
    const inner = errors
      .map((e) => `<Error><Key>${e.key}</Key><Code>${e.code}</Code><Message>no</Message></Error>`)
      .join("");
    return {
      status: 200,
      headers: xml,
      body: `<?xml version="1.0" encoding="UTF-8"?><DeleteResult>${inner}</DeleteResult>`,
    };
  }
  const NOT_IMPLEMENTED: Scripted = {
    status: 501,
    headers: xml,
    body: errorBody(
      "NotImplemented",
      "A header you provided implies functionality that is not implemented",
    ),
  };

  it("sends nothing for no keys", async () => {
    const { store, sent } = storeOver([]);
    await expect(store.deleteMany([])).resolves.toBeUndefined();
    expect(sent).toEqual([]);
  });

  it("sends one quiet POST ?delete per 1000 keys, under the prefix, with the checksum AWS requires", async () => {
    const keys = Array.from({ length: 2500 }, (_, i) => `venues/v1/g/${i}.ltx`);
    const { store, sent } = storeOver([DELETED, DELETED, DELETED]);
    await expect(store.deleteMany(keys)).resolves.toBeUndefined();
    expect(sent.map((request) => request.method)).toEqual(["POST", "POST", "POST"]);
    expect(sent.every((request) => "delete" in request.query)).toBe(true);
    expect(sent.every((request) => request.path === "/owner-bucket/")).toBe(true);
    expect(sent.map((request) => keysIn(request.body).length)).toEqual([1000, 1000, 500]);
    expect(sent.flatMap((request) => keysIn(request.body))).toEqual(
      keys.map((key) => `waitron/${key}`),
    );
    expect(sent.every((request) => /<Quiet>true<\/Quiet>/.test(request.body ?? ""))).toBe(true);
    // Measured 2026-09-24: @aws-sdk/client-s3 3.1136.0 sends a CRC32 checksum, not Content-MD5.
    for (const request of sent) {
      expect(
        request.headers["x-amz-checksum-crc32"] ?? request.headers["content-md5"],
      ).toBeDefined();
    }
  });

  it("rejects when the answer names a key it did not delete, naming that key", async () => {
    const { store } = storeOver([
      perKeyErrors([{ key: "waitron/venues/v1/g/b.ltx", code: "AccessDenied" }]),
    ]);
    expect(await rejection(store.deleteMany(["venues/v1/g/a.ltx", "venues/v1/g/b.ltx"]))).toEqual({
      code: "backup.stream_request_failed",
      params: { operation: "delete", key: "venues/v1/g/b.ltx", status: 200, name: "AccessDenied" },
    });
  });

  it("names the refused key as the answer gave it, or the batch's first when it gave none", async () => {
    const bare: Scripted = {
      status: 200,
      headers: xml,
      body: '<?xml version="1.0" encoding="UTF-8"?><DeleteResult><Error></Error></DeleteResult>',
    };
    const { store } = storeOver([
      perKeyErrors([{ key: "elsewhere/x", code: "AccessDenied" }]),
      bare,
    ]);
    expect((await rejection(store.deleteMany(["a"]))).params).toMatchObject({
      key: "elsewhere/x",
    });
    expect((await rejection(store.deleteMany(["a", "b"]))).params).toEqual({
      operation: "delete",
      key: "a",
      status: 200,
      name: "Unknown",
    });
  });

  it("sends no further batch once one has failed", async () => {
    const keys = Array.from({ length: 2500 }, (_, i) => `k${i}`);
    const { store, sent } = storeOver([
      { status: 403, headers: xml, body: errorBody("AccessDenied", "Access Denied") },
      DELETED,
      DELETED,
    ]);
    expect(await rejection(store.deleteMany(keys))).toEqual({
      code: "backup.stream_request_failed",
      params: { operation: "delete", key: "k0", status: 403, name: "AccessDenied" },
    });
    expect(sent).toHaveLength(1);
  });

  it("a batch with no answer at all is reported with no status", async () => {
    const { store } = storeOver([{ throws: "connect ECONNREFUSED" }]);
    expect((await rejection(store.deleteMany(["a", "b"]))).params).toMatchObject({
      operation: "delete",
      key: "a",
      status: null,
    });
  });

  it("falls back to one DELETE per key when the store answers the batch 501", async () => {
    const { store, sent } = storeOver([NOT_IMPLEMENTED, { status: 204 }, { status: 204 }]);
    await expect(store.deleteMany(["a", "b"])).resolves.toBeUndefined();
    expect(sent.map((request) => `${request.method} ${request.path}`)).toEqual([
      "POST /owner-bucket/",
      "DELETE /owner-bucket/waitron/a",
      "DELETE /owner-bucket/waitron/b",
    ]);
  });

  it("does not fall back on any other refusal of the batch", async () => {
    const { store, sent } = storeOver([
      { status: 400, headers: xml, body: errorBody("MalformedXML", "bad") },
    ]);
    expect((await rejection(store.deleteMany(["a"]))).params).toMatchObject({
      status: 400,
      name: "MalformedXML",
    });
    expect(sent).toHaveLength(1);
  });
});

describe("deleteMany — one DELETE per key, where the batch is not implemented", () => {
  /** A 501 for every batch, then each single DELETE held until the test releases it. */
  function heldNetwork(failKey?: string) {
    let inFlight = 0;
    let most = 0;
    let started = 0;
    let finished = 0;
    const handler = {
      async handle(request: SentRequest) {
        if (request.method === "POST") {
          return {
            response: {
              statusCode: 501,
              headers: xml,
              body: bodyStream(errorBody("NotImplemented", "not implemented"), undefined),
            },
          };
        }
        started += 1;
        inFlight += 1;
        most = Math.max(most, inFlight);
        await new Promise((resolve) => setImmediate(resolve));
        await new Promise((resolve) => setImmediate(resolve));
        inFlight -= 1;
        const refused = failKey !== undefined && request.path.endsWith(`/${failKey}`);
        if (!refused) finished += 1;
        return {
          response: refused
            ? {
                statusCode: 403,
                headers: xml,
                body: bodyStream(errorBody("AccessDenied", "Access Denied"), undefined),
              }
            : { statusCode: 204, headers: {}, body: bodyStream("", undefined) },
        };
      },
    };
    const store = createS3ObjectStore(CONFIG, { requestHandler: handler });
    return { store, stats: () => ({ most, started, finished }) };
  }

  it(`keeps at most ${DELETE_CONCURRENCY} deletes in flight`, async () => {
    const { store, stats } = heldNetwork();
    await store.deleteMany(Array.from({ length: 50 }, (_, i) => `k${i}`));
    expect(stats()).toEqual({ most: DELETE_CONCURRENCY, started: 50, finished: 50 });
  });

  it("starts no further deletes once one has failed, and none after it has answered", async () => {
    const { store, stats } = heldNetwork("k0");
    expect(
      (await rejection(store.deleteMany(Array.from({ length: 50 }, (_, i) => `k${i}`)))).params,
    ).toEqual({
      operation: "delete",
      key: "k0",
      status: 403,
      name: "AccessDenied",
    });
    const atAnswer = stats();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(stats()).toEqual(atAnswer);
    expect(atAnswer.started).toBeLessThanOrEqual(DELETE_CONCURRENCY);
    // Those already sent when k0 failed were answered before the rejection.
    expect(atAnswer.finished).toBe(atAnswer.started - 1);
  });
});

describe("addressing", () => {
  it("uses Amazon's own address, bucket in the host name, when no endpoint is given", async () => {
    const amazon: BucketConfig = {
      region: "eu-south-2",
      bucket: "owner-bucket",
      prefix: "waitron",
      accessKeyId: "AKIAEXAMPLE0000",
      secretAccessKey: "not-a-real-secret",
    };
    const { store, sent } = storeOver([PUT_OK], amazon);
    await store.put("venues/v1/current.json", BYTES);
    expect(sent[0]!.hostname).toBe("owner-bucket.s3.eu-south-2.amazonaws.com");
    expect(sent[0]!.path).toBe("/waitron/venues/v1/current.json");
  });

  it("puts the bucket in the path for any other endpoint, as Litestream does when an endpoint is set", async () => {
    const { store, sent } = storeOver([PUT_OK], {
      ...CONFIG,
      endpoint: "https://s3.example.test:9000",
    });
    await store.put("k", BYTES);
    expect(sent[0]!.hostname).toBe("s3.example.test");
    expect(sent[0]!.port).toBe(9000);
    expect(sent[0]!.path).toBe("/owner-bucket/waitron/k");
  });
});
