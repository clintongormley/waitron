import type { TimeEntryRecord } from "./projection.js";
import type { ClockEntryKind, TimeRecord } from "./record-types.js";
import type { AttendanceDay } from "./attendance-types.js";

export interface AttendanceChange {
  target: { entryId: string } | { missingKind: ClockEntryKind };
  at: string;
  offsetMinutes: number;
}
export type AttendanceCommandPayload =
  | { action: "confirm"; questionId: string }
  | {
      action: "request";
      questionId: string | null;
      locationId: string;
      changes: AttendanceChange[];
      reason: string;
    }
  | {
      action: "propose";
      personId: string;
      locationId: string;
      changes: AttendanceChange[];
      reason: string;
    }
  | { action: "approve" | "decline" | "accept"; itemId: string }
  | { action: "disagree"; itemId: string; reason: string };
export type AttendanceCommand = AttendanceCommandPayload & {
  commandId: string;
  expectedRevision: string;
};
export interface AttendanceCommandResult {
  commandId: string;
  entryIds: string[];
  replayed: boolean;
}
export interface AttendanceResponseReceipt {
  id: string;
  requestedByPersonId: string;
  authorizedByPersonId: string;
  personId: string;
  locationId: string;
  questionId: string | null;
  action: AttendanceCommandPayload["action"];
  input: AttendanceCommandPayload;
  entryIds: string[];
  createdAt: string;
}
export interface CorrectionItem {
  id: string;
  requestEntryIds: string[];
  personId: string;
  locationId: string;
  direction: "worker_request" | "manager_proposal";
  status: "waiting-manager" | "waiting-worker" | "approved" | "declined" | "disputed" | "overtaken";
  readyToApply: boolean;
  responseEntryIds: string[];
  changes: AttendanceChange[];
  reason: string;
  requestedByPersonId: string;
  selfApproved: boolean;
  history: TimeEntryRecord[];
}

export interface AttendancePrompt {
  id: string;
  questionId: string | null;
  itemId: string | null;
  personId: string;
  locationId: string;
  locationName: string;
  businessDay: string | null;
  day: AttendanceDay | null;
  kind: "automatic-out" | "missing-times" | "proposal";
  automaticEntryId: string | null;
  missingKinds: ClockEntryKind[];
  timeZone: string;
  history: TimeEntryRecord[];
}
export interface AttendanceInbox {
  personId: string;
  revision: string;
  prompts: AttendancePrompt[];
  items: CorrectionItem[];
  locations: { id: string; name: string; timeZone: string }[];
}
export interface AttendanceDayView {
  personId: string;
  locationId: string;
  date: string;
  timeZone: string;
  revision: string;
  record: TimeRecord;
  items: CorrectionItem[];
}
export interface AttendanceManagerQueue {
  locationId: string;
  items: CorrectionItem[];
}
