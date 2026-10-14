import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { localS3Fixture } from "./local-s3-fixture.js";
import { scenarioSteps } from "./s3-scenario-steps.js";

const folders: string[] = [];

afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

async function local() {
  const scratch = await mkdtemp(join(tmpdir(), "waitron-scenario-steps-"));
  folders.push(scratch);
  return localS3Fixture({
    bucket: {
      endpoint: "http://127.0.0.1:9",
      region: "us-east-1",
      bucket: "waitron-loop",
      prefix: "local-run/steps/",
      accessKeyId: "id",
      secretAccessKey: "secret",
    },
    venueId: "venue-1",
    scratch,
    signal: new AbortController().signal,
    send: vi.fn(),
  });
}

describe("scenarioSteps", () => {
  it("records a failing assertion inside a step as that phase failing, and rethrows it", async () => {
    const built = await local();
    const { step } = scenarioSteps(built.fixture, "delete-many");
    await expect(
      step("listed-before", () => {
        expect(1004).toBe(1005);
      }),
    ).rejects.toThrow(/expected 1004 to be 1005/);
    expect(built.events).toEqual([
      {
        scenario: "delete-many",
        phase: "listed-before",
        outcome: "failed",
        errorName: "AssertionError",
      },
    ]);
  });

  it("records nothing for a step that succeeds, and answers its value", async () => {
    const built = await local();
    const { step } = scenarioSteps(built.fixture, "delete-many");
    await expect(step("put", async () => 7)).resolves.toBe(7);
    expect(built.events).toEqual([]);
  });

  it("records each request it observes and keeps it for the scenario to read", async () => {
    const built = await local();
    const react = vi.fn();
    const { observe, requestsTo } = scenarioSteps(built.fixture, "archive-abort", react);
    const observation = {
      command: "UploadPartCommand",
      input: { ContentLength: 8 },
      output: { $metadata: { httpStatusCode: 200 } },
      elapsedMs: 3,
    };
    observe(observation);
    expect(requestsTo("UploadPart")).toEqual([
      {
        scenario: "archive-abort",
        phase: "request",
        api: "UploadPart",
        httpStatus: 200,
        elapsedMs: 3,
        outcome: "ok",
        bytes: 8,
      },
    ]);
    expect(requestsTo("PutObject")).toEqual([]);
    expect(built.events).toEqual(requestsTo("UploadPart"));
    expect(react).toHaveBeenCalledWith(observation);
  });

  it("removes its work folder and closes the backend, even when the body throws", async () => {
    const built = await local();
    const { withBackend } = scenarioSteps(built.fixture, "archive-roundtrip");
    let folder = "";
    await expect(
      withBackend(async (_backend, work) => {
        folder = work;
        expect(await readdir(built.fixture.scratch)).toHaveLength(1);
        throw new Error("body failed");
      }),
    ).rejects.toThrow("body failed");
    expect(folder.startsWith(join(built.fixture.scratch, "archive-roundtrip-"))).toBe(true);
    expect(await readdir(built.fixture.scratch)).toEqual([]);
  });
});
