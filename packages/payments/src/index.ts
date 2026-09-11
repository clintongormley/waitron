// The entire public surface of @waitron/payments. Re-exports only — no logic here.
export type {
  AsyncPaymentProvider,
  CardDetails,
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
  findCapturedPaymentForWorkingOrderAnyProvider,
  findPaymentByRef,
  getPaymentByRef,
  insertAcceptedOffline,
  insertAttempting,
  insertCapturedPayment,
  insertFailedPayment,
  insertInitiated,
  listAcceptedOffline,
  listAttempting,
  listReconcilable,
  markReconcileRemediated,
  recordFailedRefund,
  recordRefund,
  recordVoid,
  resolvePaymentTenant,
  settleForwarded,
  settleInitiated,
  stampAttemptingRef,
  tillsForWorkingOrders,
} from "./store.js";
export type {
  AttemptingPayment,
  CapturedPaymentForOrder,
  ForwardablePayment,
  PaymentRecord,
  PaymentRow,
  ReconcilableRow,
  SettledInitiated,
} from "./store.js";
export { MANUAL_PROVIDER, recordManualCardPayment, recordManualRefund } from "./manual.js";
export { SimulatorPaymentProvider } from "./simulator.js";
export type { ManualCardPaymentParams, ManualCardPaymentResult } from "./manual.js";
export { PAYMENTS_MIGRATIONS } from "./migrations.js";
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
export { PAYMENTS_CLASSIFICATION } from "./classification.js";
export { PAYMENTS_CONFIGURATION_TRANSFER } from "./configuration-transfer.js";
export { PAYMENTS_CHANGE_SOURCES } from "./classification.js";
export type {
  AddReaderResult,
  CardProviderBuildDeps,
  CardProviderContribution,
  CardProviderRuntimeDeps,
  ConnectResult,
  ProviderCredentialField,
  ReaderAddMode,
  ReaderStatus,
} from "./card-provider.js";
export { cardProviderById, selectCardProviders } from "./card-provider.js";
