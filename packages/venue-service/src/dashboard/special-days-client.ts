import type { DashboardRequest, LiveData } from "@waitron/dashboard-kit";
import type { SpecialDayDetail, SpecialDayInput, SpecialDaySummary } from "../special-days.js";
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
  listSpecialDays(options?: { passive?: boolean }): Promise<SpecialDaySummary[]> {
    return this.request<SpecialDaySummary[]>(`${BASE}/special-days`, "GET", undefined, options);
  }
  readSpecialDay(id: string, options?: { passive?: boolean }): Promise<SpecialDayDetail> {
    return this.request<SpecialDayDetail>(
      `${BASE}/special-days/${encodeURIComponent(id)}`,
      "GET",
      undefined,
      options,
    );
  }
  /** Creates the special day when `id` is null, else replaces it; answers with what was stored. */
  writeSpecialDay(
    id: string | null,
    input: SpecialDayInput,
    expectedClockRevision: number,
  ): Promise<SpecialDayDetail> {
    const body = { ...input, expectedClockRevision };
    return id === null
      ? this.request<SpecialDayDetail>(`${BASE}/special-days`, "POST", body)
      : this.request<SpecialDayDetail>(
          `${BASE}/special-days/${encodeURIComponent(id)}`,
          "PUT",
          body,
        );
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
