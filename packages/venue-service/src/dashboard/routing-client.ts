import type { StationThresholds, TimingBand } from "@waitron/shared";
import type { DashboardRequest, LiveData } from "@waitron/dashboard-kit";
import type { ResolvedKitchenScreen } from "@waitron/module";
import type { RouteTarget, RoutingModel, RouteExplanation } from "../routing.js";
import type { CellAddress, RoutingChange, RoutingMove, RoutingView } from "../routing-types.js";
import type { RoutingMoment } from "../routing.js";
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
  timingDefaults: StationThresholds;
  timingOverrides: { [Field in keyof StationThresholds]: number | null };
}
export interface PrepStationsView {
  routing: RoutingView;
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
    /** As the server resolves them: the device's choice less what profile narrowings took. */
    kitchenScreens: readonly ResolvedKitchenScreen[];
    kind: string;
    active: boolean;
  }[];
  /** The active watchers. Only the Watchers tab lists `disabledWatchers` as well. */
  watchers: WatcherView[];
  disabledWatchers: WatcherView[];
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
    private readonly readOnly = false,
  ) {}
  get background() {
    return new PrepStationsApi(this.request, this.liveData, true, this.readOnly);
  }
  get overview() {
    return new PrepStationsApi(this.request, this.liveData, this.passive, true);
  }
  #read<T>(path: string): Promise<T> {
    return this.request<T>(path, "GET", undefined, { passive: this.passive });
  }
  async load(): Promise<PrepStationsView> {
    if (this.readOnly) {
      const [overview, stations] = await Promise.all([
        this.#read<
          Pick<
            RoutingModel,
            "stations" | "defaultStationId" | "stationTimes" | "todayEnds" | "clockReadable"
          >
        >("/management-api/venue-service/stations/overview"),
        this.#read<PrepStation[]>("/management-api/stations?includeDisabled=true"),
      ]);
      return {
        routing: {
          ...overview,
          zones: [],
          categories: [],
          products: [],
          cells: [],
          canMakeDefault: false,
        },
        stations,
        categories: [],
        zones: [],
        products: [],
        testProducts: [],
        printers: [],
        stationPrinters: [],
        devices: [],
        watchers: [],
        disabledWatchers: [],
      };
    }
    const [routing, stations, categories, zones, products, printers, devices, watchers] =
      await Promise.all([
        this.#read<RoutingView>("/management-api/venue-service/routing"),
        this.#read<PrepStation[]>("/management-api/stations?includeDisabled=true"),
        this.#read<PrepStationsView["categories"]>("/management-api/categories"),
        this.#read<PrepStationsView["zones"]>("/management-api/zones"),
        this.#read<ListedProduct[]>("/management-api/products"),
        this.#read<PrepStationsView["printers"]>("/management-api/printers"),
        this.#read<PrepStationsView["devices"]>("/management-api/devices"),
        this.#read<WatcherView[]>("/management-api/watchers?includeDisabled=true"),
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
      watchers: watchers.filter((watcher) => watcher.active),
      disabledWatchers: watchers.filter((watcher) => !watcher.active),
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
      if (moment.civilDate === undefined) query.set("weekday", String(moment.weekday));
      else query.set("date", moment.civilDate);
      query.set("time", moment.timeOfDay);
    }
    return this.#read<RouteExplanation>(`/management-api/venue-service/routing/explain?${query}`);
  }
  async createStation(input: StationInput): Promise<{ id: string }> {
    return this.request<{ id: string }>("/management-api/stations", "POST", input);
  }
  updateWatcher(id: string, input: WatcherInput): Promise<void> {
    return this.request(`/management-api/watchers/${id}`, "PUT", input);
  }
  setWatcherPrinters(id: string, printerIds: readonly string[]): Promise<void> {
    return this.request(`/management-api/watchers/${id}/printers`, "PUT", { printerIds });
  }
  /** The server deletes a watcher nothing refers to and disables one something does; with
   *  `disable`, it only ever disables it. */
  removeWatcher(id: string, { disable }: { disable: boolean }): Promise<void> {
    return this.request(
      `/management-api/watchers/${id}${disable ? "?disable=true" : ""}`,
      "DELETE",
    );
  }
  enableWatcher(id: string): Promise<void> {
    return this.request(`/management-api/watchers/${id}/reactivate`, "POST");
  }
  updateStation(
    id: string,
    input: Partial<
      Pick<StationInput, "name" | "displayOrder"> &
        Pick<PrepStation, "showsRestOfOrder"> & {
          [Field in keyof StationThresholds]: number | null;
        }
    >,
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
  setStationFallback(id: string, fallbackStationId: string | null): Promise<void> {
    return this.request(`/management-api/venue-service/stations/${id}/fallback`, "PUT", {
      fallbackStationId,
    });
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
  /** `target: null` clears the cell. */
  setCell(address: CellAddress, target: RouteTarget | null): Promise<void> {
    return this.request("/management-api/venue-service/routing/cell", "PUT", { address, target });
  }
}
