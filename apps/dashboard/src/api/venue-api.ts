import type { CloudAddressOperation, CloudAddressReply } from "@waitron/country-packs";
import type { DashboardRequest } from "@waitron/dashboard-kit";
import type { BusinessDayClock, DepartmentReceiptWrite, DeleteImpact } from "@waitron/shared";
import type { PlanPlacement } from "@waitron/ui";
import type { DepartmentReceiptModel as DepartmentReceiptSettings } from "./department-receipts.js";
import { PaymentsApi } from "./payments-api.js";
import type { PrintJobPreview, PrintPaperWidth } from "./printing-api.js";

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
  | "geography_context"
  | "current_details_only"
  | "holiday_geography"
  | "clock_effects"
  | "business_day_history";

export type TradingAdmissionView = {
  state: "ready" | "unchecked" | "missing" | "invalid" | "restart_required";
};

export interface ZoneRepairView {
  nodeId: string;
  legalName: string;
  country: string;
  province: string | null;
  category: "missing" | "invalid" | "valid";
  eligible: boolean;
  clockRevision: number;
  timeZone?: string;
  choices: readonly string[];
  suggestion: string | null;
  admission: TradingAdmissionView;
  clock: {
    dayCutover: string;
    cutoverChanges: { effectiveBusinessDay: string; dayCutover: string }[];
  };
  preview?: {
    at: string;
    timeZone: string;
    civilDate: string;
    timeOfDay: string;
    offsetMinutes: number;
    businessDay: string;
    dayCutover: string;
  };
}

export interface VenueDetailsModel {
  businessDayClock: BusinessDayClockModel;
  details: VenueDetailValues;
  issuer: { country: string; legalName: string; taxId: string };
  taxpayerDomicile: string | null;
  bankAccount: { iban: string; bankName: string | null } | null;
  hasSales: boolean;
  hasOrderHistory: boolean;
  policy: Record<
    VenueDetailField,
    { decision: "allow" | "allow_with_warning" | "refuse"; reasons: DetailReason[] }
  >;
  provinces: { code: string; name: string }[];
  timeZones: readonly string[];
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

export interface BusinessDayClockModel {
  clock: BusinessDayClock;
  revision: number;
  currentBusinessDay: string | null;
  pending: null | {
    effectiveBusinessDay: string;
    dayCutover: string;
    startsAt: string;
  };
}

export interface BusinessDayStartInput {
  effectiveBusinessDay: string;
  dayCutover: string;
  expectedClockRevision: number;
}

export interface BusinessDayStartPreview {
  revision: number;
  previousDay: { businessDay: string; dayCutover: string; startAt: string; endAt: string };
  effectiveDay: { businessDay: string; dayCutover: string; startAt: string; endAt: string };
  conflicts: readonly {
    departmentId: string;
    departmentName?: string;
    zoneId?: string;
    zoneName?: string;
    weekday?: number;
    seasonId?: string;
    seasonName?: string;
    specialDayId?: string;
    specialDayName?: string;
    date?: string;
    periodId?: string;
    periodName?: string;
    startsAt?: string;
    endsAt?: string;
    rangeIndex: number;
    reason: "range" | "endpoint_day" | "all_day" | "transition_strip" | "overlap";
  }[];
  conflictCount: number;
  unlistedCount: number;
  backupDeadlines: VenueClockPreview["backupDeadlines"];
}
// ── Receipt-trim (configurable-till) types ────────────────────────────────────────────────────────

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
  /** The widths of the active devices' receipt printers, narrowest first; empty when none. */
  paperWidths: PrintPaperWidth[];
  /** True when the logo drawn is the venue's, because the draft names none of its own. */
  venueLogo: boolean;
}
/** The language the venue's receipts print in by default, which the venue's region may fix. */
export interface ReceiptLanguage {
  /** As stored, even when it is not one of `choices`. */
  language: string;
  choices: string[];
  /** `reason` is keyed by the dashboard's language code. */
  fixed: { locale: string; reason: Record<string, string> } | null;
}

export interface VenueDefaults {
  /** As stored, even when it is not one of `receiptLanguageChoices`. */
  receiptLanguage: string;
  receiptLanguageChoices: string[];
  fixedReceiptLanguage: string | null;
  /** The rate a new product's takeaway VAT starts at ("10.00"). */
  defaultTakeawayVatRate: string;
  /** Whether the venue's region charges takeaway VAT at its own rate. */
  takeawayVat: boolean;
  /** The takeaway rates a person may pick. */
  vatRates: string[];
}

