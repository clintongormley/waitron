import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CORE_CHANGE_SOURCES,
  dayCutoverChanges,
  insertNodeSeriesTx,
  installChangeFeed,
  readVenueClock,
  retireNodeSeriesTx,
  taxpayer,
  withTransaction,
} from "@waitron/db";
import type { TrustedClock } from "@waitron/fiscal";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { AppError, businessDayAt, businessDayBounds, type BusinessDayClock } from "@waitron/shared";
import { closeOfDayJob } from "./close-of-day.js";
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

/** Runs once, before the next transaction opened through `@waitron/db`'s `withTransaction`. */
const beforeNextTransaction = vi.hoisted(() => ({
  run: undefined as (() => Promise<void>) | undefined,
}));
vi.mock("@waitron/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@waitron/db")>();
  return {
    ...original,
    withTransaction: async (...args: Parameters<typeof original.withTransaction>) => {
      const run = beforeNextTransaction.run;
      beforeNextTransaction.run = undefined;
      await run?.();
      return original.withTransaction(...args);
    },
  };
});

let venue: BillVenue;
/** The till's routes, opening bills under the gate the job reads. */
let seatingApp: BillVenue["app"];
let venueClock: BusinessDayClock;
let today: string;
/** The trusted clock's reading, in ms. */
let at = 0;
let seatHolds = false;
/** How many holds have begun, as the box's clock sources count them. */
let holdsBegun = 0;
function hold() {
  seatHolds = true;
  holdsBegun++;
}
/** A hold only the fiscal gate sees: the job reads neither it nor a new count. */
function gateHolds() {
  seatHolds = true;
}
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
    seatingApp = venue.appWith({ clockUnconfirmed: () => seatHolds });
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

interface SellingSwitch {
  mode: string;
  role: string;
  fenced: boolean;
  stop: AbortController;
  selling: Selling;
}

/** A selling primary whose standing, and the runner's signal, a test can change mid-pass. */
function sellingSwitch(): SellingSwitch {
  const state: SellingSwitch = {
    mode: "primary",
    role: "primary",
    fenced: false,
    stop: new AbortController(),
    selling: { mode: () => state.mode, role: () => state.role, fenced: () => state.fenced },
  };
  return state;
}

function job(opts: { selling?: Selling } = {}) {
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
    clockHoldsBegun: () => holdsBegun,
  });
}

function look(definition: ReturnType<typeof job>) {
  return definition.pass({ now: new Date(at), signal: new AbortController().signal });
}

/** A seated table bill with a dish sent, stored as opened at `openedAt`: its trusted opening time
 * too, unless it was seated while the time was unconfirmed. */
async function billOpenedAt(openedAt: number) {
  const party = await seatedWith({ ...venue, app: seatingApp }, "Red wine bottle");
  const stored = new Date(openedAt).toISOString();
  venue.db.run(sql`
    update working_orders
    set opened_at = ${stored},
      trusted_opened_at = iif(trusted_opened_at is null, null, ${stored})
    where id = ${party.tabId}
  `);
  return party.tabId;
}

function openings(billId: string) {
  return venue.db.all<{ openedAt: string; trustedOpenedAt: string | null }>(sql`
    select opened_at as openedAt, trusted_opened_at as trustedOpenedAt
    from working_orders where id = ${billId}
  `)[0];
}

function salesOf(billId: string) {
  return venue.db.all<{ id: string; issuedAt: string; source: string }>(
    sql`select id, issued_at as issuedAt, source from sales where working_order_id = ${billId}`,
  );
}

function issued(billId: string): boolean {
  return salesOf(billId).length === 1;
}

