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

/** A terse builder so a test reads as a sequence of clock events, not a wall of object literals.
 * `entryId`/`ingestSeq`/`sequenceNo` auto-increment (all off the same counter, so they agree in
 * append order by default — normal operation) and callers only spell them out when a correction
 * needs a specific row or when a test deliberately makes the two orderings DISAGREE. */
function entry(
  personId: string,
  entryKind: WorkforceEntryKind,
  eventAt: string,
  opts: {
    locationId?: string;
    offsetMinutes?: number;
    entryId?: string;
    ingestSeq?: number;
    sequenceNo?: number;
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
    sequenceNo: opts.sequenceNo ?? seq,
    correctsEntryId: opts.correctsEntryId,
    correctionStatus: opts.correctionStatus,
  };
}

describe("localWallClock", () => {
  it("renders the local time with a +01:00 offset, crossing into the next day (art. 34.9 concrete local start)", () => {
    // 23:30Z at +60 is 00:30 the next day on the wall clock — the concrete local start a human reads,
    // with the offset kept so the instant stays recoverable.
    expect(localWallClock("2026-01-05T23:30:00Z", 60)).toBe("2026-01-06T00:30:00+01:00");
  });

  it("renders a summer +02:00 (CEST) offset", () => {
    // A July event carries +120: local = instant + its own offset, so no timezone lookup is needed.
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
    // 23:30Z at +60 is 00:30 the next day on the wall clock — the day the registro must record it
    // under (art. 34.9 is per-worker per-DAY, and the day is the worker's local day).
    const [session] = projectWorkSessions([
      entry("p1", "in", "2026-01-05T23:30:00Z", { offsetMinutes: 60 }),
      entry("p1", "out", "2026-01-06T02:30:00Z", { offsetMinutes: 60 }),
    ]);
    expect(session?.workDate).toBe("2026-01-06");
    expect(session?.workedMinutes).toBe(180);
  });

  it("carries each end's wall offset while startedAt/endedAt stay the UTC instants", () => {
    // The offset is captured per event, so the session must keep BOTH ends' offsets for the local
    // render — startedAt/endedAt remain the raw UTC instants (the local time is derived, not stored).
    // A non-zero offset here is exactly the blind spot that hid the UTC-vs-local export bug: the
    // existing shift tests use offset 0, where the local and UTC renders look identical.
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
    // Europe/Madrid fall-back night (2026-10-25): clocks go 03:00 CEST → 02:00 CET, so 02:30 local
    // happens twice. In at 02:30 CEST (00:30Z, +120), out at 02:30 CET (01:30Z, +60). The two ends
    // carry DIFFERENT offsets — do NOT assume one offset per session. workedMinutes must be the true
    // elapsed UTC hour (60), NOT the 0-minute wall-clock difference; the offset is what disambiguates
    // the repeated hour in the render.
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
    // Same wall-clock time, different offset — the whole point of carrying the offset per end.
    expect(inRender.slice(0, 19)).toBe(outRender.slice(0, 19));
    expect(session?.startOffsetMinutes).not.toBe(session?.endOffsetMinutes);
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
    // Two approved corrections target the original out. Latest-correction-wins is highest sequenceNo
    // (the tamper-evident append position), not latest event_at — so the 18:30 correction (seq 4)
    // beats 18:00 (seq 3). This is the NORMAL case where append order and ingest order AGREE
    // (ingestSeq ascends with sequenceNo); the disagree test below is what pins the tie-break to
    // sequenceNo specifically.
    const [session] = projectWorkSessions([
      entry("p1", "in", "2026-01-05T09:00:00Z", { ingestSeq: 1, sequenceNo: 1 }),
      entry("p1", "out", "2026-01-05T17:00:00Z", { entryId: "out-1", ingestSeq: 2, sequenceNo: 2 }),
      entry("p1", "correction", "2026-01-05T18:00:00Z", {
        entryId: "corr-1",
        ingestSeq: 10,
        sequenceNo: 3,
        correctsEntryId: "out-1",
        correctionStatus: "approved",
      }),
      entry("p1", "correction", "2026-01-05T18:30:00Z", {
        entryId: "corr-2",
        ingestSeq: 20,
        sequenceNo: 4,
        correctsEntryId: "out-1",
        correctionStatus: "approved",
      }),
    ]);
    expect(session?.endedAt).toBe("2026-01-05T18:30:00Z");
  });

  it("breaks a correction tie on the hashed sequenceNo, not the unhashed ingestSeq", () => {
    // Tamper-evidence teeth-test (same class as Task B: the chain must protect the ordering it
    // claims to). `ingest_seq` is GENERATED ALWAYS AS IDENTITY and is NOT in the chain hash
    // (chain-hash.ts hashes `sequence_no`), so a party past the immutability floor could SWAP two
    // approved corrections' `ingest_seq` and flip which corrected time is effective while
    // `verifyChain` still returns ok. Here the two orderings DISAGREE — the 18:00 correction carries
    // the HIGHER ingestSeq (20) but the LOWER sequenceNo (3), the 18:30 one the LOWER ingestSeq (10)
    // but the HIGHER sequenceNo (4) — modelling that post-swap state. The tamper-evident answer is
    // the higher sequenceNo (18:30); an ingestSeq tie-break would pick 18:00. Because the answers
    // genuinely disagree, this measures which field the tie-break uses (CLAUDE.md §1: a test whose
    // two answers cannot differ measures nothing).
    const [session] = projectWorkSessions([
      entry("p1", "in", "2026-01-05T09:00:00Z", { ingestSeq: 1, sequenceNo: 1 }),
      entry("p1", "out", "2026-01-05T17:00:00Z", { entryId: "out-1", ingestSeq: 2, sequenceNo: 2 }),
      entry("p1", "correction", "2026-01-05T18:00:00Z", {
        entryId: "corr-high-ingest",
        ingestSeq: 20,
        sequenceNo: 3,
        correctsEntryId: "out-1",
        correctionStatus: "approved",
      }),
      entry("p1", "correction", "2026-01-05T18:30:00Z", {
        entryId: "corr-high-sequence",
        ingestSeq: 10,
        sequenceNo: 4,
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

describe("dailyContractedTargetMinutes (a contracted daily target over N working days)", () => {
  it("divides the contracted week by the supplied working-days count", () => {
    // 2400 min/week ÷ 5 working days = 480 (an 8h day). Five is D2's convenio_config default, no
    // longer a module constant — it is passed in from the resolved WorkTimeRuleset.
    expect(dailyContractedTargetMinutes(2400, 5)).toBe(480);
  });

  it("rounds to the nearest whole minute", () => {
    // 2403 ÷ 5 = 480.6 → 481. Proves Math.round, not a floor/trunc that would silently under-target.
    expect(dailyContractedTargetMinutes(2403, 5)).toBe(481);
  });

  it("divides by the supplied working-days count, not a hard-coded 5", () => {
    // 2400 ÷ 6 = 400. Proves working_days_per_week is a PARAMETER (D2 convenio_config), not the
    // `DEFAULT_WORKING_DAYS_PER_WEEK = 5` module constant it replaced — a caller with a 6-day week
    // gets 400, not 480. This is the de-hard-coding teeth-test.
    expect(dailyContractedTargetMinutes(2400, 6)).toBe(400);
  });

  it("rejects a non-positive working-days count instead of returning Infinity/NaN", () => {
    // Defence in depth: convenio_config's CHECK pins the denominator to 1..7, but this helper is on
    // the public barrel, so a 0/negative/NaN divisor throws rather than silently yielding Infinity
    // or NaN (which would corrupt the overtime target). One `> 0` guard covers all three.
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
    // Five 9h days = 2700 worked against a 40h (2400) week. A regular Mon–Fri worker with every day
    // 60 over its 8h target: daily-accrual (5×60) and period-net (2700−2400) AGREE at 300 here — the
    // two models only diverge under irregular distribution (the divergence test below).
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
    // THE teeth-test (ET art. 35 vs art. 34.2). Day 1 runs 60 over the 8h target; day 2 runs 60
    // under it. Daily-accrual counts the day-1 hora extraordinaria and NEVER nets the day-2 short
    // day against it → 60. Period-net (worked 960 vs a 960 baseline) lets them cancel → 0. The two
    // figures MUST disagree here, which is what proves both are computed rather than one aliasing the
    // other (CLAUDE.md §1: a test where the answers can't disagree measures nothing).
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
    // Two 5h sessions on the SAME day (a turno partido) = 600 worked minutes that day, 120 over the
    // 8h target. Computed per session it would be max(0, 300−480)=0 twice; the daily model must sum
    // the day first, so this proves the per-DAY aggregation, not per-session.
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
    // Undertime is a deficit, not negative overtime (art. 35.5 counts horas extraordinarias). One 9h
    // day against a 2400 baseline nets to 0 — but the daily model still flags the day's 60-min excess,
    // so the two legitimately disagree even here.
    const sessions = projectWorkSessions(nineHourDay("p1", "2026-01-05"));
    const summary = summarisePeriod(sessions, week, eightHourDay);
    expect(summary.periodNetOvertimeMinutes).toBe(0);
    expect(summary.dailyAccrualOvertimeMinutes).toBe(60);
  });

  it("selects the headline figure via an explicit model parameter, defaulting to daily-accrual", () => {
    // The headline `overtimeMinutes` is a conservative DEFAULT (daily-accrual), never the authoritative
    // figure — which model is binding is convenio-driven (an asesor-laboral decision). A caller may
    // pick period-net explicitly.
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
