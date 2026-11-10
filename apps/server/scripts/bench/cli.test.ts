import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { REQUEST_TIMINGS_FILE, VOLUME_FILE } from "./build-year.js";
import { CASE_NAMES, type MeasureResult } from "./measure.js";
import { describeRuntime, runtime } from "./runtime.js";

const run = promisify(execFile);

function compareResult(seed: number) {
  return {
    node: "v26.13.0",
    sqlite: "3.54.0",
    sqliteStat4: false,
    load: "idle",
    machine: { hostname: "bench", cpu: "M-test", cores: 8, memoryBytes: 1, platform: "darwin" },
    commit: "0".repeat(40),
    seed,
    profile: { days: 2 },
    totalRows: 1,
    samples: 1,
    rounds: 1,
    cases: [],
  };
}

const BILLS = 2;
const STEP_TIMEOUT_MS = 90_000;
const CASE_TIMEOUT_MS = 2 * STEP_TIMEOUT_MS + 10_000;

const SERVER_DIR = join(import.meta.dirname, "..", "..");

/** Runs the command as `pnpm bench` does, out of reach of this test run's own set-up files. */
async function bench(...args: string[]): Promise<string> {
  return (await benchExit(...args)).stdout;
}

/** Like `bench`, but answers a failed run's exit status and output instead of throwing. */
async function benchExit(
  ...args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await run(
      process.execPath,
      ["--import", "tsx", "scripts/bench/cli.ts", ...args],
      {
        cwd: SERVER_DIR,
        timeout: STEP_TIMEOUT_MS,
        env: Object.fromEntries(
          Object.entries(process.env).filter(([name]) => !name.startsWith("VITEST")),
        ),
      },
    );
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failed = error as { code?: unknown; stdout?: string; stderr?: string };
    if (typeof failed.code !== "number") throw error;
    return { code: failed.code, stdout: failed.stdout ?? "", stderr: failed.stderr ?? "" };
  }
}

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// Vitest's `tab-person-setup.ts` adds the till's person header to any request lacking it, so only
// a process that does not load it shows what the bench itself sends.
describe("the bench command, in a process of its own", () => {
  it(
    "builds a day and measures it through the routes' own checks",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "wt-bench-cli-"));
      made.push(dir);

      await bench("build", "--out", dir, "--days", "1", "--bills-per-day", String(BILLS));
      const volume = JSON.parse(readFileSync(join(dir, VOLUME_FILE), "utf8")) as {
        rows: Record<string, number>;
      };
      expect(volume.rows.sales).toBe(BILLS);

      const timings = join(dir, "timings.json");
      const printed = await bench(
        "measure",
        "--venue",
        dir,
        "--out",
        timings,
        "--samples",
        "1",
        "--rounds",
        "1",
      );
      const result = JSON.parse(readFileSync(timings, "utf8")) as MeasureResult;
      expect(result.cases.map((entry) => entry.name)).toEqual([...CASE_NAMES]);
      expect(printed.split("\n")[0]).toBe(describeRuntime(runtime()));
    },
    CASE_TIMEOUT_MS,
  );

  it(
    "prints every route straight after each day's unchanged line, largest total first",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "wt-bench-cli-"));
      made.push(dir);

      const printed = await bench("build", "--out", dir, "--days", "2", "--bills-per-day", "2");

      const lines = printed.trimEnd().split("\n");
      const timings = readFileSync(join(dir, REQUEST_TIMINGS_FILE), "utf8")
        .trimEnd()
        .split("\n")
        .map(
          (line) =>
            JSON.parse(line) as { routes: Record<string, { count: number; totalMs: number }> },
        );
      expect(lines).toHaveLength(5);
      expect(lines[4]).toBe(`built 2 days into ${dir}`);
      const route = String.raw`[A-Z]+ /\S+ \d+ x \d+\.\d ms`;
      for (const [index, date] of ["2025-11-03", "2025-11-04"].entries()) {
        expect(lines[index * 2]).toMatch(
          new RegExp(
            String.raw`^day ${index + 1}/2 ${date}: 2 bills in \d+\.\d s, \d+\.\d{3} s a bill$`,
          ),
        );
        const second = lines[index * 2 + 1]!;
        expect(second).toMatch(new RegExp(`^  ${route}(; ${route})*$`));
        const expected = Object.entries(timings[index]!.routes)
          .sort(([, a], [, b]) => b.totalMs - a.totalMs)
          .map(([name, { count }]) => `${name} ${count} x`);
        expect(
          second
            .trim()
            .split("; ")
            .map((part) => part.replace(/ [\d.]+ ms$/, "")),
        ).toEqual(expected);
      }
    },
    CASE_TIMEOUT_MS,
  );

  it(
    "extends a finished build by a day in the same folder",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "wt-bench-cli-"));
      made.push(dir);

      await bench("build", "--out", dir, "--days", "1", "--bills-per-day", "1");
      const extended = await benchExit(
        "build",
        "--out",
        dir,
        "--days",
        "2",
        "--bills-per-day",
        "1",
      );

      expect(extended.code, extended.stderr).toBe(0);
      const volume = JSON.parse(readFileSync(join(dir, VOLUME_FILE), "utf8")) as {
        rows: Record<string, number>;
      };
      expect(volume.rows.sales).toBe(2);
    },
    CASE_TIMEOUT_MS,
  );

  it("refuses a relative --out with exit status 2", async () => {
    const refused = await benchExit("build", "--out", "bench-out", "--days", "1");

    expect(refused.code).toBe(2);
    expect(refused.stderr).toContain("--out must be an absolute path: bench-out");
  });

  it("refuses an --out inside the repository with exit status 2", async () => {
    const inside = join(SERVER_DIR, "bench-out-never-made");
    const refused = await benchExit("build", "--out", inside, "--days", "1");

    expect(refused.code).toBe(2);
    expect(refused.stderr).toContain(`--out must be outside the repository: ${inside}`);
  });

  it("names the Node and SQLite both results were made by above the table", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wt-bench-cli-"));
    made.push(dir);
    writeFileSync(join(dir, "result.json"), JSON.stringify(compareResult(1)));

    const compared = await bench(
      "compare",
      "--before",
      join(dir, "result.json"),
      "--after",
      join(dir, "result.json"),
    );

    expect(compared.split("\n").slice(0, 2)).toEqual([
      "Node v26.13.0, SQLite 3.54.0 without STAT4",
      "case  before (round medians)  after (median)  verdict",
    ]);
  });

  it("prints why two results were not compared, and still answers 0", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wt-bench-cli-"));
    made.push(dir);
    writeFileSync(join(dir, "before.json"), JSON.stringify(compareResult(1)));
    writeFileSync(join(dir, "after.json"), JSON.stringify(compareResult(2)));

    const compared = await benchExit(
      "compare",
      "--before",
      join(dir, "before.json"),
      "--after",
      join(dir, "after.json"),
    );

    expect(compared.code).toBe(0);
    expect(compared.stdout).toMatch(
      /^not compared: bench: the two results differ in seed: 1 against 2\n$/,
    );
  });

  it("imports cleanly when the process was started from no file", async () => {
    const { stdout } = await run(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        'const cli = await import("./scripts/bench/cli.ts"); console.log(typeof cli.runCli);',
        "-",
      ],
      {
        cwd: SERVER_DIR,
        timeout: STEP_TIMEOUT_MS,
        env: Object.fromEntries(
          Object.entries(process.env).filter(([name]) => !name.startsWith("VITEST")),
        ),
      },
    );
    expect(stdout).toBe("function\n");
  });
});
