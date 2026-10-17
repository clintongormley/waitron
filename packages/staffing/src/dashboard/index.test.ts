import { afterEach, describe, expect, it, vi } from "vitest";
import { render, type LitElement } from "lit";
import type { CalendarViewHost, DashboardRequest } from "@waitron/dashboard-kit";
import { STAFFING_DASHBOARD } from "./index.js";
import type { StaffRolesScreen } from "./staff-roles-screen.js";
import type { StaffingMonthView } from "./staffing-month.js";
import type { StaffingSeasonPainter } from "./staffing-season-painter.js";
import type { StaffingSpecialDayPainter } from "./staffing-special-day-painter.js";
import { staffingMonth } from "../testing/staffing-month-fixture.js";
import { seasonStaffing } from "../testing/season-staffing-fixture.js";
import { rotaWeek } from "../testing/rota-fixture.js";
import { specialDayStaffing } from "../testing/special-day-staffing-fixture.js";

const containers: HTMLElement[] = [];
afterEach(() => {
  for (const container of containers.splice(0)) container.remove();
});

async function mount(readOnly?: boolean) {
  const request = vi.fn(async () => ({ staffRoles: [] }));
  const handle = STAFFING_DASHBOARD.create({ request: request as unknown as DashboardRequest });
  const container = document.createElement("div");
  document.body.append(container);
  containers.push(container);
  render(handle.render(readOnly), container);
  const screen = container.querySelector<StaffRolesScreen>("dashboard-staff-roles-screen")!;
  await screen.updateComplete;
  return { screen, request };
}

