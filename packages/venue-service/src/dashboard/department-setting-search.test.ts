import { afterEach, expect, it, vi } from "vitest";
import { html } from "lit";
import {
  setLocale,
  type DashboardModuleContext,
  type DashboardRequest,
} from "@waitron/dashboard-kit";
import { zonesModel } from "../testing/department-zones-fixture.js";
import { VENUE_SERVICE_DASHBOARD } from "./index.js";

const setting = (name: string) =>
  VENUE_SERVICE_DASHBOARD.searchDestinations!.find(
    (x) => x.id === `venue-service:department:${name}`,
  );
function context(
  options: { count?: number; panel?: boolean; required?: boolean; fail?: string } = {},
) {
  const model = structuredClone(zonesModel);
  model.departments[0]!.id = "room / west";
  if (options.count !== undefined)
    model.departments = model.departments.filter((x) => x.active).slice(0, options.count);
  const request = vi.fn(async (path: string) => {
    if (path === options.fail) throw new Error("Unavailable");
    return path.endsWith("/receipt")
      ? { operationDescriptionRequired: options.required ?? true }
      : path.endsWith("/zones")
        ? []
        : model;
  });
  const renderPanel = vi.fn(() => (options.panel === false ? null : html`<p>Receipt editor</p>`));
  return {
    request,
    renderPanel,
    ctx: { request: request as DashboardRequest, renderPanel } satisfies DashboardModuleContext,
  };
}
async function resolve(name: string, ctx: DashboardModuleContext) {
  const destination = setting(name);
  expect(destination?.kind).toBe("setting");
  return destination!.kind === "setting" ? destination!.resolve(ctx) : [];
}
afterEach(() => setLocale("en-GB"));
it("resolves only active departments to encoded Details, Tables and Transfers addresses with passive reads", async () => {
  const { ctx, request } = context();
  expect(await resolve("name", ctx)).toEqual([
    {
      id: "room / west",
      label: "Restaurant",
      path: "/venue-operations/department/room%20%2F%20west",
    },
    { id: "d2", label: "Deli", path: "/venue-operations/department/d2" },
  ]);
  expect((await resolve("courseSettings", ctx))[0]?.path).toBe(
    "/venue-operations/department/room%20%2F%20west/view/tables",
  );
  expect((await resolve("receivingProfileId", ctx))[0]?.path).toBe(
    "/venue-operations/department/room%20%2F%20west/view/transfers",
  );
  expect(request.mock.calls).toEqual(
    Array.from({ length: 3 }, () => [
      ["/management-api/venue-service", "GET", undefined, { passive: true }],
      ["/management-api/zones", "GET", undefined, { passive: true }],
    ]).flat(),
  );
});
it("offers Transfers only with two active departments and returns no candidate without departments", async () => {
  expect(await resolve("receivingProfileId", context({ count: 1 }).ctx)).toEqual([]);
  expect(await resolve("name", context({ count: 0 }).ctx)).toEqual([]);
});
it.each([false, true])(
  "description eligibility follows receipt support and the venue-wide requirement %s",
  async (required) => {
    const { ctx, request, renderPanel } = context({ required });
    expect((await resolve("operationDescription", ctx)).map((x) => x.id)).toEqual(
      required ? ["room / west", "d2"] : [],
    );
    expect(renderPanel.mock.calls).toEqual([
      ["department-receipt", expect.objectContaining({ id: "room / west" })],
    ]);
    expect(request.mock.calls.filter(([path]) => path.endsWith("/receipt"))).toEqual([
      [
        "/management-api/venue-service/departments/room%20%2F%20west/receipt",
        "GET",
        undefined,
        { passive: true },
      ],
    ]);
    const unavailable = context({ panel: false });
    expect(await resolve("operationDescription", unavailable.ctx)).toEqual([]);
    expect(unavailable.request.mock.calls.some(([path]) => path.endsWith("/receipt"))).toBe(false);
  },
);
it.each([
  "/management-api/venue-service",
  "/management-api/venue-service/departments/room%20%2F%20west/receipt",
])("propagates %s read failure for the chooser's Retry", async (fail) => {
  await expect(resolve("operationDescription", context({ fail }).ctx)).rejects.toThrow(
    "Unavailable",
  );
});
it("finds How it sells only where takeaway VAT applies, and Starts as only in departments chosen on the till", async () => {
  const model = structuredClone(zonesModel);
  Object.assign(
    model.salePolicies.departments.find((row) => row.departmentId === "d1")!,
    {
      dining: "till_choice",
    },
  );
  const ctx = {
    request: (async (path: string) => (path.endsWith("/zones") ? [] : model)) as DashboardRequest,
  } satisfies DashboardModuleContext;
  expect(await resolve("dining", ctx)).toEqual([]);
  expect(await resolve("diningStartsAs", ctx)).toEqual([]);
  model.takeawayVat = true;
  expect((await resolve("dining", ctx)).map((row) => row.id)).toEqual(["d1", "d2"]);
  expect(await resolve("diningStartsAs", ctx)).toEqual([
    { id: "d1", label: "Restaurant", path: "/venue-operations/department/d1/view/service" },
  ]);
});
