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
export interface PreparationRoute {
  id: string;
  zoneId: string | null;
  categoryId: string | null;
  productId: string | null;
  stationId: string | null;
  noPreparation: boolean;
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
  | { code: "venue.department_missing" }
  | { code: "zone.department_missing"; zoneId: string; zoneName: string }
  | { code: "zone.menu_missing"; zoneId: string; zoneName: string }
  | {
      code: "zone.menu_empty";
      zoneId: string;
      zoneName: string;
      menuId: string;
      menuName: string;
    }
  | {
      code: "zone.route_missing";
      zoneId: string;
      zoneName: string;
      productId: string;
      productName: string;
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
  routes: PreparationRoute[];
  hours: HoursInterval[];
  zoneMenus: ZoneMenu[];
  readiness: VenueReadinessIssue[];
}
export interface VenueServiceChoices {
  menus: (NamedRow & { active: boolean })[];
  categories: NamedRow[];
  stations: (NamedRow & { isDefault?: boolean })[];
  floorZones: FloorZone[];
  products: Product[];
  offers: MenuOffer[];
  sections: MenuSection[];
}
export interface Product {
  id: string;
  descriptions: Record<string, string>;
  pricingUnit: "each" | "weight";
  active: boolean;
}
export interface MenuSection {
  id: string;
  menuId: string;
  name: Record<string, string>;
  displayOrder: number;
  active: boolean;
}
export interface MenuOffer {
  id: string;
  menuId: string;
  productId: string;
  sectionId: string;
  sectionName: Record<string, string>;
  descriptions: Record<string, string>;
  grossPrice: string;
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
    const [model, menus, categories, stations, floorZones] = await Promise.all([
      this.#read<VenueServiceModel>("/management-api/venue-service"),
      this.#read<VenueServiceChoices["menus"]>("/management-api/catalogues"),
      this.#read<NamedRow[]>("/management-api/categories"),
      this.#read<VenueServiceChoices["stations"]>("/management-api/stations"),
      this.#read<FloorZone[]>("/management-api/zones"),
    ]);
    const [productLists, offerLists, sectionLists] = await Promise.all([
      Promise.all(
        menus.map((menu) =>
          this.#read<Product[]>(`/management-api/catalogues/${menu.id}/products`),
        ),
      ),
      Promise.all(
        menus.map((menu) =>
          this.#read<MenuOffer[]>(`/management-api/catalogues/${menu.id}/offers`),
        ),
      ),
      Promise.all(
        menus.map((menu) =>
          this.#read<MenuSection[]>(`/management-api/catalogues/${menu.id}/sections`),
        ),
      ),
    ]);
    const products = [
      ...new Map(productLists.flat().map((product) => [product.id, product])).values(),
    ];
    return {
      ...model,
      menus,
      categories,
      stations,
      floorZones,
      products,
      offers: offerLists.flat(),
      sections: sectionLists.flat(),
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

  createMenu(name: string): Promise<NamedRow> {
    return this.request("/management-api/catalogues", "POST", { name });
  }

  updateMenu(menuId: string, name: string): Promise<void> {
    return this.request(`/management-api/catalogues/${menuId}`, "PATCH", { name });
  }

  createMenuSection(
    menuId: string,
    input: { name: Record<string, string>; displayOrder: number },
  ): Promise<{ id: string }> {
    return this.request(`/management-api/catalogues/${menuId}/sections`, "POST", input);
  }

  updateMenuSection(sectionId: string, input: { name: Record<string, string> }): Promise<void> {
    return this.request(`/management-api/menu-sections/${sectionId}`, "PATCH", input);
  }

  createMenuItem(
    menuId: string,
    input: { productId: string; sectionId: string; grossPrice: string; displayOrder: number },
  ): Promise<{ id: string }> {
    return this.request(`/management-api/catalogues/${menuId}/items`, "POST", input);
  }

  updateMenuItem(menuId: string, menuItemId: string, input: { grossPrice: string }): Promise<void> {
    return this.request(`/management-api/catalogues/${menuId}/items/${menuItemId}`, "PATCH", input);
  }

  deactivateMenuItem(menuId: string, menuItemId: string): Promise<void> {
    return this.request(`/management-api/catalogues/${menuId}/items/${menuItemId}`, "DELETE");
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

  createRoute(input: {
    zoneId?: string | null;
    categoryId?: string | null;
    productId?: string | null;
    stationId?: string | null;
    noPreparation?: boolean;
  }): Promise<{ id: string }> {
    return this.request("/management-api/venue-service/routes", "POST", input);
  }

  updateRoute(
    routeId: string,
    input: {
      zoneId: string | null;
      categoryId?: string | null;
      productId?: string | null;
      stationId?: string | null;
      noPreparation?: boolean;
    },
  ): Promise<void> {
    return this.request(`/management-api/venue-service/routes/${routeId}`, "PUT", input);
  }

  deleteRoute(routeId: string): Promise<void> {
    return this.request(`/management-api/venue-service/routes/${routeId}`, "DELETE");
  }
}
