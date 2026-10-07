import type { DashboardRequest, LiveData } from "@waitron/dashboard-kit";
import type {
  HolidayGeography,
  HolidayRead,
  LocalHoliday,
  LocalHolidayInput,
  LocalHolidayModel,
} from "../holiday-types.js";
import type {
  HoursModel,
  HoursSubject,
  LocalDate,
  SpecialDate,
  SpecialDateInput,
  WeekDay,
} from "../hours-types.js";
import { QUERY_DEPENDENCIES } from "./live-queries.js";
import { ModelWatches } from "./model-watch.js";

const BASE = "/management-api/venue-service";

export class HoursApi {
  readonly #watches: ModelWatches;

  constructor(
    private readonly request: DashboardRequest,
    readonly liveData?: LiveData,
  ) {
    this.#watches = new ModelWatches(liveData);
  }

  #read(from: LocalDate, to: LocalDate): Promise<HoursModel> {
    const query = new URLSearchParams({ from, to });
    return this.request<HoursModel>(`${BASE}/hours?${query}`, "GET", undefined, { passive: true });
  }

  /**
   * Keeps `apply` fed with the range's model: on any change to what it reads, and on a timer.
   * Every read is passive. `failed` hears each failed read and `recovered` the first good one
   * after a failure. The returned function detaches, after which nothing more is read.
   */
  watchHours(
    from: LocalDate,
    to: LocalDate,
    apply: (model: HoursModel) => void,
    failed: (error: unknown) => void,
    recovered: () => void,
  ): () => void {
    return this.#watches.watch(
      `venue-service:hours:${from}:${to}`,
      QUERY_DEPENDENCIES.hours,
      () => this.#read(from, to),
      apply,
      failed,
      recovered,
    );
  }

  /** {@link watchHours} for the local holiday model. */
  watchLocalHolidays(
    apply: (model: LocalHolidayModel) => void,
    failed: (error: unknown) => void,
    recovered: () => void,
  ): () => void {
    return this.#watches.watch(
      "venue-service:local-holidays",
      QUERY_DEPENDENCIES.holidays,
      () => this.loadLocalHolidays(),
      apply,
      failed,
      recovered,
    );
  }

  /**
   * After a write, has every attached watch read again, so the write shows even when the change
   * feed delivers nothing. With live data it invalidates the change types Hours reads, which
   * include every holiday source, and so also rereads every other live query depending on them.
   */
  rereadWatches(): void {
    this.#watches.reread(QUERY_DEPENDENCIES.hours);
  }

  saveWeek(subject: HoursSubject, days: readonly WeekDay[]): Promise<void> {
    return this.request(`${BASE}/hours/week`, "PUT", { subject, days });
  }

  /** Creates a special date when `id` is null, otherwise edits it in place. */
  saveDate(id: string | null, input: SpecialDateInput): Promise<SpecialDate> {
    return id === null
      ? this.request(`${BASE}/special-dates`, "POST", input)
      : this.request(`${BASE}/special-dates/${encodeURIComponent(id)}`, "PUT", input);
  }

  duplicateDate(id: string, dates: readonly LocalDate[]): Promise<SpecialDate[]> {
    return this.request(`${BASE}/special-dates/${encodeURIComponent(id)}/duplicate`, "POST", {
      dates,
    });
  }

  deleteDate(id: string): Promise<void> {
    return this.request(`${BASE}/special-dates/${encodeURIComponent(id)}`, "DELETE");
  }

  loadHolidays(from: LocalDate, to: LocalDate): Promise<HolidayRead> {
    const query = new URLSearchParams({ from, to });
    return this.request<HolidayRead>(`${BASE}/holidays?${query}`, "GET", undefined, {
      passive: true,
    });
  }

  loadLocalHolidays(): Promise<LocalHolidayModel> {
    return this.request<LocalHolidayModel>(`${BASE}/local-holidays`, "GET", undefined, {
      passive: true,
    });
  }

  /** Null when the server cleared a choice it had never stored, and so saved nothing. */
  async saveHolidayArea(areaKey: string | null): Promise<HolidayGeography | null> {
    return (
      (await this.request<HolidayGeography | undefined>(`${BASE}/holiday-area`, "PUT", {
        areaKey,
      })) ?? null
    );
  }

  /** Creates a local holiday when `id` is null, otherwise edits it in place. */
  saveLocalHoliday(id: string | null, input: LocalHolidayInput): Promise<LocalHoliday> {
    return id === null
      ? this.request(`${BASE}/local-holidays`, "POST", input)
      : this.request(`${BASE}/local-holidays/${encodeURIComponent(id)}`, "PUT", input);
  }

  deleteLocalHoliday(id: string): Promise<void> {
    return this.request(`${BASE}/local-holidays/${encodeURIComponent(id)}`, "DELETE");
  }

  deleteRetainedGeography(id: string): Promise<void> {
    return this.request(`${BASE}/holiday-geographies/${encodeURIComponent(id)}`, "DELETE");
  }
}
