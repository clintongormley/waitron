import { spawn } from "node:child_process";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  type Answer,
  BUCKET,
  type FakeHarness,
  FakeAdmin,
  KEY_ID,
  NONCE,
  RUN_ID,
  SECRET,
  SUFFIX,
  fakeHarness,
  ok,
  profileEnv,
  rejection,
  sdkError,
  writeProfileFiles,
} from "./aws-rehearsal-fake.js";
import { AWS_REHEARSAL_LIMITS } from "./aws-rehearsal-limits.js";
import {
  AWS_REHEARSAL_PROFILE,
  type AwsReceipt,
  cleanupCommandFor,
  isReceiptCleanupCommand,
} from "./aws-rehearsal-receipt.js";
import {
  AwsRehearsalRefused,
  rehearsalLifecycle,
  type AwsRehearsal,
  type AwsRehearsalDeps,
  teardownOwnedBucket,
  withAwsRehearsal,
} from "./aws-rehearsal.js";

const MIB = 1024 * 1024;

let dir: string;
let receiptDir: string;
let credentialsFile: string;
let configFile: string;

beforeEach(async () => {
  ({ dir, credentialsFile, configFile } = await writeProfileFiles("aws-rehearsal-lifecycle-"));
  receiptDir = join(dir, "receipts");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function env(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return profileEnv({ credentialsFile, configFile }, overrides);
}

interface Harness extends FakeHarness {
  killed: [number, string][];
}

function harness(
  overrides: Record<string, Answer> = {},
  extra: Partial<AwsRehearsalDeps> = {},
): Harness {
  const h = fakeHarness(new FakeAdmin({ answers: overrides }), env(), "2026-10-14T10:00:00.000Z");
  const killed: [number, string][] = [];
  return {
    ...h,
    killed,
    deps: {
      ...h.deps,
      randomSuffix: () => SUFFIX,
      runId: () => RUN_ID,
      receiptDir,
      isAlive: () => false,
      kill: (pid, signal) => {
        killed.push([pid, signal]);
      },
      settleMs: 10,
      ...extra,
    },
  };
}

async function receipt(): Promise<{ parsed: AwsReceipt; text: string }> {
  const text = await readFile(join(receiptDir, `aws-rehearsal-${RUN_ID}.json`), "utf8");
  return { parsed: JSON.parse(text) as AwsReceipt, text };
}

const DESTRUCTIVE = [
  "DeleteBucket",
  "DeleteObject",
  "DeleteObjects",
  "DeleteBucketPolicy",
  "AbortMultipartUpload",
];

describe("withAwsRehearsal — before any bucket", () => {
  it("refuses without opt-in before reading a file or building a client", async () => {
    const h = harness({}, { env: env({ WAITRON_RUN_AWS_REHEARSAL: undefined }) });
    const error = await rejection(withAwsRehearsal(async () => "never", h.deps));
    expect(error).toBeInstanceOf(AwsRehearsalRefused);
    expect((error as AwsRehearsalRefused).reason).toBe("opt-in-missing");
    expect(h.readFile).not.toHaveBeenCalled();
    expect(h.createAdminClient).not.toHaveBeenCalled();
  });

  it("refuses a supplied bucket before the client exists", async () => {
    const h = harness({}, { env: env({ WAITRON_AWS_REHEARSAL_BUCKET: "someone-elses" }) });
    const error = await rejection(withAwsRehearsal(async () => "never", h.deps));
    expect((error as AwsRehearsalRefused).reason).toBe("supplied-bucket");
    expect(error.message).not.toContain("someone-elses");
    expect(h.readFile).not.toHaveBeenCalled();
    expect(h.createAdminClient).not.toHaveBeenCalled();
  });

  it("refuses a receipt folder the cleanup command could not name", async () => {
    const h = harness({}, { receiptDir: join(dir, "has space") });
    const error = await rejection(withAwsRehearsal(async () => "never", h.deps));
    expect((error as AwsRehearsalRefused).reason).toBe("receipt-dir-unsupported");
    expect(h.createAdminClient).not.toHaveBeenCalled();
  });
});

describe("withAwsRehearsal — the happy path", () => {
  it("creates, proves, preflights, runs the scenario and tears the bucket down", async () => {
    const h = harness();
    let seen: { bucket: string; config: Record<string, unknown>; callsAtStart: number } | undefined;
    const result = await withAwsRehearsal(async (ctx: AwsRehearsal) => {
      const prefix = ctx.prefix("loop");
      const config = ctx.bucketConfig(prefix);
      seen = { bucket: ctx.bucket, config: { ...config }, callsAtStart: h.fake.calls.length };
      ctx.reserveUpload(10, "fixture");
      h.fake.objects.set(`${prefix}fixture-a`, "");
      h.fake.objects.set(`${prefix}fixture-b`, "");
      ctx.record({
        scenario: "loop",
        phase: "upload",
        api: "PutObject",
        httpStatus: 200,
        outcome: "ok",
      });
      return "done";
    }, h.deps);
    expect(result).toBe("done");

    expect(h.fake.calls[0]).toMatchObject({
      name: "CreateBucket",
      input: { Bucket: BUCKET, CreateBucketConfiguration: { LocationConstraint: "eu-north-1" } },
    });
    expect(Object.keys(h.fake.calls[0]!.input).sort()).toEqual([
      "Bucket",
      "CreateBucketConfiguration",
    ]);
    expect(h.fake.calls[1]).toMatchObject({
      name: "PutObject",
      input: { Bucket: BUCKET, Key: NONCE, Body: JSON.stringify({ runId: RUN_ID }) },
    });
    expect(h.fake.names().slice(2, 4)).toEqual(["GetBucketEncryption", "GetBucketVersioning"]);
    expect(seen!.callsAtStart).toBe(4);
    expect(seen!.bucket).toBe(BUCKET);
    expect(seen!.config).toEqual({
      region: "eu-north-1",
      bucket: BUCKET,
      prefix: `rehearsal-${RUN_ID}/loop/`,
      accessKeyId: KEY_ID,
      secretAccessKey: SECRET,
    });
    expect("endpoint" in seen!.config).toBe(false);

    const teardown = h.fake.names().slice(4);
    expect(teardown).toEqual([
      "ListMultipartUploads",
      "DeleteBucketPolicy",
      "ListObjectsV2",
      "DeleteObjects",
      "DeleteObject",
      "DeleteBucket",
    ]);
    for (const call of h.fake.calls) expect(call.input.Bucket).toBe(BUCKET);
    const deleted = h.fake.calls.find((call) => call.name === "DeleteObjects")!.input as {
      Delete: { Objects: { Key: string }[]; Quiet: boolean };
    };
    expect(deleted.Delete.Quiet).toBe(true);
    expect(deleted.Delete.Objects.map((object) => object.Key)).not.toContain(NONCE);

    const { parsed, text } = await receipt();
    expect(h.printed).toEqual([join(receiptDir, `aws-rehearsal-${RUN_ID}.json`)]);
    expect(parsed.ownership).toEqual({ bucket: BUCKET, state: "owned" });
    expect(parsed.remaining).toEqual({ bucket: null, uploadIds: [] });
    expect(parsed.cleanupCommand).toBeNull();
    expect(parsed.teardown.every((entry) => entry.outcome !== "failed")).toBe(true);
    expect(parsed.header).toMatchObject({
      runId: RUN_ID,
      commit: "0123456789abcdef",
      node: process.version,
      sdkVersion: "3.1140.0",
      litestreamVersion: "0.5.17",
      region: "eu-north-1",
      startedAt: "2026-10-14T10:00:00.005Z",
    });
    expect(parsed.events.some((event) => event.scenario === "loop")).toBe(true);
    expect(parsed.events.find((event) => event.api === "CreateBucket")).toMatchObject({
      httpStatus: 200,
      attempts: 1,
      outcome: "ok",
    });
    const actions = Object.fromEntries(parsed.actions.map((row) => [row.api, row.status]));
    expect(actions.CreateBucket).toBe("observed");
    expect(actions.UploadPart).toBe("source-only");
    expect(actions.GetObject).toBe("not-exercised");
    expect(text).not.toContain(KEY_ID);
    expect(text).not.toContain(SECRET);
  });

  it("gives each label one prefix and a bucket config only for an issued prefix", async () => {
    const h = harness();
    await withAwsRehearsal(async (ctx) => {
      expect(ctx.prefix("a")).toBe(`rehearsal-${RUN_ID}/a/`);
      expect(() => ctx.prefix("a")).toThrow(AwsRehearsalRefused);
      expect(() => ctx.prefix("a/b")).toThrow(AwsRehearsalRefused);
      expect(() => ctx.prefix("")).toThrow(AwsRehearsalRefused);
      expect(() => ctx.bucketConfig(`rehearsal-${RUN_ID}/b/`)).toThrow(AwsRehearsalRefused);
      expect(() => ctx.bucketConfig("")).toThrow(AwsRehearsalRefused);
    }, h.deps);
  });
});

describe("withAwsRehearsal — creation outcomes", () => {
  it.each([
    ["BucketAlreadyExists", 1],
    ["BucketAlreadyExists", 3],
    ["BucketAlreadyOwnedByYou", 1],
  ] as const)("never owns a %s collision answered on attempt %i", async (name, attempts) => {
    const h = harness({
      CreateBucket: () => {
        throw sdkError(name, 409, attempts);
      },
    });
    const scenario = vi.fn(async () => undefined);
    const error = await rejection(withAwsRehearsal(scenario, h.deps));
    expect(error.message).not.toContain(SECRET);
    expect(scenario).not.toHaveBeenCalled();
    expect(h.fake.names()).toEqual(["CreateBucket"]);
    expect(h.fake.names().filter((name) => DESTRUCTIVE.includes(name))).toEqual([]);
    const { parsed } = await receipt();
    expect(parsed.ownership).toEqual({ bucket: null, state: "collision" });
    expect(parsed.remaining).toEqual({ bucket: null, uploadIds: [] });
    expect(parsed.teardown).toEqual([]);
  });

  it("treats BucketAlreadyOwnedByYou on a retry as an unowned candidate", async () => {
    const h = harness({
      CreateBucket: () => {
        throw sdkError("BucketAlreadyOwnedByYou", 409, 2);
      },
    });
    const scenario = vi.fn(async () => undefined);
    const error = await rejection(withAwsRehearsal(scenario, h.deps));
    expect(error.message).toContain(BUCKET);
    expect(scenario).not.toHaveBeenCalled();
    expect(h.fake.names()).toEqual(["CreateBucket"]);
    const { parsed } = await receipt();
    expect(parsed.ownership).toEqual({
      bucket: null,
      state: "unowned-candidate",
      candidate: BUCKET,
    });
  });

  it("reports a refused creation as not created and deletes nothing", async () => {
    const h = harness({
      CreateBucket: () => {
        throw sdkError("AccessDenied", 403, 2);
      },
    });
    const error = await rejection(withAwsRehearsal(async () => undefined, h.deps));
    expect(error.message).not.toContain(SECRET);
    expect(h.fake.names()).toEqual(["CreateBucket"]);
    const { parsed } = await receipt();
    expect(parsed.ownership).toEqual({ bucket: null, state: "not-created" });
    expect(parsed.events[0]).toMatchObject({
      api: "CreateBucket",
      httpStatus: 403,
      errorName: "AccessDenied",
      attempts: 2,
      outcome: "failed",
    });
  });

  it.each([
    ["a timeout", () => sdkError("TimeoutError", undefined, 3)],
    ["no status", () => sdkError("NetworkingError", undefined, 3)],
    ["a 503", () => sdkError("ServiceUnavailable", 503, 3)],
    ["an abort", () => sdkError("AbortError", undefined, 1)],
  ])("leaves an unowned candidate after %s", async (_label, error) => {
    const h = harness({
      CreateBucket: () => {
        throw error();
      },
    });
    const scenario = vi.fn(async () => undefined);
    const thrown = await rejection(withAwsRehearsal(scenario, h.deps));
    expect(thrown.message).not.toContain(SECRET);
    expect(scenario).not.toHaveBeenCalled();
    expect(h.fake.names()).toEqual(["CreateBucket"]);
    const { parsed } = await receipt();
    expect(parsed.ownership).toEqual({
      bucket: null,
      state: "unowned-candidate",
      candidate: BUCKET,
    });
    expect(parsed.cleanupCommand).toBeNull();
  });
});

describe("withAwsRehearsal — preflight", () => {
  it.each([
    [
      "KMS encryption",
      {
        GetBucketEncryption: () => ({
          ...ok(),
          ServerSideEncryptionConfiguration: {
            Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: "aws:kms" } }],
          },
        }),
      },
      "encryption-not-sse-s3",
    ],
    [
      "no encryption rules",
      {
        GetBucketEncryption: () => ({ ...ok(), ServerSideEncryptionConfiguration: { Rules: [] } }),
      },
      "encryption-not-sse-s3",
    ],
    [
      "versioning Enabled",
      { GetBucketVersioning: () => ({ ...ok(), Status: "Enabled" }) },
      "versioning-not-off",
    ],
    [
      "versioning Suspended",
      { GetBucketVersioning: () => ({ ...ok(), Status: "Suspended" }) },
      "versioning-not-off",
    ],
  ] as [string, Record<string, Answer>, string][])(
    "refuses %s and still tears the bucket down",
    async (_label, overrides, reason) => {
      const h = harness(overrides);
      const scenario = vi.fn(async () => undefined);
      const error = await rejection(withAwsRehearsal(scenario, h.deps));
      expect((error as AwsRehearsalRefused).reason).toBe(reason);
      expect(scenario).not.toHaveBeenCalled();
      expect(h.fake.names().at(-1)).toBe("DeleteBucket");
      expect(h.fake.objects.size).toBe(0);
      expect((await receipt()).parsed.remaining.bucket).toBeNull();
    },
  );
});

