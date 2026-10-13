import type { DashboardRequest, LiveData } from "@waitron/dashboard-kit";
import type { OpeningHoursMonth, OpeningHoursYear } from "../opening-hours-calendar.js";
import type { MenuPeriodInput, MenuWeekDay, OpeningHoursModel } from "../menu-timetable-types.js";
import type { Season } from "../season-rules.js";
import type { ClosedRange } from "../service-day.js";
import type { SpecialDayDetail, SpecialDayInput } from "../special-days.js";
import { QUERY_DEPENDENCIES } from "./live-queries.js";
import { SpecialDaysApi } from "./special-days-client.js";
import { ModelWatches } from "./model-watch.js";

import type { StationServiceTimes } from "../station-service-times.js";

export interface OpeningStation {
  id: string;
  name: string;
  active: boolean;
  isDefault: boolean;
}

export interface SeasonInput {
  name: string;
  /** "MM-DD", never "02-29". */
  startsOn: string;
}
/** The departments whose painted hours deleting a season would lose. */
export interface SeasonDeleteImpact {
  departments: { id: string; name: string }[];
}

const BASE = "/management-api/venue-service";
const at = (id: string) => encodeURIComponent(id);

export class OpeningHoursApi {
  readonly #watches: ModelWatches;
  readonly specialDays: SpecialDaysApi;
  constructor(
    private readonly request: DashboardRequest,
    readonly liveData?: LiveData,
  ) {
    this.#watches = new ModelWatches(liveData);
    this.specialDays = new SpecialDaysApi(request, liveData);
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
  /** On the special-day calendar's dependencies, so a special-day or holiday-area write re-reads it. */
  watchYear(
    year: number,
    apply: (model: OpeningHoursYear) => void,
    failed: (error: unknown) => void,
    recovered: () => void,
  ): () => void {
    return this.#watches.watch(
      `venue-service:opening-hours-year:${year}`,
      QUERY_DEPENDENCIES["named-days"],
      () =>
        this.request<OpeningHoursYear>(
          `${BASE}/opening-hours/year?${new URLSearchParams({ year: String(year).padStart(4, "0") })}`,
          "GET",
          undefined,
          { passive: true },
        ),
      apply,
      failed,
      recovered,
    );
  }
  /** `month` is `YYYY-MM`; on the year's dependencies and the zones a department serves. */
  watchMonth(
    month: string,
    apply: (model: OpeningHoursMonth) => void,
    failed: (error: unknown) => void,
    recovered: () => void,
  ): () => void {
    return this.#watches.watch(
      `venue-service:opening-hours-month:${month}`,
      QUERY_DEPENDENCIES["opening-hours-month"],
      () =>
        this.request<OpeningHoursMonth>(
          `${BASE}/opening-hours/month?${new URLSearchParams({ month })}`,
          "GET",
          undefined,
          { passive: true },
        ),
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
        this.request<OpeningStation[]>("/management-api/stations", "GET", undefined, {
          passive: true,
        }),
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
  rereadWithSpecialDays(): void {
    this.specialDays.rereadWatches();
    this.rereadWatches();
  }
  createPeriod(
    departmentId: string,
    input: MenuPeriodInput,
    expectedClockRevision: number,
  ): Promise<{ id: string }> {
    return this.request(`${BASE}/departments/${at(departmentId)}/menu-periods`, "POST", {
      ...input,
      expectedClockRevision,
    });
  }
  updatePeriod(
    periodId: string,
    input: Partial<MenuPeriodInput>,
    expectedClockRevision: number,
  ): Promise<void> {
    return this.request(`${BASE}/menu-periods/${at(periodId)}`, "PATCH", {
      ...input,
      expectedClockRevision,
    });
  }
  deletePeriod(periodId: string): Promise<void> {
    return this.request(`${BASE}/menu-periods/${at(periodId)}`, "DELETE");
  }
  saveWeek(
    departmentId: string,
    seasonId: string,
    days: readonly MenuWeekDay[],
    expectedClockRevision: number,
  ): Promise<void> {
    return this.request(`${BASE}/departments/${at(departmentId)}/menu-week`, "PUT", {
      days,
      seasonId,
      expectedClockRevision,
    });
  }
  saveZoneWeek(
    zoneId: string,
    seasonId: string,
    days: readonly { weekday: number; ranges: readonly ClosedRange[] }[],
    expectedClockRevision: number,
  ): Promise<void> {
    return this.request(`${BASE}/zones/${at(zoneId)}/closed-week`, "PUT", {
      days,
      seasonId,
      expectedClockRevision,
    });
  }
  saveSeasonWeeks(
    seasonId: string,
    weeks: {
      departments: readonly { departmentId: string; days: readonly MenuWeekDay[] }[];
      zones: readonly {
        zoneId: string;
        days: readonly { weekday: number; ranges: readonly ClosedRange[] }[];
      }[];
    },
    expectedClockRevision: number,
  ): Promise<void> {
    return this.request(`${BASE}/seasons/${at(seasonId)}/weeks`, "PUT", {
      ...weeks,
      expectedClockRevision,
    });
  }
  saveSeason(id: string, input: SeasonInput, expectedClockRevision: number): Promise<Season> {
    return this.request(`${BASE}/seasons/${at(id)}`, "PUT", { ...input, expectedClockRevision });
  }
  addSeason(input: SeasonInput, expectedClockRevision: number): Promise<Season> {
    return this.request(`${BASE}/seasons`, "POST", { ...input, expectedClockRevision });
  }
  deleteSeason(id: string, expectedClockRevision: number): Promise<void> {
    return this.request(`${BASE}/seasons/${at(id)}`, "DELETE", { expectedClockRevision });
  }
  readSeasonDeleteImpact(id: string): Promise<SeasonDeleteImpact> {
    return this.request(`${BASE}/seasons/${at(id)}/delete-impact`, "GET");
  }
  /** Saves the special day as stored with `paint` replacing what it names; an empty list is left out. */
  saveDatePaint(
    detail: SpecialDayDetail,
    { paint, zonePaint }: Required<Pick<SpecialDayInput, "paint" | "zonePaint">>,
    expectedClockRevision: number,
  ): Promise<SpecialDayDetail> {
    return this.request(`${BASE}/special-days/${at(detail.id)}`, "PUT", {
      name: detail.name,
      repeatsYearly: detail.repeatsYearly,
      dates: detail.dates.map(({ date, closedAllDay }) => ({ date, closedAllDay })),
      ...(paint.length ? { paint } : {}),
      ...(zonePaint.length ? { zonePaint } : {}),
      expectedClockRevision,
    });
  }
}
