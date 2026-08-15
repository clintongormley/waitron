// The entire public surface of @waitron/workforce. Re-exports only — no logic here.
export { WORKFORCE_MIGRATIONS } from "./migrations.js";
export { employments } from "./schema/employments.js";
export {
  timeEntries,
  workforceCorrectionStatus,
  workforceEntryKind,
} from "./schema/time-entries.js";
export type {
  PublishRosterInput,
  CreateRosterVersionInput,
  RosterVersionRow,
  ShiftRow,
  RosterSnapshot,
  AddShiftInput,
  UpdateShiftInput,
} from "./clocking.js";
export { workforceChains } from "./schema/workforce-chains.js";
export { rosterVersions, rosterVersionStatus } from "./schema/roster-versions.js";
export { shifts } from "./schema/shifts.js";
export { absences, absenceKind, absenceStatus } from "./schema/absences.js";
export type { AbsenceKind, AbsenceStatus } from "./schema/absences.js";
export { availability } from "./schema/availability.js";
export { shiftTemplates } from "./schema/shift-templates.js";
export { shiftSwaps, shiftSwapStatus } from "./schema/shift-swaps.js";
export type { ShiftSwapStatus } from "./schema/shift-swaps.js";
export { createAbsence, setAbsenceStatus } from "./absences.js";
export type { CreateAbsenceInput, SetAbsenceStatusInput } from "./absences.js";
export { requestSwap, acceptSwap } from "./shift-swaps.js";
export type { RequestSwapInput, AcceptSwapInput } from "./shift-swaps.js";
export { appendToChain, isUniqueViolation, lockChainHead } from "./chain.js";
export type { ChainHead, TimeEntryAppend } from "./chain.js";
export { computeEntryHash, verifyChain } from "./chain-hash.js";
export type { ChainVerification, EntryHashInput, VerifiableEntry } from "./chain-hash.js";
export { WorkforceBackend } from "./clocking.js";
export type {
  ClockEventInput,
  CorrectionApprovalInput,
  CorrectionRequestInput,
  WorkSummaryQuery,
  WorkSummaryRuleset,
} from "./clocking.js";
export type { WorkTimeRuleset } from "./ruleset.js";
export { validateRoster } from "./roster-validation.js";
export type {
  BreakOwedBreach,
  ExceedsDailyMaxBreach,
  ExceedsWeeklyMaxBreach,
  NightWorkBreach,
  OvertimeCapExceededBreach,
  PlannedShift,
  RestTooShortBreach,
  RosterBreach,
  RosterBreachKind,
  WeeklyRestInsufficientBreach,
} from "./roster-validation.js";
export { comparePlannedVsActual } from "./planned-vs-actual.js";
export type { PlannedVsActual } from "./planned-vs-actual.js";
export {
  dailyContractedTargetMinutes,
  localWallClock,
  projectWorkSessions,
  summarisePeriod,
} from "./projection.js";
export type {
  ContractedTerms,
  CorrectionStatus,
  DailyWorkTotal,
  OvertimeModel,
  Period,
  PeriodSummary,
  TimeEntryRecord,
  WorkSession,
  WorkforceEntryKind,
} from "./projection.js";

// Side-effect only: keeps errors.ts's `declare module "@waitron/shared"` augmentation reachable
// from this package's own public barrel, per the reachability rule in packages/shared/src/errors.ts.
// See errors.reachability.test.ts.
import "./errors.js";