describe("withAwsRehearsal — fixture limits", () => {
  it("refuses an upload past the total budget before any further command", async () => {
    const h = harness();
    let calls = 0;
    const error = await rejection(
      withAwsRehearsal(async (ctx) => {
        ctx.reserveUpload(100 * MIB, "fixture");
        calls = h.fake.calls.length;
        ctx.reserveUpload(28 * MIB, "fixture");
      }, h.deps),
    );
    expect((error as AwsRehearsalRefused).reason).toBe("fixture-limit");
    expect(h.fake.calls[calls]!.name).toBe("ListMultipartUploads");
    const { parsed } = await receipt();
    expect(parsed.events.some((event) => event.outcome === "refused")).toBe(true);
  });

  it("refuses an archive past its own limit", async () => {
    const h = harness();
    const error = await rejection(
      withAwsRehearsal(async (ctx) => {
        ctx.reserveUpload(AWS_REHEARSAL_LIMITS.archiveBytes, "archive");
        ctx.reserveUpload(AWS_REHEARSAL_LIMITS.archiveBytes + 1, "archive");
      }, h.deps),
    );
    expect((error as AwsRehearsalRefused).reason).toBe("fixture-limit");
  });

  it("caps the cumulative object count", async () => {
    const h = harness();
    const error = await rejection(
      withAwsRehearsal(async (ctx) => {
        ctx.reserveObjects(1000);
        ctx.reserveObjects(5);
        ctx.reserveObjects(1);
      }, h.deps),
    );
    expect((error as AwsRehearsalRefused).reason).toBe("fixture-limit");
  });
});

