// The public surface of @waitron/shared. Re-exports only.
//
// Excluded from coverage by path in vitest.config.ts: @vitest/coverage-v8 has reported phantom
// uncovered entries for this barrel on some runs and not others, and an in-file `v8 ignore file`
// did not reliably suppress them.
export { AppError, hasCode, isAppError } from "./errors.js";
export type { ErrorCode, ErrorParams } from "./errors.js";
export type {
  Branded,
  FiscalRecordId,
  LocationId,
  NodeId,
  SaleId,
  SaleLineId,
  SeriesId,
  TenderId,
  TillId,
  WorkingOrderId,
  WorkingOrderLineId,
} from "./ids.js";
export {
  fiscalRecordId,
  isUuid,
  locationId,
  nodeId,
  normaliseUuid,
  saleId,
  saleLineId,
  seriesId,
  tenderId,
  tillId,
  workingOrderId,
  workingOrderLineId,
} from "./ids.js";
export { centsToDecimal, decimalToCents, rawCentsToDecimal, stringToCents } from "./cents.js";
export {
  basisPointsToDecimal,
  decimalToBasisPoints,
  decimalToThousandths,
  MAX_QUANTITY_INTEGER_DIGITS,
  MAX_RATE_INTEGER_DIGITS,
  QUANTITY_SCALE,
  RATE_SCALE,
  rawBasisPointsToDecimal,
  rawThousandthsToDecimal,
  stringToBasisPoints,
  stringToThousandths,
  thousandthsToDecimal,
} from "./scales.js";
export type { Decimal } from "./money.js";
export {
  addDecimal,
  assertMoney,
  compareDecimal,
  decimal,
  divideDecimal,
  grossOf,
  isZeroDecimal,
  MAX_MONEY_INTEGER_DIGITS,
  MONEY_SCALE,
  multiplyDecimal,
  negateDecimal,
  percentOf,
  subtractDecimal,
  sumDecimals,
  toScale,
} from "./money.js";
export {
  SUPPORTED_LOCALES,
  SUPPORTED_LOCALE_CODES,
  FALLBACK_LOCALE,
  isSupportedLocale,
  assertSupportedLocale,
  resolveActiveLocale,
} from "./locales.js";
export type { SupportedLocale } from "./locales.js";
export {
  contentLanguageCode,
  contentLanguageChoices,
  resolveContentText,
  resolveEnabledContentText,
  resolveSnapshotText,
} from "./content-languages.js";
export type { ContentLanguages } from "./content-languages.js";
export { BAND_RANK, classifyBand, worstBand } from "./timing.js";
export type { StationThresholds, TimingBand } from "./timing.js";
export { perDishOptionQuantity } from "./quantity.js";
export { deriveDisplayName } from "./derive-display-name.js";
export { isValidTelephone } from "./telephone.js";
export { firstCodeInCauseChain, MAX_CAUSE_DEPTH } from "./cause-chain.js";
export { sqliteFailureOf } from "./engine-failure.js";
export { quoteLiteral } from "./sql-literal.js";
export type { ResourceIdentity, ResourceChange, ChangeSource } from "./live-updates.js";

export type { OptionSelection, OptionSnapshot } from "./option-selection.js";
export type { ExtraSelection } from "./extra-selection.js";
