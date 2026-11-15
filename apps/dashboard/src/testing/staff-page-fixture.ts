import { vi } from "vitest";
import type { DashboardApi, PersonPageQuery } from "../api/client.js";

/** Roster fixtures supply the server's already-selected rows; callers assert query wiring. */
export function withStaffPages(api: DashboardApi): DashboardApi {
  for (const client of [api, api.background] as (Partial<DashboardApi> | undefined)[]) {
    if (!client || client.listStaffPage) continue;
    client.listStaffPage = vi.fn(async (query: PersonPageQuery) => {
      const rows = await client.listStaff!();
      return {
        rows,
        page: query.page,
        pageSize: 50 as const,
        total: rows.length,
        anyPeople: rows.length > 0,
      };
    });
  }
  return api;
}