describe("withAwsRehearsal — teardown after a failure", () => {
  it("stops only live tracked children and aborts tracked and listed uploads", async () => {
    const alive = new Set([4242, 999]);
    const h = harness(
      {},
      {
        isAlive: (pid) => alive.has(pid),
        kill: (pid, signal) => {
          h.killed.push([pid, signal]);
          if (signal === "SIGKILL") alive.delete(pid);
        },
      },
    );
    h.fake.uploads.set("tracked-id", "rehearsal-run-0001/a/archive");
    h.fake.uploads.set("listed-id", "rehearsal-run-0001/a/other");
    const failure = new Error("scenario failed");
    const error = await rejection(
      withAwsRehearsal(async (ctx) => {
        ctx.trackChild(4242);
        ctx.trackChild(31337);
        ctx.trackUpload("rehearsal-run-0001/a/archive", "tracked-id");
        throw failure;
      }, h.deps),
    );
    expect(error).toBe(failure);
    expect(h.killed).toEqual([
      [4242, "SIGTERM"],
      [4242, "SIGKILL"],
    ]);
    const aborts = h.fake.calls.filter((call) => call.name === "AbortMultipartUpload");
    expect(aborts.map((call) => call.input.UploadId)).toEqual(["tracked-id", "listed-id"]);
    expect(h.fake.uploads.size).toBe(0);
    expect(h.fake.names().at(-1)).toBe("DeleteBucket");
  });

  it("ends a scenario that passes its deadline and still tears down", async () => {
    const h = harness({}, { deadlineMs: 50 });
    let signal: AbortSignal | undefined;
    const error = await rejection(
      withAwsRehearsal((ctx) => {
        signal = ctx.signal;
        return new Promise<never>(() => {});
      }, h.deps),
    );
    expect(error.message).toContain("deadline");
    expect(signal!.aborted).toBe(true);
    expect(h.fake.names().at(-1)).toBe("DeleteBucket");
    const { parsed } = await receipt();
    expect(parsed.events).toContainEqual(
      expect.objectContaining({ phase: "deadline", outcome: "failed" }),
    );
  });

  it("lets a scenario that honours its signal settle before teardown starts", async () => {
    let settled = false;
    const settledAtTeardown: boolean[] = [];
    const h = harness(
      {
        ListMultipartUploads: () => {
          settledAtTeardown.push(settled);
          return { ...ok(), Uploads: [] };
        },
      },
      { deadlineMs: 20, settleMs: 5_000 },
    );
    const error = await rejection(
      withAwsRehearsal(
        (ctx) =>
          new Promise<never>((_, reject) => {
            ctx.signal.addEventListener("abort", () => {
              setTimeout(() => {
                settled = true;
                reject(new Error("scenario stopped"));
              }, 20);
            });
          }),
        h.deps,
      ),
    );
    expect(error.message).toContain("deadline");
    expect(settledAtTeardown[0]).toBe(true);
    expect(h.fake.names().at(-1)).toBe("DeleteBucket");
    const { parsed } = await receipt();
    expect(parsed.events).toContainEqual(
      expect.objectContaining({ phase: "settle", outcome: "ok" }),
    );
  });

  it("starts teardown after the grace when a scenario never settles", async () => {
    let teardownAt: number | undefined;
    const h = harness(
      {
        ListMultipartUploads: () => {
          teardownAt ??= performance.now();
          return { ...ok(), Uploads: [] };
        },
      },
      { deadlineMs: 20, settleMs: 200 },
    );
    let abortedAt: number | undefined;
    await rejection(
      withAwsRehearsal((ctx) => {
        ctx.signal.addEventListener("abort", () => {
          abortedAt = performance.now();
        });
        return new Promise<never>(() => {});
      }, h.deps),
    );
    expect(teardownAt! - abortedAt!).toBeGreaterThanOrEqual(190);
    expect(teardownAt! - abortedAt!).toBeLessThan(2_000);
    const { parsed } = await receipt();
    expect(parsed.events).toContainEqual(
      expect.objectContaining({ phase: "settle", outcome: "failed" }),
    );
  });

  it("passes the teardown signal to every teardown command", async () => {
    const h = harness();
    await withAwsRehearsal(async () => undefined, h.deps);
    const teardown = h.fake.calls.slice(4);
    expect(teardown.length).toBeGreaterThan(0);
    for (const call of teardown) expect(call.signal).toBeInstanceOf(AbortSignal);
    expect(new Set(teardown.map((call) => call.signal)).size).toBe(1);
  });
});

