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
  // Tenders
  "tender.cash": "Cash",
  // Numeric keypad (accessible names for the non-alphanumeric keys)
  "pad.decimal": "Decimal point",
  "pad.backspace": "Backspace",
  // Money labels
  "label.change": "Change",
  "label.total": "Total",
  "label.tendered": "Tendered",
  "label.all": "All",
  // Basket
  "basket.empty": "Basket is empty",
  // Login / operator selection
  "login.enter_pin": "Enter PIN",
  "login.pick_operator": "Choose your name",
  // Weight entry (priced-by-weight products)
  "weigh.prompt": "Enter weight (kg)",
  // Errors
  "pin.invalid": "Wrong PIN, try again",
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
  "tender.cash": "Efectivo",
  "pad.decimal": "Punto decimal",
  "pad.backspace": "Borrar",
  "label.change": "Cambio",
  "label.total": "Total",
  "label.tendered": "Entregado",
  "label.all": "Todos",
  "basket.empty": "La cesta está vacía",
  "login.enter_pin": "Introduce el PIN",
  "login.pick_operator": "Elige tu nombre",
  "weigh.prompt": "Introduce el peso (kg)",
  "pin.invalid": "PIN incorrecto, inténtalo de nuevo",
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
