import { describe, expect, it } from "vitest";
import {
  dueRun,
  matchRecorded,
  occurrenceKey,
  recordedRun,
  type DueDay,
} from "./floor-layout-due.js";
import { serviceRuns } from "./menu-timetable.js";
import { minuteOfServiceDay, withExtension, type ServiceRange } from "./service-day.js";
import type { ServiceDayContext } from "./service-day-context.js";

const CUTOVER = "06:00";
const context: ServiceDayContext = {
  dayCutover: CUTOVER,
  startAt: "2026-10-16T04:00:00.000Z",
  endAt: "2026-10-17T04:00:00.000Z",
  endMinute: 1440,
};
const range = (periodId: string, startsAt: string, endsAt: string): ServiceRange => ({
  periodId,
  startsAt,
  endsAt,
});
const L = (startsAt = "13:00", endsAt = "16:00") => range("lunch", startsAt, endsAt);
const D = (startsAt = "20:00", endsAt = "23:30") => range("dinner", startsAt, endsAt);
const Bar = (startsAt: string, endsAt: string) => range("bar", startsAt, endsAt);
const day = (painted: ServiceRange[], extension: ServiceRange | null = null): DueDay => ({
  painted,
  extension,
  runs: serviceRuns(withExtension(painted, extension, CUTOVER)),
});
const at = (time: string) => minuteOfServiceDay(time, CUTOVER);
const record = (periodId: string, startsAt: string) => ({ periodId, startsAt });
const due = (
  dueDay: DueDay,
  time: string,
  recorded: { periodId: string; startsAt: string } | null = null,
) => dueRun({ day: dueDay, minute: at(time), context, recorded });
const standard = () => day([L(), D()]);

describe("dueRun", () => {
  it("is the running run", () => {
    expect(due(standard(), "14:00")).toEqual(L());
  });

  it("is the next run once one ends", () => {
    expect(due(standard(), "16:00", record("lunch", "13:00"))).toEqual(D());
  });

  it("follows keep open made before the end", () => {
    const kept = day([L(), D()], L("16:00", "16:45"));
    expect(due(kept, "16:30", record("lunch", "13:00"))).toEqual(L("13:00", "16:45"));
    expect(due(kept, "16:45", record("lunch", "13:00"))).toEqual(D());
  });

  it("never goes back to a period reopened after its end", () => {
    const kept = day([L(), D()], L("16:00", "17:00"));
    expect(due(kept, "16:10", record("dinner", "20:00"))).toEqual(D());
  });

  it("comes back after a reopened period ends when nobody updated", () => {
    const kept = day([L(), D()], L("16:00", "17:00"));
    expect(due(kept, "16:10", record("lunch", "13:00"))).toEqual(L("13:00", "17:00"));
    expect(due(kept, "17:00", record("lunch", "13:00"))).toEqual(D());
  });

  it("takes a later run of the same period", () => {
    const bar = day([Bar("10:00", "13:00"), L(), Bar("16:00", "23:00")]);
    expect(due(bar, "16:00", record("lunch", "13:00"))).toEqual(Bar("16:00", "23:00"));
  });

  it("counts a run past midnight as late", () => {
    const night = day([L(), range("night", "22:00", "02:00")]);
    expect(due(night, "01:00", record("night", "22:00"))).toEqual(range("night", "22:00", "02:00"));
    expect(due(night, "03:00", record("night", "22:00"))).toEqual(range("night", "22:00", "02:00"));
  });

  it("holds a recorded run past midnight against a period reopened in the afternoon", () => {
    const late = range("late", "00:30", "02:00");
    const kept = day([L(), late], L("16:00", "17:00"));
    expect(due(kept, "16:10", record("late", "00:30"))).toEqual(late);
  });

  it("is the last run after the day's last ends", () => {
    expect(due(standard(), "23:45")).toEqual(D());
  });

  it("is the next run before the day's first starts", () => {
    expect(due(standard(), "07:00")).toEqual(L());
  });

  it("is null on a day with no period", () => {
    expect(due(day([]), "14:00")).toBeNull();
  });

  it("ignores a record whose run is gone", () => {
    expect(due(standard(), "14:30", record("lunch", "14:00"))).toEqual(L());
  });

  it("keeps a run whose start a keep open pushed later", () => {
    const kept = day([L(), D()], L("16:00", "20:30"));
    expect(kept.runs).toEqual([L("13:00", "20:30"), D("20:30", "23:30")]);
    expect(due(kept, "16:10", record("dinner", "20:00"))).toEqual(D("20:30", "23:30"));
    expect(matchRecorded(kept, record("dinner", "20:00"), context)).toEqual(D("20:30", "23:30"));
  });

  it("a repaint is not a keep open", () => {
    const repainted = day([L("10:00", "13:00"), Bar("16:00", "23:00")]);
    expect(matchRecorded(repainted, record("bar", "10:00"), context)).toBeNull();
    expect(due(repainted, "11:00", record("bar", "10:00"))).toEqual(L("10:00", "13:00"));
  });
});

describe("matchRecorded", () => {
  it("is the run of the recorded period starting at the recorded time", () => {
    expect(matchRecorded(standard(), record("dinner", "20:00"), context)).toEqual(D());
  });

  it("is gone when the keep open does not cover the recorded start", () => {
    const kept = day([L(), D()], L("16:00", "17:00"));
    expect(matchRecorded(kept, record("dinner", "21:00"), context)).toBeNull();
  });

  it("is gone when the painted range of the period ended inside the keep open", () => {
    const kept = day([L(), D("17:00", "18:00"), D("18:30", "23:30")], L("16:00", "18:30"));
    expect(kept.runs).toEqual([L("13:00", "18:30"), D("18:30", "23:30")]);
    expect(matchRecorded(kept, record("dinner", "17:00"), context)).toBeNull();
  });

  it("is gone when no painted range of the period started at the recorded time", () => {
    const kept = day([L(), D()], L("16:00", "20:30"));
    expect(matchRecorded(kept, record("dinner", "19:00"), context)).toBeNull();
  });
  it("is gone when the keep open joins the recorded run into an earlier one", () => {
    const kept = day([L(), L("20:00", "23:30")], L("16:00", "20:30"));
    expect(kept.runs).toEqual([L("13:00", "23:30")]);
    expect(matchRecorded(kept, record("lunch", "20:00"), context)).toBeNull();
  });
});

describe("recordedRun", () => {
  const key = occurrenceKey("dept", "2026-10-16", D());

  it("reads today's key", () => {
    expect(recordedRun(key, "dept", "2026-10-16")).toEqual({
      periodId: "dinner",
      startsAt: "20:00",
    });
  });

  it("is null for another department", () => {
    expect(recordedRun(key, "other", "2026-10-16")).toBeNull();
  });

  it("is null for yesterday's key", () => {
    expect(recordedRun(key, "dept", "2026-10-17")).toBeNull();
  });

  it("is null for what is not a key", () => {
    expect(recordedRun("[1,2", "dept", "2026-10-16")).toBeNull();
    expect(recordedRun(null, "dept", "2026-10-16")).toBeNull();
    expect(recordedRun("[1,2,3,4]", "dept", "2026-10-16")).toBeNull();
    expect(recordedRun('["dept","2026-10-16","dinner"]', "dept", "2026-10-16")).toBeNull();
    expect(recordedRun('{"a":1}', "dept", "2026-10-16")).toBeNull();
  });
});
