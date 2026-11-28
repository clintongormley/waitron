import { expect, it } from "vitest";
import type { AttendanceDayView } from "@waitron/workforce/attendance-contract";
import type { TimeEntryRecord } from "@waitron/workforce/projection";
import { attendanceEntry } from "../../test/attendance-fixtures.js";
import type { TillClockState } from "../api/attendance-api.js";
import { clockOutPreview } from "./clock-out-preview.js";

const date = "2026-01-05";
const personId = "worker";
const first = "2026-01-05T09:00:00.000Z";
const second = "2026-01-05T19:00:00.000Z";
const pause = "2026-01-05T23:10:00.000Z";

function day(entries: [TimeEntryRecord["entryKind"], string][]): AttendanceDayView {
  return {
    personId,
    date,
    timeZone: "Europe/Madrid",
    revision: "revision",
    paidBreakPolicy: { thresholdMinutes: 300, allowanceMinutes: 20, splitGapMinutes: 90 },
    record: {
      sessions: [],
      closures: [],
      closedPeriodImpacts: [],
      entries: entries.map(([entryKind, eventAt], index) => ({
        entry: attendanceEntry({
          entryId: String(index),
          entryKind,
          eventAt,
          recordedAt: eventAt,
          sequenceNo: index,
          offsetMinutes: 60,
          extension: null,
        }),
        author: { kind: "worker", personId },
        effective: true,
        confirmed: true,
        confirmedByWorker: false,
        selfApproved: false,
        corrected: false,
        disputed: false,
        closedPeriodIds: [],
      })),
    },
    items: [],
  };
}

const working: TillClockState = {
  personId,
  businessDay: date,
  state: "working",
  lastEntryId: "current",
  firstClockIn: false,
  shiftStart: { eventAt: second, offsetMinutes: 60 },
  breakStart: null,
};

it("adds the overnight part of a split day and applies the paid break policy", () => {
  const view = day([
    ["in", first],
    ["out", "2026-01-05T11:00:00.000Z"],
    ["in", second],
    ["break_start", pause],
    ["break_end", "2026-01-05T23:40:00.000Z"],
  ]);
  const end = "2026-01-06T01:00:00.000Z";
  const result = clockOutPreview(view, working, new Date(end));
  expect(
    result?.map((s) => [s.workDate, s.startedAt, s.endedAt, s.breakMinutes, s.workedMinutes]),
  ).toEqual([
    [date, first, "2026-01-05T11:00:00.000Z", 0, 120],
    [date, second, end, 30, 350],
  ]);
  expect(view.record.entries.map(({ entry }) => entry.entryKind)).toEqual([
    "in",
    "out",
    "in",
    "break_start",
    "break_end",
  ]);
});

it("counts a running break up to the proposed clock-out", () => {
  const view = day([
    ["in", second],
    ["break_start", pause],
  ]);
  const onBreak: TillClockState = {
    ...working,
    state: "on_break",
    breakStart: { eventAt: pause, offsetMinutes: 60 },
  };
  expect(clockOutPreview(view, onBreak, new Date("2026-01-05T23:40:00.000Z"))).toMatchObject([
    { breakMinutes: 30, workedMinutes: 250 },
  ]);
});

it("uses the unavailable summary when a manager moved the clock-in onto a different date", () => {
  const view = day([["in", second]]);
  const entry = view.record.entries[0]!;
  view.record.entries.push({
    ...entry,
    entry: {
      ...entry.entry,
      entryId: "correction",
      entryKind: "correction",
      correctionStatus: "approved",
      correctsEntryId: entry.entry.entryId,
      eventAt: "2026-01-05T23:20:00.000Z",
    },
  });
  expect(clockOutPreview(view, working, new Date("2026-01-06T01:00:00.000Z"))).toBeNull();
});
