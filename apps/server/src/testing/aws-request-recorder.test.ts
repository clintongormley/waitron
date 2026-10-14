import type { CommandObservation } from "@waitron/stream";
import { describe, expect, it } from "vitest";
import { sanitizeEvent } from "./aws-rehearsal-receipt.js";
import { requestRecorder } from "./aws-request-recorder.js";

function recorded(
  observation: CommandObservation,
  react?: (observation: CommandObservation) => void,
) {
  const events: object[] = [];
  requestRecorder("archive-put", (event) => events.push(event), react)(observation);
  return events;
}

const ok = (attempts = 1, httpStatusCode = 200) => ({ $metadata: { httpStatusCode, attempts } });

function refusal(name: string, httpStatusCode: number, attempts = 1): Error {
  return Object.assign(new Error(`${name}: the SDK's message about bucket owner-bucket`), {
    name,
    $metadata: { httpStatusCode, attempts },
  });
}

describe("the request recorder", () => {
  it("records an answered command as a request event", () => {
    expect(
      recorded({
        command: "HeadObjectCommand",
        input: { Bucket: "b", Key: "k" },
        output: ok(),
        elapsedMs: 12.5,
      }),
    ).toEqual([
      {
        scenario: "archive-put",
        phase: "request",
        api: "HeadObject",
        httpStatus: 200,
        attempts: 1,
        elapsedMs: 12.5,
        outcome: "ok",
      },
    ]);
  });

  it("records a refused command with its status, attempts and error name", () => {
    expect(
      recorded({
        command: "GetObjectCommand",
        input: { Bucket: "b", Key: "k" },
        error: refusal("AccessDenied", 403, 2),
        elapsedMs: 40,
      }),
    ).toEqual([
      {
        scenario: "archive-put",
        phase: "request",
        api: "GetObject",
        httpStatus: 403,
        attempts: 2,
        elapsedMs: 40,
        outcome: "failed",
        errorName: "AccessDenied",
      },
    ]);
  });

  it("records a failure with no answer as a null status and no attempts", () => {
    const [event] = recorded({
      command: "ListObjectsV2Command",
      input: {},
      error: new TypeError("socket hang up"),
      elapsedMs: 3,
    });
    expect(event).toEqual({
      scenario: "archive-put",
      phase: "request",
      api: "ListObjectsV2",
      httpStatus: null,
      elapsedMs: 3,
      outcome: "failed",
      errorName: "TypeError",
    });
  });

  it.each([0, "2", 1.5, undefined])("leaves out attempts of %s", (attempts) => {
    const [event] = recorded({
      command: "HeadObjectCommand",
      input: {},
      output: { $metadata: { httpStatusCode: 200, attempts } },
      elapsedMs: 1,
    });
    expect(event).not.toHaveProperty("attempts");
  });

  it("counts the keys a DeleteObjects sends", () => {
    const keys = (n: number) => ({
      Delete: { Objects: Array.from({ length: n }, (_, i) => ({ Key: `k${i}` })) },
    });
    for (const n of [1_000, 5]) {
      const [event] = recorded({
        command: "DeleteObjectsCommand",
        input: keys(n),
        output: { ...ok(), Deleted: [] },
        elapsedMs: 9,
      });
      expect(event).toMatchObject({ api: "DeleteObjects", count: n });
    }
  });

  it("adds an event for the keys a DeleteObjects answer says it could not delete", () => {
    const events = recorded({
      command: "DeleteObjectsCommand",
      input: { Delete: { Objects: [{ Key: "a" }, { Key: "b" }, { Key: "c" }] } },
      output: {
        ...ok(),
        Errors: [
          { Key: "a", Code: "AccessDenied" },
          { Key: "b", Code: "AccessDenied" },
        ],
      },
      elapsedMs: 9,
    });
    expect(events).toEqual([
      {
        scenario: "archive-put",
        phase: "request",
        api: "DeleteObjects",
        httpStatus: 200,
        attempts: 1,
        elapsedMs: 9,
        outcome: "ok",
        count: 3,
      },
      {
        scenario: "archive-put",
        phase: "delete-key-errors",
        api: "DeleteObjects",
        count: 2,
        outcome: "failed",
      },
    ]);
  });

  it("adds no key-errors event when the answer's Errors is empty", () => {
    expect(
      recorded({
        command: "DeleteObjectsCommand",
        input: { Delete: { Objects: [{ Key: "a" }] } },
        output: { ...ok(), Errors: [] },
        elapsedMs: 9,
      }),
    ).toHaveLength(1);
  });

  it.each(["PutObjectCommand", "UploadPartCommand"])("records the bytes %s sends", (command) => {
    const [event] = recorded({
      command,
      input: { ContentLength: 8 * 1024 * 1024 },
      output: ok(),
      elapsedMs: 1,
    });
    expect(event).toMatchObject({ bytes: 8 * 1024 * 1024 });
  });

  it.each([-1, 1.5, "10", undefined])("leaves out a length of %s", (ContentLength) => {
    const [event] = recorded({
      command: "PutObjectCommand",
      input: { ContentLength },
      output: ok(),
      elapsedMs: 1,
    });
    expect(event).not.toHaveProperty("bytes");
  });

  it("records no bytes for a command other than PutObject and UploadPart", () => {
    const [event] = recorded({
      command: "GetObjectCommand",
      input: { ContentLength: 10 },
      output: { ...ok(), ContentLength: 10 },
      elapsedMs: 1,
    });
    expect(event).not.toHaveProperty("bytes");
  });

  it("never carries a key, body, bucket, upload id, header or the SDK's message", () => {
    const secret = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
    const events = recorded({
      command: "UploadPartCommand",
      input: {
        Bucket: "waitron-rehearsal-waitron-abcdefabcdef",
        Key: "rehearsal-run/archives/venue-1/a.enc",
        UploadId: "upload-id-0123456789",
        Body: "plaintext-body-bytes",
        ContentLength: 20,
        ChecksumCRC32: secret,
      },
      error: Object.assign(refusal("SignatureDoesNotMatch", 403), {
        $response: { headers: { "x-amz-request-id": "REQ123" } },
      }),
      elapsedMs: 5,
    });
    const text = JSON.stringify(events);
    for (const value of [
      "waitron-rehearsal-waitron-abcdefabcdef",
      "rehearsal-run/archives",
      "upload-id-0123456789",
      "plaintext-body-bytes",
      secret,
      "REQ123",
      "owner-bucket",
      "SDK's message",
    ]) {
      expect(text).not.toContain(value);
    }
  });

  it.each(["archives/venue-1/key.bin", "AKIAIOSFODNN7EXAMPLE"])(
    "records an error named %s as Unlisted",
    (name) => {
      const [event] = recorded({
        command: "GetObjectCommand",
        input: {},
        error: refusal(name, 403),
        elapsedMs: 1,
      });
      expect(event).toMatchObject({ errorName: "Unlisted" });
      expect(JSON.stringify(event)).not.toContain(name);
    },
  );

  it("records only events the receipt accepts unchanged", () => {
    const events = [
      ...recorded({ command: "HeadObjectCommand", input: {}, output: ok(), elapsedMs: 1 }),
      ...recorded({
        command: "GetObjectCommand",
        input: {},
        error: refusal("NoSuchKey", 404),
        elapsedMs: 1,
      }),
      ...recorded({
        command: "ListObjectsV2Command",
        input: {},
        error: new Error("offline"),
        elapsedMs: 1,
      }),
      ...recorded({
        command: "DeleteObjectsCommand",
        input: { Delete: { Objects: [{ Key: "a" }] } },
        output: { ...ok(), Errors: [{ Key: "a" }] },
        elapsedMs: 1,
      }),
      ...recorded({
        command: "UploadPartCommand",
        input: { ContentLength: 5 },
        output: ok(3),
        elapsedMs: 1,
      }),
    ];
    expect(events).toHaveLength(6);
    for (const event of events) expect(sanitizeEvent(event)).toEqual(event);
  });

  it("stops at an API outside the planned list, recording nothing", () => {
    const events: object[] = [];
    const seen: CommandObservation[] = [];
    const observe = requestRecorder(
      "archive-put",
      (event) => events.push(event),
      (o) => seen.push(o),
    );
    expect(() =>
      observe({ command: "ListBucketsCommand", input: {}, output: ok(), elapsedMs: 1 }),
    ).toThrow("unlisted S3 API: ListBuckets");
    expect(events).toEqual([]);
    expect(seen).toEqual([]);
  });

  it("hands the observation on after recording it", () => {
    const order: string[] = [];
    const observation = { command: "HeadObjectCommand", input: {}, output: ok(), elapsedMs: 1 };
    requestRecorder(
      "archive-put",
      () => order.push("recorded"),
      (seen) => {
        expect(seen).toBe(observation);
        order.push("reacted");
      },
    )(observation);
    expect(order).toEqual(["recorded", "reacted"]);
  });
});
