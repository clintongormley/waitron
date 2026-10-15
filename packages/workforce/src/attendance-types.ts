export type AttendanceSource =
  "session" | "draft" | "order" | "whole-payment" | "bill-payment" | "refund" | "clock";
export type ActivityKind = "sign-in" | "order" | "payment" | "break";
export type AttendanceFact = Readonly<{
  source: AttendanceSource;
  key: string;
  personId: string;
  locationId: string;
  kind: ActivityKind;
  at: string;
  offsetMinutes: number;
}>;
export type AttendanceDay = Readonly<{
  locationId: string;
  businessDay: string;
  startAt: string;
  endAt: string;
}>;
export type AttendanceQuestion = Readonly<{
  id: string;
  personId: string;
  day: AttendanceDay;
  shiftKey: string;
  kind: "automatic-out" | "missing-times";
  missingKinds: readonly ("in" | "out")[];
  openEntryId: string | null;
  automaticEntryId: string | null;
  evidenceKeys: readonly string[];
  createdAt: string;
}>;
export type PlannedAttendanceShift = Readonly<{
  id: string;
  personId: string;
  locationId: string;
  startsAt: string;
  endsAt: string;
  rosterVersionId: string;
}>;
export type AttendanceDayInput = Readonly<{
  // A clock caller has complete evidence for one worker, not a completed location scan.
  personId?: string;
  day: AttendanceDay;
  facts: readonly AttendanceFact[];
  planned: readonly PlannedAttendanceShift[];
  now: Date;
  nodeId: string;
}>;
export type AttendanceDayResult = { automaticEntryIds: string[]; questionIds: string[] };
