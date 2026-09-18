/**
 * The runner's pure half: what a result set is, which result sets fail a run, how a scenario that
 * threw is recorded, and the two output shapes. Nothing here starts a container, reads a file or
 * looks at `process`.
 *
 * It lives in its OWN module because `scenarios.ts` ends in a top-level `await main()`: importing a
 * VALUE from it runs the whole suite. Measured 2026-09-18 — a `node:module` load hook over
 * `import('./src/scenarios.ts')` printed `LOADED SCENARIO MODULE: s0_happy_loop.ts`, then s1, s2, s3,
 * s4; importing a scenario, which takes only `import type` from `scenarios.ts`, resolved in 31 ms and
 * loaded nothing. `s_runner_contract.ts` therefore drives these functions from here.
 */

export type Verdict = "PASS" | "FAIL" | "MEASURED" | "SKIPPED";

export type ScenarioResult = {
  id: string;
  title: string;
  verdict: Verdict;
  critical: boolean;
  detail: string;
};

/**
 * The rows that fail the run. A FAIL is a recorded outcome, so only a CRITICAL one counts (spec §7);
 * `MEASURED` and `SKIPPED` never do, a critical `SKIPPED` included — that scenario is UNPROVEN, which
 * is a fact for the results note rather than a broken premise.
 */
export function criticalFailures(results: readonly ScenarioResult[]): ScenarioResult[] {
  return results.filter((result) => result.critical && result.verdict === "FAIL");
}

/** The runner's exit code, and the single decision `main()` branches on. */
export function exitCodeFor(results: readonly ScenarioResult[]): number {
  return criticalFailures(results).length > 0 ? 1 : 0;
}

/**
 * The row a scenario that threw gets. It never said what it would have claimed, so the runner cannot
 * know whether its subject was critical — it is recorded critical whatever its id, so a broken
 * harness is never quiet.
 */
export function resultForThrow(file: string, error: unknown): ScenarioResult {
  return {
    id: file.replace(/\.ts$/, ""),
    title: "threw",
    verdict: "FAIL",
    critical: true,
    detail: error instanceof Error ? error.message : String(error),
  };
}

function cell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

export function formatTable(results: readonly ScenarioResult[]): string {
  const lines = ["", "| id | title | verdict | detail |", "| --- | --- | --- | --- |"];
  for (const result of results) {
    lines.push(
      `| ${cell(result.id)} | ${cell(result.title)} | ${result.verdict} | ${cell(result.detail)} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * The `--json` shape: ONE document, so a caller can pipe the run straight into a parser. It carries
 * the exit code as well as the rows because a piped run's own exit status is the pipeline's last
 * command, not the runner's.
 */
export function formatJson(results: readonly ScenarioResult[]): string {
  return JSON.stringify(
    {
      results,
      criticalFailures: criticalFailures(results).map((result) => result.id),
      exitCode: exitCodeFor(results),
    },
    null,
    2,
  );
}

/**
 * Which output a run asked for. It takes the argument list rather than reading `process.argv` so the
 * choice is driveable from a scenario: with the flag read inside `main()`, a cut wiring printed the
 * table under `--json` and `s_runner_contract.ts` still reported PASS (measured 2026-09-18, with
 * `const asJson = process.argv.includes("--json")` replaced by `const asJson = false`).
 */
export function wantsJson(argv: readonly string[]): boolean {
  return argv.includes("--json");
}

/** The whole of what a run writes to stdout — one string, so `--json` is one parseable document. */
export function render(argv: readonly string[], results: readonly ScenarioResult[]): string {
  return wantsJson(argv) ? formatJson(results) : formatTable(results);
}