describe("STAFFING_DASHBOARD", () => {
  it("puts the Staff roles page in the Team group for managers of staffing, readable by venue viewers", () => {
    expect(STAFFING_DASHBOARD.module).toBe("staffing");
    expect(STAFFING_DASHBOARD.screen).toEqual({
      id: "staff-roles",
      navLabelKey: "nav.staff_roles",
      group: "team",
      requiresPermission: "staffing.manage",
      readPermission: "venue.view",
    });
    expect(STAFFING_DASHBOARD.strings.es["nav.staff_roles"]).toBe("Roles de personal");
  });

  it("mounts the page with an api on the app's request, editable unless read-only", async () => {
    const { screen, request } = await mount();
    expect(screen.readOnly).toBe(false);
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        "/management-api/staffing/staff-roles",
        "GET",
        undefined,
        {
          passive: true,
        },
      ),
    );
    expect((await mount(true)).screen.readOnly).toBe(true);
  });

  it("adds the Staffing view to the Calendar, drawn for the host's current month and address", async () => {
    const [view, ...others] = STAFFING_DASHBOARD.calendarViews!;
    expect(others.map((view) => view.id)).toEqual(["rota"]);
    expect(view).toMatchObject({
      id: "staffing",
      labelKey: "staffing.view.tab",
      order: 10,
      requiresPermission: "staffing.manage",
      readPermission: "venue.view",
    });
    expect(STAFFING_DASHBOARD.strings.en["staffing.view.tab"]).toBe("Staffing");
    expect(STAFFING_DASHBOARD.strings.es["staffing.view.tab"]).toBe("Personal");

    const request = vi.fn(async (path: string) =>
      path.includes("/month?") ? staffingMonth(path.slice(-7)) : { areas: [] },
    );
    const opened = vi.fn();
    const address = { month: "2026-12", params: { month: "2026-12" } as Record<string, string> };
    const host: CalendarViewHost = {
      get month() {
        return address.month;
      },
      get params() {
        return address.params;
      },
      canWrite: false,
      open: opened,
    };
    const handle = view!.create({ request: request as unknown as DashboardRequest }, host);
    const container = document.createElement("div");
    document.body.append(container);
    containers.push(container);
    render(handle.render(true), container);
    const month = container.querySelector<StaffingMonthView>("staffing-month")!;
    await vi.waitFor(() =>
      expect(month.shadowRoot!.querySelector("td[data-date='2026-12-01']")).not.toBeNull(),
    );
    expect(month.canWrite).toBe(false);

    month.shadowRoot!.querySelector<HTMLElement>("[data-test=next-month]")!.click();
    expect(opened).toHaveBeenCalledWith("staffing", { month: "2027-01" });

    address.month = "2027-01";
    address.params = { month: "2027-01", area: "station:st-kitchen" };
    render(handle.render(true), container);
    expect(month.month).toBe("2027-01");
    expect(month.params).toEqual({ month: "2027-01", area: "station:st-kitchen" });
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        "/management-api/staffing/month?month=2027-01",
        "GET",
        undefined,
        { passive: true },
      ),
    );
  });

  it("draws the season painter beside the month when the address names one", async () => {
    const view = STAFFING_DASHBOARD.calendarViews![0]!;
    const request = vi.fn(async (path: string) =>
      path.includes("/month?")
        ? staffingMonth(path.slice(-7))
        : path.includes("/seasons/")
          ? seasonStaffing()
          : path.includes("/special-days/")
            ? specialDayStaffing()
            : { staffRoles: [] },
    );
    const opened = vi.fn();
    const address = {
      params: { month: "2026-12", area: "station:st-kitchen" } as Record<string, string>,
      canWrite: true,
    };
    const host: CalendarViewHost = {
      month: "2026-12",
      get params() {
        return address.params;
      },
      get canWrite() {
        return address.canWrite;
      },
      open: opened,
    };
    const handle = view.create({ request: request as unknown as DashboardRequest }, host);
    const container = document.createElement("div");
    document.body.append(container);
    containers.push(container);
    render(handle.render(false), container);
    expect(container.querySelector("staffing-season-painter")).toBeNull();

    address.params = { ...address.params, painter: "season", season: "winter" };
    render(handle.render(false), container);
    const painter = container.querySelector<StaffingSeasonPainter>("staffing-season-painter")!;
    expect(container.querySelector("staffing-month")).not.toBeNull();
    expect(painter.seasonId).toBe("winter");
    expect(painter.area).toBe("station:st-kitchen");
    expect(painter.month).toBe("2026-12");
    expect(painter.readOnly).toBe(false);
    painter.open("staffing", { month: "2026-12" });
    expect(opened).toHaveBeenCalledWith("staffing", { month: "2026-12" });
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        "/management-api/staffing/seasons/winter",
        "GET",
        undefined,
        { passive: true },
      ),
    );

    address.canWrite = false;
    render(handle.render(false), container);
    expect(painter.readOnly).toBe(true);

    address.params = { month: "2026-12", painter: "season", season: "winter" };
    render(handle.render(false), container);
    expect(painter.area).toBe("");

    address.params = { month: "2026-12", painter: "season" };
    render(handle.render(false), container);
    expect(container.querySelector("staffing-season-painter")).toBeNull();
    address.params = { month: "2026-12", painter: "special-day", "special-day": "sd-eve" };
    render(handle.render(false), container);
    expect(container.querySelector("staffing-season-painter")).toBeNull();
  });

  it("draws the special-day painter beside the month when the address names one", async () => {
    const view = STAFFING_DASHBOARD.calendarViews![0]!;
    const request = vi.fn(async (path: string) =>
      path.includes("/month?")
        ? staffingMonth(path.slice(-7))
        : path.includes("/special-days/")
          ? specialDayStaffing()
          : { staffRoles: [] },
    );
    const opened = vi.fn();
    const address = {
      params: {
        month: "2026-12",
        area: "department:dep-bar",
        painter: "special-day",
        "special-day": "sd-eve",
      } as Record<string, string>,
      canWrite: true,
    };
    const host: CalendarViewHost = {
      month: "2026-12",
      get params() {
        return address.params;
      },
      get canWrite() {
        return address.canWrite;
      },
      open: opened,
    };
    const handle = view.create({ request: request as unknown as DashboardRequest }, host);
    const container = document.createElement("div");
    document.body.append(container);
    containers.push(container);
    render(handle.render(false), container);
    const painter = container.querySelector<StaffingSpecialDayPainter>(
      "staffing-special-day-painter",
    )!;
    expect(container.querySelector("staffing-month")).not.toBeNull();
    expect(container.querySelector("staffing-season-painter")).toBeNull();
    expect(painter.specialDayId).toBe("sd-eve");
    expect(painter.area).toBe("department:dep-bar");
    expect(painter.month).toBe("2026-12");
    expect(painter.readOnly).toBe(false);
    painter.open("staffing", { month: "2026-12" });
    expect(opened).toHaveBeenCalledWith("staffing", { month: "2026-12" });
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        "/management-api/staffing/special-days/sd-eve",
        "GET",
        undefined,
        { passive: true },
      ),
    );

    address.canWrite = false;
    render(handle.render(false), container);
    expect(painter.readOnly).toBe(true);

    address.params = { month: "2026-12", painter: "special-day", "special-day": "sd-eve" };
    render(handle.render(false), container);
    expect(painter.area).toBe("");

    address.params = { month: "2026-12", painter: "special-day" };
    render(handle.render(false), container);
    expect(container.querySelector("staffing-special-day-painter")).toBeNull();
    address.params = { month: "2026-12", painter: "season", "special-day": "sd-eve" };
    render(handle.render(false), container);
    expect(container.querySelector("staffing-special-day-painter")).toBeNull();
  });
});

