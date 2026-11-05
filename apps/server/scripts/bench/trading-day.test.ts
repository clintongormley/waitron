import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { installBenchClock, type BenchClock } from "./bench-clock.js";
import { openBenchVenue, type BenchVenue } from "./bench-venue.js";
import { PAYMENT_ROUTES } from "./profile.js";
import { countRows, tradeDay } from "./trading-day.js";

// Each case migrates and seeds a venue (1.3 s locally) and trades a few bills (about 0.12 s each);
// the limit leaves a slower CI runner many times that.
const CASE_TIMEOUT_MS = 180_000;

const opened: { venue: BenchVenue; dir: string }[] = [];
let clock: BenchClock | undefined;

afterEach(async () => {
  for (const { venue, dir } of opened.splice(0)) {
    await venue.close();
    rmSync(dir, { recursive: true, force: true });
  }
  clock?.uninstall();
  clock = undefined;
});

async function freshVenue(start: string, seed = 1): Promise<BenchVenue> {
  clock ??= installBenchClock(new Date(start));
  const dir = mkdtempSync(join(tmpdir(), "wt-bench-"));
  const venue = await openBenchVenue(dir, { seed });
  opened.push({ venue, dir });
  return venue;
}

function rows(venue: BenchVenue, query: ReturnType<typeof sql>) {
  return venue.db.all<Record<string, unknown>>(query);
}

describe("tradeDay", () => {
  it(
    "trades ten bills through the routes and files every one",
    async () => {
      const venue = await freshVenue("2025-11-03T08:00:00Z");

      const result = await tradeDay(venue, "2025-11-03", 10);

      const counts = countRows(venue);
      expect(counts.sales).toBe(10);
      expect(counts.working_orders).toBe(10);
      expect(counts.sale_lines).toBeGreaterThanOrEqual(40);
      expect(counts.order_groups).toBeGreaterThanOrEqual(20);
      expect(counts.order_groups).toBeLessThanOrEqual(30);
      expect(counts.attendance_operation_facts).toBeGreaterThan(0);
      expect(counts.daily_closes).toBe(1);
      for (const route of PAYMENT_ROUTES) expect(result.routes[route], route).toBeGreaterThan(0);
      const estados = rows(venue, sql`select estado, count(*) as n from envios group by estado`);
      expect(estados).toEqual([{ estado: "aceptado", n: 10 }]);
      expect(rows(venue, sql`pragma foreign_key_check`)).toEqual([]);
    },
    CASE_TIMEOUT_MS,
  );

  it(
    "gives equal row counts for one seed",
    async () => {
      const first = await freshVenue("2025-11-03T08:00:00Z", 7);
      await tradeDay(first, "2025-11-03", 10);
      const firstCounts = countRows(first);
      clock!.uninstall();
      clock = undefined;
      const second = await freshVenue("2025-11-03T08:00:00Z", 7);
      await tradeDay(second, "2025-11-03", 10);

      expect(countRows(second)).toEqual(firstCounts);
    },
    CASE_TIMEOUT_MS,
  );

  it(
    "completes bills that span both of Madrid's clock changes",
    async () => {
      const venue = await freshVenue("2026-03-28T08:00:00Z");
      const changes = [
        { day: "2026-03-28", change: "2026-03-29T01:00:00Z" },
        { day: "2026-10-24", change: "2026-10-25T01:00:00Z" },
      ];

      for (const { day, change } of changes) {
        const at = new Date(change).getTime();
        const result = await tradeDay(venue, day, 5, {
          seats: { from: new Date(at - 45 * 60_000), to: new Date(at - 15 * 60_000) },
        });
        expect(result.bills).toHaveLength(5);
        for (const bill of result.bills) {
          expect(bill.seatedAt.getTime()).toBeLessThan(at);
          expect(bill.finishedAt.getTime()).toBeGreaterThan(at);
        }
        // The rows themselves carry the bench's time, not the machine's.
        const [issued] = rows(
          venue,
          sql`select min(issued_at) as first, max(issued_at) as last from sales
              where issued_at > ${new Date(at - 2 * 60 * 60_000).toISOString()}`,
        );
        expect(Date.parse(issued!.first as string)).toBeGreaterThan(at);
        expect(Date.parse(issued!.last as string)).toBeLessThan(at + 2 * 60 * 60_000);
      }
      expect(countRows(venue).sales).toBe(10);
      expect(countRows(venue).daily_closes).toBe(2);
    },
    CASE_TIMEOUT_MS,
  );

  it(
    "trades two days in a row across the overnight step with the watchdog quiet",
    async () => {
      const ticks: number[] = [];
      const ticker = setInterval(() => ticks.push(performance.now()), 250);
      try {
        const venue = await freshVenue("2025-11-03T08:00:00Z");
        await tradeDay(venue, "2025-11-03", 6);
        await tradeDay(venue, "2025-11-04", 6);

        expect(countRows(venue).sales).toBe(12);
        expect(countRows(venue).daily_closes).toBe(2);
        const gaps = ticks.slice(1).map((at, index) => at - ticks[index]!);
        // The watchdog kills the process after 120 s without a timer turn, so a kill would end
        // the run before any assertion; the longest gap between turns is what shows starvation.
        expect(Math.max(...gaps)).toBeLessThan(5_000);
      } finally {
        clearInterval(ticker);
      }
    },
    CASE_TIMEOUT_MS,
  );
  it(
    "reopens a seeded folder with its saved device cookies and trades the next day",
    async () => {
      const venue = await freshVenue("2025-11-03T08:00:00Z");
      await tradeDay(venue, "2025-11-03", 2);
      const cookies = venue.deviceCookies();
      const { dir } = opened.pop()!;
      await venue.close();
      const reopened = await openBenchVenue(dir, { seed: 1, deviceCookies: cookies });
      opened.push({ venue: reopened, dir });

      expect(reopened.deviceCookies()).toEqual(cookies);
      expect(reopened.kitchenScreens.map((screen) => screen.id)).toEqual(
        venue.kitchenScreens.map((screen) => screen.id),
      );
      await tradeDay(reopened, "2025-11-04", 2);
      expect(countRows(reopened).sales).toBe(4);
      expect(rows(reopened, sql`select estado, count(*) as n from envios group by estado`)).toEqual(
        [{ estado: "aceptado", n: 4 }],
      );
    },
    CASE_TIMEOUT_MS,
  );

  it(
    "refuses a day that starts before the bench clock",
    async () => {
      const venue = await freshVenue("2025-11-05T08:00:00Z");
      await expect(tradeDay(venue, "2025-11-03", 1)).rejects.toThrow(
        /opens before the bench clock/,
      );
    },
    CASE_TIMEOUT_MS,
  );
});

describe("installBenchClock", () => {
  it("dates new Date() and Date.now() by the bench clock, never backwards, until uninstalled", () => {
    const realBefore = Date.now();
    clock = installBenchClock(new Date("2025-11-03T08:00:00Z"));
    expect(new Date().toISOString().slice(0, 16)).toBe("2025-11-03T08:00");
    clock.set(new Date("2025-11-04T10:00:00Z"));
    expect(Date.now()).toBeGreaterThanOrEqual(Date.parse("2025-11-04T10:00:00Z"));
    clock.set(new Date("2025-11-04T09:00:00Z"));
    expect(Date.now()).toBeGreaterThanOrEqual(Date.parse("2025-11-04T10:00:00Z"));
    expect(new Date(0).getTime()).toBe(0);
    expect(new Date() instanceof Date).toBe(true);
    clock.uninstall();
    clock = undefined;
    expect(Date.now()).toBeGreaterThanOrEqual(realBefore);
  });
});
