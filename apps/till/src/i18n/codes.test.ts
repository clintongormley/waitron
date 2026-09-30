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

it("localises the refusals of changing a sent line in both languages", () => {
  for (const code of ["ticket.already_started", "ticket.already_fired"]) {
    const generic = codeMessage("some.unmapped_code", "en");
    expect(codeMessage(code, "en")).not.toBe(generic);
    expect(codeMessage(code, "es")).not.toBe(codeMessage("some.unmapped_code", "es"));
    expect(codeMessage(code, "en")).not.toBe(codeMessage(code, "es"));
  }
  expect(codeMessage("ticket.already_started", "en")).toBe(
    "The kitchen has already started this item, so it can no longer be changed. You can cancel it",
  );
});

it("says in both languages that a served quantity does not fit the line", () => {
  expect(codeMessage("tab.serve_quantity_invalid", "en")).toBe(
    "That quantity cannot be marked on this line. Check how many are left to serve, or how many were served",
  );
  expect(codeMessage("tab.serve_quantity_invalid", "es")).toBe(
    "No se puede marcar esa cantidad en esta línea. Comprueba cuántos quedan por servir o cuántos se han servido",
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
    "Ya se ha cobrado dinero en esta cuenta. Cobra el resto desde los pagos de la cuenta. Para descartar o juntar la cuenta, devuelve primero ese dinero",
  );
});

