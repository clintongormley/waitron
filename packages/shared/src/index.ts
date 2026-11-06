// Excluded from coverage by path in vitest.config.ts: @vitest/coverage-v8 has reported phantom
// uncovered entries for this barrel on some runs and not others, and an in-file `v8 ignore file`
// did not reliably suppress them.
export { AppError, hasCode, isAppError } from "./errors.js";
export { shortNodeId } from "./short-node-id.js";
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
  backupOrigin,
  deviceOrigin,
  INCIDENT_SOURCES,
  isSaleOrigin,
  jobOrigin,
  readIncidentOrigin,
  readOrigin,
  readSaleOrigin,
  SALE_SOURCES,
  SOURCES,
} from "./origin.js";
export type {
  BackupOrigin,
  DeviceOrigin,
  IncidentOrigin,
  IncidentSource,
  JobOrigin,
  JobSource,
  Origin,
  SaleOrigin,
  SaleSource,
  Source,
} from "./origin.js";
export { centsToDecimal, decimalToCents, rawCentsToDecimal, stringToCents } from "./cents.js";
export { currencySymbol, formatMoney, type CurrencySymbol } from "./money-format.js";
export { formatBytes } from "./bytes-format.js";
export { formatDuration } from "./duration-format.js";
export {
  JOIN_SIDES,
  NEW_TABLE_SIZE,
  freeSide,
  groupStep,
  heldStep,
  joinSide,
  touchingPlace,
  type JoinPlace,
  type JoinSide,
} from "./floor-join.js";
export {
  normalisePartyName,
  PARTY_NAME_MAX,
  partyDisplayName,
  partyReceiptLabel,
  partyTablesName,
  TABLE_SEPARATOR,
} from "./party-name.js";
export {
  isShortNameShaped,
  proposeShortName,
  SHORT_NAME_MAX,
  shortNameKey,
  shortNameLength,
} from "./table-short-name.js";
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
export { cancelRefundShare } from "./cancel-refund-share.js";
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
export { conjunctionList } from "./list.js";
export {
  BAND_RANK,
  DEFAULT_READY_WARNING_AFTER_MINUTES,
  DEFAULT_STATION_THRESHOLDS,
  classifyBand,
  worstBand,
} from "./timing.js";
export type { StationThresholds, StationTiming, TimingBand } from "./timing.js";
export type {
  KitchenSignal,
  ReadyAtStation,
  ServiceStepDue,
  TableSignal,
} from "./table-signals.js";
export { perDishOptionQuantity, PORTIONS_AT_ONCE } from "./quantity.js";
export { draftLineMergeKey, normaliseDraftLines } from "./draft-merge.js";
export type { MergeableDraftLine } from "./draft-merge.js";
export { deriveDisplayName } from "./derive-display-name.js";
export { isValidEmail } from "./email.js";
export {
  PRIVACY_CONTACT_FIELDS,
  PRIVACY_CONTACT_MAX_LENGTH,
  privacyContactProblem,
  privacyContactValue,
  type PrivacyContactField,
  type PrivacyContactProblem,
} from "./privacy-contact.js";
export { isValidTelephone } from "./telephone.js";
export { isValidGuestCount, MAX_GUEST_COUNT } from "./guest-count.js";
export { MEDIA_FILENAME } from "./media-filename.js";
export { formatEquipmentCode, parseEquipmentCode, type EquipmentKind } from "./equipment-code.js";
export { mayTakeOver, type EquipmentVia } from "./equipment-takeover.js";
export { tillProviderForReader, type TillReaderProvider } from "./till-card-provider.js";
export { firstCodeInCauseChain, MAX_CAUSE_DEPTH } from "./cause-chain.js";
export { DISK_FULL_RESULT_CODE, diskFullIn, sqliteFailureOf } from "./engine-failure.js";
export { BUILD_HEADER } from "./build-header.js";
export { quoteLiteral } from "./sql-literal.js";
export { blankComments, blankCommentsAndLiterals, mapComments } from "./source-comments.js";
export type { ResourceIdentity, ResourceChange, ChangeSource } from "./live-updates.js";

