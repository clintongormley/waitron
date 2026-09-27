import { afterEach, expect, it } from "vitest";
import { setLocale } from "./t.js";
import { codeMessage } from "./codes.js";

afterEach(() => {
  // t.ts's locale is module-level, so a setLocale in one test would leak into the next.
  setLocale("en-GB");
});

it("resolves a known code to friendly copy in English and Spanish", () => {
  expect(codeMessage("absence.overlaps", "en")).toBe(
    "You already have time off that overlaps those dates",
  );
  expect(codeMessage("absence.overlaps", "es-ES")).toBe(
    "Ya tienes una ausencia que se solapa con esas fechas",
  );
});

it("strips the region subtag — es-ES resolves to the es copy", () => {
  expect(codeMessage("swap.not_permitted", "es-ES")).toBe(codeMessage("swap.not_permitted", "es"));
});

it("degrades an UNKNOWN code to the generic sentence, never the raw code", () => {
  const msg = codeMessage("some.unmapped_code", "en");
  expect(msg).toBe("Something went wrong, try again");
  expect(msg).not.toContain("some.unmapped_code");
});

it("degrades a code colliding with an Object.prototype member to the generic sentence", () => {
  // "toString"/"constructor" resolve an inherited method under a bare lookup.
  expect(codeMessage("toString", "en")).toBe("Something went wrong, try again");
  expect(codeMessage("constructor", "es")).toBe("Algo salió mal, inténtalo de nuevo");
});

it("defaults to the module locale when none is passed (shipped default en-GB)", () => {
  expect(codeMessage("swap.not_found")).toBe("That swap could not be found");
  setLocale("es-ES");
  expect(codeMessage("swap.not_found")).toBe("No se ha encontrado ese cambio de turno");
});

it("resolves a shut pairing window to its own actionable copy, in both locales (device-join-and-accept §2)", () => {
  expect(codeMessage("device.pairing_closed", "en")).toBe(
    "New devices aren't being accepted right now. Ask a manager to switch on “Allow new devices”.",
  );
  expect(codeMessage("device.pairing_closed", "es")).toBe(
    "Ahora mismo no se aceptan dispositivos nuevos. Pide a un responsable que active «Permitir dispositivos nuevos».",
  );
  expect(codeMessage("device.unauthorized", "en")).toBe(
    "This device isn't set up — ask to join this venue",
  );
});

it("degrades the other join refusals to the generic sentence, naming nothing about the venue", () => {
  // Deliberate: a specific sentence for either would tell an unapproved device something about the
  // venue's state.
  expect(codeMessage("device.join_rate_limited", "en")).toBe("Something went wrong, try again");
  expect(codeMessage("device.join_full", "en")).toBe("Something went wrong, try again");
});

it("tells staff a card payment is running on the order, and that a dish has sold out, in both languages", () => {
  expect(codeMessage("order.payment_in_flight", "en")).toBe(
    "A card payment for this order is in progress. Wait for it to finish before changing the order",
  );
  expect(codeMessage("order.payment_in_flight", "es")).toBe(
    "Se está cobrando este pedido con tarjeta. Espera a que termine antes de cambiarlo",
  );
  expect(codeMessage("product.unavailable", "en")).toBe(
    "An item on this order has sold out. Remove it and try again",
  );
  expect(codeMessage("product.unavailable", "es")).toBe(
    "Un artículo de este pedido está agotado. Quítalo e inténtalo de nuevo",
  );
});

it("localises the refusals of changing or cancelling a sent line in both languages", () => {
  for (const code of [
    "ticket.already_started",
    "ticket.already_fired",
    "tab.void_quantity_invalid",
  ]) {
    const generic = codeMessage("some.unmapped_code", "en");
    expect(codeMessage(code, "en")).not.toBe(generic);
    expect(codeMessage(code, "es")).not.toBe(codeMessage("some.unmapped_code", "es"));
    expect(codeMessage(code, "en")).not.toBe(codeMessage(code, "es"));
  }
  expect(codeMessage("ticket.already_started", "en")).toBe(
    "The kitchen has already started this item, so it can no longer be changed. You can cancel it",
  );
});

it("explains each refusal a bill paid in parts can give, in both languages, naming no identifier", () => {
  const generic = {
    en: codeMessage("server.internal", "en"),
    es: codeMessage("server.internal", "es"),
  };
  for (const code of [
    "bill.payments_received",
    "bill.line_paid",
    "bill.received_exceeds_total",
    "bill.nothing_outstanding",
    "bill.tip_not_allowed",
    "bill.allocation_changed",
    "bill.payment_not_found",
    "bill.refund_exceeds_payment",
    "bill.refund_not_whole",
    "bill.refund_unsupported",
    "bill.manual_refund_pin_required",
    "bill.refund_in_progress",
    "payment.not_refundable",
    "payment.refund_exceeds_capture",
  ]) {
    expect(codeMessage(code, "en")).not.toBe(generic.en);
    expect(codeMessage(code, "es")).not.toBe(generic.es);
    expect(codeMessage(code, "en")).not.toContain(code);
  }
  expect(codeMessage("bill.payments_received", "en")).toBe(
    "Money has already been taken on this bill. Take the rest from the bill's payments. To discard or merge the bill, give that money back first",
  );
  expect(codeMessage("bill.payments_received", "es")).toBe(
    "Ya se ha cobrado dinero en esta cuenta. Cobra el resto desde los pagos de la cuenta. Para descartar o combinar la cuenta, devuelve primero ese dinero",
  );
});

it("explains each refusal of an unsent order, in both languages", () => {
  expect(
    ["draft.taken_over", "draft.already_submitted", "draft.out_of_date", "draft.not_found"].map(
      (code) => [codeMessage(code, "en"), codeMessage(code, "es")],
    ),
  ).toEqual([
    [
      "Someone else has taken over this order. Reload the table to see it",
      "Otra persona se ha hecho cargo de este pedido. Vuelve a cargar la mesa para verlo",
    ],
    [
      "This order has already been sent. Reload the table to see it",
      "Este pedido ya se ha enviado. Vuelve a cargar la mesa para verlo",
    ],
    [
      "This order has changed since you opened it. Reload it and make your change again",
      "Este pedido ha cambiado desde que lo abriste. Vuelve a cargarlo y repite el cambio",
    ],
    [
      "This unsent order is no longer on this table. Reload the table and try again",
      "Este pedido sin enviar ya no está en esta mesa. Vuelve a cargar la mesa e inténtalo de nuevo",
    ],
  ]);
});
