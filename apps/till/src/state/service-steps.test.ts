import { describe, expect, it } from "vitest";
import type { TableSignal } from "@waitron/shared";
import { currentStep, nextStepDueAt, stepWaitMinutes, nextStepChangeAt } from "./service-steps.js";

const now = Date.parse("2026-09-30T20:00:00.000Z");
const inMinutes = (m: number) => new Date(now + m * 60_000).toISOString();

const steps = (...dueAts: number[]): TableSignal[] => [
  { kind: "held", count: 1 },
  {
    kind: "service_step",
    steps: dueAts.map((m, i) => ({
      stepId: `s${i + 1}`,
      name: `Step ${i + 1}`,
      dueAt: inMinutes(m),
    })),
  },
];

describe("currentStep", () => {
  it("is the latest due of the steps", () => {
    expect(currentStep(steps(-10, -2, 5), now)).toEqual({
      stepId: "s2",
      name: "Step 2",
      dueAt: inMinutes(-2),
    });
  });

  it("is null while no step is due, or with no step signal", () => {
    expect(currentStep(steps(1, 5), now)).toBeNull();
    expect(currentStep([{ kind: "held", count: 1 }], now)).toBeNull();
  });

  it("counts a step due exactly now", () => {
    expect(currentStep(steps(-3, 0), now)?.stepId).toBe("s2");
  });
});

describe("nextStepDueAt", () => {
  it("is the first step still ahead", () => {
    expect(nextStepDueAt(steps(-3, 0, 4, 9), now)).toBe(Date.parse(inMinutes(4)));
  });

  it("is never with no step ahead", () => {
    expect(nextStepDueAt(steps(-3, 0), now)).toBe(Number.POSITIVE_INFINITY);
    expect(nextStepDueAt([], now)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("late step timing", () => {
  it("starts the elapsed wait at five minutes, then counts whole minutes", () => {
    const step = { stepId: "s1", name: "Set up", dueAt: inMinutes(0) };
    expect(stepWaitMinutes(step, now - 1)).toBeNull();
    expect(stepWaitMinutes(step, now + 299_999)).toBeNull();
    expect(stepWaitMinutes(step, now + 300_000)).toBe(5);
    expect(stepWaitMinutes(step, now + 359_999)).toBe(5);
    expect(stepWaitMinutes(step, now + 360_000)).toBe(6);
  });

  it("wakes for the five-minute warning and each elapsed minute afterward", () => {
    const due = steps(0);
    expect(nextStepChangeAt(due, now)).toBe(now + 300_000);
    expect(nextStepChangeAt(due, now + 299_999)).toBe(now + 300_000);
    expect(nextStepChangeAt(due, now + 300_000)).toBe(now + 360_000);
    expect(nextStepChangeAt(due, now + 360_001)).toBe(now + 420_000);
  });

  it("wakes sooner for another step and keeps the latest-due choice", () => {
    const due = steps(-4, 0.5);
    expect(nextStepChangeAt(due, now)).toBe(now + 30_000);
    expect(nextStepChangeAt(due, now + 30_000)).toBe(now + 330_000);
    expect(nextStepChangeAt([], now)).toBe(Number.POSITIVE_INFINITY);
  });
});
