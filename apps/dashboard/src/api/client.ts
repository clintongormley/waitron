import type { CatalogueSettings } from "@waitron/catalogue/src/settings-types.js";
export type { CatalogueSettings };
import type {
  Setting,
  CombinedOffer,
  ValueSource,
  Place,
} from "@waitron/catalogue/src/menu-combine-types.js";
export type { Setting, CombinedOffer, ValueSource, Place };
import type { ContentLanguageRules, ContentLanguages } from "@waitron/shared";

/**
 * Most types below are hand-kept copies of the server's JSON shapes, so nothing compares them with
 * the server at compile time. The product and modifier-list shapes are imported instead, from
 * catalogue's type-only leaf files (`scripts/dashboard-browser-purity.test.ts`).
 */
import type { StationThresholds, TimingBand } from "@waitron/shared";
import type { RoutingView } from "@waitron/venue-service/routing";
import {
  createRequest,
  LiveData,
  type DashboardRequest,
  type FetchLike,
} from "@waitron/dashboard-kit";
import type {
  Product,
  ProductEditorValue,
  ProductVariantInput as ProductEditorVariant,
  ProductEditorBody as ProductEditorInput,
} from "@waitron/catalogue/src/product-types.js";
import type { ExtraOfferUsage } from "@waitron/catalogue/src/extra-usage.js";
export type { Product, ProductEditorValue, ProductEditorVariant, ProductEditorInput };
export interface VenueDetailValues {
  name: string;
  addressLine1: string | null;
  addressLine2: string | null;
  postalCode: string | null;
  city: string | null;
  province: string | null;
  timeZone: string;
  dayCutover: string;
}
export type VenueDetailField = keyof VenueDetailValues;
export type VenueDetailPatch = Partial<VenueDetailValues>;
export type DetailReason =
  | "sales"
  | "orders"
  | "daily_close"
  | "geography_context"
  | "current_details_only"
  | "holiday_geography"
  | "clock_effects";
export interface VenueDetailsModel {
  details: VenueDetailValues;
  issuer: { country: string; legalName: string; taxId: string };
  hasSales: boolean;
  hasOrderHistory: boolean;
  hasDailyClose: boolean;
  policy: Record<
    VenueDetailField,
    { decision: "allow" | "allow_with_warning" | "refuse"; reasons: DetailReason[] }
  >;
  provinces: { code: string; name: string }[];
}
export interface VenueDetailWrite {
  changes: VenueDetailPatch;
  expected: VenueDetailValues;
}

export interface VenueClockView {
  timeZone: string;
  dayCutover: string;
  civilDate: string;
  timeOfDay: string;
  businessDay: string;
  transitions: { at: string; civilDate: string; boundaryAt: string; boundaryTime: string }[];
}
export interface VenueClockPreview {
  at: string;
  current: VenueClockView | null;
  proposed: VenueClockView;
  backupDeadlines: { archive: string | null; cloud: string | null };
}

export interface MadeAt {
  stationId: string | null;
  stationName: string | null;
  noPreparation: boolean;
  noReplacement: boolean;
  variesByZone: boolean;
}
import type {
  ExtraList,
  ExtraListDependants,
  ExtraListInput,
  ExtraListItem,
  ExtraListItemInput,
  ExtraListRow,
  OptionLabel,
  OptionLabelInput,
  OptionList,
  OptionListDependants,
  OptionListInput,
  OptionListRow,
} from "@waitron/catalogue/src/modifier-list-types.js";
import type {
  HomeTile,
  IncludeFolder,
  IncludeFolderInput,
  IncludeFolderOverrides,
  MenuHome,
  SectionDetails,
  MemberRef,
  SectionInput,
  SectionMember,
  TileRef,
} from "@waitron/catalogue/src/section-types.js";
export type {
  HomeTile,
  IncludeFolder,
  IncludeFolderInput,
  IncludeFolderOverrides,
  MenuHome,
  SectionDetails,
  MemberRef,
  SectionInput,
  SectionMember,
};
import type {
  LanguageTranslationGaps,
  TranslationGap,
  TranslationGapKind,
  TranslationGapReason,
} from "@waitron/catalogue/src/content-translation-report-types.js";
export type { LanguageTranslationGaps, TranslationGap, TranslationGapKind, TranslationGapReason };
import type {
  TranslationBatch,
  TranslationPage,
  TranslationRef,
  TranslationTarget,
} from "@waitron/catalogue/src/content-translation-types.js";
export type { TranslationBatch, TranslationPage, TranslationRef, TranslationTarget };
export interface TranslationQuery {
  after?: string;
  targets?: TranslationRef[];
}

import type { MenuPriceRow, MenuPriceVariant } from "@waitron/catalogue/src/menu-types.js";
export type { MenuPriceRow, MenuPriceVariant };
import type {
  DocumentMember,
  FrozenOffer,
  HomeDevice,
  HomeDisplay,
  LocalTime,
  MenuChange,
  MenuDocument,
  MenuPreview,
  MenuPublicationsAnswer,
  MenuStatus,
  ProductChangeField,
  PublishedMenuVersion,
  QueuedEdition,
  SectionChangeField,
} from "@waitron/catalogue/src/menu-document-types.js";
export type {
  DocumentMember,
  FrozenOffer,
  HomeDevice,
  HomeDisplay,
  LocalTime,
  MenuChange,
  MenuDocument,
  MenuPreview,
  MenuPublicationsAnswer,
  MenuStatus,
  ProductChangeField,
  PublishedMenuVersion,
  QueuedEdition,
  SectionChangeField,
};

/** A venue-local date and time; `occurrence` picks one of a time the clock shows twice. */
export interface ActivationTime {
  date: string;
  time: string;
  occurrence?: "earlier" | "later";
}

export interface MenuReadModels {
  structure: MenuStructure;
  home: MenuHome;
  status: MenuStatus;
  preview: MenuPreview;
}
export type MenuReadPart = keyof MenuReadModels;
export interface MenuReadRevision {
  epoch: string;
  sequence: number;
}
export type MenuReadResult = Partial<{
  [P in MenuReadPart]: {
    status: number;
    body: MenuReadModels[P] | { error: { code: string; params?: Record<string, unknown> } };
  };
}> & { revision?: MenuReadRevision };

export interface MenuStructureNode {
  memberId: string;
  ref: MemberRef;
  children?: MenuStructureNode[];
  internalName?: string;
  names?: Record<string, string>;
  image?: string | null;
  color?: string | null;
  ownerMenuId?: string;
  includedMenuId?: string;
  /** Present exactly when `includedMenuId` is. */
  folder?: IncludeFolder;
}

export interface MenuStructure {
  rootSectionId: string;
  root: SectionDetails;
  nodes: MenuStructureNode[];
  includable: { id: string; name: string; rootSectionId: string }[];
  includedBy: { id: string; name: string }[];
}

export type {
  ExtraList,
  ExtraListDependants,
  ExtraListInput,
  ExtraListItem,
  ExtraListItemInput,
  ExtraListRow,
  OptionLabel,
  OptionLabelInput,
  OptionList,
  OptionListDependants,
  OptionListInput,
  OptionListRow,
};

export type PersonRole = "staff" | "supervisor" | "manager" | "admin";

export interface OwnProfile {
  displayName: string;
  firstNames: string | null;
  lastNames: string | null;
  telephone: string | null;
  email: string | null;
  pendingEmail: string | null;
  locale: string | null;
  hasPassword: boolean;
  hasTotp: boolean;
  hasGoogle: boolean;
  passkeys: Array<{
    id: string;
    name: string | null;
    createdAt: string;
    lastUsedAt: string | null;
    /** The password manager holding the passkey; null when its authenticator is not on the list. */
    provider: string | null;
  }>;
}
export interface ProfileCredentials {
  currentPassword?: string;
  totp?: string;
}
export interface ProfileDetails extends ProfileCredentials {
  displayName: string;
  firstNames: string;
  lastNames: string;
  telephone: string | null;
  email: string;
  locale: string;
}

export interface RosterEntry {
  personId: string;
  displayName: string;
}

export interface PersonSummary {
  personId: string;
  displayName: string;
  firstNames?: string | null;
  lastNames?: string | null;
  telephone?: string | null;
  role: PersonRole;
  status: "pending" | "active" | "suspended";
  hasPassword: boolean;
  hasTotp: boolean;
  email: string | null;
}

export interface PersonEditDetails {
  displayName: string;
  firstNames: string;
  lastNames: string;
  telephone: string | null;
  email: string;
  role: PersonRole;
  status: "pending" | "active" | "suspended";
}

export type PasskeyOptions = Record<string, unknown>;

export interface PasskeyChallenge {
  challengeHandle: string;
  options: PasskeyOptions;
}

/** What the browser's password manager is told about the signed-in person's passkeys. */
export interface PasskeySignals {
  rpId: string;
  /** base64url, the user handle the person's passkeys were registered under. */
  userId: string;
  /** base64url credential ids. */
  credentialIds: string[];
  name: string;
  displayName: string;
}

export interface PasskeyVerification {
  challengeHandle: string;
  response: unknown;
}

// ── Catalogue-management types ──────────────────────────────────────────────────────────────────

export type PricingUnit = "each" | "weight";

export type VatClass = "general" | "reduced" | "super_reduced" | "zero";

export type AllergenPresence = "contains" | "may_contain";

export interface AllergenEntry {
  presence: AllergenPresence;
  source?: string;
}

/** `null` = not yet reviewed, which is not the same as allergen-free; `{}` = reviewed, none
 * present. */
export type AllergenDeclaration = Record<string, AllergenEntry> | null;

export type DietaryOrigin =
  "plant" | "meat" | "fish" | "shellfish" | "dairy" | "egg" | "honey" | "other_animal";

/** Local copies of `@waitron/catalogue`'s runtime lists, as are the two below: a runtime import
 * from that package's main entry would load its `operations.ts`, which imports `@waitron/db`. */
export const DIETARY_ORIGINS = [
  "plant",
  "meat",
  "fish",
  "shellfish",
  "dairy",
  "egg",
  "honey",
  "other_animal",
] as const;

export const DIETARY_LABELS = [
  "vegan",
  "vegetarian",
  "halal",
  "kosher",
  "no_meat",
  "no_fish",
] as const;
export type DietaryLabel = (typeof DIETARY_LABELS)[number];

export const DIETARY_SUITABILITY = ["vegan", "vegetarian", "halal", "kosher"] as const;
export type DietarySuitability = (typeof DIETARY_SUITABILITY)[number];

export type ContainsTag = "meat" | "fish";

/** A present label field forces that label over the recipe-derived one; an absent field defers to
 * it. */
export interface DietOverride {
  vegan?: "yes" | "no";
  vegetarian?: "yes" | "no";
  halal?: "yes" | "no";
  kosher?: "yes" | "no";
  addContains?: ContainsTag[];
  removeContains?: ContainsTag[];
}

export interface CatalogueSummary {
  id: string;
  name: string;
  active: boolean;
  version: number;
}

export interface LocationCatalogueSummary extends CatalogueSummary {
  sellable: boolean;
  isDefault: boolean;
}

export interface CategorySummary {
  id: string;
  name: string;
  parentId: string | null;
  color: string | null;
}
export interface CategoryInput {
  name: string;
  parentId?: string | null;
  color?: string | null;
}
export interface CatalogueSelection {
  productIds: string[];
  categoryIds: string[];
}
export type FolderContents = "move_up" | "delete";
export interface FolderSummary {
  id: string;
  folders: number;
  /** Products in the category and every category below it, variants left out, inactive ones
   * included. */
  products: number;
  activeProducts: number;
  /** Routing rules naming the category or any category below it: what deleting its contents too
   * removes. */
  routes: number;
  /** Routing rules naming the category itself: what moving its contents up removes. */
  ownRoutes: number;
}
/** One selected category's counts as the client read them before deleting it. */
export type ShownFolderCounts = Pick<
  FolderSummary,
  "id" | "folders" | "products" | "activeProducts" | "routes" | "ownRoutes"
>;
export interface Unit {
  id: string;
  name: Record<string, string>;
  abbreviation: Record<string, string>;
  precision: number;
}

export interface UnitInput {
  name: Record<string, string>;
  abbreviation: Record<string, string>;
  precision: number;
}

export interface UnitPatch {
  name?: Record<string, string>;
  abbreviation?: Record<string, string>;
  precision?: number;
}

export interface ProductUsingUnit {
  id: string;
  name: string;
  active: boolean;
}

// ── Ingredient & product-recipe types ─────────────────────────────────────────────────────────────

export interface Ingredient {
  id: string;
  name: string;
  allergens: AllergenDeclaration;
  /** The dietary-origin category, or null when uncategorised (dependent products go diet-PENDING). */
  dietaryOrigin: DietaryOrigin | null;
  active: boolean;
}

export interface IngredientInput {
  name: string;
  allergens?: Record<string, AllergenEntry>;
  dietaryOrigin?: DietaryOrigin | null;
}

export interface IngredientPatch {
  name?: string;
  allergens?: AllergenDeclaration;
  dietaryOrigin?: DietaryOrigin | null;
  active?: boolean;
}

export type RecipeLine = Ingredient;

// ── Receipt-trim (configurable-till) types ────────────────────────────────────────────────────────

export interface ReceiptConfig {
  headerSubtitle?: string;
  footerMessage?: string;
  phone?: string;
  email?: string;
  /** Absent prints the location's address; `false` prints none. */
  printAddress?: boolean;
  /** A media library filename. */
  logo?: string;
}

/** The parts of a receipt a preview marks. */
export type ReceiptMarkName =
  "headerSubtitle" | "footerMessage" | "phone" | "email" | "address" | "logo";

/** Blocks `[start, end)` of a print preview. */
export interface BlockRange {
  start: number;
  end: number;
}

/** A sample receipt drawn with unsaved trim, and the blocks each part adds (`null` when it prints nothing). */
export interface ReceiptPreview {
  preview: PrintJobPreview;
  marks: Record<ReceiptMarkName, BlockRange | null>;
  /** The width drawn at. */
  paperWidth: PrintPaperWidth;
  /** The widths of the location's active devices' receipt printers, narrowest first; empty when none. */
  paperWidths: PrintPaperWidth[];
}

/** The language this location's receipts print in, which the venue's region may fix. */
export interface ReceiptLanguage {
  /** As stored, even when it is not one of `choices`. */
  language: string;
  choices: string[];
  /** `reason` is keyed by the dashboard's language code. */
  fixed: { locale: string; reason: Record<string, string> } | null;
}

export interface TestEmailAddress {
  name: string;
  address: string;
}

export interface TestEmailSummary {
  id: string;
  from: TestEmailAddress;
  to: TestEmailAddress[];
  subject: string;
  snippet: string;
  createdAt: string;
  read: boolean;
}

