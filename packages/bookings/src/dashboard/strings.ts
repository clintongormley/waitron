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
  "booking.row_table": "Table {label}",
  "booking.combobox_search": "Search",
  "booking.combobox_no_results": "No results",
  "booking.seat": "Seat",
  "booking.confirm_seat": "Confirm seat",
  "booking.complete": "Complete",
  "booking.no_show": "No-show",
  "booking.cancel": "Cancel",
  "booking.fix_fields": "Correct the highlighted fields to continue.",
  "booking.date_required": "Enter a date",
  "booking.time_required": "Enter a time",
  "booking.name_required": "Enter a name",
  "action.save": "Save",
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
  "booking.row_table": "Mesa {label}",
  "booking.combobox_search": "Buscar",
  "booking.combobox_no_results": "Sin resultados",
  "booking.seat": "Sentar",
  "booking.confirm_seat": "Confirmar mesa",
  "booking.complete": "Completar",
  "booking.no_show": "No presentada",
  "booking.cancel": "Cancelar",
  "booking.fix_fields": "Corrige los campos marcados para continuar.",
  "booking.date_required": "Introduce una fecha",
  "booking.time_required": "Introduce una hora",
  "booking.name_required": "Introduce un nombre",
  "action.save": "Guardar",
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
    en: "Check the party size, from 1 to 999, and the contact name",
    es: "Revisa el número de comensales, de 1 a 999, y el nombre de contacto",
  },
  "booking.invalid_transition": {
    en: "This booking's status changed while this page was open, so that change can't be made. Check its status in the list",
    es: "El estado de esta reserva ha cambiado mientras esta página estaba abierta, así que no se puede hacer ese cambio. Revisa su estado en la lista",
  },
  "booking.table_required": {
    en: "Choose a table to seat this booking",
    es: "Elige una mesa para sentar esta reserva",
  },
  "booking.party_invalid": {
    en: "Party size must be a whole number from 1 to 999",
    es: "Los comensales deben ser un número entero de 1 a 999",
  },
  "table.not_found": {
    en: "That table no longer exists",
    es: "Esa mesa ya no existe",
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
