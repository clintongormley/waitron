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
export {
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
  FiscalDutyDeps,
  FiscalDutyLog,
} from "./contribution.js";
export { emptyDrainResult } from "./backend.js";
export type {
  AckState,
  AuthorityTimeSample,
  BootReading,
  ClockAdminConfirm,
  ClockAdminReading,
  ClockBehindLatestRecord,
  ClockConfirmation,
  ClockConfirmationSource,
  ClockCheckCloseRequest,
  ClockCheckOpenRequest,
  ClockConfirmRequest,
  ClockStep,
  ClockStepRecorded,
  ClockStepRequest,
  ClockProvedWrong,
  ClockStopProof,
  ClockStopState,
  Counterparty,
  DrainResult,
  FiscalBackend,
  FiledReceipt,
  FiscalRecordRef,
  FiscalState,
  IntegrityIssue,
  IntegrityReport,
  MisdatedDetail,
  MisdatedDetailRecord,
  MisdatedRecord,
  MisdatedRecords,
  NodeRegistration,
  ReceiptQrText,
  ReconcileMismatch,
  ReconcileResult,
  SaleForFiscalRecord,
  VatBreakdownLine,
  WaitingClockCheck,
} from "./backend.js";
// The fake backend is deliberately not re-exported: it is a test double.
export type { FiscalOutboxSeat, FiscalOutboxState } from "./contribution.js";
