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
  // Errors
  "pin.invalid": "Wrong PIN, try again",
  "person.suspended": "Account suspended, ask a manager",
  "sale.error": "Could not complete the sale, try again",
  "held.park_error": "Could not hold the order, try again",
  "held.product_gone": "A product was removed and dropped from the order",
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
  "pin.invalid": "PIN incorrecto, inténtalo de nuevo",
  "person.suspended": "Cuenta suspendida, avisa a un responsable",
  "sale.error": "No se pudo completar la venta, inténtalo de nuevo",
  "held.park_error": "No se pudo aparcar el pedido, inténtalo de nuevo",
  "held.product_gone": "Se quitó un producto y se eliminó del pedido",
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
