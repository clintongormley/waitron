import { expect, it } from "vitest";
import { alertMessage, hasAlertMessage } from "./alerts.js";

it("registers the dashboard's alert wording on import", () => {
  expect(hasAlertMessage("payment.offline_forward_declined")).toBe(true);
  expect(
    alertMessage("payment.offline_forward_declined", { amount: "12.50", paymentRef: "pi_1" }, "en"),
  ).toBe(
    "A card payment of 12.50 taken while offline was declined when it was sent on (reference pi_1). Collect the money another way.",
  );
});
