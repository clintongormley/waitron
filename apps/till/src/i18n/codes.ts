import { currentLocale, pickLocale } from "./t.js";

// An operator must never see a raw wire code: a code missing from this table degrades to the GENERIC
// sentence. Add new codes with BOTH columns.
const CODE_MESSAGES: Record<string, { en: string; es: string }> = {
  "working_order.out_of_date": {
    en: "Someone else changed this order. Reload it and make your change again",
    es: "Otra persona ha cambiado este pedido. Vuelve a cargarlo y repite el cambio",
  },
  "party.out_of_date": {
    en: "Someone else changed this table. Reload it and try again",
    es: "Otra persona ha cambiado esta mesa. Vuelve a cargarla e inténtalo de nuevo",
  },
  "party.not_open": {
    en: "This table has changed since you opened it. Reload the floor and try again",
    es: "Esta mesa ha cambiado desde que la abriste. Vuelve a cargar el plano e inténtalo de nuevo",
  },
  "party.bill_outstanding": {
    en: "A bill for this table is still unpaid. Take payment before finishing the table",
    es: "Hay una cuenta de esta mesa sin pagar. Cóbrala antes de cerrar la mesa",
  },
  "tab.already_open": {
    en: "Another party is already seated at this table. Check the floor and try again",
    es: "Ya hay clientes sentados en esta mesa. Revisa la sala e inténtalo de nuevo",
  },
  "table.needs_clearing": {
    en: "That table needs clearing first. Mark it cleared, then try again",
    es: "Esa mesa está por recoger. Márcala como recogida e inténtalo de nuevo",
  },
  "table.not_found": {
    en: "That table no longer exists",
    es: "Esa mesa ya no existe",
  },
  "table.inactive": {
    en: "That table is no longer in use. Choose another table",
    es: "Esa mesa ya no está en uso. Elige otra mesa",
  },
  "table.already_in_party": {
    en: "Those guests already have that table. Choose another table",
    es: "Esa mesa ya es de estos clientes. Elige otra mesa",
  },
  "party.main_bill_stays": {
    en: "This is the table's main bill, and the table has other unpaid bills. Move one of those instead",
    es: "Es la cuenta principal de la mesa, y la mesa tiene otras cuentas sin pagar. Mueve una de esas",
  },
  "service_zone.join_mismatch": {
    en: "Those tables are in different service areas, so they cannot be joined",
    es: "Esas mesas están en zonas de servicio distintas, así que no se pueden unir",
  },
  "service_zone.mode_incompatible": {
    en: "That table is in an area that does not seat guests. Choose another table",
    es: "Esa mesa está en una zona sin servicio de mesa. Elige otra mesa",
  },
  "table.not_shared": {
    en: "This is the only table these guests have, so it cannot be split off",
    es: "Es la única mesa de estos clientes, así que no se puede separar",
  },
  "table.not_joined": {
    en: "That table is not one of these guests' tables. Reload the table and try again",
    es: "Esa mesa no es de estos clientes. Vuelve a cargar la mesa e inténtalo de nuevo",
  },
  "group.not_held": {
    en: "Those items have already gone to the kitchen. Check the table before trying again",
    es: "Esos artículos ya se han enviado a cocina. Revisa la mesa antes de volver a intentarlo",
  },
  "group.not_waiting": {
    en: "Only the next group to fire can be snoozed. Check the table before trying again",
    es: "Solo se puede posponer el siguiente grupo por marchar. Revisa la mesa antes de volver a intentarlo",
  },
  "group.not_found": {
    en: "Those items are no longer on this table. Check the table before trying again",
    es: "Esos artículos ya no están en esta mesa. Revisa la mesa antes de volver a intentarlo",
  },
  "group.held_leaves_party": {
    en: "Items still on hold cannot move to another table until their group is fired",
    es: "Los artículos en espera no se pueden pasar a otra mesa hasta que se marche su grupo",
  },
  "group.line_held": {
    en: "This item is on hold and cannot be sent or served yet",
    es: "Este artículo está en espera y todavía no se puede enviar ni servir",
  },
  "submission.id_reused": {
    en: "This request could not be matched to what was sent before. Reload and try again",
    es: "Esta petición no coincide con la que se envió antes. Vuelve a cargar e inténtalo de nuevo",
  },
  "draft.taken_over": {
    en: "This order belongs to someone else. Reload the table to see it",
    es: "Este pedido es de otra persona. Vuelve a cargar la mesa para verlo",
  },
  "draft.already_submitted": {
    en: "This order has already been sent. Reload the table to see it",
    es: "Este pedido ya se ha enviado. Vuelve a cargar la mesa para verlo",
  },
  "draft.out_of_date": {
    en: "This order has changed since you opened it. Reload it and make your change again",
    es: "Este pedido ha cambiado desde que lo abriste. Vuelve a cargarlo y repite el cambio",
  },
  "draft.not_found": {
    en: "This unsent order is no longer on this table. Reload the table and try again",
    es: "Este pedido sin enviar ya no está en esta mesa. Vuelve a cargar la mesa e inténtalo de nuevo",
  },
  "bill.payments_received": {
    en: "Money has already been taken on this bill. Take the rest from the bill's payments. To discard or merge the bill, give that money back first",
    es: "Ya se ha cobrado dinero en esta cuenta. Cobra el resto desde los pagos de la cuenta. Para descartar o juntar la cuenta, devuelve primero ese dinero",
  },
  "bill.presented": {
    en: "This bill has been presented, so it cannot be changed",
    es: "Esta cuenta ya se ha presentado, así que no se puede cambiar",
  },
  "tab.not_open": {
    en: "That bill is no longer open. Choose another bill and send again",
    es: "Esa cuenta ya no está abierta. Elige otra cuenta y vuelve a enviar el pedido",
  },
  "bill.paid": {
    en: "This bill is paid",
    es: "Esta cuenta ya está pagada",
  },
  "bill.other_party": {
    en: "That bill belongs to other guests",
    es: "Esa cuenta es de otros clientes",
  },
  "bill.line_paid": {
    en: "This item has already been paid for, so it cannot be changed, moved or charged again. Refund its payment first",
    es: "Este artículo ya está pagado, así que no se puede cambiar, mover ni cobrar otra vez. Devuelve antes su pago",
  },
  "bill.received_exceeds_total": {
    en: "The bill would owe less than has already been paid on it. Move fewer items, or refund the difference first",
    es: "La cuenta quedaría por debajo de lo que ya se ha pagado. Mueve menos artículos o devuelve antes la diferencia",
  },
  "bill.nothing_outstanding": {
    en: "Nothing is left to pay on this bill",
    es: "No queda nada por pagar en esta cuenta",
  },
  "bill.tip_not_allowed": {
    en: "This venue does not take tips. Charge only what the bill owes",
    es: "Este local no acepta propinas. Cobra solo lo que se debe de la cuenta",
  },
  "bill.allocation_changed": {
    en: "The bill changed while you were paying. Check the new amounts and confirm again",
    es: "La cuenta ha cambiado mientras cobrabas. Revisa los nuevos importes y vuelve a confirmar",
  },
  "bill.payment_not_found": {
    en: "That payment is no longer on this bill. Reload the bill and try again",
    es: "Ese pago ya no está en esta cuenta. Vuelve a cargar la cuenta e inténtalo de nuevo",
  },
  "bill.refund_exceeds_payment": {
    en: "That is more than this payment can give back. A tip is given back only with the whole payment",
    es: "Es más de lo que se puede devolver de este pago. La propina solo se devuelve con el pago entero",
  },
  "bill.refund_not_whole": {
    en: "A payment for particular items can only be given back in full, which frees those items to be paid for again",
    es: "Un pago de artículos concretos solo se puede devolver entero, y así esos artículos se pueden volver a cobrar",
  },
  "bill.refund_unsupported": {
    en: "This card payment can't be refunded automatically. If it was taken on a separate terminal, refund it there and record it with a manager's PIN",
    es: "Este pago con tarjeta no se puede devolver automáticamente. Si se cobró en otro datáfono, devuélvelo allí y regístralo con el PIN de un responsable",
  },
  "bill.manual_refund_pin_required": {
    en: "A manager must enter their PIN to confirm this terminal refund",
    es: "Un responsable debe introducir su PIN para confirmar esta devolución en el datáfono",
  },
  "payment.not_refundable": {
    en: "This card payment can no longer be given back. Reload the bill and try again",
    es: "Este pago con tarjeta ya no se puede devolver. Vuelve a cargar la cuenta e inténtalo de nuevo",
  },
  "payment.refund_exceeds_capture": {
    en: "That is more than is left to give back on this card payment. Reload the bill and check the amount",
    es: "Es más de lo que queda por devolver de este pago con tarjeta. Vuelve a cargar la cuenta y revisa el importe",
  },
  "bill.refund_in_progress": {
    en: "A card refund on this bill is still waiting for the card provider. The bill cannot be changed until it finishes",
    es: "Una devolución con tarjeta de esta cuenta sigue esperando al proveedor de pagos. No se puede cambiar la cuenta hasta que termine",
  },
  "order.payment_in_flight": {
    en: "A card payment for this order is in progress. Wait for it to finish before changing the order",
    es: "Se está cobrando este pedido con tarjeta. Espera a que termine antes de cambiarlo",
  },
  "ticket.already_started": {
    en: "The kitchen has already started this item, so it can no longer be changed. You can cancel it",
    es: "La cocina ya ha empezado este plato, así que ya no se puede cambiar. Puedes cancelarlo",
  },
  "ticket.already_fired": {
    en: "This item has already gone to the kitchen, and this venue does not allow changing items once sent. You can cancel it",
    es: "Este plato ya ha ido a cocina y en este local no se pueden cambiar los platos enviados. Puedes cancelarlo",
  },
  "tab.void_quantity_invalid": {
    en: "That quantity cannot be cancelled from this line. Check how many are left on it",
    es: "No se puede cancelar esa cantidad de esta línea. Comprueba cuántos quedan",
  },
  "tab.serve_quantity_invalid": {
    en: "That quantity cannot be marked on this line. Check how many are left to serve, or how many were served",
    es: "No se puede marcar esa cantidad en esta línea. Comprueba cuántos quedan por servir o cuántos se han servido",
  },
  "product.unavailable": {
    en: "An item on this order has sold out. Remove it and try again",
    es: "Un artículo de este pedido está agotado. Quítalo e inténtalo de nuevo",
  },
  "product.not_sold_separately": {
    en: "An item on this order can only be added as an extra to another dish. Remove it and try again",
    es: "Un artículo de este pedido solo se puede añadir como extra de otro plato. Quítalo e inténtalo de nuevo",
  },
  "menu.version_changed": {
    en: "The menu has changed since this order was started. Check the order and try again",
    es: "La carta ha cambiado desde que se empezó este pedido. Revisa el pedido e inténtalo de nuevo",
  },
  "swap.not_permitted": {
    en: "You can only offer your own shifts and accept swaps offered to you",
    es: "Solo puedes ofrecer tus propios turnos y aceptar los cambios que te ofrezcan",
  },
  "swap.not_acceptable": {
    en: "That swap can no longer be accepted",
    es: "Ese cambio ya no se puede aceptar",
  },
  "swap.not_found": {
    en: "That swap could not be found",
    es: "No se ha encontrado ese cambio de turno",
  },
  "shift.not_found": {
    en: "That shift could not be found",
    es: "No se ha encontrado ese turno",
  },
  "absence.overlaps": {
    en: "You already have time off that overlaps those dates",
    es: "Ya tienes una ausencia que se solapa con esas fechas",
  },
  // `device.join_rate_limited` and `device.join_full` are deliberately UNMAPPED: both leave the operator
  // only "try again", which the generic sentence says, and naming either would tell an unapproved
  // device something about the venue's state.
  "device.pairing_closed": {
    en: "New devices aren't being accepted right now. Ask a manager to switch on “Allow new devices”.",
    es: "Ahora mismo no se aceptan dispositivos nuevos. Pide a un responsable que active «Permitir dispositivos nuevos».",
  },
  "device.unauthorized": {
    en: "This device isn't set up — ask to join this venue",
    es: "Este dispositivo no está configurado. Solicita el alta en este local",
  },
  "session.required": {
    en: "Your shift session has ended — please log in again",
    es: "Tu sesión ha terminado. Vuelve a iniciar sesión",
  },
  "management.request_invalid": {
    en: "Check the form and try again",
    es: "Revisa el formulario e inténtalo de nuevo",
  },
  "shared.invalid_id": {
    en: "That request isn't valid",
    es: "Esa solicitud no es válida",
  },
  "server.internal": {
    en: "Something went wrong, try again",
    es: "Algo salió mal, inténtalo de nuevo",
  },
};

// Deliberately the SAME entry as `server.internal`: to the operator, an unmapped code and an internal
// error both mean something failed, retry.
const GENERIC = CODE_MESSAGES["server.internal"]!;

/** Always a readable sentence, never the raw code. `locale` may be a full BCP-47 tag ("es-ES"). */
export function codeMessage(code: string, locale: string = currentLocale()): string {
  // Own-key check, not `?? GENERIC`: a code such as `constructor` would resolve an inherited
  // Object.prototype member under a bare lookup.
  const entry = Object.hasOwn(CODE_MESSAGES, code) ? CODE_MESSAGES[code]! : GENERIC;
  return pickLocale(entry, locale);
}
