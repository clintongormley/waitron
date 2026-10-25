import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type {
  AuthorityTimeSample,
  BootReading,
  FiscalBackend,
  TrustedClock,
} from "@waitron/fiscal";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { CLOCK_WATCH_MS, startClockWatch } from "./clock-watch.js";
import { createClockWitnessStore, type ClockWitnessStore } from "./clock-witnesses.js";
import { provisionBillVenue, send, type BillVenue } from "./testing/bill-venue.js";
import { systemClock } from "./till-backend.js";
import "./errors.js";

// Every case writes on a clock of its own, so each has a database of its own (`useVenueDb` resets
// per test), and its sales are dated after anything provisioning wrote.
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 120_000,
});

const S = 1_000;
const M = 60_000;
const H = 3_600_000;
// Real time 08:00, when the clock starts reading 2 h ahead.
const T0 = Date.parse("2027-03-01T08:00:00.000Z");
// Real time 10:00, when the clock is put right.
const X = T0 + 2 * H;
const BOOT_AT_T0 = 1_000_000;
const BOOT_ID = "boot-watch-restart";

let venue: BillVenue;

beforeEach(async () => {
  venue = await provisionBillVenue(suite.db);
});

/** The box: real time `real`, its clock `skew` ahead of it, its boot-time clock counting real time
 * since boot. */
function box() {
  const clocks = { real: T0, skew: 2 * H };
  const reading = () => clocks.real + clocks.skew;
  const boot = (): BootReading => ({ ms: BOOT_AT_T0 + (clocks.real - T0), id: BOOT_ID });
  const store = createClockWitnessStore({ wall: reading, monotonic: () => boot().ms });
  const base = systemClock();
  const clock: TrustedClock = {
    ...base,
    now: () => ({ ...base.now(), instant: new Date(reading()), offsetMinutes: 60 }),
  };
  return { clocks, reading, boot, store, clock };
}

type Box = ReturnType<typeof box>;

function clockAt(ms: number): TrustedClock {
  const base = systemClock();
  const reading = { ...base.now(), instant: new Date(ms), offsetMinutes: 60 };
  return { ...base, now: () => reading };
}

async function sale(at: Box): Promise<number> {
  const answer = await send(
    venue.appAt(clockAt(at.reading())),
    venue.cookie,
    "POST",
    "/api/sales",
    {
      workingOrderId: randomUUID(),
      zoneId: venue.zoneId,
      lines: [{ menuItemId: venue.offerFor("Caña"), quantity: "1" }],
      tender: { method: "cash", amount: "3.00" },
    },
  );
  return answer.status;
}

/** A clock watch on the box's clocks and store over the real seat, AEAT's time answered by
 * `authority`; `look(real)` moves real time and runs one check. */
function watch(at: Box, authority: () => AuthorityTimeSample | null) {
  let fire = (): void => {};
  let armed = 0;
  const readAuthorityTime = vi.fn(async () => authority());
  const running = startClockWatch({
    backend: Object.create(venue.backend, {
      readAuthorityTime: { value: readAuthorityTime },
    }) as FiscalBackend,
    store: at.store,
    clock: at.clock,
    wall: at.reading,
    boot: { readBoot: at.boot, elapsed: () => at.boot().ms },
    nodeId: venue.cfg.nodeId,
    read: (fn) => venue.db.withWriteLock(() => fn(venue.db)),
    transaction: (fn) => withTransaction(venue.db, fn),
    filesRecords: () => true,
    isPrimary: () => true,
    intervalMs: CLOCK_WATCH_MS,
    log: () => {},
    timer: (_ms, fn) => {
      fire = fn;
      armed += 1;
      return { cancel: () => {} };
    },
  });
  return {
    readAuthorityTime,
    async look(real: number) {
      at.clocks.real = real;
      const before = armed;
      fire();
      await vi.waitFor(() => expect(armed).toBe(before + 1));
    },
    stop: () => running.stop(),
  };
}

