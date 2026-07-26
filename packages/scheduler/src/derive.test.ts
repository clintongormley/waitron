import { describe, expect, it } from "vitest";
import {
  DAY_MS,
  dayPeriod,
  derive,
  horizonStartFor,
  mostRecentCompleteDay,
  utcDayStart,
  type LedgerRow,
  type LedgerSnapshot,
} from "./derive.js";

describe("utcDayStart", () => {
  it("floors a mid-day instant to midnight UTC", () => {
    expect(utcDayStart(new Date("2026-07-24T13:45:12.345Z"))).toEqual(
      new Date("2026-07-24T00:00:00.000Z"),
    );
  });

  it("is a fixed point at midnight", () => {
    const midnight = new Date("2026-07-24T00:00:00.000Z");
    expect(utcDayStart(midnight)).toEqual(midnight);
  });
});

describe("dayPeriod", () => {
  it("is half-open over exactly one day", () => {
    expect(dayPeriod(new Date("2026-07-24T00:00:00Z"))).toEqual({
      from: new Date("2026-07-24T00:00:00Z"),
      to: new Date("2026-07-25T00:00:00Z"),
    });
  });

  // A UTC day is always 86_400_000ms — no DST to shorten or lengthen it. This is the whole reason
  // the cadence is UTC-tiled rather than tenant-local: a local day is not a fixed width, and no
  // timezone column exists on tenants or locations to derive one from.
  it("spans a constant width across a European DST boundary", () => {
    const period = dayPeriod(new Date("2026-10-25T00:00:00Z"));
    expect(period.to.getTime() - period.from.getTime()).toBe(DAY_MS);
  });
});

describe("mostRecentCompleteDay", () => {
  it("is yesterday for a mid-day now", () => {
    expect(mostRecentCompleteDay(new Date("2026-07-25T13:00:00Z"))).toEqual(
      new Date("2026-07-24T00:00:00Z"),
    );
  });

  // At exactly midnight, yesterday's period_to equals now — and eligibility is `period_to <= now`,
  // so it IS complete. Off-by-one here would skip a day on any host that ticks on the hour.
  it("is yesterday at exactly midnight, whose period ends exactly at now", () => {
    const now = new Date("2026-07-25T00:00:00Z");
    const day = mostRecentCompleteDay(now);
    expect(day).toEqual(new Date("2026-07-24T00:00:00Z"));
    expect(dayPeriod(day).to.getTime()).toBe(now.getTime());
  });
});

const NOW = new Date("2026-07-25T04:00:00Z");

describe("horizonStartFor", () => {
  // The one instant `run.ts`'s snapshot read and `derive`'s own gap loop must agree on. Pinned as
  // a day boundary, not an offset from `now`: a `now`-relative window would slide every tick and
  // the oldest gap day would flicker in and out of the horizon within a single day.
  it("is a whole number of days back from the UTC day start, not from `now`", () => {
    expect(horizonStartFor(NOW, 30)).toEqual(new Date("2026-06-25T00:00:00.000Z"));
    expect(horizonStartFor(new Date("2026-07-25T23:59:59.999Z"), 30)).toEqual(
      new Date("2026-06-25T00:00:00.000Z"),
    );
  });

  it("is today's start at a zero-day horizon", () => {
    expect(horizonStartFor(NOW, 0)).toEqual(new Date("2026-07-25T00:00:00.000Z"));
  });
});

const CONFIG = { horizonDays: 30, maxPeriodsPerTick: 7, staleAfterMs: 3_600_000 };

function row(overrides: Partial<LedgerRow> & { periodFrom: string }): LedgerRow {
  return {
    id: `id-${overrides.periodFrom}`,
    generation: 0,
    state: "succeeded",
    attempts: 1,
    nextAttemptAt: null,
    startedAt: null,
    periodTo: new Date(new Date(overrides.periodFrom).getTime() + DAY_MS).toISOString(),
    ...overrides,
  };
}

