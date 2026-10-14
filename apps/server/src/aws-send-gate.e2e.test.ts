// The rehearsal's send gate (`./testing/aws-send-gate.ts`) against versitygw, whose own access log
// says which requests reached it. Install the server with `node scripts/setup-s3-test-server.mjs`.
// Without it each case is reported SKIPPED; with CI=true or WAITRON_REQUIRE_STREAM_BINARIES=1 a
// missing binary FAILS the case instead.
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  GetBucketLocationCommand,
  ListBucketsCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createS3ObjectStore } from "@waitron/stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AwsRehearsalRefused } from "./testing/aws-rehearsal-refused.js";
import { createRequestPlan } from "./testing/aws-request-plan.js";
import {
  installSendGate,
  openRequestScope,
  setSendGateStrict,
  uninstallSendGate,
  type RequestScope,
} from "./testing/aws-send-gate.js";
import {
  READY_TIMEOUT_MS as S3_READY_MS,
  resolveVersitygw,
  startS3TestServer,
  type S3TestServer,
} from "./testing/s3-test-server.js";

const INSTALL = "node scripts/setup-s3-test-server.mjs";
const REQUIRED = process.env.CI === "true" || process.env.WAITRON_REQUIRE_STREAM_BINARIES === "1";
/** Not a rehearsal bucket's name, so a refusal must not name it. */
const OTHER_BUCKET = "waitron-other-venue";
const ISSUED = "issued-run/";
const NOT_ISSUED = "not-issued/";

const versitygw = await resolveVersitygw(process.env);
if (!versitygw.ok && !REQUIRED) {
  console.warn(`S3 send gate cases SKIPPED: ${versitygw.reason}. Install with: ${INSTALL}`);
}

interface LoggedRequest {
  bucket: string;
  api: string;
  key: string;
}

