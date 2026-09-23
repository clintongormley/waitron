import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "lit";
import { LiveData, createRequest } from "@waitron/dashboard-kit";
import { VENUE_SERVICE_DASHBOARD } from "./index.js";
import type { VenueOperationsScreen } from "./venue-operations-screen.js";

const containers: HTMLElement[] = [];
afterEach(() => {
  for (const container of containers.splice(0)) container.remove();
});

describe("VENUE_SERVICE_DASHBOARD", () => {
  it("mounts venue operations in the service navigation group", () => {
    expect(VENUE_SERVICE_DASHBOARD.module).toBe("venue-service");
    expect(VENUE_SERVICE_DASHBOARD.screen).toEqual({
      id: "venue-operations",
      navLabelKey: "nav.venue_operations",
      group: "service",
      requiresPermission: "venue_service.manage",
    });
    expect(VENUE_SERVICE_DASHBOARD.strings.en["nav.venue_operations"]).toBe("Venue operations");
    expect(VENUE_SERVICE_DASHBOARD.strings.es["nav.venue_operations"]).toBe(
      "Operaciones del local",
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
});
