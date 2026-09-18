// The runner's own contract, checked against a table of cases: which results make `scenarios` exit
// non-zero, how a scenario that threw is recorded, and that `--json` prints one parseable document.
//
// It is marked critical even though the spec's critical set is S0/S1/S2/S3/S6 (spec §7) for one
// reason and no more: a wrong exit rule makes every other row's reporting untrustworthy, because a
// run's exit code is what the campaign reads instead of the table.
//
// Like S2 and S5 it takes no `ScenarioContext`: every function it drives is pure, so it starts no
// container, opens no store and touches no file.
//
// Unlike every sibling it reports a failed assertion as a FAIL rather than letting it throw, because
// a mismatch here is this scenario's result. Anything that is not an assertion failure is rethrown.
import assert from "node:assert";
import type { ScenarioResult } from "../scenarios.ts";
import {
  criticalFailures,
  exitCodeFor,
  formatJson,
  render,
  resultForThrow,
} from "../runner-contract.ts";

function row(id: string, verdict: ScenarioResult["verdict"], critical: boolean): ScenarioResult {
  return { id, title: `fixture ${id}`, verdict, critical, detail: `fixture=${id}` };
}

const CRITICAL_FAIL = [row("S2", "FAIL", true)];
const NON_CRITICAL_FAIL = [row("S4", "FAIL", false)];
const CRITICAL_SKIPPED = [row("S0", "SKIPPED", true)];
const CRITICAL_MEASURED = [row("S0", "MEASURED", true)];
const CRITICAL_PASS = [row("S6", "PASS", true)];
const EMPTY: ScenarioResult[] = [];
/** A whole run that must not fail: the only FAIL in it is a non-critical one. */
const MIXED_CLEAN = [row("S0", "PASS", true), row("S4", "FAIL", false), row("S5", "PASS", false)];
/** The same shape with the FAIL moved onto a critical scenario. */
const MIXED_FAILING = [
  row("S0", "PASS", true),
  row("S2", "FAIL", true),
  row("S4", "MEASURED", false),
];

/**
 * Each case is the whole result set of one run and the exit code that run must produce. The order is
 * the order a reader should meet them in: the rule, then each verdict the rule must NOT act on.
 */
const CASES: { name: string; results: ScenarioResult[]; exit: number }[] = [
  { name: "a critical FAIL exits non-zero", results: CRITICAL_FAIL, exit: 1 },
  { name: "a non-critical FAIL exits 0", results: NON_CRITICAL_FAIL, exit: 0 },
  { name: "a critical SKIPPED exits 0", results: CRITICAL_SKIPPED, exit: 0 },
  { name: "a critical MEASURED exits 0", results: CRITICAL_MEASURED, exit: 0 },
  { name: "a critical PASS exits 0", results: CRITICAL_PASS, exit: 0 },
  { name: "a run with no scenarios exits 0", results: EMPTY, exit: 0 },
  { name: "a non-critical FAIL beside critical passes exits 0", results: MIXED_CLEAN, exit: 0 },
  { name: "one critical FAIL among other rows exits non-zero", results: MIXED_FAILING, exit: 1 },
];

