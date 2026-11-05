import { mkdtempSync, readFileSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { buildYear, COPY_DIR, SESSION_FILE, VOLUME_FILE, WORKING_DIR } from "./build-year.js";

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
});
