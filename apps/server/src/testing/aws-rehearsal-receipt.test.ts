import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AwsReceiptEvent,
  type ReceiptLog,
  actionTable,
  createReceiptLog,
  sanitizeEvent,
  writeReceipt,
} from "./aws-rehearsal-receipt.js";

const SECRET = "wJalrXUtnFEMI/K7MDENG+bPxRfiCY";
const ACCESS_KEY_ID = "AKIAIOSFODNN7EXAMPLE";
const SIGNED_URL =
  "https://waitron-rehearsal-waitron-abc123def456.s3.eu-north-1.amazonaws.com/k?X-Amz-Signature=deadbeef";
const BUCKET = "waitron-rehearsal-waitron-abc123def456";
// A real secret's shape with no "/" or "+", so the token alphabet alone admits it.
const PLAIN_SECRET = "wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY12";
const KEYS = { accessKeyId: ACCESS_KEY_ID, secretAccessKey: PLAIN_SECRET };

const header = {
  runId: "run-1",
  commit: "441942398",
  node: "v26.7.0",
  sdkVersion: "3.1140.0",
  litestreamVersion: "v0.5.17",
  region: "eu-north-1",
  startedAt: "2026-10-14T10:00:00.000Z",
  limits: { archiveBytes: 1024, deleteObjects: 5 },
};

const finishParts = {
  finishedAt: "2026-10-14T10:05:00.000Z",
  ownership: { bucket: BUCKET, state: "owned" as const },
  remaining: { bucket: null, uploadIds: [] },
  cleanupCommand: null,
};

function runnerCommand(region: string, receiptPath: string): string {
  return (
    'WAITRON_RUN_AWS_REHEARSAL=1 AWS_SHARED_CREDENTIALS_FILE="$HOME/.config/waitron-cloud/aws/credentials" ' +
    'AWS_CONFIG_FILE="$HOME/.config/waitron-cloud/aws/config" AWS_PROFILE=waitron-rehearsal ' +
    `AWS_REGION=${region} pnpm --filter @waitron/server exec tsx scripts/aws-rehearsal-cleanup.ts ` +
    `--receipt ${receiptPath}`
  );
}

/** An owned bucket's receipt is refused without these steps, so a log that finishes one carries them. */
function tornDown(log: ReceiptLog): ReceiptLog {
  for (const step of [
    "stop-child",
    "abort-upload",
    "remove-policy",
    "delete-objects",
    "delete-bucket",
  ] as const) {
    log.teardown({ step, outcome: "ok" });
  }
  return log;
}

