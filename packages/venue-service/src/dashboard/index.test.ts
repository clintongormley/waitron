import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "lit";
import { LiveData, createRequest, currentLocale, setLocale } from "@waitron/dashboard-kit";
import { VENUE_SERVICE_DASHBOARD } from "./index.js";
import type { VenueOperationsScreen } from "./venue-operations-screen.js";
import type { PrepStationsScreen } from "./prep-stations-screen.js";
import type { OpeningHoursScreen } from "./opening-hours-screen.js";
import type { PeriodsList } from "./periods-list.js";
import { painterModel, withBar } from "../testing/season-painter-fixture.js";

const containers: HTMLElement[] = [];
const originalUrl = location.href;
const originalLocale = currentLocale();
beforeEach(() => setLocale("en"));
afterEach(() => {
  for (const container of containers.splice(0)) container.remove();
  vi.useRealTimers();
  history.replaceState(null, "", originalUrl);
  setLocale(originalLocale);
});

describe("VENUE_SERVICE_DASHBOARD", () => {
  it("adds no Venue settings panel", () => {
    expect(VENUE_SERVICE_DASHBOARD.settingsPanels ?? []).toEqual([]);
  });

  it("places Departments and zones first in the Venue operations group", () => {
    expect(VENUE_SERVICE_DASHBOARD.module).toBe("venue-service");
    expect(VENUE_SERVICE_DASHBOARD.screen).toEqual({
      id: "venue-operations",
      navLabelKey: "nav.departments_zones",
      group: "operations",
      order: 10,
      requiresPermission: "venue.configure",
    });
    expect(VENUE_SERVICE_DASHBOARD.strings.en["nav.departments_zones"]).toBe(
      "Departments and zones",
    );
    expect(VENUE_SERVICE_DASHBOARD.strings.es["nav.departments_zones"]).toBe(
      "Departamentos y zonas",
    );
  });

  it("create() renders the screen on the context's request and live data", async () => {
    const empty = {
      departments: [],
      zones: [],
      routes: [],
      hours: [],
      readiness: [],
      needsClearingDepartmentIds: [],
      lateSendManagerDepartmentIds: [],
      estimatedMarginByDepartment: {},
      serviceSteps: [],
      courses: [],
    };
    const fetchImpl = vi.fn((path: string) =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(path === "/management-api/venue-service" ? empty : []),
      } as Response),
    );
    const liveData = new LiveData();
    const handle = VENUE_SERVICE_DASHBOARD.create({
      request: createRequest({ fetchImpl: fetchImpl as unknown as typeof fetch }),
      liveData,
    });

    const container = document.createElement("div");
    document.body.append(container);
    containers.push(container);
    render(handle.render(), container);
    const screen = container.querySelector<VenueOperationsScreen>(
      "dashboard-venue-operations-screen",
    )!;
    await screen.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.api.liveData).toBe(liveData);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/management-api/venue-service",
      expect.objectContaining({ method: "GET" }),
    );
    await vi.waitFor(() =>
      expect(
        screen
          .shadowRoot!.querySelector("venue-departments-shell")!
          .shadowRoot!.querySelector("departments-list"),
      ).not.toBeNull(),
    );
  });

  it("create() answers navigationScopes from the open department dialog", async () => {
    const view = {
      departments: [{ id: "d1", name: "Restaurant", tradingName: "Casa", active: true }],
      zones: [],
      floorZones: [],
      salePolicies: { departments: [], zones: [] },
      readiness: [],
      courseSettingsByDepartment: {},
      needsClearingDepartmentIds: [],
      lateSendManagerDepartmentIds: [],
      estimatedMarginByDepartment: {},
      serviceSteps: [],
      courses: [],
    };
    const fetchImpl = vi.fn((path: string) =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify(
            path === "/management-api/venue-service"
              ? view
              : path.endsWith("/transfers")
                ? { departmentId: "d1", receivingProfileId: null, destinationDepartmentIds: [] }
                : [],
          ),
      } as Response),
    );
    history.replaceState(null, "", "/venue-operations/department/d1");
    const handle = VENUE_SERVICE_DASHBOARD.create({
      request: createRequest({ fetchImpl: fetchImpl as unknown as typeof fetch }),
      liveData: new LiveData(),
    });
    const at = (path: string) => new URL(path, location.origin);
    expect(handle.navigationScopes!(at("/venue-operations/department/d1/view/service"))).toBe(
      undefined,
    );
    const container = document.createElement("div");
    document.body.append(container);
    containers.push(container);
    render(handle.render(), container);
    const screen = container.querySelector<VenueOperationsScreen>(
      "dashboard-venue-operations-screen",
    )!;
    await vi.waitFor(() =>
      expect(
        screen
          .shadowRoot!.querySelector("venue-departments-shell")
          ?.shadowRoot!.querySelector("department-edit-dialog"),
      ).toBeTruthy(),
    );
    expect(handle.navigationScopes!(at("/venue-operations/department/d1/view/service"))).toEqual(
      [],
    );
    expect(handle.navigationScopes!(at("/venue-operations/department/d2"))).toBe(undefined);
  });

  it("opens Prep stations with the same request and live-data context", async () => {
    const fetchImpl = vi.fn((path: string) =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify(
            path === "/management-api/venue-service/routing"
              ? {
                  zones: [],
                  periods: [],
                  categories: [],
                  products: [],
                  cells: [],
                  defaultStationId: null,
                  stations: [],
                  canMakeDefault: true,
                }
              : [],
          ),
      } as Response),
    );
    const liveData = new LiveData();
    const prep = VENUE_SERVICE_DASHBOARD.moreScreens![0]!;
    expect(prep.screen).toEqual({
      id: "prep-stations",
      navLabelKey: "nav.prep_stations",
      group: "operations",
      order: 12,
      requiresPermission: "venue.configure",
    });
    const handle = prep.create({
      request: createRequest({ fetchImpl: fetchImpl as unknown as typeof fetch }),
      liveData,
    });
    const container = document.createElement("div");
    document.body.append(container);
    containers.push(container);
    render(handle.render(), container);
    const screen = container.querySelector<PrepStationsScreen>("dashboard-prep-stations-screen")!;
    expect(screen.api.liveData).toBe(liveData);
    await vi.waitFor(() =>
      expect(
        screen.shadowRoot!.querySelector('[slot="routing"] venue-routing-grid'),
      ).not.toBeNull(),
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      "/management-api/venue-service/routing",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("registers Opening hours readable with venue.view", async () => {
    const model = {
      dayCutover: "06:00",
      menus: [{ id: "m1", name: "Desayunos", active: true, includes: [] }],
      departments: [
        {
          id: "d1",
          name: "Restaurant",
          active: true,
          periods: [],
        },
      ],
    };
    const yearRead = (year: number) => ({
      businessDayClock: { timeZone: "Europe/Madrid", dayCutover: "06:00", cutoverChanges: [] },
      clockRevision: 0,
      currentBusinessDay: `${year}-10-07`,
      pending: null,
      year,
      timeZone: "Europe/Madrid",
      today: `${year}-10-07`,
      seasons: [],
      days: [],
      publicHolidaysAvailable: true,
      holidayCoverage: [],
      area: {
        addressKey: "fixture",
        readiness: "ready",
        options: [],
        required: false,
        chosen: null,
      },
    });
    const fetchImpl = vi.fn((path: string) =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify(
            path === "/management-api/stations"
              ? []
              : path.includes("/opening-hours/year?")
                ? yearRead(Number(new URL(path, location.href).searchParams.get("year")))
                : model,
          ),
      } as Response),
    );
    history.replaceState(null, "", "/opening-hours/view/year");
    const liveData = new LiveData();
    const timetable = VENUE_SERVICE_DASHBOARD.moreScreens!.find(
      (entry) => entry.screen.id === "opening-hours",
    )!;
    expect(timetable.screen).toEqual({
      id: "opening-hours",
      navLabelKey: "nav.calendar",
      group: "operations",
      order: 15,
      requiresPermission: "venue.configure",
      readPermission: "venue.view",
    });
    expect(VENUE_SERVICE_DASHBOARD.strings.en["nav.calendar"]).toBe("Calendar");
    expect(VENUE_SERVICE_DASHBOARD.strings.es["nav.calendar"]).toBe("Calendario");
    const handle = timetable.create({
      request: createRequest({ fetchImpl: fetchImpl as unknown as typeof fetch }),
      liveData,
    });
    const container = document.createElement("div");
    document.body.append(container);
    containers.push(container);
    render(handle.render(true), container);
    const screen = container.querySelector<OpeningHoursScreen>("dashboard-opening-hours-screen")!;
    expect(screen.api.liveData).toBe(liveData);
    expect(screen.readOnly).toBe(true);
    const year = () => screen.shadowRoot!.querySelector("opening-hours-year");
    await vi.waitFor(() =>
      expect(year()?.shadowRoot?.querySelector("[data-test=year]")).toBeTruthy(),
    );
    expect(year()!.readOnly).toBe(true);
    render(handle.render(false), container);
    await screen.updateComplete;
    expect(screen.readOnly).toBe(false);
    await year()!.updateComplete;
    expect(year()!.readOnly).toBe(false);
    const [path, init] = (fetchImpl.mock.calls as unknown as [string, RequestInit][]).find(
      ([path]) => path === "/management-api/venue-service/opening-hours",
    )!;
    expect(path).toBe("/management-api/venue-service/opening-hours");
    expect(new Headers(init.headers).get("x-waitron-live")).toBe("1");
  });
});

