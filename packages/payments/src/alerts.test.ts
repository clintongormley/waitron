import { expect, it } from "vitest";
import { PAYMENTS_ALERTS } from "./index.js";

it("claims payment. incidents for the payments area under payments.manage", () => {
  expect(PAYMENTS_ALERTS).toEqual({
    events: [{ prefix: "payment.", area: "payments", permission: "payments.manage" }],
  });
});