function refusalOf(run: () => unknown): Error {
  try {
    run();
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected a refusal");
}

describe("sanitizeEvent", () => {
  it("keeps every allowlisted field unchanged", () => {
    const event: AwsReceiptEvent = {
      scenario: "stream-loop",
      phase: "upload",
      api: "PutObject",
      objectRole: "ltx",
      count: 3,
      bytes: 4096,
      httpStatus: 200,
      errorName: "AccessDenied",
      attempts: 1,
      elapsedMs: 12.5,
      outcome: "ok",
    };
    expect(sanitizeEvent(event)).toEqual(event);
    expect(
      sanitizeEvent({ scenario: "s", phase: "p", httpStatus: null, outcome: "failed" }),
    ).toEqual({ scenario: "s", phase: "p", httpStatus: null, outcome: "failed" });
  });

  it.each([
    ["unknown key", { scenario: "s", phase: "p", outcome: "ok", message: SECRET }, "message"],
    ["Error object", { scenario: "s", phase: "p", outcome: "ok", api: new Error(SECRET) }, "api"],
    ["signed URL", { scenario: SIGNED_URL, phase: "p", outcome: "ok" }, "scenario"],
    ["secret-looking string", { scenario: "s", phase: SECRET, outcome: "ok" }, "phase"],
    [
      "access key id in a number field",
      { scenario: "s", phase: "p", outcome: "ok", count: ACCESS_KEY_ID },
      "count",
    ],
    [
      "access key id in a token field",
      { scenario: "s", phase: "p", outcome: "ok", objectRole: ACCESS_KEY_ID },
      "objectRole",
    ],
    ["unlisted outcome", { scenario: "s", phase: "p", outcome: SECRET }, "outcome"],
    ["missing scenario", { phase: "p", outcome: "ok" }, "scenario"],
    ["negative bytes", { scenario: "s", phase: "p", outcome: "ok", bytes: -1 }, "bytes"],
    ["fractional count", { scenario: "s", phase: "p", outcome: "ok", count: 1.5 }, "count"],
    [
      "status out of range",
      { scenario: "s", phase: "p", outcome: "ok", httpStatus: 99 },
      "httpStatus",
    ],
    ["zero attempts", { scenario: "s", phase: "p", outcome: "ok", attempts: 0 }, "attempts"],
    [
      "infinite elapsed",
      { scenario: "s", phase: "p", outcome: "ok", elapsedMs: Infinity },
      "elapsedMs",
    ],
    [
      "error name object",
      { scenario: "s", phase: "p", outcome: "ok", errorName: new Error(SECRET) },
      "errorName",
    ],
  ])("refuses %s, naming the key and not the value", (_label, input, key) => {
    const error = refusalOf(() => sanitizeEvent(input));
    expect(error.message).toBe(`receipt field refused: ${key}`);
    expect(error.message).not.toContain(SECRET);
    expect(error.message).not.toContain(ACCESS_KEY_ID);
    expect(error.cause).toBeUndefined();
  });

  it.each([null, "event", [1], new Error(SECRET)])("refuses a non-object event %#", (input) => {
    expect(refusalOf(() => sanitizeEvent(input)).message).toBe("receipt field refused: event");
  });

  it("replaces an unvetted error name with Unlisted", () => {
    const base = { scenario: "s", phase: "p", outcome: "failed" };
    expect(sanitizeEvent({ ...base, errorName: "<script>" }).errorName).toBe("Unlisted");
    expect(sanitizeEvent({ ...base, errorName: `A${"b".repeat(64)}` }).errorName).toBe("Unlisted");
    expect(sanitizeEvent({ ...base, errorName: SECRET }).errorName).toBe("Unlisted");
    expect(sanitizeEvent({ ...base, errorName: "NoSuchBucket" }).errorName).toBe("NoSuchBucket");
  });
});

describe("createReceiptLog", () => {
  it("never serialises a refused event", () => {
    const log = tornDown(createReceiptLog(header, KEYS));
    log.record({ scenario: "s", phase: "p", outcome: "ok", api: "PutObject", httpStatus: 200 });
    expect(() => log.record({ scenario: "s", phase: SECRET, outcome: "ok" })).toThrow(
      "receipt field refused: phase",
    );
    expect(() =>
      log.record({ scenario: "s", phase: "p", outcome: "ok", detail: SIGNED_URL }),
    ).toThrow("receipt field refused: detail");
    const json = JSON.stringify(log.finish(finishParts));
    expect(json).not.toContain(SECRET);
    expect(json).not.toContain("X-Amz-Signature");
    const receipt = log.finish(finishParts);
    expect(receipt.events).toHaveLength(1);
    expect(receipt.header).toEqual({ ...header, finishedAt: finishParts.finishedAt });
    expect(receipt.ownership).toEqual(finishParts.ownership);
    expect(receipt.actions.find((row) => row.api === "PutObject")?.status).toBe("observed");
  });

  it("vets teardown entries like events", () => {
    const log = createReceiptLog(header, KEYS);
    log.teardown({ step: "delete-bucket", outcome: "failed", errorName: "<b>", httpStatus: 409 });
    log.teardown({ step: "delete-objects", outcome: "ok", count: 2, errorName: "BucketNotEmpty" });
    expect(
      log.finish({ ...finishParts, ownership: { bucket: null, state: "not-created" } }).teardown,
    ).toEqual([
      { step: "delete-bucket", outcome: "failed", errorName: "Unlisted", httpStatus: 409 },
      { step: "delete-objects", outcome: "ok", count: 2, errorName: "BucketNotEmpty" },
    ]);
    for (const [entry, key] of [
      [{ step: "delete-bucket", outcome: "ok", note: SECRET }, "note"],
      [{ step: SECRET, outcome: "ok" }, "step"],
      [{ step: "inventory", outcome: "observed" }, "outcome"],
      [{ step: "inventory", outcome: "ok", count: ACCESS_KEY_ID }, "count"],
      [{ step: "inventory", outcome: "ok", httpStatus: 600 }, "httpStatus"],
      [{ step: "inventory", outcome: "ok", errorName: 3 }, "errorName"],
    ] as const) {
      const error = refusalOf(() => log.teardown(entry as never));
      expect(error.message).toBe(`receipt field refused: ${key}`);
      expect(error.message).not.toContain(SECRET);
    }
  });

  it.each([
    [
      "owned bucket",
      { ownership: { bucket: "waitron-rehearsal-someone-else", state: "owned" } },
      "ownership.bucket",
    ],
    [
      "uppercase bucket",
      { ownership: { bucket: "waitron-rehearsal-waitron-ABC123DEF456", state: "owned" } },
      "ownership.bucket",
    ],
    [
      "candidate",
      { ownership: { bucket: null, state: "unowned-candidate", candidate: "other-bucket" } },
      "ownership.candidate",
    ],
    ["ownership state", { ownership: { bucket: null, state: "mine" } }, "ownership.state"],
    [
      "remaining bucket",
      { remaining: { bucket: "lane-d-bucket", uploadIds: [] } },
      "remaining.bucket",
    ],
    [
      "upload id",
      { remaining: { bucket: BUCKET, uploadIds: [SIGNED_URL] } },
      "remaining.uploadIds",
    ],
    ["cleanup command", { cleanupCommand: `cleanup ${SIGNED_URL}` }, "cleanupCommand"],
    ["finishedAt", { finishedAt: SECRET }, "header.finishedAt"],
  ])("refuses a bad %s in the receipt", (_label, override, key) => {
    const log = createReceiptLog(header, KEYS);
    const error = refusalOf(() => log.finish({ ...finishParts, ...override } as never));
    expect(error.message).toBe(`receipt field refused: ${key}`);
  });

  it("refuses a bad header", () => {
    expect(refusalOf(() => createReceiptLog({ ...header, region: SIGNED_URL }, KEYS)).message).toBe(
      "receipt field refused: header.region",
    );
    expect(
      refusalOf(() =>
        createReceiptLog({ ...header, limits: { archiveBytes: SECRET } as never }, KEYS),
      ).message,
    ).toBe("receipt field refused: header.limits");
  });

  it("keeps an unowned candidate and opaque upload ids", () => {
    const receipt = createReceiptLog(header, KEYS).finish({
      ...finishParts,
      ownership: { bucket: null, state: "unowned-candidate", candidate: BUCKET },
      remaining: { bucket: BUCKET, uploadIds: ["2~iCw_lDY8VoNTLVzOhy1YR.KD0Xb-x"] },
      cleanupCommand: runnerCommand("eu-north-1", "/tmp/aws-rehearsal-run-1.json"),
    });
    expect(receipt.ownership.candidate).toBe(BUCKET);
    expect(receipt.remaining.uploadIds).toEqual(["2~iCw_lDY8VoNTLVzOhy1YR.KD0Xb-x"]);
  });
});

describe("actionTable", () => {
  const events = [
    sanitizeEvent({ scenario: "s", phase: "p", api: "PutObject", httpStatus: 200, outcome: "ok" }),
    sanitizeEvent({
      scenario: "s",
      phase: "p",
      api: "ListObjectsV2",
      httpStatus: 403,
      outcome: "failed",
    }),
    sanitizeEvent({ scenario: "s", phase: "p", api: "GetObject", outcome: "failed" }),
    sanitizeEvent({
      scenario: "s",
      phase: "p",
      api: "HeadObject",
      httpStatus: null,
      outcome: "failed",
    }),
  ];

  it("separates observed, source-only and not-exercised calls", () => {
    const table = actionTable(events, ["GetObject", "UploadPart", "PutObject"]);
    const status = Object.fromEntries(table.map((row) => [row.api, row.status]));
    expect(status).toMatchObject({
      PutObject: "observed",
      ListObjectsV2: "observed",
      GetObject: "source-only",
      UploadPart: "source-only",
      HeadObject: "not-exercised",
      CreateBucket: "not-exercised",
    });
    expect(table.map((row) => row.api)).toEqual([
      "GetObject",
      "PutObject",
      "ListObjectsV2",
      "DeleteObject",
      "DeleteObjects",
      "HeadObject",
      "GetBucketLocation",
      "CreateMultipartUpload",
      "UploadPart",
      "CompleteMultipartUpload",
      "AbortMultipartUpload",
      "CreateBucket",
      "DeleteBucket",
      "GetBucketPolicy",
      "PutBucketPolicy",
      "DeleteBucketPolicy",
      "ListMultipartUploads",
      "GetBucketEncryption",
      "GetBucketVersioning",
    ]);
  });

  it("refuses a source-only name outside the API list", () => {
    expect(() => actionTable(events, ["AssumeRole"])).toThrow("receipt field refused: sourceOnly");
  });
});

describe("writeReceipt", () => {
  it("writes the receipt as JSON named after its run id", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aws-receipt-"));
    try {
      const receipt = tornDown(createReceiptLog(header, KEYS)).finish(finishParts);
      const path = await writeReceipt(dir, receipt, KEYS);
      expect(path).toBe(join(dir, "aws-rehearsal-run-1.json"));
      expect(JSON.parse(await readFile(path, "utf8"))).toEqual(receipt);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("the loaded key pair never reaches the receipt", () => {
  const CAPITAL_SECRET = "WJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY12";
  const keys = { accessKeyId: ACCESS_KEY_ID, secretAccessKey: PLAIN_SECRET };
  const capitalKeys = { accessKeyId: ACCESS_KEY_ID, secretAccessKey: CAPITAL_SECRET };
  const event = { scenario: "s", phase: "p", outcome: "ok" };

  function expectClean(error: Error, ...values: string[]): void {
    for (const value of values) expect(error.message).not.toContain(value);
  }

  it.each(["scenario", "phase", "objectRole", "api"])(
    "refuses the plain secret in event field %s",
    (key) => {
      const log = tornDown(createReceiptLog(header, keys));
      for (const value of [PLAIN_SECRET, `x-${PLAIN_SECRET}`]) {
        const error = refusalOf(() => log.record({ ...event, [key]: value }));
        expect(error.message).toBe(`receipt field refused: ${key}`);
        expectClean(error, PLAIN_SECRET);
      }
      expect(JSON.stringify(log.finish(finishParts))).not.toContain(PLAIN_SECRET);
    },
  );

  it("never echoes a capital-first secret as an error name", () => {
    const log = tornDown(createReceiptLog(header, capitalKeys));
    const error = refusalOf(() => log.record({ ...event, errorName: CAPITAL_SECRET }));
    expect(error.message).toBe("receipt field refused: errorName");
    expectClean(error, CAPITAL_SECRET);
    const teardownError = refusalOf(() =>
      log.teardown({ step: "inventory", outcome: "failed", errorName: CAPITAL_SECRET }),
    );
    expect(teardownError.message).toBe("receipt field refused: errorName");
    expect(JSON.stringify(log.finish(finishParts))).not.toContain(CAPITAL_SECRET);
  });

  it("refuses the access key id inside a longer token", () => {
    const log = createReceiptLog(header, keys);
    const error = refusalOf(() =>
      log.record({ ...event, phase: `k${ACCESS_KEY_ID.toLowerCase()}` }),
    );
    expect(error.message).toBe("receipt field refused: phase");
    expect(() => log.record({ ...event, phase: `k${ACCESS_KEY_ID}` })).toThrow(
      "receipt field refused: phase",
    );
  });

  it("refuses the secret in the header", () => {
    const error = refusalOf(() => createReceiptLog({ ...header, commit: PLAIN_SECRET }, keys));
    expect(error.message).toBe("receipt field refused: header.commit");
    expectClean(error, PLAIN_SECRET);
  });

  it.each([
    ["remaining.uploadIds", { remaining: { bucket: BUCKET, uploadIds: [PLAIN_SECRET] } }],
    ["cleanupCommand", { cleanupCommand: `cleanup --key fixture/${PLAIN_SECRET}` }],
    ["header.finishedAt", { finishedAt: PLAIN_SECRET }],
  ])("refuses the secret in %s", (key, override) => {
    const log = createReceiptLog(header, keys);
    const error = refusalOf(() => log.finish({ ...finishParts, ...override } as never));
    expect(error.message).toBe(`receipt field refused: ${key}`);
    expectClean(error, PLAIN_SECRET);
  });

  it("refuses an empty key pair, which would match every string", () => {
    expect(() =>
      createReceiptLog(header, { accessKeyId: "", secretAccessKey: PLAIN_SECRET }),
    ).toThrow("receipt field refused: keys");
  });

  it("refuses an api outside the S3 list", () => {
    const log = createReceiptLog(header, keys);
    for (const api of ["PutObjekt", "AssumeRole"]) {
      expect(() => log.record({ ...event, api })).toThrow("receipt field refused: api");
    }
  });

  it("writeReceipt refuses a hand-built receipt carrying either value", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aws-receipt-"));
    try {
      const receipt = tornDown(createReceiptLog(header, keys)).finish(finishParts);
      for (const value of [PLAIN_SECRET, ACCESS_KEY_ID]) {
        const tampered = { ...receipt, remaining: { bucket: null, uploadIds: [value] } };
        const error = await writeReceipt(dir, tampered, keys).then(
          () => new Error("expected a refusal"),
          (thrown: unknown) => thrown as Error,
        );
        expect(error.message).toBe("receipt field refused: receipt");
        expectClean(error, value);
      }
      expect(await readdir(dir)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("receipt rules widened for slice 7b", () => {
  it.each([
    "2~Ab+cd/ef=gh",
    "x".repeat(1024),
    "VXBsb2FkIElEIGZvciA2aWWpbmcncyBteS1tb3ZpZS5tMnRzIHVwbG9hZA",
  ])("keeps the opaque upload id %s", (id) => {
    const receipt = tornDown(createReceiptLog(header, KEYS)).finish({
      ...finishParts,
      remaining: { bucket: BUCKET, uploadIds: [id] },
    });
    expect(receipt.remaining.uploadIds).toEqual([id]);
  });

  it.each(["has space", "has\nnewline", 'has"quote', "has\\slash", "x".repeat(1025), ""])(
    "refuses the upload id %j",
    (id) => {
      const log = createReceiptLog(header, KEYS);
      expect(() =>
        log.finish({ ...finishParts, remaining: { bucket: BUCKET, uploadIds: [id] } }),
      ).toThrow("receipt field refused: remaining.uploadIds");
    },
  );

  it("still refuses an upload id carrying a loaded key value", () => {
    const log = createReceiptLog(header, KEYS);
    expect(() =>
      log.finish({
        ...finishParts,
        remaining: { bucket: BUCKET, uploadIds: [`2~${PLAIN_SECRET}+`] },
      }),
    ).toThrow("receipt field refused: remaining.uploadIds");
  });

  it.each([
    ["owned without a bucket", { bucket: null, state: "owned" }],
    ["owned with a candidate", { bucket: BUCKET, state: "owned", candidate: BUCKET }],
    ["an unowned candidate without its name", { bucket: null, state: "unowned-candidate" }],
    [
      "an unowned candidate claiming a bucket",
      { bucket: BUCKET, state: "unowned-candidate", candidate: BUCKET },
    ],
    ["a collision claiming a bucket", { bucket: BUCKET, state: "collision" }],
    [
      "a bucket never created with a candidate",
      { bucket: null, state: "not-created", candidate: BUCKET },
    ],
  ])("refuses an inconsistent ownership block: %s", (_label, ownership) => {
    const log = createReceiptLog(header, KEYS);
    expect(() => log.finish({ ...finishParts, ownership } as never)).toThrow(
      /^receipt field refused: ownership\./,
    );
  });

  it("accepts the shape of the cleanup command the runner writes", () => {
    const command =
      'WAITRON_RUN_AWS_REHEARSAL=1 AWS_SHARED_CREDENTIALS_FILE="$HOME/.config/waitron-cloud/aws/credentials" ' +
      'AWS_CONFIG_FILE="$HOME/.config/waitron-cloud/aws/config" AWS_PROFILE=waitron-rehearsal ' +
      "AWS_REGION=eu-north-1 pnpm --filter @waitron/server exec tsx scripts/aws-rehearsal-cleanup.ts " +
      "--receipt /var/folders/ab/x_y/T/waitron-aws-rehearsal/aws-rehearsal-run-1.json";
    const receipt = tornDown(createReceiptLog(header, KEYS)).finish({
      ...finishParts,
      remaining: { bucket: BUCKET, uploadIds: [] },
      cleanupCommand: command,
    });
    expect(receipt.cleanupCommand).toBe(command);
  });

  it.each([
    [
      "a bare script call",
      "pnpm --filter @waitron/server exec tsx scripts/aws-rehearsal-cleanup.ts --receipt /tmp/r.json",
    ],
    [
      "another script",
      runnerCommand("eu-north-1", "/tmp/aws-rehearsal-run-1.json").replace(
        "aws-rehearsal-cleanup",
        "aws-rehearsal-wipe",
      ),
    ],
    [
      "another profile",
      runnerCommand("eu-north-1", "/tmp/aws-rehearsal-run-1.json").replace(
        "AWS_PROFILE=waitron-rehearsal",
        "AWS_PROFILE=default",
      ),
    ],
    [
      "a region that is not a region",
      runnerCommand("eu-north-1;", "/tmp/aws-rehearsal-run-1.json"),
    ],
    ["a relative receipt path", runnerCommand("eu-north-1", "tmp/aws-rehearsal-run-1.json")],
    ["a receipt path that is not a receipt", runnerCommand("eu-north-1", "/tmp/credentials")],
    [
      "a second argument",
      `${runnerCommand("eu-north-1", "/tmp/aws-rehearsal-run-1.json")} --force`,
    ],
    [
      "a credentials file elsewhere",
      runnerCommand("eu-north-1", "/tmp/aws-rehearsal-run-1.json").replace(
        ".config/waitron-cloud",
        ".aws",
      ),
    ],
  ])("refuses a cleanup command that is a near miss: %s", (_label, command) => {
    const log = createReceiptLog(header, KEYS);
    expect(() =>
      log.finish({
        ...finishParts,
        remaining: { bucket: BUCKET, uploadIds: [] },
        cleanupCommand: command,
      }),
    ).toThrow("receipt field refused: cleanupCommand");
  });

  it("accepts the runner's command for a cleanup receipt", () => {
    const command = runnerCommand("us-east-1", "/tmp/r/aws-rehearsal-run-1-cleanup.json");
    const receipt = tornDown(createReceiptLog(header, KEYS)).finish({
      ...finishParts,
      remaining: { bucket: BUCKET, uploadIds: [] },
      cleanupCommand: command,
    });
    expect(receipt.cleanupCommand).toBe(command);
  });
});

describe("an owned bucket's teardown", () => {
  const STEPS = [
    "stop-child",
    "abort-upload",
    "remove-policy",
    "delete-objects",
    "delete-bucket",
  ] as const;

  function logWith(steps: readonly (typeof STEPS)[number][]) {
    const log = createReceiptLog(header, KEYS);
    for (const step of steps) log.teardown({ step, outcome: "ok" });
    return log;
  }

  it("refuses an owned receipt with no teardown", () => {
    expect(() => logWith([]).finish(finishParts)).toThrow("receipt field refused: teardown");
  });

  it.each(STEPS)("refuses an owned receipt missing its %s step", (missing) => {
    const log = logWith(STEPS.filter((step) => step !== missing));
    expect(() => log.finish(finishParts)).toThrow("receipt field refused: teardown");
  });

  it("accepts an owned receipt carrying all five steps, failed ones included", () => {
    const log = logWith(STEPS.slice(1));
    log.teardown({ step: "stop-child", outcome: "failed", errorName: "Timeout" });
    expect(log.finish(finishParts).teardown).toHaveLength(5);
  });

  it("accepts a receipt for a bucket never created with no teardown", () => {
    const receipt = logWith([]).finish({
      ...finishParts,
      ownership: { bucket: null, state: "not-created" },
    });
    expect(receipt.teardown).toEqual([]);
  });
});