export interface TestEmail extends Omit<TestEmailSummary, "snippet" | "createdAt" | "read"> {
  date: string;
  text: string;
}

export interface EmailInbox {
  mode: "local_capture" | "smtp" | "unconfigured";
  count: number;
  messages: TestEmailSummary[];
}

// ── Table service-status configuration types ──────────────────────────────────────────────────────

export interface ServiceStatus {
  id: string;
  label: string;
  color: string;
  displayOrder: number;
  active: boolean;
  createdAt: string;
}

// ── Floor-plan types ─────────────────────────────────────────────────────────────────────────────

export interface FloorZone {
  id: string;
  name: string;
  displayOrder: number;
  active: boolean;
}

export type TableShape = "round" | "square" | "rect";

/** The server refuses a `null` `zoneId` with `management.request_invalid`. */
export interface TablePlacement {
  posX: number;
  posY: number;
  shape: TableShape;
  rotation: number;
  zoneId: string | null;
}

export interface DashboardTable {
  id: string;
  label: string;
  zoneId: string | null;
  capacity: number | null;
  active: boolean;
  createdAt: string;
  posX?: number | null;
  posY?: number | null;
  shape?: TableShape | null;
  rotation?: number | null;
}

// ── Kitchen-station + routing types ──────────────────────────────────────────────────────────────

export type KitchenTimingDefaults = StationThresholds;

export interface Station {
  id: string;
  name: string;
  displayOrder: number;
  isDefault: boolean;
  active: boolean;
  showsRestOfOrder: boolean;
  warmAfterMinutes: number;
  overdueAfterMinutes: number;
  forgottenAfterMinutes: number;
}

export interface Watcher {
  id: string;
  name: string;
  everyStation: boolean;
  stationIds: string[];
  everyZone: boolean;
  zoneIds: string[];
  runsPass: boolean;
  displayOrder: number;
  active: boolean;
  printerIds: string[];
}

export type BumpMode = "line" | "ticket";

export interface Course {
  id: string;
  name: string;
  displayOrder: number;
  active: boolean;
  /** Something names it, so removing it disables it rather than deleting it. Only the read with the
   *  disabled courses and a move's answer carry it. */
  inUse?: boolean;
}

export interface DeviceRow {
  id: string;
  madeHereStationIds: string[];
  /** The profiles staff may switch the device to: its active profile first, then the others. */
  approvedProfileIds: string[];
  kind: string;
  stationId: string | null;
  watcherId: string | null;
  /** The stored station's or watcher's name, and whether it is switched on; null when it holds neither. */
  binding: { name: string; active: boolean } | null;
  label: string;
  active: boolean;
  lastSeenAt: string | null;
  enrolledAt: string;
  deviceProfileId: string | null;
  /** The profile was deleted while only disabled devices held it. */
  profileRetired: boolean;
  /** The device's own choice; null is Use default, which `equipment` resolves. */
  receiptPrinterId: string | null;
  paymentSlipPrinterId: string | null;
  cashDrawerPrinterId: string | null;
  /** Each role's choice and what it resolves to now: receipt, slip, drawer, then reader. */
  equipment: RoleEquipment[];
  /** A whole percentage, 0 to 100. */
  batteryLevel: number | null;
  batteryCharging: boolean | null;
  batteryReportedAt: string | null;
}

export type EquipmentRole = "receipt" | "payment_slip" | "cash_drawer" | "card_terminal";

/** The other device holding an item, and who is signed in on it, if anyone. */
export interface EquipmentHolder {
  deviceId: string;
  deviceName: string;
  personName: string | null;
}

export interface RoleEquipment {
  role: EquipmentRole;
  selection: "default" | "item";
  chosenId: string | null;
  /** What the role prints, opens or pays on now; null is None. */
  resolved: { id: string; name: string; available: boolean } | null;
}

export interface Canvas {
  id: string;
  name: string;
  definition: unknown;
}

export type FormFactor = "till" | "phone-portrait" | "tablet-landscape" | "kds";

/** One person's own rule on a profile: `admitted` false keeps them out whatever their role. */
export interface PersonException {
  personId: string;
  admitted: boolean;
}

/** Where a profile serves; `allowedZoneIds` null is every zone of the department. */
export interface ProfileServiceScope {
  departmentId: string | null;
  allowedZoneIds: string[] | null;
  startingZoneId: string | null;
}

export interface DeviceProfile extends ProfileServiceScope {
  id: string;
  name: string;
  canvasId: string | null;
  capabilities: string[];
  formFactor: FormFactor;
  inactivityTimeoutSeconds: number | null;
  /** `null` opens the till on its canvas's first tab. */
  startingScreen: string | null;
  receiptPrinterIds: string[];
  paymentSlipPrinterIds: string[];
  cashDrawerPrinterIds: string[];
  /** Each list's default, which a device on Use default resolves; null is None. */
  receiptPrinterDefaultId: string | null;
  paymentSlipPrinterDefaultId: string | null;
  cashDrawerPrinterDefaultId: string | null;
  /** Never empty: every role when the profile narrows nothing. */
  admittedRoles: PersonRole[];
  personExceptions: PersonException[];
}

/** What a profile save may also carry; each part left out stays as stored on an edit. */
export type ProfileSaveExtras = Partial<
  ProfileKitchenLists &
    ProfileServiceScope &
    ProfileEquipmentDefaults &
    Pick<DeviceProfile, "startingScreen" | "admittedRoles" | "personExceptions">
>;

/** The drawer list and each printer list's default; on a new profile, absent is empty and None. */
export type ProfileEquipmentDefaults = Pick<
  DeviceProfile,
  | "cashDrawerPrinterIds"
  | "receiptPrinterDefaultId"
  | "paymentSlipPrinterDefaultId"
  | "cashDrawerPrinterDefaultId"
>;

/** The card readers a profile's devices may choose, in order, and the one they start on. */
export interface ProfileReaderList {
  readerIds: string[];
  defaultReaderId: string | null;
}

/** The departments and their zones a profile can be given, switched-off ones included. */
export interface ProfileScopeChoices {
  departments: { id: string; name: string; active: boolean }[];
  zones: { id: string; name: string; departmentId: string; active: boolean }[];
}

/** The stations and watchers a kitchen screen on the profile may show; an empty list permits none. */
export interface ProfileKitchenLists {
  stationIds: string[];
  watcherIds: string[];
}

/** In the order the device's equipment choices offer them. */
export type ProfilePrinterLists = Pick<
  DeviceProfile,
  "receiptPrinterIds" | "paymentSlipPrinterIds"
>;

/** Carries no verification number, deliberately: the list must never show the answer beside the
 * question. `label` is the name the joiner asked for, so it is untrusted text. */
export interface JoinRequestRow {
  id: string;
  kind: "device" | "print_agent";
  label: string;
  createdAt: string;
  /** Device rows only: the manager whose number check claimed the request, if any. */
  pairingBy?: { name: string; mine: boolean } | null;
  /** Device rows only: set when the knock came from a disabled device's browser, which proved it is
   * that device. The request's `id` is then the device's own id, and accepting it enables that
   * device again rather than adding one. */
  returning?: ReturningDetails | null;
}

/**
 * What a returning device's disabled row holds, and whether its profile was retired, for the Pair
 * step to start from.
 */
export interface ReturningDetails {
  name: string;
  profileId: string;
  stationId: string | null;
  watcherId: string | null;
  /** Its profile was deleted, so Enable must be given another. */
  profileRetired: boolean;
}

/** `deviceAddress` is the address the server advertises to the venue's devices, not this tab's. */
export interface PairingModeState {
  open: boolean;
  openUntil: string | null;
  deviceAddress: string;
}

export type FireControl = "waiter" | "kitchen" | "expo";

// ── Shift-planning types ──────────────────────────────────────────────────────────────────────────

export interface RosterVersion {
  id: string;
  locationId: string;
  periodStart: string;
  periodEnd: string;
  status: "draft" | "published" | "superseded";
  publishedAt: string | null;
  publishedByPersonId: string | null;
}

export interface Shift {
  id: string;
  personId: string;
  locationId: string;
  startsAt: string;
  startsOffsetMinutes: number;
  endsAt: string;
  endsOffsetMinutes: number;
  role: string | null;
  rosterVersionId: string | null;
}

export interface RosterSnapshot {
  version: RosterVersion | null;
  shifts: Shift[];
}

export interface ShiftInput {
  personId: string;
  locationId: string;
  startsAt: string;
  startsOffsetMinutes: number;
  endsAt: string;
  endsOffsetMinutes: number;
  role: string | null;
}

export interface ShiftPatch {
  personId?: string;
  startsAt?: string;
  startsOffsetMinutes?: number;
  endsAt?: string;
  endsOffsetMinutes?: number;
  role?: string | null;
}

export type RosterBreachKind =
  | "rest_too_short"
  | "exceeds_daily_max"
  | "exceeds_weekly_max"
  | "overtime_cap_exceeded"
  | "weekly_rest_insufficient"
  | "break_owed"
  | "night_work";

export interface RosterBreach {
  kind: RosterBreachKind;
  personId: string;
  [detail: string]: unknown;
}

export interface LocationSummary {
  id: string;
  name: string;
}

export interface PendingSwap {
  id: string;
  requestedByPersonId: string;
  fromShiftId: string;
  toPersonId: string;
  toShiftId: string | null;
  status: string;
  createdAt: string;
}

export interface PendingAbsence {
  id: string;
  personId: string;
  kind: string;
  startsOn: string;
  endsOn: string;
  status: string;
  note: string | null;
  createdAt: string;
}

export interface PlannedVsActualRow {
  personId: string;
  workDate: string;
  plannedMinutes: number;
  workedMinutes: number;
  lateMinutes: number;
  noShow: boolean;
  unplanned: boolean;
}

// ── Staff self-service (my schedule) types ──────────────────────────────────────────────────────

export type AbsenceKind = "holiday" | "sick_leave" | "leave" | "unpaid";

export interface MyShift {
  id: string;
  locationId: string;
  startsAt: string;
  startsOffsetMinutes: number;
  endsAt: string;
  endsOffsetMinutes: number;
  role: string | null;
  rosterVersionId: string | null;
}

export interface MySwap {
  id: string;
  requestedByPersonId: string;
  fromShiftId: string;
  toPersonId: string;
  toShiftId: string | null;
  status: "requested" | "accepted" | "approved" | "rejected";
  createdAt: string;
  direction: "offered_to_me" | "requested_by_me";
}

export interface MyAbsence {
  id: string;
  personId: string;
  kind: AbsenceKind;
  startsOn: string;
  endsOn: string;
  status: "requested" | "approved" | "rejected";
  note: string | null;
  createdAt: string;
}

// ── Purchase-invoice types ──────────────────────────────────────────────────────────────────────
// Every decimal value crosses the wire as a string, never a number.

export type PurchaseRegime = "general" | "equivalence_surcharge";

export type PurchaseVatKind = "ordinary" | "capital";

export interface PurchaseInvoiceLine {
  rate: string;
  base: string;
  tax: string;
  kind: PurchaseVatKind;
}

export interface PurchaseInvoice {
  id: string;
  supplierTaxId: string;
  supplierName: string;
  supplierInvoiceNumber: string;
  issuedOn: string;
  receivedOn: string;
  total: string;
  regime: PurchaseRegime;
  deductibleProportion: string;
  note: string | null;
  lines: PurchaseInvoiceLine[];
}

export interface PurchaseInvoiceLineInput {
  rate: string;
  base: string;
  tax: string;
  kind?: PurchaseVatKind;
}

export interface PurchaseInvoiceHeaderInput {
  supplierTaxId: string;
  supplierName: string;
  supplierInvoiceNumber: string;
  issuedOn: string;
  receivedOn: string;
  total: string;
  regime?: PurchaseRegime;
  deductibleProportion?: string;
  note?: string | null;
}

export interface PurchaseInvoiceInput {
  header: PurchaseInvoiceHeaderInput;
  lines: PurchaseInvoiceLineInput[];
}

/** `lines`, when present, replaces the whole VAT breakdown. */
export interface PurchaseInvoicePatch {
  header?: Partial<PurchaseInvoiceHeaderInput>;
  lines?: PurchaseInvoiceLineInput[];
}

// ── Printing types (print agents + printers + jobs) ───────────────────────────────────────────────

export type PrintTransport = "usb" | "network_tcp" | "bluetooth" | "cloud_poll";

export type PrintPaperWidth = "58mm" | "80mm";
export type PrintResolution = "180dpi" | "203dpi";

export type PrintJobStatus = "queued" | "printing" | "done" | "failed";

export interface PrintAgentRow {
  id: string;
  name: string;
  host: string | null;
  setupUrl: string | null;
  active: boolean;
  nodeId: string | null;
  lastSeenAt: string | null;
  enrolledAt: string;
}

export interface Printer {
  lastPrintAgentId: string | null;
  pendingJobs: number;
  lastPrintAt: string | null;
  id: string;
  name: string;
  transport: PrintTransport;
  host: string | null;
  port: number | null;
  localKey: string | null;
  pollId: string | null;
  watcherId: string | null;
  paperWidth: PrintPaperWidth;
  resolution: PrintResolution;
  hasCashDrawer: boolean;
  /** Carried by one device at a time, which `holder` names. */
  portable: boolean;
  holder: EquipmentHolder | null;
  active: boolean;
}

/** One profile offering one printer, on either of its lists. */
export interface PrinterProfileOffer {
  printerId: string;
  profileId: string;
  profileName: string;
}

export interface PrinterInput {
  name: string;
  transport: PrintTransport;
  host?: string;
  port?: number;
  localKey?: string;
  pollId?: string;
  paperWidth?: PrintPaperWidth;
  resolution?: PrintResolution;
  hasCashDrawer?: boolean;
  portable?: boolean;
}

export interface PrinterAddressProbe {
  host: string;
  port: number;
  requestedAt: number;
  expiresAt: number;
}

/** The latest Pair or Forget command for one agent and address; it never carries the PIN. */
export interface BluetoothCommandStatus {
  id: string;
  kind: "pair" | "forget";
  address: string;
  state: "pending" | "succeeded" | "failed";
  error?: string;
  /** Pending only: how long until the server drops the command unanswered. */
  expiresInMs?: number;
}

export interface DiscoveredPrinter {
  agentId: string;
  agentName: string | null;
  transport: PrintTransport;
  localKey?: string;
  host?: string | null;
  port?: number | null;
  make?: string | null;
  model?: string | null;
  name?: string | null;
  pagePrinter?: true;
  /** Bluetooth only: the agent's scan decoded the device as a printer. */
  printerLike?: true;
  /** Bluetooth only: the agent reported the device paired within the list's freshness window. */
  paired?: true;
  bluetoothCommand?: BluetoothCommandStatus;
  alreadyRegistered: boolean;
  printerId: string | null;
  lastSeenAt: string;
}

