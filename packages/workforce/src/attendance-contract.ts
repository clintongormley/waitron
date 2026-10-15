import type { TimeEntryRecord } from "./projection.js";
import type { ClockEntryKind } from "./record-types.js";

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
