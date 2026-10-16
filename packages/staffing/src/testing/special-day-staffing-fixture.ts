import { vi } from "vitest";
import type { DashboardRequest } from "@waitron/dashboard-kit";
import type { StaffingBlock } from "../slots.js";
import type { SpecialDayStaffing, SpecialDayStaffingEdit, StaffRole } from "../staffing-types.js";
import { StaffingApi } from "../dashboard/client.js";
import { STAFF_ROLES, headChef, sous, LUNCH_GUIDE, BAR_GUIDE } from "./season-staffing-fixture.js";
import { bar, kitchen, restaurant } from "./staffing-month-fixture.js";

/** Christmas over two dates: the Restaurant painted on the Eve, the Kitchen on the Eve and empty on the
 *  Day, the rest following the season. */
export function specialDayStaffing(): SpecialDayStaffing {
  const dates = (eve: StaffingBlock[] | null, day: StaffingBlock[] | null = null) => [
    { dateId: "eve", date: "2026-12-24", blocks: eve },
    { dateId: "day", date: "2026-12-25", blocks: day },
  ];
  return {
    cutover: "06:00",
    name: "Christmas",
    guides: {
      "department:dep-restaurant": {
        eve: [{ ...LUNCH_GUIDE }],
        day: [],
      },
      "department:dep-bar": { eve: [{ ...BAR_GUIDE }], day: [] },
      "station:st-kitchen": {
        eve: [
          { ...LUNCH_GUIDE, endsAt: "15:30" },
          { ...BAR_GUIDE, endsAt: "17:30" },
        ],
        day: [],
      },
    },
    areas: [
      { area: restaurant, name: "Restaurant", dates: dates([{ ...headChef }]) },
      { area: bar, name: "Bar", dates: dates(null) },
      { area: kitchen, name: "Kitchen", dates: dates([{ ...sous }], []) },
    ],
  };
}

export interface SpecialDayApiOptions {
  read?: (specialDayId: string) => Promise<SpecialDayStaffing>;
  save?: (specialDayId: string, edits: SpecialDayStaffingEdit[]) => Promise<void>;
  staffRoles?: () => Promise<StaffRole[]>;
}

/** A StaffingApi serving a special day's staffing, the staff roles and an empty list of people. */
export function specialDayApi(options: SpecialDayApiOptions = {}) {
  const read = options.read ?? (async () => specialDayStaffing());
  const save = options.save ?? (async () => undefined);
  const staffRoles = options.staffRoles ?? (async () => STAFF_ROLES);
  const request = vi.fn(async (path: string, method: string, body?: unknown) => {
    if (path === "/management-api/staffing/staff-roles") return { staffRoles: await staffRoles() };
    if (path === "/management-api/staff") return [];
    const specialDayId = decodeURIComponent(/\/staffing\/special-days\/(.+)$/.exec(path)![1]!);
    if (method === "GET") return read(specialDayId);
    return save(specialDayId, (body as { edits: SpecialDayStaffingEdit[] }).edits);
  });
  return { api: new StaffingApi(request as unknown as DashboardRequest), request };
}
