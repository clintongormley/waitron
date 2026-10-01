import type { DashboardRequest, LiveData } from "@waitron/dashboard-kit";
import type { RouteTarget, RoutingModel, ExceptionInput } from "../routing.js";

export interface PrepStation {
  id: string;
  name: string;
  active: boolean;
  isDefault: boolean;
  displayOrder: number;
  warmAfterMinutes: number;
  overdueAfterMinutes: number;
  forgottenAfterMinutes: number;
}
export interface PrepStationsView {
  routing: RoutingModel;
  stations: PrepStation[];
  categories: { id: string; name: string; parentId: string | null }[];
  zones: { id: string; name: string }[];
  products: { id: string; name: string }[];
  printers: { id: string; name: string }[];
  stationPrinters: { stationId: string; printerId: string }[];
  devices: { id: string; label: string; stationId: string | null; kind: string; active: boolean }[];
}
export class StationThresholdPatchError extends Error {
  constructor(
    readonly createdStationId: string,
    cause: unknown,
  ) {
    super("Station created but thresholds could not be saved", { cause });
  }
}
export type StationInput = {
  name: string;
  displayOrder: number;
  warmAfterMinutes: number;
  overdueAfterMinutes: number;
  forgottenAfterMinutes: number;
};
export class PrepStationsApi {
  constructor(
    private readonly request: DashboardRequest,
    readonly liveData?: LiveData,
    private readonly passive = false,
  ) {}
  get background() {
    return new PrepStationsApi(this.request, this.liveData, true);
  }
  #read<T>(path: string): Promise<T> {
    return this.request<T>(path, "GET", undefined, { passive: this.passive });
  }
  async load(): Promise<PrepStationsView> {
    const [routing, stations, categories, zones, products, printers, devices] = await Promise.all([
      this.#read<RoutingModel>("/management-api/venue-service/routing"),
      this.#read<PrepStation[]>("/management-api/stations"),
      this.#read<PrepStationsView["categories"]>("/management-api/categories"),
      this.#read<PrepStationsView["zones"]>("/management-api/zones"),
      this.#read<PrepStationsView["products"]>("/management-api/products"),
      this.#read<PrepStationsView["printers"]>("/management-api/printers"),
      this.#read<PrepStationsView["devices"]>("/management-api/devices"),
    ]);
    const stationPrinters = (
      await Promise.all(
        stations.map((s) =>
          this.#read<PrepStationsView["stationPrinters"]>(
            `/management-api/stations/${s.id}/printers`,
          ),
        ),
      )
    ).flat();
    return { routing, stations, categories, zones, products, printers, stationPrinters, devices };
  }
  async createStation(input: StationInput): Promise<{ id: string }> {
    const created = await this.request<{ id: string }>("/management-api/stations", "POST", {
      name: input.name,
      displayOrder: input.displayOrder,
    });
    try {
      await this.request(`/management-api/stations/${created.id}`, "PATCH", {
        warmAfterMinutes: input.warmAfterMinutes,
        overdueAfterMinutes: input.overdueAfterMinutes,
        forgottenAfterMinutes: input.forgottenAfterMinutes,
      });
    } catch (cause) {
      throw new StationThresholdPatchError(created.id, cause);
    }
    return created;
  }
  updateStation(id: string, input: StationInput): Promise<void> {
    return this.request(`/management-api/stations/${id}`, "PATCH", input);
  }
  deactivateStation(id: string): Promise<void> {
    return this.request(`/management-api/stations/${id}`, "DELETE");
  }
  setDefaultStation(id: string): Promise<void> {
    return this.request(`/management-api/stations/${id}/default`, "POST");
  }
  setClaim(categoryId: string, target: RouteTarget): Promise<void> {
    return this.request(
      `/management-api/venue-service/routing/claims/${categoryId}`,
      "PUT",
      target.kind === "station" ? { stationId: target.stationId } : { noPreparation: true },
    );
  }
  createException(input: ExceptionInput): Promise<void> {
    const { target, ...condition } = input;
    return this.request("/management-api/venue-service/routing/exceptions", "POST", {
      ...condition,
      ...(target.kind === "station" ? { stationId: target.stationId } : { noPreparation: true }),
    });
  }
  assignProduct(productId: string, target: RouteTarget): Promise<void> {
    return this.request(
      `/management-api/venue-service/routing/products/${productId}/assignment`,
      "PUT",
      target.kind === "station" ? { stationId: target.stationId } : { noPreparation: true },
    );
  }
  removeClaim(categoryId: string): Promise<void> {
    return this.request(`/management-api/venue-service/routing/claims/${categoryId}`, "DELETE");
  }
}
