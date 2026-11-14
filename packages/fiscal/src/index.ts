export { createTrustedClock } from "./clock.js";
export { prepareIssueClock, readIssueZone } from "./issue-clock.js";
export type { IssueScope } from "./issue-clock.js";
export type {
  ClockConfidence,
  MonotonicSource,
  TrustedClock,
  TrustedClockOptions,
  TrustedReading,
  TrustedTimeAnchor,
  TrustedTimeSource,
} from "./clock.js";
export {
  agreeingDeviceCount,
  agreeingDeviceGroup,
  CLOCK_WITNESS_MARGIN_MS,
  judgeClockWitnesses,
} from "./clock-witnesses.js";
export type { ClockWitness, ClockWitnessVerdict } from "./clock-witnesses.js";
export type {
  FiscalBackendDeps,
  FiscalCertificateAnswer,
  FiscalCertificateDiagnosisChildResult,
  FiscalCertificateDiagnosisDeps,
  FiscalCertificateJson,
  FiscalCertificateSeat,
  FiscalContribution,
  FiscalDeclarationsSeat,
  FiscalDutyDeps,
  FiscalDutyLog,
} from "./contribution.js";
export { emptyDrainResult, IssuanceRefusedError } from "./backend.js";
export type {
  AckState,
  BootReading,
  ClockAdminConfirm,
  ClockAdminReading,
  ClockConfirmation,
  ClockConfirmationSource,
  ClockStep,
  ClockStepRecorded,
  ClockStepRequest,
  CorrectionAdmission,
  Counterparty,
  DrainResult,
  FiscalBackend,
  ReturnedInvoiceRecord,
  FiledFigures,
  FiledReceipt,
  FiledInvoiceEvidence,
  FiledVersionFigures,
  FiscalRecordRef,
  FiscalState,
  IntegrityIssue,
  IntegrityReport,
  NodeRegistration,
  ReceiptQrText,
  ReconcileMismatch,
  ReconcileResult,
  SaleForFiscalRecord,
  VatBreakdownLine,
} from "./backend.js";
// The fake backend is deliberately not re-exported: it is a test double.
export type { FiscalOutboxSeat, FiscalOutboxState } from "./contribution.js";
