import type { TimingBand } from "@waitron/shared";
import type { DashboardRequest, LiveData } from "@waitron/dashboard-kit";
import type { RouteTarget, RoutingModel, ExceptionInput, RouteExplanation } from "../routing.js";
import type { RoutingChange, RoutingMove } from "../routing-types.js";
import type { WeeklyInterval, RoutingMoment } from "../routing.js";
import type { WatcherView } from "./watchers-seen.js";

export interface OutputsDown {
  printersDown: {
    stationId: string;
    stationName: string;
    printerId: string;
    printerName: string;
    since: string;
  }[];
  screensDark: { stationId: string; stationName: string; lastSeenAt: string | null }[];
}

export interface StationHealthItem {
  id: string;
  name: string;
  orderId: string;
  orderNumber: number;
  label: string | null;
  tableNames: string[];
  state: "queued" | "preparing" | "ready";
  queuedAt: string;
  remainingQuantity: string;
  band: TimingBand;
}
export interface StationHealth {
  id: string;
  name: string;
  hasScreen: boolean;
  waiting: number;
  preparing: number | null;
  ready: number | null;
  late: { warm: number; overdue: number; forgotten: number };
  oldestMinutes: number | null;
  items: StationHealthItem[];
}
export interface StationHealthSnapshot {
  capturedAt: string;
  stations: StationHealth[];
  outputsDown: OutputsDown;
}

export interface PrepStation {
  id: string;
  name: string;
  active: boolean;
  isDefault: boolean;
  displayOrder: number;
  warmAfterMinutes: number;
  overdueAfterMinutes: number;
  forgottenAfterMinutes: number;
  showsRestOfOrder: boolean;
}
export interface PrepStationsView {
  routing: RoutingModel;
  stations: PrepStation[];
  categories: { id: string; name: string; parentId: string | null }[];
  zones: { id: string; name: string; active?: boolean }[];
  products: { id: string; name: string }[];
  testProducts: { id: string; name: string }[];
  printers: { id: string; name: string; active?: boolean; watcherId?: string | null }[];
  stationPrinters: { stationId: string; printerId: string }[];
  devices: {
    id: string;
    label: string;
    stationId: string | null;
    watcherId: string | null;
    kind: string;
    active: boolean;
  }[];
  watchers: WatcherView[];
}
interface ListedProduct {
  id: string;
  name: string;
  active: boolean;
  variants: { id: string; name: string; active: boolean }[];
}
export type StationInput = {
  name: string;
  displayOrder: number;
  warmAfterMinutes: number;
  overdueAfterMinutes: number;
  forgottenAfterMinutes: number;
};
export type WatcherInput = Pick<
  WatcherView,
  "name" | "everyStation" | "stationIds" | "everyZone" | "zoneIds" | "runsPass"
