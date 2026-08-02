import { describe, expect, it } from "vitest";
import {
  projectWorkSessions,
  summarisePeriod,
  type TimeEntryRecord,
  type WorkforceEntryKind,
} from "./projection.js";

let seq = 0;

/** A terse builder so a test reads as a sequence of clock events, not a wall of object literals.
 * `entryId`/`ingestSeq` auto-increment so callers only spell them out when a correction needs to
 * point at a specific row. */
function entry(
  personId: string,
  entryKind: WorkforceEntryKind,
  eventAt: string,
  opts: {
    locationId?: string;
    offsetMinutes?: number;
    entryId?: string;
    ingestSeq?: number;
    correctsEntryId?: string;
    correctionStatus?: "requested" | "approved";
  } = {},
): TimeEntryRecord {
  seq += 1;
  return {
    entryId: opts.entryId ?? `e${seq}`,
    personId,
    locationId: opts.locationId ?? "loc-1",
    entryKind,
    eventAt,
    offsetMinutes: opts.offsetMinutes ?? 0,
    ingestSeq: opts.ingestSeq ?? seq,
    correctsEntryId: opts.correctsEntryId,
    correctionStatus: opts.correctionStatus,
  };
}

describe("projectWorkSessions", () => {
  it("computes worked minutes for a single in→out shift", () => {
    const sessions = projectWorkSessions([
      entry("p1", "in", "2026-01-05T09:00:00Z"),
      entry("p1", "out", "2026-01-05T17:00:00Z"),
    ]);
    expect(sessions).toEqual([
      {
        personId: "p1",
        locationId: "loc-1",
        workDate: "2026-01-05",
        startedAt: "2026-01-05T09:00:00Z",
        endedAt: "2026-01-05T17:00:00Z",
        breakMinutes: 0,
        workedMinutes: 480,
      },
    ]);
  });

  it("subtracts a closed break from worked minutes", () => {
    const [session] = projectWorkSessions([
      entry("p1", "in", "2026-01-05T09:00:00Z"),
      entry("p1", "break_start", "2026-01-05T13:00:00Z"),
      entry("p1", "break_end", "2026-01-05T13:30:00Z"),
      entry("p1", "out", "2026-01-05T17:00:00Z"),
    ]);
    expect(session?.breakMinutes).toBe(30);
    expect(session?.workedMinutes).toBe(450);
  });

  it("sums multiple breaks within one shift", () => {
    const [session] = projectWorkSessions([
      entry("p1", "in", "2026-01-05T09:00:00Z"),
      entry("p1", "break_start", "2026-01-05T11:00:00Z"),
      entry("p1", "break_end", "2026-01-05T11:15:00Z"),
      entry("p1", "break_start", "2026-01-05T14:00:00Z"),
      entry("p1", "break_end", "2026-01-05T14:45:00Z"),
      entry("p1", "out", "2026-01-05T17:00:00Z"),
    ]);
    expect(session?.breakMinutes).toBe(60);
    expect(session?.workedMinutes).toBe(420);
  });

  it("derives the LOCAL calendar date from the wall offset, not UTC", () => {
    // 23:30Z at +60 is 00:30 the next day on the wall clock — the day the registro must record it
    // under (art. 34.9 is per-worker per-DAY, and the day is the worker's local day).
    const [session] = projectWorkSessions([
      entry("p1", "in", "2026-01-05T23:30:00Z", { offsetMinutes: 60 }),
      entry("p1", "out", "2026-01-06T02:30:00Z", { offsetMinutes: 60 }),
    ]);
    expect(session?.workDate).toBe("2026-01-06");
    expect(session?.workedMinutes).toBe(180);
  });

  it("orders out-of-order arrivals by event time before pairing (design §5: project by event_at)", () => {
    // Offline capture appends in ingest order, which need not be event-time order. The projection
    // sorts by event_at, so a late-arriving `in` still pairs with its `out`.
    const [session] = projectWorkSessions([
      entry("p1", "out", "2026-01-05T17:00:00Z"),
      entry("p1", "in", "2026-01-05T09:00:00Z"),
    ]);
    expect(session?.startedAt).toBe("2026-01-05T09:00:00Z");
    expect(session?.workedMinutes).toBe(480);
  });

  it("keeps each person's sessions separate", () => {
    const sessions = projectWorkSessions([
      entry("p1", "in", "2026-01-05T09:00:00Z"),
      entry("p2", "in", "2026-01-05T10:00:00Z"),
      entry("p1", "out", "2026-01-05T17:00:00Z"),
      entry("p2", "out", "2026-01-05T14:00:00Z"),
    ]);
    expect(sessions.map((s) => [s.personId, s.workedMinutes])).toEqual([
      ["p1", 480],
      ["p2", 240],
    ]);
  });

  it("ignores a break_start with no open shift", () => {
    expect(projectWorkSessions([entry("p1", "break_start", "2026-01-05T13:00:00Z")])).toEqual([]);
  });

  it("ignores a break_end with no open shift", () => {
    expect(projectWorkSessions([entry("p1", "break_end", "2026-01-05T13:00:00Z")])).toEqual([]);
  });

  it("ignores a break_end that has no matching break_start in the shift", () => {
    const [session] = projectWorkSessions([
      entry("p1", "in", "2026-01-05T09:00:00Z"),
      entry("p1", "break_end", "2026-01-05T13:00:00Z"),
      entry("p1", "out", "2026-01-05T17:00:00Z"),
    ]);
    expect(session?.breakMinutes).toBe(0);
    expect(session?.workedMinutes).toBe(480);
  });

  it("ignores an out with no open shift", () => {
    expect(projectWorkSessions([entry("p1", "out", "2026-01-05T17:00:00Z")])).toEqual([]);
  });
});