describe("the send gate, against versitygw", () => {
  let scratch: string | undefined;
  let accessLog: string | undefined;
  let s3: S3TestServer | undefined;
  let client: S3Client | undefined;
  const sendProto = Object.getPrototypeOf(S3Client.prototype) as { send: unknown };
  let original: unknown;
  const httpServers: Server[] = [];

  beforeAll(async () => {
    original = sendProto.send;
    installSendGate();
    setSendGateStrict(false);
    if (!versitygw.ok) return;
    scratch = await mkdtemp(join(tmpdir(), "waitron-send-gate-"));
    accessLog = join(scratch, "access.log");
    s3 = await startS3TestServer({
      bin: versitygw.bin,
      root: join(scratch, "s3"),
      region: "eu-north-1",
      accessLog,
    });
    client = new S3Client({
      endpoint: s3.endpoint,
      region: s3.region,
      forcePathStyle: true,
      credentials: { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey },
      maxAttempts: 1,
    });
    await client.send(new CreateBucketCommand({ Bucket: OTHER_BUCKET }));
  }, S3_READY_MS + 10_000);

  afterAll(async () => {
    const failures: unknown[] = [];
    for (const cleanup of [
      async () => {
        await Promise.all(
          httpServers.map(
            (server) => new Promise<void>((resolve) => server.close(() => resolve())),
          ),
        );
      },
      () => client?.destroy(),
      async () => {
        if (s3 !== undefined) await s3.stop();
      },
      async () => {
        if (scratch !== undefined) await rm(scratch, { recursive: true, force: true });
      },
      () => {
        uninstallSendGate();
        expect(sendProto.send).toBe(original);
      },
    ]) {
      try {
        await cleanup();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) throw new AggregateError(failures, "send gate teardown failed");
  });

  function requireServer(ctx: { skip(note: string): never }): {
    server: S3TestServer;
    client: S3Client;
  } {
    if (!versitygw.ok) {
      if (REQUIRED) {
        throw new Error(
          `the send gate cases cannot run: ${versitygw.reason}. CI installs it with: ${INSTALL}`,
        );
      }
      return ctx.skip(`${versitygw.reason} — install with: ${INSTALL}`);
    }
    if (s3 === undefined || client === undefined) {
      throw new Error("the S3 test server did not start");
    }
    return { server: s3, client };
  }

  /** versitygw's access log: the bucket is the second field, the API the `s3_`-prefixed one, the key the next. */
  async function logged(): Promise<LoggedRequest[]> {
    const text = await readFile(accessLog!, "utf8");
    return text
      .split("\n")
      .map((line) => line.split(" "))
      .flatMap((fields) => {
        const at = fields.findIndex((field) => field.startsWith("s3_"));
        if (at === -1) return [];
        return [{ bucket: fields[1]!, api: fields[at]!.slice(3), key: fields[at + 1] ?? "" }];
      });
  }

  async function loggedSince(count: number): Promise<LoggedRequest[]> {
    return (await logged()).slice(count);
  }

  function scopeFor(server: S3TestServer): RequestScope {
    return openRequestScope({
      plan: createRequestPlan({
        bucket: server.bucket,
        apis: ["PutObject"],
        prefixes: () => new Set([ISSUED]),
      }),
      mode: "enforce",
      hosts: "any",
    });
  }

  it("lets a planned PutObject under an issued prefix reach the server", async (ctx) => {
    const { server, client } = requireServer(ctx);
    const scope = scopeFor(server);
    const before = (await logged()).length;

    await scope.run(() =>
      client.send(new PutObjectCommand({ Bucket: server.bucket, Key: `${ISSUED}one`, Body: "x" })),
    );

    expect(scope.refusals()).toEqual({ count: 0, first: undefined });
    expect(await loggedSince(before)).toEqual([
      { bucket: server.bucket, api: "PutObject", key: `${ISSUED}one` },
    ]);
  });

  it("refuses a DeleteBucket of a bucket the run did not create before the server sees it", async (ctx) => {
    const { server, client } = requireServer(ctx);
    const scope = scopeFor(server);
    const before = (await logged()).length;

    const refused = await scope
      .run(() => client.send(new DeleteBucketCommand({ Bucket: OTHER_BUCKET })))
      .then(
        () => undefined,
        (error: unknown) => error,
      );

    expect(refused).toBeInstanceOf(AwsRehearsalRefused);
    expect((refused as AwsRehearsalRefused).reason).toBe("request-unplanned");
    expect((refused as Error).message).toContain(
      "DeleteBucket was sent to a bucket this run did not create",
    );
    expect((refused as Error).message).not.toContain(OTHER_BUCKET);
    expect(scope.refusals().count).toBe(1);
    expect((await loggedSince(before)).filter((line) => line.bucket === OTHER_BUCKET)).toEqual([]);

    await client.send(new GetBucketLocationCommand({ Bucket: OTHER_BUCKET }));
    expect((await loggedSince(before)).filter((line) => line.bucket === OTHER_BUCKET)).toEqual([
      { bucket: OTHER_BUCKET, api: "GetBucketLocation", key: "-" },
    ]);
    const { Buckets } = await client.send(new ListBucketsCommand({}));
    expect(Buckets?.map((bucket) => bucket.Name)).toContain(OTHER_BUCKET);
  });

  it("checks the requests of a store from @waitron/stream built inside the scope", async (ctx) => {
    const { server } = requireServer(ctx);
    const scope = scopeFor(server);
    const before = (await logged()).length;

    const outcome = await scope.run(async () => {
      const unissued = createS3ObjectStore({ ...server, prefix: NOT_ISSUED });
      const issued = createS3ObjectStore({ ...server, prefix: `${ISSUED}store/` });
      const refusedPut = await unissued.put("a", new TextEncoder().encode("x")).then(
        () => "sent",
        () => "failed",
      );
      await issued.put("b", new TextEncoder().encode("y"));
      return refusedPut;
    });

    expect(outcome).toBe("failed");
    expect(scope.refusals().count).toBe(1);
    expect(scope.refusals().first).toContain("PutObject");
    expect(await loggedSince(before)).toEqual([
      { bucket: server.bucket, api: "PutObject", key: `${ISSUED}store/b` },
    ]);
  });

  it("checks a request sent from an HTTP handler started inside the scope and called from outside it", async (ctx) => {
    const { server, client } = requireServer(ctx);
    const scope = scopeFor(server);
    const before = (await logged()).length;

    const http = createServer((request, response) => {
      const sent =
        request.url === "/planned"
          ? client.send(
              new PutObjectCommand({ Bucket: server.bucket, Key: `${ISSUED}handler`, Body: "z" }),
            )
          : client.send(new DeleteBucketCommand({ Bucket: OTHER_BUCKET }));
      sent.then(
        () => response.end("sent"),
        (error: unknown) =>
          response.end(
            error instanceof AwsRehearsalRefused ? `refused ${error.reason}` : String(error),
          ),
      );
    });
    httpServers.push(http);
    await scope.run(
      () => new Promise<void>((resolve) => http.listen(0, "127.0.0.1", () => resolve())),
    );
    const address = http.address();
    if (address === null || typeof address === "string") throw new Error("no port");
    const url = `http://127.0.0.1:${address.port}`;

    expect(await (await fetch(`${url}/unplanned`)).text()).toBe("refused request-unplanned");
    expect(await (await fetch(`${url}/planned`)).text()).toBe("sent");

    expect(scope.refusals().count).toBe(1);
    expect(await loggedSince(before)).toEqual([
      { bucket: server.bucket, api: "PutObject", key: `${ISSUED}handler` },
    ]);
  });
});
