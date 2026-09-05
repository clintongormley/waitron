// The entire public surface of @waitron/payments. Re-exports only — no logic here.
export type {
  AsyncPaymentProvider,
  CollectParams,
  ForwardResult,
  InboundSettlement,
  InitiateParams,
  InitiateResult,
  PaymentProvider,
  PaymentResult,
  PaymentResultState,
  PaymentState,
  ProviderCapabilities,
} from "./provider.js";
// The fake is NOT re-exported here — packages that need it import it from
// "@waitron/payments/src/testing/fake-provider.js" in test files only, so a production import of
// the package surface cannot reach a test double by autocomplete (mirrors packages/fiscal).
export {
  assertReversible,
  associatePaymentWithSale,
  captureAttempting,
  claimAcceptedOffline,
  declineForwarded,
  existingReferences,
  expireInitiated,
  failAttempting,
  findCapturedPaymentForWorkingOrder,
  findPaymentByRef,
  getPaymentByRef,
  insertAcceptedOffline,
  insertAttempting,
  insertCapturedPayment,
  insertFailedPayment,
  insertInitiated,
  listAcceptedOffline,
  listReconcilable,
  markReconcileRemediated,
  recordFailedRefund,
  recordRefund,
  recordVoid,
  resolvePaymentTenant,
  settleForwarded,
  settleInitiated,
  tillsForWorkingOrders,
} from "./store.js";
export type {
  CapturedPaymentForOrder,
  ForwardablePayment,
  PaymentRecord,
  PaymentRow,
  ReconcilableRow,
  SettledInitiated,
} from "./store.js";
export { MANUAL_PROVIDER, recordManualCardPayment, recordManualRefund } from "./manual.js";
export type { ManualCardPaymentParams, ManualCardPaymentResult } from "./manual.js";
export { PAYMENTS_MIGRATIONS } from "./migrations.js";
export { PAYMENTS_ENROLMENT } from "./enrolment.js";
export { getPaymentPolicy, resolveOfflineDecision } from "./policy.js";
export type { PaymentPolicyRow } from "./policy.js";
export { DEFAULT_SETTLEMENT_LAG_MS, classify, reconcilePayments } from "./reconcile.js";
export type { OrphanRemediation } from "./errors.js";
export type {
  Classification,
  ClassifiedRow,
  IncidentSink,
  MismatchClass,
  PaymentMismatch,
  PaymentReconcileResult,
  PaymentReconciler,
  ReconcileDeps,
  ReconcilePeriod,
  ReversalFn,
  SettlementRecord,
  SettlementReportSource,
} from "./reconcile.js";
