import type { DashboardRequest, LiveData } from "@waitron/dashboard-kit";

export type ServiceMode = "table_tab" | "prepay" | "ticket_then_pay";
export interface Department {
  id: string;
  name: string;
  tradingName: string;
  defaultServiceMode: ServiceMode;
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
  serviceModeOverride: ServiceMode | null;
  active?: boolean;
}
export type PaidWhen = "prepay" | "ticket_then_pay";
export type CollectionNumber = "none" | "numbered";
export type ReceiptPrintMode = "auto" | "on_request" | "never";
export interface DepartmentSalePolicy {
  departmentId: string;
  paidWhen: PaidWhen;
  collectionNumber: CollectionNumber;
  receiptPrintMode: ReceiptPrintMode;
  printTradingName: boolean;
}
export interface ZoneSalePolicy {
  zoneId: string;
  paidWhen: PaidWhen | null;
  collectionNumber: CollectionNumber | null;
  receiptPrintMode: ReceiptPrintMode | null;
  effective: Omit<DepartmentSalePolicy, "departmentId">;
}
export type VenueReadinessIssue =
  | { code: "venue.default_station_missing" }
  | { code: "venue.department_missing" }
  | { code: "zone.department_missing"; zoneId: string; zoneName: string }
  | { code: "zone.menu_missing"; zoneId: string; zoneName: string }
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

export class VenueServiceApi {
  constructor(
    private readonly request: DashboardRequest,
    readonly liveData?: LiveData,
    private readonly passive = false,
  ) {}

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

  createDepartment(input: {
    name: string;
    tradingName: string;
    defaultServiceMode: ServiceMode;
  }): Promise<Department> {
    return this.request("/management-api/venue-service/departments", "POST", input);
  }

  updateDepartment(
    departmentId: string,
    input:
      | {
          name: string;
          tradingName: string;
          defaultServiceMode: ServiceMode;
        }
      | { active: true },
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

  configureZone(
    zoneId: string,
    input: { departmentId: string; serviceMode: ServiceMode | null },
  ): Promise<void> {
    return this.request(`/management-api/venue-service/zones/${zoneId}`, "PUT", input);
  }

  createZone(input: { name: string; departmentId: string }): Promise<{ id: string }> {
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

  setZoneSalePolicyOverride<K extends "paidWhen" | "collectionNumber" | "receiptPrintMode">(
    zoneId: string,
    field: K,
    value: ZoneSalePolicy[K],
  ): Promise<void> {
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
