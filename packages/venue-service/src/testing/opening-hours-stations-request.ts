import type { DashboardRequest } from "@waitron/dashboard-kit";

export function withOpeningStations(request: DashboardRequest): DashboardRequest {
  return (async (path, method, body, options) =>
    path === "/management-api/stations?includeDisabled=true" && method === "GET"
      ? []
      : request(path, method, body, options)) as DashboardRequest;
}
