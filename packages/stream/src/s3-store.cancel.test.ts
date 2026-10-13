import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@waitron/shared";
import type { BucketOperation } from "./errors.js";
import type { ObjectStore, StoreCall } from "./object-store.js";
import { DELETE_CONCURRENCY, createS3ObjectStore } from "./s3-store.js";
import { abortableSleep } from "./store-call.js";
import type { BucketConfig, S3ObjectStoreOptions } from "./s3-store.js";

// The real client over a real loopback connection, so a closed connection is seen by the far end.

type Answer = (request: IncomingMessage, response: ServerResponse, body: string) => void;

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

async function bucket(answer: Answer): Promise<BucketConfig> {
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => answer(request, response, Buffer.concat(chunks).toString()));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closers.push(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  const { port } = server.address() as AddressInfo;
  return {
    endpoint: `http://127.0.0.1:${port}`,
    region: "us-east-1",
    bucket: "owner-bucket",
    prefix: "",
    accessKeyId: "AKIAEXAMPLE0000",
    secretAccessKey: "not-a-real-secret",
  };
}

function signalled(): { resolve: () => void; promise: Promise<void> } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { resolve, promise };
}

/** How the call ended, or "still pending" when it had not within `ms`. */
async function outcome(call: Promise<unknown>, ms = 2_000): Promise<unknown> {
  const ended = call.then(
    () => "resolved",
    (error: unknown) =>
      error instanceof AppError ? { code: error.code, params: error.params } : error,
  );
  return Promise.race([ended, delay(ms, "still pending")]);
}

const cancelled = (operation: BucketOperation, key: string) => ({
  code: "backup.stream_request_failed",
  params: { operation, key, status: null, name: "AbortError" },
});

