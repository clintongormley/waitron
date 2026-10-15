import type { DashboardRequest, LiveData, ResourceQuery } from "@waitron/dashboard-kit";
import { ATTENDANCE_QUERY_DEPENDENCIES } from "@waitron/dashboard-modules";
import type {
  AttendanceInbox,
  HoursSelection,
  ManagerHours,
  PersonHours,
} from "@waitron/dashboard-modules";

export class HoursApi {
  constructor(
    private readonly request: DashboardRequest,
    readonly liveData?: LiveData,
  ) {}
  ownInbox(): Promise<AttendanceInbox> {
    return this.request("/management-api/me/attendance/inbox", "GET", undefined, { passive: true });
  }
  #path(locationId: string, selection: HoursSelection): string {
    return new URLSearchParams({
      locationId,
      kind: selection.kind,
      ...(selection.date === undefined ? {} : { date: selection.date }),
    }).toString();
  }
  own(locationId: string, selection: HoursSelection): Promise<PersonHours> {
    return this.request(
      `/management-api/me/attendance/hours?${this.#path(locationId, selection)}`,
      "GET",
      undefined,
      { passive: true },
    );
  }
  manager(locationId: string, selection: HoursSelection): Promise<ManagerHours> {
    return this.request(
      `/management-api/attendance/hours?${this.#path(locationId, selection)}`,
      "GET",
      undefined,
      { passive: true },
    );
  }
  invalidate(): void {
    this.liveData?.invalidate(ATTENDANCE_QUERY_DEPENDENCIES.hours.map((type) => ({ type })));
  }
  #query<T>(name: "hours" | "ownInbox", args: unknown[], read: () => Promise<T>): ResourceQuery<T> {
    return {
      key: JSON.stringify(["attendance", name, args]),
      dependencies: ATTENDANCE_QUERY_DEPENDENCIES[name].map((type) => ({ type })),
      read,
    };
  }
  ownInboxQuery(): ResourceQuery<AttendanceInbox> {
    return this.#query("ownInbox", [], () => this.ownInbox());
  }
  ownQuery(locationId: string, selection: HoursSelection): ResourceQuery<PersonHours> {
    const selected = { ...selection };
    return this.#query("hours", ["own", locationId, selected.kind, selected.date ?? null], () =>
      this.own(locationId, selected),
    );
  }
  managerQuery(locationId: string, selection: HoursSelection): ResourceQuery<ManagerHours> {
    const selected = { ...selection };
    return this.#query("hours", ["manager", locationId, selected.kind, selected.date ?? null], () =>
      this.manager(locationId, selected),
    );
  }
}
