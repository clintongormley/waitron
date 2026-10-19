import { expect, it } from "vitest";
import { PAYMENTS_ALERTS } from "./index.js";

it("claims payment. incidents for the payments area under payments.manage, linking held payments to Payments", () => {
  expect(PAYMENTS_ALERTS).toEqual({
    events: [
      { prefix: "payment.", area: "payments", permission: "payments.manage" },
      {
        prefix: "payment.reconcile_held",
        area: "payments",
        permission: "payments.manage",
        screen: "payments",
      },
    ],
  });
});
