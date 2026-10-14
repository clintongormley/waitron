import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AWS_REHEARSAL_SCENARIO_DEADLINE_MS } from "./aws-rehearsal-limits.js";
import { sanitizeEvent } from "./aws-rehearsal-receipt.js";
import { localS3Fixture } from "./local-s3-fixture.js";
import { DELETE_MANY_SCENARIO_MS, runDeleteManyScenario } from "./s3-delete-scenario.js";

const backend = vi.hoisted(() => ({
  id: "rehearsal",
  put: vi.fn(),
  list: vi.fn(),
  deleteMany: vi.fn(),
  close: vi.fn(),
}));
vi.mock("../backup-backends.js", () => ({ buildBackupBackend: () => backend }));

// Every phase runDeleteManyScenario records, its request recorder's included.
const PHASES = ["put", "listed-before", "deleted", "listed-after", "request", "delete-key-errors"];

const KEYS = Array.from(
  { length: 1005 },
  (_, index) => `delete-${String(index + 1).padStart(4, "0")}.txt`,
);
const folders: string[] = [];

beforeEach(() => {
  backend.put.mockResolvedValue(undefined);
  backend.list.mockResolvedValue([]);
  backend.deleteMany.mockResolvedValue(undefined);
});

afterEach(async () => {
  vi.resetAllMocks();
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

async function fixture() {
  const scratch = await mkdtemp(join(tmpdir(), "waitron-delete-scenario-"));
  folders.push(scratch);
  const send = vi.fn();
  const local = localS3Fixture({
    bucket: {
      endpoint: "http://127.0.0.1:9",
      region: "us-east-1",
      bucket: "waitron-loop",
      prefix: "local-run/delete-many/",
      accessKeyId: "id",
      secretAccessKey: "secret",
    },
    venueId: "venue-1",
    scratch,
    signal: new AbortController().signal,
    send,
  });
  return { local, send };
}

describe("the delete-many scenario's budget", () => {
  it("refuses a 1,006th object before it sends any request", async () => {
    const { local, send } = await fixture();
    local.fixture.reserveObjects(1);
    await expect(runDeleteManyScenario(local.fixture)).rejects.toThrow(/fixture-limit/);
    expect(local.events).toEqual([
      { scenario: "lifecycle", phase: "fixture-limit", count: 1005, outcome: "refused" },
    ]);
    expect(send).not.toHaveBeenCalled();
    expect(backend.put).not.toHaveBeenCalled();
  });
});

describe("the delete-many scenario's failed phases", () => {
  it("records a listing that fails as the listing phase failing", async () => {
    const { local } = await fixture();
    const denied = Object.assign(new Error("denied"), { name: "AccessDenied" });
    backend.list.mockRejectedValueOnce(denied);
    await expect(runDeleteManyScenario(local.fixture)).rejects.toBe(denied);
    expect(backend.put).toHaveBeenCalledTimes(1005);
    expect(local.events).toEqual([
      {
        scenario: "delete-many",
        phase: "listed-before",
        outcome: "failed",
        errorName: "AccessDenied",
      },
    ]);
    expect(backend.deleteMany).not.toHaveBeenCalled();
  });

  it("records a listing that is missing a key as the listing phase failing its check", async () => {
    const { local } = await fixture();
    backend.list.mockResolvedValueOnce(KEYS.slice(1).map((key) => ({ key })));
    await expect(runDeleteManyScenario(local.fixture)).rejects.toThrow();
    expect(local.events).toEqual([
      {
        scenario: "delete-many",
        phase: "listed-before",
        outcome: "failed",
        errorName: "AssertionError",
      },
    ]);
    expect(backend.deleteMany).not.toHaveBeenCalled();
  });

  it("records a deletion that sent no DeleteObjects request as the deleted phase failing its check", async () => {
    const { local } = await fixture();
    backend.list.mockResolvedValueOnce(KEYS.map((key) => ({ key })));
    await expect(runDeleteManyScenario(local.fixture)).rejects.toThrow();
    expect(local.events).toEqual([
      { scenario: "delete-many", phase: "listed-before", count: 1005, outcome: "ok" },
      { scenario: "delete-many", phase: "deleted", outcome: "failed", errorName: "AssertionError" },
    ]);
  });
});

describe("the delete-many scenario's fit to the AWS rehearsal", () => {
  it.each(PHASES)("the receipt accepts the %s phase's events as recorded", (phase) => {
    for (const outcome of ["ok", "failed"] as const) {
      expect(sanitizeEvent({ scenario: "delete-many", phase, outcome, count: 1000 })).toEqual({
        scenario: "delete-many",
        phase,
        outcome,
        count: 1000,
      });
    }
  });

  it("its time limit fits inside the rehearsal's scenario deadline", () => {
    expect(DELETE_MANY_SCENARIO_MS).toBeLessThanOrEqual(AWS_REHEARSAL_SCENARIO_DEADLINE_MS);
  });
});