it("registers Floor plans in Operations, configured with venue.configure and read with venue.view", async () => {
  const fetchImpl = vi.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ departments: [] }),
    } as Response),
  );
  const entry = VENUE_SERVICE_DASHBOARD.moreScreens!.find((x) => x.screen.id === "floor-plans")!;
  expect(entry.screen).toEqual({
    id: "floor-plans",
    navLabelKey: "nav.floor_plans",
    group: "operations",
    order: 13,
    requiresPermission: "venue.configure",
    readPermission: "venue.view",
  });
  expect(VENUE_SERVICE_DASHBOARD.strings.en["nav.floor_plans"]).toBe("Floor plans");
  expect(VENUE_SERVICE_DASHBOARD.strings.es["nav.floor_plans"]).toBe("Planos de sala");
  const liveData = new LiveData();
  const handle = entry.create({
    request: createRequest({ fetchImpl: fetchImpl as unknown as typeof fetch }),
    liveData,
  });
  const container = document.createElement("div");
  document.body.append(container);
  containers.push(container);
  render(handle.render(true), container);
  const screen = container.querySelector("dashboard-floor-plans-screen")!;
  expect(screen.api.liveData).toBe(liveData);
  expect(screen.readOnly).toBe(true);
  render(handle.render(), container);
  expect(screen.readOnly).toBe(false);
  await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled());
  const [path, init] = (fetchImpl.mock.calls as unknown as [string, RequestInit][])[0]!;
  expect(path).toBe("/management-api/venue-service/floor-plan-sets");
  expect(new Headers(init.headers).get("x-waitron-live")).toBe("1");
});

