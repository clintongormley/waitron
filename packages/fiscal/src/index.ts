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
export type {
  Counterparty,
  FiscalBackend,
  FiscalRecordRef,
  FiscalState,
  IntegrityIssue,
  IntegrityReport,
  SaleForFiscalRecord,
  TillRegistration,
  VatBreakdownLine,
} from "./backend.js";
// The fake is NOT re-exported here. packages/core imports it from
// "@waitron/fiscal/src/testing/fake-backend.js" in test files only, so a production import of
// the package surface cannot reach a test double by autocomplete.
