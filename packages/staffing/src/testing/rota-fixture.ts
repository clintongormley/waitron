import { vi } from "vitest";
import type { DashboardRequest, LiveData } from "@waitron/dashboard-kit";
import { StaffingApi } from "../dashboard/client.js";
import type { RotaWeek } from "../staffing-types.js";
import type { Slot } from "../slots.js";

export const rotaArea = { kind: "station" as const, id: "kitchen" };
export function rotaWeek(week = "2026-11-30"): RotaWeek {
  const day = (n: number) =>
    new Date(Date.parse(`${week}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
  const slot = (n: number, key: string, staffRoleId = "sous"): Slot => ({
    key,
    businessDay: day(n),
    area: rotaArea,
    staffRoleId,
    startsAt: "09:00",
    endsAt: "17:00",
    start: 180,
    end: 660,
  });
  const shift = (id: string, personId: string, n: number, staffRoleId = "sous") => ({
    shiftId: id,
    personId,
    startsAt: `${day(n)}T08:00:00Z`,
    endsAt: `${day(n)}T16:00:00Z`,
    startsOffsetMinutes: 60,
    endsOffsetMinutes: 60,
    area: rotaArea,
    staffRoleId,
    businessDay: day(n),
    start: 180,
    end: 660,
  });
  return {
    locationId: "location",
    timeZone: "Europe/Madrid",
    week,
    version: { id: "draft", status: "draft", changedSincePublished: true },
    seasons: [{ id: "winter", name: "Winter" }],
    days: Array.from({ length: 7 }, (_, n) => ({
      businessDay: day(n),
      cutover: "06:00",
      hasHours: n !== 0,
      seasonId: "winter",
      specialDay: null,
      areas: [
        {
          area: rotaArea,
          match: {
            slots:
              n === 0
                ? []
                : n === 1
                  ? [
                      {
                        slot: slot(n, "filled", "head"),
                        status: { kind: "filled", shiftId: "filled", outsideRole: false },
                      },
                      {
                        slot: slot(n, "part"),
                        status: {
                          kind: "partly_uncovered",
                          shiftId: "part",
                          outsideRole: false,
                          uncovered: [{ start: 480, end: 660 }],
                        },
                      },
                    ]
                  : n === 2
                    ? [
                        {
                          slot: slot(n, "outside", "head"),
                          status: { kind: "filled", shiftId: "outside", outsideRole: true },
                        },
                      ]
                    : n === 4
                      ? [{ slot: slot(n, "empty"), status: { kind: "unfilled" } }]
                      : [],
            over: n === 3 ? ["over"] : [],
          },
        },
      ],
      notInSlot: n === 0 ? [{ shiftId: "unlinked", outsideWeek: true }] : [],
    })),
    shifts: [
      shift("filled", "ana", 1, "head"),
      { ...shift("part", "joan", 1), endsAt: `${day(1)}T13:00:00Z`, end: 480 },
      shift("outside", "marc", 2, "head"),
      shift("over", "laia", 3),
      { ...shift("unlinked", "ana", 0), area: null, staffRoleId: null, businessDay: day(-1) },
    ],
    people: [
      {
        personId: "ana",
        name: "Ana",
        staffRoleIds: ["head"],
        plannedMinutes: 2280,
        contractedMinutes: 2400,
      },
      {
        personId: "marc",
        name: "Marc",
        staffRoleIds: ["sous", "head"],
        plannedMinutes: 2340,
        contractedMinutes: 2400,
      },
      {
        personId: "laia",
        name: "Laia",
        staffRoleIds: ["sous"],
        plannedMinutes: 1800,
        contractedMinutes: 2400,
      },
      {
        personId: "joan",
        name: "Joan",
        staffRoleIds: ["sous"],
        plannedMinutes: 2460,
        contractedMinutes: 2400,
      },
      {
        personId: "ibra",
        name: "Ibra",
        staffRoleIds: [],
        plannedMinutes: 0,
        contractedMinutes: null,
      },
    ],
    openSwaps: [],
    absences: [{ personId: "laia", startsOn: day(4), endsOn: day(4) }],
    areas: [
      { area: rotaArea, name: "Kitchen", active: true },
      { area: { kind: "department", id: "restaurant" }, name: "Restaurant", active: true },
    ],
    staffRoles: [
      { id: "head", name: "Head chef", colour: "purple", position: 0, holderIds: ["ana", "marc"] },
      {
        id: "sous",
        name: "Sous chef",
        colour: "green",
        position: 1,
        holderIds: ["marc", "laia", "joan"],
      },
    ],
  };
}
/** A week whose Saturday has one open Sous chef slot, 22:00–06:00, across the night Madrid's clocks
 *  change: back an hour in the autumn week, forward an hour in the spring week. */
export function clockChangeWeek(change: "autumn" | "spring"): { week: RotaWeek; slot: Slot } {
  const week = rotaWeek(change === "autumn" ? "2026-10-19" : "2026-03-23");
  const saturday = week.days[5]!;
  const slot: Slot = {
    key: "night",
    businessDay: saturday.businessDay,
    area: rotaArea,
    staffRoleId: "sous",
    startsAt: "22:00",
    endsAt: "06:00",
    start: 960,
    end: 1440,
  };
  saturday.areas[0]!.match.slots = [{ slot, status: { kind: "unfilled" } }];
  return { week, slot };
}
export function rotaApi(
  read: (week: string) => Promise<RotaWeek> = async (week) => rotaWeek(week),
  liveData?: LiveData,
) {
  const request = vi.fn(async (path: string, method: string, body: unknown) => {
    if (method === "GET" && path.includes("/rota?"))
      return read(decodeURIComponent(path.split("week=")[1]!));
    if (method === "GET" && path.includes("/roster/breaches?"))
      return { breaches: [], ruleset: null };
    if (method === "POST" && path.endsWith("/rota/shifts")) return { shiftId: "new" };
    throw new Error(`unexpected ${method} ${path} ${JSON.stringify(body)}`);
  });
  return { api: new StaffingApi(request as unknown as DashboardRequest, liveData), request };
}
