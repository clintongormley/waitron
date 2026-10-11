import { describe, expect, it } from "vitest";
import { migrationUpgradeBudget } from "./migration-upgrade-budget.mjs";
import { createStepWatch, reportStallAfter } from "./step-watch.mjs";

async function walkTaking(stepCount, elapsedMs) {
  const { deadlineMs } = migrationUpgradeBudget(stepCount);
  let elapsed = 0;
  return reportStallAfter(
    createStepWatch(),
    deadlineMs,
    async () => {
      elapsed = elapsedMs;
      return "walk completed";
    },
    { now: () => elapsed },
  );
}

describe("migration upgrade walk budget", () => {
  it("admits the captured 249-step CI workload that exceeded the old deadline", async () => {
    await expect(walkTaking(249, 110_242)).resolves.toBe("walk completed");
  });

  it("gives a growing migration walk more time", async () => {
    await expect(walkTaking(498, 220_484)).resolves.toBe("walk completed");
  });

  it("still refuses a walk that finishes at or after its deadline", async () => {
    const { deadlineMs } = migrationUpgradeBudget(249);
    await expect(walkTaking(249, deadlineMs)).rejects.toThrow(`past the ${deadlineMs} ms deadline`);
  });

  it("leaves ten seconds for the stall report before the test timeout", () => {
    for (const steps of [1, 249, 498]) {
      const { deadlineMs, timeoutMs } = migrationUpgradeBudget(steps);
      expect(timeoutMs - deadlineMs).toBe(10_000);
    }
  });
});
