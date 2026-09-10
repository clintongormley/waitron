import { describe, expect, it } from "vitest";
import { VENUE_SERVICE } from "./service.js";
import { VENUE_SERVICE_CONFIGURATION_TRANSFER } from "./configuration-transfer.js";

describe("VENUE_SERVICE", () => {
  it("exposes every generic ordering capability", () => {
    expect(Object.keys(VENUE_SERVICE).sort()).toEqual([
      "copyLineContext",
      "copyOrderContext",
      "findOrderContext",
      "getOrderContext",
      "listLineContexts",
      "listServiceZones",
      "listZoneOffers",
      "recordLineContexts",
      "recordOrderContext",
      "resolveNewOrderZone",
      "resolvePreparationRoute",
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
});
