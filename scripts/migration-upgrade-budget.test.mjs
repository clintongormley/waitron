import { describe, expect, it } from "vitest";
import { migrationUpgradeBudget } from "./migration-upgrade-budget.mjs";
import { createStepWatch, reportStallAfter } from "./step-watch.mjs";

// Receipt: docs/developers/ci-and-gates.md, "The upgrade budget counts the walk's own processor
// time".
const CAPTURED_CI_WORK_MS = 110_242;
const HEAVIEST_LOADED_WALL_MS = 1_108_000;
const LARGEST_LOADED_GAP_MS = 34_000;
const DEFAULT_GRACE_MS = 1000;

/** A walk of `stepCount` phases sharing out `cpuMs` of work and `wallMs` of wall time evenly. */
async function walk(stepCount, { cpuMs, wallMs, gapMs = wallMs / stepCount }) {
  const { workMs, idleMs } = migrationUpgradeBudget(stepCount);
  let elapsed = 0;
  let cpu = 0;
  const clock = () => elapsed;
  const watch = createStepWatch({ now: clock });
  return reportStallAfter(
    watch,
    { workMs, idleMs },
    async () => {
      for (let step = 0; step < stepCount; step += 1) {
        await watch.phase(`step ${step}`, () => {
          elapsed += step === 0 ? gapMs : (wallMs - gapMs) / (stepCount - 1);
          cpu += cpuMs / stepCount;
        });
      }
      return "walk completed";
    },
    { now: clock, cpuNow: () => cpu },
  );
}

describe("migration upgrade walk budget", () => {
  it("keeps the work budget at thirty seconds plus half a second per step", () => {
    for (const steps of [1, 249, 498]) {
      expect(migrationUpgradeBudget(steps).workMs).toBe(30_000 + steps * 500);
    }
  });

  it("admits the captured 249-step CI workload as work, however long the walk took on a loaded machine", async () => {
    await expect(
      walk(249, { cpuMs: CAPTURED_CI_WORK_MS, wallMs: HEAVIEST_LOADED_WALL_MS }),
    ).resolves.toBe("walk completed");
  });

  it("gives a growing migration walk more work", async () => {
    await expect(
      walk(498, { cpuMs: 2 * CAPTURED_CI_WORK_MS, wallMs: HEAVIEST_LOADED_WALL_MS }),
    ).resolves.toBe("walk completed");
  });

  it("still refuses a walk whose work reaches its budget", async () => {
    const { workMs } = migrationUpgradeBudget(249);
    await expect(walk(249, { cpuMs: workMs, wallMs: 100_000 })).rejects.toThrow(
      `past the ${workMs} ms budget`,
    );
  });

  it("admits three times the largest gap measured between phases under load", async () => {
    await expect(
      walk(249, { cpuMs: 100_000, wallMs: 200_000, gapMs: 3 * LARGEST_LOADED_GAP_MS }),
    ).resolves.toBe("walk completed");
  });

  it("refuses a walk in which no phase starts or finishes for two minutes", async () => {
    await expect(walk(249, { cpuMs: 100_000, wallMs: 200_000, gapMs: 120_000 })).rejects.toThrow(
      "past the 120000 ms no-progress limit",
    );
  });

  it("bounds the test above the heaviest loaded walk measured, the work budget, and the no-progress limit plus its grace", () => {
    for (const steps of [1, 249, 498]) {
      const { workMs, idleMs, timeoutMs } = migrationUpgradeBudget(steps);
      expect(timeoutMs).toBeGreaterThanOrEqual(1.5 * HEAVIEST_LOADED_WALL_MS);
      expect(timeoutMs).toBeGreaterThan(workMs);
      expect(timeoutMs).toBeGreaterThan(idleMs + DEFAULT_GRACE_MS);
    }
  });
});
