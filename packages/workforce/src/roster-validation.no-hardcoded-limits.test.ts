import { describe, expect, it } from "vitest";

/**
 * The roster-guardrail engine reads every threshold from the caller's `WorkTimeRuleset`, so no
 * ET-statutory default may appear in its source as a literal: a baked-in limit would ignore a
 * collective agreement that tightened it. Weaker than its name: it matches the listed numbers as
 * text in one file, so a limit spelled any other way (`9 * 60`) passes. The structural constants
 * (60000, 1440, 60, 7) are not limits and are not listed.
 */

// Vitest runs through Vite, so `import.meta.glob` exists at runtime; this package has no `vite` types.
declare global {
  interface ImportMeta {
    glob(
      pattern: string | string[],
      options: { query: string; import: string; eager: true },
    ): Record<string, string>;
  }
}

const engine = import.meta.glob(["./roster-validation.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const FORBIDDEN_LIMITS: Array<[value: number, field: string]> = [
  [2400, "maxWeeklyMinutes"],
  [720, "minInterShiftRestMinutes"],
  [540, "maxOrdinaryDailyMinutes"],
  [360, "breakThresholdMinutes / nightWindowEndMinute"],
  [15, "minBreakMinutes"],
  [2160, "weeklyRestMinutes"],
  [80, "annualOvertimeCapHours"],
  [1320, "nightWindowStartMinute"],
];

describe("the roster-guardrail engine hard-codes no ruleset limit", () => {
  const source = Object.values(engine)[0];

  it("resolves exactly one engine source file", () => {
    // Otherwise the checks below pass vacuously against an empty source.
    expect(Object.keys(engine)).toHaveLength(1);
    expect(source).toContain("export function validateRoster");
  });

  it.each(FORBIDDEN_LIMITS)(
    "contains no literal %s (its limit is read from ruleset.%s)",
    (value) => {
      expect(source).not.toMatch(new RegExp(`\\b${value}\\b`));
    },
  );
});
