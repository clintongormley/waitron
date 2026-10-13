import { expect, it } from "vitest";
import { jobOrigin } from "@waitron/shared";
import { projectTimeRecord } from "./record-projection.js";
import type { PayPeriodClosure } from "./record-types.js";
import type { TimeEntryRecord } from "./projection.js";

const january = { start: "2026-01-01", end: "2026-02-01" };
const row = (
  entryId: string,
  entryKind: TimeEntryRecord["entryKind"],
  hour: string,
  sequenceNo: number,
  patch: Partial<TimeEntryRecord> = {},
): TimeEntryRecord => ({
  entryId,
  entryKind,
  personId: "worker",
  locationId: "venue",
  nodeId: "box",
  eventAt: `2026-01-05T${hour}:00:00.000Z`,
  recordedAt: "2026-01-05T20:00:00.000Z",
  sequenceNo,
  offsetMinutes: 0,
  recordedByPersonId: "worker",
  origin: jobOrigin("dashboard"),
  extension: {
    authorKind: "worker",
    direction: null,
    missingEntryKind: null,
    respondsToEntryId: null,
    payPeriodClosureId: null,
  },
  ...patch,
});
const start = row("in", "in", "09", 1),
  end = row("out", "out", "17", 2);
function closure(entries: TimeEntryRecord[] = [start, end]): PayPeriodClosure {
  const record = projectTimeRecord(entries);
  return {
    id: "closed-january",
    nodeId: "box",
    locationId: "venue",
    period: january,
    clock: { timeZone: "UTC", dayCutover: "06:00", cutoverChanges: [] },
    scheduledCloseAt: "2026-02-01T06:00:00.000Z",
    closedAt: "2026-02-01T06:00:00.000Z",
    sequenceNo: 1,
    prevClosureHash: null,
    closureHash: "A".repeat(64),
    snapshot: {
      sessions: record.sessions,
      entries: record.entries,
      summaries: [{ personId: "worker", summary: null }],
      countedAutomaticEntryIds: [],
    },
  };
}
const change = row("change", "correction", "18", 3, {
  correctsEntryId: "out",
  correctionStatus: "approved",
  recordedByPersonId: "manager",
  recordedAt: "2026-03-05T12:00:00.000Z",
  correctionReason: "Later departure",
  extension: {
    authorKind: "manager",
    direction: "worker_request",
    missingEntryKind: null,
    respondsToEntryId: null,
    payPeriodClosureId: null,
  },
});
it("keeps a frozen 480-minute snapshot and reports the later 60-minute amendment", () => {
  const frozen = closure(),
    before = JSON.stringify(frozen);
  const record = projectTimeRecord([start, end, change], [frozen]);
  expect(record.sessions[0]!.workedMinutes).toBe(540);
  expect(record.closures).toHaveLength(1);
  expect(record.closures[0]).toMatchObject({
    closureId: "closed-january",
    closureHash: "A".repeat(64),
  });
  expect(record.closures[0]!.snapshot.sessions[0]!.workedMinutes).toBe(480);
  expect(record.closedPeriodImpacts).toEqual([
    {
      closureId: "closed-january",
      personId: "worker",
      beforeWorkedMinutes: 480,
      afterWorkedMinutes: 540,
      deltaWorkedMinutes: 60,
    },
  ]);
  expect(record.entries.map((e) => e.closedPeriodIds)).toEqual([
    ["closed-january"],
    ["closed-january"],
    ["closed-january"],
  ]);
  expect(JSON.stringify(frozen)).toBe(before);
});
it("reports a zero-minute dispute amendment and keeps the competing value", () => {
  const disputed = { ...change, correctionStatus: "disputed" as const };
  const record = projectTimeRecord([start, end, disputed], [closure()]);
  expect(record.closedPeriodImpacts).toEqual([
    {
      closureId: "closed-january",
      personId: "worker",
      beforeWorkedMinutes: 480,
      afterWorkedMinutes: 480,
      deltaWorkedMinutes: 0,
    },
  ]);
  expect(record.entries.find((e) => e.entry.entryId === "change")).toMatchObject({
    disputed: true,
    effective: false,
    closedPeriodIds: ["closed-january"],
  });
});
it("reports both closed periods when a session moves between months", () => {
  const february = {
    ...closure([]),
    id: "closed-february",
    period: { start: "2026-02-01", end: "2026-03-01" },
  };
  const changedStart = {
    ...change,
    entryId: "changed-in",
    correctsEntryId: "in",
    eventAt: "2026-02-05T09:00:00.000Z",
    sequenceNo: 4,
  };
  const changedEnd = { ...change, eventAt: "2026-02-05T17:00:00.000Z" };
  const record = projectTimeRecord([start, end, changedEnd, changedStart], [closure(), february]);
  expect(record.closedPeriodImpacts).toEqual([
    {
      closureId: "closed-january",
      personId: "worker",
      beforeWorkedMinutes: 480,
      afterWorkedMinutes: 0,
      deltaWorkedMinutes: -480,
    },
    {
      closureId: "closed-february",
      personId: "worker",
      beforeWorkedMinutes: 0,
      afterWorkedMinutes: 480,
      deltaWorkedMinutes: 480,
    },
  ]);
  expect(record.entries.find((e) => e.entry.entryId === "change")!.closedPeriodIds).toEqual([
    "closed-january",
    "closed-february",
  ]);
});
it("does not invent an amendment for unchanged or unrelated records", () => {
  expect(projectTimeRecord([start, end], [closure()]).closedPeriodImpacts).toEqual([]);
  const elsewhere = [start, end, change].map((e) => ({ ...e, locationId: "other-venue" }));
  const record = projectTimeRecord([...elsewhere, start, end], [closure()]);
  expect(record.closedPeriodImpacts).toEqual([]);
  expect(
    record.entries
      .filter((e) => e.entry.locationId === "other-venue")
      .every((e) => e.closedPeriodIds.length === 0),
  ).toBe(true);
});
it("reports a later worker confirmation without turning the original automatic author into a worker", () => {
  const automatic = {
    ...end,
    recordedByPersonId: null,
    extension: { ...end.extension!, authorKind: "automatic" as const },
  };
  const marker = row("marker", "confirmation", "17", 3, {
    recordedByPersonId: null,
    extension: {
      ...automatic.extension,
      respondsToEntryId: "out",
      payPeriodClosureId: "closed-january",
    },
  });
  const frozen = closure([start, automatic, marker]);
  frozen.snapshot.countedAutomaticEntryIds = ["out"];
  const confirmed = row("confirmed", "confirmation", "17", 4, {
    recordedAt: "2026-03-05T12:00:00.000Z",
    extension: { ...end.extension!, respondsToEntryId: "out" },
  });
  const record = projectTimeRecord([start, automatic, marker, confirmed], [frozen]);
  expect(record.closedPeriodImpacts).toEqual([
    {
      closureId: "closed-january",
      personId: "worker",
      beforeWorkedMinutes: 480,
      afterWorkedMinutes: 480,
      deltaWorkedMinutes: 0,
    },
  ]);
  expect(record.entries.find((e) => e.entry.entryId === "out")).toMatchObject({
    author: { kind: "automatic", personId: null },
    confirmed: true,
  });
});
