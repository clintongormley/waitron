import type { AwsRehearsal } from "./aws-rehearsal.js";
import { awsScenarioFixture } from "./aws-s3-scenario-fixture.js";

function standIn() {
  const calls: [string, ...unknown[]][] = [];
  const labels = new Set<string>();
  const signal = new AbortController().signal;
  const uploads = [{ key: "rehearsal-run/delete-many/a", uploadId: "u-1" }];
  const ctx: AwsRehearsal = {
    runId: "run",
    bucket: "the-bucket",
    region: "eu-north-1",
    signal,
    prefix(label) {
      calls.push(["prefix", label]);
      if (labels.has(label)) throw new Error("label-refused");
      labels.add(label);
      return `rehearsal-run/${label}/`;
    },
    bucketConfig(prefix) {
      calls.push(["bucketConfig", prefix]);
      return {
        region: "eu-north-1",
        bucket: "the-bucket",
        prefix,
        accessKeyId: "id",
        secretAccessKey: "secret",
      };
    },
    reserveUpload: (bytes, role) => calls.push(["reserveUpload", bytes, role]),
    reserveObjects: (count) => calls.push(["reserveObjects", count]),
    trackChild: (pid) => calls.push(["trackChild", pid]),
    trackUpload: (key, uploadId) => calls.push(["trackUpload", key, uploadId]),
    ownedUploads: async (prefix) => {
      calls.push(["ownedUploads", prefix]);
      return uploads;
    },
    record: (event) => calls.push(["record", event]),
    bucketPolicy: { put: async () => {}, remove: async () => {} },
  };
  return { ctx, calls, signal, uploads };
}

describe("awsScenarioFixture", () => {
  it("takes its bucket from the label's own prefix, and its signal from the rehearsal", () => {
    const { ctx, calls, signal } = standIn();
    const fixture = awsScenarioFixture(ctx, "delete-many", "/scratch/here");
    expect(calls).toEqual([
      ["prefix", "delete-many"],
      ["bucketConfig", "rehearsal-run/delete-many/"],
    ]);
    expect(fixture.bucket).toMatchObject({
      bucket: "the-bucket",
      prefix: "rehearsal-run/delete-many/",
    });
    expect(fixture.scratch).toBe("/scratch/here");
    expect(fixture.signal).toBe(signal);
    expect(fixture.venueId).toMatch(/^[a-z0-9-]+$/);
  });

  it("passes every call to the rehearsal unchanged, adding no scenario to an event", async () => {
    const { ctx, calls, uploads } = standIn();
    const fixture = awsScenarioFixture(ctx, "archive-roundtrip", "/scratch");
    calls.length = 0;
    fixture.record({ phase: "uploaded", count: 4 });
    fixture.reserveUpload(1024, "archive");
    fixture.reserveObjects(5);
    fixture.trackUpload("k", "u-2");
    await expect(fixture.ownedUploads("rehearsal-run/archive-roundtrip/")).resolves.toBe(uploads);
    expect(calls).toEqual([
      ["record", { phase: "uploaded", count: 4 }],
      ["reserveUpload", 1024, "archive"],
      ["reserveObjects", 5],
      ["trackUpload", "k", "u-2"],
      ["ownedUploads", "rehearsal-run/archive-roundtrip/"],
    ]);
  });

  it("issues each label once, so a second fixture with the same label is refused", () => {
    const { ctx } = standIn();
    awsScenarioFixture(ctx, "archive-abort", "/scratch");
    expect(() => awsScenarioFixture(ctx, "archive-abort", "/scratch")).toThrow("label-refused");
  });
});
