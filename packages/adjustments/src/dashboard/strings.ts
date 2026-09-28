import {
  makeT,
  registerCatalogue,
  registerCodeMessages,
  resolveNameTable,
  type NameTable,
} from "@waitron/dashboard-kit";

// Registers its catalogue and code messages at load, so importing `t` is enough to resolve them.

const en = {
  "nav.adjustment_reasons": "Adjustment reasons",
  "adjustments.title": "Adjustment reasons",
  "adjustments.intro":
    "The reasons staff choose when they cancel an item, give it away or discount it, and the limits each reason carries.",
  "adjustments.add": "Add reason",
  "adjustments.empty": "No reasons yet.",
  "adjustments.column.name": "Name",
  "adjustments.column.actions": "Allows",
  "adjustments.column.limits": "Limits",
  "adjustments.column.roles": "Who applies it",
  "adjustments.column.status": "Status",
  "adjustments.column.menu": "Actions",
  "adjustments.columns": "Columns",
  "adjustments.active": "Active",
  "adjustments.inactive": "Inactive",
  "adjustments.filter_all": "All reasons",
  "adjustments.limit_percent": "Up to {percent}% off an item",
  "adjustments.limit_amount": "Up to {amount} off a bill",
  "adjustments.no_limit": "No limit",
  "adjustments.approves": "{role} approves",
  "adjustments.note_required": "Note required",
  "adjustments.move_up": "Move up",
  "adjustments.move_down": "Move down",
  "adjustments.edit": "Edit",
  "adjustments.deactivate": "Deactivate",
  "adjustments.new": "New reason",
  "adjustments.edit_heading": "Edit reason",
  "adjustments.field.name": "Name",
  "adjustments.field.names": "Name in each language",
  "adjustments.field.name_in": "Name in {language}",
  "adjustments.field.actions": "What staff may do with this reason",
  "adjustments.field.max_percent": "Most taken off an item (%)",
  "adjustments.field.max_percent_hint":
    "Counts percentage discounts only. Leave it empty for no limit.",
  "adjustments.field.max_amount": "Most taken off a bill",
  "adjustments.field.max_amount_hint":
    "Everything this reason takes off one bill, added together. Leave it empty for no limit.",
  "adjustments.field.apply_role": "Lowest role that applies it without approval",
  "adjustments.field.approver_role": "Lowest role that may approve it",
  "adjustments.field.note_required": "Staff must write a note",
  "adjustments.save": "Save",
  "adjustments.cancel": "Cancel",
  "adjustments.deactivate_heading": "Deactivate reason",
  "adjustments.deactivate_explained":
    "Staff will no longer be offered {name}. It stays in the list as inactive.",
  "adjustments.form_error_heading": "There is a problem with this form",
  "adjustments.error.name": "Enter a name.",
  "adjustments.error.names": "Check the names in each language.",
  "adjustments.error.actions": "Choose at least one action.",
  "adjustments.error.maxPercent":
    "Enter a percentage above 0 and up to 100, with at most two decimals.",
  "adjustments.error.maxAmount":
    "Enter an amount above 0 with at most two decimals, such as 30.00.",
  "adjustments.error.applyRole": "Choose who may apply this reason.",
  "adjustments.error.approverRole":
    "The approving role must be the same as, or above, the role that applies it.",
  "adjustments.error.noteRequired": "Choose whether staff must write a note.",
  "adjustments.load_error": "The adjustment reasons could not be loaded.",
  "adjustments.reorder_error": "The new order could not be saved.",
} as const;