describe("projectWorkSessions applies corrections (reprojection, latest-approved-wins)", () => {
  it("supersedes a base event's timestamp with an approved correction", () => {
    // The canonical case (design §5): an out at 17:00 is corrected to 18:00. The reprojected
    // session shows the corrected end while the correction row is still present in the input
    // (history retained — nothing is removed).
    const out = entry("p1", "out", "2026-01-05T17:00:00Z", { entryId: "out-1" });
    const [session] = projectWorkSessions([
      entry("p1", "in", "2026-01-05T09:00:00Z"),
      out,
      entry("p1", "correction", "2026-01-05T18:00:00Z", {
        correctsEntryId: "out-1",
        correctionStatus: "approved",
      }),
    ]);
    expect(session?.endedAt).toBe("2026-01-05T18:00:00Z");
    expect(session?.workedMinutes).toBe(540);
  });

  it("ignores a requested (not yet approved) correction", () => {
    // A worker's request to contest is recorded but has no effect until a supervisor approves it —
    // the projection still reads the original 17:00 out.
    const [session] = projectWorkSessions([
      entry("p1", "in", "2026-01-05T09:00:00Z"),
      entry("p1", "out", "2026-01-05T17:00:00Z", { entryId: "out-1" }),
      entry("p1", "correction", "2026-01-05T18:00:00Z", {
        correctsEntryId: "out-1",
        correctionStatus: "requested",
      }),
    ]);
    expect(session?.endedAt).toBe("2026-01-05T17:00:00Z");
    expect(session?.workedMinutes).toBe(480);
  });

  it("lets the latest approved correction of the same entry win", () => {
    // Two approved corrections target the original out. Latest-correction-wins is highest ingestSeq
    // (append order), not latest event_at — so the 18:30 correction (seq 20) beats 18:00 (seq 10).
    const [session] = projectWorkSessions([
      entry("p1", "in", "2026-01-05T09:00:00Z", { ingestSeq: 1 }),
      entry("p1", "out", "2026-01-05T17:00:00Z", { entryId: "out-1", ingestSeq: 2 }),
      entry("p1", "correction", "2026-01-05T18:00:00Z", {
        entryId: "corr-1",
        ingestSeq: 10,
        correctsEntryId: "out-1",
        correctionStatus: "approved",
      }),
      entry("p1", "correction", "2026-01-05T18:30:00Z", {
        entryId: "corr-2",
        ingestSeq: 20,
        correctsEntryId: "out-1",
        correctionStatus: "approved",
      }),
    ]);
    expect(session?.endedAt).toBe("2026-01-05T18:30:00Z");
  });

  it("follows a chain — a correction that corrects an earlier correction", () => {
    // A correction is itself immutable and superseded by another (design §5). corr-2 corrects
    // corr-1 corrects the original out, so the effective end is corr-2's 18:45.
    const [session] = projectWorkSessions([
      entry("p1", "in", "2026-01-05T09:00:00Z", { ingestSeq: 1 }),
      entry("p1", "out", "2026-01-05T17:00:00Z", { entryId: "out-1", ingestSeq: 2 }),
      entry("p1", "correction", "2026-01-05T18:00:00Z", {
        entryId: "corr-1",
        ingestSeq: 10,
        correctsEntryId: "out-1",
        correctionStatus: "approved",
      }),
      entry("p1", "correction", "2026-01-05T18:45:00Z", {
        entryId: "corr-2",
        ingestSeq: 20,
        correctsEntryId: "corr-1",
        correctionStatus: "approved",
      }),
    ]);
    expect(session?.endedAt).toBe("2026-01-05T18:45:00Z");
  });

  it("corrects the start of a shift, not only the end", () => {
    const [session] = projectWorkSessions([
      entry("p1", "in", "2026-01-05T09:00:00Z", { entryId: "in-1" }),
      entry("p1", "out", "2026-01-05T17:00:00Z"),
      entry("p1", "correction", "2026-01-05T08:00:00Z", {
        correctsEntryId: "in-1",
        correctionStatus: "approved",
      }),
    ]);
    expect(session?.startedAt).toBe("2026-01-05T08:00:00Z");
    expect(session?.workedMinutes).toBe(540);
  });

  it("ignores an approved correction carrying no target id", () => {
    // A `correction` with no `correctsEntryId` targets nothing (the DB shape-check forbids the row,
    // so this only guards a malformed in-memory record) — it is skipped, and the original stands.
    const [session] = projectWorkSessions([
      entry("p1", "in", "2026-01-05T09:00:00Z"),
      entry("p1", "out", "2026-01-05T17:00:00Z"),
      entry("p1", "correction", "2026-01-05T18:00:00Z", { correctionStatus: "approved" }),
    ]);
    expect(session?.endedAt).toBe("2026-01-05T17:00:00Z");
  });

  it("ignores a correction whose target is not present (dangling)", () => {
    // A correction pointing at an id no base event or correction carries is never reached by any
    // walk, so it has no effect — the original 17:00 stands. Resolution walks FROM base events, so a
    // correction nothing chains to is inert.
    const [session] = projectWorkSessions([
      entry("p1", "in", "2026-01-05T09:00:00Z"),
      entry("p1", "out", "2026-01-05T17:00:00Z", { entryId: "out-1" }),
      entry("p1", "correction", "2026-01-05T18:00:00Z", {
        correctsEntryId: "ghost",
        correctionStatus: "approved",
      }),
    ]);
    expect(session?.endedAt).toBe("2026-01-05T17:00:00Z");
  });
});

