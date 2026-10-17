import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "lit";
import { LiveData, createRequest, currentLocale, setLocale } from "@waitron/dashboard-kit";
import { VENUE_SERVICE_DASHBOARD } from "./index.js";
import type { VenueOperationsScreen } from "./venue-operations-screen.js";
import type { PrepStationsScreen } from "./prep-stations-screen.js";
import type { ServiceSettingsPanel } from "./service-settings-panel.js";
import type { OpeningHoursScreen } from "./opening-hours-screen.js";
import type { PeriodsList } from "./periods-list.js";

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
  it("adds a kitchen panel and a Needs clearing switch above statuses for venue service managers", () => {
    expect(
      VENUE_SERVICE_DASHBOARD.settingsPanels!.map(({ id, tab, order, requiresPermission }) => ({
        id,
        tab,
        order,
        requiresPermission,
      })),
    ).toEqual([
      {
        id: "venue-service-kitchen",
        tab: "kitchen",
        order: 10,
        requiresPermission: "venue_service.manage",
      },
      {
        id: "venue-service-tables",
        tab: "tables",
        order: -10,
        requiresPermission: "venue_service.manage",
      },
    ]);
  });

  it("renders the tables panel on the context's request and live data", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            settings: { editSentLines: true },
            kitchenTicketGrouping: "combined",
            printHeldWork: false,
            printMovedSlips: true,
            releaseReminderMinutes: 10,
            clearingWorkflow: true,
          }),
      } as Response),
    );
    const liveData = new LiveData();
    const handle = VENUE_SERVICE_DASHBOARD.settingsPanels![1]!.create({
      request: createRequest({ fetchImpl: fetchImpl as unknown as typeof fetch }),
      liveData,
    });
    const container = document.createElement("div");
    document.body.append(container);
    containers.push(container);
    render(handle.render(), container);
    const panel = container.querySelector<ServiceSettingsPanel>(
      "dashboard-venue-service-settings",
    )!;
    expect(panel.subject).toBe("tables");
    expect(panel.api.liveData).toBe(liveData);
    await vi.waitFor(() =>
      expect(panel.shadowRoot!.querySelector('wt-switch[name="clearingWorkflow"]')).not.toBeNull(),
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      "/management-api/venue-service",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("places Departments and zones first in the Venue operations group", () => {
    expect(VENUE_SERVICE_DASHBOARD.module).toBe("venue-service");
    expect(VENUE_SERVICE_DASHBOARD.screen).toEqual({
      id: "venue-operations",
      navLabelKey: "nav.departments_zones",
      group: "operations",
      order: 10,
      requiresPermission: "venue_service.manage",
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
      settings: { editSentLines: true },
      clearingWorkflow: false,
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
      requiresPermission: "venue_service.manage",
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
      missingHolidays: [],
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
    history.replaceState(null, "", "/manage/opening-hours/view/year");
    const liveData = new LiveData();
    const timetable = VENUE_SERVICE_DASHBOARD.moreScreens!.at(-1)!;
    expect(timetable.screen).toEqual({
      id: "opening-hours",
      navLabelKey: "nav.calendar",
      group: "operations",
      order: 15,
      requiresPermission: "venue_service.manage",
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

it("the Calendar's Periods window is read-only for a viewer and editable for a manager", async () => {
  const model = {
    dayCutover: "06:00",
    clockRevision: 0,
    menus: [],
    seasons: [],
    departments: [{ id: "d1", name: "Restaurant", active: true, periods: [] }],
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
    missingHolidays: [],
    holidayCoverage: [],
    area: { addressKey: "fixture", readiness: "ready", options: [], required: false, chosen: null },
  });
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
            : path.includes("/opening-hours/year?")
              ? yearRead(Number(new URL(path, location.href).searchParams.get("year")))
              : model,
        ),
    } as Response),
  );
  history.replaceState(null, "", "/manage/opening-hours/view/year/window/periods");
  const entry = VENUE_SERVICE_DASHBOARD.moreScreens!.find((x) => x.screen.id === "opening-hours")!;
  const liveData = new LiveData();
  const handle = entry.create({
    request: createRequest({ fetchImpl: fetchImpl as unknown as typeof fetch }),
    liveData,
  });
  const container = document.createElement("div");
  document.body.append(container);
  containers.push(container);
  render(handle.render(true), container);
  const calendar = container.querySelector<OpeningHoursScreen>("dashboard-opening-hours-screen")!;
  const list = () =>
    calendar.shadowRoot!.querySelector<PeriodsList>(
      "[data-test=calendar-window][data-window=periods] periods-list",
    );
  await vi.waitFor(() => expect(list()).not.toBeNull());
  expect(list()!.readOnly).toBe(true);
  expect(list()!.api.liveData).toBe(liveData);
  await vi.waitFor(() => expect(list()!.shadowRoot!.querySelector("wt-data-table")).not.toBeNull());
  expect(list()!.shadowRoot!.querySelector("[data-test=add-period]")).toBeNull();
  render(handle.render(false), container);
  await calendar.updateComplete;
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
    "opening-hours",
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
  const destinations = VENUE_SERVICE_DASHBOARD.searchDestinations?.filter(
    (x) => x.screen === "prep-stations",
  );
  expect(destinations?.map((x) => x.path)).toEqual([
    "/manage/prep-stations/view/stations",
    "/manage/prep-stations/view/routing",
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
  const destinations = VENUE_SERVICE_DASHBOARD.searchDestinations?.filter(
    (x) => x.screen === "opening-hours",
  );
  expect(destinations?.map((x) => x.path)).toEqual([
    "/manage/opening-hours/view/year/window/seasons",
    "/manage/opening-hours/view/year/window/periods",
    "/manage/opening-hours/view/year",
    "/manage/opening-hours/view/month",
    "/manage/opening-hours/view/week",
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
    "opening-hours",
    "periods",
  ]);
});

it("A725 offers only Stations and Routes as Prep search destinations", () => {
  expect(
    VENUE_SERVICE_DASHBOARD.searchDestinations!.filter((row) => row.screen === "prep-stations").map(
      (row) => row.path,
    ),
  ).toEqual(["/manage/prep-stations/view/stations", "/manage/prep-stations/view/routing"]);
});
