import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { AsyncResource } from "node:async_hooks";
import { join } from "node:path";
import { Readable } from "node:stream";
import { setTimeout as sleep } from "node:timers/promises";
import {
  GetBucketTaggingCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { createBucketClient, createS3ObjectStore, type BucketConfig } from "@waitron/stream";
import {
  type Answer,
  FakeAdmin,
  RUN_ID,
  SUFFIX,
  fakeHarness,
  profileEnv,
  rejection,
  writeProfileFiles,
} from "./aws-rehearsal-fake.js";
import type { AwsReceipt } from "./aws-rehearsal-receipt.js";
import {
  AwsRehearsalRefused,
  call,
  cleanupFromReceipt,
  type AwsRehearsalDeps,
  withAwsRehearsal,
} from "./aws-rehearsal.js";
import { currentRequestScope, uninstallSendGate } from "./aws-send-gate.js";

let dir: string;
let receiptDir: string;
let credentialsFile: string;
let configFile: string;

beforeEach(async () => {
  ({ dir, credentialsFile, configFile } = await writeProfileFiles("aws-rehearsal-plan-"));
  receiptDir = join(dir, "receipts");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

afterAll(() => {
  uninstallSendGate();
});

function harness(answers: Record<string, Answer> = {}, extra: Partial<AwsRehearsalDeps> = {}) {
  const h = fakeHarness(
    new FakeAdmin({ answers }),
    profileEnv({ credentialsFile, configFile }),
    "2026-10-14T12:00:00.000Z",
  );
  return {
    ...h,
    deps: {
      ...h.deps,
      randomSuffix: () => SUFFIX,
      runId: () => RUN_ID,
      receiptDir,
      isAlive: () => false,
      kill: () => {},
      settleMs: 10,
      apis: ["PutObject", "GetObject"],
      ...extra,
    } satisfies Partial<AwsRehearsalDeps>,
  };
}

async function receipt(): Promise<AwsReceipt> {
  return JSON.parse(
    await readFile(join(receiptDir, `aws-rehearsal-${RUN_ID}.json`), "utf8"),
  ) as AwsReceipt;
}

function refusedEvents(parsed: AwsReceipt) {
  return parsed.events.filter((event) => event.phase === "request-refused");
}

/** A request handler that answers 200 to everything and counts what reached it. */
function recordingHandler() {
  let handled = 0;
  return {
    handled: () => handled,
    requestHandler: {
      async handle() {
        handled += 1;
        return {
          response: { statusCode: 200, headers: { etag: '"v1"' }, body: Readable.from([]) },
        };
      },
    },
  };
}

function storeFor(config: BucketConfig, handler: ReturnType<typeof recordingHandler>) {
  return createS3ObjectStore(config, { requestHandler: handler.requestHandler });
}

function messagesOf(error: Error): string[] {
  return error instanceof AggregateError
    ? (error.errors as Error[]).map((inner) => inner.message)
    : [error.message];
}

const REFUSED_PREFIX = "1 unplanned request(s) refused before sending; the first: ";

describe("withAwsRehearsal — the request plan", () => {
  it("refuses a run that declares no API list before building a client", async () => {
    const h = harness({}, { apis: undefined });
    const error = await rejection(withAwsRehearsal(async () => "never", h.deps));
    expect(error).toBeInstanceOf(AwsRehearsalRefused);
    expect((error as AwsRehearsalRefused).reason).toBe("plan-refused");
    expect(h.createAdminClient).not.toHaveBeenCalled();
  });

  it("refuses a declared bucket-level API before sending anything", async () => {
    const h = harness({}, { apis: ["PutObject", "DeleteBucket"] });
    const error = await rejection(withAwsRehearsal(async () => "never", h.deps));
    expect((error as AwsRehearsalRefused).reason).toBe("plan-refused");
    expect(h.fake.calls).toEqual([]);
  });

  it("refuses a scenario store's request for another bucket before it reaches the handler, and still tears down", async () => {
    const h = harness();
    const net = recordingHandler();
    let config: BucketConfig | undefined;
    const error = await rejection(
      withAwsRehearsal(async (ctx) => {
        config = ctx.bucketConfig(ctx.prefix("loop"));
        const other = storeFor({ ...config, bucket: "someone-elses-bucket" }, net);
        await other.put("a.txt", new Uint8Array([1]));
      }, h.deps),
    );
    expect(net.handled()).toBe(0);
    expect(messagesOf(error)).toContain(
      `${REFUSED_PREFIX}PutObject was sent to a bucket this run did not create`,
    );
    expect(h.fake.names()).toContain("DeleteBucket");
    expect(refusedEvents(await receipt())).toEqual([
      { scenario: "lifecycle", phase: "request-refused", api: "PutObject", outcome: "refused" },
    ]);

    // Control: the same store, outside any run, reaches the handler.
    await storeFor({ ...config!, bucket: "someone-elses-bucket" }, net).put(
      "a.txt",
      new Uint8Array([1]),
    );
    expect(net.handled()).toBe(1);
  });

  it("lets a planned scenario request through to the handler", async () => {
    const h = harness();
    const net = recordingHandler();
    await withAwsRehearsal(async (ctx) => {
      await storeFor(ctx.bucketConfig(ctx.prefix("loop")), net).put("a.txt", new Uint8Array([1]));
    }, h.deps);
    expect(net.handled()).toBe(1);
    expect(refusedEvents(await receipt())).toEqual([]);
  });

  it("fails the run when the scenario swallows a refusal", async () => {
    const h = harness();
    const net = recordingHandler();
    const error = await rejection(
      withAwsRehearsal(async (ctx) => {
        const config = ctx.bucketConfig(ctx.prefix("loop"));
        await storeFor({ ...config, bucket: "someone-elses-bucket" }, net)
          .put("a.txt", new Uint8Array([1]))
          .catch(() => {});
        return "swallowed";
      }, h.deps),
    );
    expect(net.handled()).toBe(0);
    expect(error.message).toBe(
      `${REFUSED_PREFIX}PutObject was sent to a bucket this run did not create`,
    );
  });

  it("fails the run naming a refused API the receipt does not know, with no api on its event", async () => {
    const h = harness();
    const net = recordingHandler();
    const error = await rejection(
      withAwsRehearsal(async (ctx) => {
        const client = createBucketClient(ctx.bucketConfig(ctx.prefix("loop")), {
          requestHandler: net.requestHandler,
        }) as S3Client;
        await client.send(new GetBucketTaggingCommand({ Bucket: ctx.bucket })).catch(() => {});
      }, h.deps),
    );
    expect(net.handled()).toBe(0);
    expect(error.message).toBe(
      `${REFUSED_PREFIX}GetBucketTagging is not an S3 API the rehearsal knows`,
    );
    expect(refusedEvents(await receipt())).toEqual([
      { scenario: "lifecycle", phase: "request-refused", outcome: "refused" },
    ]);
  });

  it("refuses a non-lifecycle API on the runner's own call before the admin client sees it", async () => {
    const h = harness();
    let outcome: { error?: unknown } | undefined;
    const error = await rejection(
      withAwsRehearsal(async (ctx) => {
        outcome = await call(
          h.fake,
          new HeadObjectCommand({ Bucket: ctx.bucket, Key: ".waitron-rehearsal-owner" }),
          "HeadObject",
          "probe",
          { now: () => 0 },
        );
      }, h.deps),
    );
    expect(h.fake.names()).not.toContain("HeadObject");
    expect(outcome?.error).toBeInstanceOf(AwsRehearsalRefused);
    expect(error.message).toBe(
      `${REFUSED_PREFIX}HeadObject is not a lifecycle API the runner may send`,
    );
    expect(refusedEvents(await receipt())).toEqual([
      { scenario: "lifecycle", phase: "request-refused", api: "HeadObject", outcome: "refused" },
    ]);
  });

  it("holds the scope open through teardown", async () => {
    const scopes: unknown[] = [];
    const h = harness({
      DeleteBucket: () => {
        scopes.push(currentRequestScope());
        return { $metadata: { httpStatusCode: 204, attempts: 1 } };
      },
    });
    await withAwsRehearsal(async () => undefined, h.deps);
    expect(scopes).toHaveLength(1);
    expect(scopes[0]).toBeDefined();
  });

  it("counts and prints a request refused after the receipt is written but before the scope closes", async () => {
    const net = recordingHandler();
    let fire: (() => void) | undefined;
    let receiptWritten: boolean | undefined;
    const printed: string[] = [];
    const h = harness(
      {},
      {
        print: (line) => {
          printed.push(line);
          if (fire === undefined) return;
          receiptWritten = existsSync(join(receiptDir, `aws-rehearsal-${RUN_ID}.json`));
          const once = fire;
          fire = undefined;
          once();
        },
      },
    );
    const error = await rejection(
      withAwsRehearsal(async (ctx) => {
        const client = createBucketClient(
          { ...ctx.bucketConfig(ctx.prefix("loop")), bucket: "someone-elses-bucket" },
          { requestHandler: net.requestHandler },
        ) as S3Client;
        // Bound here, so it runs inside this run's scope when the print hook calls it.
        fire = AsyncResource.bind(() => {
          void client
            .send(new PutObjectCommand({ Bucket: "someone-elses-bucket", Key: "a", Body: "x" }))
            .catch(() => {});
        });
      }, h.deps),
    );
    expect(receiptWritten).toBe(true);
    expect(net.handled()).toBe(0);
    expect(error.message).toBe(
      `${REFUSED_PREFIX}PutObject was sent to a bucket this run did not create`,
    );
    expect(printed).toContain(
      "refused after the receipt was written: PutObject was sent to a bucket this run did not create",
    );
  });

  it("sends the runner's own requests through a real SDK client as the runner's", async () => {
    const net = recordingHandler();
    const h = harness();
    const createAdminClient = (profile: {
      region: string;
      accessKeyId: string;
      secretAccessKey: string;
    }) =>
      createBucketClient(
        { ...profile, bucket: "", prefix: "" },
        { requestHandler: net.requestHandler },
      );
    await withAwsRehearsal(async () => undefined, { ...h.deps, createAdminClient }).catch(
      () => undefined,
    );
    // The empty answers fail the encryption preflight; CreateBucket and the marker still went out.
    expect(net.handled()).toBeGreaterThanOrEqual(2);
    expect(refusedEvents(await receipt())).toEqual([]);
  });

  it("refuses and prints a request sent after the run has ended", async () => {
    const h = harness();
    const net = recordingHandler();
    let late: Promise<unknown> | undefined;
    await withAwsRehearsal(async (ctx) => {
      const store = storeFor(ctx.bucketConfig(ctx.prefix("loop")), net);
      late = sleep(50).then(() => store.put("late.txt", new Uint8Array([1])).catch(() => {}));
    }, h.deps);
    await late;
    expect(net.handled()).toBe(0);
    expect(h.printed).toContain(
      "refused after the run ended: PutObject was sent after the run has ended",
    );
  });
});

async function writeOwnedReceipt(): Promise<string> {
  const bucket = `waitron-rehearsal-waitron-${SUFFIX}`;
  const path = join(dir, `aws-rehearsal-${RUN_ID}.json`);
  await writeFile(
    path,
    JSON.stringify({
      header: { runId: RUN_ID, region: "eu-north-1" },
      ownership: { state: "owned", bucket },
      remaining: { bucket, uploadIds: [] },
    }),
  );
  return path;
}

const MARKER = {
  $metadata: { httpStatusCode: 200, attempts: 1 },
  Body: { transformToString: async () => JSON.stringify({ runId: RUN_ID }) },
};

describe("cleanupFromReceipt — the request plan", () => {
  it("reads the ownership marker through a real SDK client as the runner's", async () => {
    const path = await writeOwnedReceipt();
    const net = recordingHandler();
    const h = harness();
    const createAdminClient = (profile: {
      region: string;
      accessKeyId: string;
      secretAccessKey: string;
    }) =>
      createBucketClient(
        { ...profile, bucket: "", prefix: "" },
        { requestHandler: net.requestHandler },
      );
    // The empty answer is no marker, so nothing past the read is sent.
    const error = await rejection(cleanupFromReceipt(path, { ...h.deps, createAdminClient }));
    expect((error as AwsRehearsalRefused).reason).toBe("ownership-unproven");
    expect(net.handled()).toBe(1);
  });

  it("fails naming a request refused during the cleanup, after writing its receipt", async () => {
    const path = await writeOwnedReceipt();
    const net = recordingHandler();
    const h = harness({
      GetObject: (input) => {
        const other = createBucketClient(
          {
            region: "eu-north-1",
            bucket: "someone-elses-bucket",
            prefix: "",
            accessKeyId: "AKIAEXAMPLE0000",
            secretAccessKey: "not-a-real-secret",
          },
          { requestHandler: net.requestHandler },
        ) as S3Client;
        void other
          .send(
            new PutObjectCommand({
              Bucket: "someone-elses-bucket",
              Key: String(input.Key),
              Body: "x",
            }),
          )
          .catch(() => {});
        return MARKER;
      },
    });
    const error = await rejection(cleanupFromReceipt(path, h.deps));
    expect(net.handled()).toBe(0);
    expect(error.message).toBe(
      `${REFUSED_PREFIX}PutObject was sent to a bucket this run did not create`,
    );
    expect(h.printed).toEqual([join(dir, `aws-rehearsal-${RUN_ID}-cleanup.json`)]);
  });

  it("names the refusals when the cleanup receipt cannot be written", async () => {
    const path = await writeOwnedReceipt();
    await mkdir(join(dir, `aws-rehearsal-${RUN_ID}-cleanup.json`));
    const net = recordingHandler();
    const h = harness({
      GetObject: () => {
        const other = createBucketClient(
          {
            region: "eu-north-1",
            bucket: "someone-elses-bucket",
            prefix: "",
            accessKeyId: "AKIAEXAMPLE0000",
            secretAccessKey: "not-a-real-secret",
          },
          { requestHandler: net.requestHandler },
        ) as S3Client;
        void other
          .send(new PutObjectCommand({ Bucket: "someone-elses-bucket", Key: "a", Body: "x" }))
          .catch(() => {});
        return MARKER;
      },
    });
    const error = await rejection(cleanupFromReceipt(path, h.deps));
    expect(error.message).toContain("cleanup receipt not written");
    expect(error.message).toContain(
      `; ${REFUSED_PREFIX}PutObject was sent to a bucket this run did not create`,
    );
  });

  it("sends its marker read and teardown inside a scope", async () => {
    const bucket = `waitron-rehearsal-waitron-${SUFFIX}`;
    const path = join(dir, `aws-rehearsal-${RUN_ID}.json`);
    await writeFile(
      path,
      JSON.stringify({
        header: { runId: RUN_ID, region: "eu-north-1" },
        ownership: { state: "owned", bucket },
        remaining: { bucket, uploadIds: [] },
      }),
    );
    const scopes: unknown[] = [];
    const h = harness({
      GetObject: () => {
        scopes.push(currentRequestScope());
        return {
          $metadata: { httpStatusCode: 200, attempts: 1 },
          Body: { transformToString: async () => JSON.stringify({ runId: RUN_ID }) },
        };
      },
      DeleteBucket: () => {
        scopes.push(currentRequestScope());
        return { $metadata: { httpStatusCode: 204, attempts: 1 } };
      },
    });
    const result = await cleanupFromReceipt(path, h.deps);
    expect(result.ok).toBe(true);
    expect(scopes).toHaveLength(2);
    expect(scopes.every((scope) => scope !== undefined)).toBe(true);
  });
});
