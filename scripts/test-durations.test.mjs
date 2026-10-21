import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fileSecondsFromLog, main, medianTable } from "./test-durations.mjs";

const prefix = "test-server (1)\tUNKNOWN STEP\t2026-10-20T12:52:41.3301631Z ";

const firstLog = [
  `${prefix}[file-progress] start src/a.test.ts`,
  `${prefix}[file-progress] still running: src/a.test.ts 60.0s`,
  `${prefix}[file-progress] end src/a.test.ts passed 14.1s`,
  `${prefix}[file-progress] end src/b.test.ts [unit] failed 3.2s`,
  `${prefix}[file-progress] end src/c.test.ts passed`,
  `${prefix}some other output`,
  `${prefix}[file-progress] end src/a.test.ts passed 15.3s`,
].join("\n");

const secondLog = [
  `${prefix}[file-progress] end src/a.test.ts passed 10.0s`,
  `${prefix}[file-progress] end src/d.test.ts skipped 0.4s`,
].join("\n");

describe("fileSecondsFromLog", () => {
  it("reads each end line's seconds, the later line for a path winning", () => {
    expect(fileSecondsFromLog(firstLog)).toEqual(
      new Map([
        ["src/a.test.ts", 15.3],
        ["src/b.test.ts", 3.2],
      ]),
    );
  });

  it("reads a second log on its own", () => {
    expect(fileSecondsFromLog(secondLog)).toEqual(
      new Map([
        ["src/a.test.ts", 10],
        ["src/d.test.ts", 0.4],
      ]),
    );
  });

  it("finds nothing in a log with no end lines", () => {
    expect(fileSecondsFromLog(`${prefix}[file-progress] start src/a.test.ts\n`)).toEqual(new Map());
  });
});

describe("medianTable", () => {
  it("takes each path's median over the logs that hold it", () => {
    const table = medianTable([
      new Map([["a", 1]]),
      new Map([["a", 3]]),
      new Map([
        ["a", 2],
        ["b", 4],
      ]),
    ]);
    expect(table).toEqual({ a: 2, b: 4 });
  });

  it("takes the mean of the middle two for an even count, rounded to 0.1", () => {
    expect(medianTable([new Map([["a", 196.8]]), new Map([["a", 219.3]])])).toEqual({ a: 208.1 });
    expect(medianTable([new Map([["a", 1.04]]), new Map([["a", 1.1]])])).toEqual({ a: 1.1 });
  });

  it("sorts the keys", () => {
    const table = medianTable([
      new Map([
        ["src/z.test.ts", 1],
        ["src/a.test.ts", 2],
      ]),
    ]);
    expect(Object.keys(table)).toEqual(["src/a.test.ts", "src/z.test.ts"]);
  });

  it("keeps a file measured at 0.0s at 0.1, so every value is above zero", () => {
    expect(medianTable([new Map([["a", 0]])])).toEqual({ a: 0.1 });
  });
});

describe("main", () => {
  function io(files) {
    const written = [];
    const errors = [];
    return {
      written,
      errors,
      deps: {
        readFile: (file) => files[file],
        writeFile: (file, text) => written.push([file, text]),
        stderr: (line) => errors.push(line),
      },
    };
  }

  it("writes the median table of the logs it is given", () => {
    const { written, errors, deps } = io({ "one.log": firstLog, "two.log": secondLog });
    expect(main(["out.json", "one.log", "two.log"], deps)).toBe(0);
    expect(written).toEqual([
      [
        "out.json",
        '{\n  "src/a.test.ts": 12.7,\n  "src/b.test.ts": 3.2,\n  "src/d.test.ts": 0.4\n}\n',
      ],
    ]);
    expect(errors).toEqual([]);
  });

  it.each([[[]], [["out.json"]]])("refuses %j with a usage line", (argv) => {
    const { written, errors, deps } = io({});
    expect(main(argv, deps)).toBe(2);
    expect(written).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^usage: /);
  });

  it("writes nothing and fails when no log holds a measurement", () => {
    const { written, errors, deps } = io({
      "empty.log": `${prefix}[file-progress] start src/a.test.ts\n`,
      "blank.log": "",
    });
    expect(main(["out.json", "empty.log", "blank.log"], deps)).toBe(1);
    expect(written).toEqual([]);
    expect(errors).toEqual(["no file measurements found in the logs; out.json left unchanged"]);
  });
});

describe("the command line", () => {
  const script = join(import.meta.dirname, "test-durations.mjs");
  let dir;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  function run(log) {
    dir = mkdtempSync(join(tmpdir(), "test-durations-"));
    const out = join(dir, "out.json");
    writeFileSync(join(dir, "one.log"), log);
    const result = spawnSync(process.execPath, [script, out, join(dir, "one.log")], {
      encoding: "utf8",
    });
    return { result, out };
  }

  it("writes the table to the named file and exits 0", () => {
    const { result, out } = run(secondLog);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(readFileSync(out, "utf8")).toBe(
      '{\n  "src/a.test.ts": 10,\n  "src/d.test.ts": 0.4\n}\n',
    );
  });

  it("exits 1 and writes no file when the log holds no measurement", () => {
    const { result, out } = run(`${prefix}some other output\n`);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^no file measurements found in the logs/);
    expect(existsSync(out)).toBe(false);
  });
});
