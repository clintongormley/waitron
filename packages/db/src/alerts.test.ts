import { expect, it } from "vitest";
import { CORE_ALERTS } from "./index.js";

it("claims chain. and clock. incidents for the fiscal area under fiscal.view", () => {
  expect(CORE_ALERTS).toEqual({
    events: [
      { prefix: "chain.", area: "fiscal", permission: "fiscal.view" },
      { prefix: "clock.", area: "fiscal", permission: "fiscal.view" },
    ],
  });
});
