export * from "./pricing.js";
export type { PricingUnit } from "@waitron/shared";
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
} from "@waitron/shared";
export { isProductOrdering, PRODUCT_ORDERINGS, type ProductOrdering } from "@waitron/shared";
export * from "./units.js";
// Listed rather than `export *`: `createProductSkippingNameCheck`,
// `updateProductSkippingNameCheck` and `writeProductVariantsSkippingNameCheck` skip the
// unique-name rule and are kept out of the package entry point.
export {
  addProductToMenu,
  assignMenuToVenue,
  menuExists,
  createMenu,
  createProduct,
  deactivateMenu,
  deactivateProduct,
  listAvailableProducts,
  listMenus,
  listMenuOffers,
  listProducts,
  menuPrices,
  readDefaultMenuId,
  readInvoiceLocales,
  readReceiptLanguage,
  setVenueDefaultMenu,
  updateMenuDetails,
  updateMenuItem,
  updateProduct,
} from "./operations.js";
export type {
  AvailableProduct,
  Menu,
  CreateProductInput,
  ListedVariant,
  MenuItem,
  MenuOffer,
  MenuOfferVariant,
  MenuPriceRow,
  MenuPriceVariant,
  OfferedExtraItem,
  OfferedExtrasList,
  OfferedModifier,
  OfferedOptionsList,
  Product,
  UpdateProductInput,
} from "./operations.js";
export { foldName } from "./name-uniqueness.js";
export * from "./content-languages.js";
export { validateOptionalTranslations } from "./optional-translations.js";
export * from "./content-translation-report.js";
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
} from "@waitron/shared";
export * from "./derivation.js";
export {
  validateContainsTag,
  validateDietOverride,
  UNDECLARED_DIET,
  overlayDietProfile,
  assertDietOverrideDisjoint,
  CONTAINS_TAGS,
  type ContainsTag,
  type DietLabel,
  type DietOverride,
  type DietProfile,
} from "@waitron/shared";
export * from "./invoice-descriptions.js";
export * from "./media.js";
export {
  contentSuggestionJobs,
  contentSuggestions,
  extraListItems,
  extraLists,
  menuItems,
  menuItemVariantOverrides,
  menuReleases,
  menuVersionImages,
  menuVersions,
  optionLabels,
  optionLists,
  productModifiers,
  sectionMembers,
  sections,
  units,
  SUGGESTION_FAILURES,
  SUGGESTION_JOB_STATES,
  SUGGESTION_REFUSALS,
} from "@waitron/db";
export type { SuggestionJobRow, SuggestionRow } from "@waitron/db";
export { MENU_CONFIGURATION_TRANSFER } from "./configuration-transfer.js";
export { MENU_PROVISIONING } from "./provisioning.js";
export { MENU_TABLES } from "./classification.js";
export { MENU_CHANGE_SOURCES } from "./classification.js";
export * from "./categories.js";
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
} from "@waitron/shared";
export * from "./section-graph.js";
export * from "./menu-inclusion.js";
export * from "./sections.js";
export * from "./include-folder-presentation.js";
export { setIncludeFolder, columnsFromOverrides, overridesFromRow } from "./include-folder.js";
export * from "./menu-home.js";
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
} from "@waitron/shared";
export {
  createMenuShell,
  readMenuStructure,
  readMenuStructures,
  type MenuStructure,
  requireMenuRoot,
  syncMenuOffers,
  type MenuStructureNode,
} from "./menu-structure.js";
export { duplicateMenu } from "./menu-copy.js";
export { refuseSetMenu } from "./set-menus.js";
export {
  MENU_DOCUMENT_FORMAT,
  applyLiveFields,
  hydrateDeclarationDocument,
  buildMenuDocument,
  diffMenuDocuments,
  documentOffers,
  menuDocumentHash,
  NO_LIVE_FIELDS,
  readLiveState,
  type OmittedShortcut,
} from "./menu-document.js";
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
} from "@waitron/shared";
export {
  assertLiveVersions,
  menuStatus,
  menusOfVersions,
  patchLiveMenu,
  previewMenu,
  publishMenu,
  readLiveDocuments,
  readRecordedDocuments,
  readLiveMenu,
} from "./menu-publication.js";
export type {
  LiveMenu,
  MenuPatchChange,
  MenuPatchResult,
  MenuPatchTarget,
} from "./menu-patch-types.js";
export {
  activateDueMenuPublications,
  cancelMenuPublication,
  listMenuPublications,
  queueMenuPublication,
  rescheduleMenuPublication,
} from "./menu-schedule.js";
export * from "./sale-classification.js";
export { currentClassifications } from "./current-classifications.js";

export * from "./option-contract.js";
export * from "./options.js";
export * from "./extra-contract.js";
export * from "./extras.js";
export * from "./extra-projection.js";
export * from "./extra-usage.js";
export * from "./product-modifiers.js";
export * from "./offered-modifiers.js";

// Listed rather than `export *`: what a menu sells is decided from the offer (`MenuOffer.variants`),
// never from `variantsOfProducts`, which reads Inactive variants too.
export {
  listMenuVariants,
  listProductVariants,
  parentsWithActiveVariants,
  selectMenuVariant,
  setMenuVariantPrice,
  setMenuVariants,
  setProductVariants,
} from "./variants.js";
export type {
  MenuVariant,
  ProductVariant,
  ProductVariantInput,
  VariantWrite,
  SelectedName,
  SelectedVariant,
  SellingValues,
} from "./variants.js";
export * from "./variant-fallback.js";
export {
  validateDietaryDeclarations,
  expandDietaryDeclarations,
  validateDietarySuitability,
  DIETARY_LABELS,
  DIETARY_SUITABILITY,
  type DietaryLabel,
  type DietarySuitability,
} from "@waitron/shared";
export * from "./product-editor.js";
export {
  staffPresentationName,
  joinCustomerPresentationText,
  nonBlankTranslations,
  customerPresentationText,
  kitchenPresentationName,
  type ProductPresentation,
} from "@waitron/shared";
export * from "./option-snapshot-labels.js";
export * from "./default-language-text.js";
export type { ProductRouting, ProductEditorBody } from "@waitron/shared";

export * from "./product-items.js";
export { menusHolding } from "./menu-removal.js";

export * from "./settings.js";
export { GUEST_MENU_SETTINGS } from "./guest-menu-settings.js";
export { readGuestMenu } from "./guest-menu.js";

export * from "./content-translation-types.js";
export * from "./content-translation-targets.js";
export { resolveTranslationCells } from "./content-translation-cells.js";
export { listTranslationItems } from "./content-translation-pages.js";
export * from "./content-translation-writes.js";

export * from "./content-translations.js";
export * from "./content-suggestion-collect.js";
export * from "./content-suggestion-jobs.js";
export * from "./content-suggestion-store.js";
export type * from "./content-suggestion-types.js";

export { assertProductWritable } from "./archive.js";

export { MENU_BACKUP_VERIFICATION } from "./backup-verification.js";

export { productDeclarationValues, extraDeclarationValues } from "./product-declarations.js";
