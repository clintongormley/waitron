import type { DashboardRequest, LiveData, ResourceQuery } from "@waitron/dashboard-kit";
import { ATTENDANCE_QUERY_DEPENDENCIES } from "@waitron/dashboard-modules";
import type {
  AttendanceCommandResult,
  AttendanceDayView,
  OwnAttendanceCommand,
} from "@waitron/dashboard-modules";
const BASE = "/management-api/me/attendance";

export class OwnAttendanceApi {
  constructor(
    private readonly request: DashboardRequest,
    readonly liveData?: LiveData,
  ) {}
  day(locationId: string, date: string): Promise<AttendanceDayView> {
    return this.request(
      `${BASE}/day?${new URLSearchParams({ locationId, date })}`,
      "GET",
      undefined,
      { passive: true },
    );
  }
  async command(commandId: string): Promise<AttendanceCommandResult | null> {
    const result = await this.request<AttendanceCommandResult | null>(
      `${BASE}/commands/${encodeURIComponent(commandId)}`,
      "GET",
      undefined,
      { passive: true },
    );
    if (result !== null) this.#invalidate();
    return result;
  }
  async send(command: OwnAttendanceCommand): Promise<AttendanceCommandResult> {
    const result = await this.request<AttendanceCommandResult>(`${BASE}/commands`, "POST", command);
    this.#invalidate();
    return result;
  }
  #invalidate(): void {
    this.liveData?.invalidate(ATTENDANCE_QUERY_DEPENDENCIES.hours.map((type) => ({ type })));
  }
  dayQuery(locationId: string, date: string): ResourceQuery<AttendanceDayView> {
    return {
      key: JSON.stringify(["attendance", "ownDay", locationId, date]),
      dependencies: ATTENDANCE_QUERY_DEPENDENCIES.ownDay.map((type) => ({ type })),
      read: () => this.day(locationId, date),
    };
  }
}
