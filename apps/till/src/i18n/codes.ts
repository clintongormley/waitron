import { currentLocale, pickLocale } from "./t.js";

// An operator must never see a raw wire code: a code missing from this table degrades to the GENERIC
// sentence. Add new codes with BOTH columns.
const CODE_MESSAGES: Record<string, { en: string; es: string }> = {
  "department_transfer.desk_unavailable": {
    en: "That department has no usable receiving desk. Ask a manager to check its transfer settings.",
    es: "Ese departamento no tiene un mostrador receptor disponible. Pide a un responsable que revise los ajustes de traspaso.",
  },
  "watcher.not_found": {
    en: "That watcher no longer exists.",
    es: "Ese punto de seguimiento ya no existe.",
  },
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
  "unpaid_departure.unfired_dishes": {
    en: "A bill on this table holds items the kitchen is not making: not sent, on hold, or recalled. Cancel them first, then record the departure again",
    es: "Una cuenta de esta mesa tiene artículos que cocina no está preparando: sin enviar, en espera o retirados. Cancélalos primero y vuelve a registrar la salida",
  },
  "unpaid_departure.bill_holds_payment": {
    en: "A bill on this table already holds a payment, even if it was given back, so it cannot be left unpaid. Take the rest of that bill as a payment first",
    es: "Una cuenta de esta mesa ya tiene un pago, aunque se haya devuelto, así que no se puede dejar sin pagar. Cobra primero lo que queda de esa cuenta",
  },
  "unpaid_departure.nothing_outstanding": {
    en: "Nothing is left to pay at this table. Finish the table instead",
    es: "No queda nada por pagar en esta mesa. Cierra la mesa",
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
    en: "This is the table's main bill, and the table has other unpaid bills. Move the other bills first, or merge them into this one",
    es: "Es la cuenta principal de la mesa, y la mesa tiene otras cuentas sin pagar. Mueve antes las otras cuentas o júntalas con esta",
  },
  "service_zone.join_mismatch": {
    en: "Those tables are in different service areas, so they cannot be joined",
    es: "Esas mesas están en zonas de servicio distintas, así que no se pueden unir",
  },
  "service_zone.not_allowed": {
    en: "This device's profile does not work in that area. Choose one of its own areas",
    es: "El perfil de este dispositivo no trabaja en esa zona. Elige una de sus zonas",
  },
  "device_profile.no_service_zone": {
    en: "This device's profile has no area it can take orders in. Ask a manager to set one up",
    es: "El perfil de este dispositivo no tiene ninguna zona en la que tomar pedidos. Pide a un responsable que configure una",
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
    en: "A bill that has taken payments cannot be merged, and items cannot be transferred between it and another bill. Take the rest from the bill's payments",
    es: "Una cuenta que ya ha recibido pagos no se puede juntar con otra, ni se pueden transferir artículos entre ella y otra cuenta. Cobra el resto desde los pagos de la cuenta",
  },
  "working_order.not_placed": {
    en: "This bill is no longer waiting for payment",
    es: "Esta cuenta ya no está pendiente de cobro",
  },
  "working_order.reason_required": {
    en: "Say why",
    es: "Indica el motivo",
  },
  "series.no_rectificative_for_node": {
    en: "This venue has no credit note series set up. Tell a manager",
    es: "Este local no tiene una serie de facturas rectificativas. Avisa a un responsable",
  },
  "sale.total_exceeds_simplified_limit": {
    en: "This order is over the most this till accepts without a full invoice naming the customer, which it cannot issue. Take something off the order",
    es: "Este pedido supera el máximo que admite esta caja sin una factura completa a nombre del cliente, y no puede emitirla. Quita algo del pedido",
  },
  "sale.full_invoice_unavailable": {
    en: "Full invoices are not available yet. Ask a manager",
    es: "Las facturas completas aún no están disponibles. Avisa a un responsable",
  },
  "receipt.not_printed": {
    en: "The original has not finished printing. Check its status before confirming handover",
    es: "El original aún no ha terminado de imprimirse. Comprueba su estado antes de confirmar la entrega",
  },
  "fiscal.taxpayer_domicile_missing": {
    en: "The venue's legal address is missing. Ask a manager before issuing a full invoice",
    es: "Falta el domicilio fiscal del local. Avisa a un responsable antes de emitir una factura completa",
  },
  "invoice.recipient_invalid": {
    en: "Check the customer's invoice details and try again",
    es: "Revisa los datos de facturación del cliente e inténtalo de nuevo",
  },
  "invoice_delivery.printer_invalid": {
    en: "That invoice printer is unavailable. Choose another printer or ask a manager",
    es: "Esa impresora de facturas no está disponible. Elige otra o avisa a un responsable",
  },
  "invoice_delivery.email_unavailable": {
    en: "Invoice email is unavailable. Choose paper or ask a manager",
    es: "No se puede enviar la factura por correo. Elige papel o avisa a un responsable",
  },
  "invoice.choice_locked": {
    en: "This bill has received a payment. Its full invoice choice cannot be removed",
    es: "Esta cuenta ya ha recibido un pago. No se puede quitar la elección de factura completa",
  },
  "sale.correction_exceeds_total": {
    en: "That correction is more than is left of the invoice after its earlier corrections",
    es: "Esa rectificación supera lo que queda de la factura tras sus rectificaciones anteriores",
  },
  "sale.correction_not_whole": {
    en: "This invoice has already been corrected, so it cannot be credited in full",
    es: "Esta factura ya se ha rectificado, así que no se puede abonar por completo",
  },
  "sale.correction_unsupported": {
    en: "A full invoice needs a reviewed manual correction. Ask a manager for help",
    es: "Una factura completa necesita una rectificación manual revisada. Pide ayuda a un responsable",
  },
  "bill.presented": {
    en: "This bill has been presented, so it cannot be changed",
    es: "Esta cuenta ya se ha presentado, así que no se puede cambiar",
  },
  "working_order.not_open": {
    en: "This bill is no longer open: it has been presented, paid or discarded",
    es: "Esta cuenta ya no está abierta: se ha presentado, pagado o descartado",
  },
  "working_order.already_collected": {
    en: "This order has already been handed over",
    es: "Este pedido ya se ha entregado",
  },
  "working_order.not_settled": {
    en: "This order can no longer be handed over",
    es: "Este pedido ya no se puede entregar",
  },
  "ticket.not_fired": {
    en: "Nothing on this order has gone to the kitchen, so there is nothing to hand over",
    es: "Nada de este pedido ha ido a cocina, así que no hay nada que entregar",
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
    en: "The bill would owe less than has already been paid on it. Take less off the bill, or refund the difference first",
    es: "La cuenta quedaría por debajo de lo que ya se ha pagado. Quita menos de la cuenta o devuelve antes la diferencia",
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
  "authorization.not_permitted": {
    en: "The person who approved this may not do it. Choose someone who can",
    es: "La persona que lo ha aprobado no tiene permiso para hacerlo. Elige a alguien que pueda",
  },
  "bill.refund_in_progress": {
    en: "A card refund on this bill is still waiting for the card provider. The bill cannot be changed until it finishes",
    es: "Una devolución con tarjeta de esta cuenta sigue esperando al proveedor de pagos. No se puede cambiar la cuenta hasta que termine",
  },
  "reader.not_found": {
    en: "This device has no card reader it can use. Ask a manager to check its card reader on the Card payments screen",
    es: "Este dispositivo no tiene un lector de tarjetas que pueda usar. Pide a un responsable que revise su lector en la pantalla Pagos con tarjeta",
  },
  "reader.provider_disconnected": {
    en: "The card reader's payment provider is not connected. Ask a manager to connect it on the Card payments screen, or take cash",
    es: "El proveedor de pagos del lector no está conectado. Pide a un responsable que lo conecte en la pantalla Pagos con tarjeta, o cobra en efectivo",
  },
  "order.payment_in_flight": {
    en: "A card payment for this order is in progress. Wait for it to finish before changing the order",
    es: "Se está cobrando este pedido con tarjeta. Espera a que termine antes de cambiarlo",
  },
  "ticket.already_started": {
    en: "The kitchen has already started this item, so it can no longer be changed. You can cancel it",
    es: "La cocina ya ha empezado este plato, así que ya no se puede cambiar. Puedes cancelarlo",
  },
  "ticket.not_sent": {
    en: "This dish has not gone to the kitchen yet. Choose where it is made before sending it",
    es: "Este plato aún no ha ido a cocina. Elige dónde se prepara antes de enviarlo",
  },
  "ticket.made_here": {
    en: "This dish is made here at the till, so it cannot be moved to a station",
    es: "Este plato se prepara aquí en la caja, así que no se puede pasar a una estación",
  },
  "route.station_inactive": {
    en: "That station has been disabled. Choose another",
    es: "Esa estación se ha deshabilitado. Elige otra",
  },
  "station.not_found": {
    en: "That station no longer exists. Choose another",
    es: "Esa estación ya no existe. Elige otra",
  },
  "ticket.already_fired": {
    en: "This item has already gone to the kitchen, and this venue does not allow changing items once sent. You can cancel it",
    es: "Este plato ya ha ido a cocina y en este local no se pueden cambiar los platos enviados. Puedes cancelarlo",
  },
  "tab.serve_quantity_invalid": {
    en: "That quantity cannot be marked on this line. Check how many are left to serve, or how many were served",
    es: "No se puede marcar esa cantidad en esta línea. Comprueba cuántos quedan por servir o cuántos se han servido",
  },
  "adjustment.action_not_allowed": {
    en: "That reason cannot be used for this. Choose another reason",
    es: "Ese motivo no sirve para esto. Elige otro motivo",
  },
  "adjustment.over_limit": {
    en: "That goes over what this reason allows on this bill. Choose another reason or ask a manager",
    es: "Supera lo que permite este motivo en esta cuenta. Elige otro motivo o pregunta a un encargado",
  },
  "adjustment.note_required": {
    en: "This reason needs a note. Add one and try again",
    es: "Este motivo necesita una nota. Añádela e inténtalo de nuevo",
  },
  "adjustment.reason_inactive": {
    en: "That reason is no longer in use. Choose another reason",
    es: "Ese motivo ya no se usa. Elige otro motivo",
  },
  "adjustment.exceeds_amount": {
    en: "That discount is more than it would come off. Enter a smaller amount",
    es: "Ese descuento es mayor que el importe al que se aplica. Introduce un importe menor",
  },
  "adjustment.approval_required": {
    en: "Someone with a higher role must approve this with their PIN",
    es: "Alguien con un puesto superior debe aprobarlo con su PIN",
  },
  "adjustment.weighed_partial": {
    en: "Part of an item sold by weight or measure can't be given away or discounted. Discount the whole line instead",
    es: "Parte de un artículo que se vende al peso o por medida no se puede invitar ni descontar. Haz un descuento sobre la línea entera",
  },
  "adjustment.quantity_invalid": {
    en: "That quantity cannot be used on this line. Check how many are on it; an extra is done whole",
    es: "No se puede usar esa cantidad en esta línea. Comprueba cuántos hay; un extra va entero",
  },
  "adjustment.no_reduction": {
    en: "That takes nothing off. Check whether it is already free, or enter a larger discount",
    es: "Así no se descuenta nada. Comprueba si ya es gratis o introduce un descuento mayor",
  },
  "adjustment_reason.not_found": {
    en: "That reason no longer exists. Reload and choose another",
    es: "Ese motivo ya no existe. Vuelve a cargar y elige otro",
  },
  "product.unavailable": {
    en: "An item on this order has sold out. Remove it and try again",
    es: "Un artículo de este pedido está agotado. Quítalo e inténtalo de nuevo",
  },
  "product.not_sold_separately": {
    en: "An item on this order can only be added as an extra to another dish. Remove it and try again",
    es: "Un artículo de este pedido solo se puede añadir como extra de otro plato. Quítalo e inténtalo de nuevo",
  },
  "menu.reset_required": {
    en: "This venue has a menu in an unsupported format. Reset the venue before using menus.",
    es: "Este local tiene una carta en un formato no compatible. Restablece el local antes de usar las cartas.",
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
  // `device.join_rate_limited`, `device.join_full` and `device.join_stale` are deliberately UNMAPPED:
  // each leaves the operator only "try again", which the generic sentence says, and naming one would
  // tell an unapproved device something about the venue's state.
  // The two card reader paths (the counter's card collect and the bill pay dialog) show
  // `card_reader.not_set_up` for the reader's own `device.forbidden_action` (action `pay`).
  "device.forbidden_action": {
    en: "This device's profile doesn't allow that. Ask a manager to change it.",
    es: "El perfil de este dispositivo no lo permite. Pide a un responsable que lo modifique.",
  },
  "device.pairing_closed": {
    en: "New devices aren't being accepted right now. Ask a manager to open Add a device in the dashboard.",
    es: "Ahora mismo no se aceptan dispositivos nuevos. Pide a un responsable que abra «Añadir un dispositivo» en el panel.",
  },
  "device.unauthorized": {
    en: "This device isn't set up — ask to join this venue",
    es: "Este dispositivo no está configurado. Solicita el alta en este local",
  },
  "device.binding_invalid": {
    en: "That printer or card reader is not available to this device. Choose another",
    es: "Esa impresora o lector de tarjetas no está disponible para este dispositivo. Elige otro",
  },
  "device.equipment_held": {
    en: "Another device has that equipment now. Choose again",
    es: "Otro dispositivo tiene ahora ese equipo. Vuelve a elegir",
  },
  "reader.not_held": {
    en: "This device no longer has that card reader. Choose a reader in Equipment and try again. No card was charged.",
    es: "Este dispositivo ya no tiene ese lector de tarjetas. Elige un lector en Equipo e inténtalo de nuevo. No se ha cobrado ninguna tarjeta.",
  },
  "reader.payment_in_progress": {
    en: "Another device is taking a card payment on that reader. Try again when it finishes; if it is stuck, a manager can resolve it in the dashboard.",
    es: "Otro dispositivo está cobrando con tarjeta en ese lector. Vuelve a intentarlo cuando termine; si se ha quedado atascado, un responsable puede resolverlo en el panel.",
  },
  "device_profile.not_approved": {
    en: "This device can no longer switch to that profile. Choose another",
    es: "Este dispositivo ya no puede cambiar a ese perfil. Elige otro",
  },
  "device_profile.not_admitted": {
    en: "You can't sign in on that profile. Choose another",
    es: "No puedes iniciar sesión con ese perfil. Elige otro",
  },
  "station.not_allowed": {
    en: "That profile does not list the station this device shows. Choose another, or ask a manager to change the device's station",
    es: "Ese perfil no incluye la estación que muestra este dispositivo. Elige otro, o pide a un responsable que cambie la estación del dispositivo",
  },
  "watcher.not_allowed": {
    en: "That profile does not list the watcher this device shows. Choose another, or ask a manager to change the device's watcher",
    es: "Ese perfil no incluye el punto de seguimiento que muestra este dispositivo. Elige otro, o pide a un responsable que cambie el punto de seguimiento del dispositivo",
  },
  "device.payment_in_progress": {
    en: "A card payment on this device is still in progress. Switch once it finishes or is cancelled",
    es: "Hay un pago con tarjeta en curso en este dispositivo. Cambia cuando termine o se cancele",
  },
  "device.profile_changed": {
    en: "This device switched to another profile while the payment was starting. No card was charged. Try again.",
    es: "Este dispositivo ha cambiado a otro perfil mientras se iniciaba el pago. No se ha cobrado ninguna tarjeta. Inténtalo de nuevo.",
  },
  "device.cash_not_allowed": {
    en: "This device does not take cash. Take cash at a till.",
    es: "Este dispositivo no cobra en efectivo. Cobra en efectivo en una caja.",
  },
  "device.name_taken": {
    en: "An active device here already has that name. Choose another name and ask again",
    es: "Ya hay un dispositivo activo con ese nombre aquí. Elige otro nombre y solicítalo de nuevo",
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
