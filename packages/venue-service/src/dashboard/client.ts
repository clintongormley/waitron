import type { DashboardRequest, LiveData } from "@waitron/dashboard-kit";

export type ServiceMode = "table_tab" | "prepay" | "invoice_first" | "ticket_then_pay";
export interface Department {
  id: string;
  name: string;
  tradingName: string;
  defaultServiceMode: ServiceMode;
  active: boolean;
}
export interface ServiceZone {
  id: string;
  name: string;
  departmentId: string;
  departmentName: string;
  serviceMode: ServiceMode;
  serviceModeOverride: ServiceMode | null;
}
export interface HoursInterval {
  departmentId: string;
  weekday: number;
  opensAt: string;
  closesAt: string;
}
export interface ZoneMenu {
  zoneId: string;
  menuId: string;
  displayOrder: number;
  isDefault: boolean;
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
  hours: HoursInterval[];
  zoneMenus: ZoneMenu[];
  readiness: VenueReadinessIssue[];
  settings: VenueServiceSettings;
  kitchenTicketGrouping: KitchenTicketGrouping;
  printHeldWork: boolean;
  /** Minutes after the work fired before it is served that staff are reminded to fire the next
   * held group; null when reminders are off. */
  releaseReminderMinutes: number | null;
}
export interface VenueServiceSettings {
  editSentLines: boolean;
}
export type KitchenTicketGrouping = "combined" | "separate";
export interface VenueServiceChoices {
  menus: (NamedRow & { active: boolean })[];
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
    const [model, menus, floorZones] = await Promise.all([
      this.#read<VenueServiceModel>("/management-api/venue-service"),
      this.#read<VenueServiceChoices["menus"]>("/management-api/catalogues"),
      this.#read<FloorZone[]>("/management-api/zones"),
    ]);
    return {
      ...model,
      menus,
      floorZones,
    };
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
    input: {
      name: string;
      tradingName: string;
      defaultServiceMode: ServiceMode;
    },
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

  replaceHours(departmentId: string, hours: Omit<HoursInterval, "departmentId">[]): Promise<void> {
    return this.request(`/management-api/venue-service/departments/${departmentId}/hours`, "PUT", {
      hours,
    });
  }

  configureZone(
    zoneId: string,
    input: { departmentId: string; serviceMode: ServiceMode | null },
  ): Promise<void> {
    return this.request(`/management-api/venue-service/zones/${zoneId}`, "PUT", input);
  }

  allowMenu(
    zoneId: string,
    menuId: string,
    input: { displayOrder: number; makeDefault: boolean },
  ): Promise<void> {
    return this.request(
      `/management-api/venue-service/zones/${zoneId}/menus/${menuId}`,
      "PUT",
      input,
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

  saveReleaseReminderMinutes(releaseReminderMinutes: number | null): Promise<void> {
    return this.request("/management-api/venue-service/settings/release-reminder-minutes", "PUT", {
      releaseReminderMinutes,
    });
  }
}
