import { expect, it } from "vitest";
import { PAYMENTS_ALERTS } from "./index.js";

it("claims payment. incidents for the payments area under hardware.manage, linking held payments to Payments", () => {
  expect(PAYMENTS_ALERTS).toEqual({
    events: [
      { prefix: "payment.", area: "payments", permission: "hardware.manage" },
      {
        prefix: "payment.reconcile_held",
        area: "payments",
        permission: "hardware.manage",
        screen: "payments",
      },
    ],
  });
});
