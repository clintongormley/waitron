import type { DashboardRequest, LiveData } from "@waitron/dashboard-kit";
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
  constructor(
    private readonly request: DashboardRequest,
    readonly liveData?: LiveData,
  ) {}

  #read(from: LocalDate, to: LocalDate, passive: boolean): Promise<HoursModel> {
    const query = new URLSearchParams({ from, to });
    return this.request<HoursModel>(`${BASE}/hours?${query}`, "GET", undefined, { passive });
  }

  load(from: LocalDate, to: LocalDate): Promise<HoursModel> {
    return this.#read(from, to, false);
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
    let failing = false;
    let attached = true;
    const settle = (read: Promise<HoursModel>, latest = () => true) =>
      read.then(
        (model) => {
          if (!attached || !latest()) return;
          apply(model);
          if (failing) {
            failing = false;
            recovered();
          }
        },
        (error: unknown) => {
          if (!attached || !latest()) return;
          failing = true;
          failed(error);
        },
      );
    if (this.liveData === undefined) {
      // A slow read can answer after a later one; only the most recently started read counts.
      let started = 0;
      const read = () => {
        const own = ++started;
        void settle(this.#read(from, to, true), () => own === started);
      };
      read();
      const timer = setInterval(read, REFRESH_MS);
      return () => {
        attached = false;
        clearInterval(timer);
      };
    }
    const changed = (): void => {
      const snapshot = observed.snapshot;
      if (snapshot.loading || snapshot.status === "pending") return;
      void settle(
        snapshot.status === "error"
          ? Promise.reject(snapshot.error)
          : Promise.resolve(snapshot.value as HoursModel),
      );
    };
    const observed = this.liveData.observe(
      {
        key: `venue-service:hours:${from}:${to}`,
        dependencies: QUERY_DEPENDENCIES.hours.map((type) => ({ type })),
        refreshMs: REFRESH_MS,
        read: () => this.#read(from, to, true),
      },
      changed,
    );
    // Observing never calls back by itself: a range another watcher has already read is current
    // and starts no read, so its model is handed over here.
    changed();
    return () => {
      attached = false;
      observed.unsubscribe();
    };
  }

  /**
   * After a write, invalidates the change types Hours reads in the shared live data, so every
   * watched live query depending on them, each open Hours watch among them, reads again and the
   * write shows even when the change feed delivers nothing. False when there is no live data to ask.
   */
  rereadWatches(): boolean {
    if (this.liveData === undefined) return false;
    this.liveData.invalidate(QUERY_DEPENDENCIES.hours.map((type) => ({ type })));
    return true;
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
}
