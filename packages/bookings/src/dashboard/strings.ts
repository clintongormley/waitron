import {
  currentLocale,
  makeT,
  pickLocale,
  registerCatalogue,
  registerCodeMessages,
} from "@waitron/dashboard-kit";

// The bookings sub-path's OWN i18n surface: the screen/form UI strings, the lifecycle status names,
// and the localised copy for the booking error codes the screen surfaces. English is the source of
// truth; the Spanish is user-facing translation, not schema vocabulary (this is browser UI, out of
// the english-only guard's scope). The module registers its catalogue + code messages at load — before
// any t()/codeMessage() runs — so importing this module's `t` (the screen/form do) is enough to make
// the strings resolve; the contribution also declares these strings so the app registers them on mount.

/** The bookings UI strings, English source of truth. Includes the shared `action.*` labels the screen
 * and form use, so this module's typed `t` resolves them without importing the app's string table. */
const en = {
  "nav.bookings": "Bookings",
  "booking.title": "Bookings",
  "booking.add": "Add booking",
  "booking.empty": "No bookings for this day.",
  "booking.date": "Date",
  "booking.new": "New booking",
  "booking.edit": "Edit booking",
  "booking.time": "Time",
  "booking.party_size": "Party size",
  "booking.contact_name": "Name",
  "booking.contact_phone": "Phone",
  "booking.notes": "Notes",
  "booking.table": "Table",
  "booking.table_none": "No table",
  "booking.seat": "Seat",
  "booking.confirm_seat": "Confirm seat",
  "booking.complete": "Complete",
  "booking.no_show": "No-show",
  "booking.cancel": "Cancel",
  "action.save": "Save",
  "action.create": "Create",
  "action.edit": "Edit",
} as const;

const es: Record<keyof typeof en, string> = {
  "nav.bookings": "Reservas",
  "booking.title": "Reservas",
  "booking.add": "Añadir reserva",
  "booking.empty": "No hay reservas para este día.",
  "booking.date": "Fecha",
  "booking.new": "Nueva reserva",
  "booking.edit": "Editar reserva",
  "booking.time": "Hora",
  "booking.party_size": "Comensales",
  "booking.contact_name": "Nombre",
  "booking.contact_phone": "Teléfono",
  "booking.notes": "Notas",
  "booking.table": "Mesa",
  "booking.table_none": "Sin mesa",
  "booking.seat": "Sentar",
  "booking.confirm_seat": "Confirmar mesa",
  "booking.complete": "Completar",
  "booking.no_show": "No presentada",
  "booking.cancel": "Cancelar",
  "action.save": "Guardar",
  "action.create": "Crear",
  "action.edit": "Editar",
};

/** The `{ en, es }` catalogue the contribution declares (the app merges it on mount). */
export const BOOKINGS_STRINGS = { en, es };

/** The booking error codes the screen surfaces, as localised copy. `table.not_found`/`tab.already_open`
 * (a seated table gone or already busy) and `server.internal` are owned by the app's own code table;
 * this module owns only the `booking.*` codes. */
export const BOOKINGS_CODE_MESSAGES: Record<string, { en: string; es: string }> = {
  "booking.not_found": {
    en: "That booking could not be found",
    es: "No se ha encontrado esa reserva",
  },
  "booking.invalid": {
    en: "The party size must be 1 or more",
    es: "El número de comensales debe ser 1 o más",
  },
  "booking.invalid_transition": {
    en: "That booking can't move to that state now",
    es: "Esa reserva no puede pasar a ese estado ahora",
  },
  "booking.table_required": {
    en: "Choose a table to seat this booking",
    es: "Elige una mesa para sentar esta reserva",
  },
  "booking.fields_required": {
    en: "Fill in the date, time, party size and name",
    es: "Rellena la fecha, la hora, los comensales y el nombre",
  },
  "booking.party_invalid": {
    en: "Party size must be a whole number of 1 or more",
    es: "Los comensales deben ser un número entero de 1 o más",
  },
};

registerCatalogue(BOOKINGS_STRINGS);
registerCodeMessages(BOOKINGS_CODE_MESSAGES);

/** Translate a bookings key to the active locale, typed to this module's own key union so an unknown
 * key is a compile error. Resolution (region-strip, English-degrade) is the kit's. */
export const t = makeT<keyof typeof en>();

type NameTable = Record<string, { en: string; es: string }>;

/** Shared resolver: an own-key check (not truthiness — a token colliding with an Object.prototype
 * member would resolve the inherited member) then the kit's region-strip + English-degrade; an unknown
 * token renders as itself. */
function resolve(table: NameTable, value: string, locale: string): string {
  return Object.hasOwn(table, value) ? pickLocale(table[value], locale) : value;
}

// The five booking lifecycle statuses (the `booking_status` pgEnum), shown on the day-list. English is
// the source of truth; the Spanish agrees feminine ("reserva").
const BOOKING_STATUS_NAMES: NameTable = {
  booked: { en: "Booked", es: "Reservada" },
  seated: { en: "Seated", es: "Sentada" },
  completed: { en: "Completed", es: "Completada" },
  no_show: { en: "No-show", es: "No presentada" },
  cancelled: { en: "Cancelled", es: "Cancelada" },
};

/** The localised display name for a booking status token. */
export function bookingStatusName(value: string, locale: string = currentLocale()): string {
  return resolve(BOOKING_STATUS_NAMES, value, locale);
}
