import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  CORE_CHANGE_SOURCES,
  dayCutoverChanges,
  installChangeFeed,
  readVenueClock,
  taxpayer,
  withTransaction,
} from "@waitron/db";
import type { TrustedClock } from "@waitron/fiscal";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { AppError, businessDayAt, businessDayBounds, type BusinessDayClock } from "@waitron/shared";
import {
  closeOfDayJob,
  highestBillRow,
  openedAtInWindows,
  type ClockWindow,
} from "./close-of-day.js";
import { createJobRunner } from "./job-runner.js";
import type { Logger } from "./logger.js";
import { gateSeatOnStartClock } from "./start-clock-gate.js";
import { systemClock } from "./till-backend.js";
import {
  fiscalRecordCount,
  inTx,
  provisionBillVenue,
  seatedWith,
  type BillVenue,
} from "./testing/bill-venue.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import "./errors.js";

const refused = vi.hoisted(() => new Map<string, Error>());
vi.mock("./till-sale.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./till-sale.js")>();
  return {
    ...original,
    refuseBillPaymentInFlight: (...args: Parameters<typeof original.refuseBillPaymentInFlight>) => {
      const refusal = refused.get(args[2]);
      return refusal === undefined
        ? original.refuseBillPaymentInFlight(...args)
        : Promise.reject(refusal);
    },
  };
});

let venue: BillVenue;
let venueClock: BusinessDayClock;
let today: string;
/** The trusted clock's reading, in ms. */
let at = 0;
let seatHolds = false;
let jobSeesHold: () => boolean = () => seatHolds;
let onLog: Logger = () => {};
const logged: { event: string; fields: Record<string, unknown> | undefined }[] = [];

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    await inTx(venue, (tx) =>
      tx.update(taxpayer).set({ taxpayerDomicile: "Calle Fiscal 8, Madrid" }),
    );
    venueClock = await inTx(venue, (tx) => readVenueClock(tx));
    today = businessDayAt(venueClock, new Date());
  },
});

function trustedClock(): TrustedClock {
  const base = systemClock();
  return { ...base, now: () => ({ ...base.now(), instant: new Date(at), offsetMinutes: 60 }) };
}

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The bounds of the business day `offset` days after today's. */
function day(offset: number) {
  const bounds = businessDayBounds(venueClock, addDays(today, offset));
  return { startAt: Date.parse(bounds.startAt), endAt: Date.parse(bounds.endAt) };
}

const HOUR = 3_600_000;

type Selling = { mode: () => string; role: () => string; fenced: () => boolean };
const primary: Selling = { mode: () => "primary", role: () => "primary", fenced: () => false };

function job(opts: { startMark?: number; selling?: Selling } = {}) {
  return closeOfDayJob({
    admission: testTradingAdmission(),
    db: venue.db,
    backend: gateSeatOnStartClock(venue.backend, () => seatHolds),
    clock: trustedClock(),
    cfg: venue.cfg,
    log: (level, event, fields) => {
      logged.push({ event, fields });
      onLog(level, event, fields);
    },
    selling: opts.selling ?? primary,
    clockUnconfirmed: () => jobSeesHold(),
    startMark: opts.startMark ?? highestBillRow(venue.db),
  });
}

function look(definition: ReturnType<typeof job>) {
  return definition.pass({ now: new Date(at), signal: new AbortController().signal });
}

/** A seated table bill with a dish sent, counted as opened at `openedAt`. */
async function billOpenedAt(openedAt: number) {
  const party = await seatedWith(venue, "Red wine bottle");
  venue.db.run(
    sql`update working_orders set opened_at = ${new Date(openedAt).toISOString()} where id = ${party.tabId}`,
  );
  return party.tabId;
}

function salesOf(billId: string) {
  return venue.db.all<{ id: string; issuedAt: string; source: string }>(
    sql`select id, issued_at as issuedAt, source from sales where working_order_id = ${billId}`,
  );
}

function issued(billId: string): boolean {
  return salesOf(billId).length === 1;
}

