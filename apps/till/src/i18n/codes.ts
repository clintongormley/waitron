import { currentLocale, pickLocale } from "./t.js";

// An operator must never see a raw wire code: a code missing from this table degrades to the GENERIC
// sentence. Add new codes with BOTH columns.
const CODE_MESSAGES: Record<string, { en: string; es: string }> = {
  "working_order.out_of_date": {
    en: "Someone else changed this order. Reload it and make your change again",
    es: "Otra persona ha cambiado este pedido. Vuelve a cargarlo y repite el cambio",
  },
  "visit.out_of_date": {
    en: "Someone else changed this table. Reload it and try again",
    es: "Otra persona ha cambiado esta mesa. Vuelve a cargarla e inténtalo de nuevo",
  },
  "visit.not_open": {
    en: "This table has changed since you opened it. Reload the floor and try again",
    es: "Esta mesa ha cambiado desde que la abriste. Vuelve a cargar el plano e inténtalo de nuevo",
  },
  "visit.bill_outstanding": {
    en: "A bill for this table is still unpaid. Take payment before finishing the table",
    es: "Hay una cuenta de esta mesa sin pagar. Cóbrala antes de cerrar la mesa",
  },
  "table.occupied": {
    en: "That table is already taken. Choose a free table",
    es: "Esa mesa ya está ocupada. Elige una mesa libre",
  },
  "tab.already_open": {
    en: "Another party is already seated at this table. Check the floor and try again",
    es: "Ya hay clientes sentados en esta mesa. Revisa la sala e inténtalo de nuevo",
  },
  "table.not_shared": {
    en: "This is the party's only table, so it cannot be separated from its bill",
    es: "Es la única mesa de estos clientes, así que no se puede separar de su cuenta",
  },
  "submission.id_reused": {
    en: "This request could not be matched to what was sent before. Reload and try again",
    es: "Esta petición no coincide con la que se envió antes. Vuelve a cargar e inténtalo de nuevo",
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
  "product.unavailable": {
    en: "An item on this order has sold out. Remove it and try again",
    es: "Un artículo de este pedido está agotado. Quítalo e inténtalo de nuevo",
  },
  "modifier.invalid": {
    en: "Check the modifier choices and try again",
    es: "Revisa las opciones del modificador e inténtalo de nuevo",
  },
  "modifier.not_found": {
    en: "That modifier is no longer available",
    es: "Ese modificador ya no está disponible",
  },
  "modifier.in_use": {
    en: "This modifier is in use. Deactivate it instead",
    es: "Este modificador está en uso. Desactívalo",
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
