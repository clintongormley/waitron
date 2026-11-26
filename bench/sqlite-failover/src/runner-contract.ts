export type Verdict = "PASS" | "FAIL" | "MEASURED" | "SKIPPED";

export type ScenarioResult = {
  id: string;
  title: string;
  verdict: Verdict;
  critical: boolean;
  detail: string;
};

export function criticalFailures(results: readonly ScenarioResult[]): ScenarioResult[] {
  return results.filter((result) => result.critical && result.verdict === "FAIL");
}

export function exitCodeFor(results: readonly ScenarioResult[]): number {
  return criticalFailures(results).length > 0 ? 1 : 0;
}

// A scenario that throws gets a critical failure row because it never returned a verdict.
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

// Include the exit code in the JSON because a caller piping stdout can otherwise lose the runner's
// status.
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

// Take the arguments as input so the scenario can exercise the same renderer selection.
export function wantsJson(argv: readonly string[]): boolean {
  return argv.includes("--json");
}

export function render(argv: readonly string[], results: readonly ScenarioResult[]): string {
  return wantsJson(argv) ? formatJson(results) : formatTable(results);
}