> & { displayOrder?: number };
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
    const [routing, stations, categories, zones, products, printers, devices, watchers] =
      await Promise.all([
        this.#read<RoutingModel>("/management-api/venue-service/routing"),
        this.#read<PrepStation[]>("/management-api/stations?includeDisabled=true"),
        this.#read<PrepStationsView["categories"]>("/management-api/categories"),
        this.#read<PrepStationsView["zones"]>("/management-api/zones"),
        this.#read<ListedProduct[]>("/management-api/products"),
        this.#read<PrepStationsView["printers"]>("/management-api/printers"),
        this.#read<PrepStationsView["devices"]>("/management-api/devices"),
        this.#read<WatcherView[]>("/management-api/watchers"),
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
    return {
      routing,
      stations,
      categories,
      zones,
      products: products.map(({ id, name }) => ({ id, name })),
      testProducts: products.flatMap((product) =>
        product.active === false
          ? []
          : [
              { id: product.id, name: product.name },
              ...(product.variants ?? [])
                .filter((variant) => variant.active !== false)
                .map((variant) => ({ id: variant.id, name: `${product.name} · ${variant.name}` })),
            ],
      ),
      printers,
      stationPrinters,
      devices,
      watchers,
    };
  }
  preview(change: RoutingChange): Promise<RoutingMove[]> {
    return this.request<RoutingMove[]>(
      "/management-api/venue-service/routing/preview",
      "POST",
      change,
    );
  }
  explain(
    productId: string,
    zoneId: string | null,
    moment?: RoutingMoment,
    extraProductIds: readonly string[] = [],
  ): Promise<RouteExplanation> {
    const query = new URLSearchParams({ productId, zoneId: zoneId ?? "" });
    for (const id of extraProductIds) query.append("extraId", id);
    if (moment) {
      query.set("weekday", String(moment.weekday));
      query.set("time", moment.timeOfDay);
    }
    return this.#read<RouteExplanation>(`/management-api/venue-service/routing/explain?${query}`);
  }
  async createStation(input: StationInput): Promise<{ id: string }> {
    return this.request<{ id: string }>("/management-api/stations", "POST", input);
  }
  createWatcher(input: WatcherInput): Promise<{ id: string }> {
    return this.request("/management-api/watchers", "POST", input);
  }
  updateWatcher(id: string, input: WatcherInput): Promise<void> {
    return this.request(`/management-api/watchers/${id}`, "PUT", input);
  }
  setWatcherPrinters(id: string, printerIds: readonly string[]): Promise<void> {
    return this.request(`/management-api/watchers/${id}/printers`, "PUT", { printerIds });
  }
  removeWatcher(id: string): Promise<void> {
    return this.request(`/management-api/watchers/${id}`, "DELETE");
  }
  updateStation(
    id: string,
    input: Partial<StationInput & Pick<PrepStation, "showsRestOfOrder">>,
  ): Promise<void> {
    return this.request(`/management-api/stations/${id}`, "PATCH", input);
  }
  setStationPrinters(id: string, printerIds: readonly string[]): Promise<void> {
    return this.request(`/management-api/stations/${id}/printers`, "PUT", { printerIds });
  }
  reorderStations(ids: readonly string[]): Promise<void> {
    return this.request("/management-api/stations/order", "PUT", { ids });
  }
  deactivateStation(id: string): Promise<void> {
    return this.request(`/management-api/stations/${id}`, "DELETE");
  }
  activateStation(id: string): Promise<void> {
    return this.request(`/management-api/stations/${id}`, "PATCH", { active: true });
  }
  setStationHours(id: string, hours: readonly WeeklyInterval[]): Promise<void> {
    return this.request(`/management-api/venue-service/stations/${id}/hours`, "PUT", { hours });
  }
  setStationFallback(id: string, fallbackStationId: string | null): Promise<void> {
    return this.request(`/management-api/venue-service/stations/${id}/fallback`, "PUT", {
      fallbackStationId,
    });
  }
  setStationToday(id: string, state: "open" | "closed" | null): Promise<void> {
    return this.request(`/management-api/venue-service/stations/${id}/today`, "PUT", { state });
  }
  readStationHealth(): Promise<StationHealthSnapshot> {
    return this.request<StationHealthSnapshot>(
      "/management-api/stations/health",
      "GET",
      undefined,
      {
        passive: true,
      },
    );
  }
  listOutputsDown(): Promise<OutputsDown> {
    return this.request<OutputsDown>("/management-api/stations/outputs-down", "GET", undefined, {
      passive: true,
    });
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
  updateException(id: string, input: ExceptionInput): Promise<void> {
    const { target, ...condition } = input;
    return this.request(`/management-api/venue-service/routing/exceptions/${id}`, "PUT", {
      ...condition,
      ...(target.kind === "station" ? { stationId: target.stationId } : { noPreparation: true }),
    });
  }
  deleteException(id: string): Promise<void> {
    return this.request(`/management-api/venue-service/routing/exceptions/${id}`, "DELETE");
  }
  reorderExceptions(ids: string[]): Promise<void> {
    return this.request("/management-api/venue-service/routing/exception-order", "PUT", { ids });
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
