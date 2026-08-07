// The till's string catalogue.
//
// English is the SOURCE of truth: `en` below is the base map, `StringKey` is
// derived from its keys, and every other locale is a translation that may only
// re-say what `en` already names. Spanish (`es`) is what the deli actually
// renders (the shipped default locale is es-ES; see t.ts), but it is a
// translation, not the origin — a key must exist in `en` first.
//
// `apps/*` is exempt from the english-only guard (packages/db/src/english-only.ts),
// so the English UI copy here is deliberate and allowed; the Spanish below is
// user-facing translation, not schema vocabulary.
//
// Later till screens (Tasks 10-19) append keys here. Add the English base entry
// AND its Spanish translation together — `es` is typed `Record<StringKey,string>`,
// so a key added to `en` without a Spanish sibling is a compile error, which is
// the guard that keeps the two in step.
export const en = {
  // Primary actions
  "action.pay": "Pay",
  "action.confirm_payment": "Confirm payment",
  "action.new_sale": "New sale",
  "action.logout": "Log out",
  "action.remove": "Remove",
  "action.add": "Add",
  "action.login": "Log in",
  "action.back": "Back",
  "action.cancel": "Cancel",
  "action.hold": "Hold",
  // Tenders
  "tender.cash": "Cash",
  "tender.card": "Card",
  "tender.card_ref": "Operation number (optional)",
  // Numeric keypad (accessible names for the non-alphanumeric keys)
  "pad.decimal": "Decimal point",
  "pad.backspace": "Backspace",
  // Money labels
  "label.change": "Change",
  "label.total": "Total",
  "label.tendered": "Tendered",
  // Basket
  "basket.empty": "Basket is empty",
  // Login / operator selection
  "login.enter_pin": "Enter PIN",
  "login.pick_operator": "Choose your name",
  "login.loading": "Loading…",
  "login.no_staff": "No staff available",
  "login.load_failed": "Could not load staff, try again",
  "login.error": "Could not log in, try again",
  // Weight entry (priced-by-weight products)
  "weigh.prompt": "Enter weight (kg)",
  // Held (parked) orders
  "held.label_prompt": "Name this order (optional)",
  "held.title": "Held orders",
  "held.empty": "No held orders",
  "held.retrieve": "Retrieve",
  "held.discard": "Discard",
  // Placing & prep (7c prepare & collect)
  "action.place": "Place order",
  "action.send_to_prep": "Send to prep",
  "action.collect": "Collect",
  "prep.title": "Prep queue",
  "prep.empty": "Nothing in prep",
  "prep.state.queued": "Queued",
  "prep.state.preparing": "Preparing",
  "prep.state.ready": "Ready",
  "prep.advance": "Advance",
  "cancel.reason_prompt": "Reason for cancelling",
  // Integrated card terminal (sub-project 7 Task 9)
  "card.collecting": "Tap or insert card…",
  "card.cancel": "Cancel",
  "card.declined": "Card declined",
  "card.retry": "Retry card",
  "card.switch_tender": "Use another tender",
  "card.wait": "Keep waiting",
  "card.tip": "Tip (optional)",
  "card.offline_consent": "Accept offline if the network is down",
  // Allergens (menu & allergens) — UI chrome for the till allergen screen. `may_contain` follows the
  // snake_case sibling convention every other multi-word key here uses (card_ref, switch_tender, …),
  // not the camelCase the task brief spelled it; the allergen CODES/name strings are elsewhere
  // (i18n/allergen-names.ts), so these are screen chrome only.
  "allergens.open": "Allergens",
  "allergens.title": "Allergens",
  "allergens.notice": "Allergen information is available — please ask staff.",
  "allergens.pending": "Allergen info pending",
  "allergens.contains": "Contains",
  "allergens.may_contain": "May contain",
  "allergens.print": "Print",
  "allergens.close": "Close",
  // Errors
  "pin.invalid": "Wrong PIN, try again",
  "person.suspended": "Account suspended, ask a manager",
  "sale.error": "Could not complete the sale, try again",
  "held.park_error": "Could not hold the order, try again",
  "held.product_gone": "A product was removed and dropped from the order",
  "held.stale": "That order is no longer available",
  "place.error": "Could not place the order, try again",
  "prep.advance_error": "Could not update the order's status, try again",
} as const;

