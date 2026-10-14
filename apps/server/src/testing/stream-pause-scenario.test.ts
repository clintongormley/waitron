import { describe, expect, it } from "vitest";
import { TICK_MS } from "@waitron/stream";
import {
  AWS_REHEARSAL_LIMITS,
  AWS_REHEARSAL_SCENARIO_DEADLINE_MS,
} from "./aws-rehearsal-limits.js";
import { sanitizeEvent } from "./aws-rehearsal-receipt.js";
import {
  STREAM_PAUSE_AWS_DENIED_CHECK_WAIT_MS,
  STREAM_PAUSE_AWS_EXTRA_MS,
  STREAM_PAUSE_AWS_HELD_CHECK_WAIT_MS,
  STREAM_PAUSE_AWS_RESUME_WAIT_MS,
  STREAM_PAUSE_RESUME_WAIT_MS,
  STREAM_PAUSE_PHASES,
  STREAM_PAUSE_SCENARIO_MS,
  pauseListingPrefix,
} from "./stream-pause-scenario.js";

describe("the stream pause scenario's fit to the AWS rehearsal", () => {
  it.each(STREAM_PAUSE_PHASES)("the receipt accepts the %s stage's events as recorded", (phase) => {
    for (const outcome of ["ok", "failed", "skipped"] as const) {
      expect(sanitizeEvent({ scenario: "pause", phase, outcome, elapsedMs: 2081.1565 })).toEqual({
        scenario: "pause",
        phase,
        outcome,
        elapsedMs: 2081.1565,
      });
    }
  });

  it("counts as the AWS run's extra its four paused waits and its longer resume wait", () => {
    expect(STREAM_PAUSE_AWS_DENIED_CHECK_WAIT_MS).toBe(AWS_REHEARSAL_LIMITS.denialControlMs);
    expect(STREAM_PAUSE_AWS_RESUME_WAIT_MS).toBe(
      TICK_MS + AWS_REHEARSAL_LIMITS.denialControlMs + STREAM_PAUSE_RESUME_WAIT_MS,
    );
    expect(STREAM_PAUSE_AWS_EXTRA_MS).toBe(
      STREAM_PAUSE_AWS_HELD_CHECK_WAIT_MS +
        2 * AWS_REHEARSAL_LIMITS.denialControlMs +
        STREAM_PAUSE_AWS_DENIED_CHECK_WAIT_MS +
        (STREAM_PAUSE_AWS_RESUME_WAIT_MS - STREAM_PAUSE_RESUME_WAIT_MS),
    );
  });

  it("its waits, with the AWS run's extra waits, fit inside the rehearsal's scenario deadline", () => {
    expect(STREAM_PAUSE_SCENARIO_MS + STREAM_PAUSE_AWS_EXTRA_MS).toBeLessThanOrEqual(
      AWS_REHEARSAL_SCENARIO_DEADLINE_MS,
    );
  });
});

// The supervisor's own listing is checked against this in `stream-host.test.ts` ("asks the store
// it was given whether the bucket answers, listing the level-0 folder the pause scenario names");
// these cases pin the bucket prefix it is joined to.
describe("pauseListingPrefix", () => {
  const generation = "gen-0-node-a-20261014T000000Z";

  it("puts the bucket's prefix, normalised, in front of the generation's level-0 folder", () => {
    const bare = pauseListingPrefix({ prefix: "" }, "venue-1", generation);
    expect(bare.endsWith("/0000/")).toBe(true);
    expect(bare.startsWith("venues/venue-1/")).toBe(true);
    expect(pauseListingPrefix({ prefix: "pause/" }, "venue-1", generation)).toBe(`pause/${bare}`);
    expect(pauseListingPrefix({ prefix: "/pause" }, "venue-1", generation)).toBe(`pause/${bare}`);
  });
});
