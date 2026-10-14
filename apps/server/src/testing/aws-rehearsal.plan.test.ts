import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { setTimeout as sleep } from "node:timers/promises";
import { GetBucketTaggingCommand, HeadObjectCommand, type S3Client } from "@aws-sdk/client-s3";
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

  it("holds the scope open through teardown and closes it once the receipt is written", async () => {
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

describe("cleanupFromReceipt — the request plan", () => {
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
