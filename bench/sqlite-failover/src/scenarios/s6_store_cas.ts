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

    // An unconditional race must accept every writer so an unrelated refusal cannot look like a
    // working condition.
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
      // The modeled promotion uses create-only, so the compare-and-swap result does not decide
      // this scenario.
      detail: `create-only=${report.createOnly} if-match=${ifMatch} race=${report.raceWinners}/${report.racers} unfenced=${report.unfencedWinners}/${report.racers}`,
    };
  } finally {
    await store.stop();
  }
}
