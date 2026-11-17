import { expect, it, vi } from "vitest";
import type { DashboardModuleContext, DashboardRequest } from "@waitron/dashboard-kit";
import { zonesModel } from "../testing/department-zones-fixture.js";
import { VENUE_SERVICE_DASHBOARD } from "./index.js";

const setting = () =>
  VENUE_SERVICE_DASHBOARD.searchDestinations!.find((x) => x.id === "venue-service:zone:name");
it("resolves encoded addresses passively through the contribution", async () => {
  const model = structuredClone(zonesModel);
  model.departments[0]!.id = "room / west";
  model.zones = [
    { ...model.zones[0]!, id: "zone / terrace", departmentId: "room / west" },
    { ...model.zones[0]!, id: "z2", departmentId: "d2" },
  ];
  const request = vi.fn(async (path: string) => (path.endsWith("/zones") ? [] : model));
  const ctx = { request: request as DashboardRequest } satisfies DashboardModuleContext;
  const destination = setting();
  expect(destination?.kind).toBe("setting");
  expect(destination?.kind === "setting" ? await destination.resolve(ctx) : null).toEqual([
    {
      id: "zone / terrace",
      label: "Restaurant / Terrace",
      path: "/venue-operations/department/room%20%2F%20west/view/zones/zone/zone%20%2F%20terrace",
    },
    {
      id: "z2",
      label: "Deli / Terrace",
      path: "/venue-operations/department/d2/view/zones/zone/z2",
    },
  ]);
  expect(request.mock.calls).toEqual([
    ["/management-api/venue-service", "GET", undefined, { passive: true }],
    ["/management-api/zones", "GET", undefined, { passive: true }],
  ]);
});
it.each([
  ["active", "d1", true, true, true],
  ["inactive department", "d3", true, true, false],
  ["missing department", "gone", true, true, false],
  ["inactive zone", "d1", false, true, false],
  ["inactive floor row", "d1", true, false, false],
  ["missing floor and optional active flag", "d1", undefined, undefined, true],
] as const)(
  "matches editor eligibility: %s",
  async (_label, departmentId, active, floorActive, offered) => {
    const model = structuredClone(zonesModel);
    model.zones = [{ ...model.zones[0]!, departmentId, active }];
    const floor =
      floorActive === undefined ? [] : [{ id: "z1", name: "Terrace", active: floorActive }];
    const request = (async (path: string) =>
      path.endsWith("/zones") ? floor : model) as DashboardRequest;
    const destination = setting();
    expect(destination?.kind).toBe("setting");
    expect(
      destination?.kind === "setting"
        ? (await destination.resolve({ request })).map((row) => row.id)
        : null,
    ).toEqual(offered ? ["z1"] : []);
  },
);
