import type { StationThresholds } from "@waitron/shared";
import type { DashboardRequest, LiveData } from "@waitron/dashboard-kit";
import type { ResolvedKitchenScreen } from "@waitron/module";
import type { RouteTarget } from "../routing.js";
import type {
  CellAddress,
  PeriodLine,
  RoutingChange,
  RoutingMove,
  RoutingView,
} from "../routing-types.js";

export interface StationClosing {
  openDishCount: number;
  destinations: readonly { id: string; name: string; isDefault: boolean }[];
}
export type StationDisableChoice =
  { openDishes: "send"; sendsToStationId: string } | { openDishes: "leave" };

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
  printers: { id: string; name: string; active?: boolean }[];
  stationPrinters: { stationId: string; printerId: string }[];
  devices: {
    id: string;
    label: string;
    /** As the server resolves them: the device's choice less what profile narrowings took. */
    kitchenScreens: readonly ResolvedKitchenScreen[];
    kind: string;
    active: boolean;
  }[];
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
      this.#read<RoutingView>("/management-api/venue-service/routing"),
      this.#read<PrepStation[]>("/management-api/stations?includeDisabled=true"),
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
    return {
      routing,
      stations,
      categories,
      zones,
      products: products.map(({ id, name }) => ({ id, name })),
      printers,
      stationPrinters,
      devices,
    };
  }
  preview(change: RoutingChange): Promise<RoutingMove[]> {
    return this.request<RoutingMove[]>(
      "/management-api/venue-service/routing/preview",
      "POST",
      change,
    );
  }
  /** `printerIds` needs `printer.manage` as well. */
  async createStation(
    input: StationInput & { printerIds?: readonly string[] },
  ): Promise<{ id: string }> {
    return this.request<{ id: string }>("/management-api/stations", "POST", input);
  }
  updateStation(
    id: string,
    input: Partial<
      Pick<StationInput, "name" | "displayOrder"> &
        Pick<PrepStation, "showsRestOfOrder"> & {
          [Field in keyof StationThresholds]: number | null;
        } & {
          /** Needs `printer.manage` as well, and an active station. */
          printerIds: readonly string[];
        }
    >,
  ): Promise<void> {
    return this.request(`/management-api/stations/${id}`, "PATCH", input);
  }
  reorderStations(ids: readonly string[]): Promise<void> {
    return this.request("/management-api/stations/order", "PUT", { ids });
  }
  readStationClosing(id: string): Promise<StationClosing> {
    return this.request(`/management-api/stations/${id}/closing`, "GET", undefined, {
      passive: true,
    });
  }
  deactivateStation(id: string, choice?: StationDisableChoice): Promise<void> {
    return choice === undefined
      ? this.request(`/management-api/stations/${id}`, "DELETE")
      : this.request(`/management-api/stations/${id}`, "DELETE", choice);
  }
  activateStation(id: string): Promise<void> {
    return this.request(`/management-api/stations/${id}`, "PATCH", { active: true });
  }

  listOutputsDown(): Promise<OutputsDown> {
    return this.request<OutputsDown>("/management-api/stations/outputs-down", "GET", undefined, {
      passive: true,
    });
  }
  setDefaultStation(id: string): Promise<void> {
    return this.request(`/management-api/stations/${id}/default`, "POST");
  }
  /** `target: null` clears the cell. Without `periods` the cell keeps its stored lines. */
  setCell(
    address: CellAddress,
    target: RouteTarget | null,
    periods?: readonly PeriodLine[],
  ): Promise<void> {
    return this.request(
      "/management-api/venue-service/routing/cell",
      "PUT",
      periods === undefined ? { address, target } : { address, target, periods },
    );
  }
}
