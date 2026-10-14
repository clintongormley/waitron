import {
  makeT,
  registerCatalogue,
  registerCodeMessages,
  resolveNameTable,
  type NameTable,
} from "@waitron/dashboard-kit";
import type { CalendarColour } from "../staffing-types.js";

// Registers its catalogue and code messages at load, so importing `t` is enough to resolve them.

const en = {
  "nav.staff_roles": "Staff roles",
  "staffing.role.title": "Staff roles",
  "staffing.role.intro": "The jobs your staff do, and who can do each.",
  "staffing.role.new": "+ New staff role",
  "staffing.role.empty": "No staff roles yet.",
  "staffing.role.load_error": "Could not load the staff roles: {reason}",
  "staffing.role.column.colour": "Colour",
  "staffing.role.column.name": "Name",
  "staffing.role.column.people": "People",
  "staffing.role.column.actions": "Actions",
  "staffing.role.actions": "Actions for {name}",
  "staffing.role.edit": "Edit",
  "staffing.role.move_up": "Move up",
  "staffing.role.move_down": "Move down",
  "staffing.role.move_error": "Could not move the staff role: {reason}",
  "staffing.role.delete": "Delete",
  "staffing.role.delete_heading": "Delete staff role",
  "staffing.role.delete_question": "Delete {name}?",
  "staffing.role.delete_shifts_one": "1 shift is assigned to it.",
  "staffing.role.delete_shifts_other": "{count} shifts are assigned to it.",
  "staffing.role.delete_blocks_one": "Its 1 painted staffing block goes too.",
  "staffing.role.delete_blocks_other": "Its {count} painted staffing blocks go too.",
  "staffing.role.delete_error": "Could not delete the staff role: {reason}",
  "staffing.role.holders_none": "No people",
  "staffing.role.holders_one": "1 person",
  "staffing.role.holders_other": "{count} people",
  "staffing.role.heading_new": "New staff role",
  "staffing.role.heading_edit": "Edit staff role",
  "staffing.role.name": "Name",
  "staffing.role.name_required": "Enter a name",
  "staffing.role.colour": "Colour",
  "staffing.role.people": "People",
  "staffing.role.people_placeholder": "Choose people",
  "staffing.role.people_error": "Could not load the venue's people: {reason}",
  "staffing.role.people_not_saved":
    "The staff role is saved, but not its people: {reason} Save again to retry.",
  "staffing.role.search": "Search",
  "staffing.role.no_results": "No results",
  "staffing.role.fix_fields": "Correct the highlighted fields to continue.",
  "staffing.role.cancel": "Cancel",
  "staffing.role.save": "Save",
};

const es: Record<keyof typeof en, string> = {
  "nav.staff_roles": "Roles de personal",
  "staffing.role.title": "Roles de personal",
  "staffing.role.intro": "Los puestos de tu personal y quién puede cubrir cada uno.",
  "staffing.role.new": "+ Nuevo rol de personal",
  "staffing.role.empty": "Aún no hay roles de personal.",
  "staffing.role.load_error": "No se pudieron cargar los roles de personal: {reason}",
  "staffing.role.column.colour": "Color",
  "staffing.role.column.name": "Nombre",
  "staffing.role.column.people": "Personas",
  "staffing.role.column.actions": "Acciones",
  "staffing.role.actions": "Acciones de {name}",
  "staffing.role.edit": "Editar",
  "staffing.role.move_up": "Subir",
  "staffing.role.move_down": "Bajar",
  "staffing.role.move_error": "No se pudo mover el rol de personal: {reason}",
  "staffing.role.delete": "Eliminar",
  "staffing.role.delete_heading": "Eliminar rol de personal",
  "staffing.role.delete_question": "¿Eliminar {name}?",
  "staffing.role.delete_shifts_one": "Tiene 1 turno asignado.",
  "staffing.role.delete_shifts_other": "Tiene {count} turnos asignados.",
  "staffing.role.delete_blocks_one": "También se elimina su bloque de personal pintado.",
  "staffing.role.delete_blocks_other":
    "También se eliminan sus {count} bloques de personal pintados.",
  "staffing.role.delete_error": "No se pudo eliminar el rol de personal: {reason}",
  "staffing.role.holders_none": "Nadie",
  "staffing.role.holders_one": "1 persona",
  "staffing.role.holders_other": "{count} personas",
  "staffing.role.heading_new": "Nuevo rol de personal",
  "staffing.role.heading_edit": "Editar rol de personal",
  "staffing.role.name": "Nombre",
  "staffing.role.name_required": "Escribe un nombre",
  "staffing.role.colour": "Color",
  "staffing.role.people": "Personas",
  "staffing.role.people_placeholder": "Elige personas",
  "staffing.role.people_error": "No se pudieron cargar las personas del local: {reason}",
  "staffing.role.people_not_saved":
    "El rol de personal está guardado, pero no sus personas: {reason} Guarda de nuevo para reintentarlo.",
  "staffing.role.search": "Buscar",
  "staffing.role.no_results": "Sin resultados",
  "staffing.role.fix_fields": "Corrige los campos marcados para continuar.",
  "staffing.role.cancel": "Cancelar",
  "staffing.role.save": "Guardar",
};

export const STAFFING_STRINGS = { en, es };

/** Only the codes the staff roles page can meet; the rest are the app's. */
export const STAFFING_CODE_MESSAGES: Record<string, { en: string; es: string }> = {
  "staff_role.name_taken": {
    en: "Another staff role has this name",
    es: "Ya hay otro rol de personal con este nombre",
  },
  "staff_role.in_use": {
    en: "Shifts are assigned to this staff role, so it cannot be deleted",
    es: "Hay turnos asignados a este rol de personal, así que no se puede eliminar",
  },
  "staff_role.not_found": {
    en: "That staff role could not be found. It may have been deleted",
    es: "No se ha encontrado ese rol de personal. Puede que se haya eliminado",
  },
  "staffing.invalid": {
    en: "Some of the details are not valid",
    es: "Algunos de los datos no son válidos",
  },
};

registerCatalogue(STAFFING_STRINGS);
registerCodeMessages(STAFFING_CODE_MESSAGES);

export type StringKey = keyof typeof en;
export const t = makeT<StringKey>();

/** `t` with each `{name}` in the text replaced by its value. */
export function tf(key: StringKey, values: Record<string, string>, locale?: string): string {
  return t(key, locale).replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole);
}

/** How many people hold a staff role, as the list shows it. */
export function holderCount(count: number, locale?: string): string {
  if (count === 0) return t("staffing.role.holders_none", locale);
  if (count === 1) return t("staffing.role.holders_one", locale);
  return tf("staffing.role.holders_other", { count: String(count) }, locale);
}

const COLOUR_NAMES: NameTable = {
  red: { en: "Red", es: "Rojo" },
  amber: { en: "Amber", es: "Ámbar" },
  grey: { en: "Grey", es: "Gris" },
  blue: { en: "Blue", es: "Azul" },
  green: { en: "Green", es: "Verde" },
  purple: { en: "Purple", es: "Morado" },
};

export function colourName(colour: CalendarColour, locale?: string): string {
  return resolveNameTable(COLOUR_NAMES, colour, locale);
}
