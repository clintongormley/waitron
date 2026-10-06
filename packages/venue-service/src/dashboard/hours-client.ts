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

const BASE = "/management-api/venue-service";

/** Re-read with no row written, so today's date and the labels that follow it move on. */
const REFRESH_MS = 60_000;

export class HoursApi {
  /** Each attached watch's read when there is no live data, for {@link rereadWatches}. */
  readonly #rereads = new Set<() => void>();

  constructor(
    private readonly request: DashboardRequest,
    readonly liveData?: LiveData,
  ) {}

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
    return this.#watch(
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
    return this.#watch(
      "venue-service:local-holidays",
      QUERY_DEPENDENCIES.holidays,
      () => this.loadLocalHolidays(),
      apply,
      failed,
      recovered,
    );
  }

  #watch<T>(
    key: string,
    dependencies: readonly string[],
    load: () => Promise<T>,
    apply: (model: T) => void,
    failed: (error: unknown) => void,
    recovered: () => void,
  ): () => void {
    let failing = false;
    let attached = true;
    const settle = (read: Promise<T>, counts: (succeeded: boolean) => boolean = () => true) =>
      read.then(
        (model) => {
          if (!attached || !counts(true)) return;
          apply(model);
          if (failing) {
            failing = false;
            recovered();
          }
        },
        (error: unknown) => {
          if (!attached || !counts(false)) return;
          failing = true;
          failed(error);
        },
      );
    if (this.liveData === undefined) {
      // A slow read can answer after a later one. A success is applied only when no read that
      // started after it has answered yet, and a failure shown only when no later read has started.
      let started = 0;
      let answered = 0;
      const read = () => {
        const own = ++started;
        void settle(load(), (succeeded) => {
          const newest = own > answered;
          if (newest) answered = own;
          return succeeded ? newest : own === started;
        });
      };
      read();
      const timer = setInterval(read, REFRESH_MS);
      this.#rereads.add(read);
      return () => {
        attached = false;
        clearInterval(timer);
        this.#rereads.delete(read);
      };
    }
    const changed = (): void => {
      const snapshot = observed.snapshot;
      if (snapshot.loading || snapshot.status === "pending") return;
      void settle(
        snapshot.status === "error"
          ? Promise.reject(snapshot.error)
          : Promise.resolve(snapshot.value as T),
      );
    };
    const observed = this.liveData.observe(
      {
        key,
        dependencies: dependencies.map((type) => ({ type })),
        refreshMs: REFRESH_MS,
        read: load,
      },
      changed,
    );
    // Observing never calls back by itself: a query another watcher has already read is current
    // and starts no read, so its model is handed over here.
    changed();
    return () => {
      attached = false;
      observed.unsubscribe();
    };
  }

  /**
   * After a write, has every attached watch read again, so the write shows even when the change
   * feed delivers nothing. With live data it invalidates the change types Hours reads, which
   * include every holiday source, and so also rereads every other live query depending on them.
   */
  rereadWatches(): void {
    if (this.liveData === undefined) for (const read of this.#rereads) read();
    else this.liveData.invalidate(QUERY_DEPENDENCIES.hours.map((type) => ({ type })));
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
