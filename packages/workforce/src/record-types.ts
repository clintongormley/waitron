import type { BusinessDayClock, Origin } from "@waitron/shared";
import type { Period, PeriodSummary, TimeEntryRecord, WorkSession } from "./projection.js";

export type ClockEntryKind = "in" | "out" | "break_start" | "break_end";
export type EntryAuthor =
  { kind: "worker" | "manager"; personId: string } | { kind: "automatic"; personId: null };
export interface RecordExtension {
  selfApproved?: boolean;
  authorKind: "worker" | "manager" | "automatic" | null;
  direction: "worker_request" | "manager_proposal" | null;
  missingEntryKind: ClockEntryKind | null;
  respondsToEntryId: string | null;
  payPeriodClosureId: string | null;
}
export interface ProjectedRecordEntry {
  entry: TimeEntryRecord;
  author: EntryAuthor;
  effective: boolean;
  confirmed: boolean;
  confirmedByWorker: boolean;
  selfApproved: boolean;
  corrected: boolean;
  disputed: boolean;
  closedPeriodIds: string[];
}
export interface PayPeriodSnapshot {
  sessions: WorkSession[];
  entries: ProjectedRecordEntry[];
  summaries: { personId: string; summary: PeriodSummary | null }[];
  markedAutomaticEntryIds: string[];
}
export interface PayPeriodClosure {
  id: string;
  nodeId: string;
  locationId: string;
  period: Period;
  clock: BusinessDayClock;
  scheduledCloseAt: string;
  closedAt: string;
  snapshot: PayPeriodSnapshot;
  sequenceNo: number;
  prevClosureHash: string | null;
  closureHash: string;
}
export interface ClosedPeriodImpact {
  closureId: string;
  personId: string;
  beforeWorkedMinutes: number;
  afterWorkedMinutes: number;
  deltaWorkedMinutes: number;
}
export interface PayPeriodClosureView {
  closureId: string;
  locationId: string;
  period: Period;
  closedAt: string;
  closureHash: string;
  snapshot: PayPeriodSnapshot;
}
export interface TimeRecord {
  sessions: WorkSession[];
  entries: ProjectedRecordEntry[];
  closures: PayPeriodClosureView[];
  closedPeriodImpacts: ClosedPeriodImpact[];
}
export interface RecordAttribution {
  recordedByPersonId?: string | null;
  origin?: Origin;
  correctionReason?: string | null;
  correctionActorId?: string | null;
  extension?: RecordExtension | null;
}