describe("withAwsRehearsal — a teardown that fails", () => {
  const cleanup = (path: string) =>
    'WAITRON_RUN_AWS_REHEARSAL=1 AWS_SHARED_CREDENTIALS_FILE="$HOME/.config/waitron-cloud/aws/credentials" ' +
    'AWS_CONFIG_FILE="$HOME/.config/waitron-cloud/aws/config" AWS_PROFILE=waitron-rehearsal ' +
    `AWS_REGION=eu-north-1 pnpm --filter @waitron/server exec tsx scripts/aws-rehearsal-cleanup.ts --receipt ${path}`;

  async function failedRun(
    h: Harness,
    scenario: (ctx: AwsRehearsal) => Promise<void> = async () => {},
  ) {
    const error = await rejection(withAwsRehearsal(scenario, h.deps));
    const path = join(receiptDir, `aws-rehearsal-${RUN_ID}.json`);
    expect(error.message).toContain(path);
    expect(error.message).not.toContain(SECRET);
    const { parsed } = await receipt();
    expect(parsed.remaining.bucket).toBe(BUCKET);
    expect(parsed.cleanupCommand).toBe(cleanup(path));
    return { error, parsed };
  }

  it("fails on a per-key DeleteObjects error even with HTTP 200, and keeps the nonce", async () => {
    const h = harness({
      DeleteObjects: (input) => ({
        ...ok(),
        Errors: [
          {
            Key: (input.Delete as { Objects: { Key: string }[] }).Objects[0]!.Key,
            Code: "AccessDenied",
          },
        ],
      }),
    });
    const { error, parsed } = await failedRun(h, async (ctx) => {
      h.fake.objects.set(`${ctx.prefix("x")}object`, "");
    });
    expect(error.message).toContain("delete-objects");
    expect(parsed.teardown.find((entry) => entry.step === "delete-objects")!.outcome).toBe(
      "failed",
    );
    expect(h.fake.objects.has(NONCE)).toBe(true);
    expect(h.fake.calls.filter((call) => call.name === "DeleteObject")).toEqual([]);
  });

  it("fails when DeleteBucket fails", async () => {
    const h = harness({
      DeleteBucket: () => {
        throw sdkError("InternalError", 500, 3);
      },
    });
    const { parsed } = await failedRun(h);
    expect(parsed.teardown.find((entry) => entry.step === "delete-bucket")).toMatchObject({
      outcome: "failed",
      errorName: "InternalError",
      httpStatus: 500,
    });
  });

  it("names an upload it could not abort", async () => {
    const id = "2~Ab+cd/ef=gh";
    const h = harness({
      AbortMultipartUpload: () => {
        throw sdkError("AccessDenied", 403, 2);
      },
    });
    h.fake.uploads.set(id, "rehearsal-run-0001/a/archive");
    const { parsed } = await failedRun(h);
    expect(parsed.remaining.uploadIds).toEqual([id]);
  });

  it("stops a listing that repeats its continuation token", async () => {
    const h = harness({
      ListObjectsV2: () => ({
        ...ok(),
        Contents: [{ Key: "k" }],
        IsTruncated: true,
        NextContinuationToken: "same",
      }),
    });
    const { parsed } = await failedRun(h);
    expect(h.fake.calls.filter((call) => call.name === "ListObjectsV2").length).toBeLessThanOrEqual(
      3,
    );
    expect(parsed.teardown.find((entry) => entry.step === "delete-objects")!.outcome).toBe(
      "failed",
    );
  });

  it("attaches a teardown failure to the scenario's own error", async () => {
    const h = harness({
      DeleteBucket: () => {
        throw sdkError("InternalError", 500, 3);
      },
    });
    const failure = new Error("scenario failed");
    const error = await rejection(
      withAwsRehearsal(async () => {
        throw failure;
      }, h.deps),
    );
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors[0]).toBe(failure);
    expect(String((error as AggregateError).errors[1])).toContain("delete-bucket");
  });
});

