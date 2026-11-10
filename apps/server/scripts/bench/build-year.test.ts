import { appendFileSync, existsSync, mkdtempSync, readFileSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  buildYear,
  COPY_DIR,
  REQUEST_TIMINGS_FILE,
  SESSION_FILE,
  VOLUME_FILE,
  WORKING_DIR,
} from "./build-year.js";
import type { RouteTiming } from "./trading-day.js";

// Each run migrates and seeds a venue (about 1.3 s locally) and trades a few bills a day.
const CASE_TIMEOUT_MS = 180_000;
const BILLS = 3;

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function salesIn(dir: string): number {
  const db = new DatabaseSync(join(dir, "venue.db"), { readOnly: true });
  try {
    return (db.prepare("select count(*) as n from sales").get() as { n: number }).n;
  } finally {
    db.close();
  }
}

interface TimingLine {
  day: number;
  date: string;
  bills: number;
  dayMs: number;
  checkpointMs: number;
  routes: Record<string, RouteTiming>;
}

function timingLines(out: string): TimingLine[] {
  return readFileSync(join(out, REQUEST_TIMINGS_FILE), "utf8")
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line) as TimingLine);
}

describe("buildYear", () => {
  it(
    "resumes a build stopped mid-day from the last finished day's copy",
    async () => {
      const out = mkdtempSync(join(tmpdir(), "wt-bench-build-"));
      made.push(out);
      const options = { out, days: 3, billsPerDay: BILLS, seed: 1 };

      await expect(
        buildYear({
          ...options,
          beforeBill: (day, index) => {
            if (day === 2 && index === BILLS - 1) throw new Error("stopped mid-day");
          },
        }),
      ).rejects.toThrow("stopped mid-day");
      // The stop left part of day 2 in the working folder, which the resume must not build on.
      expect(salesIn(join(out, WORKING_DIR))).toBeGreaterThan(BILLS);
      const stopped = JSON.parse(readFileSync(join(out, SESSION_FILE), "utf8")) as { day: number };
      expect(stopped.day).toBe(1);

      await buildYear(options);

      const session = JSON.parse(readFileSync(join(out, SESSION_FILE), "utf8")) as {
        day: number;
        date: string;
      };
      expect(session).toMatchObject({ day: 3, date: "2025-11-05" });
      const volume = JSON.parse(readFileSync(join(out, VOLUME_FILE), "utf8")) as {
        rows: Record<string, number>;
        totalRows: number;
        seed: number;
        databaseBytes: number;
      };
      expect(volume.rows.sales).toBe(3 * BILLS);
      expect(volume.rows.daily_closes).toBe(3);
      expect(volume.seed).toBe(1);
      expect(volume.totalRows).toBe(Object.values(volume.rows).reduce((a, b) => a + b, 0));
      expect(volume.databaseBytes).toBeGreaterThan(0);
      expect(salesIn(join(out, WORKING_DIR))).toBe(3 * BILLS);
    },
    CASE_TIMEOUT_MS,
  );

  it(
    "resumes from the copy set aside when a stop came while the copies were being swapped",
    async () => {
      const out = mkdtempSync(join(tmpdir(), "wt-bench-build-"));
      made.push(out);
      await buildYear({ out, days: 1, billsPerDay: 1, seed: 1 });
      renameSync(join(out, COPY_DIR), join(out, `${COPY_DIR}.old`));

      await buildYear({ out, days: 2, billsPerDay: 1, seed: 1 });

      const volume = JSON.parse(readFileSync(join(out, VOLUME_FILE), "utf8")) as {
        rows: Record<string, number>;
      };
      expect(volume.rows.sales).toBe(2);
    },
    CASE_TIMEOUT_MS,
  );

  it(
    "resumes after two stops in a row between the copies' swap and the session",
    async () => {
      const out = mkdtempSync(join(tmpdir(), "wt-bench-build-"));
      made.push(out);
      const options = { out, days: 2, billsPerDay: 1, seed: 1 };
      const stopBeforeDay2Session = {
        ...options,
        beforeSession: (day: number) => {
          if (day === 2) throw new Error("stopped before the session");
        },
      };

      await expect(buildYear(stopBeforeDay2Session)).rejects.toThrow("stopped before the session");
      await expect(buildYear(stopBeforeDay2Session)).rejects.toThrow("stopped before the session");
      const session = JSON.parse(readFileSync(join(out, SESSION_FILE), "utf8")) as { day: number };
      expect(session.day).toBe(1);

      await buildYear(options);

      const volume = JSON.parse(readFileSync(join(out, VOLUME_FILE), "utf8")) as {
        rows: Record<string, number>;
      };
      expect(volume.rows.sales).toBe(2);
      expect(volume.rows.daily_closes).toBe(2);
    },
    CASE_TIMEOUT_MS,
  );

  it(
    "writes each finished day's request timings once and in order, across a stop and a resume",
    async () => {
      const out = mkdtempSync(join(tmpdir(), "wt-bench-build-"));
      made.push(out);
      const bills = 12;
      const options = { out, days: 3, billsPerDay: bills, seed: 1 };
      const reported = new Map<number, { requests: number; ms: number }>();
      const onDay = (day: number, result: { requests: number }, ms: number) =>
        reported.set(day, { requests: result.requests, ms });

      await expect(
        buildYear({
          ...options,
          onDay,
          beforeBill: (day, index) => {
            if (day === 2 && index === 5) throw new Error("stopped mid-day");
          },
        }),
      ).rejects.toThrow("stopped mid-day");
      expect(timingLines(out).map((line) => line.day)).toEqual([1]);

      await buildYear({ ...options, onDay });

      const lines = timingLines(out);
      expect(lines.map((line) => line.day)).toEqual([1, 2, 3]);
      expect(lines.map((line) => line.date)).toEqual(["2025-11-03", "2025-11-04", "2025-11-05"]);
      for (const line of lines) {
        const routes = Object.entries(line.routes);
        const sent = reported.get(line.day)!;
        expect(line.bills).toBe(bills);
        expect(line.dayMs).toBe(sent.ms);
        expect(line.checkpointMs).toBeGreaterThan(0);
        expect(routes.reduce((sum, [, route]) => sum + route.count, 0)).toBe(sent.requests);
        for (const [name, route] of routes) {
          // The ids a real run sends are UUIDs; anything left of one fails the shape below too.
          expect(name).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
          expect(name).toMatch(/^(GET|POST|PUT|DELETE)( |\/(:id|[a-z-]+))+$/);
          expect(route.count).toBeGreaterThan(0);
          expect(route.totalMs).toBeGreaterThan(0);
          expect(route.medianMs).toBeGreaterThan(0);
          expect(route.p95Ms).toBeGreaterThanOrEqual(route.medianMs);
        }
        expect(line.dayMs).toBeGreaterThanOrEqual(
          line.checkpointMs + routes.reduce((sum, [, route]) => sum + route.totalMs, 0),
        );
      }
      const names = new Set(lines.flatMap((line) => Object.keys(line.routes)));
      for (const known of [
        "POST /api/tables/:id/seat",
        "POST /print-api/agent/jobs/:id/result",
        "GET /api/working-orders/:id/payments",
        "PUT /api/parties/:id/drafts",
        "POST /api/parties/:id/groups/:id/fire",
      ])
        expect(names).toContain(known);
    },
    CASE_TIMEOUT_MS,
  );

  it(
    "drops a timing line for a day the session does not count, so the resumed day appears once",
    async () => {
      const out = mkdtempSync(join(tmpdir(), "wt-bench-build-"));
      made.push(out);
      await buildYear({ out, days: 1, billsPerDay: 1, seed: 1 });
      const path = join(out, REQUEST_TIMINGS_FILE);
      // What a stop leaves between a day's line and the session that counts the day.
      appendFileSync(path, `${JSON.stringify({ day: 2, dayMs: -1 })}\n{"da`);

      await buildYear({ out, days: 2, billsPerDay: 1, seed: 1 });

      const lines = timingLines(out);
      expect(lines.map((line) => line.day)).toEqual([1, 2]);
      expect(lines[1]!.dayMs).toBeGreaterThan(0);
    },
    CASE_TIMEOUT_MS,
  );

  describe("a folder built before", () => {
    let out = "";
    const sessionPath = () => join(out, SESSION_FILE);
    const volume = () =>
      JSON.parse(readFileSync(join(out, VOLUME_FILE), "utf8")) as {
        rows: Record<string, number>;
        profile: { days: number; billsPerDay: number };
      };

    beforeAll(async () => {
      out = mkdtempSync(join(tmpdir(), "wt-bench-build-"));
      await buildYear({ out, days: 2, billsPerDay: 2, seed: 1 });
    }, CASE_TIMEOUT_MS);
    afterAll(() => {
      if (out !== "") rmSync(out, { recursive: true, force: true });
    });

    it("records the bills a day in the session", () => {
      expect(JSON.parse(readFileSync(sessionPath(), "utf8"))).toMatchObject({
        day: 2,
        billsPerDay: 2,
      });
    });

    it("refuses a different number of bills a day, leaving volume.json as it was", async () => {
      const before = readFileSync(join(out, VOLUME_FILE), "utf8");

      await expect(buildYear({ out, days: 2, billsPerDay: 1, seed: 1 })).rejects.toThrow(
        `bench: ${out} was built with 2 bills a day, not 1`,
      );
      await expect(buildYear({ out, days: 3, billsPerDay: 1, seed: 1 })).rejects.toThrow(
        `bench: ${out} was built with 2 bills a day, not 1`,
      );
      expect(readFileSync(join(out, VOLUME_FILE), "utf8")).toBe(before);
    });

    it("refuses fewer days than it has finished, leaving volume.json as it was", async () => {
      const before = readFileSync(join(out, VOLUME_FILE), "utf8");

      await expect(buildYear({ out, days: 1, billsPerDay: 2, seed: 1 })).rejects.toThrow(
        `bench: ${out} has finished 2 days, more than --days 1`,
      );
      expect(readFileSync(join(out, VOLUME_FILE), "utf8")).toBe(before);
    });

    it(
      "removes volume.json before an extension trades, and writes it again once it finishes",
      async () => {
        await expect(
          buildYear({
            out,
            days: 4,
            billsPerDay: 2,
            seed: 1,
            beforeBill: (day) => {
              if (day === 4) throw new Error("stopped mid-day");
            },
          }),
        ).rejects.toThrow("stopped mid-day");
        expect(existsSync(join(out, VOLUME_FILE))).toBe(false);

        await buildYear({ out, days: 4, billsPerDay: 2, seed: 1 });

        expect(volume().profile).toMatchObject({ days: 4, billsPerDay: 2 });
        expect(volume().rows.sales).toBe(8);
      },
      CASE_TIMEOUT_MS,
    );
  });
});