it("opens the Seasons page on a passive watch with viewer and manager controls", async () => {
  const model = painterModel();
  let failed = true;
  const fetchImpl = vi.fn(() =>
    failed
      ? Promise.reject(new Error("offline"))
      : Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(model),
        } as Response),
  );
  const entry = VENUE_SERVICE_DASHBOARD.moreScreens!.find((x) => x.screen.id === "seasons")!;
  expect(entry, "module contributes the Seasons page").toBeDefined();
  expect(entry.screen.requiresPermission).toBe("venue.configure");
  expect(entry.screen.readPermission).toBe("venue.view");
  const handle = entry.create({
    request: createRequest({ fetchImpl: fetchImpl as unknown as typeof fetch }),
    liveData: new LiveData(),
  });
  const container = document.createElement("div");
  document.body.append(container);
  containers.push(container);
  render(handle.render(true), container);
  const screen = container.querySelector("dashboard-seasons-screen")!;
  await vi.waitFor(() =>
    expect(screen.shadowRoot?.querySelector("h1")?.textContent?.trim()).toBe("Seasons"),
  );
  await vi.waitFor(() =>
    expect(screen.shadowRoot!.querySelector("[data-test=read-error]")).not.toBeNull(),
  );
  failed = false;
  screen.api.rereadWatches();
  const table = () => screen.shadowRoot!.querySelector("wt-data-table")!;
  await vi.waitFor(() => expect(table()).not.toBeNull());
  await table().updateComplete;
  expect(screen.shadowRoot!.querySelector("[data-test=add-season]")).toBeNull();
  expect(table().columns.some((column) => column.key === "actions")).toBe(false);
  render(handle.render(false), container);
  await vi.waitFor(() =>
    expect(screen.shadowRoot!.querySelector("[data-test=add-season]")).not.toBeNull(),
  );
  model.seasons[0]!.name = "Renamed winter";
  screen.api.rereadWatches();
  await vi.waitFor(() =>
    expect((table().rows as { name: string }[]).map((row) => row.name)).toContain("Renamed winter"),
  );
  expect(screen.shadowRoot!.querySelector("[data-test=read-error]")).toBeNull();
  const [path, init] = (fetchImpl.mock.calls as unknown as [string, RequestInit][])[0]!;
  expect(path).toBe("/management-api/venue-service/opening-hours");
  expect(new Headers(init.headers).get("x-waitron-live")).toBe("1");
});

