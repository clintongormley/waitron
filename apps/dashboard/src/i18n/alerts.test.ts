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

// The clock only raises this for a clock that reads earlier, so the number is always negative.
it("reads a backwards clock jump correctly with its negative number", () => {
  const params = { wallClockDeltaSeconds: -120, monotonicElapsedSeconds: 0 };
  expect(alertMessage("clock.jump_detected", params, "en")).toBe(
    "This device's clock went backwards: it changed by -120 seconds. Check its date and time.",
  );
  expect(alertMessage("clock.jump_detected", params, "es")).toBe(
    "La hora de este equipo ha retrocedido: ha cambiado -120 segundos. Revisa su fecha y hora.",
  );
});