const es: Record<keyof typeof en, string> = {
  "nav.adjustment_reasons": "Motivos de ajuste",
  "adjustments.title": "Motivos de ajuste",
  "adjustments.intro":
    "Los motivos que elige el personal al anular un artículo, no cobrarlo o descontarlo, y los límites de cada motivo.",
  "adjustments.add": "Añadir motivo",
  "adjustments.empty": "Todavía no hay motivos.",
  "adjustments.column.name": "Nombre",
  "adjustments.column.actions": "Permite",
  "adjustments.column.limits": "Límites",
  "adjustments.column.roles": "Quién lo aplica",
  "adjustments.column.status": "Estado",
  "adjustments.column.menu": "Acciones",
  "adjustments.columns": "Columnas",
  "adjustments.active": "Activo",
  "adjustments.inactive": "Inactivo",
  "adjustments.filter_all": "Todos los motivos",
  "adjustments.limit_percent": "Hasta un {percent}% de un artículo",
  "adjustments.limit_amount": "Hasta {amount} de una cuenta",
  "adjustments.no_limit": "Sin límite",
  "adjustments.approves": "Aprueba: {role}",
  "adjustments.note_required": "Nota obligatoria",
  "adjustments.move_up": "Subir",
  "adjustments.move_down": "Bajar",
  "adjustments.edit": "Editar",
  "adjustments.deactivate": "Desactivar",
  "adjustments.new": "Nuevo motivo",
  "adjustments.edit_heading": "Editar motivo",
  "adjustments.field.name": "Nombre",
  "adjustments.field.names": "Nombre en cada idioma",
  "adjustments.field.name_in": "Nombre en {language}",
  "adjustments.field.actions": "Qué puede hacer el personal con este motivo",
  "adjustments.field.max_percent": "Máximo por artículo (%)",
  "adjustments.field.max_percent_hint":
    "Solo cuenta los descuentos en porcentaje. Déjalo vacío para no poner límite.",
  "adjustments.field.max_amount": "Máximo por cuenta",
  "adjustments.field.max_amount_hint":
    "Todo lo que este motivo descuenta de una cuenta, sumado. Déjalo vacío para no poner límite.",
  "adjustments.field.apply_role": "Rol mínimo que lo aplica sin aprobación",
  "adjustments.field.approver_role": "Rol mínimo que lo puede aprobar",
  "adjustments.field.note_required": "El personal debe escribir una nota",
  "adjustments.save": "Guardar",
  "adjustments.cancel": "Cancelar",
  "adjustments.deactivate_heading": "Desactivar motivo",
  "adjustments.deactivate_explained":
    "El personal dejará de ver {name}. Seguirá en la lista como inactivo.",
  "adjustments.form_error_heading": "Hay un problema con este formulario",
  "adjustments.error.name": "Escribe un nombre.",
  "adjustments.error.names": "Revisa los nombres en cada idioma.",
  "adjustments.error.actions": "Elige al menos una acción.",
  "adjustments.error.maxPercent":
    "Escribe un porcentaje mayor que 0 y hasta 100, con dos decimales como máximo.",
  "adjustments.error.maxAmount":
    "Escribe un importe mayor que 0 con dos decimales como máximo, como 30,00.",
  "adjustments.error.applyRole": "Elige quién puede aplicar este motivo.",
  "adjustments.error.approverRole":
    "El rol que aprueba debe ser igual o superior al que lo aplica.",
  "adjustments.error.noteRequired": "Elige si el personal debe escribir una nota.",
  "adjustments.load_error": "No se pudieron cargar los motivos de ajuste.",
  "adjustments.reorder_error": "No se pudo guardar el nuevo orden.",
};

export const ADJUSTMENTS_STRINGS = { en, es };

/** Only the `adjustment_reason.*` codes the screen can meet; the rest are the app's. */
export const ADJUSTMENTS_CODE_MESSAGES: Record<string, { en: string; es: string }> = {
  "adjustment_reason.name_taken": {
    en: "Another active reason already has this name",
    es: "Ya hay otro motivo activo con este nombre",
  },
  "adjustment_reason.not_found": {
    en: "That reason could not be found. It may have been removed",
    es: "No se ha encontrado ese motivo. Puede que se haya eliminado",
  },
};

registerCatalogue(ADJUSTMENTS_STRINGS);
registerCodeMessages(ADJUSTMENTS_CODE_MESSAGES);

export type StringKey = keyof typeof en;
export const t = makeT<StringKey>();

/** `t` with each `{name}` in the text replaced by its value. */
export function tf(key: StringKey, values: Record<string, string>, locale?: string): string {
  return t(key, locale).replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole);
}

/** The short name a list shows for each action. */
const ACTION_NAMES: NameTable = {
  cancel: { en: "Cancel", es: "Anular" },
  comp: { en: "Give away", es: "Invitación" },
  discount_percent: { en: "Percentage discount", es: "Descuento en porcentaje" },
  discount_amount: { en: "Amount discount", es: "Descuento en importe" },
};

/** The fuller wording an editor's checkbox uses for each action. */
const ACTION_CHOICES: NameTable = {
  cancel: { en: "Cancel an item", es: "Anular un artículo" },
  comp: { en: "Give an item away", es: "Invitar: no cobrar el artículo" },
  discount_percent: { en: "Discount by a percentage", es: "Descontar un porcentaje" },
  discount_amount: { en: "Discount by an amount", es: "Descontar un importe" },
};

const ROLE_NAMES: NameTable = {
  staff: { en: "Staff", es: "Empleado" },
  supervisor: { en: "Supervisor", es: "Supervisor" },
  manager: { en: "Manager", es: "Encargado" },
  admin: { en: "Admin", es: "Administrador" },
};

export function actionName(action: string, locale?: string): string {
  return resolveNameTable(ACTION_NAMES, action, locale);
}

export function actionChoice(action: string, locale?: string): string {
  return resolveNameTable(ACTION_CHOICES, action, locale);
}

export function roleName(role: string, locale?: string): string {
  return resolveNameTable(ROLE_NAMES, role, locale);
}
