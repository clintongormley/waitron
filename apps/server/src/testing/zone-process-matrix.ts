import { spawn } from "node:child_process";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";

function stopGroup(pid: number | undefined) {
  if (pid === undefined) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

export async function run(args: string[], options: { timeout: number; env?: NodeJS.ProcessEnv }) {
  const processChild = spawn(process.execPath, args, { env: options.env, detached: true });
  let stdout = "";
  let stderr = "";
  const closed = new Promise<void>((resolve) => processChild.once("close", () => resolve()));
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const completed = new Promise<{ stdout: string }>((resolve, reject) => {
    processChild.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    processChild.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    processChild.once("error", reject);
    processChild.once("close", (code) => {
      if (code === 0) resolve({ stdout });
      else reject(new Error(`Child exit ${code}\n${stdout}\n${stderr}`));
    });
    deadline = setTimeout(
      () => reject(new Error(`Child timed out\n${stdout}\n${stderr}`)),
      options.timeout,
    );
  });
  try {
    return await completed;
  } finally {
    clearTimeout(deadline);
    stopGroup(processChild.pid);
    await closed;
  }
}
const familyCases = [
  ["whole-order", 39, "till-sale-integrated.test.ts"],
  ["bill-payment", 35, "zone-bill-payment-boundaries.test.ts"],
  ["auto-issue", 7, "zone-economic-boundaries.test.ts"],
  ["core-only", 11, "zone-core-capabilities.test.ts"],
  ["readiness", 1, "fiscal-readiness-runner.verifactu.test.ts"],
  ["scripts", 11, "zone-script-callers.test.ts"],
  ["core-only-emergency", 10, "void-issue-clock.test.ts"],
] as const;

type Family = (typeof familyCases)[number][0];

export function defineZoneProcessMatrix(families: readonly Family[], includeCalendar = false) {
  const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
  let directory: string | undefined;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "zone-process-matrix-"));
    await symlink(resolve("node_modules"), join(directory, "node_modules"));
    await run(
      [
        "--input-type=module",
        "--eval",
        `
    import { bundle } from "../../scripts/bundle-node.mjs";
    bundle([{ entry: "src/testing/zone-process-child.ts", outfile: ${JSON.stringify(join(directory, "child.mjs"))} }]);
  `,
      ],
      { timeout: 30_000 },
    );
  });
  afterAll(async () => {
    if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  });

  const expected = [
    ["madrid-midnight", "2026-10-14T22:30:00.000Z", "2026-10-15", 120, "2026-10-15T00:30:00+02:00"],
    ["madrid-night", "2026-10-14T23:30:00.000Z", "2026-10-15", 120, "2026-10-15T01:30:00+02:00"],
    ["madrid-noon", "2026-10-14T12:00:00.000Z", "2026-10-14", 120, "2026-10-14T14:00:00+02:00"],
    ["canary-evening", "2026-10-14T22:30:00.000Z", "2026-10-14", 60, "2026-10-14T23:30:00+01:00"],
    ["canary-midnight", "2026-10-14T23:30:00.000Z", "2026-10-15", 60, "2026-10-15T00:30:00+01:00"],
    ["canary-winter", "2026-01-15T23:30:00.000Z", "2026-01-15", 0, "2026-01-15T23:30:00+00:00"],
    ["spring-before", "2026-03-29T00:59:59.000Z", "2026-03-29", 60, "2026-03-29T01:59:59+01:00"],
    ["spring-after", "2026-03-29T01:00:00.000Z", "2026-03-29", 120, "2026-03-29T03:00:00+02:00"],
    ["autumn-first", "2026-10-25T00:30:00.000Z", "2026-10-25", 120, "2026-10-25T02:30:00+02:00"],
    ["autumn-second", "2026-10-25T01:30:00.000Z", "2026-10-25", 60, "2026-10-25T02:30:00+01:00"],
  ] as const;

  async function child(timeZone: string, mode: "calendar" | "families", family = "") {
    const database = suite.db
      .all<{ name: string; file: string }>(sql`pragma database_list`)
      .find((row) => row.name === "main")!;
    const result = await run(
      [join(directory!, "child.mjs"), mode, dirname(database.file), family],
      {
        timeout: 90_000,
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(
              ([key]) =>
                !key.startsWith("GIT_") && !key.startsWith("VITEST") && !key.startsWith("WAITRON_"),
            ),
          ),
          TZ: timeZone,
          WAITRON_ENV: "preproduction",
        },
      },
    );
    return JSON.parse(result.stdout) as {
      processZone: string;
      casesRun: number;
      results: {
        key: string;
        instant: string;
        day: string;
        offset: number;
        generation: string;
        hashVerified: boolean;
        historyPreserved: boolean;
      }[];
    };
  }

  describe.each(["UTC", "Europe/Madrid"])("invoice calendars in a fresh %s process", (timeZone) => {
    if (includeCalendar) {
      it("retains exact issue dates, DST literals and hashes through the real cash boundary", async () => {
        const output = await child(timeZone, "calendar");
        expect(output.processZone).toBe(timeZone);
        expect(output.casesRun).toBe(expected.length);
        expect(output.results.map((row) => row.key).sort()).toEqual(
          expected.map(([key]) => key).sort(),
        );
        for (const [key, instant, day, offset, generation] of expected) {
          expect(
            output.results.find((row) => row.key === key),
            key,
          ).toEqual({
            key,
            instant,
            day,
            offset,
            generation,
            hashVerified: true,
            historyPreserved: true,
          });
        }
      });
    }

    it.each(familyCases.filter(([family]) => families.includes(family)))(
      "runs %s with its original behavioral assertions",
      async (family, count, source) => {
        const output = (await child(timeZone, "families", family)) as unknown as {
          processZone: string;
          casesRun: number;
          success: boolean;
          results: { key: string; source: string; tests: { fullName: string; status: string }[] }[];
        };
        expect(output.processZone).toBe(timeZone);
        expect(output.success).toBe(true);
        expect(output.casesRun).toBe(count);
        expect(output.results.map((row) => row.key)).toEqual([family]);
        expect(output.results[0]!.source).toBe(source);
        const tests = output.results[0]!.tests;
        expect(tests).toHaveLength(count);
        expect(new Set(tests.map((test) => test.fullName)).size).toBe(count);
        expect(tests.every((test) => test.status === "passed")).toBe(true);
      },
    );
  });
}
