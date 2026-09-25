import type { ContentLanguages, SupportedLocale } from "@waitron/shared";
import type { CharacterSet } from "@waitron/printing/src/charset.js";

/**
 * Most types below are hand-kept copies of the server's JSON shapes, so nothing compares them with
 * the server at compile time. The product and modifier-list shapes are imported instead, from
 * catalogue's type-only leaf files (`scripts/dashboard-browser-purity.test.ts`).
 */
import type { TimingBand } from "@waitron/shared";
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
export type { Product, ProductEditorValue, ProductEditorVariant, ProductEditorInput };
import type {
  ExtraList,
  ExtraListDependants,
  ExtraListInput,
  ExtraListItem,
  ExtraListItemInput,
  OptionLabel,
  OptionLabelInput,
  OptionList,
  OptionListDependants,
  OptionListInput,
} from "@waitron/catalogue/src/modifier-list-types.js";
export type {
  ExtraList,
  ExtraListDependants,
  ExtraListInput,
  ExtraListItem,
  ExtraListItemInput,
  OptionLabel,
  OptionLabelInput,
  OptionList,
  OptionListDependants,
  OptionListInput,
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
  passkeys: Array<{ id: string; name: string | null; createdAt: string }>;
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
  name: Record<string, string>;
  image: string | null;
  color: string | null;
  parentId: string | null;
}
export interface CategoryInput {
  name: Record<string, string>;
  image?: string | null;
  color?: string | null;
  parentId?: string | null;
}
export interface CategoryDependants {
  /** Every product whose own main category is this one, variants included. */
  products: { id: string; name: string }[];
  children: { id: string; name: Record<string, string> }[];
  parentId: string | null;
  routes: { id: string; station: string | null; zone: string | null }[];
}
/** Where a deleted category's products and subcategories go; null is Uncategorised or the top
 * level, and an absent key takes the server's default, the deleted category's parent. */
export interface CategoryReassignment {
  productsTo?: string | null;
  childrenTo?: string | null;
}
export interface CategoryProduct {
  id: string;
  name: string;
  active: boolean;
  primaryCategoryId: string | null;
  labelIds: string[];
}
export interface Label {
  id: string;
  name: string;
}
export interface LabelSummary extends Label {
  productCount: number;
}

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
  available: boolean;
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

export interface Station {
  id: string;
  name: string;
  displayOrder: number;
  isDefault: boolean;
  active: boolean;
  warmAfterMinutes: number;
  overdueAfterMinutes: number;
  forgottenAfterMinutes: number;
}

export type BumpMode = "line" | "ticket";

export interface Course {
  id: string;
  name: string;
  displayOrder: number;
  active: boolean;
}

export interface DeviceRow {
  id: string;
  kind: string;
  stationId: string | null;
  label: string;
  active: boolean;
  lastSeenAt: string | null;
  enrolledAt: string;
  deviceProfileId: string | null;
}

export interface Canvas {
  id: string;
  name: string;
  definition: unknown;
}

export type FormFactor = "till" | "phone-portrait" | "tablet-landscape" | "kds";

export interface DeviceProfile {
  id: string;
  name: string;
  canvasId: string | null;
  capabilities: string[];
  formFactor: FormFactor;
  inactivityTimeoutSeconds: number | null;
}

/** Carries no verification number, deliberately: the list must never show the answer beside the
 * question. `label` is the name the joiner asked for, so it is untrusted text. */
export interface JoinRequestRow {
  id: string;
  kind: "device" | "print_agent";
  label: string;
  createdAt: string;
}

/** `refusedRecently` counts the knocks the shut window refused within `REFUSED_WINDOW_MS`
 * (`apps/server/src/pairing-mode.ts`). It is held in memory, so a restart resets it. */
