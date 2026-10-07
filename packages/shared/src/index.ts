// The public surface of @waitron/shared. Re-exports only.
//
// Excluded from coverage by path in vitest.config.ts: @vitest/coverage-v8 has reported phantom
// uncovered entries for this barrel on some runs and not others, and an in-file `v8 ignore file`
// did not reliably suppress them.
export { AppError, hasCode, isAppError } from "./errors.js";
export type { ErrorCode, ErrorParams } from "./errors.js";
export type {
  Branded,
  DeviceId,
  FiscalRecordId,
  LocationId,
  NodeId,
  SaleId,
  SaleLineId,
  SeriesId,
  TenderId,
  WorkingOrderId,
  WorkingOrderLineId,
} from "./ids.js";
export {
  deviceId,
  fiscalRecordId,
  isUuid,
  locationId,
  nodeId,
  normaliseUuid,
  saleId,
  saleLineId,
  seriesId,
  tenderId,
  workingOrderId,
  workingOrderLineId,
} from "./ids.js";
export {
  deviceOrigin,
  isSaleOrigin,
  jobOrigin,
  readOrigin,
  readSaleOrigin,
  SALE_SOURCES,
  SOURCES,
} from "./origin.js";
export type {
  DeviceOrigin,
  JobOrigin,
  JobSource,
  Origin,
  SaleOrigin,
  SaleSource,
  Source,
} from "./origin.js";
export { centsToDecimal, decimalToCents, rawCentsToDecimal, stringToCents } from "./cents.js";
export { currencySymbol, formatMoney, type CurrencySymbol } from "./money-format.js";
export {
  normalisePartyName,
  PARTY_NAME_MAX,
  partyDisplayName,
  partyReceiptLabel,
  partyTablesName,
  TABLE_SEPARATOR,
} from "./party-name.js";
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
  languageDisplayName,
  resolveContentText,
  resolveEnabledContentText,
  resolveSnapshotText,
} from "./content-languages.js";
export type { ContentLanguageRules, ContentLanguages } from "./content-languages.js";
export { capitaliseFirst } from "./capitalise.js";
export { BAND_RANK, classifyBand, worstBand } from "./timing.js";
export type { StationThresholds, TimingBand } from "./timing.js";
export type { KitchenSignal, ReadyAtStation, TableSignal } from "./table-signals.js";
export { perDishOptionQuantity } from "./quantity.js";
export { draftLineMergeKey, normaliseDraftLines } from "./draft-merge.js";
export type { MergeableDraftLine } from "./draft-merge.js";
export { deriveDisplayName } from "./derive-display-name.js";
export { isValidTelephone } from "./telephone.js";
export { isValidGuestCount, MAX_GUEST_COUNT } from "./guest-count.js";
export { MEDIA_FILENAME } from "./media-filename.js";
export { formatEquipmentCode, parseEquipmentCode, type EquipmentKind } from "./equipment-code.js";
export { mayTakeOver, type EquipmentVia } from "./equipment-takeover.js";
export { tillProviderForReader, type TillReaderProvider } from "./till-card-provider.js";
export { firstCodeInCauseChain, MAX_CAUSE_DEPTH } from "./cause-chain.js";
export { sqliteFailureOf } from "./engine-failure.js";
export { quoteLiteral } from "./sql-literal.js";
export { blankComments, blankCommentsAndLiterals, mapComments } from "./source-comments.js";
export type { ResourceIdentity, ResourceChange, ChangeSource } from "./live-updates.js";

export type { OptionSelection, OptionSnapshot } from "./option-selection.js";
export type { ExtraSelection } from "./extra-selection.js";
export type { ClassificationEntry, SaleLineClassification } from "./sale-line-classification.js";
