import { vi } from "vitest";
import type { DashboardRequest } from "@waitron/dashboard-kit";
import type { StaffingBlock } from "../slots.js";
import type { SeasonStaffing, SeasonStaffingEdit, StaffRole } from "../staffing-types.js";
import { StaffingApi } from "../dashboard/client.js";
import { bar, kitchen, restaurant } from "./staffing-month-fixture.js";

export const STAFF_ROLES: StaffRole[] = [
  { id: "hc", name: "Head chef", colour: "purple", position: 0, holderIds: [] },
  { id: "sc", name: "Sous chef", colour: "green", position: 1, holderIds: [] },
];
export const headChef: StaffingBlock = {
  staffRoleId: "hc",
  headcount: 1,
  startsAt: "09:00",
  endsAt: "16:30",
};
export const sous: StaffingBlock = {
  staffRoleId: "sc",
  headcount: 2,
  startsAt: "18:00",
  endsAt: "00:00",
};

/** Winter: the Restaurant painted on Tuesdays, the Kitchen on Fridays, the Bar not at all. */
export function seasonStaffing(seasonId = "winter"): SeasonStaffing {
  const winter = seasonId === "winter";
  return {
    cutover: "06:00",
    seasons: [
      { id: "spring", name: "Spring", startsOn: "03-01" },
      { id: "autumn", name: "Autumn", startsOn: "09-01" },
      { id: "winter", name: "Winter", startsOn: "12-01" },
    ],
    areas: [
      { area: restaurant, name: "Restaurant", weekdays: winter ? { 2: [{ ...headChef }] } : {} },
      { area: bar, name: "Bar", weekdays: {} },
      { area: kitchen, name: "Kitchen", weekdays: winter ? { 5: [{ ...sous }] } : {} },
    ],
    guides: {
      "department:dep-restaurant": { 2: [{ startsAt: "12:00", endsAt: "16:00" }] },
      "department:dep-bar": {},
      "station:st-kitchen": {},
    },
  };
}

export interface SeasonApiOptions {
  read?: (seasonId: string) => Promise<SeasonStaffing>;
  save?: (seasonId: string, edits: SeasonStaffingEdit[]) => Promise<void>;
  staffRoles?: () => Promise<StaffRole[]>;
}

/** A StaffingApi serving a season's staffing, the staff roles and an empty list of people. */
export function seasonApi(options: SeasonApiOptions = {}) {
  const read = options.read ?? (async (seasonId: string) => seasonStaffing(seasonId));
  const save = options.save ?? (async () => undefined);
  const staffRoles = options.staffRoles ?? (async () => STAFF_ROLES);
  const request = vi.fn(async (path: string, method: string, body?: unknown) => {
    if (path === "/management-api/staffing/staff-roles") return { staffRoles: await staffRoles() };
    if (path === "/management-api/staff") return [];
    const seasonId = decodeURIComponent(/\/staffing\/seasons\/(.+)$/.exec(path)![1]!);
    if (method === "GET") return read(seasonId);
    return save(seasonId, (body as { edits: SeasonStaffingEdit[] }).edits);
  });
  return { api: new StaffingApi(request as unknown as DashboardRequest), request };
}
