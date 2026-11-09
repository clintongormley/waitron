import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { VOLUME_FILE } from "./build-year.js";
import { CASE_NAMES, type MeasureResult } from "./measure.js";

const run = promisify(execFile);

const BILLS = 2;
const STEP_TIMEOUT_MS = 90_000;
const CASE_TIMEOUT_MS = 2 * STEP_TIMEOUT_MS + 10_000;

const SERVER_DIR = join(import.meta.dirname, "..", "..");

/** Runs the command as `pnpm bench` does, out of reach of this test run's own set-up files. */
async function bench(...args: string[]): Promise<void> {
  await run(process.execPath, ["--import", "tsx", "scripts/bench/cli.ts", ...args], {
    cwd: SERVER_DIR,
    timeout: STEP_TIMEOUT_MS,
    env: Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !name.startsWith("VITEST")),
    ),
  });
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
});
