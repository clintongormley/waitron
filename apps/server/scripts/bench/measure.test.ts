import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { buildYear, COPY_DIR, VOLUME_FILE, WORKING_DIR } from "./build-year.js";
import { CASE_NAMES, measureVenue, sampleRounds, type MeasureResult } from "./measure.js";
import { runtime } from "./runtime.js";

// Builds a two-day venue, then measures it: each case's set-up goes through the real routes.
const CASE_TIMEOUT_MS = 300_000;
const SAMPLES = 2;
const ROUNDS = 2;

describe("sampleRounds", () => {
  it("times only what the case hands its timer, not the set-up around it", async () => {
    let fake = 0;
    const results = await sampleRounds(
      [
        {
          cases: [
            {
              name: "stub",
              sample: async (time) => {
                fake += 1000;
                await time(async () => {
                  fake += 7;
                });
                fake += 500;
                return { outcome: "200", seen: 1 };
              },
            },
          ],
        },
      ],
      { samples: 3, rounds: 2, now: () => fake },
    );
    expect(results).toEqual([
      {
        name: "stub",
        outcomes: { "200": 6 },
        leastSeen: 1,
        rounds: [
          { round: 1, count: 3, medianMs: 7, p95Ms: 7, maxMs: 7 },
          { round: 2, count: 3, medianMs: 7, p95Ms: 7, maxMs: 7 },
        ],
      },
    ]);
  });

  it("refuses a sample that does not call its timer exactly once", async () => {
    await expect(
      sampleRounds(
        [{ cases: [{ name: "untimed", sample: async () => ({ outcome: "200", seen: 1 }) }] }],
        { samples: 1, rounds: 1 },
      ),
    ).rejects.toThrow(/untimed/);
  });
});

describe("measureVenue", () => {
  let dir: string;
  let result: MeasureResult;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "wt-bench-measure-"));
    await buildYear({ out: dir, days: 2, billsPerDay: 2, seed: 1 });
    result = await measureVenue({
      venue: dir,
      out: join(dir, "timings.json"),
      samples: SAMPLES,
      rounds: ROUNDS,
    });
  }, CASE_TIMEOUT_MS);

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("runs every case to its expected answer on every sample, round by round", () => {
    expect(result.cases.map((entry) => entry.name)).toEqual([...CASE_NAMES]);
    const all = SAMPLES * ROUNDS;
    const expected: Record<string, Record<string, number>> = {
      "filing.pass": { "accepted 50": all },
      "floor.open": { "200 200": all },
      "dashboard.open": { "200 200 200": all },
    };
    for (const entry of result.cases) {
      expect(entry.outcomes, entry.name).toEqual(expected[entry.name] ?? { "200": all });
      expect(
        entry.rounds.map((round) => [round.round, round.count]),
        entry.name,
      ).toEqual([
        [1, SAMPLES],
        [2, SAMPLES],
      ]);
      for (const round of entry.rounds) {
        expect(round.medianMs).toBeGreaterThan(0);
        expect(round.p95Ms).toBeGreaterThanOrEqual(round.medianMs);
        expect(round.maxMs).toBeGreaterThanOrEqual(round.p95Ms);
      }
    }
  });

  it("measures each read on the set-up the brief names, not an empty one", () => {
    const seen = Object.fromEntries(result.cases.map((entry) => [entry.name, entry.leastSeen]));
    expect(seen["floor.read"]).toBe(15);
    expect(seen["floor.open"]).toBe(15);
    for (const name of ["kitchen.queue", "kitchen.screen", "kitchen.pass", "kitchen.pass-screen"])
      expect(seen[name], name).toBe(30);
    expect(seen["filing.pass"]).toBe(50);
    expect(seen["dashboard.open"]).toBeGreaterThan(0);
  });

  it("records where and on what it ran, and writes the result to --out", () => {
    const volume = JSON.parse(readFileSync(join(dir, VOLUME_FILE), "utf8")) as {
      totalRows: number;
      profile: unknown;
    };
    expect(result).toMatchObject({
      load: "idle",
      seed: 1,
      samples: SAMPLES,
      rounds: ROUNDS,
      totalRows: volume.totalRows,
      profile: volume.profile,
      node: process.version,
    });
    expect(result.machine.cpu).not.toBe("");
    expect(result.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(JSON.parse(readFileSync(join(dir, "timings.json"), "utf8"))).toEqual(result);
  });

  it("names the Node and SQLite that made it at the top of the result", () => {
    expect(Object.keys(result).slice(0, 3)).toEqual(["node", "sqlite", "sqliteStat4"]);
    expect(result).toMatchObject(runtime());
  });

  it("leaves the built venue as it was", () => {
    const volume = JSON.parse(readFileSync(join(dir, VOLUME_FILE), "utf8")) as {
      rows: Record<string, number>;
    };
    for (const folder of [WORKING_DIR, COPY_DIR]) {
      const db = new DatabaseSync(join(dir, folder, "venue.db"), { readOnly: true });
      try {
        expect(db.prepare("select count(*) as n from sales").get(), folder).toEqual({
          n: volume.rows.sales,
        });
      } finally {
        db.close();
      }
    }
  });
});