export interface PairingModeState {
  open: boolean;
  openUntil: string | null;
  refusedRecently: number;
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

export type PrintTicketScope = "station" | "order";

export type PrintPaperWidth = "58mm" | "80mm";
export type PrintResolution = "180dpi" | "203dpi";
export type PrintCharacterSet = CharacterSet;

export type PrintJobStatus = "queued" | "printing" | "done" | "failed";

export interface PrintAgentRow {
  id: string;
  name: string;
  host: string | null;
  active: boolean;
  nodeId: string | null;
  lastSeenAt: string | null;
  enrolledAt: string;
}

export interface Printer {
  pendingJobs: number;
  lastPrintAt: string | null;
  id: string;
  name: string;
  transport: PrintTransport;
  host: string | null;
  port: number | null;
  localKey: string | null;
  pollId: string | null;
  ticketScope: PrintTicketScope;
  paperWidth: PrintPaperWidth;
  resolution: PrintResolution;
  characterSet: PrintCharacterSet;
  characterTable: number;
  active: boolean;
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
  characterSet?: PrintCharacterSet;
  characterTable?: number;
}

export interface PrinterAddressProbe {
  host: string;
  port: number;
  requestedAt: number;
  expiresAt: number;
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
  ticketScope?: PrintTicketScope;
  paperWidth?: PrintPaperWidth;
  resolution?: PrintResolution;
  characterSet?: PrintCharacterSet;
  characterTable?: number;
  active?: boolean;
}

export type PrintPreviewBlock =
  | { kind: "text"; text: string }
  | { kind: "feed"; lines: number }
  | { kind: "cut" }
  | { kind: "image"; width: number; height: number; data: string; qrData?: string };

export interface PrintJobPreview {
  columns: number;
  dpi: number;
  text: string;
  blocks: PrintPreviewBlock[];
  qrData: string[];
  omittedGraphics: boolean;
  truncated: boolean;
  unsupported: boolean;
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

export type ReceiptPrintMode = "auto" | "on_request" | "never";

export type DrawerOpenPolicy = "gated" | "open";

export interface Till {
  id: string;
  label: string;
  locationId: string;
  receiptPrinterId: string | null;
}

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

export interface TillCashUpRow {
  tillId: string;
  byMethod: TenderMethodRow[];
  cashTakings: string;
}

export interface CashUpDto {
  byTill: TillCashUpRow[];
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
  /** The held key is under the length floor; turning archives on replaces it. */
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

export interface AddReaderInput {
  providerId: string;
  name: string;
  [field: string]: string;
}

export class DashboardApi {
  readonly liveData = new LiveData();
  #background?: DashboardApi;
  #onError?: (code: string) => void;

  get background(): DashboardApi {
    return (this.#background ??= new DashboardApi(
      this.#baseUrl,
      this.#fetch,
      this.#onError,
      undefined,
      true,
    ));
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
    this.#request = createRequest({ baseUrl, fetchImpl, onError, onSuccess, passive });
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

  getContentLanguages(): Promise<ContentLanguages> {
    return this.#request<ContentLanguages>("/api/content-languages", "GET");
  }

  updateContentLanguages(config: ContentLanguages): Promise<void> {
    return this.#request<void>("/management-api/content-languages", "PUT", config);
  }

  createCatalogue(name: string): Promise<CatalogueSummary> {
    return this.#request<CatalogueSummary>("/management-api/catalogues", "POST", { name });
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

  createCategory(input: CategoryInput): Promise<CategorySummary> {
    return this.#request<CategorySummary>("/management-api/categories", "POST", input);
  }

  getCategory(id: string): Promise<CategorySummary> {
    return this.#request(`/management-api/categories/${id}`, "GET");
  }
  updateCategory(id: string, input: Partial<CategoryInput>): Promise<CategorySummary> {
    return this.#request(`/management-api/categories/${id}`, "PATCH", input);
  }
  deleteCategory(id: string, reassign?: CategoryReassignment): Promise<void> {
    return this.#request(`/management-api/categories/${id}`, "DELETE", reassign);
  }
  listCategoryProducts(
    id: string,
    options: { includeDescendants?: boolean } = {},
  ): Promise<CategoryProduct[]> {
    const query = options.includeDescendants ? "?descendants=1" : "";
    return this.#request(`/management-api/categories/${id}/products${query}`, "GET");
  }
  getCategoryDependants(id: string): Promise<CategoryDependants> {
    return this.#request(`/management-api/categories/${id}/dependants`, "GET");
  }
  /** Sets every listed product's main category to this one, moving it from wherever it was. */
  addProductsToCategory(id: string, productIds: string[]): Promise<void> {
    return this.#request(`/management-api/categories/${id}/products`, "POST", { productIds });
  }
  listLibraryProducts(): Promise<Product[]> {
    return this.#request("/management-api/products", "GET");
  }
  /** A null category makes the product Uncategorised. */
  setMainCategory(
    productId: string,
    categoryId: string | null,
  ): Promise<{ primaryCategoryId: string | null }> {
    return this.#request(`/management-api/products/${productId}/categories`, "PUT", {
      primaryCategoryId: categoryId,
    });
  }