function snapshot(rows: LedgerRow[], recordedBelowHorizon = 0): LedgerSnapshot {
  const earliest = rows.length === 0 ? null : rows.map((r) => r.periodFrom).sort()[0]!;
  return { rows, earliestPeriodFrom: earliest, recordedBelowHorizon };
}

describe("derive: a duty that has never run", () => {
  // The floor for a duty with no rows is the most recent complete period, NOT the horizon: you
  // cannot have missed periods before you existed. Otherwise day one runs thirty empty sweeps.
  it("starts from the most recent complete period, not the horizon", () => {
    const result = derive(snapshot([]), NOW, CONFIG);
    expect(result.due).toHaveLength(1);
    expect(result.due[0]).toEqual({
      kind: "gap",
      period: dayPeriod(new Date("2026-07-24T00:00:00Z")),
    });
    expect(result.beyondHorizon).toBe(0);
    expect(result.deferred).toBe(0);
  });
});

describe("derive: gaps", () => {
  it("finds nothing when the most recent complete period already succeeded", () => {
    const result = derive(snapshot([row({ periodFrom: "2026-07-24T00:00:00.000Z" })]), NOW, CONFIG);
    expect(result.due).toEqual([]);
  });

  it("finds every missing day between the floor and the most recent complete one", () => {
    const result = derive(snapshot([row({ periodFrom: "2026-07-21T00:00:00.000Z" })]), NOW, CONFIG);
    expect(result.due.map((w) => w.kind)).toEqual(["gap", "gap", "gap"]);
    expect(result.due.map((w) => (w.kind === "gap" ? w.period.from.toISOString() : ""))).toEqual([
      "2026-07-22T00:00:00.000Z",
      "2026-07-23T00:00:00.000Z",
      "2026-07-24T00:00:00.000Z",
    ]);
  });

  it("caps the tick oldest-first and reports what it deferred", () => {
    const result = derive(snapshot([row({ periodFrom: "2026-07-01T00:00:00.000Z" })]), NOW, {
      ...CONFIG,
      maxPeriodsPerTick: 2,
    });
    expect(result.due).toHaveLength(2);
    expect(result.due.map((w) => (w.kind === "gap" ? w.period.from.toISOString() : ""))).toEqual([
      "2026-07-02T00:00:00.000Z",
      "2026-07-03T00:00:00.000Z",
    ]);
    expect(result.deferred).toBe(21);
  });

  // A duty broken for longer than the horizon loses those periods for good. The result must SAY
  // so — reading as full coverage is the silent failure this ledger exists to prevent.
  it("reports never-swept days that fell off the horizon and never runs them", () => {
    const result = derive(
      snapshot([row({ periodFrom: "2026-05-01T00:00:00.000Z" })], 1),
      NOW,
      CONFIG,
    );
    // Floor 2026-05-01, horizon start 2026-06-25: 55 days below the horizon, 1 of them recorded.
    expect(result.beyondHorizon).toBe(54);
    const earliestRun = result.due[0];
    expect(earliestRun?.kind === "gap" && earliestRun.period.from.toISOString()).toBe(
      "2026-06-25T00:00:00.000Z",
    );
  });
});

