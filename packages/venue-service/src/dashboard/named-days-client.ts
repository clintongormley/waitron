import type { DashboardRequest, LiveData } from "@waitron/dashboard-kit";
import type { NamedDaysModel } from "../holiday-types.js";
import type { NamedDayInput } from "./named-day-editor.js";
import type { LocalDate } from "../hours-types.js";
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
  async saveDay(
    id: string | null,
    input: NamedDayInput,
    current: () => boolean,
    expectedClockRevision: number,
  ): Promise<unknown> {
    if (!current()) return;
    return id === null
      ? this.request("/management-api/venue-service/special-dates", "POST", {
          ...input,
          expectedClockRevision,
        })
      : this.request(
          `/management-api/venue-service/special-dates/${encodeURIComponent(id)}`,
          "PUT",
          { ...input, expectedClockRevision },
        );
  }
  copyDay(
    id: string,
    dates: readonly LocalDate[],
    expectedClockRevision: number,
  ): Promise<unknown> {
    return this.request(
      `/management-api/venue-service/special-dates/${encodeURIComponent(id)}/duplicate`,
      "POST",
      { dates, expectedClockRevision },
    );
  }
  deleteDay(id: string, expectedClockRevision: number): Promise<void> {
    return this.request(
      `/management-api/venue-service/special-dates/${encodeURIComponent(id)}`,
      "DELETE",
      { expectedClockRevision },
    );
  }
  saveHolidayArea(areaKey: string): Promise<void> {
    return this.request("/management-api/venue-service/holiday-area", "PUT", { areaKey });
  }
  rereadWatches(): void {
    this.#watches.reread(QUERY_DEPENDENCIES["named-days"]);
  }
}
