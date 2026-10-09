import type { DashboardRequest, LiveData } from "@waitron/dashboard-kit";
import type { NamedDay, NamedDaysModel } from "../holiday-types.js";
import type { NamedDayInput } from "./named-day-editor.js";
import { isDefaultStation, keyOf, storedCells } from "./hours-view.js";
import type { HoursModel, LocalDate } from "../hours-types.js";
import { QUERY_DEPENDENCIES } from "./live-queries.js";
import { ModelWatches } from "./model-watch.js";

export class NamedDaysApi {
  readonly #watches: ModelWatches;
  constructor(
    private readonly request: DashboardRequest,
    readonly liveData?: LiveData,
  ) {
    this.#watches = new ModelWatches(liveData);
  }
  watchNamedDays(
    from: LocalDate,
    to: LocalDate,
    apply: (model: NamedDaysModel) => void,
    failed: (error: unknown) => void,
    recovered: () => void,
  ): () => void {
    return this.#watches.watch(
      `venue-service:named-days:${from}:${to}`,
      QUERY_DEPENDENCIES["named-days"],
      () =>
        this.request<NamedDaysModel>(
          `/management-api/venue-service/named-days?${new URLSearchParams({ from, to })}`,
          "GET",
          undefined,
          { passive: true },
        ),
      apply,
      failed,
      recovered,
    );
  }
  loadDayHours(date: LocalDate): Promise<HoursModel> {
    return this.request(
      `/management-api/venue-service/hours?${new URLSearchParams({ from: date, to: date })}`,
      "GET",
      undefined,
      { passive: true },
    );
  }
  watchDayHours(
    date: LocalDate,
    apply: (model: HoursModel) => void,
    failed: (error: unknown) => void,
  ): () => void {
    return this.#watches.watch(
      `venue-service:copy-hours:${date}`,
      QUERY_DEPENDENCIES.hours,
      () => this.loadDayHours(date),
      apply,
      failed,
      () => {},
    );
  }
  async saveDay(
    id: string | null,
    input: NamedDayInput,
    source?: NamedDay,
    current: () => boolean = () => true,
  ): Promise<unknown> {
    const model = source?.hasStationHours ? await this.loadDayHours(source.date) : undefined;
    if (!current()) return;
    const defaults = new Set(model?.subjects.filter(isDefaultStation).map(keyOf) ?? []);
    const cells = model
      ? storedCells(model, id!).filter((entry) => !defaults.has(keyOf(entry.subject)))
      : [];
    const payload = { ...input, cells };
    return id === null
      ? this.request("/management-api/venue-service/special-dates", "POST", payload)
      : this.request(
          `/management-api/venue-service/special-dates/${encodeURIComponent(id)}`,
          "PUT",
          payload,
        );
  }
  copyDay(id: string, dates: readonly LocalDate[]): Promise<unknown> {
    return this.request(
      `/management-api/venue-service/special-dates/${encodeURIComponent(id)}/duplicate`,
      "POST",
      { dates },
    );
  }
  deleteDay(id: string): Promise<void> {
    return this.request(
      `/management-api/venue-service/special-dates/${encodeURIComponent(id)}`,
      "DELETE",
    );
  }
  saveHolidayArea(areaKey: string): Promise<void> {
    return this.request("/management-api/venue-service/holiday-area", "PUT", { areaKey });
  }
  rereadWatches(): void {
    this.#watches.reread([...QUERY_DEPENDENCIES["named-days"], ...QUERY_DEPENDENCIES.hours]);
  }
}
