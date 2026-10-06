export {
  businessDayStart,
  civilDateOf,
  currentBusinessDay,
  readLocationClock,
  validateBusinessDay,
  validateTimeZone,
  validatedRangeWindow,
  venueMomentAt,
} from "./business-day.js";
export type { VenueMoment } from "./business-day.js";
export { computeDailyClose } from "./daily-close.js";
export { computeVatSummaryForPeriod } from "./vat-summary.js";
export { computeTopSellers } from "./top-sellers.js";
export { CATEGORY_REPORT_MODES, computeCategorySales } from "./category-sales.js";
export type {
  CategoryReport,
  CategoryReportMode,
  CategorySalesInput,
  CategoryTotal,
  CurrentClassifier,
} from "./category-sales.js";
export { computeOverdueOrders } from "./overdue-orders.js";
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
  DeviceReconciliation,
  RecordDailyCloseInput,
} from "./close-types.js";
export type {
  CashUp,
  CloseCounts,
  DailyClose,
  DailyCloseInput,
  InputVatRateLine,
  InputVatReturn,
  InputVatSummary,
  OriginCashUp,
  OverdueOrder,
  OverdueOrdersInput,
  PeriodVatInput,
  PurchaseVatKind,
  TenderMethod,
  TenderMethodLine,
  TopSeller,
  TopSellerVariant,
  TopSellersInput,
  VatRateLine,
  VatReturn,
  VatReturnInput,
  VatSummary,
} from "./types.js";

// Side-effect only: keeps errors.ts's augmentation reachable from this package's public barrel
// (the rule is in packages/shared/src/errors.ts).
import "./errors.js";
