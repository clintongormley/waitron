import { describe, expect, it } from "vitest";
import type { TableSignal } from "@waitron/shared";
import { currentStep, nextStepDueAt } from "./service-steps.js";

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
