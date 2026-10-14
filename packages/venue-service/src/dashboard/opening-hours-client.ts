import type { DashboardRequest, LiveData } from "@waitron/dashboard-kit";
import { SEASON_DAYS_MAX_DATES, type LocalDate } from "../hours-types.js";
import type { OpeningHoursMonth, OpeningHoursYear, SeasonDays } from "../opening-hours-calendar.js";
import type { MenuPeriodInput, MenuWeekDay, OpeningHoursModel } from "../menu-timetable-types.js";
import type { PaintedIn, PeriodDeleteImpact } from "../period-delete.js";
import type { Season } from "../season-rules.js";
import type { ClosedRange } from "../service-day.js";
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

export type PaintedInRow = { periodId: string } & PaintedIn;
export type { PeriodDeleteImpact };

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
  watchPaintedIn(
    apply: (rows: PaintedInRow[]) => void,
    failed: (error: unknown) => void,
    recovered: () => void,
  ): () => void {
    return this.#watches.watch(
      "venue-service:menu-periods-painted-in",
      QUERY_DEPENDENCIES["menu-periods-painted-in"],
      () =>
        this.request<PaintedInRow[]>(`${BASE}/menu-periods/painted-in`, "GET", undefined, {
          passive: true,
        }),
      apply,
      failed,
      recovered,
    );
  }
  readPaintedIn(): Promise<PaintedInRow[]> {
    return this.request(`${BASE}/menu-periods/painted-in`, "GET");
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
  /** Each date's season hours without special-day paint, in `dates`' order, one read per
   *  `SEASON_DAYS_MAX_DATES` dates. */
  async readSeasonDays(dates: readonly LocalDate[]): Promise<SeasonDays> {
    const chunks: LocalDate[][] = [];
    for (let i = 0; i < dates.length; i += SEASON_DAYS_MAX_DATES)
      chunks.push(dates.slice(i, i + SEASON_DAYS_MAX_DATES));
    const reads = await Promise.all(
      chunks.map((chunk) =>
        this.request<SeasonDays>(
          `${BASE}/opening-hours/season-days?${new URLSearchParams({ dates: chunk.join(",") })}`,
          "GET",
          undefined,
          { passive: true },
        ),
      ),
    );
    return { days: reads.flatMap(({ days }) => days) };
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
  rereadWatches(): number {
    return this.#watches.reread(QUERY_DEPENDENCIES["opening-hours"]);
  }
  readNumberOf(model: object): number | undefined {
    return this.#watches.readNumberOf(model);
  }
  nextReadNumber(): number {
    return this.#watches.nextReadNumber();
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
  /** `passive` for a read nobody asked for, so it keeps no session alive. */
  readPeriodDeleteImpact(
    periodId: string,
    options?: { passive: true },
  ): Promise<PeriodDeleteImpact> {
    const path = `${BASE}/menu-periods/${at(periodId)}/delete-impact`;
    return options ? this.request(path, "GET", undefined, options) : this.request(path, "GET");
  }
  deletePeriod(
    periodId: string,
    replacementPeriodId: string | null,
    expectedClockRevision: number,
  ): Promise<void> {
    return this.request(`${BASE}/menu-periods/${at(periodId)}/delete`, "POST", {
      replacementPeriodId,
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
}
