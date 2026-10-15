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
  "staffing.role.new": "Add staff role",
  "staffing.role.empty": "No staff roles yet.",
  "staffing.role.loading": "Loading staff roles…",
  "staffing.role.load_error": "Could not load the staff roles: {reason}",
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
  "staffing.role.delete_refusals": "Why this cannot be deleted",
  "staffing.role.delete_ends": "Work that ends",
  "staffing.role.delete_removes": "Settings removed",
  "staffing.role.delete_irreversible": "This cannot be undone.",
  "staffing.role.delete_retry": "Try again",
  "staffing.role.delete_loading": "Checking what deleting this staff role would change…",
  "staffing.role.delete_load_error": "Could not load what deleting it would change: {reason}",
  "staffing.role.delete_shifts_one": "1 shift uses this staff role.",
  "staffing.role.delete_shifts_other": "{count} shifts use this staff role.",
  "staffing.role.delete_blocks_one": "Removes 1 painted staffing block.",
  "staffing.role.delete_blocks_other": "Removes {count} painted staffing blocks.",
  "staffing.role.delete_holders_one": "Removes it from 1 person: {names}.",
  "staffing.role.delete_holders_other": "Removes it from {count} people: {names}.",
  "staffing.role.delete_unknown": "{names} ({count})",
  "staffing.role.delete_error": "Could not delete the staff role: {reason}",
  "staffing.role.holders_none": "No people",
  "staffing.role.holders_one": "1 person",
  "staffing.role.holders_other": "{count} people",
  "staffing.role.heading_new": "Add staff role",
  "staffing.role.heading_edit": "Edit staff role",
  "staffing.role.name": "Name",
  "staffing.role.name_required": "Enter a name",
  "staffing.role.colour": "Colour",
  "staffing.role.colour_invalid": "Choose one of the colours",
  "staffing.role.people": "People",
  "staffing.role.people_placeholder": "Choose people",
  "staffing.role.people_invalid": "Some of these people no longer exist",
  "staffing.role.people_error": "Could not load the venue's people: {reason}",
  "staffing.role.people_not_saved":
    "The staff role is saved, but not its people. Save again to retry: {reason}",
  "staffing.role.search": "Search",
  "staffing.role.no_results": "No results",
  "staffing.role.fix_fields": "Correct the highlighted fields to continue.",
  "staffing.role.cancel": "Cancel",
  "staffing.role.save": "Save",
  "staffing.view.tab": "Staffing",
  "staffing.month.previous": "Previous month",
  "staffing.month.next": "Next month",
  "staffing.month.seasons": "Seasons",
  "staffing.month.season": "{name} · {from} – {to}",
  "staffing.month.area": "Show",
  "staffing.month.all_areas": "All areas",
  "staffing.month.loading": "Loading staffing…",
  "staffing.month.load_error": "Could not load the staffing: {reason}",
  "staffing.month.today": "Today",
  "staffing.month.closed": "Closed",
  "staffing.month.legend": "Bars: people needed per area",
  "staffing.grid.label": "Staffing by day",
  "staffing.grid.follows_season": "Follows the season",
  "staffing.grid.follow_season": "Follow the season",
  "staffing.grid.staff_role": "Staff role",
  "staffing.grid.how_many": "How many",
  "staffing.grid.delete": "Delete",
  "staffing.grid.people_one": "1 person",
  "staffing.grid.people_other": "{count} people",
  "staffing.painter.heading": "Staffing",
  "staffing.painter.week": "{season} week",
  "staffing.painter.previous_season": "Previous season",
  "staffing.painter.next_season": "Next season",
  "staffing.painter.area": "Department or prep station",
  "staffing.painter.departments": "Departments",
  "staffing.painter.stations": "Prep stations",
  "staffing.painter.paint": "Paint:",
  "staffing.painter.new_staff_role": "+ New staff role",
  "staffing.painter.loading": "Loading the staffing…",
  "staffing.painter.load_error": "Could not load the staffing: {reason}",
  "staffing.painter.refused_on": "{area}, {day}: {message}",
  "staffing.painter.refresh_error": "Saved; could not refresh: {reason}",
  "staffing.painter.removed_one": "{names} was removed; its changes were dropped.",
  "staffing.painter.removed_many": "{names} were removed; their changes were dropped.",
  "staffing.painter.no_areas": "This venue has no departments or prep stations yet.",
  "staffing.painter.dates_removed_one":
    "{dates} was removed from this special day; its changes were dropped.",
  "staffing.painter.dates_removed_many":
    "{dates} were removed from this special day; their changes were dropped.",
  "staffing.painter.no_dates": "This special day has no dates yet.",
};