describe("openedAtInWindows", () => {
  const windows: ClockWindow[] = [
    { after: 3, upTo: 7, releasedAt: new Date("2026-11-20T10:00:00Z") },
    { after: 9, upTo: 12, releasedAt: new Date("2026-11-21T10:00:00Z") },
  ];

  it("gives a row inside a window that window's release reading", () => {
    expect(openedAtInWindows(windows, 4)).toEqual(new Date("2026-11-20T10:00:00Z"));
    expect(openedAtInWindows(windows, 7)).toEqual(new Date("2026-11-20T10:00:00Z"));
    expect(openedAtInWindows(windows, 12)).toEqual(new Date("2026-11-21T10:00:00Z"));
  });

  it("leaves a row outside every window, the mark itself included, to its stored time", () => {
    for (const row of [1, 3, 8, 9, 13]) expect(openedAtInWindows(windows, row)).toBeUndefined();
  });
});

describe("bills.close_of_day", () => {
  it("issues nothing before the day's end, and every due bill at the next look after it", async () => {
    const first = await billOpenedAt(day(0).startAt + HOUR);
    const second = await billOpenedAt(day(0).startAt + 2 * HOUR);
    const definition = job();

    at = day(0).endAt - 60_000;
    await look(definition);
    expect(issued(first)).toBe(false);
    expect(issued(second)).toBe(false);

    at = day(0).endAt + 60_000;
    await look(definition);
    expect(salesOf(first)).toEqual([
      expect.objectContaining({
        source: "trading_day_close",
        issuedAt: new Date(at).toISOString(),
      }),
    ]);
    expect(issued(second)).toBe(true);
  });

  it("on a box started two days after the end, issues the bills of both earlier days at once", async () => {
    const older = await billOpenedAt(day(1).startAt + HOUR);
    const newer = await billOpenedAt(day(2).startAt + HOUR);
    at = day(4).startAt + HOUR;
    await look(job());
    expect(issued(older)).toBe(true);
    expect(issued(newer)).toBe(true);
  });

  it("issues no ticket when the gate lets go on a box whose clock ran a day behind, only at the end of the corrected day", async () => {
    seatHolds = true;
    const definition = job();
    at = day(6).startAt + 9 * HOUR;
    await look(definition);
    // Seated and served while the box's clock reads a day behind.
    const bill = await billOpenedAt(day(5).startAt + 10 * HOUR);
    await look(definition);

    at = day(6).startAt + 10 * HOUR;
    seatHolds = false;
    await look(definition);
    at += 60_000;
    await look(definition);
    expect(issued(bill)).toBe(false);
    expect(fiscalRecordCount(venue, bill)).toBe(0);

    at = day(6).endAt + 60_000;
    await look(definition);
    expect(salesOf(bill)).toEqual([
      expect.objectContaining({ issuedAt: new Date(at).toISOString() }),
    ]);
  });

  it("treats bills seated while a clock set held mid-service the same way", async () => {
    const definition = job();
    at = day(7).startAt + 9 * HOUR;
    await look(definition);
    seatHolds = true;
    await look(definition);
    const bill = await billOpenedAt(day(6).startAt + 10 * HOUR);
    seatHolds = false;
    at = day(7).startAt + 10 * HOUR;
    await look(definition);
    expect(issued(bill)).toBe(false);

    at = day(7).endAt + 60_000;
    await look(definition);
    expect(issued(bill)).toBe(true);
  });

  it("writes nothing and throws nothing while the gate holds; released, issues dated with the reading then", async () => {
    const bill = await billOpenedAt(day(8).startAt + HOUR);
    const definition = job();
    seatHolds = true;
    at = day(9).startAt + HOUR;
    await expect(look(definition)).resolves.toBeDefined();
    at += 60_000;
    await expect(look(definition)).resolves.toBeDefined();
    expect(issued(bill)).toBe(false);
    expect(fiscalRecordCount(venue, bill)).toBe(0);

    seatHolds = false;
    at += 60_000;
    await look(definition);
    expect(salesOf(bill)).toEqual([
      expect.objectContaining({ issuedAt: new Date(at).toISOString() }),
    ]);
  });

  it.each([
    { where: "between bills", jobSees: true },
    { where: "inside a bill's transaction", jobSees: false },
  ])(
    "when the gate starts holding mid-pass ($where), keeps what was issued and leaves the rest for the release",
    async ({ jobSees }) => {
      const first = await billOpenedAt(day(10).startAt + HOUR);
      const second = await billOpenedAt(day(10).startAt + 2 * HOUR);
      const definition = job();
      if (!jobSees) jobSeesHold = () => false;
      onLog = (_level, event) => {
        if (event === "close_of_day.issued") seatHolds = true;
      };
      try {
        at = day(11).startAt + HOUR;
        await expect(look(definition)).resolves.toBeDefined();
        expect(issued(first)).toBe(true);
        expect(issued(second)).toBe(false);
        expect(fiscalRecordCount(venue, second)).toBe(0);
        expect(logged.some((entry) => entry.event === "close_of_day.issue_failed")).toBe(false);
      } finally {
        onLog = () => {};
        jobSeesHold = () => seatHolds;
      }
      seatHolds = false;
      at += 60_000;
      await look(definition);
      expect(issued(second)).toBe(true);
    },
  );

  it("issues the fine bill when another is refused, logs the refused one and throws naming it", async () => {
    const bad = await billOpenedAt(day(12).startAt + HOUR);
    const fine = await billOpenedAt(day(12).startAt + 2 * HOUR);
    refused.set(bad, new AppError("bill.nothing_outstanding", { workingOrderId: bad }));
    const definition = job();
    at = day(13).startAt + HOUR;
    try {
      await expect(look(definition)).rejects.toThrow(bad);
      expect(issued(fine)).toBe(true);
      expect(issued(bad)).toBe(false);
      expect(logged).toContainEqual({
        event: "close_of_day.issue_failed",
        fields: { workingOrderId: bad, errorCode: "bill.nothing_outstanding" },
      });
    } finally {
      refused.clear();
    }
    at += 5_000;
    await look(definition);
    expect(issued(bad)).toBe(true);
  });

  it("applies only on a primary box that is neither a mirror nor fenced", () => {
    const of = (mode: string, role: string, fenced: boolean) =>
      job({ selling: { mode: () => mode, role: () => role, fenced: () => fenced } }).applies();
    expect(of("primary", "primary", false)).toBe(true);
    expect(of("mirror", "primary", false)).toBe(false);
    expect(of("primary", "secondary", false)).toBe(false);
    expect(of("primary", "primary", true)).toBe(false);
  });

  it("wakes when the venue's day start changes, and issues what the new start makes due", async () => {
    const bill = await billOpenedAt(day(14).startAt + HOUR);
    // An hour before day 15 begins at the venue's 06:00: still day 14.
    at = day(15).startAt - HOUR;
    await installChangeFeed(
      venue.db,
      CORE_CHANGE_SOURCES.filter((source) => source.table === "day_cutover_changes"),
    );
    await withTransaction(venue.db, async () => {});
    let looks = 0;
    const definition = job();
    const runner = createJobRunner({ now: () => new Date(at), log: () => {} });
    runner.add({
      ...definition,
      pass: async (ctx) => {
        try {
          return await definition.pass(ctx);
        } finally {
          looks++;
        }
      },
    });
    try {
      await vi.waitFor(() => expect(looks).toBe(1));
      expect(issued(bill)).toBe(false);
      await withTransaction(venue.db, (tx) =>
        tx
          .insert(dayCutoverChanges)
          .values({ effectiveBusinessDay: addDays(today, 15), dayCutover: "04:00:00" }),
      );
      await vi.waitFor(() => expect(issued(bill)).toBe(true), { timeout: 5_000 });
    } finally {
      await runner.stopJobs();
    }
  });
});
