import type { DashboardRequest, LiveData } from "@waitron/dashboard-kit";
import type {
  MenuPeriodInput,
  MenuSlot,
  MenuWeekDay,
  OpeningHoursModel,
} from "../menu-timetable-types.js";
import { QUERY_DEPENDENCIES } from "./live-queries.js";
import { ModelWatches } from "./model-watch.js";

const BASE = "/management-api/venue-service";
const at = (id: string) => encodeURIComponent(id);

export class OpeningHoursApi {
  readonly #watches: ModelWatches;
  constructor(
    private readonly request: DashboardRequest,
    readonly liveData?: LiveData,
  ) {
    this.#watches = new ModelWatches(liveData);
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
  rereadWatches(): void {
    this.#watches.reread(QUERY_DEPENDENCIES["opening-hours"]);
  }
  createPeriod(departmentId: string, input: MenuPeriodInput): Promise<{ id: string }> {
    return this.request(`${BASE}/departments/${at(departmentId)}/menu-periods`, "POST", input);
  }
  updatePeriod(periodId: string, input: Partial<MenuPeriodInput>): Promise<void> {
    return this.request(`${BASE}/menu-periods/${at(periodId)}`, "PATCH", input);
  }
  deletePeriod(periodId: string): Promise<void> {
    return this.request(`${BASE}/menu-periods/${at(periodId)}`, "DELETE");
  }
  saveWeek(departmentId: string, days: readonly MenuWeekDay[]): Promise<void> {
    return this.request(`${BASE}/departments/${at(departmentId)}/menu-week`, "PUT", { days });
  }
  saveDateMenus(
    specialDateId: string,
    departmentId: string,
    slots: readonly MenuSlot[],
  ): Promise<void> {
    return this.request(
      `${BASE}/special-dates/${at(specialDateId)}/menu-timetables/${at(departmentId)}`,
      "PUT",
      { slots },
    );
  }
}
