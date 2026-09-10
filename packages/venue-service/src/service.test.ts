import { describe, expect, it } from "vitest";
import { VENUE_SERVICE } from "./service.js";

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
    ]);
  });
});