describe("teardownOwnedBucket", () => {
  it("deletes 1,001 objects in batches of 1,000 and 1, then the nonce, then the bucket", async () => {
    const fake = new FakeAdmin();
    for (let index = 0; index < 1001; index += 1)
      fake.objects.set(`p/${String(index).padStart(4, "0")}`, "");
    fake.objects.set(NONCE, "");
    const result = await teardownOwnedBucket(
      fake,
      { bucket: BUCKET, runId: RUN_ID, uploads: [], pids: [] },
      {
        isAlive: () => false,
        kill: () => {},
        sleep: async () => {},
        now: () => 0,
        teardownMs: 1000,
      },
    );
    const batches = fake.calls
      .filter((call) => call.name === "DeleteObjects")
      .map((call) =>
        (call.input.Delete as { Objects: { Key: string }[] }).Objects.map((o) => o.Key),
      );
    expect(batches.map((batch) => batch.length)).toEqual([1000, 1]);
    expect(batches.flat()).not.toContain(NONCE);
    const names = fake.names();
    const nonceDelete = names.indexOf("DeleteObject");
    expect(fake.calls[nonceDelete]!.input.Key).toBe(NONCE);
    expect(nonceDelete).toBeGreaterThan(names.lastIndexOf("DeleteObjects"));
    expect(names.at(-1)).toBe("DeleteBucket");
    expect(result.remaining).toEqual({ bucket: null, uploadIds: [] });
    expect(result.entries.map((entry) => entry.step)).toEqual([
      "stop-child",
      "abort-upload",
      "remove-policy",
      "delete-objects",
      "delete-bucket",
    ]);
    expect(await readdir(dir)).not.toContain("receipts");
  });
});

describe("7c fix round 1", () => {
  it("refuses, before creating anything, a folder that fits the run's receipt name but not the cleanup's", async () => {
    const commandFor = (folder: string, name: string) =>
      cleanupCommandFor("eu-north-1", join(folder, name));
    const runName = `aws-rehearsal-${RUN_ID}.json`;
    const cleanupName = `aws-rehearsal-${RUN_ID}-cleanup.json`;
    const pad = 512 - commandFor(join(dir, "x"), runName).length;
    const folder = join(dir, "x".repeat(1 + pad));
    expect(isReceiptCleanupCommand(commandFor(folder, runName))).toBe(true);
    expect(isReceiptCleanupCommand(commandFor(folder, cleanupName))).toBe(false);
    const h = harness({}, { receiptDir: folder });
    const error = await rejection(withAwsRehearsal(async () => undefined, h.deps));
    expect((error as AwsRehearsalRefused).reason).toBe("receipt-dir-unsupported");
    expect(error.message).toContain("too long");
    expect(h.fake.calls).toEqual([]);
  });

  it("refuses a run id too long for the cleanup receipt's name, saying so", async () => {
    const h = harness({}, { runId: () => "r".repeat(60) });
    const error = await rejection(withAwsRehearsal(async () => undefined, h.deps));
    expect((error as AwsRehearsalRefused).reason).toBe("run-id-unsupported");
    expect(h.fake.calls).toEqual([]);
  });

  it("refuses a region the cleanup command cannot carry, saying so", async () => {
    await writeFile(configFile, "[profile waitron-rehearsal]\nregion = eusc-de-east-1\n");
    const h = harness({}, { env: env({ AWS_REGION: "eusc-de-east-1" }) });
    const error = await rejection(withAwsRehearsal(async () => undefined, h.deps));
    expect((error as AwsRehearsalRefused).reason).toBe("region-unsupported");
    expect(h.fake.calls).toEqual([]);
  });

  it("raises a print failure beside a teardown failure rather than instead of it", async () => {
    const printFailure = new Error("stdout closed");
    const h = harness(
      {
        DeleteBucket: () => {
          throw sdkError("InternalError", 500, 1);
        },
      },
      {
        print: () => {
          throw printFailure;
        },
      },
    );
    const error = await rejection(withAwsRehearsal(async () => "done", h.deps));
    expect(error).toBeInstanceOf(AggregateError);
    const errors = (error as AggregateError).errors;
    expect(String(errors[0])).toContain("delete-bucket");
    expect(errors[1]).toBe(printFailure);
    expect(error.message).not.toContain(SECRET);
  });

  it("uses one profile name for the profile check and the cleanup command", () => {
    expect(cleanupCommandFor("eu-north-1", "/tmp/aws-rehearsal-x.json")).toContain(
      `AWS_PROFILE=${AWS_REHEARSAL_PROFILE} `,
    );
  });
});

