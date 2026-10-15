import type { DashboardRequest, LiveData, ResourceQuery } from "@waitron/dashboard-kit";
import { ATTENDANCE_QUERY_DEPENDENCIES } from "@waitron/dashboard-modules";
import type {
  AttendanceCommand,
  AttendanceCommandResult,
  AttendanceDayView,
  AttendanceLookups,
  AttendanceManagerQueue,
} from "@waitron/dashboard-modules";

const BASE = "/management-api/attendance";

export class AttendanceApi {
  readonly background: AttendanceApi;
  constructor(
    private readonly request: DashboardRequest,
    readonly liveData?: LiveData,
    private readonly passive = false,
  ) {
    this.background = passive ? this : new AttendanceApi(request, liveData, true);
  }

  #get<T>(path: string): Promise<T> {
    return this.request<T>(path, "GET", undefined, this.passive ? { passive: true } : undefined);
  }
  lookups(): Promise<AttendanceLookups> {
    return this.#get(`${BASE}/lookups`);
  }
  queue(locationId: string): Promise<AttendanceManagerQueue> {
    return this.#get(`${BASE}/queue?${new URLSearchParams({ locationId })}`);
  }
  day(personId: string, locationId: string, date: string): Promise<AttendanceDayView> {
    return this.#get(`${BASE}/day?${new URLSearchParams({ personId, locationId, date })}`);
  }
  async command(commandId: string): Promise<AttendanceCommandResult | null> {
    const result = await this.#get<AttendanceCommandResult | null>(
      `${BASE}/commands/${encodeURIComponent(commandId)}`,
    );
    this.rereadWatches();
    return result;
  }
  async send(command: AttendanceCommand): Promise<AttendanceCommandResult> {
    const result = await this.request<AttendanceCommandResult>(`${BASE}/commands`, "POST", command);
    this.rereadWatches();
    return result;
  }
  rereadWatches(): void {
    this.liveData?.invalidate(ATTENDANCE_QUERY_DEPENDENCIES.queue.map((type) => ({ type })));
  }

  #query<T>(
    name: keyof typeof ATTENDANCE_QUERY_DEPENDENCIES,
    args: string[],
    read: () => Promise<T>,
  ): ResourceQuery<T> {
    return {
      key: JSON.stringify(["attendance", name, args]),
      dependencies: ATTENDANCE_QUERY_DEPENDENCIES[name].map((type) => ({ type })),
      read,
    };
  }
  lookupsQuery(): ResourceQuery<AttendanceLookups> {
    return this.#query("lookups", [], () => this.background.lookups());
  }
  queueQuery(locationId: string): ResourceQuery<AttendanceManagerQueue> {
    return this.#query("queue", [locationId], () => this.background.queue(locationId));
  }
  dayQuery(personId: string, locationId: string, date: string): ResourceQuery<AttendanceDayView> {
    return this.#query("day", [personId, locationId, date], () =>
      this.background.day(personId, locationId, date),
    );
  }
}