export interface PrinterPatch {
  name?: string;
  transport?: PrintTransport;
  host?: string | null;
  port?: number | null;
  localKey?: string | null;
  pollId?: string | null;
  paperWidth?: PrintPaperWidth;
  resolution?: PrintResolution;
  hasCashDrawer?: boolean;
  portable?: boolean;
  active?: boolean;
}

export type PrintPreviewBlock =
  | { kind: "text"; text: string; align?: "center" | "right" }
  | { kind: "feed"; lines: number }
  | { kind: "cut" }
  | {
      kind: "image";
      width: number;
      height: number;
      data: string;
      /** What a band drawn from a line of text reads as; absent for any other image. */
      text?: string;
      qrData?: string;
      align?: "center" | "right";
    };

export interface PrintJobPreview {
  /** The dots across the job's line, which the paper stands for. */
  widthDots: number;
  columns: number;
  text: string;
  blocks: PrintPreviewBlock[];
  qrData: string[];
  omittedGraphics: boolean;
  truncated: boolean;
  unsupported: boolean;
}

export interface DemoPrinterJob {
  id: string;
  kind: "document" | "drawer";
  createdAt: string;
  preview: PrintJobPreview | null;
}

export interface DemoReaderPayment {
  id: string;
  amount: string;
}

export interface PrintJobRow {
  canResend: boolean;
  id: string;
  printerId: string;
  status: PrintJobStatus;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  deliveredAt: string | null;
}

export interface StationPrinter {
  stationId: string;
  printerId: string;
}

// ── Receipt-printer + print-mode configuration ───────────────────────────────────────────────────

// ── Reporting (sales & takings) types ────────────────────────────────────────────────────────────
// Every decimal value crosses the wire as a string, never a number.

/** `name` is the frozen staff name (`sale_lines.name`), not a locale map. */
export interface TopSellerRow {
  name: string;
  quantity: string;
  total: string;
  variants: TopSellerVariantRow[];
}

export interface TopSellerVariantRow {
  name: string;
  quantity: string;
  total: string;
}

export interface VatRateRow {
  rate: string;
  base: string;
  tax: string;
}

export interface VatSummaryDto {
  byRate: VatRateRow[];
  baseTotal: string;
  taxTotal: string;
  grossTotal: string;
}

export interface TenderMethodRow {
  method: string;
  amount: string;
  tip: string;
}

/** The money one device took, or one job source such as the Demo seed with no device. */
export interface OriginCashUpRow {
  source: string;
  deviceId: string | null;
  /** The device's name, kept after the device is revoked; null for a job source. */
  deviceName: string | null;
  byMethod: TenderMethodRow[];
  cashTakings: string;
}

export interface CashUpDto {
  byOrigin: OriginCashUpRow[];
  tenderTotal: string;
  tipTotal: string;
}

export interface SalesCounts {
  sales: number;
  corrections: number;
  voids: number;
}

export interface SalesOverview {
  businessDay: string;
  takings: { tenderTotal: string; tipTotal: string; grossTotal: string };
  counts: SalesCounts;
  openTables: { open: number; total: number };
  topSellers: TopSellerRow[];
}

export interface OverdueOrder {
  orderId: string;
  orderNumber: number;
  tableLabel: string | null;
  stationName: string;
  ageMinutes: number;
  band: TimingBand;
}

export interface DailyCloseDto {
  businessDay: string;
  vat: VatSummaryDto;
  cash: CashUpDto;
  counts: SalesCounts;
  topSellers: TopSellerRow[];
}

export interface SalesPeriodDto {
  from: string;
  to: string;
  vat: VatSummaryDto;
  topSellers: TopSellerRow[];
}

export type CategoryReportMode = "at_time_of_sale" | "current";

/**
 * One node of the category report. `name` is `""` for `uncategorised` and `not_recorded` (the screen
 * names those); a `free_text` node's `id` and `name` are the recorded free-text category. `gross` and
 * `net` include the children; `direct` is the lines whose own category is this node.
 */
export interface CategoryTotalDto {
  kind: "category" | "uncategorised" | "not_recorded" | "free_text";
  id: string;
  name: string;
  depth: number;
  gross: string;
  net: string;
  direct: { gross: string; net: string; lines: number };
  children: CategoryTotalDto[];
}

export interface CategorySalesDto {
  mode: CategoryReportMode;
  tree: CategoryTotalDto[];
  gross: string;
  net: string;
  grossComplete: boolean;
  linesWithoutGross: number;
}

export interface ReportPrinter {
  id: string;
  name: string;
}

export interface PrintCategorySalesInput {
  from: string;
  to: string;
  mode: CategoryReportMode;
  extrasIntoDish: boolean;
  printerId: string;
}

/** `period` is the server's own token: `01`..`12` for a month, `1T`..`4T` for a quarter. */
export interface VatReturnFileInput {
  year: number;
  period: string;
  declarationType: string;
}

// ── Diagnostics (recent logs + runtime verbosity) types ──────────────────────────────────────────

export type DiagnosticsLine = {
  at: string;
  level: string;
  event: string;
  requestId?: string;
} & Record<string, unknown>;

export type Verbosity = { level: "debug" | "info"; revertsAt: string | null };

// ── Backup admin (recovery-key wizard) types ─────────────────────────────────────────────────────

export type BackupSchedule =
  | { kind: "interval"; ms: number }
  | {
      kind: "wall-clock";
      days: "daily" | number[];
      at: { hour: number; minute: number } | "auto";
    };

export type BackupDestinationStatus = {
  id: string;
  lastBackupAt: string | null;
  ageSeconds: number | null;
  stale: boolean;
};

export type BackupFreshness =
  { configured: false } | { configured: true; destinations: BackupDestinationStatus[] };

export interface CloudConnectionStatus {
  replacementEligible?: boolean;
  replacementPending?: boolean;
  replacementError?: string | null;
  replacementApproval?: null | { requestId: string; code: string; openCloudUrl: string };
  replacement?: null | {
    requestId: string;
    pointId: string;
    venueId: string;
    oldInstallationId: string;
    localVenueId: string;
    nodeId: string;
    environment: "test";
    publicKey: string;
    peerPublicKey: string;
    state: "awaiting_owner" | "complete";
    expiresAt: string;
    organisationName: string;
    legalBusinessName: string;
    registration: CloudConnectionStatus["registration"] | null;
  };
  installation?: {
    state: "pending" | "active" | "unavailable" | "revoked";
    revision: number;
    lastContactAt: string | null;
    leaseExpiresAt: string | null;
    services: {
      service: "remote_access" | "continuous_backup" | "retained_snapshots";
      state: "unconfigured" | "provisioning" | "ready" | "failed";
      health: "unknown" | "healthy" | "degraded" | "failed";
      failure: string | null;
      observedAt: string | null;
    }[];
  };
  configured: boolean;
  isPrimary: boolean;
  state: "not_connected" | "awaiting_cloud" | "awaiting_local" | "complete";
  code: string;
  openCloudUrl?: string;
  requestId?: string;
  expiresAt?: string;
  localVenueId?: string;
  environment?: "test" | "production";
  organisationId?: string;
  legalBusinessId?: string;
  organisationName?: string;
  legalBusinessName?: string;
  registration?: {
    venueId: string;
    installationId: string;
    organisationId: string;
    legalBusinessId: string;
  };
}

/** One machine in the venue's signed membership chart (`listServers`,
 * `apps/server/src/membership-removal.ts`). */
export interface ServerRow {
  nodeId: string;
  /** `""` when the machine gave no address. */
  contactUrl: string;
  standing: "serving-primary" | "serving-secondary" | "sell-only" | "evicted";
  isSelf: boolean;
  removable: boolean;
  canClear: boolean;
}

/** `term` is null, and `nodes` empty, when this server holds no chart. */
export interface ServerListing {
  term: number | null;
  nodes: ServerRow[];
}

/** Never carries the recovery key: the server strips it (`projectStatus`,
 * `apps/server/src/backup-api.ts`). */
export interface BackupStatusView {
  enabled: boolean;
  isPrimary: boolean;
  managedByEnvironment: boolean;
  destinations: { id: string; dir: string }[];
  schedule?: BackupSchedule;
  retention?: { count: number; days: number };
  keyFingerprint?: string;
  keyRotatedAt?: string;
  backupStatus: BackupFreshness;
  archiveUnderCurrentKey: boolean;
  /** Whether the box holds a recovery key at all, archives on or off. */
  recoveryKeySet: boolean;
  /** The held key is under the length floor. */
  recoveryKeyTooShort: boolean;
}

/** LOCAL copy of the server's `Alert` (`packages/module/src/alerts.ts`). */
export interface AlertView {
  key: string;
  kind: "event" | "ongoing";
  code: string;
  params: Record<string, unknown>;
  severity: "warning" | "error";
  since: string | null;
  area: string;
  screen?: string;
  handledAt?: string;
  handledBy?: string | null;
  /** An event's source: `device`, or the job that raised it. Ongoing alerts carry none. */
  source?: string;
  deviceId?: string | null;
  deviceName?: string | null;
}

export interface AlertsResponse {
  visible: boolean;
  alerts: AlertView[];
}

export interface BackupApplyBody {
  destinationDir: string;
  /** Omitted when the box already holds a key: the server uses that one. */
  recoveryKey?: string;
  schedule: BackupSchedule;
  retention: { count: number; days: number };
}

/** LOCAL copy of `@waitron/stream`'s `StreamStatus`: a supervisor's state, running or stopped. */
export interface StreamSupervisorStatus {
  state: "off" | "opening" | "streaming" | "paused" | "refused";
  generation: string | null;
  reason: string | null;
  stateSince: string;
  bucketProblem: { reason: string; since: string } | null;
  lagMs: number;
  lastConfirmedUploadAt: string | null;
}

/** LOCAL copy of `@waitron/stream`'s `StreamView`: a supervisor's status; a copy whose
 * settings are stored but that has no supervisor, with why; or plain off. */
export type StreamStatusView =
  StreamSupervisorStatus | { state: "off"; reason: string; stateSince: string } | { state: "off" };

/** `GET /api/backup/stream` — LOCAL copy of `apps/server/src/stream-api.ts`'s `StreamSettingsView`.
 * Never carries the secret access key. */
export interface StreamSettingsView {
  isPrimary: boolean;
  configured: boolean;
  bucket: {
    endpoint: string | null;
    region: string;
    bucket: string;
    prefix: string;
    accessKeyId: string;
  } | null;
  status: StreamStatusView;
  /** True for a key under the length floor too, which has no fingerprint. */
  recoveryKeySet: boolean;
  keyFingerprint: string | null;
}

/** The bucket form's body: a blank `endpoint` means an Amazon bucket, a blank `prefix` the bucket
 * root. */
export interface StreamBucketBody {
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  accessKeyId: string;
  secretAccessKey: string;
}

// ── Card payments (providers + readers) ──────────────────────────────────────────────────────────

export interface PaymentProviderRow {
  providerId: string;
  state: "connected" | "not_connected";
  canUnpair: boolean;
}

export interface ReaderRow {
  id: string;
  provider: string;
  name: string;
  active: boolean;
  canEnable: boolean;
  deviceCount: number;
  deviceNames: string[];
}

/** A reader some device holds or has a payment in progress on. */
export interface ReaderHolderRow {
  readerId: string;
  holder: EquipmentHolder | null;
  paymentInProgressDeviceIds: string[];
}

export interface AvailableReader {
  providerRef: string;
  name: string;
  model?: string;
  serial?: string;
  registeredAt?: string;
  status: "available" | "disabled" | "added";
}

export interface ReaderStatusView {
  online: boolean;
  batteryPercent?: number;
  connection?: string;
  activity?: string;
  firmwareVersion?: string;
  lastSeenAt?: string;
  model?: string;
  serial?: string;
  unreachable?: boolean;
  pairingStatus?: "processing" | "paired";
}

/** An open order's card payment that nothing is driving any more, typically after a restart. */
export interface StuckPaymentRow {
  paymentId: string;
  workingOrderId: string;
  orderNumber: number;
  label: string | null;
  /** The device that started it, or the job source that did; the name outlives a revocation. */
  source: string;
  deviceId: string | null;
  deviceName: string | null;
  provider: string;
  amount: string;
  startedAt: string;
}

export type StuckPaymentResolution =
  { outcome: "filed"; invoiceNumber: string } | { outcome: "not_charged"; orderUnlocked: boolean };

export interface StuckBillPaymentRow {
  billPaymentId: string;
  workingOrderId: string;
  orderNumber: number;
  label: string | null;
  /** The device that started it, or the job source that did; the name outlives a revocation. */
  source: string;
  deviceId: string | null;
  deviceName: string | null;
  method: "card";
  applied: string;
  tip: string;
  startedAt: string;
  provider: string | null;
  providerState: string | null;
}

export interface StuckBillRefundRow {
  refundId: string;
  billPaymentId: string;
  workingOrderId: string;
  orderNumber: number;
  label: string | null;
  /** The device that started it, or the job source that did; the name outlives a revocation. */
  source: string;
  deviceId: string | null;
  deviceName: string | null;
  appliedAmount: string;
  tipAmount: string;
  reason: string;
  requestedAt: string;
  sentAt: string | null;
  sendCount: number;
  provider: string | null;
}

export type BillRecoveryOutcome =
  | { outcome: "received"; invoiceNumber?: string }
  | { outcome: "not_charged" }
  | { outcome: "completed" }
  | { outcome: "failed" };

