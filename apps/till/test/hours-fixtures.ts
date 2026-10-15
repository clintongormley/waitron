import type { PersonHours } from "../src/api/client.js";
import { attendanceEntry, attendanceItem, attendancePrompt } from "./attendance-fixtures.js";

export function hoursView(patch: Partial<PersonHours> = {}): PersonHours {
  const personId = patch.personId ?? "p1",
    locationId = patch.locationId ?? "venue";
  const entry = attendanceEntry({
    personId,
    locationId,
    eventAt: "2026-01-05T17:00:00.000Z",
    offsetMinutes: 60,
  });
  return {
    personId,
    locationId,
    selection: { kind: "week", date: "2026-01-05" },
    period: { start: "2026-01-05", end: "2026-01-12" },
    businessDay: "2026-01-06",
    clock: { timeZone: "Europe/Madrid", dayCutover: "05:00", cutoverChanges: [] },
    asOf: "2026-01-06T09:00:00Z",
    workedMinutes: 480,
    days: [
      {
        date: "2026-01-05",
        workedMinutes: 480,
        sessions: [
          {
            personId,
            locationId,
            workDate: "2026-01-05",
            startedAt: "2026-01-05T09:00:00.000Z",
            startOffsetMinutes: 60,
            endedAt: "2026-01-05T17:00:00.000Z",
            endOffsetMinutes: 60,
            breakMinutes: 0,
            workedMinutes: 480,
          },
        ],
      },
      { date: "2026-01-06", sessions: [], workedMinutes: 0 },
    ],
    record: {
      sessions: [
        {
          personId,
          locationId,
          workDate: "2026-01-05",
          startedAt: "2026-01-05T09:00:00.000Z",
          startOffsetMinutes: 60,
          endedAt: "2026-01-05T17:00:00.000Z",
          endOffsetMinutes: 60,
          breakMinutes: 0,
          workedMinutes: 480,
        },
      ],
      entries: [
        {
          entry,
          author: { kind: "automatic", personId: null },
          effective: true,
          confirmed: true,
          confirmedByWorker: false,
          corrected: false,
          disputed: false,
          selfApproved: false,
          closedPeriodIds: [],
        },
      ],
      closures: [],
      closedPeriodImpacts: [],
    },
    openShifts: [],
    pending: {
      prompts: [
        attendancePrompt({
          personId,
          locationId,
          businessDay: "2026-01-05",
          history: [entry],
          timeZone: "Europe/Madrid",
        }),
      ],
      items: [],
      automaticEntryIds: [entry.entryId],
    },
    closures: [],
    ...patch,
  };
}
export function hoursWithPending(): PersonHours {
  const view = hoursView();
  const item = attendanceItem({
    personId: "p1",
    locationId: "venue",
    direction: "worker_request",
    status: "waiting-manager",
  });
  view.pending = { ...view.pending, prompts: [], items: [item] };
  return view;
}