export default async function runnerContract(): Promise<ScenarioResult> {
  const id = "RUNNER";
  const title = "the runner's exit rule and --json dump";
  try {
    for (const each of CASES) {
      assert.equal(exitCodeFor(each.results), each.exit, each.name);
    }
    assert.deepEqual(
      criticalFailures(MIXED_FAILING).map((result) => result.id),
      ["S2"],
      "the run names the critical scenarios that failed, and only those",
    );

    // A scenario that threw never said what it was measuring, so the runner cannot know whether its
    // subject was critical: it is recorded critical whatever its id, which `S4` — a non-critical
    // scenario — is the case that shows.
    const thrown = resultForThrow("s4_offline_load.ts", new Error("boom"));
    assert.equal(
      thrown.id,
      "s4_offline_load",
      "a scenario that threw is recorded under its file name",
    );
    assert.equal(thrown.verdict, "FAIL", "a scenario that threw is recorded as a FAIL");
    assert.equal(
      thrown.critical,
      true,
      "a scenario that threw is recorded critical whatever its id",
    );
    assert.match(thrown.detail, /boom/, "the throw's own message is what the row's detail carries");
    // A module can reject with something that is not an Error — a string, an object — and the row is
    // the only place that text survives, since nothing else records what the scenario threw.
    assert.match(
      resultForThrow("s0_happy_loop.ts", "not an Error").detail,
      /not an Error/,
      "a throw that is not an Error still carries its text into the row",
    );
    assert.equal(
      exitCodeFor([thrown]),
      1,
      "a scenario that threw fails the run even though its id is not in the critical set",
    );

    // The table is this gate's product — the results note is filled from it — and `--json` is how a
    // caller captures a run. Both are reached through `render`, which takes the argument list rather
    // than reading `process.argv`, so the flag's effect is driveable here: with the choice made
    // inside `main()` instead, a `formatTable` returning "" printed nothing and a cut `--json`
    // wiring printed the table, and this scenario reported PASS through both (measured 2026-09-18).
    const table = render(["node", "scenarios.ts"], MIXED_FAILING);
    const tableLines = table.split("\n").filter((line) => line.startsWith("|"));
    assert.equal(
      tableLines.length,
      MIXED_FAILING.length + 2,
      "the table prints a header, a separator and one row per scenario",
    );
    assert.equal(
      tableLines[0],
      "| id | title | verdict | detail |",
      "the table's header names the four columns the results note reads",
    );
    for (const each of MIXED_FAILING) {
      assert.ok(
        tableLines.some((line) => line.includes(`| ${each.id} |`) && line.includes(each.verdict)),
        `the table carries ${each.id} with its verdict`,
      );
    }
    for (const each of MIXED_FAILING) {
      assert.ok(
        tableLines.some((line) => line.includes(`| ${each.title} |`)),
        `the table carries ${each.id}'s title`,
      );
    }
    // A detail carrying a pipe would otherwise open a column the reader never sees, and one carrying
    // a newline would end the row early — a scenario that threw is the case, since an error message
    // runs to several lines.
    const piped = { ...row("P", "PASS", false), detail: "refused=a|b" };
    assert.match(
      render(["node", "scenarios.ts"], [piped]),
      /refused=a\\\|b/,
      "a pipe inside a cell is escaped",
    );
    const multiline = { ...row("P", "PASS", false), detail: "first\nsecond" };
    const multilineRow = render(["node", "scenarios.ts"], [multiline])
      .split("\n")
      .find((line) => line.startsWith("| P |"));
    assert.ok(
      multilineRow?.includes("first second"),
      "a newline inside a cell is flattened, so the whole detail stays on the row",
    );

    assert.equal(
      render(["node", "scenarios.ts", "--json"], MIXED_FAILING),
      formatJson(MIXED_FAILING),
      "--json renders the JSON document and not the table",
    );
    assert.notEqual(
      render(["node", "scenarios.ts"], MIXED_FAILING),
      formatJson(MIXED_FAILING),
      "without --json the run renders the table and not the JSON document",
    );

    const dump = formatJson(MIXED_FAILING);
    type Dump = { results?: ScenarioResult[]; criticalFailures?: string[]; exitCode?: number };
    let parsed: Dump | undefined;
    assert.doesNotThrow(() => {
      parsed = JSON.parse(dump) as Dump;
    }, "--json prints one parseable JSON document");
    assert.deepEqual(parsed?.results, MIXED_FAILING, "the --json dump carries every row verbatim");
    assert.equal(
      parsed?.exitCode,
      exitCodeFor(MIXED_FAILING),
      "the --json dump reports the same exit code the runner exits with",
    );
    // The dump's own list, not the function's: a reader takes the ids from here rather than
    // re-deriving them, so an empty list would say a failing run had no critical failure.
    assert.deepEqual(
      parsed?.criticalFailures,
      criticalFailures(MIXED_FAILING).map((result) => result.id),
      "the --json dump names the critical scenarios that failed",
    );

    return {
      id,
      title,
      verdict: "PASS",
      critical: true,
      detail:
        `exit-rule-cases=${CASES.length} critical-fail-exit=${exitCodeFor(CRITICAL_FAIL)} ` +
        `non-critical-fail-exit=${exitCodeFor(NON_CRITICAL_FAIL)} critical-skipped-exit=${exitCodeFor(CRITICAL_SKIPPED)} ` +
        `critical-measured-exit=${exitCodeFor(CRITICAL_MEASURED)} critical-pass-exit=${exitCodeFor(CRITICAL_PASS)} ` +
        `empty-run-exit=${exitCodeFor(EMPTY)} throw-verdict=${thrown.verdict} throw-critical=${thrown.critical} ` +
        `throw-exit=${exitCodeFor([thrown])} json-parsed=true json-rows=${parsed?.results?.length} json-exit-code=${parsed?.exitCode} json-critical-ids=${parsed?.criticalFailures?.length} ` +
        `table-rows=${tableLines.length} table-escapes-pipe=true table-flattens-newline=true ` +
        `json-selected-by-flag=true`,
    };
  } catch (error) {
    // A failed ASSERTION is this scenario's own verdict, not a broken harness, so it is reported as
    // a FAIL rather than thrown — every sibling throws, and this one does not because the rule it
    // checks is the runner's own. Anything else is rethrown, so a `TypeError` or a bad import still
    // reaches `resultForThrow` and reads as the broken harness it is.
    if (!(error instanceof assert.AssertionError)) throw error;
    // The failing assertion's message is the whole finding, so it is what the detail carries,
    // flattened first: node's assertion messages run to several lines and carry their own double
    // quotes, either of which would break the space-separated `key=value` shape the siblings print.
    const message = error.message;
    const flattened = message.replaceAll(/\s+/g, " ").replaceAll('"', "'");
    return {
      id,
      title,
      verdict: "FAIL",
      critical: true,
      detail: `exit-rule-cases=${CASES.length} failed-assertion="${flattened}"`,
    };
  }
}