export type StringKey = keyof typeof en;

// A full translation of the base map. Typed `Record<StringKey, string>` (not
// Partial): every base key must be translated, so an untranslated addition fails
// typecheck rather than silently falling through to English at runtime.
export const es: Record<StringKey, string> = {
  "action.pay": "Cobrar",
  "action.confirm_payment": "Confirmar cobro",
  "action.new_sale": "Nueva venta",
  "action.logout": "Cerrar sesión",
  "action.remove": "Quitar",
  "action.add": "Añadir",
  "action.login": "Entrar",
  "action.back": "Atrás",
  "action.cancel": "Cancelar",
  "action.hold": "Aparcar",
  "tender.cash": "Efectivo",
  "tender.card": "Tarjeta",
  "tender.card_ref": "Número de operación (opcional)",
  "pad.decimal": "Punto decimal",
  "pad.backspace": "Borrar",
  "label.change": "Cambio",
  "label.total": "Total",
  "label.tendered": "Entregado",
  "basket.empty": "La cesta está vacía",
  "login.enter_pin": "Introduce el PIN",
  "login.pick_operator": "Elige tu nombre",
  "login.loading": "Cargando…",
  "login.no_staff": "No hay personal disponible",
  "login.load_failed": "No se pudo cargar el personal, inténtalo de nuevo",
  "login.error": "No se pudo iniciar sesión, inténtalo de nuevo",
  "weigh.prompt": "Introduce el peso (kg)",
  "held.label_prompt": "Nombra este pedido (opcional)",
  "held.title": "Pedidos aparcados",
  "held.empty": "No hay pedidos aparcados",
  "held.retrieve": "Recuperar",
  "held.discard": "Descartar",
  "action.place": "Enviar pedido",
  "action.send_to_prep": "Enviar a cocina",
  "action.collect": "Entregar",
  "prep.title": "Cola de preparación",
  "prep.empty": "Nada en preparación",
  "prep.state.queued": "En cola",
  "prep.state.preparing": "Preparando",
  "prep.state.ready": "Listo",
  "prep.advance": "Avanzar",
  "cancel.reason_prompt": "Motivo de la cancelación",
  "card.collecting": "Acerca o inserta la tarjeta…",
  "card.cancel": "Cancelar",
  "card.declined": "Tarjeta rechazada",
  "card.retry": "Reintentar tarjeta",
  "card.switch_tender": "Usar otro método de pago",
  "card.wait": "Seguir esperando",
  "card.tip": "Propina (opcional)",
  "card.offline_consent": "Aceptar sin conexión si la red no funciona",
  "allergens.open": "Alérgenos",
  "allergens.title": "Alérgenos",
  "allergens.notice": "Hay información sobre alérgenos disponible — pregunta al personal.",
  "allergens.pending": "Información de alérgenos pendiente",
  "allergens.contains": "Contiene",
  "allergens.may_contain": "Puede contener",
  "allergens.print": "Imprimir",
  "allergens.close": "Cerrar",
  "pin.invalid": "PIN incorrecto, inténtalo de nuevo",
  "person.suspended": "Cuenta suspendida, avisa a un responsable",
  "sale.error": "No se pudo completar la venta, inténtalo de nuevo",
  "held.park_error": "No se pudo aparcar el pedido, inténtalo de nuevo",
  "held.product_gone": "Se quitó un producto y se eliminó del pedido",
  "held.stale": "Ese pedido ya no está disponible",
  "place.error": "No se pudo enviar el pedido, inténtalo de nuevo",
  "prep.advance_error": "No se pudo actualizar el estado del pedido, inténtalo de nuevo",
};

// Locale → catalogue. `en` is included as its own catalogue so an explicit
// English request resolves directly rather than only through t()'s fallback.
// Both the language tag `es` and the region tag `es-ES` map to the same Spanish
// catalogue — the till's default locale is es-ES. Catalogues are typed
// Partial<Record<StringKey, string>> so a future locale may be introduced with
// only some keys translated; t() fills the gaps from the English base.
export const catalogues: Record<string, Partial<Record<StringKey, string>>> = {
  en,
  es,
  "es-ES": es,
};