export const ORDER_STATUS_FILTERS = [
  "all",
  "open",
  "waiting_for_payment",
  "left_without_paying",
  "unpaid",
  "paid",
  "cancelled",
  "voided",
] as const;
export type OrderStatusFilter = (typeof ORDER_STATUS_FILTERS)[number];
export type OrderStatus = Exclude<OrderStatusFilter, "all" | "unpaid">;
export interface OrdersQuery {
  status: OrderStatusFilter;
  from?: string;
  to?: string;
  anyDate: boolean;
  credited: boolean;
  staff?: string;
  table?: string;
  q?: string;
}
export interface OrderRowDto {
  kind: "bill" | "sale";
  id: string;
  at: string;
  orderNumber: number | null;
  label: string | null;
  partyId: string | null;
  partyName: string | null;
  tables: string[];
  counter: boolean;
  saleId: string | null;
  invoiceNumber: string | null;
  invoiceType: "F1" | "F2" | null;
  creditNotes: string[];
  status: OrderStatus;
  credited: "in_full" | "in_part" | null;
  total: string;
  stillOwed: string | null;
  staff: { id: string; name: string | null }[];
  departedAt: string | null;
}
export interface OrdersPageDto {
  rows: OrderRowDto[];
  next: string | null;
  from: string | null;
  to: string | null;
}
export interface OrderDetailDto {
  row: OrderRowDto;
  lines: {
    lineNo: number;
    name: string;
    variantName: string | null;
    quantity: string;
    total: string;
    listUnitPrice: string | null;
    creditedTo: string | null;
  }[];
  invoices: {
    kind: "invoice" | "credit_note" | "substitution";
    invoiceType?: "F1" | "F2";
    recipient?: { taxId: string; legalName: string; countryCode: string; address: string };
    taxpayerDomicile?: string;
    number: string;
    issuedAt: string;
    total: string;
    rungBy: string | null;
  }[];
  tenders: { method: string; amount: string; tip: string }[];
  payments: {
    method: string;
    state: string;
    applied: string;
    tip: string;
    createdAt: string;
    refunds: { applied: string; tip: string; state: string; reason: string; createdAt: string }[];
  }[];
  party: {
    name: string | null;
    guestCount: number | null;
    openedAt: string;
    closedAt: string | null;
    openedBy: string | null;
    closedBy: string | null;
    tables: string[];
  } | null;
  departure: {
    recordedAt: string;
    reason: string;
    recordedBy: string | null;
    authorizedBy: string | null;
    amount: string;
  } | null;
  reprints: {
    requestedAt: string;
    personId: string;
    personName: string | null;
    printerName: string;
  }[];
}

/** Above three Stripe attempts that go silent for 80 s once connected (`defaultMakeStripe`, in
 * payments-stripe's card-provider.ts); a slow sender or a connection slow to open can take longer. */
const CARD_PROVIDER_READ_LIMIT_MS = 250_000;
/** Keep above the battery deadline in apps/server/src/alert-sources.ts; no shared constant enforces it. */
const ALERTS_READ_LIMIT_MS = 55_000;

export class DashboardApi {
  readonly liveData = new LiveData();
  #menuRevision: { value?: MenuReadRevision } = {};
  get menuWriteRevision(): MenuReadRevision | undefined {
    return this.#menuRevision.value;
  }
  #background?: DashboardApi;
  #onError?: (code: string) => void;

  get background(): DashboardApi {
    if (this.#background) return this.#background;
    this.#background = new DashboardApi(this.#baseUrl, this.#fetch, this.#onError, undefined, true);
    this.#background.#menuRevision = this.#menuRevision;
    return this.#background;
  }
  readonly #request: DashboardRequest;
  readonly #baseUrl: string;
  readonly #fetch: FetchLike;
  #localesPromise?: Promise<{
    locales: Array<{ code: string; label: string }>;
    venueDefault: string;
    loginDefault: string;
    venueName: string;
    onboardingIntent?: "demo" | "prepare" | "live";
  }>;