/** AEAT agreeing with the box's clock now. */
function agreeing(at: Box): AuthorityTimeSample {
  return {
    authorityMs: at.reading(),
    uncertaintyMs: 100,
    at: { wallMs: at.reading(), monoMs: at.boot().ms },
  };
}

function count(table: "clock_checks" | "clock_confirmations" | "incidents"): number {
  const [row] = suite.db.all<{ n: number }>(
    sql`select count(*) as n from ${sql.identifier(table)}`,
  );
  return row!.n;
}

function incidents(code: string): number {
  const [row] = suite.db.all<{ n: number }>(
    sql`select count(*) as n from incidents where code = ${code}`,
  );
  return row!.n;
}

function checks(): { id: string; detail: Record<string, unknown> }[] {
  return suite.db
    .all<{ id: string; detail: string }>(sql`select id, detail from clock_checks order by seq`)
    .map((row) => ({ id: row.id, detail: JSON.parse(row.detail) as Record<string, unknown> }));
}

/** Sales every 5 minutes, real time, from 08:00 to 10:00 while the clock reads 2 h ahead (stamped
 * 10:00 to 12:00), then the clock put right at 10:00. */
async function aheadSales(at: Box): Promise<void> {
  for (let real = T0; real <= X - 5 * M; real += 5 * M) {
    at.clocks.real = real;
    expect(await sale(at)).toBe(200);
  }
  at.clocks.real = X - 30 * S;
  expect(await sale(at)).toBe(200);
  at.clocks.real = X;
  at.clocks.skew = 0;
}

async function adminConfirms(at: Box): Promise<string> {
  const iso = new Date(at.reading()).toISOString();
  const { confirmation } = await withTransaction(venue.db, (tx) =>
    venue.backend.confirmClockStop!(tx, {
      reading: { instant: new Date(at.reading()), offsetMinutes: 60 },
      boot: at.boot(),
      witnesses: at.store.witnesses(),
      nodeId: venue.cfg.nodeId,
      admin: {
        personId: venue.adminId,
        personName: "Admin",
        reading: { boxAt: iso, witnessAt: iso, uncertaintyMs: 100 },
      },
    }),
  );
  return confirmation!.id;
}

function noteTwoDevices(store: ClockWitnessStore, at: Box): void {
  const arrived = { wallMs: at.reading(), monoMs: at.boot().ms };
  store.noteDevice("till-a", "192.168.10.31", at.reading(), arrived);
  store.noteDevice("till-b", "192.168.10.32", at.reading(), arrived);
}

/** AEAT answering the real time, against the box's clock now. */
function truth(at: Box, aheadMs = 0): AuthorityTimeSample {
  return {
    authorityMs: at.clocks.real + aheadMs,
    uncertaintyMs: 100,
    at: { wallMs: at.reading(), monoMs: at.boot().ms },
  };
}

/** One sale at 08:00 on a right clock, then the clock steps 10 minutes back: the first look, at
 * `T`, sees the stop. */
async function steppedBack(): Promise<Box> {
  const at = box();
  at.clocks.skew = 0;
  expect(await sale(at)).toBe(200);
  at.clocks.skew = -10 * M;
  return at;
}

const T = T0 + 15 * S;

function closings(): { source: string; check_id: string; unconfirmed: boolean; id: string }[] {
  return suite.db
    .all<{ id: string; source: string; check_id: string; proof: string }>(
      sql`select id, source, check_id, proof from clock_confirmations order by seq`,
    )
    .map((row) => ({
      id: row.id,
      source: row.source,
      check_id: row.check_id,
      unconfirmed: (JSON.parse(row.proof) as { closing: { unconfirmed: boolean } }).closing
        .unconfirmed,
    }));
}

