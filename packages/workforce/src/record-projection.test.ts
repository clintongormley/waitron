import { describe, expect, it } from "vitest";
import * as projection from "./index.js";
import { projectWorkSessions, type TimeEntryRecord } from "./projection.js";
import { jobOrigin } from "@waitron/shared";
import { uncountedAutomaticEntryIds } from "./effective-entries.js";
const author = (kind: "worker" | "manager" | "automatic" = "worker") => ({
  authorKind: kind,
  direction: null,
  missingEntryKind: null,
  respondsToEntryId: null,
  payPeriodClosureId: null,
});
function entry(
  entryId: string,
  entryKind: TimeEntryRecord["entryKind"],
  eventAt: string,
  patch: Partial<TimeEntryRecord> = {},
): TimeEntryRecord {
  return {
    entryId,
    entryKind,
    eventAt,
    personId: "worker",
    locationId: "venue",
    nodeId: "box",
    recordedAt: "2026-01-05T20:00:00.000Z",
    offsetMinutes: 0,
    sequenceNo: 1,
    recordedByPersonId: "worker",
    origin: jobOrigin("dashboard"),
    extension: author(),
    ...patch,
  };
}
const start = entry("in", "in", "2026-01-05T09:00:00.000Z");
const end = entry("out", "out", "2026-01-05T17:00:00.000Z", { sequenceNo: 2 });
const automatic = entry("automatic", "out", end.eventAt, {
  sequenceNo: 2,
  recordedByPersonId: null,
  extension: author("automatic"),
});
const request = entry("request", "correction", "2026-01-05T18:00:00.000Z", {
  sequenceNo: 3,
  correctsEntryId: end.entryId,
  correctionStatus: "requested",
  recordedByPersonId: "manager",
  correctionActorId: "manager",
  correctionReason: "Later departure",
  extension: { ...author("manager"), direction: "manager_proposal" },
});
const answer = entry("answer", "correction", request.eventAt, {
  sequenceNo: 4,
  correctsEntryId: end.entryId,
  correctionStatus: "approved",
  correctionActorId: "worker",
  correctionReason: "Later departure",
  extension: { ...author(), direction: "manager_proposal", respondsToEntryId: request.entryId },
});
describe("inspectable record projection", () => {
  it("resolves a large batch of confirmations without rescanning every prior entry for each answer", () => {
    let idReads = 0;
    const rows: TimeEntryRecord[] = [];
    for (let i = 0; i < 1000; i++) {
      const end = entry(`automatic-${i}`, "out", automatic.eventAt, {
        personId: `worker-${i}`,
        recordedByPersonId: null,
        extension: author("automatic"),
      });
      rows.push(
        end,
        entry(`confirmed-${i}`, "confirmation", automatic.eventAt, {
          personId: end.personId,
          recordedByPersonId: end.personId,
          extension: { ...author(), respondsToEntryId: end.entryId },
        }),
      );
    }
    for (const row of rows) {
      const id = row.entryId;
      Object.defineProperty(row, "entryId", {
        get: () => {
          idReads++;
          return id;
        },
        enumerable: true,
      });
    }
    expect([...uncountedAutomaticEntryIds(rows)]).toEqual([]);
    expect(idReads).toBeLessThan(20000);
  });
  it("keeps a manager proposal pending then exposes all versions and distinct authors on acceptance", () => {
    expect(projection.projectTimeRecord([start, end, request]).sessions[0]!.workedMinutes).toBe(
      480,
    );
    const record = projection.projectTimeRecord([start, end, request, answer]);
    expect(record.sessions[0]!.workedMinutes).toBe(540);
    expect(
      record.entries.map((e) => [e.entry.entryId, e.author, e.effective, e.corrected]),
    ).toEqual([
      ["in", { kind: "worker", personId: "worker" }, true, false],
      ["out", { kind: "worker", personId: "worker" }, false, true],
      ["request", { kind: "manager", personId: "manager" }, false, true],
      ["answer", { kind: "worker", personId: "worker" }, true, true],
    ]);
  });
  it("keeps a disagreement and its competing value without contributing time", () => {
    const dispute = {
      ...answer,
      correctionStatus: "disputed" as const,
      correctionReason: "I left at five",
    };
    const record = projection.projectTimeRecord([start, end, request, dispute]);
    expect(record.sessions[0]!.workedMinutes).toBe(480);
    expect(record.entries.filter((e) => e.disputed).map((e) => e.entry.entryId)).toEqual([
      "out",
      "request",
      "answer",
    ]);
    expect(record.entries.find((e) => e.entry.entryId === "answer")).toMatchObject({
      effective: false,
      entry: { eventAt: "2026-01-05T18:00:00.000Z", correctionReason: "I left at five" },
    });
  });
  it("can mark an agreed correction and a later competing dispute together", () => {
    const rival = {
      ...request,
      entryId: "rival",
      sequenceNo: 5,
      eventAt: "2026-01-05T19:00:00.000Z",
    };
    const dispute = {
      ...answer,
      entryId: "dispute",
      sequenceNo: 6,
      eventAt: rival.eventAt,
      correctionStatus: "disputed" as const,
      extension: { ...answer.extension!, respondsToEntryId: rival.entryId },
    };
    const record = projection.projectTimeRecord([start, end, request, answer, rival, dispute]);
    expect(record.sessions[0]!.workedMinutes).toBe(540);
    expect(record.entries.find((e) => e.entry.entryId === "out")).toMatchObject({
      corrected: true,
      disputed: true,
      effective: false,
    });
  });
  it("shows an unanswered automatic end without an effective session, then retains its author on confirmation", () => {
    const pending = projection.projectTimeRecord([start, automatic]);
    expect(pending.sessions).toEqual([]);
    expect(pending.entries[1]).toMatchObject({
      author: { kind: "automatic", personId: null },
      confirmed: false,
      effective: false,
    });
    const confirmation = entry("confirm", "confirmation", automatic.eventAt, {
      sequenceNo: 3,
      extension: { ...author(), respondsToEntryId: automatic.entryId },
    });
    const record = projection.projectTimeRecord([start, automatic, confirmation]);
    expect(record.sessions[0]!.workedMinutes).toBe(480);
    expect(record.entries.find((e) => e.entry.entryId === automatic.entryId)).toMatchObject({
      author: { kind: "automatic", personId: null },
      confirmed: true,
      effective: true,
    });
  });
  it.each(["requested", "declined", "disputed"] as const)(
    "keeps an automatic end uncounted with a %s correction",
    (correctionStatus) => {
      const change = { ...request, correctsEntryId: automatic.entryId, correctionStatus };
      expect(projection.projectTimeRecord([start, automatic, change]).sessions).toEqual([]);
    },
  );
  it("counts an approved supplied start and end once with their pending requests still inspectable", () => {
    const missingIn = entry("missing-in", "correction", start.eventAt, {
      correctionStatus: "requested",
      correctionReason: "Forgot",
      extension: { ...author(), direction: "worker_request", missingEntryKind: "in" },
    });
    const missingOut = entry("missing-out", "correction", end.eventAt, {
      sequenceNo: 2,
      correctionStatus: "requested",
      correctionReason: "Forgot",
      extension: { ...author(), direction: "worker_request", missingEntryKind: "out" },
    });
    const approvedIn = {
      ...missingIn,
      entryId: "accepted-in",
      sequenceNo: 3,
      correctionStatus: "approved" as const,
      recordedByPersonId: "manager",
      extension: {
        ...missingIn.extension!,
        authorKind: "manager" as const,
        respondsToEntryId: missingIn.entryId,
      },
    };
    const approvedOut = {
      ...missingOut,
      entryId: "accepted-out",
      sequenceNo: 4,
      correctionStatus: "approved" as const,
      recordedByPersonId: "manager",
      extension: {
        ...missingOut.extension!,
        authorKind: "manager" as const,
        respondsToEntryId: missingOut.entryId,
      },
    };
    const record = projection.projectTimeRecord([missingIn, missingOut, approvedIn, approvedOut]);
    expect(record.sessions).toHaveLength(1);
    expect(record.sessions[0]!.workedMinutes).toBe(480);
    expect(record.entries.filter((e) => e.effective).map((e) => e.entry.entryId)).toEqual([
      "accepted-in",
      "accepted-out",
    ]);
  });
  it.each(["personId", "locationId"] as const)(
    "does not follow a correction or confirmation into another %s",
    (field) => {
      const foreign = { ...answer, [field]: "other" };
      expect(
        projection.projectTimeRecord([start, end, request, foreign]).sessions[0]!.workedMinutes,
      ).toBe(480);
      const foreignConfirmation = entry("confirm", "confirmation", automatic.eventAt, {
        [field]: "other",
        extension: { ...author(), respondsToEntryId: automatic.entryId },
      });
      expect(
        projection.projectTimeRecord([start, automatic, foreignConfirmation]).sessions,
      ).toEqual([]);
    },
  );
  it("refuses incomplete authorship without changing the basic session-only projection", () => {
    const basic = [
      { ...start, extension: null, recordedByPersonId: undefined },
      { ...end, extension: null, recordedByPersonId: undefined },
    ];
    expect(projectWorkSessions(basic)[0]!.workedMinutes).toBe(480);
    expect(() => projection.projectTimeRecord(basic)).toThrow(
      expect.objectContaining({ code: "attendance.invalid" }),
    );
  });
  it("returns the same record for shuffled rows, including equal event timestamps", () => {
    const rows = [start, end, request, answer];
    expect(projection.projectTimeRecord([answer, request, end, start])).toEqual(
      projection.projectTimeRecord(rows),
    );
    const equal = [start, { ...end, eventAt: start.eventAt }];
    expect(projection.projectTimeRecord([...equal].reverse())).toEqual(
      projection.projectTimeRecord(equal),
    );
    expect(projection.projectTimeRecord(equal).sessions[0]!.workedMinutes).toBe(0);
  });
});
