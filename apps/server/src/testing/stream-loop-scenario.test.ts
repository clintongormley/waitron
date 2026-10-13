import { AWS_REHEARSAL_SCENARIO_DEADLINE_MS } from "./aws-rehearsal-limits.js";
import { sanitizeEvent } from "./aws-rehearsal-receipt.js";
import { STREAM_LOOP_PHASES, STREAM_LOOP_SCENARIO_MS } from "./stream-loop-scenario.js";

describe("the stream loop scenario's fit to the AWS rehearsal", () => {
  it.each(STREAM_LOOP_PHASES)("the receipt accepts the %s stage's events as recorded", (phase) => {
    for (const outcome of ["ok", "failed", "skipped"] as const) {
      expect(sanitizeEvent({ scenario: "loop", phase, outcome, elapsedMs: 2081.1565 })).toEqual({
        scenario: "loop",
        phase,
        outcome,
        elapsedMs: 2081.1565,
      });
    }
  });

  it("its waits fit inside the rehearsal's scenario deadline", () => {
    expect(STREAM_LOOP_SCENARIO_MS).toBeLessThanOrEqual(AWS_REHEARSAL_SCENARIO_DEADLINE_MS);
  });
});