  listLabels(): Promise<LabelSummary[]> {
    return this.#request("/management-api/labels", "GET");
  }
  createLabel(name: string): Promise<Label> {
    return this.#request("/management-api/labels", "POST", { name });
  }
  renameLabel(id: string, name: string): Promise<Label> {
    return this.#request(`/management-api/labels/${id}`, "PATCH", { name });
  }
  deleteLabel(id: string): Promise<void> {
    return this.#request(`/management-api/labels/${id}`, "DELETE");
  }
  getProductLabels(productId: string): Promise<{ labelIds: string[] }> {
    return this.#request(`/management-api/products/${productId}/labels`, "GET");
  }
  setProductLabels(productId: string, labelIds: string[]): Promise<{ labelIds: string[] }> {
    return this.#request(`/management-api/products/${productId}/labels`, "PUT", { labelIds });
  }

  listUnits(): Promise<Unit[]> {
    return this.#request<Unit[]>("/management-api/units", "GET");
  }

  listUnitProducts(id: string): Promise<ProductUsingUnit[]> {
    return this.#request<ProductUsingUnit[]>(`/management-api/units/${id}/products`, "GET");
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

  getProductEditor(id: string): Promise<ProductEditorValue> {
    return this.#request<ProductEditorValue>(`/management-api/products/${id}/editor`, "GET");
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

  async listOptionLists(): Promise<OptionList[]> {
    return (
      await this.#request<{ optionLists: OptionList[] }>("/management-api/modifiers/options", "GET")
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

  async listExtraLists(): Promise<ExtraList[]> {
    return (
      await this.#request<{ extraLists: ExtraList[] }>("/management-api/modifiers/extras", "GET")
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

  getLocationSettings(): Promise<{ name: string; operationDescription: string }> {
    return this.#request("/management-api/location-settings", "GET");
  }

  putLocationSettings(operationDescription: string): Promise<void> {
    return this.#request("/management-api/location-settings", "PUT", { operationDescription });
  }

  getReceipt(): Promise<{ receipt: ReceiptConfig }> {
    return this.#request<{ receipt: ReceiptConfig }>("/management-api/receipt", "GET");
  }

  putReceipt(receipt: ReceiptConfig): Promise<void> {
    return this.#request<void>("/management-api/receipt", "PUT", { receipt });
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

  createZone(input: { name: string; displayOrder?: number }): Promise<{ id: string }> {
    return this.#request<{ id: string }>("/management-api/zones", "POST", input);
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

  listTables(): Promise<DashboardTable[]> {
    return this.#request<DashboardTable[]>("/management-api/tables", "GET");
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
    patch: { label?: string; zoneId?: string; capacity?: number },
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

  listStations(): Promise<Station[]> {
    return this.#request<Station[]>("/management-api/stations", "GET");
  }

  createStation(input: {
    name: string;
    displayOrder?: number;
    isDefault?: boolean;
  }): Promise<{ id: string }> {
    return this.#request<{ id: string }>("/management-api/stations", "POST", input);
  }

  /** The three `*AfterMinutes` fields go together: the server refuses a patch naming only some of
   * them, or not ordered warm < overdue < forgotten, with `management.request_invalid`. */
  updateStation(
    id: string,
    patch: {
      name?: string;
      displayOrder?: number;
      active?: boolean;
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

  setCategoryStation(categoryId: string, stationId: string | null): Promise<void> {
    return this.#request<void>(`/management-api/categories/${categoryId}/station`, "PUT", {
      stationId,
    });
  }

  setBumpMode(mode: BumpMode): Promise<void> {
    return this.#request<void>("/management-api/bump-mode", "PUT", { mode });
  }

  // ── Kitchen courses + fire control ─────────────────────────────────────────────────────────────

  listCourses(): Promise<Course[]> {
    return this.#request<Course[]>("/management-api/courses", "GET");
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

  deactivateCourse(id: string): Promise<void> {
    return this.#request<void>(`/management-api/courses/${id}`, "DELETE");
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

  /** On an open window this moves the lapse to a full window from now, so Extend and Open are one
   * call. */
  openPairingMode(): Promise<{ openUntil: string }> {
    return this.#request<{ openUntil: string }>("/management-api/pairing-mode", "POST");
  }

  /** Open or extend the window for an open dialog without extending its authenticated session. */
  renewPairingMode(): Promise<{ openUntil: string }> {
    return this.#request<{ openUntil: string }>("/management-api/pairing-mode/renew", "POST");
  }

  /** Requests already pending stay pending and can still be accepted. */
  closePairingMode(): Promise<void> {
    return this.#request<void>("/management-api/pairing-mode", "DELETE");
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

  denyJoinRequest(id: string): Promise<void> {
    return this.#request<void>(`/management-api/join-requests/${id}/deny`, "POST");
  }

  /** A wrong `choice` is terminal: the server deletes the request before answering
   * `device.join_mismatch`, so the caller refreshes rather than offering a second attempt. */
  acceptDeviceJoinRequest(
    id: string,
    input: { choice: string; profileId: string; stationId?: string; registerId?: string },
  ): Promise<{ deviceId: string; name: string; formFactor: FormFactor }> {
    return this.#request<{ deviceId: string; name: string; formFactor: FormFactor }>(
      `/management-api/device-join-requests/${id}/accept`,
      "POST",
      input,
    );
  }

  /** A wrong `choice` is terminal, as in {@link acceptDeviceJoinRequest}. */
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

  createDeviceProfile(
    name: string,
    canvasId: string | null,
    capabilities: string[],
    formFactor: FormFactor,
    inactivityTimeoutSeconds: number | null,
  ): Promise<DeviceProfile> {
    return this.#request<DeviceProfile>("/management-api/device-profiles", "POST", {
      name,
      canvasId,
      capabilities,
      formFactor,
      inactivityTimeoutSeconds,
    });
  }

  updateDeviceProfile(
    id: string,
    name: string,
    canvasId: string | null,
    capabilities: string[],
    formFactor: FormFactor,
    inactivityTimeoutSeconds: number | null,
  ): Promise<DeviceProfile> {
    return this.#request<DeviceProfile>(`/management-api/device-profiles/${id}`, "PUT", {
      name,
      canvasId,
      capabilities,
      formFactor,
      inactivityTimeoutSeconds,
    });
  }

  deleteDeviceProfile(id: string): Promise<void> {
    return this.#request<void>(`/management-api/device-profiles/${id}`, "DELETE");
  }

  revokeDevice(id: string): Promise<void> {
    return this.#request<void>(`/management-api/devices/${id}/revoke`, "POST");
  }

  reassignDeviceProfile(id: string, deviceProfileId: string | null): Promise<void> {
    return this.#request<void>(`/management-api/devices/${id}/assign-device-profile`, "POST", {
      deviceProfileId,
    });
  }

  patchDeviceHardware(
    id: string,
    patch: {
      receiptPrinterId?: string | null;
      hasCashDrawer?: boolean;
    },
  ): Promise<{
    id: string;
    receiptPrinterId: string | null;
    hasCashDrawer: boolean;
  }> {
    return this.#request(`/management-api/devices/${id}/hardware`, "PATCH", patch);
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

  createPrinter(input: PrinterInput): Promise<{ id: string }> {
    return this.#request<{ id: string }>("/management-api/printers", "POST", input);
  }

  startPrinterDiscovery(): Promise<{ discoveryUntil: number }> {
    return this.#request<{ discoveryUntil: number }>(
      "/management-api/printer-discovery/start",
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

  updatePrinter(id: string, patch: PrinterPatch): Promise<void> {
    return this.#request<void>(`/management-api/printers/${id}`, "PATCH", patch);
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

  listRecentJobs(): Promise<PrintJobRow[]> {
    return this.#request<PrintJobRow[]>("/management-api/print-jobs", "GET");
  }

  testPrint(printerId: string): Promise<{ jobId: string; calibrationLocale: SupportedLocale }> {
    return this.#request<{ jobId: string; calibrationLocale: SupportedLocale }>(
      `/management-api/printers/${printerId}/test-print`,
      "POST",
    );
  }

  sampleReceipt(
    printerId: string,
    settings: {
      paperWidth: PrintPaperWidth;
      resolution: PrintResolution;
      characterSet: PrintCharacterSet;
      characterTable: number;
    },
  ): Promise<{ jobId: string }> {
    return this.#request<{ jobId: string }>(
      `/management-api/printers/${printerId}/sample-receipt`,
      "POST",
      settings,
    );
  }

  testCharacterTables(
    printerId: string,
    startTable: number,
  ): Promise<{ jobId: string; calibrationLocale: SupportedLocale }> {
    return this.#request<{ jobId: string; calibrationLocale: SupportedLocale }>(
      `/management-api/printers/${printerId}/character-table-test`,
      "POST",
      { startTable },
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

  // ── Receipt printer + print mode + drawer policy ───────────────────────────────────────────────

  listTills(): Promise<Till[]> {
    return this.#request<Till[]>("/management-api/tills", "GET");
  }

  setTillReceiptPrinter(tillId: string, printerId: string | null): Promise<void> {
    return this.#request<void>(`/management-api/tills/${tillId}/receipt-printer`, "PATCH", {
      printerId,
    });
  }

  setReceiptPrintMode(locationId: string, mode: ReceiptPrintMode): Promise<void> {
    return this.#request<void>(
      `/management-api/locations/${locationId}/receipt-print-mode`,
      "PATCH",
      {
        mode,
      },
    );
  }

  setDrawerOpenPolicy(locationId: string, policy: DrawerOpenPolicy): Promise<void> {
    return this.#request<void>(
      `/management-api/locations/${locationId}/drawer-open-policy`,
      "PATCH",
      {
        policy,
      },
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

  // ── Alerts ────────────────────────────────────────────────────────────────────────────────────

  listAlerts(): Promise<AlertsResponse> {
    return this.#request<AlertsResponse>("/management-api/alerts", "GET");
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

  /** The ordinary request helper parses JSON, so this binary response keeps its own small fetch
   * path. */
  async exportConfiguration(passphrase: string): Promise<Blob> {
    const response = await this.#fetch(`${this.#baseUrl}/management-api/configuration-export`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passphrase }),
    });
    if (!response.ok) {
      // Rejects with the shared request helper's `{ code, status }` shape, without its `params`.
      const parsed: unknown = await response.json().catch(() => undefined);
      const isRecord = (v: unknown): v is Record<string, unknown> =>
        typeof v === "object" && v !== null && !Array.isArray(v);
      const envelope = isRecord(parsed) && isRecord(parsed.error) ? parsed.error : undefined;
      const rawCode = envelope?.code;
      const code = typeof rawCode === "string" ? rawCode : "server.internal";
      throw { code, status: response.status };
    }
    return response.blob();
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

  connectPaymentProvider(
    id: string,
    payload: Record<string, string>,
  ): Promise<{ merchantName: string }> {
    return this.#request<{ merchantName: string }>(
      `/management-api/payments/providers/${id}/connect`,
      "POST",
      payload,
    );
  }

  disconnectPaymentProvider(id: string): Promise<void> {
    return this.#request<void>(`/management-api/payments/providers/${id}/disconnect`, "POST");
  }

  listReaders(): Promise<ReaderRow[]> {
    return this.#request<ReaderRow[]>("/management-api/payments/readers", "GET");
  }

  addReader(input: AddReaderInput): Promise<{ id: string; status: string }> {
    return this.#request<{ id: string; status: string }>(
      "/management-api/payments/readers",
      "POST",
      input,
    );
  }

  readerStatus(id: string): Promise<ReaderStatusView> {
    return this.#request<ReaderStatusView>(`/management-api/payments/readers/${id}/status`, "GET");
  }

  availableReaders(providerId: string): Promise<AvailableReader[]> {
    return this.#request<AvailableReader[]>(
      `/management-api/payments/providers/${encodeURIComponent(providerId)}/available-readers`,
      "GET",
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

  setDeviceReader(id: string, readerId: string | null): Promise<void> {
    return this.#request<void>(`/management-api/payments/devices/${id}/reader`, "PUT", {
      readerId,
    });
  }
}
