import { describe, expect, it } from "vitest";
import { VENUE_SERVICE } from "./service.js";
import { VENUE_SERVICE_CONFIGURATION_TRANSFER } from "./configuration-transfer.js";

describe("VENUE_SERVICE", () => {
  it("exposes every generic ordering capability", () => {
    expect(Object.keys(VENUE_SERVICE).sort()).toEqual([
      "acknowledgeKitchenNotice",
      "copyLineContext",
      "copyOrderContext",
      "describeMakers",
      "findOrderContext",
      "findOrderModes",
      "findOrderZones",
      "getOrderContext",
      "listLineContexts",
      "listServiceZones",
      "listStationNotices",
      "listZoneOffers",
      "menuState",
      "readClearingWorkflow",
      "readEditSentLines",
      "readKitchenTicketGrouping",
      "readLinesSoldInEach",
      "readPrintHeldWork",
      "readProfileServiceAccess",
      "readReleaseReminderMinutes",
      "readSaleReceiptHeader",
      "recordKitchenNotices",
      "recordLineContexts",
      "recordOrderContext",
      "recordSaleReceiptHeader",
      "resolveExtraMakers",
      "resolveMakers",
      "resolveNewOrderZone",
      "resolveSalePolicy",
      "resolveZoneContext",
      "retargetOrderContext",
      "routingAt",
      "stationStates",
    ]);
  });

  it("does not transfer device defaults without their device rows", () => {
    expect(VENUE_SERVICE_CONFIGURATION_TRANSFER.tables.map((table) => table.name)).not.toContain(
      "device_zone_defaults",
    );
  });

  it("transfers the service settings, and never the kitchen notices, which are operational rows", () => {
    const names = VENUE_SERVICE_CONFIGURATION_TRANSFER.tables.map((table) => table.name);
    expect(names).toContain("service_settings");
    expect(names).not.toContain("kitchen_notices");
  });

  it("transfers a profile's department, zones and kitchen lists, which travel with profiles", () => {
    const names = VENUE_SERVICE_CONFIGURATION_TRANSFER.tables.map((table) => table.name);
    expect(names).toContain("device_profile_service_access");
    expect(names).toContain("device_profile_zones");
    expect(names).toContain("device_profile_stations");
    expect(names).toContain("device_profile_watchers");
    expect(names.indexOf("device_profile_service_access")).toBeLessThan(
      names.indexOf("device_profile_zones"),
    );
  });

  it("transfers opening hours and fallbacks but not today's by-hand state", () => {
    const names = VENUE_SERVICE_CONFIGURATION_TRANSFER.tables.map((table) => table.name);
    for (const table of [
      "hours_week_cells",
      "hours_week_periods",
      "special_dates",
      "special_date_hours",
      "special_date_hours_periods",
    ])
      expect(names).toContain(table);
    expect(names).not.toContain("station_hours");
    expect(names).not.toContain("department_hours");
    expect(names).toContain("station_fallbacks");
    expect(names).not.toContain("station_day_states");
  });
});
