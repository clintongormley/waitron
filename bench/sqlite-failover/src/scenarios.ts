/**
 * The scenario runner: discovers every scenario in `src/scenarios/`, runs them one at a time, prints
 * a Markdown table, and exits non-zero only when a CRITICAL scenario failed.
 *
 * A scenario is a measurement, not a build gate (spec §7): a FAIL is a recorded outcome, and only
 * the fiscal-safety and restorability scenarios stop anything.
 */
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startStore } from "./store.ts";

export type ScenarioContext = { startStore: typeof startStore };

export type ScenarioResult = {
  id: string;
  title: string;
  verdict: "PASS" | "FAIL" | "MEASURED" | "SKIPPED";
  critical: boolean;
  detail: string;
};

type Scenario = (ctx: ScenarioContext) => Promise<ScenarioResult>;

const scenarioDir = join(dirname(fileURLToPath(import.meta.url)), "scenarios");

/**
 * Every `.ts` file in the directory, in filename order. Not a prefix match: the scenarios are named
 * `s_smoke.ts`, `s1_double_promotion.ts`, `s6_store_cas.ts` and so on, and a filter narrower than
 * "a TypeScript file in this directory" would silently run a subset while still printing a table.
 */
function discover(): string[] {
  return readdirSync(scenarioDir)
    .filter((name) => name.endsWith(".ts"))
    .sort();
}

function cell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

async function main(): Promise<void> {
  const context: ScenarioContext = { startStore };
  const results: ScenarioResult[] = [];

  for (const file of discover()) {
    const module = (await import(pathToFileURL(join(scenarioDir, file)).href)) as {
      default: Scenario;
    };
    try {
      results.push(await module.default(context));
    } catch (error) {
      // A thrown scenario never said what it would have claimed, so the runner cannot know whether
      // its subject was critical — it is treated as critical so a broken harness is never quiet.
      results.push({
        id: file.replace(/\.ts$/, ""),
        title: "threw",
        verdict: "FAIL",
        critical: true,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.log("\n| id | title | verdict | detail |");
  console.log("| --- | --- | --- | --- |");
  for (const result of results) {
    console.log(
      `| ${cell(result.id)} | ${cell(result.title)} | ${result.verdict} | ${cell(result.detail)} |`,
    );
  }
  console.log("");

  const criticalFailures = results.filter((r) => r.critical && r.verdict === "FAIL");
  if (criticalFailures.length > 0) {
    console.error(
      `CRITICAL failure: ${criticalFailures.map((r) => r.id).join(", ")} — see the table above.`,
    );
    process.exit(1);
  }
}

await main();
