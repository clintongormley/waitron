import type { AttendanceInbox, AttendancePrompt, CorrectionItem } from "../src/api/client.js";
type TimeEntryRecord = AttendancePrompt["history"][number];

export function attendanceEntry(patch: Partial<TimeEntryRecord> = {}): TimeEntryRecord {
  return {
    entryId: "automatic-out",
    personId: "worker",
    locationId: "deli",
    nodeId: "node",
    entryKind: "out",
    eventAt: "2026-10-13T23:30:00.000Z",
    recordedAt: "2026-10-14T03:00:00.000Z",
    offsetMinutes: 120,
    sequenceNo: 2,
    recordedByPersonId: null,
    origin: { source: "operator_script", deviceId: null },
    extension: {
      authorKind: "automatic",
      direction: null,
      missingEntryKind: null,
      respondsToEntryId: null,
      payPeriodClosureId: null,
    },
    ...patch,
  };
}
export function attendancePrompt(patch: Partial<AttendancePrompt> = {}): AttendancePrompt {
  const prompt: AttendancePrompt = {
    id: "question",
    questionId: "question",
    itemId: null,
    personId: "worker",
    locationId: "deli",
    locationName: "The deli",
    businessDay: "2026-10-13",
    day: {
      businessDay: "2026-10-13",
      locationId: "deli",
      startAt: "2026-10-13T03:00:00.000Z",
      endAt: "2026-10-14T03:00:00.000Z",
    },
    kind: "automatic-out",
    automaticEntryId: "automatic-out",
    missingKinds: [],
    timeZone: "America/New_York",
    history: [attendanceEntry()],
    ...patch,
  };
  prompt.history = prompt.history.map((entry) => ({
    ...entry,
    personId: prompt.personId,
    locationId: prompt.locationId,
    recordedByPersonId:
      entry.recordedByPersonId === "worker" ? prompt.personId : entry.recordedByPersonId,
  }));
  return prompt;
}
export function attendanceItem(patch: Partial<CorrectionItem> = {}): CorrectionItem {
  const item: CorrectionItem = {
    id: "proposal",
    requestEntryIds: ["proposed-out"],
    personId: "worker",
    locationId: "deli",
    direction: "manager_proposal",
    status: "waiting-worker",
    readyToApply: true,
    responseEntryIds: [],
    changes: [
      { target: { entryId: "original-out" }, at: "2026-10-13T16:00:00.000Z", offsetMinutes: 120 },
    ],
    reason: "Finished the stock count",
    requestedByPersonId: "manager",
    selfApproved: false,
    history: [
      attendanceEntry({
        entryId: "original-out",
        eventAt: "2026-10-13T15:00:00.000Z",
        recordedByPersonId: "worker",
        extension: {
          authorKind: "worker",
          direction: null,
          missingEntryKind: null,
          respondsToEntryId: null,
          payPeriodClosureId: null,
        },
      }),
      attendanceEntry({
        entryId: "proposed-out",
        entryKind: "correction",
        eventAt: "2026-10-13T16:00:00.000Z",
        recordedByPersonId: "manager",
        correctsEntryId: "original-out",
        correctionStatus: "requested",
        correctionReason: "Finished the stock count",
        extension: {
          authorKind: "manager",
          direction: "manager_proposal",
          missingEntryKind: null,
          respondsToEntryId: null,
          payPeriodClosureId: null,
        },
      }),
    ],
    ...patch,
  };
  item.history = item.history.map((entry) => ({
    ...entry,
    personId: item.personId,
    locationId: item.locationId,
    recordedByPersonId:
      entry.recordedByPersonId === "worker" ? item.personId : entry.recordedByPersonId,
  }));
  return item;
}
export function attendanceInbox(
  prompts: AttendancePrompt[] = [attendancePrompt()],
  items: CorrectionItem[] = [],
): AttendanceInbox {
  return {
    personId: "worker",
    revision: "revision",
    prompts,
    items,
    locations: [{ id: "deli", name: "The deli", timeZone: "America/New_York" }],
  };
}
