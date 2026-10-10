import type { DashboardRequest, LiveData } from "@waitron/dashboard-kit";
import type { PlanPlacement } from "@waitron/ui";
import { QUERY_DEPENDENCIES } from "./live-queries.js";
import { ModelWatches } from "./model-watch.js";
import { OpeningHoursApi } from "./opening-hours-client.js";

export type ServiceMode = "table_tab" | "prepay" | "ticket_then_pay";
export interface Department {
  id: string;
  name: string;
  tradingName: string;
  active: boolean;
}
export interface DepartmentRemovalImpact {
  zones: { id: string; name: string; activeTableCount: number }[];
}
export interface ServiceZone {
  id: string;
  name: string;
  departmentId: string;
  departmentName: string;
  serviceMode: ServiceMode;
  active?: boolean;
}
export type PaidWhen = "prepay" | "ticket_then_pay";
export type CollectionNumber = "none" | "numbered";
export type ReceiptPrintMode = "auto" | "on_request";
export interface DepartmentSalePolicy {
  orderStart: "table" | "counter";
  departmentId: string;
  paidWhen: PaidWhen;
  collectionNumber: CollectionNumber;
  receiptPrintMode: ReceiptPrintMode;
  printTradingName: boolean;
}
export interface ZoneSalePolicy {
  orderStart: "table" | "counter" | null;
  zoneId: string;
  paidWhen: PaidWhen | null;
  collectionNumber: CollectionNumber | null;
  receiptPrintMode: ReceiptPrintMode | null;
  effective: Omit<DepartmentSalePolicy, "departmentId">;
}
export interface DepartmentSettingsInput extends Omit<DepartmentSalePolicy, "departmentId"> {
  name: string;
  tradingName: string;
  transfers?: { receivingProfileId: string | null; destinationDepartmentIds: string[] };
}
export type ZoneServiceSettingsInput = Omit<ZoneSalePolicy, "zoneId" | "effective">;

export type VenueReadinessIssue =
  | { code: "venue.default_station_missing" }
  | { code: "venue.department_missing" }
  | { code: "zone.department_missing"; zoneId: string; zoneName: string }
  | { code: "department.no_periods"; departmentId: string; departmentName: string }
  | { code: "zone.menu_unpublished"; zoneId: string; zoneName: string }
  | {
      code: "zone.menu_empty";
      zoneId: string;
      zoneName: string;
      menuId: string;
      menuName: string;
    };
export interface NamedRow {
  id: string;
  name: string;
}
export interface FloorZone extends NamedRow {
  active?: boolean;
}
/** The part of a zone's master plan the zone panel draws (`ZonePlan`, apps/server/src/floor-plan.ts). */
export interface ZoneFloorPlan {
  zoneId: string;
  revision: number;
  tables: {
    id: string | null;
    liveTableId: string | null;
    label: string;
    fixed: boolean;
    placement: PlanPlacement | null;
  }[];
}
export interface VenueServiceModel {
  departments: Department[];
  zones: ServiceZone[];
  salePolicies: { departments: DepartmentSalePolicy[]; zones: ZoneSalePolicy[] };
  readiness: VenueReadinessIssue[];
  settings: VenueServiceSettings;
  kitchenTicketGrouping: KitchenTicketGrouping;
  printHeldWork: boolean;
  /** Minutes after the work fired before it is served that staff are reminded to fire the next
   * held group; null when reminders are off. */
  releaseReminderMinutes: number | null;
  clearingWorkflow: boolean;
}
export interface VenueServiceSettings {
  editSentLines: boolean;
}
export type VenueServiceSettingsView = Pick<
  VenueServiceModel,
  | "settings"
  | "kitchenTicketGrouping"
  | "printHeldWork"
  | "releaseReminderMinutes"
  | "clearingWorkflow"
>;
export type KitchenTicketGrouping = "combined" | "separate";
export interface VenueServiceChoices {
  floorZones: FloorZone[];
}
export type VenueServiceView = VenueServiceModel & VenueServiceChoices;

export interface DepartmentTransfersView {
  departmentId: string;
  receivingProfileId: string | null;
  destinationDepartmentIds: string[];
  profiles: NamedRow[];
}

export class VenueServiceApi {
  readonly openingHours: OpeningHoursApi;
  readonly #watches: ModelWatches;
  constructor(
    private readonly request: DashboardRequest,
    readonly liveData?: LiveData,
    private readonly passive = false,
  ) {
    this.openingHours = new OpeningHoursApi(request, liveData);
    this.#watches = new ModelWatches(liveData);
  }