describe("derive: claimable rows", () => {
  it("returns a failed row whose backoff has elapsed", () => {
    const failed = row({
      periodFrom: "2026-07-24T00:00:00.000Z",
      state: "failed",
      attempts: 1,
      nextAttemptAt: "2026-07-25T03:00:00.000Z",
    });
    const result = derive(snapshot([failed]), NOW, CONFIG);
    expect(result.due).toEqual([{ kind: "claimable", row: failed }]);
  });

  it("leaves a failed row alone until its backoff elapses", () => {
    const result = derive(
      snapshot([
        row({
          periodFrom: "2026-07-24T00:00:00.000Z",
          state: "failed",
          attempts: 1,
          nextAttemptAt: "2026-07-25T05:00:00.000Z",
        }),
      ]),
      NOW,
      CONFIG,
    );
    expect(result.due).toEqual([]);
    expect(result.nextDueAt).toEqual(new Date("2026-07-25T05:00:00.000Z"));
  });

  it("returns a pending re-sweep whose due time has arrived, however old its period", () => {
    // Generation 1 over a period far below the horizon. A re-sweep is EXPLICIT work, so the
    // horizon — which bounds gap derivation only — must not bury it.
    const pending = row({
      periodFrom: "2026-01-02T00:00:00.000Z",
      generation: 1,
      state: "pending",
      attempts: 0,
      nextAttemptAt: "2026-07-25T03:00:00.000Z",
    });
    const result = derive(snapshot([pending], 1), NOW, CONFIG);
    expect(result.due).toContainEqual({ kind: "claimable", row: pending });
  });

  // `TERMINAL.includes(r.state) ||` could be deleted outright with this suite staying green: every
  // terminal row in every other fixture also has `nextAttemptAt: null`, so the SECOND disjunct
  // covered for the first and the state guard was never the thing doing the work. A terminal row
  // with a live `next_attempt_at` is not hypothetical — `completeRun` writes null on success and
  // on park, but the column is nullable, nothing in the schema ties it to the state, and a future
  // writer that left one behind must not resurrect a finished run.
  it("never returns a terminal row, however claimable its next_attempt_at looks", () => {
    const result = derive(
      snapshot([
        row({
          periodFrom: "2026-07-23T00:00:00.000Z",
          state: "succeeded",
          attempts: 1,
          nextAttemptAt: "2026-07-25T03:00:00.000Z",
        }),
        row({
          periodFrom: "2026-07-24T00:00:00.000Z",
          state: "parked",
          attempts: 3,
          nextAttemptAt: "2026-07-25T03:00:00.000Z",
        }),
      ]),
      NOW,
      CONFIG,
    );
    expect(result.due).toEqual([]);
  });

  it("never returns a parked row", () => {
    const result = derive(
      snapshot([
        row({
          periodFrom: "2026-07-24T00:00:00.000Z",
          state: "parked",
          attempts: 3,
          nextAttemptAt: null,
        }),
      ]),
      NOW,
      CONFIG,
    );
    expect(result.due).toEqual([]);
  });
});

describe("derive: stale claims", () => {
  // Without this, a process crashed mid-run locks that period FOREVER — and no gap reveals it,
  // because the row exists. It is the ledger's own worst failure mode.
  it("reclaims a running row stranded past staleAfterMs", () => {
    const stranded = row({
      periodFrom: "2026-07-24T00:00:00.000Z",
      state: "running",
      attempts: 1,
      startedAt: "2026-07-25T02:00:00.000Z",
    });
    const result = derive(snapshot([stranded]), NOW, CONFIG);
    expect(result.due).toEqual([{ kind: "stale", row: stranded }]);
  });

  it("leaves a running row alone inside staleAfterMs", () => {
    const result = derive(
      snapshot([
        row({
          periodFrom: "2026-07-24T00:00:00.000Z",
          state: "running",
          attempts: 1,
          startedAt: "2026-07-25T03:30:00.000Z",
        }),
      ]),
      NOW,
      CONFIG,
    );
    expect(result.due).toEqual([]);
  });
});

describe("derive: nextDueAt", () => {
  it("is the next day boundary when nothing else is pending", () => {
    const result = derive(snapshot([row({ periodFrom: "2026-07-24T00:00:00.000Z" })]), NOW, CONFIG);
    expect(result.nextDueAt).toEqual(new Date("2026-07-26T00:00:00.000Z"));
  });

  it("is the earliest of the next boundary and a future backoff", () => {
    const result = derive(
      snapshot([
        row({
          periodFrom: "2026-07-24T00:00:00.000Z",
          state: "failed",
          attempts: 1,
          nextAttemptAt: "2026-07-25T06:00:00.000Z",
        }),
      ]),
      NOW,
      CONFIG,
    );
    expect(result.nextDueAt).toEqual(new Date("2026-07-25T06:00:00.000Z"));
  });
});
