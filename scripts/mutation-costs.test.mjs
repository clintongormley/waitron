import { describe, expect, it } from "vitest";

import {
  costTable,
  fileSecondsFromReport,
  main,
  MUTANT_SECONDS,
  TEST_FILE_SECONDS,
  TIMEOUT_SECONDS,
} from "./mutation-costs.mjs";

/** A Stryker JSON report: `files` maps a path to its mutants, `testFiles` maps a suite to its test ids. */
function report(files, testFiles = {}) {
  return {
    files: Object.fromEntries(
      Object.entries(files).map(([path, mutants]) => [
        path,
        { mutants: mutants.map(([status, coveredBy]) => ({ status, coveredBy })) },
      ]),
    ),
    testFiles: Object.fromEntries(
      Object.entries(testFiles).map(([path, ids]) => [path, { tests: ids.map((id) => ({ id })) }]),
    ),
  };
}

const suites = { "src/a.test.ts": ["0", "1"], "src/b.test.ts": ["2"], "src/c.test.ts": ["3"] };

describe("fileSecondsFromReport", () => {
  it("charges each tested mutant once plus once per distinct test file it runs", () => {
    const seconds = fileSecondsFromReport(
      report({ "src/x.ts": [["Killed", ["0", "1", "2"]]] }, suites),
    );
    expect(seconds.get("src/x.ts")).toBeCloseTo(MUTANT_SECONDS + 2 * TEST_FILE_SECONDS);
  });

  it("adds the timeout charge for a mutant that timed out", () => {
    const seconds = fileSecondsFromReport(report({ "src/x.ts": [["Timeout", ["3"]]] }, suites));
    expect(seconds.get("src/x.ts")).toBeCloseTo(
      MUTANT_SECONDS + TEST_FILE_SECONDS + TIMEOUT_SECONDS,
    );
  });

  it("charges a survivor as a tested mutant", () => {
    const seconds = fileSecondsFromReport(report({ "src/x.ts": [["Survived", ["3"]]] }, suites));
    expect(seconds.get("src/x.ts")).toBeCloseTo(MUTANT_SECONDS + TEST_FILE_SECONDS);
  });

  it("charges nothing for a mutant no test ran", () => {
    const seconds = fileSecondsFromReport(
      report(
        {
          "src/x.ts": [
            ["NoCoverage", []],
            ["Ignored", ["0"]],
            ["CompileError", ["0"]],
            ["RuntimeError", ["0"]],
          ],
        },
        suites,
      ),
    );
    expect(seconds.get("src/x.ts")).toBe(0);
  });

  it("charges nothing for a file the shard was asked to mutate that produced no mutant", () => {
    const seconds = fileSecondsFromReport({
      ...report({ "src/x.ts": [["Killed", []]] }, suites),
      config: { mutate: ["src/x.ts", "src/types-only.ts", "src/split.ts:1-40"] },
    });
    expect(seconds.get("src/types-only.ts")).toBe(0);
    expect(seconds.get("src/split.ts")).toBe(0);
    expect(seconds.get("src/x.ts")).toBeCloseTo(MUTANT_SECONDS);
  });

  it("counts no test files for a report with no testFiles section", () => {
    const seconds = fileSecondsFromReport({
      files: { "src/x.ts": { mutants: [{ status: "Killed", coveredBy: ["0"] }] } },
    });
    expect(seconds.get("src/x.ts")).toBeCloseTo(MUTANT_SECONDS + TEST_FILE_SECONDS);
  });

  it("reads a mutant with no coveredBy list as covered by no test file", () => {
    const seconds = fileSecondsFromReport({
      files: { "src/x.ts": { mutants: [{ status: "Killed" }] } },
      testFiles: {},
    });
    expect(seconds.get("src/x.ts")).toBeCloseTo(MUTANT_SECONDS);
  });
});

describe("costTable", () => {
  it("takes the median of a file's seconds across reports, to a tenth", () => {
    const table = costTable(
      [new Map([["src/x.ts", 10.04]]), new Map([["src/x.ts", 30]]), new Map([["src/x.ts", 20.06]])],
      [],
    );
    expect(table).toEqual({ "src/x.ts": 20.1 });
  });

  it("averages the middle two of an even count", () => {
    expect(costTable([new Map([["src/x.ts", 10]]), new Map([["src/x.ts", 20]])], [])).toEqual({
      "src/x.ts": 15,
    });
  });

  it("keeps every file above zero, so a file no test reaches still has a weight", () => {
    expect(costTable([new Map([["src/x.ts", 0]])], [])).toEqual({ "src/x.ts": 0.1 });
  });

  it("leaves out the package's split files, whose reports hold one range each", () => {
    expect(
      costTable(
        [
          new Map([
            ["src/heavy.ts", 5],
            ["src/x.ts", 1],
          ]),
        ],
        ["src/heavy.ts"],
      ),
    ).toEqual({ "src/x.ts": 1 });
  });

  it("writes the paths in sorted order", () => {
    const table = costTable(
      [
        new Map([
          ["src/b.ts", 1],
          ["src/a.ts", 1],
        ]),
      ],
      [],
    );
    expect(Object.keys(table)).toEqual(["src/a.ts", "src/b.ts"]);
  });
});

describe("main", () => {
  const run = (argv, files) => {
    const written = {};
    const errors = [];
    const status = main(argv, {
      readFile: (path) => files[path],
      writeFile: (path, text) => (written[path] = text),
      stderr: (line) => errors.push(line),
    });
    return { status, written, errors };
  };

  it("writes the package's table from every report it is given", () => {
    const one = JSON.stringify(report({ "src/x.ts": [["Killed", ["0"]]] }, suites));
    const two = JSON.stringify(
      report(
        { "src/schema/sales.ts": [["Killed", ["0"]]], "src/y.ts": [["Timeout", ["2"]]] },
        suites,
      ),
    );
    const { status, written } = run(["db", "out.json", "one.json", "two.json"], {
      "one.json": one,
      "two.json": two,
    });
    expect(status).toBe(0);
    const table = JSON.parse(written["out.json"]);
    expect(Object.keys(table)).toEqual(["src/x.ts", "src/y.ts"]);
    expect(table["src/y.ts"]).toBeCloseTo(MUTANT_SECONDS + TEST_FILE_SECONDS + TIMEOUT_SECONDS, 1);
    expect(written["out.json"].endsWith("}\n")).toBe(true);
  });

  it("refuses too few arguments with its usage", () => {
    const { status, errors, written } = run(["db", "out.json"], {});
    expect(status).toBe(2);
    expect(errors.join("\n")).toMatch(/usage: node scripts\/mutation-costs\.mjs/);
    expect(written).toEqual({});
  });

  it("refuses a package the sharder does not know", () => {
    const { status, errors } = run(["nope", "out.json", "one.json"], { "one.json": "{}" });
    expect(status).toBe(2);
    expect(errors.join("\n")).toMatch(/unknown package "nope"/);
  });

  it("leaves the table unchanged when the reports hold no file", () => {
    const { status, errors, written } = run(["db", "out.json", "one.json"], {
      "one.json": JSON.stringify(report({}, suites)),
    });
    expect(status).toBe(1);
    expect(errors.join("\n")).toMatch(/no mutated files in the reports; out\.json left unchanged/);
    expect(written).toEqual({});
  });
});
