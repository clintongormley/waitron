import { expect, it } from "vitest";
import { CORE_ALERTS } from "./index.js";

it("claims chain., clock. and invoice_correction. incidents for fiscal.view, and backup. incidents for system.manage", () => {
  expect(CORE_ALERTS).toEqual({
    events: [
      { prefix: "chain.", area: "fiscal", permission: "fiscal.view" },
      { prefix: "clock.", area: "fiscal", permission: "fiscal.view" },
      { prefix: "invoice_correction.", area: "fiscal", permission: "fiscal.view" },
      { prefix: "backup.", area: "backup", permission: "system.manage", screen: "backup" },
    ],
  });
});
