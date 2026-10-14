import { describe, expect, it, vi } from "vitest";
import { AWS_REHEARSAL_SCENARIO_DEADLINE_MS } from "./aws-rehearsal-limits.js";
import { sanitizeEvent } from "./aws-rehearsal-receipt.js";
import { localS3Fixture } from "./local-s3-fixture.js";
import { DELETE_MANY_SCENARIO_MS, runDeleteManyScenario } from "./s3-delete-scenario.js";

// Every phase runDeleteManyScenario records, its request recorder's included.
const PHASES = ["put", "listed-before", "deleted", "listed-after", "request", "delete-key-errors"];

describe("the delete-many scenario's budget", () => {
  it("refuses a 1,006th object before it sends any request", async () => {
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
      scratch: "/nonexistent",
      signal: new AbortController().signal,
      send,
    });
    local.fixture.reserveObjects(1);
    await expect(runDeleteManyScenario(local.fixture)).rejects.toThrow(/fixture-limit/);
    expect(local.events).toEqual([
      { scenario: "lifecycle", phase: "fixture-limit", count: 1005, outcome: "refused" },
    ]);
    expect(send).not.toHaveBeenCalled();
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