describe("the Rota contribution", () => {
  it("uses the host's week and area, and falls back to the month's Monday for an invalid week address", async () => {
    const view = STAFFING_DASHBOARD.calendarViews!.find((v) => v.id === "rota")!;
    const fixture = await import("../testing/rota-fixture.js");
    const request = vi.fn(async (path: string) =>
      path.includes("/roster/breaches?")
        ? { breaches: [], ruleset: null }
        : fixture.rotaWeek(path.split("week=")[1]!),
    );
    const address = {
      month: "2026-12",
      params: { week: "nonsense", area: "station:kitchen" } as Record<string, string>,
    };
    const host: CalendarViewHost = {
      get month() {
        return address.month;
      },
      get params() {
        return address.params;
      },
      canWrite: true,
      open: vi.fn(),
    };
    const handle = view.create({ request: request as unknown as DashboardRequest }, host);
    const container = document.createElement("div");
    document.body.append(container);
    containers.push(container);
    render(handle.render(), container);
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        "/management-api/staffing/rota?week=2026-11-30",
        "GET",
        undefined,
        { passive: true },
      ),
    );
    address.params = { week: "2026-12-07", area: "station:kitchen" };
    render(handle.render(), container);
    await vi.waitFor(() =>
      expect(request.mock.calls.slice(-2)).toEqual([
        ["/management-api/staffing/rota?week=2026-12-07", "GET", undefined, { passive: true }],
        [
          "/management-api/roster/breaches?locationId=location&period=2026-12-07",
          "GET",
          undefined,
          { passive: true },
        ],
      ]),
    );
  });
});

it("passes canWriteStaffing from the Staffing entry in ctx.calendarViews", async () => {
  const rota = STAFFING_DASHBOARD.calendarViews!.find((x) => x.id === "rota")!;
  const staffing = STAFFING_DASHBOARD.calendarViews!.find((x) => x.id === "staffing")!;
  const request = (async (path: string) =>
    path.includes("/roster/breaches?")
      ? { breaches: [], ruleset: null }
      : rotaWeek("2026-11-30")) as DashboardRequest;
  const host: CalendarViewHost = {
    month: "2026-12",
    params: { week: "2026-11-30" },
    canWrite: true,
    open: () => undefined,
  };
  const cases = [
    [
      [
        { view: staffing, canWrite: true },
        { view: rota, canWrite: true },
      ],
      true,
    ],
    [
      [
        { view: staffing, canWrite: false },
        { view: rota, canWrite: true },
      ],
      false,
    ],
    [[{ view: rota, canWrite: true }], false],
    [undefined, false],
  ] as const;
  for (const [calendarViews, expected] of cases) {
    const container = document.createElement("div");
    document.body.append(container);
    containers.push(container);
    render(rota.create({ request, calendarViews }, host).render(), container);
    const view = container.querySelector<LitElement & { canWriteStaffing: boolean }>(
      "staffing-rota",
    )!;
    expect(view.canWriteStaffing).toBe(expected);
  }
});

it("opens the Rota's Everyone destination declared for search on the real view", async () => {
  const rota = STAFFING_DASHBOARD.calendarViews!.find((x) => x.id === "rota")!;
  expect(rota.searchDestinations?.map((x) => x.params)).toEqual([{ area: "everyone" }]);
  for (const destination of rota.searchDestinations!) {
    const container = document.createElement("div");
    document.body.append(container);
    containers.push(container);
    const request = (async (path: string) =>
      path.includes("/roster/breaches?")
        ? { breaches: [], ruleset: null }
        : rotaWeek("2026-09-28")) as DashboardRequest;
    const handle = rota.create(
      { request },
      { month: "2026-10", params: destination.params, canWrite: false, open: () => undefined },
    );
    render(handle.render(), container);
    const view = container.querySelector<LitElement>("staffing-rota")!;
    await view.updateComplete;
    await vi.waitFor(() => expect(view.shadowRoot!.querySelector("rota-by-person")).toBeTruthy());
    expect(view.shadowRoot!.querySelector("rota-by-area")).toBeNull();
    expect(
      view.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("wt-combobox")!.value,
    ).toBe("everyone");
    container.remove();
  }
});

it("passes canOpenStaffing when ctx.calendarViews holds the Staffing entry", () => {
  const rota = STAFFING_DASHBOARD.calendarViews!.find((x) => x.id === "rota")!;
  const staffing = STAFFING_DASHBOARD.calendarViews!.find((x) => x.id === "staffing")!;
  const request = (async (path: string) =>
    path.includes("/roster/breaches?")
      ? { breaches: [], ruleset: null }
      : rotaWeek("2026-11-30")) as DashboardRequest;
  const host: CalendarViewHost = {
    month: "2026-12",
    params: { week: "2026-11-30" },
    canWrite: true,
    open: () => undefined,
  };
  const cases = [
    [
      [
        { view: staffing, canWrite: false },
        { view: rota, canWrite: true },
      ],
      true,
    ],
    [[{ view: rota, canWrite: true }], false],
    [undefined, false],
  ] as const;
  for (const [calendarViews, expected] of cases) {
    const container = document.createElement("div");
    document.body.append(container);
    containers.push(container);
    render(rota.create({ request, calendarViews }, host).render(), container);
    const view = container.querySelector<LitElement & { canOpenStaffing: boolean }>(
      "staffing-rota",
    )!;
    expect(view.canOpenStaffing).toBe(expected);
  }
});
