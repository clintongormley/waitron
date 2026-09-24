import { describe, expect, it } from "vitest";
import {
  dailyContractedTargetMinutes,
  localWallClock,
  projectWorkSessions,
  summarisePeriod,
  type TimeEntryRecord,
  type WorkforceEntryKind,
} from "./projection.js";

let seq = 0;

/** `entryId`, `sequenceNo` and `recordedAt` ascend together by default, on one node; a cross-node
 * case spells them out. */
function entry(
  personId: string,
  entryKind: WorkforceEntryKind,
  eventAt: string,
  opts: {
    locationId?: string;
    nodeId?: string;
    offsetMinutes?: number;
    entryId?: string;
    recordedAt?: string;
    sequenceNo?: number;
    correctsEntryId?: string;
    correctionStatus?: "requested" | "approved";
  } = {},
): TimeEntryRecord {
  seq += 1;
  const sequenceNo = opts.sequenceNo ?? seq;
  return {
    entryId: opts.entryId ?? `e${seq}`,
    personId,
    locationId: opts.locationId ?? "loc-1",
    nodeId: opts.nodeId ?? "node-1",
    entryKind,
    eventAt,
    recordedAt:
      opts.recordedAt ??
      new Date(Date.parse("2026-01-01T00:00:00Z") + sequenceNo * 1000).toISOString(),
    offsetMinutes: opts.offsetMinutes ?? 0,
    sequenceNo,
    correctsEntryId: opts.correctsEntryId,
    correctionStatus: opts.correctionStatus,
  };
}

