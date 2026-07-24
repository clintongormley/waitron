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
  expireInitiated,
  failAttempting,
  findPaymentByRef,
  getPaymentByRef,
  insertAcceptedOffline,
  insertAttempting,
  insertCapturedPayment,
  insertFailedPayment,
  insertInitiated,
  listAcceptedOffline,
  recordFailedRefund,
  recordRefund,
  recordVoid,
  resolvePaymentTenant,
  settleForwarded,
  settleInitiated,
} from "./store.js";
export type { ForwardablePayment, PaymentRecord, PaymentRow, SettledInitiated } from "./store.js";
export { MANUAL_PROVIDER, recordManualCardPayment, recordManualRefund } from "./manual.js";
export type { ManualCardPaymentParams, ManualCardPaymentResult } from "./manual.js";
export { PAYMENTS_MIGRATIONS } from "./migrations.js";
export { getPaymentPolicy, resolveOfflineDecision } from "./policy.js";
export type { PaymentPolicyRow } from "./policy.js";
