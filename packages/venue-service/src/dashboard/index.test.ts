import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "lit";
import { LiveData, createRequest } from "@waitron/dashboard-kit";
import { VENUE_SERVICE_DASHBOARD } from "./index.js";
import type { VenueOperationsScreen } from "./venue-operations-screen.js";
import type { PrepStationsScreen } from "./prep-stations-screen.js";
import type { ServiceSettingsPanel } from "./service-settings-panel.js";

const containers: HTMLElement[] = [];
afterEach(() => {
  for (const container of containers.splice(0)) container.remove();
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
      zoneMenus: [],
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
      expect(screen.shadowRoot!.querySelector('[data-test="readiness"]')).not.toBeNull(),
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
                  claims: [],
                  exceptions: [],
                  unassigned: { folders: [], products: [] },
                  defaultStationId: null,
                  stations: [],
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
      expect(screen.shadowRoot!.querySelector('[data-test="route-tester"]')).not.toBeNull(),
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      "/management-api/venue-service/routing",
      expect.objectContaining({ method: "GET" }),
    );
  });
});