  watchZoneFloorPlan(
    zoneId: string,
    apply: (plan: ZoneFloorPlan) => void,
    failed: (error: unknown) => void,
    recovered: () => void,
  ): () => void {
    return this.#watches.watch(
      `venue-service:floor-plan:${zoneId}`,
      QUERY_DEPENDENCIES["floor-plan"],
      () =>
        this.request<ZoneFloorPlan>(
          `/management-api/zones/${encodeURIComponent(zoneId)}/floor-plan`,
          "GET",
          undefined,
          { passive: true },
        ),
      apply,
      failed,
      recovered,
    );
  }

  get background(): VenueServiceApi {
    return new VenueServiceApi(this.request, this.liveData, true);
  }

  #read<T>(path: string): Promise<T> {
    return this.request<T>(path, "GET", undefined, { passive: this.passive });
  }

  async load(): Promise<VenueServiceView> {
    const [model, floorZones] = await Promise.all([
      this.#read<VenueServiceModel>("/management-api/venue-service"),
      this.#read<FloorZone[]>("/management-api/zones?includeInactive=true"),
    ]);
    return { ...model, floorZones };
  }

  async loadSettings(): Promise<VenueServiceSettingsView> {
    const model = await this.#read<VenueServiceModel>("/management-api/venue-service");
    return {
      settings: model.settings,
      kitchenTicketGrouping: model.kitchenTicketGrouping,
      printHeldWork: model.printHeldWork,
      releaseReminderMinutes: model.releaseReminderMinutes,
      clearingWorkflow: model.clearingWorkflow,
    };
  }

  loadSettingsReadOnly(): Promise<VenueServiceSettingsView> {
    return this.#read<VenueServiceSettingsView>("/management-api/venue-service/settings");
  }

  async loadDepartmentTransfers(departmentId: string): Promise<DepartmentTransfersView> {
    const path = `/management-api/venue-service/departments/${departmentId}/transfers`;
    const [settings, profiles] = await Promise.all([
      this.#read<Omit<DepartmentTransfersView, "profiles">>(path),
      this.#read<NamedRow[]>(`${path}/profiles`),
    ]);
    return { ...settings, profiles };
  }

  saveDepartmentTransfers(
    departmentId: string,
    input: Pick<DepartmentTransfersView, "receivingProfileId" | "destinationDepartmentIds">,
  ): Promise<void> {
    return this.request(
      `/management-api/venue-service/departments/${departmentId}/transfers`,
      "PUT",
      input,
    );
  }

  saveDepartmentSettings(departmentId: string, input: DepartmentSettingsInput): Promise<void> {
    return this.request(
      `/management-api/venue-service/departments/${departmentId}/settings`,
      "PUT",
      input,
    );
  }

  saveZoneServiceSettings(zoneId: string, input: ZoneServiceSettingsInput): Promise<void> {
    return this.request(
      `/management-api/venue-service/zones/${zoneId}/service-settings`,
      "PUT",
      input,
    );
  }

  createDepartment(input: { name: string; tradingName?: string }): Promise<Department> {
    return this.request("/management-api/venue-service/departments", "POST", input);
  }

  updateDepartment(
    departmentId: string,
    input: { name?: string; tradingName?: string; active?: boolean },
  ): Promise<void> {
    return this.request(
      `/management-api/venue-service/departments/${departmentId}`,
      "PATCH",
      input,
    );
  }

  deactivateDepartment(departmentId: string): Promise<void> {
    return this.request(`/management-api/venue-service/departments/${departmentId}`, "DELETE");
  }

  departmentRemovalImpact(departmentId: string): Promise<DepartmentRemovalImpact> {
    return this.#read(`/management-api/venue-service/departments/${departmentId}/removal-impact`);
  }

  zoneRemovalImpact(zoneId: string): Promise<DepartmentRemovalImpact> {
    return this.#read(`/management-api/venue-service/zones/${zoneId}/removal-impact`);
  }

  configureZone(zoneId: string, input: { departmentId: string }): Promise<void> {
    return this.request(`/management-api/venue-service/zones/${zoneId}`, "PUT", input);
  }

  createZone(input: {
    name: string;
    departmentId: string;
    displayOrder?: number;
  }): Promise<{ id: string }> {
    return this.request("/management-api/venue-service/zones", "POST", input);
  }

  updateZone(zoneId: string, patch: { name: string } | { active: true }): Promise<void> {
    return this.request(`/management-api/zones/${zoneId}`, "PATCH", patch);
  }

  deactivateZone(zoneId: string): Promise<void> {
    return this.request(`/management-api/zones/${zoneId}`, "DELETE");
  }

  setDepartmentSalePolicyField<K extends keyof Omit<DepartmentSalePolicy, "departmentId">>(
    departmentId: string,
    field: K,
    value: DepartmentSalePolicy[K],
  ): Promise<void> {
    return this.request(
      `/management-api/venue-service/departments/${departmentId}/sale-policy/${field}`,
      "PATCH",
      { value },
    );
  }

  setZoneSalePolicyOverride<
    K extends "orderStart" | "paidWhen" | "collectionNumber" | "receiptPrintMode",
  >(zoneId: string, field: K, value: ZoneSalePolicy[K]): Promise<void> {
    return this.request(
      `/management-api/venue-service/zones/${zoneId}/sale-policy/${field}`,
      "PATCH",
      { value },
    );
  }

  saveSettings(settings: VenueServiceSettings): Promise<void> {
    return this.request("/management-api/venue-service/settings", "PUT", settings);
  }

  saveKitchenTicketGrouping(kitchenTicketGrouping: KitchenTicketGrouping): Promise<void> {
    return this.request("/management-api/venue-service/settings/kitchen-ticket-grouping", "PUT", {
      kitchenTicketGrouping,
    });
  }

  savePrintHeldWork(printHeldWork: boolean): Promise<void> {
    return this.request("/management-api/venue-service/settings/print-held-work", "PUT", {
      printHeldWork,
    });
  }

  saveClearingWorkflow(clearingWorkflow: boolean): Promise<void> {
    return this.request("/management-api/venue-service/settings/clearing-workflow", "PUT", {
      clearingWorkflow,
    });
  }

  saveReleaseReminderMinutes(releaseReminderMinutes: number | null): Promise<void> {
    return this.request("/management-api/venue-service/settings/release-reminder-minutes", "PUT", {
      releaseReminderMinutes,
    });
  }
}
