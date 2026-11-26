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

export function wantsJson(argv: readonly string[]): boolean {
  return argv.includes("--json");
}

export function render(argv: readonly string[], results: readonly ScenarioResult[]): string {
  return wantsJson(argv) ? formatJson(results) : formatTable(results);
}