export interface VenuePrivacy {
  privacyNoticeUrl: string | null;
  privacyEmail: string | null;
}
// ── Floor-plan types ─────────────────────────────────────────────────────────────────────────────

export interface FloorZone {
  id: string;
  name: string;
  displayOrder: number;
  active: boolean;
}

export interface DashboardTable {
  id: string;
  label: string;
  zoneId: string;
  planTableId: string | null;
  createdAt: string;
}
/** A set's layout of a zone as the server reads it (`ZonePlan`, apps/server/src/floor-plan.ts). */
export interface FloorPlan {
  zoneId: string;
  setId: string;
  setName: string;
  /** 0 when the set has no layout of the zone yet. */
  revision: number;
  savedAt: string | null;
  tables: {
    id: string;
    liveTableId: string | null;
    label: string;
    /** null for a table with none. */
    shortName: string | null;
    seats: number | null;
    fixed: boolean;
    placement: PlanPlacement | null;
    /** The ids of a joined table's parts; empty for any other table. */
    partIds: string[];
    /** The size a table off the plan had when it last left it. */
    keptSize: { width: number; height: number } | null;
  }[];
}
function layoutPath(setId: string, zoneId: string): string {
  return `/management-api/floor-plan-sets/${encodeURIComponent(setId)}/zones/${encodeURIComponent(zoneId)}/floor-plan`;
}
/** A master-plan save (`ZonePlanSave`); `key` names a table within the save. */
export interface FloorPlanSave {
  revision: number;
  tables: {
    id?: string;
    key: string;
    label: string;
    shortName: string;
    seats: number | null;
    fixed: boolean;
    placement: PlanPlacement | null;
    /** The keys of a joined table's parts; empty for any other table. */
    partKeys: string[];
  }[];
}

export class VenueApi extends PaymentsApi {
  readonly #request: DashboardRequest;
  constructor(request: DashboardRequest) {
    super(request);
    this.#request = request;
  }
  // ── Receipt-trim configuration ────────────────────────────────────────────────────────────────