describe("the clock watch over the real seat", () => {
  it("opens no check while an administrator's lift covers, and lists the ahead-stamped sales once (the model's case A)", async () => {
    const at = box();
    await aheadSales(at);
    let lifted = false;
    const w = watch(at, () => (lifted ? agreeing(at) : null));
    await w.look(X + 15 * S);
    expect(count("clock_checks")).toBe(1);
    at.clocks.real = X + 90 * M;
    await adminConfirms(at);
    lifted = true;
    expect(count("clock_confirmations")).toBe(1);
    expect(incidents("clock.records_misdated")).toBe(1);
    // A sale every 5 minutes, real time, until 13:00; a look every 15 s while the lift covers (to
    // 12:00, when real time passes the ahead-stamped record), then one after each sale.
    let looks = 0;
    for (
      let real = X + 90 * M + 15 * S;
      real <= X + 3 * H;
      real += real < X + 2 * H ? 15 * S : 5 * M
    ) {
      if ((real - X) % (5 * M) === 0) {
        at.clocks.real = real;
        expect(await sale(at)).toBe(200);
      }
      await w.look(real + 5 * S);
      looks += 1;
      if (looks === 20) expect(count("clock_checks")).toBe(1);
    }
    await w.stop();
    expect(w.readAuthorityTime).toHaveBeenCalled();
    expect(count("clock_checks")).toBe(1);
    expect(count("clock_confirmations")).toBe(1);
    expect(incidents("clock.records_misdated")).toBe(1);
  });

  it("opens one check at the first look that sees the stop, with the reading and the boot reading, and none at the next", async () => {
    const at = box();
    await aheadSales(at);
    const w = watch(at, () => null);
    await w.look(X + 15 * S);
    await w.look(X + 30 * S);
    await w.stop();
    expect(checks()).toEqual([
      {
        id: expect.any(String),
        detail: expect.objectContaining({
          clockAt: new Date(X + 15 * S).toISOString(),
          bootMs: BOOT_AT_T0 + 2 * H + 15 * S,
          bootId: BOOT_ID,
        }),
      },
    ]);
  });

  it("built afresh over an open check, opens none and closes it with the stored start when two devices agree", async () => {
    const at = box();
    await aheadSales(at);
    const first = watch(at, () => null);
    await first.look(X + 15 * S);
    await first.stop();
    const [opened] = checks();

    const again = watch(at, () => null);
    await again.look(X + 30 * M);
    expect(count("clock_checks")).toBe(1);
    at.clocks.real = X + 90 * M;
    noteTwoDevices(at.store, at);
    await again.look(X + 90 * M + 5 * S);
    await again.stop();

    expect(count("clock_checks")).toBe(1);
    const [row] = suite.db.all<{ source: string; check_id: string; proof: string }>(
      sql`select source, check_id, proof from clock_confirmations`,
    );
    expect(row).toMatchObject({ source: "devices", check_id: opened!.id });
    const closing = (JSON.parse(row!.proof) as { closing: Record<string, unknown> }).closing;
    expect(closing).toMatchObject({
      correctedStart: new Date(X + 15 * S).toISOString(),
      partial: false,
    });
    expect(at.store.witnesses()).toEqual([]);
  });

  it("does not close a waiting check before AEAT can be asked again, then closes it on AEAT agreeing, listing nothing", async () => {
    const at = await steppedBack();
    const w = watch(at, () => truth(at));
    await w.look(T);
    expect(w.readAuthorityTime).toHaveBeenCalledTimes(1);
    const [opened] = checks();
    const incidentsBefore = count("incidents");
    at.clocks.real = T + 20 * S;
    at.clocks.skew = 0;
    await w.look(T + 30 * S);
    await w.look(T + 45 * S);
    expect(w.readAuthorityTime).toHaveBeenCalledTimes(1);
    expect(count("clock_confirmations")).toBe(0);
    expect(count("incidents")).toBe(incidentsBefore);
    await w.look(T + 60 * S);
    await w.stop();
    expect(w.readAuthorityTime).toHaveBeenCalledTimes(2);
    const rows = closings();
    expect(rows).toEqual([
      { id: expect.any(String), source: "authority", check_id: opened!.id, unconfirmed: false },
    ]);
    const listed = await withTransaction(venue.db, (tx) =>
      venue.backend.misdatedRecords!(tx, rows[0]!.id),
    );
    expect(listed).toEqual({ known: true, records: [] });
    expect(count("clock_checks")).toBe(1);
  });

  it("keeps a check waiting while no witness comes, asking AEAT once a minute and blocking no sale, then closes it when two devices agree", async () => {
    const at = await steppedBack();
    const w = watch(at, () => null);
    await w.look(T);
    const [opened] = checks();
    at.clocks.skew = 0;
    w.readAuthorityTime.mockClear();
    for (let look = 1; look <= 40; look += 1) await w.look(T + look * 15 * S);
    expect(w.readAuthorityTime).toHaveBeenCalledTimes(10);
    expect(count("clock_confirmations")).toBe(0);
    expect(count("clock_checks")).toBe(1);
    at.clocks.real = T + 605 * S;
    expect(await sale(at)).toBe(200);
    const waiting = await withTransaction(venue.db, (tx) =>
      venue.backend.waitingClockCheck!(tx, { instant: new Date(at.reading()), offsetMinutes: 60 }),
    );
    expect(waiting).toEqual({
      checkId: opened!.id,
      openedAt: new Date(T - 10 * M).toISOString(),
    });
    noteTwoDevices(at.store, at);
    await w.look(T + 610 * S);
    await w.stop();
    expect(closings()).toEqual([
      { id: expect.any(String), source: "devices", check_id: opened!.id, unconfirmed: false },
    ]);
  });

  it("closes a waiting check unconfirmed when a fresh AEAT answer disagrees", async () => {
    const at = await steppedBack();
    let aheadMs: number | null = null;
    const w = watch(at, () => (aheadMs === null ? null : truth(at, aheadMs)));
    await w.look(T);
    const [opened] = checks();
    at.clocks.skew = 0;
    await w.look(T + 15 * S);
    expect(count("clock_confirmations")).toBe(0);
    aheadMs = 10 * M;
    await w.look(T + 60 * S);
    await w.stop();
    expect(closings()).toEqual([
      { id: expect.any(String), source: "elapsed", check_id: opened!.id, unconfirmed: true },
    ]);
  });

  it("closes the waiting check unconfirmed and opens one new check when the clock steps back after a sale", async () => {
    const at = await steppedBack();
    const w = watch(at, () => null);
    await w.look(T);
    const [opened] = checks();
    at.clocks.skew = 0;
    await w.look(T + 15 * S);
    at.clocks.real = T + 20 * S;
    expect(await sale(at)).toBe(200);
    at.clocks.skew = -10 * M;
    await w.look(T + 30 * S);
    const closedAtTheNextLook = [
      { id: expect.any(String), source: "elapsed", check_id: opened!.id, unconfirmed: true },
    ];
    expect(checks()).toHaveLength(2);
    expect(closings()).toEqual(closedAtTheNextLook);
    await w.look(T + 45 * S);
    await w.stop();
    expect(checks()).toHaveLength(2);
    expect(checks()[0]!.id).toBe(opened!.id);
    expect(closings()).toEqual(closedAtTheNextLook);
  });

  it("keeps the same check open when the clock steps back again with no sale in between", async () => {
    const at = await steppedBack();
    const w = watch(at, () => null);
    await w.look(T);
    const [opened] = checks();
    at.clocks.skew = 0;
    await w.look(T + 15 * S);
    at.clocks.skew = -10 * M;
    await w.look(T + 30 * S);
    await w.stop();
    expect(checks().map((row) => row.id)).toEqual([opened!.id]);
    expect(count("clock_confirmations")).toBe(0);
  });

  // The sale at 08:00 was dated right. A look at 08:02 reads the clock 150 s slow, at 07:59:30:
  // within a minute of that sale, so no longer stopped, and the check waits.
  it.each([
    ["before the look reads the clock", "look"],
    ["while AEAT is asked", "ask"],
  ])(
    "closes a waiting check on the reading AEAT agreed with, listing nothing, when the clock is put right %s",
    async (_when, correctedAt) => {
      const at = await steppedBack();
      let correct = false;
      const w = watch(at, () => {
        if (!correct) return null;
        if (correctedAt === "ask") at.clocks.skew = 0;
        return truth(at);
      });
      await w.look(T);
      const [opened] = checks();
      at.clocks.skew = correctedAt === "look" ? 0 : -150 * S;
      correct = true;
      await w.look(T0 + 2 * M);
      await w.stop();
      const rows = closings();
      expect(rows).toEqual([
        { id: expect.any(String), source: "authority", check_id: opened!.id, unconfirmed: false },
      ]);
      const [row] = suite.db.all<{ confirmed_at: string }>(
        sql`select confirmed_at from clock_confirmations`,
      );
      expect(row!.confirmed_at).toBe(new Date(T0 + 2 * M).toISOString());
      const listed = await withTransaction(venue.db, (tx) =>
        venue.backend.misdatedRecords!(tx, rows[0]!.id),
      );
      expect(listed).toEqual({ known: true, records: [] });
    },
  );

  it("closes nothing and keeps the same check open when the clock steps back again while AEAT is asked, as the step drops the two devices' readings", async () => {
    const at = await steppedBack();
    let ask = false;
    const w = watch(at, () => {
      if (ask) at.clocks.skew = -10 * M;
      return null;
    });
    await w.look(T);
    const [opened] = checks();
    at.clocks.skew = 0;
    at.clocks.real = T0 + 2 * M;
    noteTwoDevices(at.store, at);
    ask = true;
    await w.look(T0 + 2 * M);
    expect(count("clock_confirmations")).toBe(0);
    await w.look(T0 + 2 * M + 15 * S);
    await w.stop();
    expect(checks().map((row) => row.id)).toEqual([opened!.id]);
    expect(count("clock_confirmations")).toBe(0);
  });

  // AEAT's disagreeing answer is kept across a clock step, so it is a witness either way; only the
  // reading the closing judges at decides whether the check still waits.
  it("closes nothing on AEAT disagreeing and keeps the same check open when the clock steps back into a stop while AEAT is asked", async () => {
    const at = await steppedBack();
    let ask = false;
    const w = watch(at, () => {
      if (!ask) return null;
      const sample = truth(at, 10 * M);
      at.clocks.skew = -10 * M;
      return sample;
    });
    await w.look(T);
    const [opened] = checks();
    at.clocks.skew = 0;
    ask = true;
    await w.look(T + 60 * S);
    await w.stop();
    expect(w.readAuthorityTime).toHaveBeenCalledTimes(2);
    expect(count("clock_confirmations")).toBe(0);
    expect(at.store.witnesses()).toContainEqual(expect.objectContaining({ kind: "authority" }));
    expect(checks().map((row) => row.id)).toEqual([opened!.id]);
    at.clocks.skew = 0;
    const waiting = await withTransaction(venue.db, (tx) =>
      venue.backend.waitingClockCheck!(tx, { instant: new Date(at.reading()), offsetMinutes: 60 }),
    );
    expect(waiting).toEqual({ checkId: opened!.id, openedAt: new Date(T - 10 * M).toISOString() });
  });

  it("closes a waiting check on the boot reading taken after AEAT answers, so the stop's start is when the check opened", async () => {
    const at = await steppedBack();
    let ask = false;
    const w = watch(at, () => {
      if (!ask) return null;
      at.clocks.real += 30 * S;
      return truth(at);
    });
    await w.look(T);
    const [opened] = checks();
    at.clocks.skew = 0;
    ask = true;
    await w.look(T + 60 * S);
    await w.stop();
    const [row] = suite.db.all<{ check_id: string; confirmed_at: string; proof: string }>(
      sql`select check_id, confirmed_at, proof from clock_confirmations`,
    );
    expect(row).toMatchObject({
      check_id: opened!.id,
      confirmed_at: new Date(T + 90 * S).toISOString(),
    });
    expect((JSON.parse(row!.proof) as { closing: Record<string, unknown> }).closing).toMatchObject({
      bootMs: BOOT_AT_T0 + 105 * S,
      correctedStart: new Date(T).toISOString(),
    });
  });
});