const es: Record<keyof typeof en, string> = {
  "nav.staff_roles": "Roles de personal",
  "staffing.role.title": "Roles de personal",
  "staffing.role.intro": "Los puestos de tu personal y quién puede cubrir cada uno.",
  "staffing.role.new": "Añadir rol de personal",
  "staffing.role.empty": "Aún no hay roles de personal.",
  "staffing.role.loading": "Cargando roles de personal…",
  "staffing.role.load_error": "No se pudieron cargar los roles de personal: {reason}",
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
  "staffing.role.delete_refusals": "Por qué no se puede eliminar",
  "staffing.role.delete_ends": "Trabajo que termina",
  "staffing.role.delete_removes": "Ajustes eliminados",
  "staffing.role.delete_irreversible": "Esta acción no se puede deshacer.",
  "staffing.role.delete_retry": "Reintentar",
  "staffing.role.delete_loading": "Comprobando qué cambiaría al eliminar este rol de personal…",
  "staffing.role.delete_load_error": "No se pudo cargar qué cambiaría al eliminarlo: {reason}",
  "staffing.role.delete_shifts_one": "1 turno usa este rol de personal.",
  "staffing.role.delete_shifts_other": "{count} turnos usan este rol de personal.",
  "staffing.role.delete_blocks_one": "Quita 1 bloque de personal pintado.",
  "staffing.role.delete_blocks_other": "Quita {count} bloques de personal pintados.",
  "staffing.role.delete_holders_one": "Se lo quita a 1 persona: {names}.",
  "staffing.role.delete_holders_other": "Se lo quita a {count} personas: {names}.",
  "staffing.role.delete_unknown": "{names} ({count})",
  "staffing.role.delete_error": "No se pudo eliminar el rol de personal: {reason}",
  "staffing.role.holders_none": "Nadie",
  "staffing.role.holders_one": "1 persona",
  "staffing.role.holders_other": "{count} personas",
  "staffing.role.heading_new": "Añadir rol de personal",
  "staffing.role.heading_edit": "Editar rol de personal",
  "staffing.role.name": "Nombre",
  "staffing.role.name_required": "Escribe un nombre",
  "staffing.role.colour": "Color",
  "staffing.role.colour_invalid": "Elige uno de los colores",
  "staffing.role.people": "Personas",
  "staffing.role.people_placeholder": "Elige personas",
  "staffing.role.people_invalid": "Algunas de estas personas ya no existen",
  "staffing.role.people_error": "No se pudieron cargar las personas del local: {reason}",
  "staffing.role.people_not_saved":
    "El rol de personal está guardado, pero no sus personas. Guarda de nuevo para reintentarlo: {reason}",
  "staffing.role.search": "Buscar",
  "staffing.role.no_results": "Sin resultados",
  "staffing.role.fix_fields": "Corrige los campos marcados para continuar.",
  "staffing.role.cancel": "Cancelar",
  "staffing.role.save": "Guardar",
  "staffing.view.tab": "Personal",
  "staffing.month.previous": "Mes anterior",
  "staffing.month.next": "Mes siguiente",
  "staffing.month.seasons": "Temporadas",
  "staffing.month.season": "{name} · {from} – {to}",
  "staffing.month.area": "Mostrar",
  "staffing.month.all_areas": "Todas las áreas",
  "staffing.month.loading": "Cargando personal…",
  "staffing.month.load_error": "No se pudo cargar el personal: {reason}",
  "staffing.month.today": "Hoy",
  "staffing.month.closed": "Cerrado",
  "staffing.month.legend": "Barras: personas necesarias por área",
  "staffing.grid.label": "Personal por día",
  "staffing.grid.follows_season": "Sigue la temporada",
  "staffing.grid.follow_season": "Seguir la temporada",
  "staffing.grid.staff_role": "Rol de personal",
  "staffing.grid.how_many": "Cuántas personas",
  "staffing.grid.delete": "Eliminar",
  "staffing.grid.people_one": "1 persona",
  "staffing.grid.people_other": "{count} personas",
  "staffing.painter.heading": "Personal",
  "staffing.painter.week": "Semana de {season}",
  "staffing.painter.previous_season": "Temporada anterior",
  "staffing.painter.next_season": "Temporada siguiente",
  "staffing.painter.area": "Departamento o estación de preparación",
  "staffing.painter.departments": "Departamentos",
  "staffing.painter.stations": "Estaciones de preparación",
  "staffing.painter.paint": "Pintar:",
  "staffing.painter.new_staff_role": "+ Nuevo rol de personal",
  "staffing.painter.loading": "Cargando el personal…",
  "staffing.painter.load_error": "No se pudo cargar el personal: {reason}",
  "staffing.painter.refused_on": "{area}, {day}: {message}",
  "staffing.painter.refresh_error": "Guardado; no se pudo actualizar: {reason}",
  "staffing.painter.removed_one": "{names} se eliminó; sus cambios se descartaron.",
  "staffing.painter.removed_many": "{names} se eliminaron; sus cambios se descartaron.",
  "staffing.painter.no_areas":
    "Este local aún no tiene departamentos ni estaciones de preparación.",
  "staffing.painter.dates_removed_one":
    "{dates} se quitó de este día especial; sus cambios se descartaron.",
  "staffing.painter.dates_removed_many":
    "{dates} se quitaron de este día especial; sus cambios se descartaron.",
  "staffing.painter.no_dates": "Este día especial aún no tiene fechas.",
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

/** How many people a staffing block needs, in words. */
export function peopleNeeded(count: number, locale?: string): string {
  if (count === 1) return t("staffing.grid.people_one", locale);
  return tf("staffing.grid.people_other", { count: String(count) }, locale);
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