  getVenueZoneRepair(timeZone?: string): Promise<ZoneRepairView> {
    const query = timeZone === undefined ? "" : `?timeZone=${encodeURIComponent(timeZone)}`;
    return this.#request(
      `/management-api/venue-details/time-zone-repair${query}`,
      "GET",
      undefined,
      { passive: true },
    );
  }
  confirmVenueZone(input: {
    timeZone: string;
    expectedClockRevision: number;
    confirmed: true;
  }): Promise<{ repaired: true; clockRevision: number; admission: "restart_required" }> {
    return this.#request("/management-api/venue-details/time-zone-repair", "POST", input);
  }
  addressLookup(operation: CloudAddressOperation): Promise<CloudAddressReply> {
    return this.#request("/management-api/address-lookup", "POST", operation);
  }
  getVenueDetails(): Promise<VenueDetailsModel> {
    return this.#request("/management-api/venue-details", "GET");
  }
  patchVenueDetails(
    input: VenueDetailWrite,
  ): Promise<{ changed: boolean; model: VenueDetailsModel }> {
    return this.#request("/management-api/venue-details", "PATCH", input);
  }
  renameTaxpayer(input: {
    legalName: string;
    expected: string;
  }): Promise<{ model: VenueDetailsModel }> {
    return this.#request("/management-api/venue-details/legal-name", "PUT", input);
  }
  changeTaxpayerDomicile(input: {
    taxpayerDomicile: string;
    expected: string;
  }): Promise<{ model: VenueDetailsModel }> {
    return this.#request("/management-api/venue-details/registered-address", "PUT", input);
  }
  saveBankAccount(input: {
    iban: string;
    bankName: string;
    expected: { iban: string; bankName: string };
  }): Promise<{ model: VenueDetailsModel }> {
    return this.#request("/management-api/venue-details/bank-account", "PUT", input);
  }
  putBusinessDayStart(
    input: BusinessDayStartInput,
  ): Promise<{ changed: boolean; model: VenueDetailsModel }> {
    return this.#request("/management-api/venue-details/business-day-start", "PUT", input);
  }
  async getVenueDepartments(): Promise<
    { id: string; name: string; active: boolean; isDefault: boolean }[]
  > {
    const venue = await this.#request<{
      departments: { id: string; name: string; active: boolean; isDefault: boolean }[];
    }>("/management-api/venue-service/departments-and-zones", "GET");
    return venue.departments;
  }
  getDepartmentReceipt(id: string): Promise<DepartmentReceiptSettings> {
    return this.#request(`/management-api/venue-service/departments/${id}/receipt`, "GET");
  }
  putDepartmentReceipt(id: string, input: DepartmentReceiptWrite): Promise<void> {
    return this.#request(`/management-api/venue-service/departments/${id}/receipt`, "PUT", input);
  }
  getReceiptLanguage(): Promise<ReceiptLanguage> {
    return this.#request<ReceiptLanguage>("/management-api/receipt-language", "GET");
  }
  getVenueDefaults(): Promise<VenueDefaults> {
    return this.#request<VenueDefaults>("/management-api/venue-defaults", "GET");
  }
  putVenueDefaults(
    changes: Partial<Pick<VenueDefaults, "receiptLanguage" | "defaultTakeawayVatRate">>,
  ): Promise<VenueDefaults> {
    return this.#request<VenueDefaults>("/management-api/venue-defaults", "PUT", changes);
  }
  getVenuePrivacy(): Promise<VenuePrivacy> {
    return this.#request<VenuePrivacy>("/management-api/venue-privacy", "GET");
  }
  putVenuePrivacy(changes: Partial<Record<keyof VenuePrivacy, string>>): Promise<VenuePrivacy> {
    return this.#request<VenuePrivacy>("/management-api/venue-privacy", "PUT", changes);
  }
  previewReceiptDraft(
    draft: DepartmentReceiptWrite & {
      departmentId: string;
      language?: string;
      paperWidth?: PrintPaperWidth;
    },
    options: { passive?: boolean } = {},
  ): Promise<ReceiptPreview> {
    return this.#request(
      "/management-api/receipt-preview",
      "POST",
      options.passive === true ? { ...draft, passive: true } : draft,
    );
  }
  getReceiptPaperWidths(): Promise<Pick<ReceiptPreview, "paperWidths">> {
    return this.#request("/management-api/receipt-preview/paper-widths", "GET");
  }
  // ── Floor-plan zone + table configuration ──────────────────────────────────────────────────────

  listZones(): Promise<FloorZone[]> {
    return this.#request<FloorZone[]>("/management-api/zones", "GET");
  }
  updateZone(id: string, patch: { name?: string; displayOrder?: number }): Promise<void> {
    return this.#request<void>(`/management-api/zones/${id}`, "PATCH", patch);
  }
  getZoneDeleteImpact(id: string): Promise<DeleteImpact> {
    return this.#request<DeleteImpact>(
      `/management-api/zones/${encodeURIComponent(id)}/delete-impact`,
      "GET",
    );
  }
  deleteZone(id: string): Promise<DeleteImpact> {
    return this.#request<DeleteImpact>(`/management-api/zones/${encodeURIComponent(id)}`, "DELETE");
  }
  getDepartmentDeleteImpact(id: string): Promise<DeleteImpact> {
    return this.#request<DeleteImpact>(
      `/management-api/venue-service/departments/${encodeURIComponent(id)}/delete-impact`,
      "GET",
    );
  }
  deleteDepartment(id: string): Promise<DeleteImpact> {
    return this.#request<DeleteImpact>(
      `/management-api/venue-service/departments/${encodeURIComponent(id)}`,
      "DELETE",
    );
  }
  getFloorPlan(setId: string, zoneId: string): Promise<FloorPlan> {
    return this.#request<FloorPlan>(layoutPath(setId, zoneId), "GET");
  }
  /** `ids` maps each saved table's `key` to its master table's id. */
  saveFloorPlan(
    setId: string,
    zoneId: string,
    body: FloorPlanSave,
  ): Promise<{ revision: number; ids: Record<string, string> }> {
    return this.#request<{ revision: number; ids: Record<string, string> }>(
      layoutPath(setId, zoneId),
      "PUT",
      body,
    );
  }
  listTables(options: { includeDisabled?: true } = {}): Promise<DashboardTable[]> {
    return this.#request<DashboardTable[]>(
      options.includeDisabled
        ? "/management-api/tables?includeDisabled=true"
        : "/management-api/tables",
      "GET",
    );
  }
}
