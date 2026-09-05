// The entire public surface of @waitron/fiscal. Re-exports only — no logic here.
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
export type { FiscalBackendDeps, FiscalContribution } from "./contribution.js";
export type {
  AckState,
  Counterparty,
  DrainResult,
  FiscalBackend,
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
// The fake is NOT re-exported here. packages/core imports it from
// "@waitron/fiscal/src/testing/fake-backend.js" in test files only, so a production import of
// the package surface cannot reach a test double by autocomplete.
