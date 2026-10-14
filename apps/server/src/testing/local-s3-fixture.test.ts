import { describe, expect, it, vi } from "vitest";
import { AWS_REHEARSAL_LIMITS } from "./aws-rehearsal-limits.js";
import { localS3Fixture } from "./local-s3-fixture.js";

function fixture() {
  const send = vi.fn();
  const built = localS3Fixture({
    bucket: {
      endpoint: "http://127.0.0.1:9",
      region: "us-east-1",
      bucket: "waitron-loop",
      prefix: "local-run/delete-many/",
      accessKeyId: "id",
      secretAccessKey: "secret",
    },
    venueId: "venue-1",
    scratch: "/nonexistent",
    signal: new AbortController().signal,
    send,
  });
  return { built, send };
}

describe("the local S3 scenario fixture", () => {
  it("refuses a 1,006th object and records the refusal", () => {
    const { built } = fixture();
    built.fixture.reserveObjects(AWS_REHEARSAL_LIMITS.deleteObjects);
    expect(() => built.fixture.reserveObjects(1)).toThrow(/fixture-limit/);
    expect(built.events).toEqual([
      { scenario: "lifecycle", phase: "fixture-limit", count: 1, outcome: "refused" },
    ]);
  });

  it("refuses an upload over the total byte budget, and an archive over its own limit", () => {
    const { built } = fixture();
    built.fixture.reserveUpload(AWS_REHEARSAL_LIMITS.archiveBytes, "archive");
    expect(() =>
      built.fixture.reserveUpload(AWS_REHEARSAL_LIMITS.archiveBytes + 1, "archive"),
    ).toThrow(/fixture-limit/);
    built.fixture.reserveUpload(
      AWS_REHEARSAL_LIMITS.uploadedBytes - AWS_REHEARSAL_LIMITS.archiveBytes,
      "delete-object",
    );
    expect(() => built.fixture.reserveUpload(1, "delete-object")).toThrow(/fixture-limit/);
    expect(
      built.events.map(({ phase, objectRole, outcome }) => [phase, objectRole, outcome]),
    ).toEqual([
      ["fixture-limit", "archive", "refused"],
      ["fixture-limit", "delete-object", "refused"],
    ]);
  });

  it("refuses a count or byte size that is not a non-negative integer, as the rehearsal does", () => {
    const { built } = fixture();
    expect(() => built.fixture.reserveObjects(-5)).toThrow(/fixture-limit/);
    expect(() => built.fixture.reserveObjects(Number.NaN)).toThrow(/fixture-limit/);
    expect(() => built.fixture.reserveObjects(2000)).toThrow(/fixture-limit/);
    expect(() => built.fixture.reserveUpload(Number.NaN, "archive")).toThrow(/fixture-limit/);
    expect(() => built.fixture.reserveUpload(1e12, "x")).toThrow(/fixture-limit/);
  });

  it("refuses an event the receipt schema would refuse", () => {
    const { built } = fixture();
    expect(() => built.fixture.record({ scenario: "delete-many", phase: "x", key: "a" })).toThrow();
    expect(built.events).toEqual([]);
  });

  it("keeps the uploads it is told to track", () => {
    const { built } = fixture();
    built.fixture.trackUpload("k", "u");
    expect(built.tracked).toEqual([{ key: "k", uploadId: "u" }]);
  });

  it("lists unfinished uploads under the prefix, page by page", async () => {
    const { built, send } = fixture();
    send
      .mockResolvedValueOnce({
        Uploads: [{ Key: "local-run/delete-many/a", UploadId: "1" }],
        IsTruncated: true,
        NextKeyMarker: "local-run/delete-many/a",
        NextUploadIdMarker: "1",
      })
      .mockResolvedValueOnce({ Uploads: [{ Key: "local-run/delete-many/b", UploadId: "2" }] });
    await expect(built.fixture.ownedUploads("local-run/delete-many/")).resolves.toEqual([
      { key: "local-run/delete-many/a", uploadId: "1" },
      { key: "local-run/delete-many/b", uploadId: "2" },
    ]);
    const inputs = send.mock.calls.map(([command]) => (command as { input: object }).input);
    expect(inputs).toEqual([
      { Bucket: "waitron-loop", Prefix: "local-run/delete-many/" },
      {
        Bucket: "waitron-loop",
        Prefix: "local-run/delete-many/",
        KeyMarker: "local-run/delete-many/a",
        UploadIdMarker: "1",
      },
    ]);
  });
});
