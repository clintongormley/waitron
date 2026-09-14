import { expect, it } from "vitest";
import { FISCAL_ALERTS } from "./index.js";

it("claims fiscal. incidents for the fiscal area under fiscal.view", () => {
  expect(FISCAL_ALERTS).toEqual({
    events: [{ prefix: "fiscal.", area: "fiscal", permission: "fiscal.view" }],
  });
});