describe("bills.close_of_day", () => {
  beforeEach(() => {
    seatHolds = false;
  });

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
        source: "business_day_close",
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
    hold();
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
    hold();
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
    hold();
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
        if (event === "close_of_day.issued") (jobSees ? hold : gateHolds)();
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

  it("issues the fine bill when another is refused, logs the refused one and throws its refusal", async () => {
    const bad = await billOpenedAt(day(12).startAt + HOUR);
    const fine = await billOpenedAt(day(12).startAt + 2 * HOUR);
    refused.set(bad, new AppError("bill.nothing_outstanding", { workingOrderId: bad }));
    const definition = job();
    at = day(13).startAt + HOUR;
    try {
      await expect(look(definition)).rejects.toMatchObject({ code: "bill.nothing_outstanding" });
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

  it("still throws for a refused bill when a later bill ends the pass quietly", async () => {
    const bad = await billOpenedAt(day(14).startAt + HOUR);
    const later = await billOpenedAt(day(14).startAt + 2 * HOUR);
    refused.set(bad, new AppError("bill.nothing_outstanding", { workingOrderId: bad }));
    const definition = job();
    jobSeesHold = () => false;
    onLog = (_level, event) => {
      if (event === "close_of_day.issue_failed") gateHolds();
    };
    at = day(15).startAt + HOUR;
    try {
      await expect(look(definition)).rejects.toMatchObject({ code: "bill.nothing_outstanding" });
      expect(issued(later)).toBe(false);
    } finally {
      onLog = () => {};
      jobSeesHold = () => seatHolds;
      refused.clear();
    }
    seatHolds = false;
    at += 5_000;
    await look(definition);
    expect(issued(bad)).toBe(true);
    expect(issued(later)).toBe(true);
  });

  it("issues no bill opened during a hold that began and ended between two looks", async () => {
    const bad = await billOpenedAt(day(16).startAt + HOUR);
    refused.set(bad, new AppError("bill.nothing_outstanding", { workingOrderId: bad }));
    const definition = job();
    at = day(17).startAt + 3 * HOUR;
    let bill: string;
    try {
      await expect(look(definition)).rejects.toBeDefined();
      hold();
      // Seated while the box's clock reads a day behind; no look sees the hold.
      bill = await billOpenedAt(day(16).startAt + 10 * HOUR);
      seatHolds = false;
      at += 5_000;
      await look(definition).catch(() => {});
      expect(issued(bill)).toBe(false);
      expect(fiscalRecordCount(venue, bill)).toBe(0);
    } finally {
      refused.clear();
    }
    at = day(17).endAt + 60_000;
    await look(definition);
    expect(issued(bill)).toBe(true);
    expect(issued(bad)).toBe(true);
  });

  it("issues no bill opened during a hold that began and ended while a look was under way", async () => {
    const definition = job();
    at = day(19).startAt + 3 * HOUR;
    let bill = "";
    // The look's first transaction comes after it has read the highest bill row and the count.
    beforeNextTransaction.run = async () => {
      hold();
      bill = await billOpenedAt(day(18).startAt + 10 * HOUR);
      seatHolds = false;
    };
    await look(definition);
    expect(bill).not.toBe("");
    expect(issued(bill)).toBe(false);
    at += 5_000;
    await look(definition);
    expect(issued(bill)).toBe(false);
    expect(fiscalRecordCount(venue, bill)).toBe(0);

    at = day(19).endAt + 60_000;
    await look(definition);
    expect(issued(bill)).toBe(true);
  });

  it("takes no write turn on a look that has nothing to query", async () => {
    const definition = job();
    at = day(20).startAt + HOUR;
    await look(definition);
    const writeLock = vi.spyOn(venue.db, "withWriteLock");
    try {
      at += 60_000;
      await look(definition);
      expect(writeLock).not.toHaveBeenCalled();
    } finally {
      writeLock.mockRestore();
    }
  });

  it("queries again in the same business day after its candidate query failed", async () => {
    const bill = await billOpenedAt(day(21).startAt + HOUR);
    const definition = job();
    at = day(21).startAt + 2 * HOUR;
    await look(definition);
    const queryFailed = new Error("candidate query failed");
    beforeNextTransaction.run = async () => {
      throw queryFailed;
    };
    at = day(22).startAt + HOUR;
    await expect(look(definition)).rejects.toBe(queryFailed);
    expect(issued(bill)).toBe(false);
    at += 5_000;
    await look(definition);
    expect(issued(bill)).toBe(true);
  });

  it("issues no further bill once the runner's signal stops the pass, and leaves the rest for the next look", async () => {
    const first = await billOpenedAt(day(22).startAt + 3 * HOUR);
    const second = await billOpenedAt(day(22).startAt + 4 * HOUR);
    const definition = job();
    const stop = new AbortController();
    onLog = (_level, event) => {
      if (event === "close_of_day.issued") stop.abort();
    };
    at = day(23).startAt + HOUR;
    try {
      await definition.pass({ now: new Date(at), signal: stop.signal });
    } finally {
      onLog = () => {};
    }
    expect(issued(first)).toBe(true);
    expect(issued(second)).toBe(false);
    expect(fiscalRecordCount(venue, second)).toBe(0);
    at += 60_000;
    await look(definition);
    expect(issued(second)).toBe(true);
  });

  it("writes nothing when the runner signals a stepdown while the pass looks for bills", async () => {
    const bill = await billOpenedAt(day(23).startAt + 2 * HOUR);
    at = day(24).startAt + HOUR;
    const runner = createJobRunner({ now: () => new Date(at), log: () => {} });
    beforeNextTransaction.run = async () => {
      runner.signalStepdown();
    };
    try {
      runner.add(job());
      await vi.waitFor(() => expect(runner.views()["bills.close_of_day"]?.state).toBe("stopped"));
      expect(fiscalRecordCount(venue, bill)).toBe(0);
    } finally {
      await runner.stopJobs();
    }
    await look(job());
    expect(issued(bill)).toBe(true);
  });

  it.each([
    { what: "the runner's signal stops the pass", stops: (s: SellingSwitch) => s.stop.abort() },
    { what: "the box becomes a mirror", stops: (s: SellingSwitch) => (s.mode = "mirror") },
    { what: "the box is no longer primary", stops: (s: SellingSwitch) => (s.role = "secondary") },
    { what: "the box is fenced", stops: (s: SellingSwitch) => (s.fenced = true) },
  ])("writes nothing for a bill when $what just before its transaction", async ({ stops }) => {
    const bill = await billOpenedAt(day(24).startAt + 2 * HOUR);
    const state = sellingSwitch();
    const definition = job({ selling: state.selling });
    // The pass's first transaction looks for bills; the next is the bill's own.
    beforeNextTransaction.run = async () => {
      beforeNextTransaction.run = async () => {
        stops(state);
      };
    };
    at = day(25).startAt + HOUR;
    await definition.pass({ now: new Date(at), signal: state.stop.signal });
    expect(beforeNextTransaction.run).toBeUndefined();
    expect(fiscalRecordCount(venue, bill)).toBe(0);
    expect(issued(bill)).toBe(false);
    await look(job());
    expect(issued(bill)).toBe(true);
  });

  it.each([
    { where: "while the pass looks for bills", hookAt: "query" },
    { where: "just before a bill's transaction", hookAt: "bill" },
  ])(
    "issues nothing against the day's end read before a hold that began and ended $where",
    async ({ hookAt }) => {
      const bill = await billOpenedAt(day(25).startAt + 2 * HOUR);
      const definition = job();
      at = day(26).startAt + 60_000;
      // The clock is corrected back to before the day's end while the look is under way.
      const corrected = async () => {
        hold();
        at = day(26).startAt - 60_000;
        seatHolds = false;
      };
      beforeNextTransaction.run =
        hookAt === "query"
          ? corrected
          : async () => {
              beforeNextTransaction.run = corrected;
            };
      await look(definition);
      expect(beforeNextTransaction.run).toBeUndefined();
      expect(fiscalRecordCount(venue, bill)).toBe(0);
      at += 5_000;
      await look(definition);
      expect(fiscalRecordCount(venue, bill)).toBe(0);

      at = day(26).startAt + 60_000;
      await look(definition);
      expect(issued(bill)).toBe(true);
    },
  );

  it("after a hold seen inside a bill's transaction, treats bills opened during it as opened at the release", async () => {
    const due = await billOpenedAt(day(27).startAt + 2 * HOUR);
    const definition = job();
    at = day(28).startAt + 3 * HOUR;
    let seatedInHold = "";
    beforeNextTransaction.run = async () => {
      beforeNextTransaction.run = async () => {
        hold();
        // Seated while the box's clock reads a day behind.
        seatedInHold = await billOpenedAt(day(27).startAt + 10 * HOUR);
        seatHolds = false;
      };
    };
    await look(definition);
    expect(seatedInHold).not.toBe("");
    expect(fiscalRecordCount(venue, due)).toBe(0);
    at += 5_000;
    await look(definition);
    expect(issued(due)).toBe(true);
    expect(fiscalRecordCount(venue, seatedInHold)).toBe(0);

    at = day(28).endAt + 60_000;
    await look(definition);
    expect(issued(seatedInHold)).toBe(true);
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

describe("a bill opened while the box's time is unconfirmed", () => {
  beforeEach(() => {
    seatHolds = false;
  });

  it("is stored with no trusted opening time, and one opened once the time is confirmed with its opening time", async () => {
    hold();
    const unconfirmed = (await seatedWith({ ...venue, app: seatingApp }, "Red wine bottle")).tabId;
    seatHolds = false;
    const confirmed = (await seatedWith({ ...venue, app: seatingApp }, "Red wine bottle")).tabId;

    expect(openings(unconfirmed)).toEqual({ openedAt: expect.any(String), trustedOpenedAt: null });
    const stored = openings(confirmed)!;
    expect(stored.trustedOpenedAt).toBe(stored.openedAt);
  });

  it("is given the reading at the release as its trusted opening time, which a later release keeps", async () => {
    at = day(38).startAt + 9 * HOUR;
    hold();
    const definition = job();
    await look(definition);
    const bill = await billOpenedAt(day(37).startAt + 10 * HOUR);
    seatHolds = false;
    at += HOUR;
    await look(definition);
    const releasedAt = new Date(at).toISOString();
    expect(openings(bill)!.trustedOpenedAt).toBe(releasedAt);

    at += HOUR;
    await look(job());
    expect(openings(bill)!.trustedOpenedAt).toBe(releasedAt);
  });

  it("after a restart later that business day, issues no ticket mid-service, only at the end of the day it was counted in", async () => {
    const definition = job();
    at = day(34).startAt + 9 * HOUR;
    hold();
    await look(definition);
    // Seated while the box's clock reads a day behind.
    const bill = await billOpenedAt(day(33).startAt + 10 * HOUR);
    seatHolds = false;
    at += HOUR;
    await look(definition);
    expect(fiscalRecordCount(venue, bill)).toBe(0);
    // Seated once the time is confirmed, but stored as opened the day before.
    const control = await billOpenedAt(day(33).startAt + 11 * HOUR);

    at += HOUR;
    const restarted = job();
    await look(restarted);
    at += 60_000;
    await look(restarted);
    expect(fiscalRecordCount(venue, bill)).toBe(0);
    expect(issued(control)).toBe(true);

    at = day(34).endAt + 60_000;
    await look(restarted);
    expect(issued(bill)).toBe(true);
  });

  it("counts a bill seated during a wait that a restart cut short as opened when the next start's time is confirmed", async () => {
    at = day(36).startAt + 9 * HOUR;
    hold();
    await look(job());
    // Seated while the box's clock reads a day behind.
    const bill = await billOpenedAt(day(35).startAt + 10 * HOUR);

    const restarted = job();
    at += HOUR;
    await look(restarted);
    seatHolds = false;
    at += HOUR;
    await look(restarted);
    at += 60_000;
    await look(restarted);
    expect(fiscalRecordCount(venue, bill)).toBe(0);

    at = day(36).endAt + 60_000;
    await look(restarted);
    expect(issued(bill)).toBe(true);
  });

  it.each([
    { what: "the runner's signal stops the pass", stops: (s: SellingSwitch) => s.stop.abort() },
    { what: "the box becomes a mirror", stops: (s: SellingSwitch) => (s.mode = "mirror") },
  ])("gives no bill a trusted opening time when $what just before the stamp", async ({ stops }) => {
    hold();
    const bill = await billOpenedAt(day(38).startAt + 10 * HOUR);
    seatHolds = false;
    const state = sellingSwitch();
    const definition = job({ selling: state.selling });
    beforeNextTransaction.run = async () => {
      stops(state);
    };
    at = day(39).startAt + HOUR;
    await definition.pass({ now: new Date(at), signal: state.stop.signal });
    expect(beforeNextTransaction.run).toBeUndefined();
    expect(openings(bill)!.trustedOpenedAt).toBeNull();

    await look(job());
    expect(openings(bill)!.trustedOpenedAt).toBe(new Date(at).toISOString());
  });

  it("takes only the candidate query's write turn on a first look with no bill to stamp", async () => {
    at = day(40).startAt + HOUR;
    // Issues whatever earlier cases left due, so the look below has nothing to issue either.
    await look(job());
    const definition = job();
    const writeLock = vi.spyOn(venue.db, "withWriteLock");
    try {
      await look(definition);
      expect(writeLock).toHaveBeenCalledTimes(1);
    } finally {
      writeLock.mockRestore();
    }
  });

  it("woken at the confirmation 30 s before the day's end, issues the bill at the first look after a restart 30 s after it", async () => {
    // An earlier case moves the venue's day start, so the end is read as it stands now.
    const clock = await inTx(venue, (tx) => readVenueClock(tx));
    const endAt = Date.parse(businessDayBounds(clock, addDays(today, 43)).endAt);
    at = endAt - 2 * HOUR;
    hold();
    const runner = createJobRunner({ now: () => new Date(at), log: () => {} });
    const bill = await billOpenedAt(endAt - 14 * HOUR);
    try {
      runner.add(job());
      await vi.waitFor(() => expect(runner.views()["bills.close_of_day"]?.state).toBeDefined());
      at = endAt - 30_000;
      seatHolds = false;
      // What boot does when the start's time is confirmed.
      runner.wake("bills.close_of_day");
      await vi.waitFor(() =>
        expect(openings(bill)!.trustedOpenedAt).toBe(new Date(at).toISOString()),
      );
    } finally {
      await runner.stopJobs();
    }

    at = endAt + 30_000;
    await look(job());
    expect(issued(bill)).toBe(true);
  });

  // Last in the file: it retires the venue's series, which leaves every bill opened before it alone.
  it("leaves a bill restored from before its node's series retirement for staff, whether or not its time was confirmed", async () => {
    hold();
    const unconfirmed = await billOpenedAt(day(41).startAt + HOUR);
    seatHolds = false;
    const confirmed = await billOpenedAt(day(41).startAt + 2 * HOUR);
    const retiredAt = new Date(day(42).startAt + HOUR);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(retiredAt);
    try {
      await inTx(venue, async (tx) => {
        await retireNodeSeriesTx(tx, venue.cfg.nodeId);
        await insertNodeSeriesTx(tx, venue.cfg.nodeId, [
          { code: `RESTORED-${randomUUID().slice(0, 8)}`, purpose: "standard" },
          { code: `RESTORED-FULL-${randomUUID().slice(0, 8)}`, purpose: "full" },
        ]);
      });
    } finally {
      vi.useRealTimers();
    }
    at = retiredAt.getTime() + HOUR;
    const restored = job();
    await look(restored);
    at = day(42).endAt + 60_000;
    await look(restored);
    expect([fiscalRecordCount(venue, unconfirmed), fiscalRecordCount(venue, confirmed)]).toEqual([
      0, 0,
    ]);
  });
});
