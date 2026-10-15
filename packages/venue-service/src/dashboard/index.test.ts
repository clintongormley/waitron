import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "lit";
import { LiveData, createRequest, currentLocale, setLocale } from "@waitron/dashboard-kit";
import { VENUE_SERVICE_DASHBOARD } from "./index.js";
import type { VenueOperationsScreen } from "./venue-operations-screen.js";
import type { PrepStationsScreen } from "./prep-stations-screen.js";
import type { ServiceSettingsPanel } from "./service-settings-panel.js";
import type { OpeningHoursScreen } from "./opening-hours-screen.js";
import type { PeriodsScreen } from "./periods-screen.js";

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
      order: 30,
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
    await vi.waitFor(() => expect(screen.shadowRoot!.querySelector("wt-tabs")).not.toBeNull());
    const year = () => screen.shadowRoot!.querySelector("opening-hours-year");
    await vi.waitFor(() =>
      expect(year()?.shadowRoot?.querySelector("[data-test=year]")).not.toBeNull(),
    );
    expect(year()!.shadowRoot!.querySelector("[data-test=add-special-day]")).toBeNull();
    render(handle.render(false), container);
    await screen.updateComplete;
    expect(screen.readOnly).toBe(false);
    await year()!.updateComplete;
    expect(year()!.shadowRoot!.querySelector("[data-test=add-special-day]")).not.toBeNull();
    const [path, init] = (fetchImpl.mock.calls as unknown as [string, RequestInit][]).find(
      ([path]) => path === "/management-api/venue-service/opening-hours",
    )!;
    expect(path).toBe("/management-api/venue-service/opening-hours");
    expect(new Headers(init.headers).get("x-waitron-live")).toBe("1");
  });
});

it("registers Periods between Opening hours and Prep stations, readable with venue.view", async () => {
  const model = {
    dayCutover: "06:00",
    menus: [],
    seasons: [],
    departments: [{ id: "d1", name: "Restaurant", active: true, periods: [] }],
  };
  const fetchImpl = vi.fn((path: string) =>
    Promise.resolve({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(path.endsWith("/menu-periods/painted-in") ? [] : model),
    } as Response),
  );
  const entry = VENUE_SERVICE_DASHBOARD.moreScreens![1]!;
  expect(entry.screen).toEqual({
    id: "periods",
    navLabelKey: "nav.periods",
    group: "operations",
    order: 20,
    requiresPermission: "venue_service.manage",
    readPermission: "venue.view",
  });
  expect(VENUE_SERVICE_DASHBOARD.strings.en["nav.periods"]).toBe("Periods");
  expect(VENUE_SERVICE_DASHBOARD.strings.es["nav.periods"]).toBe("Periodos");
  const liveData = new LiveData();
  const handle = entry.create({
    request: createRequest({ fetchImpl: fetchImpl as unknown as typeof fetch }),
    liveData,
  });
  const container = document.createElement("div");
  document.body.append(container);
  containers.push(container);
  render(handle.render(true), container);
  const screen = container.querySelector<PeriodsScreen>("dashboard-periods-screen")!;
  expect(screen.readOnly).toBe(true);
  expect(screen.api.liveData).toBe(liveData);
  await vi.waitFor(() => expect(screen.shadowRoot!.querySelector("wt-data-table")).not.toBeNull());
  expect(screen.shadowRoot!.querySelector("[data-test=add-period]")).toBeNull();
  render(handle.render(false), container);
  await screen.updateComplete;
  expect(screen.readOnly).toBe(false);
  expect(screen.shadowRoot!.querySelector("[data-test=add-period]")).not.toBeNull();
});

it("registers Opening hours without a separate Station hours page", () => {
  const screens = [
    VENUE_SERVICE_DASHBOARD.screen,
    ...VENUE_SERVICE_DASHBOARD.moreScreens!.map((entry) => entry.screen),
  ];
  expect(screens.map((screen) => screen.id)).toEqual([
    "venue-operations",
    "prep-stations",
    "periods",
    "opening-hours",
  ]);
  expect(customElements.get("dashboard-hours-screen")).toBeUndefined();
});