it("the Periods page is read-only for a viewer and editable for a manager", async () => {
  const model = {
    dayCutover: "06:00",
    clockRevision: 0,
    menus: [],
    seasons: [],
    departments: [{ id: "d1", name: "Restaurant", active: true, periods: [] }],
  };
  const fetchImpl = vi.fn((path: string) =>
    Promise.resolve({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify(
          path === "/management-api/stations" ||
            path.endsWith("/menu-periods/painted-in") ||
            path.endsWith("/special-days")
            ? []
            : path.endsWith("/floor-plan-sets/period-choices")
              ? { departments: [] }
              : model,
        ),
    } as Response),
  );
  history.replaceState(null, "", "/periods");
  const entry = VENUE_SERVICE_DASHBOARD.moreScreens!.find((x) => x.screen.id === "periods")!;
  expect(entry, "module contributes the Periods page").toBeDefined();
  const liveData = new LiveData();
  const handle = entry.create({
    request: createRequest({ fetchImpl: fetchImpl as unknown as typeof fetch }),
    liveData,
  });
  const container = document.createElement("div");
  document.body.append(container);
  containers.push(container);
  render(handle.render(true), container);
  const list = () => container.querySelector<PeriodsList>("periods-list");
  await vi.waitFor(() => expect(list()).not.toBeNull());
  expect(list()!.readOnly).toBe(true);
  expect(list()!.api.liveData).toBe(liveData);
  await vi.waitFor(() => expect(list()!.shadowRoot!.querySelector("wt-data-table")).not.toBeNull());
  expect(list()!.shadowRoot!.querySelector("[data-test=add-period]")).toBeNull();
  render(handle.render(false), container);
  await list()!.updateComplete;
  expect(list()!.readOnly).toBe(false);
  expect(list()!.shadowRoot!.querySelector("[data-test=add-period]")).not.toBeNull();
});

it("registers Opening hours without a separate Station hours page", () => {
  const screens = [
    VENUE_SERVICE_DASHBOARD.screen,
    ...VENUE_SERVICE_DASHBOARD.moreScreens!.map((entry) => entry.screen),
  ];
  expect(screens.map((screen) => screen.id)).toEqual([
    "venue-operations",
    "prep-stations",
    "floor-plans",
    "opening-hours",
    "seasons",
    "periods",
  ]);
  expect(customElements.get("dashboard-hours-screen")).toBeUndefined();
});

it("opens each declared prep-station search destination on its named tab", async () => {
  const request = (async (path: string) =>
    path === "/management-api/venue-service/routing"
      ? {
          zones: [],
          periods: [],
          categories: [],
          products: [],
          cells: [],
          defaultStationId: null,
          stations: [],
          canMakeDefault: true,
        }
      : []) as import("@waitron/dashboard-kit").DashboardRequest;
  const contribution = VENUE_SERVICE_DASHBOARD.moreScreens!.find(
    (x) => x.screen.id === "prep-stations",
  )!;
  const destinations = VENUE_SERVICE_DASHBOARD.searchDestinations
    ?.filter((x) => x.kind !== "setting")
    .filter((x) => x.screen === "prep-stations");
  expect(destinations?.map((x) => x.path)).toEqual([
    "/prep-stations/view/stations",
    "/prep-stations/view/routing",
  ]);
  for (const destination of destinations!) {
    history.replaceState(null, "", destination.path);
    const container = document.createElement("div");
    document.body.append(container);
    containers.push(container);
    const handle = contribution.create({ request });
    render(handle.render(), container);
    const screen = container.querySelector<PrepStationsScreen>("dashboard-prep-stations-screen")!;
    await vi.waitFor(() =>
      expect(screen.shadowRoot!.querySelector("wt-tabs")?.value).toBe(
        destination.path.split("/").at(-1),
      ),
    );
    container.remove();
  }
});

