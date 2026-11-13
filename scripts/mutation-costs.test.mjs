import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  costTable,
  DURATION_FACTOR,
  fileSecondsFromReport,
  main,
  MUTANT_SECONDS,
  TIMEOUT_SECONDS,
} from "./mutation-costs.mjs";

/** A Stryker JSON report: `files` maps a path to its mutants, each `[status, duration in ms]`. */
function report(files) {
  return {
    files: Object.fromEntries(
      Object.entries(files).map(([path, mutants]) => [
        path,
        { mutants: mutants.map(([status, duration]) => ({ status, duration })) },
      ]),
    ),
  };
}

const charge = (ms) => (DURATION_FACTOR * ms) / 1000 + MUTANT_SECONDS;

describe("fileSecondsFromReport", () => {
  it("charges each tested mutant by its own measured duration", () => {
    const seconds = fileSecondsFromReport(
      report({
        "src/x.ts": [
          ["Killed", 120],
          ["Killed", 9000],
        ],
      }),
    );
    expect(seconds.get("src/x.ts")).toBeCloseTo(charge(120) + charge(9000));
    expect(seconds.get("src/x.ts")).toBeCloseTo(0.3585 * 9.12 + 2 * 0.1222);
  });

  it("adds the timeout charge for a mutant that timed out", () => {
    const seconds = fileSecondsFromReport(report({ "src/x.ts": [["Timeout", 2000]] }));
    expect(seconds.get("src/x.ts")).toBeCloseTo(charge(2000) + TIMEOUT_SECONDS);
    expect(TIMEOUT_SECONDS).toBe(82.2);
  });

  it("charges a survivor as a tested mutant", () => {
    const seconds = fileSecondsFromReport(report({ "src/x.ts": [["Survived", 5000]] }));
    expect(seconds.get("src/x.ts")).toBeCloseTo(charge(5000));
  });

  it("charges nothing for a mutant no test ran", () => {
    const seconds = fileSecondsFromReport(
      report({
        "src/x.ts": [
          ["NoCoverage", 3000],
          ["Ignored", 3000],
          ["CompileError", 3000],
          ["RuntimeError", 3000],
        ],
      }),
    );
    expect(seconds.get("src/x.ts")).toBe(0);
  });

  it("charges a tested mutant with no recorded duration the per-mutant charge alone", () => {
    const seconds = fileSecondsFromReport({
      files: { "src/x.ts": { mutants: [{ status: "Killed" }] } },
    });
    expect(seconds.get("src/x.ts")).toBeCloseTo(MUTANT_SECONDS);
  });

  it("charges a tested mutant whose duration is null the per-mutant charge alone", () => {
    const seconds = fileSecondsFromReport(report({ "src/x.ts": [["Killed", null]] }));
    expect(seconds.get("src/x.ts")).toBeCloseTo(MUTANT_SECONDS);
  });

  it.each([
    ["a non-numeric string", "oops", /'oops'/],
    ["a numeric string", "1200", /'1200'/],
    ["a negative number", -5000, /-5000/],
    ["NaN", Number.NaN, /NaN/],
    ["Infinity", Number.POSITIVE_INFINITY, /Infinity/],
  ])(
    "refuses a tested mutant whose duration is %s, naming the file and the value",
    (_, duration, value) => {
      expect(() => fileSecondsFromReport(report({ "src/x.ts": [["Killed", duration]] }))).toThrow(
        value,
      );
      expect(() => fileSecondsFromReport(report({ "src/x.ts": [["Killed", duration]] }))).toThrow(
        /src\/x\.ts/,
      );
    },
  );

  it("does not check the duration of a mutant no test ran", () => {
    const seconds = fileSecondsFromReport(
      report({
        "src/x.ts": [
          ["NoCoverage", "oops"],
          ["Ignored", -1],
          ["CompileError", "1200"],
          ["RuntimeError", Number.NaN],
        ],
      }),
    );
    expect(seconds.get("src/x.ts")).toBe(0);
  });

  it("charges nothing for a file the shard was asked to mutate that produced no mutant", () => {
    const seconds = fileSecondsFromReport({
      ...report({ "src/x.ts": [["Killed", 1000]] }),
      config: { mutate: ["src/x.ts", "src/types-only.ts", "src/split.ts:1-40"] },
    });
    expect(seconds.get("src/types-only.ts")).toBe(0);
    expect(seconds.get("src/split.ts")).toBe(0);
    expect(seconds.get("src/x.ts")).toBeCloseTo(charge(1000));
  });
});