describe("fix round 1", () => {
  it("refuses, before creating anything, a receipt folder whose cleanup command would be too long", async () => {
    const long = join(dir, "x".repeat(170));
    const h = harness({}, { receiptDir: long });
    const error = await rejection(withAwsRehearsal(async () => undefined, h.deps));
    expect((error as AwsRehearsalRefused).reason).toBe("receipt-dir-unsupported");
    expect(h.fake.calls).toEqual([]);
  });

  it.each(["has space", 'has"quote', "https://x/y", `id${SECRET}`])(
    "refuses to track the upload id %j and tracks nothing",
    async (id) => {
      const h = harness();
      let refusal: unknown;
      await withAwsRehearsal(async (ctx) => {
        try {
          ctx.trackUpload("rehearsal-run-0001/a/k", id);
        } catch (error) {
          refusal = error;
        }
      }, h.deps);
      expect((refusal as AwsRehearsalRefused).reason).toBe("upload-id-refused");
      expect((refusal as Error).message).not.toContain(SECRET);
      expect(h.fake.calls.filter((call) => call.name === "AbortMultipartUpload")).toEqual([]);
    },
  );

  it("refuses a bad child pid with its own reason", async () => {
    const h = harness();
    let refusal: unknown;
    await withAwsRehearsal(async (ctx) => {
      try {
        ctx.trackChild(0);
      } catch (error) {
        refusal = error;
      }
    }, h.deps);
    expect((refusal as AwsRehearsalRefused).reason).toBe("child-pid-refused");
  });

  it("refuses tracking once teardown has started", async () => {
    const h = harness({}, { deadlineMs: 20 });
    let ctx: AwsRehearsal | undefined;
    await rejection(
      withAwsRehearsal((given) => {
        ctx = given;
        return new Promise<never>(() => {});
      }, h.deps),
    );
    expect(() => ctx!.trackUpload("k", "id")).toThrow(AwsRehearsalRefused);
    expect(() => ctx!.trackChild(4242)).toThrow(AwsRehearsalRefused);
    for (const track of [() => ctx!.trackUpload("k", "id"), () => ctx!.trackChild(4242)]) {
      let refusal: unknown;
      try {
        track();
      } catch (error) {
        refusal = error;
      }
      expect((refusal as AwsRehearsalRefused).reason).toBe("teardown-started");
    }
  });

  it("does not call a written receipt unwritten when printing its path fails", async () => {
    const printFailure = new Error("stdout closed");
    const h = harness(
      {},
      {
        print: () => {
          throw printFailure;
        },
      },
    );
    const error = await rejection(withAwsRehearsal(async () => "done", h.deps));
    expect(error).toBe(printFailure);
    expect(await readdir(receiptDir)).toEqual([`aws-rehearsal-${RUN_ID}.json`]);
  });

  it("aborts the scenario's signal when the scenario rejects", async () => {
    const h = harness();
    let signal: AbortSignal | undefined;
    await rejection(
      withAwsRehearsal(async (ctx) => {
        signal = ctx.signal;
        throw new Error("scenario failed");
      }, h.deps),
    );
    expect(signal!.aborted).toBe(true);
  });

  it("keeps the scenario and teardown errors and names the bucket when the receipt cannot be written", async () => {
    const blocker = join(dir, "not-a-folder");
    await writeFile(blocker, "");
    const h = harness(
      {
        DeleteBucket: () => {
          throw sdkError("InternalError", 500, 3);
        },
      },
      { receiptDir: blocker },
    );
    const failure = new Error("scenario failed");
    const error = await rejection(
      withAwsRehearsal(async () => {
        throw failure;
      }, h.deps),
    );
    expect(error).toBeInstanceOf(AggregateError);
    const errors = (error as AggregateError).errors;
    expect(errors[0]).toBe(failure);
    expect(String(errors[1])).toContain("delete-bucket");
    expect(errors).toHaveLength(3);
    expect(error.message).toContain(BUCKET);
    expect(error.message).toContain("delete-bucket");
    expect(error.message).not.toContain(SECRET);
    expect(h.printed).toEqual([]);
  });

  it("puts the ownership marker back when DeleteBucket fails after deleting it", async () => {
    const h = harness({
      DeleteBucket: () => {
        throw sdkError("InternalError", 500, 3);
      },
    });
    await rejection(withAwsRehearsal(async () => undefined, h.deps));
    const names = h.fake.names();
    expect(names.slice(-2)).toEqual(["DeleteBucket", "PutObject"]);
    expect(h.fake.calls.at(-1)!.input).toMatchObject({
      Bucket: BUCKET,
      Key: NONCE,
      Body: JSON.stringify({ runId: RUN_ID }),
    });
    expect(h.fake.objects.has(NONCE)).toBe(true);
    const { parsed } = await receipt();
    expect(parsed.events.at(-1)).toMatchObject({
      phase: "restore-nonce",
      api: "PutObject",
      objectRole: "ownership-nonce",
      outcome: "ok",
    });
  });

  it("records a failed marker restore", async () => {
    let puts = 0;
    const h = harness({
      PutObject: (input, fake) => {
        puts += 1;
        if (puts > 1) throw sdkError("AccessDenied", 403, 1);
        fake.objects.set(input.Key as string, "");
        return ok();
      },
      DeleteBucket: () => {
        throw sdkError("InternalError", 500, 3);
      },
    });
    await rejection(withAwsRehearsal(async () => undefined, h.deps));
    const { parsed } = await receipt();
    expect(parsed.events.at(-1)).toMatchObject({ phase: "restore-nonce", outcome: "failed" });
  });

  it("does not put the marker back when the bucket is already gone", async () => {
    const h = harness({
      DeleteBucket: () => {
        throw sdkError("NoSuchBucket", 404, 1);
      },
    });
    await withAwsRehearsal(async () => undefined, h.deps);
    expect(h.fake.names().at(-1)).toBe("DeleteBucket");
  });
});