export type { OptionSelection, OptionSnapshot } from "./option-selection.js";
export type { ExtraSelection } from "./extra-selection.js";
export type {
  DeleteImpact,
  DeleteImpactItem,
  DeleteImpactRefusal,
  DeleteTarget,
} from "./delete-impact.js";
export type { ClassificationEntry, SaleLineClassification } from "./sale-line-classification.js";
export { compareLabels, createLabelComparator } from "./compare-labels.js";
export {
  businessDayAt,
  businessDayBoundaryAt,
  businessDayBounds,
  cutoverForBusinessDay,
  type BusinessDayClock,
  type BusinessDayBounds,
  type CutoverChange,
} from "./business-day-clock.js";
export {
  compareSearchRanks,
  foldCache,
  foldForSearch,
  searchBy,
  searchFor,
  searchRankKey,
  textSearch,
  type NameSearch,
  type SearchRank,
  type TextSearch,
} from "./text-search.js";
export {
  receiptLogoSource,
  resolveReceiptText,
  resolveReceiptTrim,
  untranslatedLanguages,
} from "./receipt-text.js";
export type {
  DepartmentReceiptConfig,
  DepartmentReceiptPolicy,
  DepartmentReceiptWrite,
  PrintedReceiptTrim,
  ReceiptPresentation,
  ReceiptText,
  VenueReceiptConfig,
  VenueReceiptSettings,
} from "./receipt-text.js";

export type {
  ReceiptPaperWidth,
  StoredReceiptLogoRaster,
  ReceiptLogoRasters,
  ReceiptLogoRaster,
  DepartmentReceiptDiagnostic,
  DepartmentReceiptScope,
} from "./receipt-text.js";
export {
  STATION_COLOURS,
  firstUnusedStationColour,
  isStationColour,
  type StationColour,
} from "./station-colours.js";
export { TICKET_GROUPINGS, isTicketGrouping, type TicketGrouping } from "./ticket-grouping.js";
export { BUMP_MODES, isBumpMode, type BumpMode } from "./bump-mode.js";
export {
  CHANGES_AFTER_SENDING,
  allowsChangeAfterSending,
  isChangesAfterSending,
  type ChangesAfterSending,
} from "./changes-after-sending.js";

export type {
  RecordExportValue,
  RecordExportAudience,
  RecordExportFormat,
  RecordExportInput,
  RecordExportSection,
  RecordExportDocument,
} from "./record-export-types.js";

export { compareStationNames } from "./station-names.js";

export { CALENDAR_COLOURS, type CalendarColour } from "./calendar-colours.js";

