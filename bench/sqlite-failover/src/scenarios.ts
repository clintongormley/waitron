/**
 * The scenario runner: discovers every scenario in `src/scenarios/`, runs them one at a time, prints
 * a Markdown table — or, with `--json`, one JSON document — and exits non-zero only when a CRITICAL
 * scenario failed.
 *
 * A scenario is a measurement, not a build gate (spec §7): a FAIL is a recorded outcome, and only
 * the critical scenarios — S0, S1, S2, S3 and S6 — stop anything, plus any scenario that THROWS,
 * whatever its id. The rule itself is in `runner-contract.ts`, where `s_runner_contract.ts` drives
 * it over a table of cases.
 */
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
 *
 * The `isFile()` check is not decoration: a name ending in `.ts` is not necessarily a module, and a
 * directory carrying that name is imported inside the try below, where the throw is reported as a
 * CRITICAL failure of a scenario nobody wrote. Root `CLAUDE.md` §4 states the rule — a source
 * scanner selects files, not just paths ending in `.ts`.
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

  // Exactly one write to stdout, so the document a `--json` caller pipes is parseable whole. Which
  // shape it is, is `render`'s decision and not this function's — `s_runner_contract.ts` drives it.
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
