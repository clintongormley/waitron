import { readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { criticalFailures, exitCodeFor, render, resultForThrow } from "./runner-contract.ts";
import type { ScenarioResult } from "./runner-contract.ts";
import { startStore } from "./store.ts";

export type { ScenarioResult, Verdict } from "./runner-contract.ts";

export type ScenarioContext = { startStore: typeof startStore };

type Scenario = (ctx: ScenarioContext) => Promise<ScenarioResult>;

const scenarioDir = join(dirname(fileURLToPath(import.meta.url)), "scenarios");

/**
 * Every `.ts` FILE in the directory, in filename order. Not a prefix match: the scenarios are named
 * `s_smoke.ts`, `s1_double_promotion.ts`, `s6_store_cas.ts` and so on, and a filter narrower than
 * "a TypeScript file in this directory" would silently run a subset while still printing a table.
 */
function discover(): string[] {
  return readdirSync(scenarioDir)
    .filter((name) => name.endsWith(".ts") && statSync(join(scenarioDir, name)).isFile())
    .sort();
}

async function main(): Promise<void> {
  const context: ScenarioContext = { startStore };
  const results: ScenarioResult[] = [];

  for (const file of discover()) {
    try {
      // The import is INSIDE the try: a module that throws while loading would otherwise abort the
      // whole run — no table, and every later scenario unrun.
      const module = (await import(pathToFileURL(join(scenarioDir, file)).href)) as {
        default: Scenario;
      };
      results.push(await module.default(context));
    } catch (error) {
      results.push(resultForThrow(file, error));
    }
  }

  console.log(render(process.argv, results));

  const exitCode = exitCodeFor(results);
  if (exitCode !== 0) {
    console.error(
      `CRITICAL failure: ${criticalFailures(results)
        .map((result) => result.id)
        .join(", ")} — see the results above.`,
    );
    process.exit(exitCode);
  }
}

await main();
