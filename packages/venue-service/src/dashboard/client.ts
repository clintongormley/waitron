import type { DashboardRequest } from "@waitron/dashboard-kit";

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
}
export interface VenueServiceChoices {
  menus: (NamedRow & { active: boolean })[];
  categories: NamedRow[];
  stations: (NamedRow & { isDefault?: boolean })[];
  floorZones: FloorZone[];
  products: Product[];
  offers: MenuOffer[];
}
export interface Product {
  id: string;
  descriptions: Record<string, string>;
  pricingUnit: "each" | "weight";
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
  constructor(private readonly request: DashboardRequest) {}

  async load(): Promise<VenueServiceView> {
    const [model, menus, categories, stations, floorZones] = await Promise.all([
      this.request<VenueServiceModel>("/management-api/venue-service", "GET"),
      this.request<VenueServiceChoices["menus"]>("/management-api/catalogues", "GET"),
      this.request<NamedRow[]>("/management-api/categories", "GET"),
      this.request<VenueServiceChoices["stations"]>("/management-api/stations", "GET"),
      this.request<FloorZone[]>("/management-api/zones", "GET"),
    ]);
    const [productLists, offerLists] = await Promise.all([
      Promise.all(
        menus.map((menu) =>
          this.request<Product[]>(`/management-api/catalogues/${menu.id}/products`, "GET"),
        ),
      ),
      Promise.all(
        menus.map((menu) =>
          this.request<MenuOffer[]>(`/management-api/catalogues/${menu.id}/offers`, "GET"),
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
    };
  }

  createDepartment(input: {
    name: string;
    tradingName: string;
    defaultServiceMode: ServiceMode;
  }): Promise<Department> {
    return this.request("/management-api/venue-service/departments", "POST", input);
  }

  createMenu(name: string): Promise<NamedRow> {
    return this.request("/management-api/catalogues", "POST", { name });
  }

  createMenuSection(
    menuId: string,
    input: { name: Record<string, string>; displayOrder: number },
  ): Promise<{ id: string }> {
    return this.request(`/management-api/catalogues/${menuId}/sections`, "POST", input);
  }

  createMenuItem(
    menuId: string,
    input: { productId: string; sectionId: string; grossPrice: string; displayOrder: number },
  ): Promise<{ id: string }> {
    return this.request(`/management-api/catalogues/${menuId}/items`, "POST", input);
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
}
