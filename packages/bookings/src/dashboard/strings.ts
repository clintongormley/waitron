import {
  currentLocale,
  makeT,
  registerCatalogue,
  registerCodeMessages,
  resolveNameTable,
  type NameTable,
} from "@waitron/dashboard-kit";

// Registers its catalogue and code messages at load, so importing `t` is enough to resolve them.

/** Carries its own `action.*` labels so `t` needs nothing from the app's string table. */
const en = {
  "nav.bookings": "Bookings",
  "booking.title": "Bookings",
  "booking.add": "Add booking",
  "booking.empty": "No bookings for this day.",
  "booking.date": "Date",
  "booking.new": "Add booking",
  "booking.edit": "Edit booking",
  "booking.time": "Time",
  "booking.party_size": "Party size",
  "booking.contact_name": "Name",
  "booking.contact_phone": "Phone",
  "booking.notes": "Notes",
  "booking.table": "Table",
  "booking.table_none": "No table",
  "booking.combobox_search": "Search",
  "booking.combobox_no_results": "No results",
  "booking.seat": "Seat",
  "booking.confirm_seat": "Confirm seat",
  "booking.complete": "Complete",
  "booking.no_show": "No-show",
  "booking.cancel": "Cancel",
  "action.save": "Save",
  "action.create": "Add",
  "action.edit": "Edit",
} as const;

const es: Record<keyof typeof en, string> = {
  "nav.bookings": "Reservas",
  "booking.title": "Reservas",
  "booking.add": "Añadir reserva",
  "booking.empty": "No hay reservas para este día.",
  "booking.date": "Fecha",
  "booking.new": "Añadir reserva",
  "booking.edit": "Editar reserva",
  "booking.time": "Hora",
  "booking.party_size": "Comensales",
  "booking.contact_name": "Nombre",
  "booking.contact_phone": "Teléfono",
  "booking.notes": "Notas",
  "booking.table": "Mesa",
  "booking.table_none": "Sin mesa",
  "booking.combobox_search": "Buscar",
  "booking.combobox_no_results": "Sin resultados",
  "booking.seat": "Sentar",
  "booking.confirm_seat": "Confirmar mesa",
  "booking.complete": "Completar",
  "booking.no_show": "No presentada",
  "booking.cancel": "Cancelar",
  "action.save": "Guardar",
  "action.create": "Añadir",
  "action.edit": "Editar",
};

export const BOOKINGS_STRINGS = { en, es };

/**
 * The `booking.*` codes and `table.booked`; the other `table.*` codes, `tab.*` and `server.internal`
 * are the app's.
 */
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
  "table.booked": {
    en: "This table has an upcoming booking. Move the booking first",
    es: "Esta mesa tiene una reserva próxima. Mueve primero la reserva",
  },
};

registerCatalogue(BOOKINGS_STRINGS);
registerCodeMessages(BOOKINGS_CODE_MESSAGES);

export const t = makeT<keyof typeof en>();

// The Spanish agrees in the feminine, with "reserva".
const BOOKING_STATUS_NAMES: NameTable = {
  booked: { en: "Booked", es: "Reservada" },
  seated: { en: "Seated", es: "Sentada" },
  completed: { en: "Completed", es: "Completada" },
  no_show: { en: "No-show", es: "No presentada" },
  cancelled: { en: "Cancelled", es: "Cancelada" },
};

export function bookingStatusName(value: string, locale: string = currentLocale()): string {
  return resolveNameTable(BOOKING_STATUS_NAMES, value, locale);
}