export { classifyTimeZone, classifySavedTimeZone, timeZoneOffsetMinutes } from "./time-zone.js";
export type { SavedTimeZone } from "./time-zone.js";
export type { PricingUnit } from "./menu-document/pricing-unit.js";
export {
  allergenKinds,
  validateAllergens,
  ALLERGEN_CODES,
  CEREAL_KINDS,
  NUT_KINDS,
  type AllergenCode,
  type Kind,
  type AllergenDeclaration,
  type ProductAllergens,
} from "./menu-document/allergens.js";
export {
  resolveMenuText,
  menuPriceRange,
  type MenuView,
  type MenuText,
} from "./menu-document/customer-menu-presentation.js";
export {
  validateDietaryDeclarations,
  expandDietaryDeclarations,
  validateDietarySuitability,
  DIETARY_LABELS,
  DIETARY_SUITABILITY,
  type DietaryLabel,
  type DietarySuitability,
} from "./menu-document/dietary-declarations.js";
export {
  validateOrigin,
  validateContainsTag,
  validateDietOverride,
  deriveDietProfile,
  overlayDietProfile,
  assertDietOverrideDisjoint,
  DIETARY_ORIGINS,
  CONTAINS_TAGS,
  type DietaryOrigin,
  type ContainsTag,
  type DietLabel,
  type DietDerivation,
  type DietOverride,
  type DietProfile,
} from "./menu-document/dietary.js";
export type {
  ValueSource,
  Place,
  Candidate,
  Setting,
  CombinedOffer,
  CombineInput,
  MenuClash,
} from "./menu-document/menu-combine-types.js";
export type {
  OverlayOfferField,
  FrozenExtraItem,
  FrozenOptionLabel,
  FrozenOfferedModifier,
  FrozenOfferVariant,
  FrozenOffer,
  DocumentMember,
  DocumentList,
  DocumentTile,
  HomeDevice,
  HomeTileMode,
  HomeOrder,
  HomeDisplay,
  DeviceHome,
  MenuDocument,
  LiveExtraItem,
  LiveOptionsList,
  LiveOfferedModifier,
  LiveOffer,
  MenuField,
  MenuTarget,
  MenuOccurrence,
  MenuChangeSource,
  MenuChangeBody,
  MenuChange,
  ProductChangeField,
  SectionChangeField,
  MenuStatus,
  MenuPreview,
  PublishedMenuVersion,
  OvertakenEdition,
  QueuedEdition,
  MenuEdition,
  MenuPublications,
  LocalTime,
  MenuPublicationsAnswer,
  MenuUnavailable,
  ServedMenu,
  MenuState,
} from "./menu-document/menu-document-types.js";
export type {
  MenuItem,
  MenuOffer,
  MenuOfferVariant,
  MenuVariant,
  MenuPriceVariant,
  MenuPriceRow,
  AvailableProduct,
  AccessibleCatalogue,
  OfferedExtraItem,
  OfferedExtrasList,
  OfferedOptionsList,
  OfferedModifier,
} from "./menu-document/menu-types.js";
export type {
  OptionLabel,
  OptionList,
  OptionListRow,
  OptionLabelInput,
  OptionListInput,
  ExtraListItem,
  ExtraList,
  ExtraListRow,
  ExtraListItemInput,
  ExtraListInput,
  OptionListDependants,
  ExtraListDependants,
} from "./menu-document/modifier-list-types.js";
export { newCustomerText, newCustomerPresentation } from "./menu-document/new-customer-text.js";
export {
  isProductOrdering,
  PRODUCT_ORDERINGS,
  type ProductOrdering,
} from "./menu-document/product-ordering.js";
export {
  staffPresentationName,
  joinCustomerPresentationText,
  nonBlankTranslations,
  customerPresentationText,
  kitchenPresentationName,
  type ProductPresentation,
} from "./menu-document/product-presentation.js";
export type {
  ProductModifierRef,
  Unit,
  SellableUnit,
  ProductVariant,
  ProductVariantInput,
  ListedVariant,
  Product,
  ProductEditorInput,
  ProductRouting,
  ProductEditorBody,
  InheritedValues,
  ProductEditorValue,
} from "./menu-document/product-types.js";
export type {
  SectionRole,
  MemberRef,
  TileRef,
  SectionMember,
  SectionDetails,
  IncludeFolderOverrides,
  IncludeFolder,
  IncludeFolderInput,
  Presentation,
  SectionInput,
  HomeTile,
  MenuHome,
} from "./menu-document/section-types.js";
export {
  vatRateOn,
  vatRatesOn,
  localCalendarDate,
  localToday,
  VAT_CLASSES,
  VAT_RATE_TABLE,
  type VatClass,
  type DatedRate,
  type VatRateTable,
} from "./menu-document/vat-rates.js";
export {
  HOME_DEVICES,
  HOME_TILE_MODES,
  HOME_ORDERS,
  HOME_DISPLAY_DEFAULTS,
  HOME_COLUMN_RANGE,
  HOME_GRID_COLUMNS,
  homeDisplayProblem,
  arrangeHome,
  tileFill,
  shownMembers,
  openedSection,
  tilePaths,
  sectionTrail,
  indexDocument,
  type HomeBlock,
  type TileFill,
  type HomeIndex,
  type SectionStep,
} from "./menu-document/device-home.js";
export {
  isStoredColor,
  colorOrNull,
  categoryColorSource,
  categoryColor,
  effectiveColor,
  type ColorNode,
  type ColorSource,
} from "./menu-document/color-inheritance.js";
export { TRANSLATION_GAP_KINDS } from "./content-translation-kinds.js";
export type {
  TranslationGapKind,
  TranslationGapReason,
  TranslationGap,
  LanguageTranslationGaps,
  LanguageTranslationGapCount,
} from "./content-translation-report-types.js";
export type { AllergenMap } from "./allergen-map.js";
export type { KitchenAllergyBlock, KitchenNoteChange } from "./kitchen-notice-types.js";
export type { PersonRoleValue } from "./person-role.js";
export {
  REASON_KINDS,
  ADJUSTMENT_ACTIONS,
  type ReasonKind,
  type AdjustmentAction,
  type AdjustmentPolicySnapshot,
} from "./adjustment-policy-types.js";
