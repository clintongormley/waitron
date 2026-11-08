import { expect, it } from "vitest";
import { VENUE_SERVICE_ALERTS } from "./index.js";

it("claims route. incidents for the kitchen area under venue.configure", () => {
  expect(VENUE_SERVICE_ALERTS).toEqual({
    events: [{ prefix: "route.", area: "kitchen", permission: "venue.configure" }],
  });
});
