import type { DashboardRequest } from "@waitron/dashboard-kit";
import type {
  AttendanceExportOptions,
  AttendanceExportSelection,
  ManagerAttendanceExportSelection,
} from "@waitron/dashboard-modules";

export class AttendanceExportApi {
  constructor(private readonly request: DashboardRequest) {}
  options(locationId: string): Promise<AttendanceExportOptions> {
    return this.request(
      `/management-api/me/attendance/export-options?${new URLSearchParams({ locationId })}`,
      "GET",
      undefined,
      { passive: true },
    );
  }
  #query(selection: AttendanceExportSelection, personId?: string): string {
    return new URLSearchParams({
      locationId: selection.locationId,
      from: selection.from,
      before: selection.before,
      format: selection.format,
      audience: selection.audience,
      locale: selection.locale,
      ...(personId === undefined ? {} : { personId }),
    }).toString();
  }
  own(selection: AttendanceExportSelection): Promise<Blob> {
    return this.request(
      `/management-api/me/attendance/export?${this.#query(selection)}`,
      "GET",
      undefined,
      { as: "blob" },
    );
  }
  manager(selection: ManagerAttendanceExportSelection): Promise<Blob> {
    return this.request(
      `/management-api/attendance/export?${this.#query(selection, selection.personId)}`,
      "GET",
      undefined,
      { as: "blob" },
    );
  }
}