it("declares the Calendar's Week as a search destination", async () => {
  const destinations = VENUE_SERVICE_DASHBOARD.searchDestinations
    ?.filter((x) => x.kind !== "setting")
    .filter((x) => x.screen === "opening-hours");
  expect(destinations?.map((x) => x.path)).toEqual([
    "/opening-hours/view/year",
    "/opening-hours/view/month",
    "/opening-hours/view/week",
  ]);
  const model = {
    dayCutover: "06:00",
    currentBusinessDay: "2026-12-02",
    menus: [],
    seasons: [],
    departments: [{ id: "d1", name: "Restaurant", active: true, periods: [] }],
  };
  const request = (async (path: string) =>
    path === "/management-api/stations"
      ? []
      : path.includes("/opening-hours/month?")
        ? new Promise(() => {})
        : model) as import("@waitron/dashboard-kit").DashboardRequest;
  history.replaceState(null, "", destinations!.at(-1)!.path);
  const contribution = VENUE_SERVICE_DASHBOARD.moreScreens!.find(
    (x) => x.screen.id === "opening-hours",
  )!;
  const container = document.createElement("div");
  document.body.append(container);
  containers.push(container);
  render(contribution.create({ request }).render(), container);
  const screen = container.querySelector<OpeningHoursScreen>("dashboard-opening-hours-screen")!;
  await vi.waitFor(() =>
    expect(screen.shadowRoot!.querySelector("opening-hours-week")).not.toBeNull(),
  );
});

it("A725 puts Prep stations immediately after Departments and zones, before Calendar", () => {
  const screens = [
    VENUE_SERVICE_DASHBOARD.screen!,
    ...VENUE_SERVICE_DASHBOARD.moreScreens!.map(({ screen }) => screen),
  ]
    .filter(({ group }) => group === "operations")
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  expect(screens.map(({ id }) => id)).toEqual([
    "venue-operations",
    "prep-stations",
    "floor-plans",
    "opening-hours",
    "seasons",
    "periods",
  ]);
});

it("A725 offers only Stations and Routes as Prep search destinations", () => {
  expect(
    VENUE_SERVICE_DASHBOARD.searchDestinations!.filter((x) => x.kind !== "setting")
      .filter((row) => row.screen === "prep-stations")
      .map((row) => row.path),
  ).toEqual(["/prep-stations/view/stations", "/prep-stations/view/routing"]);
});

describe("menu period usage", () => {
  const model = withBar();
  const restaurant = model.departments[0]!;
  const bar = model.departments[2]!;
  const read = {
    ...model,
    departments: [
      restaurant,
      { ...bar, periods: [{ ...bar.periods[0]!, name: "Lunch", staffMenuIds: ["evening"] }] },
      { ...model.departments[1]!, periods: [{ ...restaurant.periods[1]!, id: "old" }] },
    ],
  };

  it.each([true, false])(
    "lists active departments and disambiguates their names (edit: %s)",
    async (canEdit) => {
      const request = vi.fn().mockResolvedValue(read);
      const publish = vi.fn();
      const stop = VENUE_SERVICE_DASHBOARD.menuPeriodUsage
        ?.create({ request }, canEdit)
        .watch(publish);
      try {
        await expect
          .poll(() => publish.mock.lastCall?.[0])
          .toEqual([
            {
              periodId: "p1",
              label: "Restaurant: Lunch",
              menuId: "m1",
              staffMenuIds: [],
              ...(canEdit ? { href: "/periods/period/p1" } : {}),
            },
            {
              periodId: "p2",
              label: "Dinner",
              menuId: "m1",
              staffMenuIds: [],
              ...(canEdit ? { href: "/periods/period/p2" } : {}),
            },
            {
              periodId: "q1",
              label: "Bar: Lunch",
              menuId: "m1",
              staffMenuIds: ["evening"],
              ...(canEdit ? { href: "/periods/period/q1" } : {}),
            },
          ]);
      } finally {
        stop?.();
      }
    },
  );

  it("publishes an unavailable read instead of an empty usage list", async () => {
    const request = vi.fn().mockRejectedValue(new Error("offline"));
    const publish = vi.fn();
    const stop = VENUE_SERVICE_DASHBOARD.menuPeriodUsage?.create({ request }, false).watch(publish);
    try {
      await expect.poll(() => publish.mock.lastCall?.[0]).toBeNull();
    } finally {
      stop?.();
    }
  });
});
