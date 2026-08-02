import { describe, expect, it } from "vitest";

/**
 * The `no-hardcoded-margin` discipline (CLAUDE.md §3; the pattern is
 * packages/fiscal/src/no-hardcoded-margin.test.ts) applied to the roster-guardrail engine: EVERY
 * threshold it measures against is read from the caller-supplied `WorkTimeRuleset`, so NONE of the
 * ET-statutory default values may appear as a literal in the engine source. A baked-in limit would
 * silently ignore a convenio that tightened it — the exact defect this guard exists to prevent.
 *
 * Proved to bite by deletion: temporarily replacing a `ruleset.<field>` read with its statutory
 * default value (e.g. `540`) fails the matching assertion below. The structural constants the engine
 * legitimately uses — 60000 (ms/min), 1440 (min/day), 60 (min/hour), 7 (days/week) — are not
 * guardrail limits and are deliberately not listed.
 */

// Vitest runs through Vite, so `import.meta.glob` is available at runtime; its type is narrowed here
// (this package carries no `vite` devDependency) exactly as no-hardcoded-margin.test.ts does.
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

/** Each ET-statutory default, and the ruleset field it must be read from instead of hard-coded. */
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

describe("the roster-guardrail engine hard-codes no convenio limit", () => {
  const source = Object.values(engine)[0];

  it("resolves exactly one engine source file", () => {
    // Without this the checks below would pass vacuously against an undefined/empty source.
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
