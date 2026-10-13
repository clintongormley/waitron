import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AwsReceiptEvent,
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
    const log = createReceiptLog(header);
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
    const log = createReceiptLog(header);
    log.teardown({ step: "delete-bucket", outcome: "failed", errorName: "<b>", httpStatus: 409 });
    log.teardown({ step: "delete-objects", outcome: "ok", count: 2, errorName: "BucketNotEmpty" });
    expect(log.finish(finishParts).teardown).toEqual([
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
    const log = createReceiptLog(header);
    const error = refusalOf(() => log.finish({ ...finishParts, ...override } as never));
    expect(error.message).toBe(`receipt field refused: ${key}`);
  });

  it("refuses a bad header", () => {
    expect(refusalOf(() => createReceiptLog({ ...header, region: SIGNED_URL })).message).toBe(
      "receipt field refused: header.region",
    );
    expect(
      refusalOf(() => createReceiptLog({ ...header, limits: { archiveBytes: SECRET } as never }))
        .message,
    ).toBe("receipt field refused: header.limits");
  });

  it("keeps an unowned candidate and opaque upload ids", () => {
    const receipt = createReceiptLog(header).finish({
      ...finishParts,
      ownership: { bucket: null, state: "unowned-candidate", candidate: BUCKET },
      remaining: { bucket: BUCKET, uploadIds: ["2~iCw_lDY8VoNTLVzOhy1YR.KD0Xb-x"] },
      cleanupCommand:
        "pnpm --filter @waitron/server exec tsx scripts/aws-rehearsal-cleanup.ts --receipt /tmp/r.json",
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
      const receipt = createReceiptLog(header).finish(finishParts);
      const path = await writeReceipt(dir, receipt);
      expect(path).toBe(join(dir, "aws-rehearsal-run-1.json"));
      expect(JSON.parse(await readFile(path, "utf8"))).toEqual(receipt);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
