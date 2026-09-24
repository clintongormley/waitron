export { createTrustedClock } from "./clock.js";
export type {
  ClockConfidence,
  MonotonicSource,
  TrustedClock,
  TrustedClockOptions,
  TrustedReading,
  TrustedTimeAnchor,
  TrustedTimeSource,
} from "./clock.js";
export type {
  FiscalBackendDeps,
  FiscalContribution,
  FiscalDutyDeps,
  FiscalDutyLog,
} from "./contribution.js";
export { emptyDrainResult } from "./backend.js";
export type {
  AckState,
  Counterparty,
  DrainResult,
  FiscalBackend,
  FiledReceipt,
  FiscalRecordRef,
  FiscalState,
  IntegrityIssue,
  IntegrityReport,
  NodeRegistration,
  ReconcileMismatch,
  ReconcileResult,
  SaleForFiscalRecord,
  VatBreakdownLine,
} from "./backend.js";
// The fake backend is deliberately not re-exported: it is a test double.
