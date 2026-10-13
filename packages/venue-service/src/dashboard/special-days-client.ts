import type { DashboardRequest, LiveData } from "@waitron/dashboard-kit";
import type { SpecialDaysModel } from "../holiday-types.js";
import type { LocalDate } from "../hours-types.js";
import type { SpecialDayDetail, SpecialDayInput, SpecialDaySummary } from "../special-days.js";
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
