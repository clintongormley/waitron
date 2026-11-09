import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { REQUEST_TIMINGS_FILE, VOLUME_FILE } from "./build-year.js";
import { CASE_NAMES, type MeasureResult } from "./measure.js";

const run = promisify(execFile);

const BILLS = 2;
const STEP_TIMEOUT_MS = 90_000;
const CASE_TIMEOUT_MS = 2 * STEP_TIMEOUT_MS + 10_000;

const SERVER_DIR = join(import.meta.dirname, "..", "..");

/** Runs the command as `pnpm bench` does, out of reach of this test run's own set-up files. */
async function bench(...args: string[]): Promise<string> {
  const { stdout } = await run(
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
  return stdout;
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
      await bench("measure", "--venue", dir, "--out", timings, "--samples", "1", "--rounds", "1");
      const result = JSON.parse(readFileSync(timings, "utf8")) as MeasureResult;
      expect(result.cases.map((entry) => entry.name)).toEqual([...CASE_NAMES]);
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
});