describe("costTable", () => {
  it("takes the median of a file's seconds across reports, to a tenth", () => {
    const table = costTable(
      [new Map([["src/x.ts", 10.04]]), new Map([["src/x.ts", 30]]), new Map([["src/x.ts", 20.06]])],
      [],
      ["src/x.ts"],
    );
    expect(table).toEqual({ "src/x.ts": 20.1 });
  });

  it("averages the middle two of an even count", () => {
    expect(
      costTable([new Map([["src/x.ts", 10]]), new Map([["src/x.ts", 20]])], [], ["src/x.ts"]),
    ).toEqual({ "src/x.ts": 15 });
  });

  it("keeps every file above zero, so a file no test reaches still has a weight", () => {
    expect(costTable([new Map([["src/x.ts", 0]])], [], ["src/x.ts"])).toEqual({
      "src/x.ts": 0.1,
    });
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
        ["src/heavy.ts", "src/x.ts"],
      ),
    ).toEqual({ "src/x.ts": 1 });
  });

  it("leaves out a file the package's mutate selection no longer holds", () => {
    expect(
      costTable(
        [
          new Map([
            ["src/renamed-away.ts", 5],
            ["src/x.ts", 1],
          ]),
        ],
        [],
        ["src/x.ts"],
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
      ["src/a.ts", "src/b.ts"],
    );
    expect(Object.keys(table)).toEqual(["src/a.ts", "src/b.ts"]);
  });
});

