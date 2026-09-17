// S6: the store's conditional-write primitive — the fence every later promotion scenario stands on.
// A promotion is safe only if the store can refuse a second writer's claim of the same key, so this
// scenario establishes what the store actually does rather than assuming S3 semantics.
import assert from "node:assert";
import type { ScenarioContext, ScenarioResult } from "../scenarios.ts";
import { probeConditionalWrites } from "../store-cas.ts";

export default async function storeCas({ startStore }: ScenarioContext): Promise<ScenarioResult> {
  const store = await startStore();
  try {
    const report = await probeConditionalWrites(store);

    assert.equal(report.createOnly, true, "the store honours If-None-Match:* as create-only");
    assert.equal(report.raceWinners, 1, "exactly one of the concurrent create-only claims wins");

    // CONTROL. Without the fence the same race is run with a plain PUT: if THAT also produced one
    // winner, the assertion above would be measuring the harness serialising the racers rather than
    // the store refusing them, and both answers would look alike.
    assert.equal(
      report.unfencedWinners,
      report.racers,
      "control: with no condition attached, every racer overwrites the key and 'wins'",
    );

    return {
      id: "S6",
      title: "store conditional write",
      verdict: "PASS",
      critical: true,
      // if-match is RECORDED, not asserted: S1's fence needs create-only only, and whether this
      // store also offers compare-and-swap on an existing key is a fact the results note carries.
      detail: `create-only=${report.createOnly} if-match=${report.ifMatch} race=${report.raceWinners}/${report.racers} unfenced=${report.unfencedWinners}/${report.racers}`,
    };
  } finally {
    await store.stop();
  }
}
