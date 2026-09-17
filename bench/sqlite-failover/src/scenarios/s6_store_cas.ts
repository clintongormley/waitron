// S6: the store's conditional-write primitive — the fence the prototype's promotion step stands on.
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
    assert.equal(
      report.raceWinners,
      1,
      `exactly one of the ${report.racers} create-only claims wins`,
    );

    // CONTROL. The same race with no condition attached: every racer is accepted. Without it, "one
    // winner" could just as well mean the store refuses repeated writes to that key for some reason
    // of its own, and both answers would look alike. What the pair establishes is conditional versus
    // unconditional acceptance — NOT that the requests overlapped on the wire, which it cannot show
    // either way: an unconditional PUT is accepted whether or not anything else is in flight.
    assert.equal(
      report.unfencedWinners,
      report.racers,
      "control: with no condition attached, every racer overwrites the key and 'wins'",
    );

    const ifMatch = report.ifMatchNote
      ? `${report.ifMatch} (${report.ifMatchNote})`
      : report.ifMatch;
    return {
      id: "S6",
      title: "store conditional write",
      verdict: "PASS",
      critical: true,
      // if-match is RECORDED, not asserted: S1's fence (plan Task 3) claims a per-term key
      // create-only, so nothing in this rig turns on compare-and-swap. The product's fence does —
      // it is a version-conditional write of `current.json` — which is why the value is recorded.
      detail: `create-only=${report.createOnly} if-match=${ifMatch} race=${report.raceWinners}/${report.racers} unfenced=${report.unfencedWinners}/${report.racers}`,
    };
  } finally {
    await store.stop();
  }
}