describe("finish-branch review: failures that must still reach teardown and the receipt", () => {
  it("aborts the signal and tears down when the scenario throws before returning a promise", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const h = harness({}, { deadlineMs: 30 });
      let signal: AbortSignal | undefined;
      const failure = new Error("sync failure");
      const error = await rejection(
        withAwsRehearsal((ctx) => {
          signal = ctx.signal;
          throw failure;
        }, h.deps),
      );
      expect(error).toBe(failure);
      expect(signal!.aborted).toBe(true);
      expect(h.fake.names().at(-1)).toBe("DeleteBucket");
      await delay(80);
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("runs every teardown step and writes the receipt when the receipt refuses an error name", async () => {
    const h = harness({
      DeleteBucketPolicy: () => {
        throw sdkError(`Denied${SECRET}`, 403, 1);
      },
    });
    const error = await rejection(
      withAwsRehearsal(async (ctx) => {
        h.fake.objects.set(`${ctx.prefix("x")}object`, "");
      }, h.deps),
    );
    expect(error.message).not.toContain(SECRET);
    expect(h.fake.names().slice(-3)).toEqual(["DeleteObjects", "DeleteObject", "DeleteBucket"]);
    const { parsed, text } = await receipt();
    expect(text).not.toContain(SECRET);
    expect(parsed.remaining.bucket).toBe(BUCKET);
    expect(parsed.teardown.find((entry) => entry.step === "remove-policy")).toEqual({
      step: "remove-policy",
      outcome: "failed",
    });
    expect(parsed.events).toContainEqual({
      scenario: "lifecycle",
      phase: "record-refused",
      outcome: "refused",
    });
    expect(parsed.teardown.find((entry) => entry.step === "delete-bucket")!.outcome).toBe("ok");
  });

  it("reports a refused receipt entry beside the run's own failure", async () => {
    const h = harness({
      GetBucketVersioning: () => {
        throw Object.assign(new Error("x"), { name: `N${SECRET}`, $metadata: {} });
      },
    });
    const error = await rejection(withAwsRehearsal(async () => undefined, h.deps));
    expect(error).toBeInstanceOf(AggregateError);
    const errors = (error as AggregateError).errors.map(String);
    expect(errors[0]).toContain("versioning-not-off");
    expect(errors[1]).toContain("receipt entr");
    expect(error.message).not.toContain(SECRET);
    expect((await receipt()).parsed.remaining.bucket).toBeNull();
  });

  it("still refuses the scenario's own entry where it is recorded", async () => {
    const h = harness();
    const error = await rejection(
      withAwsRehearsal(async (ctx) => {
        ctx.record({ scenario: "loop", phase: `p${SECRET}`, outcome: "ok" });
      }, h.deps),
    );
    expect(error.message).toBe("receipt field refused: phase");
    expect(h.fake.names().at(-1)).toBe("DeleteBucket");
  });

  it("counts creating, marking and checking the bucket against the deadline", async () => {
    const h = harness(
      {
        GetBucketEncryption: async () => {
          await delay(80);
          return {
            ...ok(),
            ServerSideEncryptionConfiguration: {
              Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } }],
            },
          };
        },
      },
      { deadlineMs: 5, settleMs: 1_000 },
    );
    const scenario = vi.fn(async () => undefined);
    const error = await rejection(withAwsRehearsal(scenario, h.deps));
    expect(error.message).toContain("deadline");
    expect(scenario).not.toHaveBeenCalled();
    expect(h.fake.names().slice(0, 3)).toEqual([
      "CreateBucket",
      "PutObject",
      "GetBucketEncryption",
    ]);
    expect(h.fake.calls[0]!.signal).toBeInstanceOf(AbortSignal);
    expect(h.fake.names()).not.toContain("GetBucketVersioning");
    expect(h.fake.names().at(-1)).toBe("DeleteBucket");
  });

  it("records an unknown creation when the deadline passes before CreateBucket answers", async () => {
    const h = harness({ CreateBucket: () => new Promise(() => {}) }, { deadlineMs: 5 });
    const scenario = vi.fn(async () => undefined);
    const error = await rejection(withAwsRehearsal(scenario, h.deps));
    expect(error.message).toContain("deadline");
    expect(scenario).not.toHaveBeenCalled();
    expect(h.fake.names()).toEqual(["CreateBucket"]);
    expect(h.fake.calls[0]!.signal!.aborted).toBe(true);
    expect((await receipt()).parsed.ownership).toEqual({
      bucket: null,
      state: "unowned-candidate",
      candidate: BUCKET,
    });
  });

  it("an outside stop ends a running scenario, waits for teardown and the receipt", async () => {
    const h = harness();
    const lifecycle = rehearsalLifecycle(h.deps);
    let signal: AbortSignal | undefined;
    const run = lifecycle
      .run((ctx) => {
        signal = ctx.signal;
        return new Promise<never>(() => {});
      })
      .then(
        () => undefined,
        (error: unknown) => error as Error,
      );
    await vi.waitFor(() => expect(signal).toBeDefined());
    await lifecycle.stop();
    expect(signal!.aborted).toBe(true);
    expect(h.fake.names().at(-1)).toBe("DeleteBucket");
    const { parsed } = await receipt();
    expect(parsed.events).toContainEqual(
      expect.objectContaining({ phase: "interrupt", outcome: "failed" }),
    );
    expect((await run)!.message).toContain("stopped");
  });

  it("an outside stop after the run finished sends nothing more", async () => {
    const h = harness();
    const lifecycle = rehearsalLifecycle(h.deps);
    await lifecycle.run(async () => "done");
    const sent = h.fake.calls.length;
    await lifecycle.stop();
    expect(h.fake.calls.length).toBe(sent);
  });

  it("refuses a run whose outside signal is already aborted before building a client", async () => {
    const h = harness({}, { signal: AbortSignal.abort() });
    await rejection(withAwsRehearsal(async () => undefined, h.deps));
    expect(h.createAdminClient).not.toHaveBeenCalled();
  });
});

