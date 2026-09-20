import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import { aggregate, findReports } from "./mutation-aggregate.mjs";

const here = dirname(fileURLToPath(import.meta.url));

const temporaryRoots = [];
afterAll(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** Writes one report per shard into a fresh directory, the shape the CI artifacts arrive in. */
function shardDirectory(reports) {
  const root = mkdtempSync(join(tmpdir(), "mutation-aggregate-"));
  temporaryRoots.push(root);
  reports.forEach((content, index) => {
    const shard = join(root, `mutation-report-db-shard-${index + 1}`);
    mkdirSync(shard);
    writeFileSync(join(shard, "mutation.json"), JSON.stringify(content));
  });
  return root;
}

function run(...args) {
  return spawnSync("node", [join(here, "mutation-aggregate.mjs"), ...args], { encoding: "utf8" });
}

/** A shard report in the mutation-testing-elements shape, with one mutant per status given. */
function report(file, ...mutants) {
  return {
    schemaVersion: "1",
    files: {
      [file]: {
        language: "typescript",
        source: "",
        mutants: mutants.map((mutant, index) => ({
          id: String(index),
          mutatorName: mutant.mutator ?? "StringLiteral",
          replacement: mutant.replacement ?? '""',
          status: mutant.status,
          location: {
            start: { line: mutant.line ?? index + 1, column: 1 },
            end: { line: mutant.line ?? index + 1, column: mutant.endColumn ?? 9 },
          },
        })),
      },
    },
  };
}

describe("aggregate", () => {
  it("adds up the mutants of every shard into one score", () => {
    const result = aggregate([
      report("src/a.ts", { status: "Killed" }, { status: "Survived" }),
      report("src/b.ts", { status: "Killed" }, { status: "Timeout" }),
    ]);

    expect(result.killed).toBe(3);
    expect(result.valid).toBe(4);
    expect(result.score).toBe(75);
  });

  it("counts a mutant no test covers against the score", () => {
    const result = aggregate([report("src/a.ts", { status: "Killed" }, { status: "NoCoverage" })]);

    expect(result.valid).toBe(2);
    expect(result.score).toBe(50);
  });

  it("leaves an ignored mutant out of the score entirely", () => {
    const result = aggregate([report("src/a.ts", { status: "Killed" }, { status: "Ignored" })]);

    expect(result.valid).toBe(1);
    expect(result.score).toBe(100);
  });

  it("counts a mutant two shards both report only once", () => {
    // A file heavy enough to be split into line ranges is mutated by several shards, and a range
    // boundary can hand the same mutant to two of them.
    const shared = report("src/a.ts", { status: "Survived", line: 7 });

    const result = aggregate([
      shared,
      JSON.parse(JSON.stringify(shared)),
      report("src/a.ts", { status: "Killed", line: 9 }),
    ]);

    expect(result.valid).toBe(2);
    expect(result.score).toBe(50);
  });

  it("keeps two mutants that start at the same place and end at different ones", () => {
    // `a && b` gives Stryker two ConditionalExpression mutants that both replace with `true` and
    // both start at the left operand's column: the whole condition, and the operand. Only the END
    // of the span tells them apart, and on run 35504169506's real reports 21 mutants were a pair
    // of this shape.
    const result = aggregate([
      report(
        "src/a.ts",
        { status: "Killed", line: 4, endColumn: 40, mutator: "ConditionalExpression" },
        { status: "Survived", line: 4, endColumn: 20, mutator: "ConditionalExpression" },
      ),
    ]);

    expect(result.valid).toBe(2);
    expect(result.score).toBe(50);
  });

  it("gives a mutant two shards disagree about its UNDETECTED status, whichever is read first", () => {
    // Merging must never be able to RAISE the score, so a disagreement resolves downwards and the
    // answer does not depend on the order the artifacts happen to be listed in.
    const survived = report("src/a.ts", { status: "Survived", line: 7 });
    const killed = report("src/a.ts", { status: "Killed", line: 7 });

    expect(aggregate([survived, killed]).score).toBe(0);
    expect(aggregate([killed, survived]).score).toBe(0);
  });

  it("reports each file's own score, worst first", () => {
    const result = aggregate([
      report("src/good.ts", { status: "Killed" }, { status: "Killed" }),
      report("src/bad.ts", { status: "Survived" }, { status: "Killed" }),
    ]);

    expect(result.files.map((file) => file.path)).toEqual(["src/bad.ts", "src/good.ts"]);
    expect(result.files[0]).toMatchObject({ valid: 2, killed: 1, score: 50 });
  });

  it("calls a run with no valid mutants at all a zero rather than dividing by it", () => {
    const result = aggregate([report("src/a.ts", { status: "Ignored" })]);

    expect(result.valid).toBe(0);
    expect(result.score).toBe(0);
  });
});

describe("findReports", () => {
  it("finds a report inside each shard's own directory", () => {
    const root = shardDirectory([
      report("src/a.ts", { status: "Killed" }),
      report("src/b.ts", { status: "Killed" }),
    ]);

    expect(findReports(root).map((path) => path.slice(root.length + 1))).toEqual([
      "mutation-report-db-shard-1/mutation.json",
      "mutation-report-db-shard-2/mutation.json",
    ]);
  });

  it("ignores the html report the same artifact carries", () => {
    const root = shardDirectory([report("src/a.ts", { status: "Killed" })]);
    writeFileSync(join(root, "mutation-report-db-shard-1", "index.html"), "<html></html>");

    expect(findReports(root)).toHaveLength(1);
  });

  it("ignores a json that is not a mutation report", () => {
    const root = shardDirectory([report("src/a.ts", { status: "Killed" })]);
    writeFileSync(join(root, "extra.json"), "{}");
    writeFileSync(join(root, "broken.json"), "not json at all");

    expect(findReports(root)).toHaveLength(1);
  });
});

describe("the command", () => {
  it("prints the score and exits 0 when the package clears the bar", () => {
    const root = shardDirectory([
      report("src/a.ts", { status: "Killed" }, { status: "Killed" }),
      report("src/b.ts", { status: "Killed" }, { status: "Survived" }),
    ]);

    const result = run(root, "--shards", "2", "--break", "70");

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("75.00%");
  });

  it("refuses when a shard is missing, however many json files are lying around", () => {
    // The hole this closes: nine real reports plus one unrelated json used to count as ten shards,
    // and a shard whose job failed takes its own survivors with it, so the nine read too high.
    const root = shardDirectory([
      report("src/a.ts", { status: "Killed" }),
      report("src/b.ts", { status: "Killed" }),
    ]);
    writeFileSync(join(root, "mutation-report-db-shard-1", "second.json"), JSON.stringify({}));

    const result = run(root, "--shards", "3", "--break", "50");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("expected 3 shard reports");
  });

  it("fails when the package is below the bar", () => {
    const root = shardDirectory([report("src/a.ts", { status: "Killed" }, { status: "Survived" })]);

    const result = run(root, "--shards", "1", "--break", "90");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("50.00%");
    expect(result.stderr).toContain("90");
  });

  it("refuses to score a run that is missing a shard's report", () => {
    // A shard that crashed publishes nothing, and the mutants it would have reported are usually
    // the ones nobody has written tests for — scoring the rest would report a number that is too
    // high and call the package green.
    const root = shardDirectory([report("src/a.ts", { status: "Killed" })]);

    const result = run(root, "--shards", "10", "--break", "90");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("found 1 in 1 file(s)");
    expect(result.stdout).not.toContain("100.00%");
  });

  it("names each file below the bar so the report says where to look", () => {
    const root = shardDirectory([
      report("src/bad.ts", { status: "Survived" }, { status: "Killed" }),
      report("src/good.ts", { status: "Killed" }),
    ]);

    // The package as a whole clears 60 (two of three mutants detected); one file does not.
    const result = run(root, "--shards", "2", "--break", "60");

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("src/bad.ts");
    expect(result.stdout).not.toContain("src/good.ts");
  });
});

// The shard COUNT is written twice in `.github/workflows/mutation.yml`: once as the matrix list the
// ten shard jobs come from, and once as the `--shards` argument the aggregate job uses to refuse a
// run with a report missing. The shard SCRIPT avoids that by reading `strategy.job-total`, which a
// separate job cannot see. This reads the workflow as TEXT, so it checks those two numbers and
// nothing else about the file — it cannot tell you the aggregate job runs, only that if it does it
// expects as many reports as the matrix produces.
describe("the shard count in the mutation workflow", () => {
  const workflow = readFileSync(join(here, "..", ".github", "workflows", "mutation.yml"), "utf8");

  it("matches between the shard matrix and the aggregate job's --shards", () => {
    const matrix = workflow.match(/shard: \[([^\]]*)\]/);
    expect(matrix, "no `shard: [...]` matrix in mutation.yml").not.toBeNull();
    const shards = matrix[1].split(",").length;

    const argument = workflow.match(/--shards (\d+)/);
    expect(argument, "no `--shards <n>` argument in mutation.yml").not.toBeNull();

    expect(Number(argument[1])).toBe(shards);
  });
});
