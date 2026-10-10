import type { DashboardRequest, LiveData } from "@waitron/dashboard-kit";
import type {
  MenuPeriodInput,
  MenuSlot,
  MenuWeekDay,
  OpeningHoursModel,
} from "../menu-timetable-types.js";
import type { ClosedRange } from "../service-day.js";
import { QUERY_DEPENDENCIES } from "./live-queries.js";
import { NamedDaysApi } from "./named-days-client.js";
import { ModelWatches } from "./model-watch.js";

import type { StationServiceTimes } from "../station-service-times.js";

export interface OpeningStation {
  id: string;
  name: string;
  active: boolean;
  isDefault: boolean;
}

const BASE = "/management-api/venue-service";
const at = (id: string) => encodeURIComponent(id);

export class OpeningHoursApi {
  readonly #watches: ModelWatches;
  readonly namedDays: NamedDaysApi;
  constructor(
    private readonly request: DashboardRequest,
    readonly liveData?: LiveData,
  ) {
    this.#watches = new ModelWatches(liveData);
    this.namedDays = new NamedDaysApi(request, liveData);
  }
  watchOpeningHours(
    apply: (model: OpeningHoursModel) => void,
    failed: (error: unknown) => void,
    recovered: () => void,
  ): () => void {
    return this.#watches.watch(
      "venue-service:opening-hours",
      QUERY_DEPENDENCIES["opening-hours"],
      () =>
        this.request<OpeningHoursModel>(`${BASE}/opening-hours`, "GET", undefined, {
          passive: true,
        }),
      apply,
      failed,
      recovered,
    );
  }
  watchStations(
    apply: (stations: OpeningStation[]) => void,
    failed: (error: unknown) => void,
    recovered: () => void,
  ): () => void {
    return this.#watches.watch(
      "opening-hours:stations",
      QUERY_DEPENDENCIES.routing,
      () =>
        this.request<OpeningStation[]>(
          "/management-api/stations?includeDisabled=true",
          "GET",
          undefined,
          { passive: true },
        ),
      apply,
      failed,
      recovered,
    );
  }
  watchStationTimes(
    stationId: string,
    from: string,
    to: string,
    normal: boolean,
    apply: (times: StationServiceTimes) => void,
    failed: (error: unknown) => void,
    recovered: () => void,
  ): () => void {
    const query = new URLSearchParams({ from, to, ...(normal ? { week: "normal" } : {}) });
    return this.#watches.watch(
      `opening-hours:station:${stationId}:${query}`,
      [...new Set([...QUERY_DEPENDENCIES.routing, ...QUERY_DEPENDENCIES["opening-hours"]])],
      () =>
        this.request<StationServiceTimes>(
          `${BASE}/stations/${at(stationId)}/service-times?${query}`,
          "GET",
          undefined,
          { passive: true },
        ),
      apply,
      failed,
      recovered,
    );
  }
  rereadWatches(): void {
    this.#watches.reread(QUERY_DEPENDENCIES["opening-hours"]);
  }
  createPeriod(departmentId: string, input: MenuPeriodInput): Promise<{ id: string }> {
    return this.request(`${BASE}/departments/${at(departmentId)}/menu-periods`, "POST", input);
  }
  updatePeriod(periodId: string, input: Partial<MenuPeriodInput>): Promise<void> {
    return this.request(`${BASE}/menu-periods/${at(periodId)}`, "PATCH", input);
  }
  deletePeriod(periodId: string): Promise<void> {
    return this.request(`${BASE}/menu-periods/${at(periodId)}`, "DELETE");
  }
  saveWeek(departmentId: string, days: readonly MenuWeekDay[]): Promise<void> {
    return this.request(`${BASE}/departments/${at(departmentId)}/menu-week`, "PUT", { days });
  }
  saveZoneWeek(
    zoneId: string,
    days: readonly { weekday: number; ranges: readonly ClosedRange[] }[],
  ): Promise<void> {
    return this.request(`${BASE}/zones/${at(zoneId)}/closed-week`, "PUT", { days });
  }
  saveZoneDate(
    specialDateId: string,
    zoneId: string,
    ranges: readonly ClosedRange[],
  ): Promise<void> {
    return this.request(
      `${BASE}/special-dates/${at(specialDateId)}/zone-closed-times/${at(zoneId)}`,
      "PUT",
      { ranges },
    );
  }
  saveDateMenus(
    specialDateId: string,
    departmentId: string,
    slots: readonly MenuSlot[],
  ): Promise<void> {
    return this.request(
      `${BASE}/special-dates/${at(specialDateId)}/menu-timetables/${at(departmentId)}`,
      "PUT",
      { slots },
    );
  }
}