describe("finish-branch review: child shutdown", () => {
  it("keeps child shutdown inside the teardown budget", async () => {
    const fake = new FakeAdmin();
    let alive = true;
    const started = performance.now();
    const result = await teardownOwnedBucket(
      fake,
      { bucket: BUCKET, runId: RUN_ID, uploads: [], pids: [101, 102, 103] },
      {
        now: Date.now,
        teardownMs: 10,
        isAlive: () => alive,
        kill: () => {},
        sleep: async () => {
          await delay(60);
          alive = false;
        },
      },
    );
    expect(performance.now() - started).toBeLessThan(40);
    expect(result.entries[0]).toEqual({ step: "stop-child", outcome: "failed", count: 3 });
  });

  it("records a real child that ignores SIGTERM as stopped once SIGKILL ends it", async () => {
    const child = spawn(
      process.execPath,
      ["-e", "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000);"],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    const exited = new Promise<NodeJS.Signals | null>((resolve) =>
      child.once("exit", (_code, signal) => resolve(signal)),
    );
    try {
      await new Promise<void>((resolve) => child.stdout!.once("data", () => resolve()));
      const result = await teardownOwnedBucket(
        new FakeAdmin(),
        { bucket: BUCKET, runId: RUN_ID, uploads: [], pids: [child.pid!] },
        {
          now: Date.now,
          teardownMs: 10_000,
          childGraceMs: 200,
          isAlive: (pid) => {
            try {
              process.kill(pid, 0);
              return true;
            } catch {
              return false;
            }
          },
          kill: (pid, signal) => process.kill(pid, signal),
          sleep: (ms) => delay(ms),
        },
      );
      expect(result.entries[0]).toEqual({ step: "stop-child", outcome: "ok", count: 1 });
      expect(await exited).toBe("SIGKILL");
    } finally {
      if (child.exitCode === null && child.signalCode === null) process.kill(child.pid!, "SIGKILL");
    }
  });
});

describe("finish-branch review: refusals before any request", () => {
  it("refuses us-east-1, where re-creating an owned bucket answers success, before any client", async () => {
    await writeFile(configFile, "[profile waitron-rehearsal]\nregion = us-east-1\n");
    const h = harness({}, { env: env({ AWS_REGION: "us-east-1" }) });
    h.fake.objects.set("other-run-data", "");
    const error = await rejection(withAwsRehearsal(async () => undefined, h.deps));
    expect((error as AwsRehearsalRefused).reason).toBe("region-unsupported");
    expect(error.message).toContain("us-east-1");
    expect(h.createAdminClient).not.toHaveBeenCalled();
    expect(h.fake.calls).toEqual([]);
    expect(h.fake.objects.has("other-run-data")).toBe(true);
  });

  it("refuses a long receipt folder of allowed characters for its length, not its characters", async () => {
    const folder = join(dir, "x".repeat(300));
    const h = harness({}, { receiptDir: folder });
    const error = await rejection(withAwsRehearsal(async () => undefined, h.deps));
    expect((error as AwsRehearsalRefused).reason).toBe("receipt-dir-unsupported");
    expect(error.message).toContain("too long");
    expect(error.message).not.toContain("may hold only");
    expect(h.fake.calls).toEqual([]);
  });

  it("refuses an empty run id as a run id, which the cleanup receipt's name alone would accept", async () => {
    const h = harness({}, { runId: () => "" });
    const error = await rejection(withAwsRehearsal(async () => undefined, h.deps));
    expect((error as AwsRehearsalRefused).reason).toBe("run-id-unsupported");
    expect(h.fake.calls).toEqual([]);
  });
});
