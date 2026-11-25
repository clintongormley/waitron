import type { AttendanceInbox, AttendancePrompt, CorrectionItem } from "../src/api/client.js";
type TimeEntryRecord = AttendancePrompt["history"][number];

export function attendanceEntry(patch: Partial<TimeEntryRecord> = {}): TimeEntryRecord {
  return {
    entryId: "automatic-out",
    personId: "worker",
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
    businessDay: "2026-10-13",
    day: {
      businessDay: "2026-10-13",
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
    recordedByPersonId:
      entry.recordedByPersonId === "worker" ? prompt.personId : entry.recordedByPersonId,
  }));
  return prompt;
}
export function attendanceMissingTimesPrompts(): [AttendancePrompt, AttendancePrompt] {
  const workDay = (businessDay: string, nextDay: string) => ({
    businessDay,
    startAt: `${businessDay}T04:00:00.000Z`,
    endAt: `${nextDay}T04:00:00.000Z`,
  });
  const automatic = attendanceEntry({
    eventAt: "2026-11-23T18:35:00.000Z",
    recordedAt: "2026-11-23T18:35:00.000Z",
    offsetMinutes: 60,
  });
  const worker = { ...automatic.extension!, authorKind: "worker" as const };
  return [
    attendancePrompt({
      kind: "missing-times",
      businessDay: "2026-11-23",
      day: workDay("2026-11-23", "2026-11-24"),
      timeZone: "Europe/Madrid",
      automaticEntryId: null,
      missingKinds: ["out"],
      history: [
        attendanceEntry({
          ...automatic,
          entryId: "clock-in",
          entryKind: "in",
          eventAt: "2026-11-23T18:10:00.000Z",
          recordedAt: "2026-11-23T18:10:00.000Z",
          sequenceNo: 1,
          recordedByPersonId: "worker",
          extension: worker,
        }),
        automatic,
        attendanceEntry({
          ...automatic,
          entryId: "answer",
          entryKind: "confirmation",
          recordedAt: "2026-11-23T18:36:00.000Z",
          sequenceNo: 3,
          recordedByPersonId: "worker",
          extension: { ...worker, respondsToEntryId: automatic.entryId },
        }),
      ],
    }),
    attendancePrompt({
      id: "next-day",
      questionId: "next-day",
      kind: "missing-times",
      businessDay: "2026-11-24",
      day: workDay("2026-11-24", "2026-11-25"),
      timeZone: "Europe/Madrid",
      automaticEntryId: null,
      missingKinds: ["in", "out"],
      history: [],
    }),
  ];
}
export function attendanceItem(patch: Partial<CorrectionItem> = {}): CorrectionItem {
  const item: CorrectionItem = {
    id: "proposal",
    requestEntryIds: ["proposed-out"],
    personId: "worker",
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
    timeZone: "America/New_York",
  };
}
