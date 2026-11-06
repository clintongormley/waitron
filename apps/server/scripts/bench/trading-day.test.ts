import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { kitchenStations, withTransaction } from "@waitron/db";
import { businessDayBounds } from "@waitron/shared";
import { readScopedPassBoard } from "../../src/pass-board.js";
import { listStationQueues } from "../../src/working-order.js";
import { installBenchClock, type BenchClock } from "./bench-clock.js";
import { openBenchVenue, type BenchVenue } from "./bench-venue.js";
import { BENCH_PROFILE, PAYMENT_ROUTES } from "./profile.js";
import { countRows, dayEvents, planDay, tradeDay, type PlanningVenue } from "./trading-day.js";

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

/** The distinct dishes anywhere in a station or pass answer: objects with an id, a name and a state. */
function dishesIn(answer: unknown): number {
  const dishes = new Set<string>();
  const walk = (value: unknown) => {
    if (Array.isArray(value)) for (const entry of value) walk(entry);
    else if (value !== null && typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (
        typeof record.id === "string" &&
        typeof record.name === "string" &&
        typeof record.state === "string"
      )
        dishes.add(record.id);
      for (const child of Object.values(record)) walk(child);
    }
  };
  walk(answer);
  return dishes.size;
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
    "sends rounds through drafts, prints and releases held rounds, and sends an invoice",
    async () => {
      // Seed 2's ten bills include one that asks for an invoice; seed 1's include none.
      const venue = await freshVenue("2025-11-03T08:00:00Z", 2);

      await tradeDay(venue, "2025-11-03", 10);

      const counts = countRows(venue);
      expect(counts.order_drafts).toBe(counts.order_groups);
      expect(
        rows(venue, sql`select kind, count(*) as n from order_draft_events group by kind`),
      ).toEqual([
        { kind: "created", n: counts.order_drafts },
        { kind: "submitted", n: counts.order_drafts },
      ]);
      // Only a held group is fired by a command of its own.
      const held = rows(
        venue,
        sql`select g.state, g.fired_at as firedAt, min(t.preparing_at) as firstAdvance
            from order_group_events e
            join order_groups g on g.id = e.group_id
            join working_order_lines l on l.group_id = g.id
            join ticket_items t on t.working_order_line_id = l.id
            where e.kind = 'fired'
            group by g.id`,
      );
      expect(held.length).toBeGreaterThan(0);
      for (const group of held) {
        expect(group.state).toBe("fired");
        expect(Date.parse(group.firedAt as string)).toBeLessThan(
          Date.parse(group.firstAdvance as string),
        );
      }
      // Every station holding a held group's dishes printed its HOLD ticket, and only those.
      const paper = rows(
        venue,
        sql`select e.group_id as groupId,
              (select count(*) from order_group_hold_stations h where h.group_id = e.group_id) as printed,
              (select count(distinct t.station_id) from ticket_items t
                 join working_order_lines l on l.id = t.working_order_line_id
                 where l.group_id = e.group_id) as stations
            from order_group_events e where e.kind = 'fired'`,
      );
      expect.soft(counts.order_group_hold_stations).toBeGreaterThan(0);
      for (const group of paper)
        expect.soft(group.printed, group.groupId as string).toBe(group.stations);
      expect.soft(counts.invoice_deliveries).toBeGreaterThan(0);
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
    "carries on a reopened folder's attendance scan rather than starting it again",
    async () => {
      const venue = await freshVenue("2025-11-03T08:00:00Z");
      await tradeDay(venue, "2025-11-03", 2);
      const scans = (from: BenchVenue) =>
        rows(
          from,
          sql`select source, key, generation, cursor, endpoint, completed
              from attendance_source_state where record_kind = 'scan' order by source, key`,
        );
      const before = scans(venue);
      expect(before.some((scan) => (scan.cursor as number) > 0)).toBe(true);
      const cookies = venue.deviceCookies();
      const { dir } = opened.pop()!;
      await venue.close();

      const reopened = await openBenchVenue(dir, { seed: 1, deviceCookies: cookies });
      opened.push({ venue: reopened, dir });

      expect(scans(reopened)).toEqual(before);
    },
    CASE_TIMEOUT_MS,
  );

  it(
    "leaves no dish of a finished day on any station's list or the pass",
    async () => {
      const venue = await freshVenue("2025-11-03T08:00:00Z");
      await tradeDay(venue, "2025-11-03", 4);

      for (const screen of venue.kitchenScreens) {
        const response = await venue.app.request("/api/device/station-screen", {
          headers: { cookie: screen.cookie },
        });
        expect(response.status).toBe(200);
        expect.soft(dishesIn(await response.json()), screen.name).toBe(0);
      }
      const stationIds = (
        await venue.db.select({ id: kitchenStations.id }).from(kitchenStations)
      ).map((station) => station.id);
      const lists = await withTransaction(venue.db, async (tx) => ({
        stations: [...(await listStationQueues(tx, stationIds)).values()],
        pass: await readScopedPassBoard(
          tx,
          { stationIds: null, zoneIds: null },
          { release: false },
        ),
      }));
      expect.soft(dishesIn(lists.stations), "stations").toBe(0);
      expect.soft(dishesIn(lists.pass), "pass").toBe(0);
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

describe("planDay", () => {
  /** The venue `openBenchVenue` seeds, as far as planning reads it. */
  function seededShape(seed: number): PlanningVenue {
    const zonesPerDepartment = BENCH_PROFILE.zones / BENCH_PROFILE.departments;
    return {
      seed,
      dishes: Array.from({ length: BENCH_PROFILE.dishes }, (_, n) => ({
        productId: `product-${n}`,
        menuItemId: `dish-${n}`,
      })),
      zones: Array.from({ length: BENCH_PROFILE.zones }, (_, z) => ({
        id: `zone-${z}`,
        departmentId: `department-${Math.floor(z / zonesPerDepartment)}`,
        tableIds: Array.from({ length: BENCH_PROFILE.tablesPerZone }, (_, t) => `table-${z}.${t}`),
      })),
      tills: Array.from({ length: BENCH_PROFILE.tills }, (_, t) => ({
        id: `till-${t}`,
        name: `Till ${t}`,
        cookie: "",
        departmentId: `department-${t % BENCH_PROFILE.departments}`,
      })),
    };
  }

  it("never has more parties at once in a department than its tables, on any day of the year", () => {
    const venue = seededShape(1);
    const tables = new Map<string, number>();
    for (const zone of venue.zones)
      tables.set(zone.departmentId, (tables.get(zone.departmentId) ?? 0) + zone.tableIds.length);
    const overfull: string[] = [];
    const first = new Date(`${BENCH_PROFILE.startDate}T00:00:00Z`);
    for (let n = 0; n < BENCH_PROFILE.days; n++) {
      const at = new Date(first);
      at.setUTCDate(first.getUTCDate() + n);
      const day = at.toISOString().slice(0, 10);
      const { startAt } = businessDayBounds(
        {
          timeZone: BENCH_PROFILE.timeZone,
          dayCutover: BENCH_PROFILE.dayCutover,
          cutoverChanges: [],
        },
        day,
      );
      const plans = planDay(venue, day, BENCH_PROFILE.billsPerDay, Date.parse(startAt), undefined);
      const seated = new Map<string, number>();
      let peak = 0;
      for (const event of dayEvents(plans)) {
        const department = plans[event.bill]!.zone.departmentId;
        const change = event.step.kind === "seat" ? 1 : event.step.kind === "finish" ? -1 : 0;
        const now = (seated.get(department) ?? 0) + change;
        seated.set(department, now);
        peak = Math.max(peak, now - tables.get(department)!);
      }
      if (peak > 0) overfull.push(`${day} +${peak}`);
    }

    expect(overfull).toEqual([]);
  });
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