  constructor(
    baseUrl = "",
    fetchImpl: FetchLike = fetch,
    onError?: (code: string) => void,
    onSuccess?: (path: string) => void,
    passive = false,
  ) {
    this.#baseUrl = baseUrl;
    this.#fetch = fetchImpl;
    this.#onError = onError;
    const observedFetch: FetchLike = async (path, init) => {
      const response = await fetchImpl(path, init);
      if (init.method !== "GET" && response.ok) {
        let revision: unknown;
        try {
          revision = JSON.parse(response.headers.get("x-waitron-menu-revision") ?? "null");
        } catch {
          revision = null;
        }
        if (
          revision !== null &&
          typeof revision === "object" &&
          "epoch" in revision &&
          typeof revision.epoch === "string" &&
          "sequence" in revision &&
          typeof revision.sequence === "number" &&
          Number.isSafeInteger(revision.sequence) &&
          revision.sequence >= 0
        ) {
          const previous = this.#menuRevision.value;
          if (previous?.epoch !== revision.epoch || previous.sequence < revision.sequence)
            this.#menuRevision.value = { epoch: revision.epoch, sequence: revision.sequence };
        } else this.#menuRevision.value = undefined;
      }
      return response;
    };
    this.#request = createRequest({
      baseUrl,
      fetchImpl: observedFetch,
      onError,
      onSuccess,
      passive,
    });
  }

  getStaffRoster(): Promise<RosterEntry[]> {
    return this.#request<RosterEntry[]>("/management-api/staff-roster", "GET");
  }

  getLocales(): Promise<{
    locales: Array<{ code: string; label: string }>;
    venueDefault: string;
    loginDefault: string;
    venueName: string;
    onboardingIntent?: "demo" | "prepare" | "live";
  }> {
    this.#localesPromise ??= this.#request<{
      locales: Array<{ code: string; label: string }>;
      venueDefault: string;
      loginDefault: string;
      venueName: string;
      onboardingIntent?: "demo" | "prepare" | "live";
    }>("/management-api/locales", "GET").catch((err) => {
      this.#localesPromise = undefined;
      throw err;
    });
    return this.#localesPromise;
  }

  login(input: {
    email: string;
    password: string;
    totp?: string;
    recoveryCode?: string;
  }): Promise<{ personId: string; offerPasskey: boolean }> {
    return this.#request<{ personId: string; offerPasskey: boolean }>(
      "/management-api/session",
      "POST",
      input,
    );
  }

  passkeyOfferSeen(): Promise<void> {
    return this.#request<void>("/management-api/session/me/passkey-offer", "POST");
  }

  requestPasswordReset(email: string): Promise<void> {
    return this.#request<void>("/management-api/password-reset", "POST", { email });
  }

  inspectAccountAction(
    token: string,
    purpose: "invitation" | "password_reset",
  ): Promise<{ email: string; purpose: "invitation" | "password_reset" }> {
    return this.#request("/management-api/account-actions/inspect", "POST", { token, purpose });
  }

  getProfile(): Promise<OwnProfile> {
    return this.#request<OwnProfile>("/management-api/session/me/profile", "GET");
  }
  getGoogleConfig(): Promise<{ configured: boolean; privacyNoticeUrl?: string }> {
    return this.#request<{ configured: boolean; privacyNoticeUrl?: string }>(
      "/management-api/google/config",
      "GET",
    );
  }
  beginGoogleLogin(): Promise<{ authorizationUrl: string }> {
    return this.#request<{ authorizationUrl: string }>("/management-api/google/login", "POST");
  }
  beginGoogleLink(input: ProfileCredentials): Promise<{ authorizationUrl: string }> {
    return this.#request<{ authorizationUrl: string }>(
      "/management-api/session/me/google",
      "POST",
      input,
    );
  }
  saveProfile(input: ProfileDetails): Promise<{ emailVerificationSent: boolean }> {
    return this.#request("/management-api/session/me/profile", "PUT", input);
  }
  confirmProfileEmail(code: string): Promise<{ email: string }> {
    return this.#request("/management-api/session/me/profile/email/confirm", "POST", { code });
  }
  changePassword(input: ProfileCredentials & { password: string }): Promise<void> {
    return this.#request<void>("/management-api/session/me/password", "PUT", input);
  }
  changePin(input: ProfileCredentials & { pin: string }): Promise<void> {
    return this.#request<void>("/management-api/session/me/pin", "PUT", input);
  }
  beginTotp(input: ProfileCredentials): Promise<{
    enrollmentId: string;
    secret: string;
    uri: string;
    expiresAt: string;
  }> {
    return this.#request("/management-api/session/me/totp/begin", "POST", input);
  }
  finishTotp(enrollmentId: string, code: string): Promise<{ codes: string[] }> {
    return this.#request("/management-api/session/me/totp/finish", "POST", {
      enrollmentId,
      code,
    });
  }
  regenerateRecoveryCodes(input: ProfileCredentials): Promise<{ codes: string[] }> {
    return this.#request("/management-api/session/me/recovery-codes", "POST", input);
  }
  disableTotp(input: ProfileCredentials): Promise<void> {
    return this.#request<void>("/management-api/session/me/totp", "DELETE", input);
  }
  unlinkGoogle(input: ProfileCredentials): Promise<void> {
    return this.#request<void>("/management-api/session/me/google", "DELETE", input);
  }
  removePasskey(id: string, input: ProfileCredentials): Promise<void> {
    return this.#request<void>(
      `/management-api/session/me/passkeys/${encodeURIComponent(id)}`,
      "DELETE",
      input,
    );
  }

  completeAccountAction(
    token: string,
    purpose: "invitation" | "password_reset",
    password: string,
    pin?: string,
  ): Promise<{ personId: string; authenticated: boolean }> {
    return this.#request<{ personId: string; authenticated: boolean }>(
      "/management-api/account-actions/complete",
      "POST",
      {
        token,
        purpose,
        password,
        ...(pin === undefined ? {} : { pin }),
      },
    );
  }

  getEmailInbox(): Promise<EmailInbox> {
    return this.#request<EmailInbox>("/management-api/email", "GET");
  }

  getTestEmail(id: string): Promise<TestEmail> {
    return this.#request<TestEmail>(
      `/management-api/email/message/${encodeURIComponent(id)}`,
      "GET",
    );
  }

  logout(): Promise<void> {
    return this.#request<void>("/management-api/session", "DELETE");
  }

  listStaff(): Promise<PersonSummary[]> {
    return this.#request<PersonSummary[]>("/management-api/staff", "GET");
  }

  createPerson(input: {
    displayName: string;
    firstNames: string;
    lastNames: string;
    telephone: string | null;
    role: PersonRole;
    email: string;
  }): Promise<{ id: string; invitationSent: boolean }> {
    return this.#request<{ id: string; invitationSent: boolean }>(
      "/management-api/staff",
      "POST",
      input,
    );
  }

  resendInvitation(id: string): Promise<{ invitationSent: boolean }> {
    return this.#request<{ invitationSent: boolean }>(
      `/management-api/staff/${id}/invitation`,
      "POST",
    );
  }

  savePerson(id: string, details: PersonEditDetails): Promise<void> {
    return this.#request<void>(`/management-api/staff/${id}`, "PUT", details);
  }

  resetPin(id: string): Promise<void> {
    return this.#request<void>(`/management-api/staff/${id}/reset-pin`, "POST");
  }

  deactivatePerson(id: string): Promise<void> {
    return this.#request<void>(`/management-api/staff/${id}/deactivate`, "POST");
  }

  resetLogin(id: string): Promise<{ invitationSent: boolean }> {
    return this.#request<{ invitationSent: boolean }>(
      `/management-api/staff/${id}/reset-login`,
      "POST",
    );
  }

  reactivatePerson(id: string): Promise<{ invitationSent: boolean }> {
    return this.#request<{ invitationSent: boolean }>(
      `/management-api/staff/${id}/reactivate`,
      "POST",
    );
  }

  passkeyRegisterOptions(input: ProfileCredentials): Promise<PasskeyChallenge> {
    return this.#request<PasskeyChallenge>(
      "/management-api/passkey/register/options",
      "POST",
      input,
    );
  }

  passkeyRegisterVerify(
    body: PasskeyVerification & { name?: string },
  ): Promise<{ credentialId: string }> {
    return this.#request<{ credentialId: string }>(
      "/management-api/passkey/register/verify",
      "POST",
      body,
    );
  }

  passkeySignals(): Promise<PasskeySignals> {
    return this.#request<PasskeySignals>("/management-api/passkey/signals", "GET");
  }

  passkeyAuthOptions(): Promise<PasskeyChallenge> {
    return this.#request<PasskeyChallenge>("/management-api/passkey/auth/options", "POST");
  }

  passkeyAuthVerify(body: PasskeyVerification): Promise<{ personId: string }> {
    return this.#request<{ personId: string }>("/management-api/passkey/auth/verify", "POST", body);
  }

  // ── Catalogue management ──────────────────────────────────────────────────────────────────────

  listCatalogues(): Promise<CatalogueSummary[]> {
    return this.#request<CatalogueSummary[]>("/management-api/catalogues", "GET");
  }

  getCatalogueSettings(): Promise<CatalogueSettings> {
    return this.#request<CatalogueSettings>("/management-api/catalogue-settings", "GET");
  }

  saveCatalogueSettings(
    input: Pick<CatalogueSettings, "defaultProductVatClass">,
  ): Promise<CatalogueSettings> {
    return this.#request<CatalogueSettings>("/management-api/catalogue-settings", "PUT", input);
  }

  saveCatalogueDefaultColor(color: string | null): Promise<CatalogueSettings> {
    return this.#request<CatalogueSettings>(
      "/management-api/catalogue-settings/default-color",
      "PUT",
      { color },
    );
  }

  getContentLanguages(): Promise<ContentLanguages> {
    return this.#request<ContentLanguages>("/api/content-languages", "GET");
  }

  getContentLanguageRules(): Promise<ContentLanguageRules> {
    return this.#request<ContentLanguageRules>("/management-api/content-language-rules", "GET");
  }

  getContentTranslationGaps(): Promise<LanguageTranslationGaps[]> {
    return this.#request<LanguageTranslationGaps[]>(
      "/management-api/content-translation-gaps",
      "GET",
    );
  }

  getContentTranslationTargets(
    language: string,
    query: TranslationQuery,
  ): Promise<TranslationPage> {
    const params = new URLSearchParams();
    if (query.after !== undefined) params.append("after", query.after);
    for (const ref of query.targets ?? []) params.append("target", `${ref.kind}:${ref.id}`);
    const suffix = params.size ? `?${params}` : "";
    return this.#request(
      `/management-api/content-translations/${encodeURIComponent(language)}${suffix}`,
      "GET",
    );
  }

  saveContentTranslations(
    language: string,
    batch: TranslationBatch,
  ): Promise<{ saved: TranslationTarget[] }> {
    return this.#request(
      `/management-api/content-translations/${encodeURIComponent(language)}`,
      "PUT",
      batch,
    );
  }

  updateContentLanguages(config: ContentLanguages): Promise<void> {
    return this.#request<void>("/management-api/content-languages", "PUT", config);
  }

  createCatalogue(
    name: string,
    details: Omit<SectionInput, "internalName"> = {},
  ): Promise<CatalogueSummary> {
    return this.#request<CatalogueSummary>("/management-api/catalogues", "POST", {
      name,
      ...details,
    });
  }

  renameCatalogue(id: string, name: string): Promise<void> {
    return this.#request<void>(`/management-api/catalogues/${id}`, "PATCH", { name });
  }

  getMenuRead(id: string, parts: readonly MenuReadPart[]): Promise<MenuReadResult> {
    const query = parts.map((part) => `part=${encodeURIComponent(part)}`).join("&");
    return this.#request<MenuReadResult>(
      `/management-api/catalogues/${encodeURIComponent(id)}/read?${query}`,
      "GET",
    );
  }

  getMenuStructure(id: string): Promise<MenuStructure> {
    return this.#request<MenuStructure>(`/management-api/catalogues/${id}/structure`, "GET");
  }

  getMenuPrices(id: string): Promise<MenuPriceRow[]> {
    return this.#request<MenuPriceRow[]>(`/management-api/catalogues/${id}/prices`, "GET");
  }

  /** Every menu's publication status, keyed by menu id. */
  getMenuStatuses(): Promise<Record<string, MenuStatus>> {
    return this.#request<Record<string, MenuStatus>>("/management-api/catalogues/status", "GET");
  }

  getMenuStatus(id: string): Promise<MenuStatus> {
    return this.#request<MenuStatus>(`/management-api/catalogues/${id}/status`, "GET");
  }

  getMenuPreview(id: string): Promise<MenuPreview> {
    return this.#request<MenuPreview>(`/management-api/catalogues/${id}/preview`, "GET");
  }

  /** The menu's working Device Home Page: every shortcut in order, the ones its structure no longer
   * reaches marked, and both devices' display settings. */
  getMenuHome(menuId: string): Promise<MenuHome> {
    return this.#request<MenuHome>(`/management-api/catalogues/${menuId}/home`, "GET");
  }

  /** A target the menu's structure does not reach is refused `menu.shortcut_unreachable`. */
  addHomeShortcut(menuId: string, ref: MemberRef): Promise<SectionMember> {
    return this.#request(`/management-api/catalogues/${menuId}/home/shortcuts`, "POST", { ref });
  }

  removeHomeShortcut(menuId: string, memberId: string): Promise<void> {
    return this.#request<void>(
      `/management-api/catalogues/${menuId}/home/shortcuts/${memberId}`,
      "DELETE",
    );
  }

  /** Answers every shortcut in its new order. */
  moveHomeShortcut(
    menuId: string,
    memberId: string,
    to: number,
  ): Promise<SectionMember<TileRef>[]> {
    return this.#request(
      `/management-api/catalogues/${menuId}/home/shortcuts/${memberId}/position`,
      "PUT",
      { to },
    );
  }

  /** A value outside the device's range is refused `menu.home_display_invalid`. */
  setHomeDisplay(menuId: string, device: HomeDevice, patch: Partial<HomeDisplay>): Promise<void> {
    return this.#request<void>(`/management-api/catalogues/${menuId}/home-display`, "PATCH", {
      device,
      ...patch,
    });
  }

  /** `expectedHash` is the preview's; a menu edited since is refused `menu.changed_since_preview`. */
  publishMenu(id: string, expectedHash: string): Promise<PublishedMenuVersion> {
    return this.#request<PublishedMenuVersion>(`/management-api/catalogues/${id}/publish`, "POST", {
      expectedHash,
    });
  }

  getMenuPublications(menuId: string): Promise<MenuPublicationsAnswer> {
    return this.#request<MenuPublicationsAnswer>(
      `/management-api/catalogues/${menuId}/publications`,
      "GET",
    );
  }

  scheduleMenuPublication(
    menuId: string,
    input: { expectedHash: string; activatesAt: ActivationTime },
  ): Promise<QueuedEdition> {
    return this.#request<QueuedEdition>(
      `/management-api/catalogues/${menuId}/publications`,
      "POST",
      input,
    );
  }

  rescheduleMenuPublication(
    menuId: string,
    versionId: string,
    input: { activatesAt: ActivationTime },
  ): Promise<QueuedEdition> {
    return this.#request<QueuedEdition>(
      `/management-api/catalogues/${menuId}/publications/${versionId}`,
      "PATCH",
      input,
    );
  }

  cancelMenuPublication(menuId: string, versionId: string): Promise<void> {
    return this.#request<void>(
      `/management-api/catalogues/${menuId}/publications/${versionId}/cancel`,
      "POST",
    );
  }

  /** A null `grossPrice` clears the menu's price, so the product's own applies. */
  updateMenuItem(
    menuId: string,
    menuItemId: string,
    input: { grossPrice?: string | null },
  ): Promise<void> {
    return this.#request<void>(
      `/management-api/catalogues/${menuId}/items/${menuItemId}`,
      "PATCH",
      input,
    );
  }

  /** A null `price` clears this menu's price for the variant, so it inherits again. */
  setMenuVariantPrice(
    menuId: string,
    menuItemId: string,
    variantId: string,
    price: string | null,
  ): Promise<void> {
    return this.#request<void>(
      `/management-api/catalogues/${menuId}/items/${menuItemId}/variants/${variantId}`,
      "PATCH",
      { price },
    );
  }

  // ── Location menus (which catalogues a location sells) ─────────────────────────────────────────

  listLocationCatalogues(locationId: string): Promise<LocationCatalogueSummary[]> {
    return this.#request<LocationCatalogueSummary[]>(
      `/management-api/locations/${locationId}/catalogues`,
      "GET",
    );
  }

  addLocationCatalogue(locationId: string, catalogueId: string): Promise<void> {
    return this.#request<void>(`/management-api/locations/${locationId}/catalogues`, "POST", {
      catalogueId,
    });
  }

  removeLocationCatalogue(locationId: string, catalogueId: string): Promise<void> {
    return this.#request<void>(
      `/management-api/locations/${locationId}/catalogues/${catalogueId}`,
      "DELETE",
    );
  }

  setLocationDefaultCatalogue(locationId: string, catalogueId: string): Promise<void> {
    return this.#request<void>(`/management-api/locations/${locationId}/default-catalogue`, "PUT", {
      catalogueId,
    });
  }

  listCategories(): Promise<CategorySummary[]> {
    return this.#request<CategorySummary[]>("/management-api/categories", "GET");
  }

  moveCatalogueItems(selection: CatalogueSelection, to: string | null): Promise<void> {
    return this.#request("/management-api/folders/move", "POST", { ...selection, to });
  }

  deleteCatalogueItems(
    selection: CatalogueSelection,
    contents: FolderContents,
    shown: ShownFolderCounts[],
  ): Promise<void> {
    return this.#request("/management-api/folders/delete", "POST", {
      ...selection,
      contents,
      shown,
    });
  }

  summariseFolders(categoryIds: string[]): Promise<FolderSummary[]> {
    const query = categoryIds.map((id) => `id=${encodeURIComponent(id)}`).join("&");
    return this.#request(`/management-api/folders/summary?${query}`, "GET");
  }

  /** How many Active menus the products are on, each menu counted once. */
  async countProductMenus(productIds: string[]): Promise<number> {
    const query = productIds.map((id) => `id=${encodeURIComponent(id)}`).join("&");
    const { menus } = await this.#request<{ menus: number }>(
      `/management-api/products/menus?${query}`,
      "GET",
    );
    return menus;
  }

  createCategory(input: CategoryInput): Promise<CategorySummary> {
    return this.#request<CategorySummary>("/management-api/categories", "POST", input);
  }

  getCategory(id: string): Promise<CategorySummary> {
    return this.#request(`/management-api/categories/${id}`, "GET");
  }
  updateCategory(id: string, input: Partial<CategoryInput>): Promise<CategorySummary> {
    return this.#request(`/management-api/categories/${id}`, "PATCH", input);
  }
  listLibraryProducts(): Promise<Product[]> {
    return this.#request("/management-api/products", "GET");
  }
  listUnits(): Promise<Unit[]> {
    return this.#request<Unit[]>("/management-api/units", "GET");
  }

  listUnitProducts(id: string): Promise<ProductUsingUnit[]> {
    return this.#request<ProductUsingUnit[]>(`/management-api/units/${id}/products`, "GET");
  }

  getUnitExtraUsage(id: string): Promise<ExtraOfferUsage[]> {
    return this.#request<ExtraOfferUsage[]>(`/management-api/units/${id}/extra-usage`, "GET");
  }

  createUnit(input: UnitInput): Promise<Unit> {
    return this.#request<Unit>("/management-api/units", "POST", input);
  }

  updateUnit(id: string, patch: UnitPatch): Promise<Unit> {
    return this.#request<Unit>(`/management-api/units/${id}`, "PATCH", patch);
  }

  deleteUnit(id: string): Promise<void> {
    return this.#request<void>(`/management-api/units/${id}`, "DELETE");
  }

  reassignProductsUnit(
    id: string,
    productIds: string[],
    targetUnitId: string | null,
  ): Promise<ProductUsingUnit[]> {
    return this.#request<ProductUsingUnit[]>(
      `/management-api/units/${id}/products/reassign`,
      "POST",
      { productIds, unitId: targetUnitId },
    );
  }

  listProducts(catalogueId: string): Promise<Product[]> {
    return this.#request<Product[]>(`/management-api/catalogues/${catalogueId}/products`, "GET");
  }

  listMadeAt(): Promise<Record<string, MadeAt>> {
    return this.#request<Record<string, MadeAt>>("/management-api/products/made-at", "GET");
  }

  getFolderRouting(): Promise<RoutingView> {
    return this.#request<RoutingView>("/management-api/venue-service/routing", "GET");
  }

  getProductEditor(id: string): Promise<ProductEditorValue> {
    return this.#request<ProductEditorValue>(`/management-api/products/${id}/editor`, "GET");
  }

  getProductExtraUsage(id: string): Promise<ExtraOfferUsage[]> {
    return this.#request<ExtraOfferUsage[]>(`/management-api/products/${id}/extra-usage`, "GET");
  }

  createProductEditor(catalogueId: string, input: ProductEditorInput): Promise<ProductEditorValue> {
    return this.#request<ProductEditorValue>(
      `/management-api/catalogues/${catalogueId}/product-editor`,
      "POST",
      input,
    );
  }

  updateProductEditor(id: string, input: ProductEditorInput): Promise<ProductEditorValue> {
    return this.#request<ProductEditorValue>(`/management-api/products/${id}/editor`, "PUT", input);
  }

  // ── Options lists and extras lists (`/management-api/modifiers/{options,extras}`) ───────────────

  async listOptionLists(): Promise<OptionListRow[]> {
    return (
      await this.#request<{ optionLists: OptionListRow[] }>(
        "/management-api/modifiers/options",
        "GET",
      )
    ).optionLists;
  }
  async getOptionList(id: string): Promise<OptionList> {
    return (
      await this.#request<{ optionList: OptionList }>(
        `/management-api/modifiers/options/${id}`,
        "GET",
      )
    ).optionList;
  }
  async createOptionList(input: OptionListInput): Promise<OptionList> {
    return (
      await this.#request<{ optionList: OptionList }>(
        "/management-api/modifiers/options",
        "POST",
        input,
      )
    ).optionList;
  }
  async updateOptionList(id: string, input: OptionListInput): Promise<OptionList> {
    return (
      await this.#request<{ optionList: OptionList }>(
        `/management-api/modifiers/options/${id}`,
        "PATCH",
        input,
      )
    ).optionList;
  }
  async deleteOptionList(id: string): Promise<void> {
    await this.#request<{ ok: true }>(`/management-api/modifiers/options/${id}`, "DELETE");
  }
  async getOptionListDependants(id: string): Promise<OptionListDependants> {
    return (
      await this.#request<{ dependants: OptionListDependants }>(
        `/management-api/modifiers/options/${id}/dependants`,
        "GET",
      )
    ).dependants;
  }

  async listExtraLists(): Promise<ExtraListRow[]> {
    return (
      await this.#request<{ extraLists: ExtraListRow[] }>("/management-api/modifiers/extras", "GET")
    ).extraLists;
  }
  async getExtraList(id: string): Promise<ExtraList> {
    return (
      await this.#request<{ extraList: ExtraList }>(`/management-api/modifiers/extras/${id}`, "GET")
    ).extraList;
  }
  async createExtraList(input: ExtraListInput): Promise<ExtraList> {
    return (
      await this.#request<{ extraList: ExtraList }>(
        "/management-api/modifiers/extras",
        "POST",
        input,
      )
    ).extraList;
  }
  async updateExtraList(id: string, input: ExtraListInput): Promise<ExtraList> {
    return (
      await this.#request<{ extraList: ExtraList }>(
        `/management-api/modifiers/extras/${id}`,
        "PATCH",
        input,
      )
    ).extraList;
  }
  async deleteExtraList(id: string): Promise<void> {
    await this.#request<{ ok: true }>(`/management-api/modifiers/extras/${id}`, "DELETE");
  }
  async getExtraListDependants(id: string): Promise<ExtraListDependants> {
    return (
      await this.#request<{ dependants: ExtraListDependants }>(
        `/management-api/modifiers/extras/${id}/dependants`,
        "GET",
      )
    ).dependants;
  }

  // ── Menu sections (`/management-api/sections`) ─────────────────────────────────────────────

  createSectionIn(id: string, input: SectionInput): Promise<SectionDetails> {
    return this.#request(`/management-api/sections/${id}/sections`, "POST", input);
  }
  updateMenuDetails(id: string, input: SectionInput): Promise<void> {
    const { internalName, ...details } = input;
    return this.#request(`/management-api/catalogues/${id}`, "PATCH", {
      name: internalName,
      ...details,
    });
  }
  updateSection(id: string, patch: Partial<SectionInput>): Promise<SectionDetails> {
    return this.#request(`/management-api/sections/${id}`, "PATCH", patch);
  }
  deleteSection(id: string): Promise<void> {
    return this.#request(`/management-api/sections/${id}`, "DELETE");
  }
  listSectionMembers(id: string): Promise<SectionMember[]> {
    return this.#request(`/management-api/sections/${id}/members`, "GET");
  }
  addSectionMember(id: string, ref: MemberRef): Promise<SectionMember> {
    return this.#request(`/management-api/sections/${id}/members`, "POST", { ref });
  }
  /** Appends each product the section does not already hold. */
  addSectionProducts(id: string, productIds: string[]): Promise<{ added: number }> {
    return this.#request(`/management-api/sections/${id}/members/products`, "POST", {
      productIds,
    });
  }
  removeSectionMember(id: string, memberId: string): Promise<void> {
    return this.#request(`/management-api/sections/${id}/members/${memberId}`, "DELETE");
  }
  /** Answers the whole list in its new order. */
  moveSectionMember(id: string, memberId: string, to: number): Promise<SectionMember[]> {
    return this.#request(`/management-api/sections/${id}/members/${memberId}/position`, "PUT", {
      to,
    });
  }

  setIncludeFolder(
    listId: string,
    memberId: string,
    input: IncludeFolderInput,
  ): Promise<IncludeFolder> {
    return this.#request(
      `/management-api/sections/${listId}/members/${memberId}/folder`,
      "PUT",
      input,
    );
  }

  get imageLibraryRequest(): DashboardRequest {
    return this.#request;
  }

  // ── Ingredients & product recipes ──────────────────────────────────────────────────────────────

  listIngredients(): Promise<Ingredient[]> {
    return this.#request<Ingredient[]>("/management-api/ingredients", "GET");
  }

  createIngredient(input: IngredientInput): Promise<Ingredient> {
    return this.#request<Ingredient>("/management-api/ingredients", "POST", input);
  }

  updateIngredient(id: string, patch: IngredientPatch): Promise<void> {
    return this.#request<void>(`/management-api/ingredients/${id}`, "PATCH", patch);
  }

  getProductRecipe(productId: string): Promise<RecipeLine[]> {
    return this.#request<RecipeLine[]>(`/management-api/products/${productId}/recipe`, "GET");
  }

  setProductRecipe(productId: string, ingredientIds: string[]): Promise<void> {
    return this.#request<void>(`/management-api/products/${productId}/recipe`, "PUT", {
      ingredientIds,
    });
  }

  // ── Receipt-trim configuration ────────────────────────────────────────────────────────────────

  getVenueDetails(): Promise<VenueDetailsModel> {
    return this.#request("/management-api/venue-details", "GET");
  }

  getVenueClockPreview(clock: {
    timeZone: string;
    dayCutover: string;
  }): Promise<VenueClockPreview> {
    const query = new URLSearchParams(clock);
    return this.background.#request(`/management-api/venue-details/clock-preview?${query}`, "GET");
  }

  patchVenueDetails(
    input: VenueDetailWrite,
  ): Promise<{ changed: boolean; model: VenueDetailsModel }> {
    return this.#request("/management-api/venue-details", "PATCH", input);
  }

  getLocationSettings(): Promise<{ name: string; operationDescription: string }> {
    return this.#request("/management-api/location-settings", "GET");
  }

  putLocationSettings(operationDescription: string): Promise<void> {
    return this.#request("/management-api/location-settings", "PUT", { operationDescription });
  }

  /** `venueAddress` is this location's address as a receipt prints it, whatever `printAddress` says. */
  getReceipt(): Promise<{ receipt: ReceiptConfig; venueAddress: string[] }> {
    return this.#request("/management-api/receipt", "GET");
  }

  async getProfileScopeChoices(): Promise<ProfileScopeChoices> {
    const venue = await this.#request<ProfileScopeChoices>(
      "/management-api/venue-service/departments-and-zones",
      "GET",
    );
    return {
      departments: venue.departments.map(({ id, name, active }) => ({ id, name, active })),
      zones: venue.zones.map(({ id, name, departmentId, active }) => ({
        id,
        name,
        departmentId,
        active,
      })),
    };
  }

  async getVenueDepartments(): Promise<{ id: string; name: string; active: boolean }[]> {
    const venue = await this.#request<{
      departments: { id: string; name: string; active: boolean }[];
    }>("/management-api/venue-service/departments-and-zones", "GET");
    return venue.departments;
  }

  putReceipt(receipt: ReceiptConfig): Promise<void> {
    return this.#request<void>("/management-api/receipt", "PUT", { receipt });
  }

  getReceiptLanguage(): Promise<ReceiptLanguage> {
    return this.#request<ReceiptLanguage>("/management-api/receipt-language", "GET");
  }

  putReceiptLanguage(language: string): Promise<void> {
    return this.#request<void>("/management-api/receipt-language", "PUT", { language });
  }

  /** Draws a sample receipt with this trim, at the given paper width and in the given receipt
   * language if any; saves and prints nothing. */
  previewReceipt(
    receipt: ReceiptConfig,
    paperWidth?: PrintPaperWidth,
    language?: string,
    departmentId?: string,
  ): Promise<ReceiptPreview> {
    const width = paperWidth === undefined ? "" : `&paperWidth=${encodeURIComponent(paperWidth)}`;
    const drawnIn = language === undefined ? "" : `&language=${encodeURIComponent(language)}`;
    const department =
      departmentId === undefined ? "" : `&departmentId=${encodeURIComponent(departmentId)}`;
    return this.#request<ReceiptPreview>(
      `/management-api/receipt-preview?receipt=${encodeURIComponent(JSON.stringify(receipt))}${width}${drawnIn}${department}`,
      "GET",
    );
  }

  // ── Table service-status configuration ──────────────────────────────────────────────────────────

  listStatuses(): Promise<ServiceStatus[]> {
    return this.#request<ServiceStatus[]>("/management-api/service-statuses", "GET");
  }

  createStatus(input: {
    label: string;
    color: string;
    displayOrder?: number;
  }): Promise<{ id: string }> {
    return this.#request<{ id: string }>("/management-api/service-statuses", "POST", input);
  }

  updateStatus(
    id: string,
    patch: { label?: string; color?: string; displayOrder?: number; active?: boolean },
  ): Promise<void> {
    return this.#request<void>(`/management-api/service-statuses/${id}`, "PATCH", patch);
  }

  deactivateStatus(id: string): Promise<void> {
    return this.#request<void>(`/management-api/service-statuses/${id}`, "DELETE");
  }

  // ── Floor-plan zone + table configuration ──────────────────────────────────────────────────────

  listZones(): Promise<FloorZone[]> {
    return this.#request<FloorZone[]>("/management-api/zones", "GET");
  }

  updateZone(
    id: string,
    patch: { name?: string; displayOrder?: number; active?: boolean },
  ): Promise<void> {
    return this.#request<void>(`/management-api/zones/${id}`, "PATCH", patch);
  }

  deactivateZone(id: string): Promise<void> {
    return this.#request<void>(`/management-api/zones/${id}`, "DELETE");
  }

  listTables(options: { includeDisabled?: true } = {}): Promise<DashboardTable[]> {
    return this.#request<DashboardTable[]>(
      options.includeDisabled
        ? "/management-api/tables?includeDisabled=true"
        : "/management-api/tables",
      "GET",
    );
  }

  createTable(input: {
    label: string;
    capacity?: number;
    zoneId?: string;
  }): Promise<{ id: string }> {
    return this.#request<{ id: string }>("/management-api/tables", "POST", input);
  }

  updateTable(
    id: string,
    patch: { label?: string; zoneId?: string; capacity?: number; active?: boolean },
  ): Promise<void> {
    return this.#request<void>(`/management-api/tables/${id}`, "PATCH", patch);
  }

  deactivateTable(id: string): Promise<void> {
    return this.#request<void>(`/management-api/tables/${id}`, "DELETE");
  }

  async setTablePlacement(tableId: string, placement: TablePlacement): Promise<void> {
    await this.#request<void>(`/management-api/tables/${tableId}/placement`, "PUT", placement);
  }

  async clearPlacement(tableId: string): Promise<void> {
    await this.#request<void>(`/management-api/tables/${tableId}/placement`, "DELETE");
  }

  // ── Kitchen stations + routing ─────────────────────────────────────────────────────────────────

  getKitchenTimingDefaults(): Promise<KitchenTimingDefaults> {
    return this.#request<KitchenTimingDefaults>("/management-api/kitchen-timing-defaults", "GET");
  }

  setKitchenTimingDefaults(defaults: KitchenTimingDefaults): Promise<void> {
    return this.#request<void>("/management-api/kitchen-timing-defaults", "PUT", defaults);
  }

  listStations(): Promise<Station[]> {
    return this.#request<Station[]>("/management-api/stations", "GET");
  }

  listWatchers(): Promise<Watcher[]> {
    return this.#request<Watcher[]>("/management-api/watchers", "GET");
  }

  createStation(input: {
    name: string;
    displayOrder?: number;
    isDefault?: boolean;
    warmAfterMinutes?: number;
    overdueAfterMinutes?: number;
    forgottenAfterMinutes?: number;
  }): Promise<{ id: string }> {
    return this.#request<{ id: string }>("/management-api/stations", "POST", input);
  }

  updateStation(
    id: string,
    patch: {
      name?: string;
      displayOrder?: number;
      active?: boolean;
      showsRestOfOrder?: boolean;
      warmAfterMinutes?: number;
      overdueAfterMinutes?: number;
      forgottenAfterMinutes?: number;
    },
  ): Promise<void> {
    return this.#request<void>(`/management-api/stations/${id}`, "PATCH", patch);
  }

  deactivateStation(id: string): Promise<void> {
    return this.#request<void>(`/management-api/stations/${id}`, "DELETE");
  }

  setDefaultStation(id: string): Promise<void> {
    return this.#request<void>(`/management-api/stations/${id}/default`, "POST");
  }

  setBumpMode(mode: BumpMode): Promise<void> {
    return this.#request<void>("/management-api/bump-mode", "PUT", { mode });
  }

  getBumpMode(): Promise<{ mode: BumpMode }> {
    return this.#request<{ mode: BumpMode }>("/management-api/bump-mode", "GET");
  }

  // ── Kitchen courses + fire control ─────────────────────────────────────────────────────────────

  listCourses(): Promise<Course[]> {
    return this.#request<Course[]>("/management-api/courses", "GET");
  }

  listCoursesWithDisabled(): Promise<Course[]> {
    return this.#request<Course[]>("/management-api/courses?includeDisabled=true", "GET");
  }

  createCourse(input: { name: string; displayOrder?: number }): Promise<{ id: string }> {
    return this.#request<{ id: string }>("/management-api/courses", "POST", input);
  }

  updateCourse(
    id: string,
    patch: { name?: string; displayOrder?: number; active?: boolean },
  ): Promise<void> {
    return this.#request<void>(`/management-api/courses/${id}`, "PATCH", patch);
  }

  /** The server deletes the course when nothing names it, and disables it otherwise; with
   *  `disable`, it only ever disables it. */
  removeCourse(id: string, { disable }: { disable: boolean }): Promise<void> {
    return this.#request<void>(
      `/management-api/courses/${id}${disable ? "?disable=true" : ""}`,
      "DELETE",
    );
  }

  enableCourse(id: string): Promise<void> {
    return this.updateCourse(id, { active: true });
  }

  moveCourse(id: string, to: number): Promise<Course[]> {
    return this.#request<Course[]>(`/management-api/courses/${id}/position`, "PUT", { to });
  }

  getFireControl(): Promise<{ mode: FireControl }> {
    return this.#request<{ mode: FireControl }>("/management-api/fire-control", "GET");
  }

  setFireControl(mode: FireControl): Promise<void> {
    return this.#request<void>("/management-api/fire-control", "PUT", { mode });
  }

  // ── Devices ────────────────────────────────────────────────────────────────────────────────────

  listDevices(): Promise<DeviceRow[]> {
    return this.#request<DeviceRow[]>("/management-api/devices", "GET");
  }

  // ── Pairing mode + join requests ───────────────────────────────────────────────────────────────

  pairingMode(): Promise<PairingModeState> {
    return this.#request<PairingModeState>("/management-api/pairing-mode", "GET");
  }

  takePairingHold(): Promise<{ holdId: string; openUntil: string }> {
    return this.#request<{ holdId: string; openUntil: string }>(
      "/management-api/pairing-mode/holds",
      "POST",
    );
  }

  /** The route leaves the session's idle clock alone; call it through `background`. */
  renewPairingHold(holdId: string): Promise<{ openUntil: string }> {
    return this.#request<{ openUntil: string }>(
      `/management-api/pairing-mode/holds/${holdId}/renew`,
      "POST",
    );
  }

  releasePairingHold(holdId: string): Promise<void> {
    return this.#request<void>(`/management-api/pairing-mode/holds/${holdId}`, "DELETE");
  }

  joinRequests(kind: "device" | "print_agent"): Promise<JoinRequestRow[]> {
    return this.#request<JoinRequestRow[]>(`/management-api/join-requests?kind=${kind}`, "GET");
  }

  /** Three numbers, one of them this request's. The server does not say which, and the set is fixed
   * at join, so calling twice teaches nothing. */
  joinChallenge(id: string): Promise<{ choices: string[] }> {
    return this.#request<{ choices: string[] }>(
      `/management-api/join-requests/${id}/challenge`,
      "GET",
    );
  }

  /** A device's ask is named by `createdAt` too, because a returning device's next ask replaces it
   * under the same id; an ask already replaced is answered `join_request.not_found`, as one already
   * gone is. A print agent's ask needs no `createdAt`. */
  denyJoinRequest(id: string, ask?: { createdAt: string }): Promise<void> {
    return this.#request<void>(`/management-api/join-requests/${id}/deny`, "POST", ask);
  }

  /** A wrong `choice` is terminal: the server deletes the request before answering
   * `device.join_mismatch`, so the caller refreshes rather than offering a second attempt. A match
   * claims the request for this login and hold. `createdAt` names the ask, as on
   * {@link denyJoinRequest}. */
  checkDeviceJoinNumber(
    id: string,
    input: { choice: string; holdId: string; createdAt: string },
  ): Promise<void> {
    return this.#request<void>(`/management-api/device-join-requests/${id}/check`, "POST", input);
  }

  /** Refused `join_request.unclaimed` unless this login holds a live claim from
   * {@link checkDeviceJoinNumber}. */
  acceptDeviceJoinRequest(
    id: string,
    input: {
      name: string;
      profileId: string;
      stationId?: string;
      watcherId?: string;
    },
  ): Promise<{ deviceId: string; name: string; formFactor: FormFactor }> {
    return this.#request<{ deviceId: string; name: string; formFactor: FormFactor }>(
      `/management-api/device-join-requests/${id}/accept`,
      "POST",
      input,
    );
  }

  /** A wrong `choice` is terminal: the server deletes the request before answering
   * `device.join_mismatch`. */
  acceptPrintAgentJoinRequest(id: string, input: { choice: string }): Promise<void> {
    return this.#request<void>(
      `/management-api/print-agent-join-requests/${id}/accept`,
      "POST",
      input,
    );
  }

  listCanvases(): Promise<Canvas[]> {
    return this.#request<{ canvases: Canvas[] }>("/management-api/canvases", "GET").then(
      (r) => r.canvases,
    );
  }

  getCanvas(id: string): Promise<Canvas> {
    return this.#request<Canvas>(`/management-api/canvases/${id}`, "GET");
  }
  createCanvas(name: string, definition: unknown): Promise<{ id: string }> {
    return this.#request<{ id: string }>("/management-api/canvases", "POST", { name, definition });
  }
  updateCanvas(id: string, name: string, definition: unknown): Promise<void> {
    return this.#request<void>(`/management-api/canvases/${id}`, "PUT", { name, definition });
  }
  deleteCanvas(id: string): Promise<void> {
    return this.#request<void>(`/management-api/canvases/${id}`, "DELETE");
  }

  // ── Device profiles ──────────────────────────────────────────────────────────────────────────────

  listDeviceProfiles(): Promise<DeviceProfile[]> {
    return this.#request<{ deviceProfiles: DeviceProfile[] }>(
      "/management-api/device-profiles",
      "GET",
    ).then((r) => r.deviceProfiles);
  }

  getDeviceProfile(id: string): Promise<DeviceProfile> {
    return this.#request<DeviceProfile>(`/management-api/device-profiles/${id}`, "GET");
  }

  /** Every live profile's station and watcher lists, switched-off entries included. */
  listProfileKitchenLists(): Promise<({ profileId: string } & ProfileKitchenLists)[]> {
    return this.#request<{ lists: ({ profileId: string } & ProfileKitchenLists)[] }>(
      "/management-api/device-profile-kitchen-lists",
      "GET",
    ).then((r) => r.lists);
  }

  createDeviceProfile(
    name: string,
    canvasId: string | null,
    capabilities: string[],
    formFactor: FormFactor,
    inactivityTimeoutSeconds: number | null,
    printerLists: ProfilePrinterLists,
    /** A part left out takes the server's default: no lists, every role, no starting screen. */
    extras?: ProfileSaveExtras,
  ): Promise<DeviceProfile> {
    return this.#request<DeviceProfile>("/management-api/device-profiles", "POST", {
      name,
      canvasId,
      capabilities,
      formFactor,
      inactivityTimeoutSeconds,
      receiptPrinterIds: printerLists.receiptPrinterIds,
      paymentSlipPrinterIds: printerLists.paymentSlipPrinterIds,
      ...extras,
    });
  }

  updateDeviceProfile(
    id: string,
    name: string,
    canvasId: string | null,
    capabilities: string[],
    formFactor: FormFactor,
    inactivityTimeoutSeconds: number | null,
    printerLists: ProfilePrinterLists,
    /** A part left out stays as stored. */
    extras?: ProfileSaveExtras,
  ): Promise<DeviceProfile> {
    return this.#request<DeviceProfile>(`/management-api/device-profiles/${id}`, "PUT", {
      name,
      canvasId,
      capabilities,
      formFactor,
      inactivityTimeoutSeconds,
      receiptPrinterIds: printerLists.receiptPrinterIds,
      paymentSlipPrinterIds: printerLists.paymentSlipPrinterIds,
      ...extras,
    });
  }

  deleteDeviceProfile(id: string): Promise<void> {
    return this.#request<void>(`/management-api/device-profiles/${id}`, "DELETE");
  }

  revokeDevice(id: string): Promise<void> {
    return this.#request<void>(`/management-api/devices/${id}/revoke`, "POST");
  }

  /** Everything about a device but its card reader, which `setDeviceReader` saves. */
  updateDevice(
    id: string,
    input: {
      name: string;
      profileId: string;
      /** Absent or null clears it; a kitchen screen needs exactly one of this and `watcherId`. */
      stationId?: string | null;
      /** Absent or null clears it; a kitchen screen needs exactly one of this and `stationId`. */
      watcherId?: string | null;
      /** Null puts the role on Use default. */
      receiptPrinterId: string | null;
      paymentSlipPrinterId: string | null;
      /** Absent leaves the stored drawer choice; null is Use default. */
      cashDrawerPrinterId?: string | null;
      /** Absent leaves the device's stored made-here stations as they are. */
      madeHereStationIds?: string[];
      /** The profiles staff may switch to besides `profileId`; absent leaves them as they are. */
      approvedProfileIds?: string[];
    },
  ): Promise<void> {
    return this.#request<void>(`/management-api/devices/${id}`, "PATCH", input);
  }

  // ── Printing (print agents + printers + jobs) ────────────────────────────────────────────────────

  listAgents(): Promise<PrintAgentRow[]> {
    return this.#request<PrintAgentRow[]>("/management-api/print-agents", "GET");
  }

  updateAgent(id: string, patch: { name: string }): Promise<void> {
    return this.#request<void>(`/management-api/print-agents/${id}`, "PATCH", patch);
  }

  revokeAgent(id: string): Promise<void> {
    return this.#request<void>(`/management-api/print-agents/${id}/revoke`, "POST");
  }

  allowAgent(id: string): Promise<void> {
    return this.#request<void>(`/management-api/print-agents/${id}/allow`, "POST");
  }

  listPrinters(): Promise<Printer[]> {
    return this.#request<Printer[]>("/management-api/printers", "GET");
  }

  listPrinterProfiles(): Promise<PrinterProfileOffer[]> {
    return this.#request<PrinterProfileOffer[]>("/management-api/printer-profiles", "GET");
  }

  createPrinter(input: PrinterInput): Promise<{ id: string }> {
    return this.#request<{ id: string }>("/management-api/printers", "POST", input);
  }

  startPrinterDiscovery(): Promise<{ discoveryUntil: number }> {
    return this.#request<{ discoveryUntil: number }>(
      "/management-api/printer-discovery/start",
      "POST",
    );
  }

  /** The route leaves the session's idle clock alone; call it through `background` so the
   * dashboard's own sign-out timer stays put too. */
  renewPrinterDiscovery(): Promise<{ discoveryUntil: number }> {
    return this.#request<{ discoveryUntil: number }>(
      "/management-api/printer-discovery/renew",
      "POST",
    );
  }

  probePrinterAddress(input: { host: string; port: number }): Promise<PrinterAddressProbe> {
    return this.#request<PrinterAddressProbe>(
      "/management-api/printer-discovery/probe",
      "POST",
      input,
    );
  }

  listDiscoveredPrinters(): Promise<DiscoveredPrinter[]> {
    return this.#request<DiscoveredPrinter[]>("/management-api/discovered-printers", "GET");
  }

  pairBluetooth(
    agentId: string,
    address: string,
    pin: string,
  ): Promise<{ command: BluetoothCommandStatus }> {
    return this.#request<{ command: BluetoothCommandStatus }>(
      `/management-api/print-agents/${agentId}/bluetooth/pair`,
      "POST",
      { address, pin },
    );
  }

  forgetBluetoothPairing(
    agentId: string,
    address: string,
  ): Promise<{ command: BluetoothCommandStatus }> {
    return this.#request<{ command: BluetoothCommandStatus }>(
      `/management-api/print-agents/${agentId}/bluetooth/forget`,
      "POST",
      { address },
    );
  }

  updatePrinter(id: string, patch: PrinterPatch): Promise<void> {
    return this.#request<void>(`/management-api/printers/${id}`, "PATCH", patch);
  }

  setPrinterWatcher(printerId: string, watcherId: string | null): Promise<void> {
    return this.#request<void>(`/management-api/printers/${printerId}/watcher`, "PUT", {
      watcherId,
    });
  }

  deactivatePrinter(id: string): Promise<void> {
    return this.#request<void>(`/management-api/printers/${id}/deactivate`, "POST");
  }

  resendPrintJob(id: string): Promise<{ jobId: string }> {
    return this.#request<{ jobId: string }>(`/management-api/print-jobs/${id}/resend`, "POST");
  }

  getPrintJobPreview(id: string): Promise<PrintJobPreview> {
    return this.#request<PrintJobPreview>(`/management-api/print-jobs/${id}/preview`, "GET");
  }

  listDemoPrinterJobs(): Promise<DemoPrinterJob[]> {
    return this.#request<DemoPrinterJob[]>("/management-api/demo-printer/jobs", "GET");
  }

  listDemoReaderPayments(): Promise<{ payments: DemoReaderPayment[] }> {
    return this.#request<{ payments: DemoReaderPayment[] }>(
      "/management-api/demo-reader/payments",
      "GET",
    );
  }

  decideDemoReaderPayment(
    id: string,
    outcome: "captured" | "declined",
  ): Promise<{ decided: boolean }> {
    return this.#request<{ decided: boolean }>(
      `/management-api/demo-reader/payments/${id}/decision`,
      "POST",
      { outcome },
    );
  }

  listRecentJobs(): Promise<PrintJobRow[]> {
    return this.#request<PrintJobRow[]>("/management-api/print-jobs", "GET");
  }

  testPrint(printerId: string): Promise<{ jobId: string }> {
    return this.#request<{ jobId: string }>(
      `/management-api/printers/${printerId}/test-print`,
      "POST",
    );
  }

  printTestPage(printerId: string): Promise<{ jobId: string }> {
    return this.#request<{ jobId: string }>(
      `/management-api/printers/${printerId}/print-test-page`,
      "POST",
    );
  }

  testPrinterDrawer(printerId: string): Promise<{ jobId: string }> {
    return this.#request<{ jobId: string }>(
      `/management-api/printers/${printerId}/test-drawer`,
      "POST",
    );
  }

  sampleReceipt(
    printerId: string,
    settings: {
      paperWidth: PrintPaperWidth;
      resolution: PrintResolution;
    },
  ): Promise<{ jobId: string }> {
    return this.#request<{ jobId: string }>(
      `/management-api/printers/${printerId}/sample-receipt`,
      "POST",
      settings,
    );
  }

  // ── Station↔printer mapping ────────────────────────────────────────────────────────────────────
  // Attach and detach are both idempotent on the server.

  listPrinterStations(printerId: string): Promise<StationPrinter[]> {
    return this.#request<StationPrinter[]>(`/management-api/printers/${printerId}/stations`, "GET");
  }

  attachPrinterToStation(stationId: string, printerId: string): Promise<void> {
    return this.#request<void>(
      `/management-api/stations/${stationId}/printers/${printerId}`,
      "POST",
    );
  }

  detachPrinterFromStation(stationId: string, printerId: string): Promise<void> {
    return this.#request<void>(
      `/management-api/stations/${stationId}/printers/${printerId}`,
      "DELETE",
    );
  }

  // ── Shift planning (roster authoring) ──────────────────────────────────────────────────────────

  getLocations(): Promise<LocationSummary[]> {
    return this.#request<LocationSummary[]>("/management-api/locations", "GET");
  }

  getRoster(locationId: string, period: string): Promise<RosterSnapshot> {
    return this.#request<RosterSnapshot>(
      `/management-api/roster?locationId=${locationId}&period=${period}`,
      "GET",
    );
  }

  createRosterVersion(locationId: string, period: string): Promise<{ versionId: string }> {
    return this.#request<{ versionId: string }>("/management-api/roster", "POST", {
      locationId,
      period,
    });
  }

  addShift(versionId: string, input: ShiftInput): Promise<{ shiftId: string }> {
    return this.#request<{ shiftId: string }>(
      `/management-api/roster/${versionId}/shifts`,
      "POST",
      input,
    );
  }

  updateShift(shiftId: string, patch: ShiftPatch): Promise<void> {
    return this.#request<void>(`/management-api/roster/shifts/${shiftId}`, "PATCH", patch);
  }

  removeShift(shiftId: string): Promise<void> {
    return this.#request<void>(`/management-api/roster/shifts/${shiftId}`, "DELETE");
  }

  publishRoster(versionId: string): Promise<{ breaches: RosterBreach[] }> {
    return this.#request<{ breaches: RosterBreach[] }>(
      `/management-api/roster/${versionId}/publish`,
      "POST",
    );
  }

  // ── Approvals (shift swaps + absences) ──────────────────────────────────────────────────────────

  listPendingSwaps(): Promise<PendingSwap[]> {
    return this.#request<PendingSwap[]>("/management-api/swaps", "GET");
  }

  decideSwap(swapId: string, decision: "approved" | "rejected"): Promise<void> {
    return this.#request<void>(`/management-api/swaps/${swapId}/decide`, "POST", { decision });
  }

  listPendingAbsences(): Promise<PendingAbsence[]> {
    return this.#request<PendingAbsence[]>("/management-api/absences", "GET");
  }

  decideAbsence(absenceId: string, decision: "approved" | "rejected"): Promise<void> {
    return this.#request<void>(`/management-api/absences/${absenceId}/decide`, "POST", {
      decision,
    });
  }

  // ── Planned vs actual (worked-time comparison) ───────────────────────────────────────────────────

  getPlannedVsActual(locationId: string, from: string, to: string): Promise<PlannedVsActualRow[]> {
    return this.#request<PlannedVsActualRow[]>(
      `/management-api/planned-vs-actual?locationId=${locationId}&from=${from}&to=${to}`,
      "GET",
    );
  }

  // ── Staff self-service (my schedule) ─────────────────────────────────────────────────────────────
  // The server takes the acting person from the session, never from the request
  // (`apps/server/src/me-api.ts`).

  getMe(): Promise<{
    personId: string;
    role: PersonRole;
    email: string | null;
    locale: string | null;
    venueLocale: string;
    sessionDefault: string;
    permissions: string[];
    modules: string[];
    venueName: string;
    onboardingIntent?: "demo" | "prepare" | "live";
    sessionExpiresInSeconds?: number;
    sessionIdleTimeoutSeconds?: number;
  }> {
    return this.#request<{
      personId: string;
      role: PersonRole;
      email: string | null;
      locale: string | null;
      venueLocale: string;
      sessionDefault: string;
      permissions: string[];
      modules: string[];
      venueName: string;
      onboardingIntent?: "demo" | "prepare" | "live";
      sessionExpiresInSeconds?: number;
      sessionIdleTimeoutSeconds?: number;
    }>("/management-api/session/me", "GET");
  }

  putLocale(code: string): Promise<void> {
    return this.#request<void>("/management-api/session/me/locale", "PUT", { locale: code });
  }

  listMyShifts(from: string, to: string): Promise<MyShift[]> {
    return this.#request<MyShift[]>(
      `/management-api/me/schedule/shifts?from=${from}&to=${to}`,
      "GET",
    );
  }

  listMySwaps(): Promise<MySwap[]> {
    return this.#request<MySwap[]>("/management-api/me/schedule/swaps", "GET");
  }

  requestSwap(req: {
    fromShiftId: string;
    toPersonId: string;
    toShiftId: string | null;
  }): Promise<{ swapId: string }> {
    return this.#request<{ swapId: string }>("/management-api/me/schedule/swaps", "POST", req);
  }

  acceptSwap(swapId: string): Promise<void> {
    return this.#request<void>(`/management-api/me/schedule/swaps/${swapId}/accept`, "POST");
  }

  listMyAbsences(): Promise<MyAbsence[]> {
    return this.#request<MyAbsence[]>("/management-api/me/schedule/absences", "GET");
  }

  requestAbsence(req: {
    kind: AbsenceKind;
    startsOn: string;
    endsOn: string;
    note: string | null;
  }): Promise<{ absenceId: string }> {
    return this.#request<{ absenceId: string }>(
      "/management-api/me/schedule/absences",
      "POST",
      req,
    );
  }

  // ── Purchase invoices (facturas recibidas) ────────────────────────────────────────────────────

  listPurchaseInvoices(): Promise<PurchaseInvoice[]> {
    return this.#request<PurchaseInvoice[]>("/management-api/purchase-invoices", "GET");
  }

  createPurchaseInvoice(input: PurchaseInvoiceInput): Promise<PurchaseInvoice> {
    return this.#request<PurchaseInvoice>("/management-api/purchase-invoices", "POST", input);
  }

  updatePurchaseInvoice(id: string, patch: PurchaseInvoicePatch): Promise<void> {
    return this.#request<void>(`/management-api/purchase-invoices/${id}`, "PATCH", patch);
  }

  deletePurchaseInvoice(id: string): Promise<void> {
    return this.#request<void>(`/management-api/purchase-invoices/${id}`, "DELETE");
  }

  // ── Reporting (sales & takings) ─────────────────────────────────────────────────────────────────

  getSalesOverview(): Promise<SalesOverview> {
    return this.#request<SalesOverview>("/management-api/reports/overview", "GET");
  }

  getDailyClose(businessDay: string): Promise<DailyCloseDto> {
    return this.#request<DailyCloseDto>(
      `/management-api/reports/daily-close?businessDay=${businessDay}`,
      "GET",
    );
  }

  getSalesPeriod(from: string, to: string): Promise<SalesPeriodDto> {
    return this.#request<SalesPeriodDto>(
      `/management-api/reports/period?from=${from}&to=${to}`,
      "GET",
    );
  }

  listOrders(query: OrdersQuery, page: { after?: string } = {}): Promise<OrdersPageDto> {
    const params = new URLSearchParams();
    if (query.status !== "all") params.set("status", query.status);
    if (query.anyDate) params.set("anyDate", "true");
    else if (query.from !== undefined && query.to !== undefined) {
      params.set("from", query.from);
      params.set("to", query.to);
    }
    if (query.credited) params.set("credited", "true");
    if (query.staff !== undefined) params.set("staff", query.staff);
    if (query.table !== undefined) params.set("table", query.table);
    if (query.q !== undefined) params.set("q", query.q);
    if (page.after !== undefined) params.set("after", page.after);
    return this.#request<OrdersPageDto>(`/management-api/orders?${params}`, "GET");
  }

  /** Re-read every page on refresh so a row shown from an older page stays current. */
  async listOrderPages(query: OrdersQuery, pages: number): Promise<OrdersPageDto> {
    let page = await this.listOrders(query);
    const rows = [...page.rows];
    for (let n = 1; n < pages && page.next !== null; n++) {
      page = await this.listOrders(query, { after: page.next });
      rows.push(...page.rows);
    }
    return { ...page, rows };
  }

  listOrderStaff(): Promise<{ staff: { id: string; name: string | null }[] }> {
    return this.#request("/management-api/orders/staff", "GET");
  }

  getOrder(id: string): Promise<OrderDetailDto> {
    return this.#request(`/management-api/orders/${encodeURIComponent(id)}`, "GET");
  }

  getOrderPrinters(): Promise<{ id: string; name: string }[]> {
    return this.#request("/management-api/orders/printers", "GET");
  }

  reprintOrder(id: string, printerId: string): Promise<{ jobId: string }> {
    return this.#request(`/management-api/orders/${encodeURIComponent(id)}/reprint`, "POST", {
      printerId,
    });
  }

  getCategorySales(
    from: string,
    to: string,
    mode: CategoryReportMode,
    extrasIntoDish: boolean,
  ): Promise<CategorySalesDto> {
    return this.#request<CategorySalesDto>(
      `/management-api/reports/categories?from=${from}&to=${to}&mode=${mode}&extrasIntoDish=${extrasIntoDish}`,
      "GET",
    );
  }

  getReportPrinters(): Promise<ReportPrinter[]> {
    return this.#request<ReportPrinter[]>("/management-api/reports/printers", "GET");
  }

  printCategorySales(input: PrintCategorySalesInput): Promise<{ jobId: string }> {
    return this.#request<{ jobId: string }>(
      "/management-api/reports/categories/print",
      "POST",
      input,
    );
  }

  /** The DR303 file (modelo 303) for one period; the server answers its ISO-8859-1 bytes. */
  downloadVatReturnFile(input: VatReturnFileInput): Promise<Blob> {
    const params = new URLSearchParams({
      year: String(input.year),
      period: input.period,
      declarationType: input.declarationType,
    });
    return this.#request<Blob>(`/management-api/reports/modelo-303?${params}`, "GET", undefined, {
      as: "blob",
    });
  }

  getOverdueOrders(): Promise<{ orders: OverdueOrder[] }> {
    return this.#request<{ orders: OverdueOrder[] }>(
      "/management-api/reports/overdue-orders",
      "GET",
    );
  }

  getRecentLogs(limit = 200): Promise<{ lines: DiagnosticsLine[] }> {
    return this.#request<{ lines: DiagnosticsLine[] }>(
      `/management-api/diagnostics/recent?limit=${limit}`,
      "GET",
    );
  }

  getVerbosity(): Promise<Verbosity> {
    return this.#request<Verbosity>("/management-api/diagnostics/verbosity", "GET");
  }

  setVerbosity(level: "debug" | "info", ttlMinutes: number): Promise<void> {
    return this.#request<void>("/management-api/diagnostics/verbosity", "POST", {
      level,
      ttlMinutes,
    });
  }

  // ── Backup admin (recovery-key wizard) ────────────────────────────────────────────────────────

  refreshCloudConnection(): Promise<CloudConnectionStatus> {
    return this.#request("/management-api/cloud/refresh", "POST", {});
  }
  revokeCloudConnection(): Promise<CloudConnectionStatus> {
    return this.#request("/management-api/cloud/revoke", "POST", {});
  }
  getCloudStatus(): Promise<CloudConnectionStatus> {
    return this.#request("/management-api/cloud/status", "GET");
  }
  startCloudConnection(restart = false): Promise<CloudConnectionStatus> {
    return this.#request("/management-api/cloud/start", "POST", { restart });
  }
  checkCloudConnection(): Promise<CloudConnectionStatus> {
    return this.#request("/management-api/cloud/check", "POST", {});
  }
  prepareCloudReplacement(): Promise<CloudConnectionStatus> {
    return this.#request("/management-api/cloud/replacement/prepare", "POST", {});
  }
  checkCloudReplacement(): Promise<CloudConnectionStatus> {
    return this.#request("/management-api/cloud/replacement/check", "POST", {});
  }
  completeCloudConnection(choice: {
    requestId: string;
    organisationId: string;
    legalBusinessId: string;
  }): Promise<CloudConnectionStatus> {
    return this.#request("/management-api/cloud/complete", "POST", choice);
  }

  getBackupStatus(): Promise<BackupStatusView> {
    return this.#request<BackupStatusView>("/api/backup/status", "GET");
  }

  // ── Servers ───────────────────────────────────────────────────────────────────────────────────

  listServers(): Promise<ServerListing> {
    return this.#request<ServerListing>("/management-api/servers", "GET");
  }

  /** `removed` is false when the machine was already removed and nothing was written. */
  removeServer(nodeId: string): Promise<{ removed: boolean; term: number }> {
    return this.#request(`/management-api/servers/${encodeURIComponent(nodeId)}/remove`, "POST");
  }

  /** `cleared` is false when the machine was already cleared and nothing was written. */
  clearServer(nodeId: string): Promise<{ cleared: boolean; term: number }> {
    return this.#request(`/management-api/servers/${encodeURIComponent(nodeId)}/clear`, "POST");
  }

  // ── Alerts ────────────────────────────────────────────────────────────────────────────────────

  listAlerts(): Promise<AlertsResponse> {
    return this.#request<AlertsResponse>("/management-api/alerts", "GET", undefined, {
      timeLimitMs: ALERTS_READ_LIMIT_MS,
    });
  }

  listHandledAlerts(): Promise<AlertsResponse> {
    return this.#request<AlertsResponse>("/management-api/alerts/handled", "GET");
  }

  /** Succeeds when the incident is already handled. */
  markIncidentHandled(incidentId: string): Promise<void> {
    return this.#request<void>(
      `/management-api/alerts/incidents/${encodeURIComponent(incidentId)}/handled`,
      "POST",
    );
  }

  exportConfiguration(passphrase: string): Promise<Blob> {
    return this.#request<Blob>(
      "/management-api/configuration-export",
      "POST",
      { passphrase },
      { as: "blob" },
    );
  }

  mintBackupKey(): Promise<{ key: string }> {
    return this.#request<{ key: string }>("/api/backup/mint-key", "POST");
  }

  applyBackup(body: BackupApplyBody): Promise<BackupStatusView> {
    return this.#request<BackupStatusView>("/api/backup/apply", "POST", body);
  }

  getBackupRecoveryKey(): Promise<{ key: string | null }> {
    return this.#request<{ key: string | null }>("/api/backup/recovery-key", "GET");
  }

  /** Archives taken before the rotate still need the old key. */
  rotateBackupKey(body: { recoveryKey: string }): Promise<BackupStatusView> {
    return this.#request<BackupStatusView>("/api/backup/rotate", "POST", body);
  }

  getStreamSettings(): Promise<StreamSettingsView> {
    return this.#request<StreamSettingsView>("/api/backup/stream", "GET");
  }

  /** Tests the bucket, stores the settings and switches the copy on. */
  saveStreamSettings(body: StreamBucketBody): Promise<StreamSettingsView> {
    return this.#request<StreamSettingsView>("/api/backup/stream", "PUT", body);
  }

  /** Runs the bucket checks and stores nothing. */
  testStreamBucket(body: StreamBucketBody): Promise<{ ok: true }> {
    return this.#request<{ ok: true }>("/api/backup/stream/test", "POST", body);
  }

  /** What is already in the bucket stays there. */
  turnOffStream(): Promise<StreamSettingsView> {
    return this.#request<StreamSettingsView>("/api/backup/stream", "DELETE");
  }

  getRecoveryKit(): Promise<{ kit: string; keyFingerprint: string }> {
    return this.#request<{ kit: string; keyFingerprint: string }>("/api/backup/stream/kit", "GET");
  }

  // ── Card payments (providers + readers) ──────────────────────────────────────────────────────────

  listPaymentProviders(): Promise<PaymentProviderRow[]> {
    return this.#request<PaymentProviderRow[]>("/management-api/payments/providers", "GET");
  }

  disconnectPaymentProvider(id: string): Promise<void> {
    return this.#request<void>(`/management-api/payments/providers/${id}/disconnect`, "POST");
  }

  listReaders(): Promise<ReaderRow[]> {
    return this.#request<ReaderRow[]>("/management-api/payments/readers", "GET");
  }

  readerStatus(id: string): Promise<ReaderStatusView> {
    return this.#request<ReaderStatusView>(
      `/management-api/payments/readers/${id}/status`,
      "GET",
      undefined,
      { timeLimitMs: CARD_PROVIDER_READ_LIMIT_MS },
    );
  }

  availableReaders(providerId: string): Promise<AvailableReader[]> {
    return this.#request<AvailableReader[]>(
      `/management-api/payments/providers/${encodeURIComponent(providerId)}/available-readers`,
      "GET",
      undefined,
      { timeLimitMs: CARD_PROVIDER_READ_LIMIT_MS },
    );
  }

  adoptReader(input: {
    providerId: string;
    providerRef: string;
    name: string;
  }): Promise<{ id: string; status: "paired" }> {
    return this.#request<{ id: string; status: "paired" }>(
      "/management-api/payments/readers/adopt",
      "POST",
      input,
    );
  }

  renameReader(id: string, name: string): Promise<void> {
    return this.#request<void>(`/management-api/payments/readers/${id}`, "PATCH", { name });
  }

  disableReader(id: string): Promise<void> {
    return this.#request<void>(`/management-api/payments/readers/${id}/disable`, "POST");
  }

  enableReader(id: string): Promise<void> {
    return this.#request<void>(`/management-api/payments/readers/${id}/enable`, "POST");
  }

  unpairReader(id: string): Promise<void> {
    return this.#request<void>(`/management-api/payments/readers/${id}/unpair`, "POST");
  }

  getDeviceReader(id: string): Promise<{ readerId: string | null }> {
    return this.#request<{ readerId: string | null }>(
      `/management-api/payments/devices/${id}/reader`,
      "GET",
    );
  }

  /** Null puts the device on its profile's default reader. */
  setDeviceReader(id: string, readerId: string | null): Promise<void> {
    return this.#request<void>(`/management-api/payments/devices/${id}/reader`, "PUT", {
      readerId,
    });
  }

  listReaderHolders(): Promise<ReaderHolderRow[]> {
    return this.#request<ReaderHolderRow[]>("/management-api/payments/reader-holders", "GET");
  }

  getProfileReaders(profileId: string): Promise<ProfileReaderList> {
    return this.#request<ProfileReaderList>(
      `/management-api/payments/device-profiles/${profileId}/readers`,
      "GET",
    );
  }

  setProfileReaders(profileId: string, list: ProfileReaderList): Promise<ProfileReaderList> {
    return this.#request<ProfileReaderList>(
      `/management-api/payments/device-profiles/${profileId}/readers`,
      "PUT",
      list,
    );
  }

  listStuckPayments(): Promise<StuckPaymentRow[]> {
    return this.#request<StuckPaymentRow[]>("/management-api/payments/stuck", "GET");
  }

  resolveStuckPayment(paymentId: string): Promise<StuckPaymentResolution> {
    return this.#request<StuckPaymentResolution>(
      `/management-api/payments/stuck/${paymentId}/resolve`,
      "POST",
    );
  }

  listStuckBillPayments(): Promise<StuckBillPaymentRow[]> {
    return this.#request<StuckBillPaymentRow[]>("/management-api/payments/bill-payments", "GET");
  }

  listStuckBillRefunds(): Promise<StuckBillRefundRow[]> {
    return this.#request<StuckBillRefundRow[]>("/management-api/payments/bill-refunds", "GET");
  }

  resolveStuckBillPayment(id: string): Promise<BillRecoveryOutcome> {
    return this.#request<BillRecoveryOutcome>(
      `/management-api/payments/bill-payments/${id}/resolve`,
      "POST",
    );
  }

  attestStuckBillPayment(
    id: string,
    body: { outcome: "received" | "failed"; note: string; pin: string },
  ): Promise<BillRecoveryOutcome> {
    return this.#request<BillRecoveryOutcome>(
      `/management-api/payments/bill-payments/${id}/attest`,
      "POST",
      body,
    );
  }

  resolveStuckBillRefund(id: string): Promise<BillRecoveryOutcome> {
    return this.#request<BillRecoveryOutcome>(
      `/management-api/payments/bill-refunds/${id}/resolve`,
      "POST",
    );
  }

  attestStuckBillRefund(
    id: string,
    body: { outcome: "completed" | "failed"; note: string; pin: string },
  ): Promise<BillRecoveryOutcome> {
    return this.#request<BillRecoveryOutcome>(
      `/management-api/payments/bill-refunds/${id}/attest`,
      "POST",
      body,
    );
  }
}
