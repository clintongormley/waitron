import { describe, expect, it } from "vitest";
import { VENUE_SERVICE } from "./service.js";
import { VENUE_SERVICE_CONFIGURATION_TRANSFER } from "./configuration-transfer.js";

describe("VENUE_SERVICE", () => {
  it("exposes every generic ordering capability", () => {
    expect(Object.keys(VENUE_SERVICE).sort()).toEqual([
      "acknowledgeKitchenNotice",
      "copyLineContext",
      "copyOrderContext",
      "findOrderContext",
      "getOrderContext",
      "listLineContexts",
      "listServiceZones",
      "listStationNotices",
      "listZoneOffers",
      "readEditSentLines",
      "recordKitchenNotices",
      "recordLineContexts",
      "recordOrderContext",
      "resolveNewOrderZone",
      "resolvePreparationRoutes",
      "resolveZoneContext",
      "resolveZoneOffer",
      "retargetOrderContext",
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
});
