import type { DashboardRequest, LiveData } from "@waitron/dashboard-kit";
import type {
  MenuPeriod,
  MenuSlot,
  MenuTimetableModel,
  MenuWeekDay,
} from "../menu-timetable-types.js";
import { QUERY_DEPENDENCIES } from "./live-queries.js";
import { ModelWatches } from "./model-watch.js";

const BASE = "/management-api/venue-service";
const at = (id: string) => encodeURIComponent(id);

export class MenuTimetableApi {
  readonly #watches: ModelWatches;

  constructor(
    private readonly request: DashboardRequest,
    readonly liveData?: LiveData,
  ) {
    this.#watches = new ModelWatches(liveData);
  }

  /**
   * Keeps `apply` fed with the venue's menu timetable: on any change to what it reads, and on a
   * timer, so the special dates move on with the venue's date. Every read is passive.
   */
  watchTimetable(
    apply: (model: MenuTimetableModel) => void,
    failed: (error: unknown) => void,
    recovered: () => void,
  ): () => void {
    return this.#watches.watch(
      "venue-service:menu-timetable",
      QUERY_DEPENDENCIES["menu-timetable"],
      () =>
        this.request<MenuTimetableModel>(`${BASE}/menu-timetable`, "GET", undefined, {
          passive: true,
        }),
      apply,
      failed,
      recovered,
    );
  }

  /** After a write, has every attached watch read again, as {@link HoursApi.rereadWatches} does. */
  rereadWatches(): void {
    this.#watches.reread(QUERY_DEPENDENCIES["menu-timetable"]);
  }

  setDepartmentMenus(departmentId: string, menuIds: readonly string[]): Promise<void> {
    return this.request(`${BASE}/departments/${at(departmentId)}/menus`, "PUT", { menuIds });
  }

  /** `null` leaves the department with no all-day menu. */
  setDepartmentAllDayMenu(departmentId: string, menuId: string | null): Promise<void> {
    return this.request(`${BASE}/departments/${at(departmentId)}/all-day-menu`, "PUT", { menuId });
  }

  /** `null` follows the department's all-day menu. */
  setZoneAllDayMenu(zoneId: string, menuId: string | null): Promise<void> {
    return this.request(`${BASE}/zones/${at(zoneId)}/all-day-menu`, "PUT", { menuId });
  }

  createPeriod(departmentId: string, input: { name: string; menuId: string }): Promise<MenuPeriod> {
    return this.request(`${BASE}/departments/${at(departmentId)}/menu-periods`, "POST", input);
  }

  /** A field left out keeps the period's stored value. */
  updatePeriod(
    periodId: string,
    input: { name: string; menuId?: string } | { name?: string; menuId: string },
  ): Promise<MenuPeriod> {
    return this.request(`${BASE}/menu-periods/${at(periodId)}`, "PUT", input);
  }

  deletePeriod(periodId: string): Promise<void> {
    return this.request(`${BASE}/menu-periods/${at(periodId)}`, "DELETE");
  }

  saveWeek(departmentId: string, days: readonly MenuWeekDay[]): Promise<void> {
    return this.request(`${BASE}/departments/${at(departmentId)}/menu-week`, "PUT", { days });
  }

  /** Gives the department its own timetable on the date; no slots offers the all-day menu. */
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

  /** Puts the department back on its normal week on the date. */
  clearDateMenus(specialDateId: string, departmentId: string): Promise<void> {
    return this.request(
      `${BASE}/special-dates/${at(specialDateId)}/menu-timetables/${at(departmentId)}`,
      "DELETE",
    );
  }

  /** `null` follows the named period's own menu. */
  setZonePeriodMenu(zoneId: string, periodId: string, menuId: string | null): Promise<void> {
    return this.request(`${BASE}/zones/${at(zoneId)}/period-menus/${at(periodId)}`, "PUT", {
      menuId,
    });
  }
}
