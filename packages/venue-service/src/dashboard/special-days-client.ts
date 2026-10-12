import type { DashboardRequest, LiveData } from "@waitron/dashboard-kit";
import type { SpecialDaysModel } from "../holiday-types.js";
import type { LocalDate } from "../hours-types.js";
import type { SpecialDayDetail, SpecialDaySummary } from "../special-days.js";
import type { SpecialDayFacts } from "./special-day-dialog.js";
import { QUERY_DEPENDENCIES } from "./live-queries.js";
import { ModelWatches } from "./model-watch.js";

const BASE = "/management-api/venue-service";

export class SpecialDaysApi {
  readonly #watches: ModelWatches;
  constructor(
    private readonly request: DashboardRequest,
    readonly liveData?: LiveData,
  ) {
    this.#watches = new ModelWatches(liveData);
  }
  watchSpecialDays(
    from: LocalDate,
    to: LocalDate,
    apply: (model: SpecialDaysModel) => void,
    failed: (error: unknown) => void,
    recovered: () => void,
  ): () => void {
    return this.#watches.watch(
      `venue-service:named-days:${from}:${to}`,
      QUERY_DEPENDENCIES["named-days"],
      () =>
        this.request<SpecialDaysModel>(
          `${BASE}/named-days?${new URLSearchParams({ from, to })}`,
          "GET",
          undefined,
          { passive: true },
        ),
      apply,
      failed,
      recovered,
    );
  }
  listSpecialDays(): Promise<SpecialDaySummary[]> {
    return this.request<SpecialDaySummary[]>(`${BASE}/special-days`, "GET");
  }
  readSpecialDay(id: string): Promise<SpecialDayDetail> {
    return this.request<SpecialDayDetail>(`${BASE}/special-days/${encodeURIComponent(id)}`, "GET");
  }
  async saveSpecialDay(
    id: string | null,
    input: SpecialDayFacts,
    current: () => boolean,
    expectedClockRevision: number,
  ): Promise<SpecialDayDetail | undefined> {
    if (!current()) return undefined;
    return id === null
      ? this.request<SpecialDayDetail>(`${BASE}/special-days`, "POST", {
          ...input,
          expectedClockRevision,
        })
      : this.request<SpecialDayDetail>(`${BASE}/special-days/${encodeURIComponent(id)}`, "PUT", {
          ...input,
          expectedClockRevision,
        });
  }
  deleteSpecialDay(id: string, expectedClockRevision: number): Promise<void> {
    return this.request(`${BASE}/special-days/${encodeURIComponent(id)}`, "DELETE", {
      expectedClockRevision,
    });
  }
  saveHolidayArea(areaKey: string): Promise<void> {
    return this.request(`${BASE}/holiday-area`, "PUT", { areaKey });
  }
  rereadWatches(): void {
    this.#watches.reread(QUERY_DEPENDENCIES["named-days"]);
  }
}
