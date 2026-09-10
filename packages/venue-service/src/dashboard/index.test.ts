import { describe, expect, it } from "vitest";
import { VENUE_SERVICE_DASHBOARD } from "./index.js";

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
});
