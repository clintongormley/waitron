import { Readable } from "node:stream";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import { createBucketClient, type BucketConfig, type CommandObservation } from "./s3-client.js";
import { createS3FileStore } from "./s3-file-store.js";

type Scripted = { status: number; headers?: Record<string, string>; body?: string };

const xml = { "content-type": "application/xml" };
const DENIED: Scripted = {
  status: 403,
  headers: xml,
  body: `<?xml version="1.0" encoding="UTF-8"?><Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>`,
};
const BUSY: Scripted = {
  status: 500,
  headers: xml,
  body: `<?xml version="1.0" encoding="UTF-8"?><Error><Code>InternalError</Code><Message>We encountered an internal error.</Message></Error>`,
};
const PUT_OK: Scripted = { status: 200, headers: { etag: '"v1"' } };

function network(responses: Scripted[]) {
  let sent = 0;
  const handler = {
    async handle() {
      sent += 1;
      const next = responses.shift();
      if (next === undefined) throw new Error("no scripted response");
      return {
        response: {
          statusCode: next.status,
          headers: next.headers ?? {},
          body: Readable.from([Buffer.from(next.body ?? "")]),
        },
      };
    },
  };
  return { handler, sent: () => sent };
}

const CONFIG: BucketConfig = {
  endpoint: "https://s3.example.test",
  region: "us-east-1",
  bucket: "owner-bucket",
  prefix: "",
  accessKeyId: "AKIAEXAMPLE0000",
  secretAccessKey: "not-a-real-secret",
};

function observed(responses: Scripted[], observe?: (o: CommandObservation) => void) {
  const net = network(responses);
  const seen: CommandObservation[] = [];
  const client = createBucketClient(CONFIG, {
    requestHandler: net.handler,
    observe:
      observe ??
      ((observation) => {
        seen.push(observation);
      }),
  });
  return { client, seen, sent: net.sent };
}

describe("observing a bucket client's commands", () => {
  it("reports each command once, with its name, input, output and time taken", async () => {
    const { client, seen } = observed([PUT_OK, PUT_OK]);
    const before = performance.now();
    await client.send(new PutObjectCommand({ Bucket: "owner-bucket", Key: "a", Body: "x" }));
    await client.send(new PutObjectCommand({ Bucket: "owner-bucket", Key: "b", Body: "y" }));
    const took = performance.now() - before;
    expect(seen).toHaveLength(2);
    expect(seen.map((o) => o.command)).toEqual(["PutObjectCommand", "PutObjectCommand"]);
    expect(seen[0]!.input).toMatchObject({ Bucket: "owner-bucket", Key: "a" });
    expect(seen[1]!.input).toMatchObject({ Key: "b" });
    expect(seen[0]!.output).toMatchObject({ ETag: '"v1"' });
    expect(seen[0]!.error).toBeUndefined();
    expect("error" in seen[0]!).toBe(false);
    for (const o of seen) {
      expect(o.elapsedMs).toBeGreaterThanOrEqual(0);
      expect(o.elapsedMs).toBeLessThanOrEqual(took);
    }
  });

  it("reports a retried command once, after its attempts end", async () => {
    const { client, seen, sent } = observed([BUSY, PUT_OK]);
    await client.send(new PutObjectCommand({ Bucket: "owner-bucket", Key: "a", Body: "x" }));
    expect(sent()).toBe(2);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.output).toMatchObject({ $metadata: { attempts: 2, httpStatusCode: 200 } });
  });

  it("reports a refusal as an error and rethrows that same error", async () => {
    const { client, seen } = observed([DENIED]);
    const thrown = await client
      .send(new GetObjectCommand({ Bucket: "owner-bucket", Key: "a" }))
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    expect(thrown).toMatchObject({ name: "AccessDenied", $metadata: { httpStatusCode: 403 } });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.command).toBe("GetObjectCommand");
    expect(seen[0]!.error).toBe(thrown);
    expect("output" in seen[0]!).toBe(false);
  });

  it("fails the command when the observer throws", async () => {
    const refusal = new Error("field refused");
    const { client } = observed([PUT_OK], () => {
      throw refusal;
    });
    await expect(
      client.send(new PutObjectCommand({ Bucket: "owner-bucket", Key: "a", Body: "x" })),
    ).rejects.toBe(refusal);
  });

  it("adds nothing to the client when no observer is given", () => {
    const plain = createBucketClient(CONFIG, { requestHandler: network([]).handler });
    const watched = observed([]).client;
    const named = (names: string[]) => names.filter((n) => n.startsWith("observeCommand "));
    expect(named(watched.middlewareStack.identify())).toEqual(["observeCommand - initialize"]);
    expect(named(plain.middlewareStack.identify())).toEqual([]);
  });

  it("reaches the client the file store builds", async () => {
    const net = network([PUT_OK]);
    const seen: CommandObservation[] = [];
    const store = createS3FileStore(CONFIG, {
      requestHandler: net.handler,
      observe: (observation) => seen.push(observation),
    });
    try {
      await store.putBytes("pointer.json", Buffer.from("{}"), {
        signal: new AbortController().signal,
      });
    } finally {
      store.close();
    }
    expect(seen.map((o) => o.command)).toEqual(["PutObjectCommand"]);
  });
});
