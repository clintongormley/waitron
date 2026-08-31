import { describe, expect, it } from "vitest";
import { BAND_RANK, classifyBand, worstBand } from "./timing.js";

const T = { warmAfterMinutes: 5, overdueAfterMinutes: 10, forgottenAfterMinutes: 15 };
const at = (min: number) => classifyBand(0, min * 60_000, T);

describe("classifyBand", () => {
  it("is fresh below warm", () => expect(at(4.99)).toBe("fresh"));
  it("warm exactly at the warm threshold", () => expect(at(5)).toBe("warm"));
  it("warm just under overdue", () => expect(at(9.99)).toBe("warm"));
  it("overdue exactly at the overdue threshold", () => expect(at(10)).toBe("overdue"));
  it("overdue just under forgotten", () => expect(at(14.99)).toBe("overdue"));
  it("forgotten exactly at the forgotten threshold", () => expect(at(15)).toBe("forgotten"));
  it("clamps a future queuedAt to fresh", () => expect(classifyBand(60_000, 0, T)).toBe("fresh"));
});

describe("worstBand", () => {
  it("picks the highest-ranked band", () =>
    expect(worstBand(["fresh", "overdue", "warm"])).toBe("overdue"));
  it("is fresh for an empty set", () => expect(worstBand([])).toBe("fresh"));
});

it("BAND_RANK orders the scale", () =>
  expect([BAND_RANK.fresh, BAND_RANK.warm, BAND_RANK.overdue, BAND_RANK.forgotten]).toEqual([
    0, 1, 2, 3,
  ]));