it("explains each refusal of an unsent order, in both languages", () => {
  expect(
    ["draft.taken_over", "draft.already_submitted", "draft.out_of_date", "draft.not_found"].map(
      (code) => [codeMessage(code, "en"), codeMessage(code, "es")],
    ),
  ).toEqual([
    [
      "This order belongs to someone else. Reload the table to see it",
      "Este pedido es de otra persona. Vuelve a cargar la mesa para verlo",
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

it("explains each refusal about a table's party, in both languages", () => {
  expect(
    [
      "party.not_open",
      "party.out_of_date",
      "party.bill_outstanding",
      "group.held_leaves_party",
    ].map((code) => [codeMessage(code, "en"), codeMessage(code, "es")]),
  ).toEqual([
    [
      "This table has changed since you opened it. Reload the floor and try again",
      "Esta mesa ha cambiado desde que la abriste. Vuelve a cargar el plano e inténtalo de nuevo",
    ],
    [
      "Someone else changed this table. Reload it and try again",
      "Otra persona ha cambiado esta mesa. Vuelve a cargarla e inténtalo de nuevo",
    ],
    [
      "A bill for this table is still unpaid. Take payment before finishing the table",
      "Hay una cuenta de esta mesa sin pagar. Cóbrala antes de cerrar la mesa",
    ],
    [
      "Items still on hold cannot move to another table until their group is fired",
      "Los artículos en espera no se pueden pasar a otra mesa hasta que se marche su grupo",
    ],
  ]);
});

it("words the presented, paid and other-party refusals of an order sent to a bill it cannot go on, in both languages", () => {
  expect(codeMessage("bill.presented", "en")).toBe(
    "This bill has been presented, so it cannot be changed",
  );
  expect(codeMessage("bill.presented", "es")).toBe(
    "Esta cuenta ya se ha presentado, así que no se puede cambiar",
  );
  expect(codeMessage("bill.paid", "en")).toBe("This bill is paid");
  expect(codeMessage("bill.paid", "es")).toBe("Esta cuenta ya está pagada");
  expect(codeMessage("bill.other_party", "en")).toBe("That bill belongs to other guests");
  expect(codeMessage("bill.other_party", "es")).toBe("Esa cuenta es de otros clientes");
});

it("words an order sent to a bill that is no longer open, in both languages", () => {
  expect(codeMessage("tab.not_open", "en")).toBe(
    "That bill is no longer open. Choose another bill and send again",
  );
  expect(codeMessage("tab.not_open", "es")).toBe(
    "Esa cuenta ya no está abierta. Elige otra cuenta y vuelve a enviar el pedido",
  );
});

it("explains a snooze refused because another group is the one waiting, in both languages", () => {
  expect([codeMessage("group.not_waiting", "en"), codeMessage("group.not_waiting", "es")]).toEqual([
    "Only the next group to fire can be snoozed. Check the table before trying again",
    "Solo se puede posponer el siguiente grupo por marchar. Revisa la mesa antes de volver a intentarlo",
  ]);
});

it("says a table needs clearing, and that a table has gone, in both languages", () => {
  expect(codeMessage("table.needs_clearing", "en")).toBe(
    "That table needs clearing first. Mark it cleared, then try again",
  );
  expect(codeMessage("table.needs_clearing", "es")).toBe(
    "Esa mesa está por recoger. Márcala como recogida e inténtalo de nuevo",
  );
  expect(codeMessage("table.not_found", "en")).toBe("That table no longer exists");
  expect(codeMessage("table.not_found", "es")).toBe("Esa mesa ya no existe");
});

it("words the refusals a bill move to a table or away from its party can meet, in both languages", () => {
  for (const code of ["party.main_bill_stays", "table.already_in_party", "table.inactive"]) {
    for (const locale of ["en", "es"]) {
      expect(codeMessage(code, locale)).not.toBe(codeMessage("some.unmapped_code", locale));
    }
  }
  expect(codeMessage("party.main_bill_stays", "en")).toBe(
    "This is the table's main bill, and the table has other unpaid bills. Move one of those instead",
  );
  expect(codeMessage("party.main_bill_stays", "es")).toBe(
    "Es la cuenta principal de la mesa, y la mesa tiene otras cuentas sin pagar. Mueve una de esas",
  );
  expect(codeMessage("table.already_in_party", "en")).toBe(
    "Those guests already have that table. Choose another table",
  );
  expect(codeMessage("table.already_in_party", "es")).toBe(
    "Esa mesa ya es de estos clientes. Elige otra mesa",
  );
  expect(codeMessage("table.inactive", "en")).toBe(
    "That table is no longer in use. Choose another table",
  );
  expect(codeMessage("table.inactive", "es")).toBe("Esa mesa ya no está en uso. Elige otra mesa");
});

it("words Split a table's refusals of a table the party does not hold, or its only table, in both languages", () => {
  expect(codeMessage("table.not_joined", "en")).toBe(
    "That table is not one of these guests' tables. Reload the table and try again",
  );
  expect(codeMessage("table.not_joined", "es")).toBe(
    "Esa mesa no es de estos clientes. Vuelve a cargar la mesa e inténtalo de nuevo",
  );
  expect(codeMessage("table.not_shared", "en")).toBe(
    "This is the only table these guests have, so it cannot be split off",
  );
  expect(codeMessage("table.not_shared", "es")).toBe(
    "Es la única mesa de estos clientes, así que no se puede separar",
  );
});

it("says in both languages why a table cannot be joined across service areas, or seats no guests", () => {
  expect(codeMessage("service_zone.join_mismatch", "en")).toBe(
    "Those tables are in different service areas, so they cannot be joined",
  );
  expect(codeMessage("service_zone.join_mismatch", "es")).toBe(
    "Esas mesas están en zonas de servicio distintas, así que no se pueden unir",
  );
  expect(codeMessage("service_zone.mode_incompatible", "en")).toBe(
    "That table is in an area that does not seat guests. Choose another table",
  );
  expect(codeMessage("service_zone.mode_incompatible", "es")).toBe(
    "Esa mesa está en una zona sin servicio de mesa. Elige otra mesa",
  );
});

it("explains each refusal a cancel, comp or discount can give, in both languages", () => {
  const generic = {
    en: codeMessage("server.internal", "en"),
    es: codeMessage("server.internal", "es"),
  };
  for (const code of [
    "adjustment.action_not_allowed",
    "adjustment.over_limit",
    "adjustment.note_required",
    "adjustment.reason_inactive",
    "adjustment.exceeds_amount",
    "adjustment.approval_required",
    "adjustment.weighed_partial",
    "adjustment.quantity_invalid",
    "adjustment_reason.not_found",
  ]) {
    expect(codeMessage(code, "en"), code).not.toBe(generic.en);
    expect(codeMessage(code, "es"), code).not.toBe(generic.es);
    expect(codeMessage(code, "en"), code).not.toBe(codeMessage(code, "es"));
  }
  expect(codeMessage("adjustment.weighed_partial", "en")).toBe(
    "A weighed item can't be split. Give a discount on the whole line instead",
  );
});
