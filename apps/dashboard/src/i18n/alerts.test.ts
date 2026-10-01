import { expect, it } from "vitest";
import { alertMessage, hasAlertMessage } from "./alerts.js";
import { ALERT_MESSAGES } from "./alert-messages.js";

it("registers the dashboard's alert wording on import", () => {
  expect(hasAlertMessage("payment.offline_forward_declined")).toBe(true);
  expect(
    alertMessage("payment.offline_forward_declined", { amount: "12.50", paymentRef: "pi_1" }, "en"),
  ).toBe(
    "A card payment of €12.50 taken while offline was declined when it was sent on (reference pi_1). Collect the money another way.",
  );
});

// The clock only raises this for a clock that reads earlier, so the number is never positive: a
// backward step under a second is stored, and shown, as 0.
it("reads a backwards clock jump correctly with its negative number", () => {
  const params = { wallClockDeltaSeconds: -120, monotonicElapsedSeconds: 0 };
  expect(alertMessage("clock.jump_detected", params, "en")).toBe(
    "This device's clock went backwards: it changed by -120 seconds. Check its date and time.",
  );
  expect(alertMessage("clock.jump_detected", params, "es")).toBe(
    "La hora de este equipo ha retrocedido: ha cambiado -120 segundos. Revisa su fecha y hora.",
  );
});

it("shows every amount an alert carries with the euro sign, where each language writes it", () => {
  const cases: [string, Record<string, unknown>, string, string][] = [
    [
      "payment.offline_forward_declined",
      { amount: "1279.50", paymentRef: "pi_1" },
      "A card payment of €1,279.50 taken",
      "Un pago con tarjeta de 1279,50\u00a0€ cobrado",
    ],
    [
      "payment.bill_capture_mismatch",
      { captured: "30.00", expected: "25.50" },
      "charged €30.00 for a payment towards a bill that should have been €25.50.",
      "cobró 30,00\u00a0€ por un pago a cuenta de una cuenta que debía ser de 25,50\u00a0€.",
    ],
    [
      "payment.bill_settle_failed",
      { amount: "12.00" },
      "A card payment of €12.00 towards",
      "un pago de 12,00\u00a0€ a cuenta",
    ],
    [
      "payment.refund_outcome_conflict",
      { amount: "4.20" },
      "a refund of €4.20 as made",
      "una devolución de 4,20\u00a0€ que",
    ],
    [
      "payment.refund_unresolved",
      { amount: "4.20" },
      "A card refund of €4.20 has been",
      "Una devolución con tarjeta de 4,20\u00a0€ lleva",
    ],
  ];
  for (const [code, params, en, es] of cases) {
    expect(alertMessage(code, params, "en-GB"), code).toContain(en);
    expect(alertMessage(code, params, "es-ES"), code).toContain(es);
  }
});

it("names the dishes a paid order could not send to the kitchen", () => {
  const params = {
    dishes: "Croquetas, Pulpo",
    workingOrderId: "w1",
    orderNumber: 42,
    orderLabel: null,
  };
  expect(alertMessage("route.dish_not_sent", params, "en")).toBe(
    "Paid order 42 has dishes no prep station could take: Croquetas, Pulpo. They were not sent to the kitchen. Pass them to the kitchen by hand, and switch on a default station on the Prep stations page.",
  );
  expect(alertMessage("route.dish_not_sent", params, "es")).toBe(
    "El pedido pagado 42 tiene platos que ninguna estación de preparación podía recibir: Croquetas, Pulpo. No se han enviado a cocina. Pásalos a cocina a mano y activa una estación predeterminada en la página de Estaciones de preparación.",
  );
});

it("marks every amount slot in the alert wording as money", () => {
  const unmarked = Object.entries(ALERT_MESSAGES).flatMap(([code, { en, es }]) =>
    [en, es].flatMap((text) =>
      [...text.matchAll(/\{(amount|captured|expected)\}/g)].map((m) => `${code}: ${m[0]}`),
    ),
  );
  expect(unmarked).toEqual([]);
});