describe("localWallClock", () => {
  it("renders the local time with a +01:00 offset, crossing into the next day (art. 34.9 concrete local start)", () => {
    expect(localWallClock("2026-01-05T23:30:00Z", 60)).toBe("2026-01-06T00:30:00+01:00");
  });

  it("renders a summer +02:00 (CEST) offset", () => {
    expect(localWallClock("2026-07-05T22:30:00Z", 120)).toBe("2026-07-06T00:30:00+02:00");
  });

  it("renders a negative offset as -HH:MM", () => {
    expect(localWallClock("2026-01-05T12:00:00Z", -300)).toBe("2026-01-05T07:00:00-05:00");
  });

  it("renders a zero offset as +00:00 (UTC)", () => {
    expect(localWallClock("2026-01-05T09:00:00Z", 0)).toBe("2026-01-05T09:00:00+00:00");
  });
});

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
        startOffsetMinutes: 0,
        endedAt: "2026-01-05T17:00:00Z",
        endOffsetMinutes: 0,
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
    // Art. 34.9 files by the worker's local day.
    const [session] = projectWorkSessions([
      entry("p1", "in", "2026-01-05T23:30:00Z", { offsetMinutes: 60 }),
      entry("p1", "out", "2026-01-06T02:30:00Z", { offsetMinutes: 60 }),
    ]);
    expect(session?.workDate).toBe("2026-01-06");
    expect(session?.workedMinutes).toBe(180);
  });

  it("carries each end's wall offset while startedAt/endedAt stay the UTC instants", () => {
    // A non-zero offset: at offset 0 the local and UTC renders look identical.
    const [session] = projectWorkSessions([
      entry("p1", "in", "2026-01-05T23:30:00Z", { offsetMinutes: 60 }),
      entry("p1", "out", "2026-01-06T02:30:00Z", { offsetMinutes: 60 }),
    ]);
    expect(session?.startedAt).toBe("2026-01-05T23:30:00Z");
    expect(session?.endedAt).toBe("2026-01-06T02:30:00Z");
    expect(session?.startOffsetMinutes).toBe(60);
    expect(session?.endOffsetMinutes).toBe(60);
  });

  it("carries different offsets across a DST fall-back while workedMinutes stays true UTC elapsed", () => {
    // Madrid fall-back night: 02:30 local happens twice, once at +120 and once at +60. Worked time is
    // the true elapsed hour, not the 0-minute wall-clock difference.
    const [session] = projectWorkSessions([
      entry("p1", "in", "2026-10-25T00:30:00Z", { offsetMinutes: 120 }),
      entry("p1", "out", "2026-10-25T01:30:00Z", { offsetMinutes: 60 }),
    ]);
    expect(session?.startOffsetMinutes).toBe(120);
    expect(session?.endOffsetMinutes).toBe(60);
    expect(session?.workedMinutes).toBe(60);
    const inRender = localWallClock(session!.startedAt, session!.startOffsetMinutes);
    const outRender = localWallClock(session!.endedAt, session!.endOffsetMinutes);
    expect(inRender).toBe("2026-10-25T02:30:00+02:00");
    expect(outRender).toBe("2026-10-25T02:30:00+01:00");
    expect(inRender.slice(0, 19)).toBe(outRender.slice(0, 19));
    expect(session?.startOffsetMinutes).not.toBe(session?.endOffsetMinutes);
  });

  it("orders out-of-order arrivals by event time before pairing (design §5: project by event_at)", () => {
    // Offline capture appends in ingest order, which need not be event-time order.
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

  it("lets the latest approved correction of the same entry win (single chain reduces to sequenceNo-max)", () => {
    // Single chain: recordedAt ascends with sequenceNo, so seq 4 (18:30) beats seq 3 (18:00).
    const [session] = projectWorkSessions([
      entry("p1", "in", "2026-01-05T09:00:00Z", { sequenceNo: 1 }),
      entry("p1", "out", "2026-01-05T17:00:00Z", { entryId: "out-1", sequenceNo: 2 }),
      entry("p1", "correction", "2026-01-05T18:00:00Z", {
        entryId: "corr-1",
        sequenceNo: 3,
        correctsEntryId: "out-1",
        correctionStatus: "approved",
      }),
      entry("p1", "correction", "2026-01-05T18:30:00Z", {
        entryId: "corr-2",
        sequenceNo: 4,
        correctsEntryId: "out-1",
        correctionStatus: "approved",
      }),
    ]);
    expect(session?.endedAt).toBe("2026-01-05T18:30:00Z");
  });

  it("picks the correction with the greatest (recordedAt, nodeId, sequenceNo) across nodes — later recorded_at wins", () => {
    // Precedence is (recordedAt, nodeId, sequenceNo). The box's correction has the higher
    // sequenceNo but was recorded earlier, so a sequenceNo-only rule would give a different answer.
    const [session] = projectWorkSessions([
      entry("p1", "in", "2026-01-05T09:00:00Z", { sequenceNo: 1 }),
      entry("p1", "out", "2026-01-05T17:00:00Z", { entryId: "out-1", sequenceNo: 2 }),
      entry("p1", "correction", "2026-01-05T18:05:00Z", {
        entryId: "corr-box",
        nodeId: "node-A",
        sequenceNo: 9,
        recordedAt: "2026-01-05T10:05:00Z",
        correctsEntryId: "out-1",
        correctionStatus: "approved",
      }),
      entry("p1", "correction", "2026-01-05T18:20:00Z", {
        entryId: "corr-cloud",
        nodeId: "node-B",
        sequenceNo: 2,
        recordedAt: "2026-01-05T10:06:00Z",
        correctsEntryId: "out-1",
        correctionStatus: "approved",
      }),
    ]);
    expect(session?.endedAt).toBe("2026-01-05T18:20:00Z");
  });

  it("breaks a same-recorded_at cross-node tie on nodeId (before sequenceNo)", () => {
    // recorded_at ties, so nodeId decides: node-B wins despite the lower sequenceNo.
    const [session] = projectWorkSessions([
      entry("p1", "in", "2026-01-05T09:00:00Z", { sequenceNo: 1 }),
      entry("p1", "out", "2026-01-05T17:00:00Z", { entryId: "out-1", sequenceNo: 2 }),
      entry("p1", "correction", "2026-01-05T18:05:00Z", {
        entryId: "corr-A",
        nodeId: "node-A",
        sequenceNo: 9,
        recordedAt: "2026-01-05T10:05:00Z",
        correctsEntryId: "out-1",
        correctionStatus: "approved",
      }),
      entry("p1", "correction", "2026-01-05T18:20:00Z", {
        entryId: "corr-B",
        nodeId: "node-B",
        sequenceNo: 2,
        recordedAt: "2026-01-05T10:05:00Z",
        correctsEntryId: "out-1",
        correctionStatus: "approved",
      }),
    ]);
    expect(session?.endedAt).toBe("2026-01-05T18:20:00Z");
  });

  it("breaks a same-node, same-recorded_at tie on sequenceNo (the last key)", () => {
    // Same chain, same second: recordedAt and nodeId tie, so sequenceNo decides.
    const [session] = projectWorkSessions([
      entry("p1", "in", "2026-01-05T09:00:00Z", { sequenceNo: 1 }),
      entry("p1", "out", "2026-01-05T17:00:00Z", { entryId: "out-1", sequenceNo: 2 }),
      entry("p1", "correction", "2026-01-05T18:00:00Z", {
        entryId: "corr-lo",
        sequenceNo: 3,
        recordedAt: "2026-01-05T10:05:00Z",
        correctsEntryId: "out-1",
        correctionStatus: "approved",
      }),
      entry("p1", "correction", "2026-01-05T18:30:00Z", {
        entryId: "corr-hi",
        sequenceNo: 4,
        recordedAt: "2026-01-05T10:05:00Z",
        correctsEntryId: "out-1",
        correctionStatus: "approved",
      }),
    ]);
    expect(session?.endedAt).toBe("2026-01-05T18:30:00Z");
  });

  it("follows a chain — a correction that corrects an earlier correction", () => {
    // corr-2 corrects corr-1, which corrects the original out.
    const [session] = projectWorkSessions([
      entry("p1", "in", "2026-01-05T09:00:00Z", {}),
      entry("p1", "out", "2026-01-05T17:00:00Z", { entryId: "out-1" }),
      entry("p1", "correction", "2026-01-05T18:00:00Z", {
        entryId: "corr-1",
        correctsEntryId: "out-1",
        correctionStatus: "approved",
      }),
      entry("p1", "correction", "2026-01-05T18:45:00Z", {
        entryId: "corr-2",
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
    // The DB shape check forbids this row; this guards a malformed in-memory record.
    const [session] = projectWorkSessions([
      entry("p1", "in", "2026-01-05T09:00:00Z"),
      entry("p1", "out", "2026-01-05T17:00:00Z"),
      entry("p1", "correction", "2026-01-05T18:00:00Z", { correctionStatus: "approved" }),
    ]);
    expect(session?.endedAt).toBe("2026-01-05T17:00:00Z");
  });

  it("ignores a correction whose target is not present (dangling)", () => {
    // Resolution walks FROM base events, so a correction nothing chains to is inert.
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

describe("dailyContractedTargetMinutes (a contracted daily target over N working days)", () => {
  it("divides the contracted week by the supplied working-days count", () => {
    expect(dailyContractedTargetMinutes(2400, 5)).toBe(480);
  });

  it("rounds to the nearest whole minute", () => {
    // Math.round, not a floor that would under-target.
    expect(dailyContractedTargetMinutes(2403, 5)).toBe(481);
  });

  it("divides by the supplied working-days count, not a hard-coded 5", () => {
    expect(dailyContractedTargetMinutes(2400, 6)).toBe(400);
  });

  it("rejects a non-positive working-days count instead of returning Infinity/NaN", () => {
    // `convenio_config`'s CHECK pins the divisor to 1..7, but this helper is public, so a bad divisor
    // throws rather than yielding Infinity or NaN.
    expect(() => dailyContractedTargetMinutes(2400, 0)).toThrow(/must be positive/);
    expect(() => dailyContractedTargetMinutes(2400, -5)).toThrow(/received -5/);
    expect(() => dailyContractedTargetMinutes(2400, Number.NaN)).toThrow(/must be positive/);
  });
});

describe("summarisePeriod (BOTH overtime models, side by side)", () => {
  const week = { start: "2026-01-05", end: "2026-01-12" }; // half-open, one Mon→Sun week
  const eightHourDay = { periodMinutes: 2400, dailyTargetMinutes: 480 };

  function nineHourDay(personId: string, date: string): TimeEntryRecord[] {
    return [
      entry(personId, "in", `${date}T08:00:00Z`),
      entry(personId, "out", `${date}T17:00:00Z`),
    ];
  }

  it("reports both overtime figures and the per-day breakdown for a regular over-week", () => {
    // Every day runs 60 over its target, so the two models agree here.
    const sessions = projectWorkSessions([
      ...nineHourDay("p1", "2026-01-05"),
      ...nineHourDay("p1", "2026-01-06"),
      ...nineHourDay("p1", "2026-01-07"),
      ...nineHourDay("p1", "2026-01-08"),
      ...nineHourDay("p1", "2026-01-09"),
    ]);
    expect(summarisePeriod(sessions, week, eightHourDay)).toEqual({
      workedMinutes: 2700,
      contractedMinutes: 2400,
      dailyAccrualOvertimeMinutes: 300,
      periodNetOvertimeMinutes: 300,
      overtimeMinutes: 300,
      days: ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09"].map(
        (workDate) => ({
          workDate,
          workedMinutes: 540,
          contractedTargetMinutes: 480,
          overtimeMinutes: 60,
        }),
      ),
    });
  });

  it("diverges: a 9h day then a 7h day is 1h daily-accrual but 0 period-net (8h target)", () => {
    // Day 1 runs 60 over the target, day 2 60 under: daily-accrual never nets them (60), period-net
    // does (0), so the two figures must disagree.
    const sessions = projectWorkSessions([
      entry("p1", "in", "2026-01-05T08:00:00Z"), // 9h
      entry("p1", "out", "2026-01-05T17:00:00Z"),
      entry("p1", "in", "2026-01-06T09:00:00Z"), // 7h
      entry("p1", "out", "2026-01-06T16:00:00Z"),
    ]);
    const summary = summarisePeriod(sessions, week, {
      periodMinutes: 960,
      dailyTargetMinutes: 480,
    });
    expect(summary.dailyAccrualOvertimeMinutes).toBe(60);
    expect(summary.periodNetOvertimeMinutes).toBe(0);
    expect(summary.dailyAccrualOvertimeMinutes).not.toBe(summary.periodNetOvertimeMinutes);
    expect(summary.days).toEqual([
      {
        workDate: "2026-01-05",
        workedMinutes: 540,
        contractedTargetMinutes: 480,
        overtimeMinutes: 60,
      },
      {
        workDate: "2026-01-06",
        workedMinutes: 420,
        contractedTargetMinutes: 480,
        overtimeMinutes: 0,
      },
    ]);
  });

  it("aggregates a split shift's sessions into one day before the daily target applies", () => {
    // A split shift: per session it would be 0 twice; the daily model sums the day first.
    const sessions = projectWorkSessions([
      entry("p1", "in", "2026-01-05T08:00:00Z"),
      entry("p1", "out", "2026-01-05T13:00:00Z"), // 5h
      entry("p1", "in", "2026-01-05T15:00:00Z"),
      entry("p1", "out", "2026-01-05T20:00:00Z"), // 5h
    ]);
    const summary = summarisePeriod(sessions, week, eightHourDay);
    expect(summary.dailyAccrualOvertimeMinutes).toBe(120);
    expect(summary.days).toEqual([
      {
        workDate: "2026-01-05",
        workedMinutes: 600,
        contractedTargetMinutes: 480,
        overtimeMinutes: 120,
      },
    ]);
  });

  it("clamps period-net overtime at zero when total worked is under the scaled baseline", () => {
    // Undertime is a deficit, not negative overtime (art. 35.5).
    const sessions = projectWorkSessions(nineHourDay("p1", "2026-01-05"));
    const summary = summarisePeriod(sessions, week, eightHourDay);
    expect(summary.periodNetOvertimeMinutes).toBe(0);
    expect(summary.dailyAccrualOvertimeMinutes).toBe(60);
  });

  it("selects the headline figure via an explicit model parameter, defaulting to daily-accrual", () => {
    // Which model is binding is a collective-agreement decision; daily-accrual is the conservative
    // default.
    const sessions = projectWorkSessions([
      entry("p1", "in", "2026-01-05T08:00:00Z"),
      entry("p1", "out", "2026-01-05T17:00:00Z"),
      entry("p1", "in", "2026-01-06T09:00:00Z"),
      entry("p1", "out", "2026-01-06T16:00:00Z"),
    ]);
    const contracted = { periodMinutes: 960, dailyTargetMinutes: 480 };
    expect(summarisePeriod(sessions, week, contracted).overtimeMinutes).toBe(60);
    expect(summarisePeriod(sessions, week, contracted, "daily-accrual").overtimeMinutes).toBe(60);
    expect(summarisePeriod(sessions, week, contracted, "period-net").overtimeMinutes).toBe(0);
  });

  it("counts only sessions inside the half-open period", () => {
    const sessions = projectWorkSessions([
      ...nineHourDay("p1", "2026-01-04"), // day before the period start — excluded
      ...nineHourDay("p1", "2026-01-05"), // first day of the period — included
      ...nineHourDay("p1", "2026-01-12"), // period end is exclusive — excluded
    ]);
    const summary = summarisePeriod(sessions, week, eightHourDay);
    expect(summary.workedMinutes).toBe(540);
    expect(summary.days).toEqual([
      {
        workDate: "2026-01-05",
        workedMinutes: 540,
        contractedTargetMinutes: 480,
        overtimeMinutes: 60,
      },
    ]);
  });
});
