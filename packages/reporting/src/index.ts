export { computeDailyClose } from "./daily-close.js";
export { computeVatSummaryForPeriod } from "./vat-summary.js";
export { computeVatReturn } from "./vat-return.js";
export { computeInputVat } from "./input-vat.js";
export type { InputVatInput } from "./input-vat.js";
export { parsePeriodToken } from "./period.js";
export type { LiquidationPeriod } from "./period.js";
export { mapModelo303 } from "./modelo-303.js";
export type { Modelo303 } from "./modelo-303.js";
export { toDr303Record } from "./dr303.js";
export type { Dr303Options } from "./dr303.js";
export { recordDailyClose } from "./record-daily-close.js";
export { computeCloseEntryHash } from "./daily-close-hash.js";
export type { CloseHashContent } from "./daily-close-hash.js";
export { verifyDailyCloseChain } from "./verify-daily-close-chain.js";
export type {
  CloseChainBreakReason,
  DailyCloseChainVerification,
} from "./verify-daily-close-chain.js";
export type {
  CashCountInput,
  DailyCloseRecord,
  DailyCloseSnapshot,
  RecordDailyCloseInput,
  TillReconciliation,
} from "./close-types.js";
export type {
  CashUp,
  CloseCounts,
  DailyClose,
  DailyCloseInput,
  InputVatRateLine,
  InputVatReturn,
  InputVatSummary,
  PeriodVatInput,
  PurchaseVatKind,
  TenderMethod,
  TenderMethodLine,
  TillCashUp,
  VatRateLine,
  VatReturn,
  VatReturnInput,
  VatSummary,
} from "./types.js";

// Side-effect only: keeps errors.ts's `declare module "@waitron/shared"` augmentation reachable
// from this package's own public barrel, per the reachability rule in packages/shared/src/errors.ts.
import "./errors.js";
