// The entire public surface of @waitron/workforce. Re-exports only — no logic here.
export { WORKFORCE_MIGRATIONS } from "./migrations.js";
export { persons, personStatus, workforceRole } from "./schema/persons.js";
export { employments } from "./schema/employments.js";
export {
  timeEntries,
  workforceCorrectionStatus,
  workforceEntryKind,
} from "./schema/time-entries.js";
export { workforceChains } from "./schema/workforce-chains.js";
export { appendToChain, isUniqueViolation, lockChainHead } from "./chain.js";
export type { ChainHead, TimeEntryAppend } from "./chain.js";
export { computeEntryHash, verifyChain } from "./chain-hash.js";
export type { ChainVerification, EntryHashInput, VerifiableEntry } from "./chain-hash.js";
export { hashPin, verifyPin } from "./verify-pin.js";
export { WorkforceBackend } from "./clocking.js";
export type {
  ClockEventInput,
  CorrectionApprovalInput,
  CorrectionRequestInput,
  WorkSummaryOptions,
  WorkSummaryQuery,
} from "./clocking.js";
export type { WorkTimeRuleset } from "./ruleset.js";
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
