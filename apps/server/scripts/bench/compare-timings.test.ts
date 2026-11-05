import { describe, expect, it } from "vitest";
import { compareTimings, formatComparison } from "./compare-timings.js";
import type { MeasureResult } from "./measure.js";

function result(medians: Record<string, number[]>, seed = 1): MeasureResult {
  return {
    load: "idle",
    machine: { hostname: "bench", cpu: "M-test", cores: 8, memoryBytes: 1, platform: "darwin" },
    node: "v24.0.0",
    commit: "0".repeat(40),
    seed,
    profile: { days: 360 },
    totalRows: 100,
    samples: 10,
    rounds: 3,
    cases: Object.entries(medians).map(([name, values]) => ({
      name,
      outcomes: { "200": 30 },
      leastSeen: 1,
      rounds: values.map((medianMs, index) => ({
        round: index + 1,
        count: 10,
        medianMs,
        p95Ms: medianMs,
        maxMs: medianMs,
      })),
    })),
  };
}

describe("compareTimings", () => {
  const before = result({ "sale.counter": [9, 10, 9.5], "floor.read": [9, 10, 9.5] });

  it("calls a rise of 15% over before's highest round slower, and 5% the same", () => {
    const rows = compareTimings(
      before,
      result({ "sale.counter": [11.5, 11.5, 11.5], "floor.read": [10.5, 10.5, 10.5] }),
    );
    expect(rows.map((row) => [row.name, row.verdict])).toEqual([
      ["sale.counter", "slower"],
      ["floor.read", "same"],
    ]);
    expect(formatComparison(rows)).toMatch(/sale\.counter.*slower/);
  });

  it("calls a fall of over 10% below before's lowest round faster", () => {
    const rows = compareTimings(
      before,
      result({ "sale.counter": [8, 8, 8], "floor.read": [8.5, 8.5, 8.5] }),
    );
    expect(rows.map((row) => row.verdict)).toEqual(["faster", "same"]);
  });

  it("refuses two results with different seeds", () => {
    expect(() => compareTimings(before, result({ "sale.counter": [10] }, 2))).toThrow(/seed/);
  });

  it("refuses two results from different profiles or machines", () => {
    const other = result({ "sale.counter": [10] });
    expect(() => compareTimings(before, { ...other, profile: { days: 2 } })).toThrow(/profile/);
    expect(() =>
      compareTimings(before, { ...other, machine: { ...other.machine, cpu: "other" } }),
    ).toThrow(/machine/);
  });
});
