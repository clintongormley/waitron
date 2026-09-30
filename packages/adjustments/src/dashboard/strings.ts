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
  "adjustments.fix_fields": "Correct the highlighted fields to continue.",
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
  "adjustments.limit.heading": "Limit on a bill's discounts",
  "adjustments.limit.field": "Bill discount limit (%)",
  "adjustments.limit.hint":
    "Discounts on one bill, on its items and on the whole bill added together, may take off up to this share of its price before adjustments; past it, a manager must approve with their PIN. Give-aways and cancellations do not count. Leave it empty for no limit.",
  "adjustments.limit.save": "Save limit",
  "adjustments.limit.saved": "Limit saved.",
  "adjustments.limit.load_error": "The bill discount limit could not be loaded.",
  "adjustments.limit.invalid":
    "Enter a percentage above 0 and up to 100, with at most two decimals.",
  "nav.adjustment_report": "Adjustment report",
  "adjustment_report.title": "Adjustment report",
  "adjustment_report.intro":
    "Counts the cancellations, give-aways and discounts on the bills opened on these business days. A person's rate is what their own adjustments took off, as a share of the sales credited to them at prices before any adjustment.",
  "adjustment_report.from": "From",
  "adjustment_report.to": "To",
  "adjustment_report.range_backwards": "Choose a first day on or before the last day.",
  "adjustment_report.load_error": "The adjustment report could not be loaded: {reason}",
  "adjustment_report.loading": "Loading the report",
  "adjustment_report.summary": "All adjustments",
  "adjustment_report.none": "No adjustments on these days.",
  "adjustment_report.show_all": "List every adjustment",
  "adjustment_report.figure.count": "Adjustments",
  "adjustment_report.figure.reduction": "Taken off the bills",
  "adjustment_report.figure.sales": "Sales before adjustments",
  "adjustment_report.figure.rate": "Rate",
  "adjustment_report.figure.cancelled": "List value of cancelled items",
  "adjustment_report.people": "By person",
  "adjustment_report.people_hint": "Choose a name to list that person's adjustments.",
  "adjustment_report.guests": "Guests",
  "adjustment_report.unknown_person": "Unknown person",
  "adjustment_report.open_person": "List {name}'s adjustments",
  "adjustment_report.open_guests": "List the guests' adjustments",
  "adjustment_report.column.name": "Name",
  "adjustment_report.column.count": "Adjustments",
  "adjustment_report.column.reduction": "Taken off",
  "adjustment_report.column.sales": "Credited sales",
  "adjustment_report.column.rate": "Rate",
  "adjustment_report.column.cancelled": "List value cancelled",
  "adjustment_report.column.approved_by": "Approved by",
  "adjustment_report.column.approvals_given": "Approvals given",
  "adjustment_report.by_action": "By action",
  "adjustment_report.by_stage": "By stage",
  "adjustment_report.by_reason": "By reason",
  "adjustment_report.column.action": "Action",
  "adjustment_report.column.stage": "Stage",
  "adjustment_report.column.reason": "Reason",
  "adjustment_report.no_reasons": "No reason was used on these days.",
  "adjustment_report.person_by_action": "{name}'s adjustments by action",
  "adjustment_report.person_by_stage": "{name}'s adjustments by stage",
  "adjustment_report.person_by_reason": "{name}'s adjustments by reason",
  "adjustment_report.guests_by_action": "Guests' adjustments by action",
  "adjustment_report.guests_by_stage": "Guests' adjustments by stage",
  "adjustment_report.guests_by_reason": "Guests' adjustments by reason",
  "adjustment_report.entries.person": "Adjustments by {name}",
  "adjustment_report.entries.guests": "Adjustments by guests",
  "adjustment_report.entries.everyone": "Every adjustment",
  "adjustment_report.entries.close": "Close the list",
  "adjustment_report.entries.error": "These adjustments could not be loaded: {reason}",
  "adjustment_report.entries.time": "Time",
  "adjustment_report.entries.when": "When",
  "adjustment_report.entries.note": "Note",
  "adjustment_report.entries.item": "Item",
  "adjustment_report.entries.quantity": "Quantity",
  "adjustment_report.entries.list_value": "List value",
  "adjustment_report.entries.requested_by": "Requested by",
  "adjustment_report.entries.credited_to": "Credited to",
  "adjustment_report.entries.order": "Order",
  "adjustment_report.entries.guest": "Guest",
  "adjustment_report.entries.show_more": "Show more",
  "adjustment_report.entries.more_error": "More adjustments could not be loaded: {reason}",
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
  "adjustments.fix_fields": "Corrige los campos marcados para continuar.",
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
  "adjustments.limit.heading": "Límite de descuento por cuenta",
  "adjustments.limit.field": "Límite de descuento por cuenta (%)",
  "adjustments.limit.hint":
    "Los descuentos de una cuenta, en sus artículos y en toda la cuenta sumados, pueden quitar hasta este porcentaje de su precio antes de ajustes; por encima, un encargado debe aprobarlo con su PIN. Las invitaciones y las anulaciones no cuentan. Déjalo vacío para no poner límite.",
  "adjustments.limit.save": "Guardar límite",
  "adjustments.limit.saved": "Límite guardado.",
  "adjustments.limit.load_error": "No se pudo cargar el límite de descuento por cuenta.",
  "adjustments.limit.invalid":
    "Escribe un porcentaje mayor que 0 y hasta 100, con dos decimales como máximo.",
  "nav.adjustment_report": "Informe de ajustes",
  "adjustment_report.title": "Informe de ajustes",
  "adjustment_report.intro":
    "Cuenta las anulaciones, invitaciones y descuentos de las cuentas abiertas en estas jornadas. La tasa de cada persona es lo que descontaron sus propios ajustes, en proporción a las ventas que se le atribuyen a precios anteriores a cualquier ajuste.",
  "adjustment_report.from": "Desde",
  "adjustment_report.to": "Hasta",
  "adjustment_report.range_backwards": "Elige un primer día igual o anterior al último.",
  "adjustment_report.load_error": "No se pudo cargar el informe de ajustes: {reason}",
  "adjustment_report.loading": "Cargando el informe",
  "adjustment_report.summary": "Todos los ajustes",
  "adjustment_report.none": "No hay ajustes en estas jornadas.",
  "adjustment_report.show_all": "Ver todos los ajustes",
  "adjustment_report.figure.count": "Ajustes",
  "adjustment_report.figure.reduction": "Descontado de las cuentas",
  "adjustment_report.figure.sales": "Ventas antes de ajustes",
  "adjustment_report.figure.rate": "Tasa",
  "adjustment_report.figure.cancelled": "Valor de carta de lo anulado",
  "adjustment_report.people": "Por persona",
  "adjustment_report.people_hint": "Elige un nombre para ver los ajustes de esa persona.",
  "adjustment_report.guests": "Clientes",
  "adjustment_report.unknown_person": "Persona desconocida",
  "adjustment_report.open_person": "Ver los ajustes de {name}",
  "adjustment_report.open_guests": "Ver los ajustes de los clientes",
  "adjustment_report.column.name": "Nombre",
  "adjustment_report.column.count": "Ajustes",
  "adjustment_report.column.reduction": "Descontado",
  "adjustment_report.column.sales": "Ventas atribuidas",
  "adjustment_report.column.rate": "Tasa",
  "adjustment_report.column.cancelled": "Valor de carta anulado",
  "adjustment_report.column.approved_by": "Aprobado por",
  "adjustment_report.column.approvals_given": "Aprobaciones dadas",
  "adjustment_report.by_action": "Por acción",
  "adjustment_report.by_stage": "Por momento",
  "adjustment_report.by_reason": "Por motivo",
  "adjustment_report.column.action": "Acción",
  "adjustment_report.column.stage": "Momento",
  "adjustment_report.column.reason": "Motivo",
  "adjustment_report.no_reasons": "No se usó ningún motivo en estas jornadas.",
  "adjustment_report.person_by_action": "Ajustes de {name} por acción",
  "adjustment_report.person_by_stage": "Ajustes de {name} por momento",
  "adjustment_report.person_by_reason": "Ajustes de {name} por motivo",
  "adjustment_report.guests_by_action": "Ajustes de los clientes por acción",
  "adjustment_report.guests_by_stage": "Ajustes de los clientes por momento",
  "adjustment_report.guests_by_reason": "Ajustes de los clientes por motivo",
  "adjustment_report.entries.person": "Ajustes de {name}",
  "adjustment_report.entries.guests": "Ajustes de los clientes",
  "adjustment_report.entries.everyone": "Todos los ajustes",
  "adjustment_report.entries.close": "Cerrar la lista",
  "adjustment_report.entries.error": "No se pudieron cargar estos ajustes: {reason}",
  "adjustment_report.entries.time": "Hora",
  "adjustment_report.entries.when": "Momento",
  "adjustment_report.entries.note": "Nota",
  "adjustment_report.entries.item": "Artículo",
  "adjustment_report.entries.quantity": "Cantidad",
  "adjustment_report.entries.list_value": "Valor de carta",
  "adjustment_report.entries.requested_by": "Solicitado por",
  "adjustment_report.entries.credited_to": "Atribuido a",
  "adjustment_report.entries.order": "Pedido",
  "adjustment_report.entries.guest": "Cliente",
  "adjustment_report.entries.show_more": "Mostrar más",
  "adjustment_report.entries.more_error": "No se pudieron cargar más ajustes: {reason}",
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

/** How a report heads each action's total. */
const ACTION_TOTALS: NameTable = {
  cancel: { en: "Cancellations", es: "Anulaciones" },
  comp: { en: "Give-aways", es: "Invitaciones" },
  discount_percent: { en: "Percentage discounts", es: "Descuentos en porcentaje" },
  discount_amount: { en: "Amount discounts", es: "Descuentos en importe" },
};

/** How far an item had got when it was adjusted; a whole-bill discount has no item. */
const STAGE_NAMES: NameTable = {
  beforeFiring: { en: "Before firing", es: "Antes de marchar" },
  afterFiring: { en: "After firing", es: "Después de marchar" },
  afterServing: { en: "After serving", es: "Después de servir" },
  billDiscount: { en: "Whole bill", es: "Toda la cuenta" },
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

export function actionTotalName(action: string, locale?: string): string {
  return resolveNameTable(ACTION_TOTALS, action, locale);
}

export function stageName(stage: string, locale?: string): string {
  return resolveNameTable(STAGE_NAMES, stage, locale);
}