const xml = { "content-type": "application/xml" };
const BYTES = new TextEncoder().encode("{}");
const EMPTY_DELETE_RESULT = '<?xml version="1.0" encoding="UTF-8"?><DeleteResult></DeleteResult>';
const errorBody = (code: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>no</Message></Error>`;

const calls: [
  string,
  (store: ObjectStore, call: StoreCall) => Promise<unknown>,
  BucketOperation,
  string,
][] = [
  ["get", (store, call) => store.get("k", call), "get", "k"],
  ["put", (store, call) => store.put("k", BYTES, undefined, call), "put", "k"],
  ["list", (store, call) => store.list("venues/", call), "list", "venues/"],
  ["delete", (store, call) => store.delete("k", call), "delete", "k"],
  ["deleteMany", (store, call) => store.deleteMany(["k1", "k2"], call), "delete", "k1"],
];

describe("a read cancelled after its headers have arrived", () => {
  it("on the production handler, stops a body that stalls and closes its connection", async () => {
    const observed = { closed: false };
    const headersSent = signalled();
    const config = await bucket((request, response) => {
      request.socket.once("close", () => (observed.closed = true));
      response.writeHead(200, { etag: '"v1"', "content-length": "1000" });
      response.write("the first part");
      headersSent.resolve();
    });
    // No idleMs and no requestHandler: the handler the box itself runs, with its 30 s limit.
    const store = createS3ObjectStore(config);
    const controller = new AbortController();
    const call = outcome(store.get("k", { signal: controller.signal }));
    await headersSent.promise;
    await delay(100);
    controller.abort();
    expect(await call).toEqual(cancelled("get", "k"));
    await vi.waitFor(() => expect(observed.closed).toBe(true));
  });

  it("stops a body that trickles a byte at a time and closes its connection", async () => {
    const observed = { closed: false };
    const firstByte = signalled();
    const config = await bucket((request, response) => {
      response.writeHead(200, { etag: '"v1"', "content-length": "100000" });
      const drip = setInterval(() => response.write("x"), 10);
      request.socket.once("close", () => {
        clearInterval(drip);
        observed.closed = true;
      });
      firstByte.resolve();
    });
    const store = createS3ObjectStore(config);
    const controller = new AbortController();
    const call = outcome(store.get("k", { signal: controller.signal }));
    await firstByte.promise;
    await delay(150);
    controller.abort();
    expect(await call).toEqual(cancelled("get", "k"));
    await vi.waitFor(() => expect(observed.closed).toBe(true));
  });
});

// A transport that never looks at the signal, so what stops these calls is the store's own checks.
type Scripted = { statusCode: number; headers?: Record<string, string>; body?: string | Readable };
function signalBlind(
  answer: (request: { method: string; path: string }) => Scripted,
  sleep?: S3ObjectStoreOptions["sleep"],
) {
  const sent: string[] = [];
  const handler = {
    async handle(request: { method: string; path: string }) {
      sent.push(`${request.method} ${request.path}`);
      // A turn of the event loop, as a network gives, so a store that loops forever still lets timers run.
      await new Promise((resolve) => setImmediate(resolve));
      const { statusCode, headers = {}, body = "" } = answer(request);
      return {
        response: {
          statusCode,
          headers,
          body: body instanceof Readable ? body : Readable.from([Buffer.from(body)]),
        },
      };
    },
  };
  const store = createS3ObjectStore(
    {
      endpoint: "https://s3.example.test",
      region: "us-east-1",
      bucket: "owner-bucket",
      prefix: "",
      accessKeyId: "AKIAEXAMPLE0000",
      secretAccessKey: "not-a-real-secret",
    },
    { requestHandler: handler, ...(sleep === undefined ? {} : { sleep }) },
  );
  return { store, sent };
}

describe("over a transport that ignores the signal", () => {
  it("a read destroys the body itself", async () => {
    const body = new Readable({ read() {} });
    const headersSent = signalled();
    const { store } = signalBlind(() => {
      headersSent.resolve();
      return { statusCode: 200, headers: { etag: '"v1"' }, body };
    });
    const controller = new AbortController();
    const call = outcome(store.get("k", { signal: controller.signal }));
    await headersSent.promise;
    await delay(20);
    controller.abort();
    expect(await call).toEqual(cancelled("get", "k"));
    expect(body.destroyed).toBe(true);
  });

  it("a read cancelled before its answer is not read as a missing key", async () => {
    const controller = new AbortController();
    const { store } = signalBlind(() => {
      controller.abort();
      return { statusCode: 404, headers: xml, body: errorBody("NoSuchKey") };
    });
    expect(await outcome(store.get("k", { signal: controller.signal }))).toEqual(
      cancelled("get", "k"),
    );
  });

  it("a listing asks for no further page", async () => {
    const controller = new AbortController();
    let pages = 0;
    const { store, sent } = signalBlind(() => {
      pages += 1;
      if (pages === 3) controller.abort();
      return {
        statusCode: 200,
        headers: xml,
        body:
          "<ListBucketResult><IsTruncated>true</IsTruncated>" +
          `<NextContinuationToken>t${pages}</NextContinuationToken></ListBucketResult>`,
      };
    });
    const call = outcome(store.list("venues/", { signal: controller.signal }), 500);
    expect(await call).toEqual(cancelled("list", "venues/"));
    expect(sent).toHaveLength(3);
  });

  it("a write sends no further attempt after a conflict", async () => {
    const controller = new AbortController();
    const { store, sent } = signalBlind(() => {
      controller.abort();
      return { statusCode: 409, headers: xml, body: errorBody("ConditionalRequestConflict") };
    });
    expect(await outcome(store.put("k", BYTES, undefined, { signal: controller.signal }))).toEqual(
      cancelled("put", "k"),
    );
    expect(sent).toHaveLength(1);
  });

  it("a batch delete cancelled while its first batch is answered sends no second", async () => {
    const controller = new AbortController();
    const { store, sent } = signalBlind(() => {
      controller.abort();
      return { statusCode: 200, headers: xml, body: EMPTY_DELETE_RESULT };
    });
    const keys = Array.from({ length: 1_005 }, (_, i) => `k${i}`);
    expect(await outcome(store.deleteMany(keys, { signal: controller.signal }))).toEqual(
      cancelled("delete", "k0"),
    );
    expect(sent).toHaveLength(1);
  });

  // Every delete in flight then succeeds, so nothing fails: the cancellation alone must answer.
  it("a delete one key at a time sends nothing after the cancellation", async () => {
    const controller = new AbortController();
    let singles = 0;
    let sentAtAbort = -1;
    const { store, sent } = signalBlind((request) => {
      if (request.method === "POST")
        return { statusCode: 501, headers: xml, body: errorBody("NotImplemented") };
      singles += 1;
      if (singles === DELETE_CONCURRENCY) {
        controller.abort();
        sentAtAbort = sent.length;
      }
      return { statusCode: 204 };
    });
    const keys = Array.from({ length: 50 }, (_, i) => `k${i}`);
    expect(await outcome(store.deleteMany(keys, { signal: controller.signal }))).toMatchObject({
      code: "backup.stream_request_failed",
      params: { operation: "delete", status: null, name: "AbortError" },
    });
    expect(sent).toHaveLength(sentAtAbort);
    expect(sent.length).toBeLessThan(1 + keys.length);
  });

  it("a write cancelled during its wait after a conflict sends no further attempt", async () => {
    const controller = new AbortController();
    const { store, sent } = signalBlind(
      () => ({ statusCode: 409, headers: xml, body: errorBody("ConditionalRequestConflict") }),
      async () => controller.abort(),
    );
    expect(await outcome(store.put("k", BYTES, undefined, { signal: controller.signal }))).toEqual(
      cancelled("put", "k"),
    );
    expect(sent).toHaveLength(1);
  });

  it.each(calls)(
    "sends nothing for a %s on a signal already cancelled",
    async (_name, send, operation, key) => {
      const { store, sent } = signalBlind(() => ({ statusCode: 500 }));
      expect(await outcome(send(store, { signal: AbortSignal.abort() }))).toEqual(
        cancelled(operation, key),
      );
      expect(sent).toEqual([]);
    },
  );
});

describe("a listing cancelled while pages keep coming", () => {
  it("asks for no page after the cancellation", async () => {
    const observed = { pages: 0, requestsAfterAbort: 0 };
    const controller = new AbortController();
    const config = await bucket((_request, response) => {
      if (controller.signal.aborted) observed.requestsAfterAbort += 1;
      observed.pages += 1;
      if (observed.pages === 3) controller.abort();
      // Ends the listing 20 pages past the cancellation, so a store that ignores it finishes.
      const truncated = observed.requestsAfterAbort < 20;
      response.writeHead(200, xml);
      response.end(
        '<?xml version="1.0" encoding="UTF-8"?><ListBucketResult>' +
          `<IsTruncated>${truncated}</IsTruncated>` +
          (truncated ? `<NextContinuationToken>t${observed.pages}</NextContinuationToken>` : "") +
          "</ListBucketResult>",
      );
    });
    const store = createS3ObjectStore(config);
    expect(await outcome(store.list("venues/", { signal: controller.signal }))).toEqual(
      cancelled("list", "venues/"),
    );
    expect(observed.requestsAfterAbort).toBe(0);
  });
});

describe("a write cancelled while it waits to retry a conflict", () => {
  it("ends the wait and sends no further attempt", async () => {
    const observed = { puts: 0 };
    const firstConflict = signalled();
    const config = await bucket((_request, response) => {
      observed.puts += 1;
      response.writeHead(409, xml);
      response.end(errorBody("ConditionalRequestConflict"));
      firstConflict.resolve();
    });
    // A wait far longer than the test, so a store that does not end it reads as still pending.
    const store = createS3ObjectStore(config, {
      sleep: (_ms, signal) => abortableSleep(60_000, signal),
    });
    const controller = new AbortController();
    const call = outcome(
      store.put("k", BYTES, { ifNoneMatch: "*" }, { signal: controller.signal }),
    );
    await firstConflict.promise;
    await delay(50);
    controller.abort();
    expect(await call).toEqual(cancelled("put", "k"));
    expect(observed.puts).toBe(1);
  });
});

describe("a call cancelled while the client waits to retry it", () => {
  // SlowDown is a throttling answer the client retries, and Retry-After: 1 makes it wait about a
  // second before the next attempt.
  it("answers the cancellation before the client's wait is over, and the client sends nothing more", async () => {
    const observed = { requests: 0 };
    const firstAnswer = signalled();
    const config = await bucket((_request, response) => {
      observed.requests += 1;
      response.writeHead(503, { ...xml, "retry-after": "1" });
      response.end(errorBody("SlowDown"));
      firstAnswer.resolve();
    });
    const store = createS3ObjectStore(config);
    const controller = new AbortController();
    const listing = store.list("venues/", { signal: controller.signal });
    await firstAnswer.promise;
    await delay(20);
    controller.abort();
    expect(await outcome(listing, 500)).toEqual(cancelled("list", "venues/"));
    await delay(1_500);
    expect(observed.requests).toBe(1);
  });
});

describe("a batch delete cancelled between batches", () => {
  const keys = Array.from({ length: 1_005 }, (_, i) => `k${i}`);
  const keysIn = (body: string) => [...body.matchAll(/<Key>[^<]*<\/Key>/g)].length;

  function batchBucket(onBatch: () => void) {
    const observed = { batchSizes: [] as number[] };
    const config = bucket((_request, response, body) => {
      observed.batchSizes.push(keysIn(body));
      onBatch();
      response.writeHead(200, xml);
      response.end(EMPTY_DELETE_RESULT);
    });
    return { observed, config };
  }

  it("sends 1,005 keys as batches of 1,000 and 5 when nothing cancels it", async () => {
    const { observed, config } = batchBucket(() => {});
    const store = createS3ObjectStore(await config);
    expect(await outcome(store.deleteMany(keys, { signal: new AbortController().signal }))).toBe(
      "resolved",
    );
    expect(observed.batchSizes).toEqual([1000, 5]);
  });

  it("starts no second batch once cancelled during the first", async () => {
    const controller = new AbortController();
    const { observed, config } = batchBucket(() => controller.abort());
    const store = createS3ObjectStore(await config);
    expect(await outcome(store.deleteMany(keys, { signal: controller.signal }))).toEqual(
      cancelled("delete", "k0"),
    );
    expect(observed.batchSizes).toEqual([1000]);
  });
});

describe("a delete one key at a time, cancelled while some are in flight", () => {
  it("starts no further delete, and closes the connections of those in flight", async () => {
    const observed = { started: 0, closed: 0, requestsAfterAbort: 0 };
    const controller = new AbortController();
    const config = await bucket((request, response) => {
      if (request.method === "POST") {
        response.writeHead(501, xml);
        response.end(errorBody("NotImplemented"));
        return;
      }
      if (controller.signal.aborted) observed.requestsAfterAbort += 1;
      else observed.started += 1;
      request.socket.once("close", () => (observed.closed += 1));
      if (observed.started === DELETE_CONCURRENCY) controller.abort();
      // Answers each delete later, so a store that ignores the cancellation goes on to the rest.
      setTimeout(() => {
        response.writeHead(204);
        response.end();
      }, 100);
    });
    const store = createS3ObjectStore(config);
    const keys = Array.from({ length: 50 }, (_, i) => `k${i}`);
    expect(await outcome(store.deleteMany(keys, { signal: controller.signal }))).toEqual(
      cancelled("delete", "k0"),
    );
    expect(observed.started).toBe(DELETE_CONCURRENCY);
    expect(observed.requestsAfterAbort).toBe(0);
    await vi.waitFor(() => expect(observed.closed).toBe(DELETE_CONCURRENCY));
  });
});

describe("a call whose signal has already been cancelled", () => {
  it.each(calls)("sends nothing for a %s", async (_name, send, operation, key) => {
    const observed = { requests: 0 };
    const config = await bucket((request, response) => {
      observed.requests += 1;
      if (request.method === "GET" && request.url?.includes("list-type")) {
        response.writeHead(200, xml);
        response.end("<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>");
      } else if (request.method === "POST") {
        response.writeHead(200, xml);
        response.end(EMPTY_DELETE_RESULT);
      } else {
        response.writeHead(request.method === "DELETE" ? 204 : 200, { etag: '"v1"' });
        response.end(request.method === "GET" ? "{}" : undefined);
      }
    });
    const store = createS3ObjectStore(config);
    expect(await outcome(send(store, { signal: AbortSignal.abort() }))).toEqual(
      cancelled(operation, key),
    );
    expect(observed.requests).toBe(0);
  });
});