describe("summarisePeriod (overtime = actual − contracted, per pay period)", () => {
  const week = { start: "2026-01-05", end: "2026-01-12" }; // half-open, one Mon→Sun week

  function nineHourDay(personId: string, date: string): TimeEntryRecord[] {
    return [
      entry(personId, "in", `${date}T08:00:00Z`),
      entry(personId, "out", `${date}T17:00:00Z`),
    ];
  }

  it("reports overtime as worked minus contracted when the worker went over", () => {
    // Five 9h days = 2700 worked minutes against a 40h (2400) contracted week → 300 overtime.
    const sessions = projectWorkSessions([
      ...nineHourDay("p1", "2026-01-05"),
      ...nineHourDay("p1", "2026-01-06"),
      ...nineHourDay("p1", "2026-01-07"),
      ...nineHourDay("p1", "2026-01-08"),
      ...nineHourDay("p1", "2026-01-09"),
    ]);
    expect(summarisePeriod(sessions, week, 2400)).toEqual({
      workedMinutes: 2700,
      contractedMinutes: 2400,
      overtimeMinutes: 300,
    });
  });

  it("clamps overtime at zero when the worker was under contracted hours", () => {
    // Undertime is not negative overtime — art. 35.5 counts horas extraordinarias, not a deficit.
    const sessions = projectWorkSessions(nineHourDay("p1", "2026-01-05"));
    expect(summarisePeriod(sessions, week, 2400)).toEqual({
      workedMinutes: 540,
      contractedMinutes: 2400,
      overtimeMinutes: 0,
    });
  });

  it("counts only sessions inside the half-open period", () => {
    const sessions = projectWorkSessions([
      ...nineHourDay("p1", "2026-01-04"), // day before the period start — excluded
      ...nineHourDay("p1", "2026-01-05"), // first day of the period — included
      ...nineHourDay("p1", "2026-01-12"), // period end is exclusive — excluded
    ]);
    expect(summarisePeriod(sessions, week, 2400).workedMinutes).toBe(540);
  });
});
