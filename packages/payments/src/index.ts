// The entire public surface of @waitron/payments. Re-exports only — no logic here.
export type {
  CollectParams,
  PaymentProvider,
  PaymentResult,
  PaymentState,
  ProviderCapabilities,
} from "./provider.js";
// The fake is NOT re-exported here — packages that need it import it from
// "@waitron/payments/src/testing/fake-provider.js" in test files only, so a production import of
// the package surface cannot reach a test double by autocomplete (mirrors packages/fiscal).
export {
  associatePaymentWithSale,
  findPaymentByRef,
  getPaymentByRef,
  insertCapturedPayment,
  insertFailedPayment,
  recordRefund,
  recordVoid,
} from "./store.js";
export type { PaymentRecord, PaymentRow } from "./store.js";
export { MANUAL_PROVIDER, recordManualCardPayment, recordManualRefund } from "./manual.js";
export type { ManualCardPaymentParams, ManualCardPaymentResult } from "./manual.js";
export { PAYMENTS_MIGRATIONS } from "./migrations.js";