describe("main", () => {
  const run = (argv, files, selected = ["src/x.ts", "src/y.ts"]) => {
    const written = {};
    const errors = [];
    const status = main(argv, {
      selection: (pkg) => (["db", "ui"].includes(pkg) ? selected : []),
      readFile: (path) => files[path],
      writeFile: (path, text) => (written[path] = text),
      stderr: (line) => errors.push(line),
    });
    return { status, written, errors };
  };

  it("refuses an old partial report for a file now selected whole without writing the table", () => {
    const old = {
      ...report({ "src/schema/sales.ts": [["Killed", 100]] }),
      config: { mutate: ["src/schema/sales.ts:1-200"] },
    };
    const result = run(["db", "out.json", "old.json"], { "old.json": JSON.stringify(old) }, [
      "src/schema/sales.ts",
    ]);
    expect(result.status).toBe(1);
    expect(result.errors.join("\n")).toMatch(
      /src\/schema\/sales.ts.*use reports from runs after this change/,
    );
    expect(result.written).toEqual({});
  });

  it("keeps currently split UI reports usable alongside whole-file reports", () => {
    const current = {
      ...report({
        "src/components/wt-combobox.ts": [["Killed", 100]],
        "src/x.ts": [["Killed", 100]],
      }),
      config: { mutate: ["src/components/wt-combobox.ts:1-200", "src/x.ts"] },
    };
    const result = run(
      ["ui", "out.json", "current.json"],
      { "current.json": JSON.stringify(current) },
      ["src/components/wt-combobox.ts", "src/x.ts"],
    );
    expect(result.status).toBe(0);
    expect(Object.keys(JSON.parse(result.written["out.json"]))).toEqual(["src/x.ts"]);
  });

  it("writes the package's table from every report it is given", () => {
    const one = JSON.stringify(report({ "src/x.ts": [["Killed", 100]] }));
    const two = JSON.stringify(
      report({ "src/schema/sales.ts": [["Killed", 100]], "src/y.ts": [["Timeout", 4000]] }),
    );
    const { status, written } = run(["db", "out.json", "one.json", "two.json"], {
      "one.json": one,
      "two.json": two,
    });
    expect(status).toBe(0);
    const table = JSON.parse(written["out.json"]);
    expect(Object.keys(table)).toEqual(["src/x.ts", "src/y.ts"]);
    expect(table["src/y.ts"]).toBeCloseTo(charge(4000) + TIMEOUT_SECONDS, 1);
    expect(written["out.json"].endsWith("}\n")).toBe(true);
  });

  it("writes only the files the package's mutate selection holds", () => {
    const one = JSON.stringify({
      ...report({ "src/x.ts": [["Killed", 100]], "src/gone.ts": [["Killed", 100]] }),
      config: { mutate: ["src/x.ts", "src/gone.ts:1-200"] },
    });
    const { status, written } = run(["db", "out.json", "one.json"], { "one.json": one });
    expect(status).toBe(0);
    expect(Object.keys(JSON.parse(written["out.json"]))).toEqual(["src/x.ts"]);
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

  it("refuses a report with a malformed duration, naming it, and writes nothing", () => {
    const good = JSON.stringify(report({ "src/x.ts": [["Killed", 100]] }));
    const bad = JSON.stringify(report({ "src/y.ts": [["Killed", "oops"]] }));
    const { status, errors, written } = run(["db", "out.json", "good.json", "bad.json"], {
      "good.json": good,
      "bad.json": bad,
    });
    expect(status).toBe(1);
    expect(errors.join("\n")).toMatch(
      /^malformed report bad\.json: src\/y\.ts: .*'oops'.*; out\.json left unchanged$/,
    );
    expect(written).toEqual({});
  });

  it("leaves the table unchanged when the reports hold no file", () => {
    const { status, errors, written } = run(["db", "out.json", "one.json"], {
      "one.json": JSON.stringify(report({})),
    });
    expect(status).toBe(1);
    expect(errors.join("\n")).toMatch(/no mutated files in the reports; out\.json left unchanged/);
    expect(written).toEqual({});
  });
});

describe("the command line", () => {
  const script = join(import.meta.dirname, "mutation-costs.mjs");
  let dir;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  function run(...argv) {
    dir = mkdtempSync(join(tmpdir(), "mutation-costs-"));
    const out = join(dir, "out.json");
    const reports = argv.map((files, i) => {
      const path = join(dir, `${i}.json`);
      writeFileSync(path, JSON.stringify(report(files)));
      return path;
    });
    const result = spawnSync(process.execPath, [script, "db", out, ...reports], {
      encoding: "utf8",
    });
    return { result, out };
  }

  it("writes db's table to the named file, keeping only files db mutates, and exits 0", () => {
    const { result, out } = run({
      "src/errors.ts": [
        ["Killed", 10000],
        ["Killed", 0],
      ],
      "src/no-longer-mutated.ts": [["Killed", 100]],
    });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(readFileSync(out, "utf8")).toBe('{\n  "src/errors.ts": 3.8\n}\n');
  });

  it("exits 1 and writes no file when the reports name no file db mutates", () => {
    const { result, out } = run({ "src/no-longer-mutated.ts": [["Killed", 100]] });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^no mutated files in the reports/);
    expect(existsSync(out)).toBe(false);
  });

  it("exits 1 and writes no file when a report holds a malformed duration", () => {
    const { result, out } = run({ "src/errors.ts": [["Killed", "1200"]] });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^malformed report .*0\.json: src\/errors\.ts: .*'1200'/);
    expect(result.stderr).toMatch(/left unchanged\n$/);
    expect(existsSync(out)).toBe(false);
  });

  it("exits 2 with its usage when given too few arguments", () => {
    const result = spawnSync(process.execPath, [script, "db"], { encoding: "utf8" });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/^usage: node scripts\/mutation-costs\.mjs/);
  });
});
